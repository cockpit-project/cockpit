/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

#include "config.h"

#include "cockpitrouter.h"

#include "cockpitconnect.h"
#include "cockpitpeer.h"

#include "common/cockpitchannel.h"
#include "common/cockpitjson.h"
#include "common/cockpittransport.h"
#include "common/cockpitpipe.h"
#include "common/cockpitpipetransport.h"
#include "common/cockpittemplate.h"

#include <stdlib.h>
#include <string.h>

struct _CockpitRouter {
  GObjectClass parent;

  gchar *init_host;
  gulong signal_id;

  /* The transport we're talking to */
  CockpitTransport *transport;

  /* Rules for how to open channels */
  GList *rules;

  /* All local channels are tracked here, value may be null */
  GHashTable *channels;

  /* Channel groups */
  GHashTable *groups;
  GHashTable *fences;
  GQueue *fenced;
};

typedef struct _CockpitRouterClass {
  GObjectClass parent_class;
} CockpitRouterClass;

G_DEFINE_TYPE (CockpitRouter, cockpit_router, G_TYPE_OBJECT);

enum {
  PROP_0,
  PROP_TRANSPORT,
};

typedef struct {
  gchar **argv;
  gchar **environ;
} DynamicKey;

typedef struct {
  JsonObject *config;

  // Contents owned by config
  gchar **env;
  gchar **spawn;

  GHashTable *peers;
} DynamicPeer;

static guint
strv_hash (gconstpointer v)
{
  const gchar * const *strv = v;
  guint hash = 0;
  gint i;
  for (i = 0; strv && strv[i] != NULL; i++)
    hash |= g_str_hash (strv[i]);
  return hash;
}

static gboolean
strv_equal (gconstpointer v1,
            gconstpointer v2)
{
  const gchar * const *strv1 = v1;
  const gchar * const *strv2 = v2;
  gint i;

  if (strv1 == strv2)
    return TRUE;
  if (!strv1 || !strv2)
    return FALSE;
  for (i = 0; strv1[i] != NULL || strv2[i] != NULL; i++)
    {
      if (strv1[i] == NULL || strv2[i] == NULL || !g_str_equal (strv1[i], strv2[i]))
        return FALSE;
    }
  return TRUE;
}

static guint
dynamic_key_hash (gconstpointer v)
{
  const DynamicKey *key = v;
  return strv_hash (key->argv) | strv_hash (key->environ);
}

static gboolean
dynamic_key_equal (gconstpointer v1,
                   gconstpointer v2)
{
  const DynamicKey *key1 = v1;
  const DynamicKey *key2 = v2;
  return strv_equal (key1->argv, key2->argv) && strv_equal (key1->environ, key2->environ);
}

static void
dynamic_key_free (gpointer v)
{
  DynamicKey *key = v;
  g_strfreev (key->argv);
  g_strfreev (key->environ);
  g_free (key);
}

static DynamicPeer *
dynamic_peer_create (JsonObject *config)
{
  DynamicPeer *p = g_new0 (DynamicPeer, 1);

  p->peers = g_hash_table_new_full (dynamic_key_hash, dynamic_key_equal,
                                    dynamic_key_free, g_object_unref);

  p->config = json_object_ref (config);
  if (!cockpit_json_get_strv (config, "environ", NULL, &p->env))
    p->env = NULL;

  if (!cockpit_json_get_strv (config, "spawn", NULL, &p->spawn))
    p->spawn = NULL;

  return p;
}

static void
dynamic_peer_free (gpointer data)
{
  DynamicPeer *p = data;
  json_object_unref (p->config);
  g_hash_table_unref (p->peers);
  g_free (p->spawn);
  g_free (p->env);
  g_free (p);
}

typedef struct {
  gchar *name;
  GPatternSpec *glob;
  JsonNode *node;
} RouterMatch;

typedef struct {
  JsonObject *config;
  RouterMatch *matches;
  gboolean (* callback) (CockpitRouter *, const gchar *, JsonObject *, GBytes *, gpointer);
  gpointer user_data;
  GDestroyNotify destroy;
} RouterRule;

static void
router_rule_compile (RouterRule *rule,
                     JsonObject *object)
{
  RouterMatch *match;
  GList *names, *l;
  JsonNode *node;
  gint i;

  g_assert (rule->matches == NULL);

  names = json_object_get_members (object);
  rule->matches = g_new0 (RouterMatch, g_list_length (names) + 1);
  for (l = names, i = 0; l != NULL; l = g_list_next (l), i++)
    {
      match = &rule->matches[i];
      match->name = g_strdup (l->data);
      node = json_object_get_member (object, l->data);

      /* A glob style string pattern */
      if (JSON_NODE_HOLDS_VALUE (node) && json_node_get_value_type (node) == G_TYPE_STRING)
        match->glob = g_pattern_spec_new (json_node_get_string (node));

      /* A null matches anything */
      if (!JSON_NODE_HOLDS_NULL (node))
        match->node = json_node_copy (node);
    }

  /* The last match has a null name */
  g_list_free (names);
}

static gboolean
router_rule_match (RouterRule *rule,
                   JsonObject *object)
{
  RouterMatch *match;
  const gchar *value;
  JsonNode *node;
  guint i;

  for (i = 0; rule->matches && rule->matches[i].name != NULL; i++)
    {
      match = &rule->matches[i];
      if (match->glob)
        {
          if (!cockpit_json_get_string (object, match->name, NULL, &value) || !value ||
              !g_pattern_match (match->glob, strlen (value), value, NULL))
            return FALSE;
        }
      else if (match->node)
        {
          node = json_object_get_member (object, match->name);
          if (!node || !cockpit_json_equal (match->node, node))
            return FALSE;
        }
      else
        {
          if (!json_object_has_member (object, match->name))
            return FALSE;
        }
    }

  return TRUE;
}

static gboolean
router_rule_invoke (RouterRule *rule,
                    CockpitRouter *self,
                    const gchar *channel,
                    JsonObject *options,
                    GBytes *data)
{
  g_assert (rule->callback != NULL);
  return (rule->callback) (self, channel, options, data, rule->user_data);
}

static RouterRule *
router_rule_find (GList *rules,
                  JsonObject *config)
{
  for (GList *l = rules; l; l = g_list_next (l))
    {
      RouterRule *rule = l->data;
      if (rule->config && cockpit_json_equal_object (rule->config, config))
        return rule;
    }
  return NULL;
}

static void
router_rule_destroy (RouterRule *rule)
{
  gint i;

  if (rule->destroy)
    (rule->destroy) (rule->user_data);
  for (i = 0; rule->matches && rule->matches[i].name != NULL; i++)
    {
      g_free (rule->matches[i].name);
      json_node_free (rule->matches[i].node);
      if (rule->matches[i].glob)
        g_pattern_spec_free (rule->matches[i].glob);
    }
  g_free (rule->matches);
  if (rule->config)
    json_object_unref (rule->config);
  g_free (rule);
}

static void
router_rule_dump (RouterRule *rule)
{
  RouterMatch *match;
  gchar *text;
  guint i;

  g_print ("rule:\n");
  for (i = 0; rule->matches && rule->matches[i].name != NULL; i++)
    {
      match = &rule->matches[i];
      if (match->node)
        {
          text = cockpit_json_write (match->node, NULL);
          g_print ("  %s: %s\n", match->name, text);
          g_free (text);
        }
      else if (match->glob)
        {
          g_print ("  %s: glob\n", match->name);
        }
      else
        {
          g_print ("  %s\n", match->name);
        }
    }
}

static void
process_init (CockpitRouter *self,
              CockpitTransport *transport,
              JsonObject *options)
{
  const gchar *problem = NULL;
  const gchar *host;
  gint64 version = -1;

  if (self->init_host)
    {
      g_warning ("caller already sent another 'init' message");
      problem = "protocol-error";
    }
  else if (!cockpit_json_get_int (options, "version", -1, &version))
    {
      g_warning ("invalid 'version' field in init message");
      problem = "protocol-error";
    }
  else if (version == -1)
    {
      g_warning ("missing 'version' field in init message");
      problem = "protocol-error";
    }
  else if (!cockpit_json_get_string (options, "host", NULL, &host))
    {
      g_warning ("invalid 'host' field in init message");
      problem = "protocol-error";
    }
  else if (host == NULL)
    {
      g_message ("missing 'host' field in init message");
      problem = "protocol-error";
    }
  else if (version != 1)
    {
      g_message ("unsupported 'version' of cockpit protocol: %" G_GINT64_FORMAT, version);
      problem = "not-supported";
    }

  if (problem)
    {
      cockpit_transport_close (transport, problem);
    }
  else
    {
      g_debug ("received init message");
      g_assert (host != NULL);
      self->init_host = g_strdup (host);
      problem = NULL;
    }
}

static void
on_channel_closed (CockpitChannel *local,
                   const gchar *problem,
                   gpointer user_data)
{
  CockpitRouter *self = COCKPIT_ROUTER (user_data);
  const gchar *channel;
  GQueue *fenced;
  GList *l;

  channel = cockpit_channel_get_id (local);
  g_hash_table_remove (self->channels, channel);
  g_hash_table_remove (self->groups, channel);

  /*
   * If this was the last channel in the fence group then resume all other channels
   * as there's no barrier preventing them from functioning.
   */
  if (!g_hash_table_remove (self->fences, channel) || g_hash_table_size (self->fences) != 0)
    return;

  fenced = self->fenced;
  self->fenced = NULL;

  if (!fenced)
    return;

  for (l = fenced->head; l != NULL; l = g_list_next (l))
    cockpit_transport_thaw (self->transport, l->data);
  g_queue_free_full (fenced, g_free);
}

static void
create_channel (CockpitRouter *self,
                const gchar *channel,
                JsonObject *options,
                GType type)
{
  CockpitChannel *local;

  local = g_object_new (type,
                        "transport", self->transport,
                        "id", channel,
                        "options", options,
                        NULL);

  /* This owns the local channel */
  g_hash_table_replace (self->channels, (gpointer)cockpit_channel_get_id (local), local);
  g_signal_connect (local, "closed", G_CALLBACK (on_channel_closed), self);
}

static gboolean
is_empty (const gchar *s)
{
  return !s || s[0] == '\0';
}

/*
 * For backwards compatibility we need to normalize some host params
 * so they can be matched against.
 *
 * Some sessions shouldn't be shared by multiple channels, such as those that
 * explicitly specify a host-key or specific user. This changed over time
 * so modify things to make it a simple match.
 *
 * If the given user is the current user, remove it. Preserves the current
 * behavior.
 *
 */
static void
cockpit_router_normalize_host_params (JsonObject *options)
{
  const gchar *sharable = NULL;
  const gchar *user = NULL;
  gboolean needs_private = FALSE;

  if (!cockpit_json_get_string (options, "session", NULL, &sharable))
    sharable = NULL;

  if (!cockpit_json_get_string (options, "user", NULL, &user))
    user = NULL;

  if (!sharable)
    {
      /* Fallback to older ways of indicating this */
      if (user || json_object_has_member (options, "host-key"))
        needs_private = TRUE;

      if (json_object_has_member (options, "temp-session"))
        {
          if (needs_private && !cockpit_json_get_bool (options, "temp-session",
                                                       TRUE, &needs_private))
            needs_private = TRUE;
          json_object_remove_member (options, "temp-session");
        }
    }

  if (g_strcmp0 (user, g_get_user_name ()) == 0)
    json_object_remove_member (options, "user");

  if (needs_private)
    json_object_set_string_member (options, "session", "private");
}

static gboolean
cockpit_router_normalize_host (CockpitRouter *self,
                               JsonObject *options)
{
  const gchar *host;
  gchar *actual_host = NULL;
  gchar *key = NULL;
  gchar **parts = NULL;

  if (!cockpit_json_get_string (options, "host", self->init_host, &host))
    return FALSE;

  parts = g_strsplit (host, "+", 3);
  if (g_strv_length (parts) == 3 && !is_empty (parts[0]) &&
      !is_empty (parts[1]) && !is_empty (parts[2]))
    {
      key = g_strdup_printf ("host-%s", parts[1]);
      if (!json_object_has_member (options, key))
        {
          json_object_set_string_member (options, key, parts[2]);
          actual_host = parts[0];
        }
    }

  if (!actual_host)
    actual_host = (gchar *) host;

  if (g_strcmp0 (self->init_host, actual_host) == 0)
    json_object_remove_member (options, "host");
  else if (g_strcmp0 (host, actual_host) != 0)
    json_object_set_string_member (options, "host", actual_host);

  g_strfreev (parts);
  g_free (key);
  return TRUE;
}

static gboolean
process_open_channel (CockpitRouter *self,
                      const gchar *channel,
                      JsonObject *options,
                      GBytes *data,
                      gpointer user_data)
{
  GType (* type_function) (void) = user_data;
  GType channel_type = 0;
  const gchar *group;

  if (!cockpit_json_get_string (options, "group", "default", &group))
    g_warning ("%s: caller specified invalid 'group' field in open message", channel);

  g_assert (type_function != NULL);
  channel_type = type_function ();

  if (g_str_equal (group, "fence"))
    g_hash_table_add (self->fences, g_strdup (channel));

  g_hash_table_insert (self->groups, g_strdup (channel), g_strdup (group));

  create_channel (self, channel, options, channel_type);
  return TRUE;
}

static gboolean
process_open_peer (CockpitRouter *self,
                   const gchar *channel,
                   JsonObject *options,
                   GBytes *data,
                   gpointer user_data)
{
  CockpitPeer *peer = user_data;
  return cockpit_peer_handle (peer, channel, options, data);
}

static GBytes *
substitute_json_string (const gchar *variable,
                        gpointer user_data)
{
  const gchar *value;
  JsonObject *options = user_data;
  if (options && cockpit_json_get_string (options, variable, "", &value))
    return g_bytes_new (value, strlen (value));
  else if (options)
    g_message ("Couldn't get argument for bridge: got invalid value for '%s'", variable);

  return g_bytes_new ("", 0);
}

static JsonArray *
strv_to_json_array (gchar **strv)
{
  gint i;
  JsonArray *array = json_array_new ();
  g_assert (strv != NULL);
  for (i = 0; strv[i] != NULL; i++)
    json_array_add_string_element (array, strv[i]);
  return array;
}

static void
add_dynamic_args_to_array (gchar ***key,
                           gchar **config_args,
                           JsonObject *options)
{
  GPtrArray *arr = NULL;
  gint length;
  gint i;

  g_assert (config_args != NULL);
  g_assert (key != NULL);

  arr = g_ptr_array_new ();
  length = g_strv_length (config_args);
  for (i = 0; i < length; i++)
    {
      GString *s = g_string_new ("");
      GBytes *input = g_bytes_new_static (config_args[i], strlen(config_args[i]) + 1);
      GList *output = cockpit_template_expand (input, substitute_json_string,
                                               "${", "}", options);
      GList *l;
      for (l = output; l != NULL; l = g_list_next (l))
        {
          gsize size;
          gconstpointer data = g_bytes_get_data (l->data, &size);
          g_string_append_len (s, data, size);
        }

      g_ptr_array_add (arr, g_string_free (s, FALSE));
      g_bytes_unref (input);
      g_list_free_full (output, (GDestroyNotify) g_bytes_unref);
    }

  g_ptr_array_add (arr, NULL);
  *key = (gchar **)g_ptr_array_free (arr, FALSE);
}

static gboolean
process_open_dynamic_peer (CockpitRouter *self,
                           const gchar *channel,
                           JsonObject *options,
                           GBytes *data,
                           gpointer user_data)
{
  CockpitPeer *peer = NULL;
  DynamicKey key = { NULL, NULL };
  DynamicPeer *dp = user_data;
  JsonObject *config = NULL;
  GList *l, *names = NULL;

  if (dp->spawn)
    add_dynamic_args_to_array (&key.argv, dp->spawn, options);

  if (dp->env)
    add_dynamic_args_to_array (&key.environ, dp->env, options);

  peer = g_hash_table_lookup (dp->peers, &key);
  if (!peer)
    {
      config = json_object_new ();
      names = json_object_get_members (dp->config);
      for (l = names; l != NULL; l = g_list_next (l))
        {
          if (!g_str_equal (l->data, "spawn") && !g_str_equal (l->data, "environ"))
            json_object_set_member (config, l->data, json_object_dup_member (dp->config, l->data));
        }

      if (key.argv)
        json_object_set_array_member (config, "spawn", strv_to_json_array (key.argv));

      if (key.environ)
        json_object_set_array_member (config, "environ", strv_to_json_array (key.environ));

      peer = cockpit_peer_new (self->transport, config);
      g_hash_table_insert (dp->peers, g_memdup (&key, sizeof (DynamicKey)), peer);
    }
  else
    {
      g_strfreev (key.argv);
      g_strfreev (key.environ);
    }

  if (config)
    json_object_unref (config);

  g_list_free (names);
  return cockpit_peer_handle (peer, channel, options, data);
}

static gboolean
process_open_not_supported (CockpitRouter *self,
                            const gchar *channel,
                            JsonObject *options,
                            GBytes *data,
                            gpointer user_data)
{
  const gchar *payload;

  if (!cockpit_json_get_string (options, "payload", NULL, &payload))
    g_warning ("%s: caller specified invalid 'payload' field in open message", channel);
  else if (payload == NULL)
    g_warning ("%s: caller didn't provide a 'payload' field in open message", channel);
  else
    g_debug ("%s: bridge doesn't support channel: %s", channel, payload);

  /* This creates a temporary channel that closes with not-supported */
  create_channel (self, channel, options, COCKPIT_TYPE_CHANNEL);
  return TRUE;
}

static void
process_open (CockpitRouter *self,
              CockpitTransport *transport,
              const gchar *channel,
              JsonObject *options,
              GBytes *data)
{
  GList *l;
  GBytes *new_payload = NULL;

  if (!channel)
    {
      g_warning ("Caller tried to open channel with invalid id");
      cockpit_transport_close (transport, "protocol-error");
    }

  /* Check that this isn't a local channel */
  else if (g_hash_table_lookup (self->channels, channel))
    {
      g_warning ("%s: caller tried to reuse a channel that's already in use", channel);
      cockpit_transport_close (self->transport, "protocol-error");
      return;
    }

  /* Request that this channel is frozen, and requeue its open message for later */
  else if (g_hash_table_size (self->fences) > 0 && !g_hash_table_lookup (self->fences, channel))
    {
      if (!self->fenced)
        self->fenced = g_queue_new ();
      g_queue_push_tail (self->fenced, g_strdup (channel));
      cockpit_transport_freeze (self->transport, channel);
      cockpit_transport_emit_control (self->transport, "open", channel, options, data);
    }

  else if (!cockpit_router_normalize_host (self, options))
    {
      g_warning ("%s: caller specified invalid 'host' field in open message", channel);
      process_open_not_supported (self, channel, options, data, NULL);
    }

  /* Now go throgh the rules */
  else
    {
      cockpit_router_normalize_host_params (options);
      new_payload = cockpit_json_write_bytes (options);
      for (l = self->rules; l != NULL; l = g_list_next (l))
        {
          if (router_rule_match (l->data, options) &&
              router_rule_invoke (l->data, self, channel, options, new_payload))
            {
              break;
            }
        }
    }
  if (new_payload)
    g_bytes_unref (new_payload);
}

static void
process_kill (CockpitRouter *self,
              JsonObject *options)
{
  GHashTableIter iter;
  const gchar *group = NULL;
  const gchar *host = NULL;
  GList *list, *l;

  if (!cockpit_json_get_string (options, "group", NULL, &group))
    {
      g_warning ("received invalid \"group\" field in kill command");
      return;
    }
  else if (!cockpit_json_get_string (options, "host", NULL, &host))
    {
      g_warning ("received invalid \"host\" field in kill command");
      return;
    }

  /* Killing on other hosts is handled elsewhere */
  if (host && g_strcmp0 (host, self->init_host) != 0)
    return;

  list = NULL;
  if (group)
    {
      gpointer id, channel_group;

      g_hash_table_iter_init (&iter, self->groups);
      while (g_hash_table_iter_next (&iter, &id, &channel_group))
        {
          CockpitChannel *channel;

          if (!g_str_equal (group, channel_group))
            continue;

          channel = g_hash_table_lookup (self->channels, id);
          if (channel)
            list = g_list_prepend (list, g_object_ref (channel));
        }
    }
  else
    {
      gpointer id, channel;

      g_hash_table_iter_init (&iter, self->channels);
      while (g_hash_table_iter_next (&iter, &id, &channel))
        list = g_list_prepend (list, g_object_ref (channel));
    }

  for (l = list; l != NULL; l = g_list_next (l))
    {
      CockpitChannel *channel = l->data;

      g_debug ("killing channel: %s", cockpit_channel_get_id (channel));
      cockpit_channel_close (channel, "terminated");

      g_object_unref (channel);
    }

  g_list_free (list);
}

static gboolean
on_transport_control (CockpitTransport *transport,
                      const char *command,
                      const gchar *channel_id,
                      JsonObject *options,
                      GBytes *message,
                      gpointer user_data)
{
  CockpitRouter *self = user_data;

  if (g_str_equal (command, "init"))
    {
      process_init (self, transport, options);
      return TRUE;
    }

  if (!self->init_host)
    {
      g_warning ("caller did not send 'init' message first");
      cockpit_transport_close (transport, "protocol-error");
      return TRUE;
    }

  if (g_str_equal (command, "open"))
    {
      process_open (self, transport, channel_id, options, message);
      return TRUE;
    }
  else if (g_str_equal (command, "kill"))
    {
      process_kill (self, options);
    }
  else if (g_str_equal (command, "close"))
    {
      if (!channel_id)
        {
          g_warning ("Caller tried to close channel without an id");
          cockpit_transport_close (transport, "protocol-error");
        }
    }

  return FALSE;
}

static void
object_unref_if_not_null (gpointer data)
{
  if (data)
    g_object_unref (data);
}

static void
cockpit_router_init (CockpitRouter *self)
{
  RouterRule *rule;

  /* Owns the channels */
  self->channels = g_hash_table_new_full (g_str_hash, g_str_equal, NULL, object_unref_if_not_null);
  self->groups = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, g_free);
  self->fences = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, NULL);

  /* The rules, including a default */
  rule = g_new0 (RouterRule, 1);
  rule->callback = process_open_not_supported;
  self->rules = g_list_prepend (self->rules, rule);
}

static void
cockpit_router_ban_hosts (CockpitRouter *self)
{
  RouterRule *rule;
  JsonObject *match = json_object_new ();

  json_object_set_null_member (match, "host");
  rule = g_new0 (RouterRule, 1);
  rule->callback = process_open_not_supported;
  router_rule_compile (rule, match);

  self->rules = g_list_prepend (self->rules, rule);
  json_object_unref (match);
}

static void
cockpit_router_dispose (GObject *object)
{
  CockpitRouter *self = COCKPIT_ROUTER (object);

  if (self->signal_id)
    {
      g_signal_handler_disconnect (self->transport, self->signal_id);
      self->signal_id = 0;
    }

  g_hash_table_remove_all (self->channels);
  g_hash_table_remove_all (self->groups);
  g_hash_table_remove_all (self->fences);

  g_list_free_full (self->rules, (GDestroyNotify)router_rule_destroy);
  self->rules = NULL;
}

static void
cockpit_router_finalize (GObject *object)
{
  CockpitRouter *self = COCKPIT_ROUTER (object);

  if (self->transport)
    g_object_unref (self->transport);

  if (self->fenced)
    g_queue_free_full (self->fenced, g_free);

  g_free (self->init_host);
  g_hash_table_destroy (self->channels);
  g_hash_table_destroy (self->groups);
  g_hash_table_destroy (self->fences);

  G_OBJECT_CLASS (cockpit_router_parent_class)->finalize (object);
}

static void
cockpit_router_set_property (GObject *obj,
                             guint prop_id,
                             const GValue *value,
                             GParamSpec *pspec)
{
  CockpitRouter *self = COCKPIT_ROUTER (obj);

  switch (prop_id)
    {
    case PROP_TRANSPORT:
      self->transport = g_value_dup_object (value);
      break;
    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (obj, prop_id, pspec);
      break;
    }
}

static void
cockpit_router_constructed (GObject *object)
{
  CockpitRouter *self = COCKPIT_ROUTER (object);

  G_OBJECT_CLASS (cockpit_router_parent_class)->constructed (object);

  g_return_if_fail (self->transport != NULL);

  self->signal_id = g_signal_connect (self->transport, "control",
                                      G_CALLBACK (on_transport_control),
                                      self);
}

static void
cockpit_router_class_init (CockpitRouterClass *class)
{
  GObjectClass *object_class;
  GSocketAddress *address;
  GInetAddress *inet;
  const gchar *port;

  object_class = G_OBJECT_CLASS (class);
  object_class->set_property = cockpit_router_set_property;
  object_class->finalize = cockpit_router_finalize;
  object_class->dispose = cockpit_router_dispose;
  object_class->constructed = cockpit_router_constructed;

  g_object_class_install_property (object_class, PROP_TRANSPORT,
                                   g_param_spec_object ("transport", "transport", "transport",
                                                        COCKPIT_TYPE_TRANSPORT,
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY |
                                                        G_PARAM_STATIC_STRINGS));

  /*
   * If we're running under a test server, register that server's HTTP address
   * as an internal address, available for use in cockpit channels.
   */

  port = g_getenv ("COCKPIT_TEST_SERVER_PORT");
  if (port)
    {
      inet = g_inet_address_new_loopback (G_SOCKET_FAMILY_IPV4);
      address = g_inet_socket_address_new (inet, atoi (port));
      cockpit_connect_add_internal_address ("/test-server", address);
      g_object_unref (address);
      g_object_unref (inet);
    }
}

/**
 * cockpit_router_new:
 * @transport: Transport to talk to cockpit-ws with
 * @payloads: List of payloads to handle, or NULL
 * @bridges: List of peer bridge config, or NULL
 *
 * Create a new CockpitRouter. The @payloads to handle
 * will be added via cockpit_router_add_channel().
 *
 * The @bridges if specified will be added via
 * cockpit_router_add_bridge(). These will be added in
 * reverse order so that the first bridge in the list
 * would be the first one that matches in the router.
 *
 * Returns: (transfer full): A new CockpitRouter object.
 */
CockpitRouter *
cockpit_router_new (CockpitTransport *transport,
                    CockpitPayloadType *payloads,
                    GList *bridges)
{
  CockpitRouter *router;
  guint i;
  JsonObject *match;

  g_return_val_if_fail (transport != NULL, NULL);

  router = g_object_new (COCKPIT_TYPE_ROUTER,
                         "transport", transport,
                         NULL);

  for (i = 0; payloads && payloads[i].name != NULL; i++)
    {
      match = json_object_new ();
      json_object_set_string_member (match, "payload", payloads[i].name);
      cockpit_router_add_channel (router, match, payloads[i].function);
      json_object_unref (match);
    }

  /* No hosts are allowed by default */
  cockpit_router_ban_hosts (router);

  cockpit_router_set_bridges (router, bridges);

  // cockpit_router_dump_rules (router);

  return router;
}

/**
 * cockpit_router_add_channel:
 * @self: The router object
 * @match: JSON configuration on what to match
 * @function: The function to get type from
 *
 * Add a channel handler to the router. The @match is a
 * JSON match object as described in doc/guide/ which matches
 * against "open" messages in order to determine whether to
 * use this channel.
 *
 * The @function returns a GType to use for the channel.
 */
void
cockpit_router_add_channel (CockpitRouter *self,
                            JsonObject *match,
                            GType (* function) (void))
{
  RouterRule *rule;

  g_return_if_fail (COCKPIT_IS_ROUTER (self));
  g_return_if_fail (match != NULL);
  g_return_if_fail (function != NULL);

  rule = g_new0 (RouterRule, 1);
  rule->callback = process_open_channel;
  rule->user_data = function;
  router_rule_compile (rule, match);
  self->rules = g_list_prepend (self->rules, rule);
}

/**
 * cockpit_router_add_peer:
 * @self: The router object
 * @match: JSON configuration on what to match
 * @peer: The CockpitPeer instance to route matches to
 *
 * Add a peer bridge to the router for handling channels.
 * The @match JSON object as described in doc/guide/ and
 * matches against "open" messages in order to determine whether
 * to send channels to this peer bridge.
 */
void
cockpit_router_add_peer (CockpitRouter *self,
                         JsonObject *match,
                         CockpitPeer *peer)
{
  RouterRule *rule;

  g_return_if_fail (COCKPIT_IS_ROUTER (self));
  g_return_if_fail (COCKPIT_IS_PEER (peer));
  g_return_if_fail (match != NULL);

  rule = g_new0 (RouterRule, 1);
  rule->callback = process_open_peer;
  rule->user_data = g_object_ref (peer);
  rule->destroy = g_object_unref;
  router_rule_compile (rule, match);

  self->rules = g_list_prepend (self->rules, rule);
}

void
cockpit_router_add_bridge (CockpitRouter *self,
                           JsonObject *config)
{
  RouterRule *rule;
  JsonObject *match;
  GList *output = NULL;
  GBytes *bytes = NULL;

  g_return_if_fail (COCKPIT_IS_ROUTER (self));
  g_return_if_fail (config != NULL);

  /* Actual descriptive warning displayed elsewhere */
  if (!cockpit_json_get_object (config, "match", NULL, &match))
    match = NULL;

  /* See if we have any variables in the JSON */
  bytes = cockpit_json_write_bytes (config);
  output = cockpit_template_expand (bytes, substitute_json_string,
                                    "${", "}", NULL);
  rule = g_new0 (RouterRule, 1);
  rule->config = json_object_ref (config);

  if (!output->next)
    {
      rule->callback = process_open_peer;
      rule->user_data = cockpit_peer_new (self->transport, config);
      rule->destroy = g_object_unref;
    }
  else
    {
      rule->callback = process_open_dynamic_peer;
      rule->user_data = dynamic_peer_create (config);
      rule->destroy = dynamic_peer_free;
    }

  router_rule_compile (rule, match);
  self->rules = g_list_prepend (self->rules, rule);

  g_bytes_unref (bytes);
  g_list_free_full (output, (GDestroyNotify) g_bytes_unref);
}

/**
 * cockpit_router_set_bridges:
 * @self: The router object
 * @configs: JSON configurations for the bridges
 *
 * Updates the rules for bridges to match @configs.  All rules that
 * have been previously added via @cockpit_router_add_bridge and
 * @cockpit_router_set_bridges conceptually removed, and all rules
 * specified by @configs are added as with @cockpit_add_bridge.
 *
 * External peers for rules that have not changed will be left
 * running.  Peers for rules that have disappeared will be terminated.
 */
void cockpit_router_set_bridges (CockpitRouter *self,
                                 GList *bridges)
{
  GList *l;
  JsonObject *config;
  RouterRule *rule;
  GList *old_rules;

  /* Enumerated in reverse, since the last rule is matched first */

  old_rules = self->rules;
  self->rules = NULL;
  for (l = g_list_last (bridges); l != NULL; l = g_list_previous (l))
    {
      config = l->data;

      rule = router_rule_find (old_rules, config);
      if (rule)
        {
          old_rules = g_list_remove (old_rules, rule);
          self->rules = g_list_prepend (self->rules, rule);
        }
      else
        {
          cockpit_router_add_bridge (self, config);
        }
    }

  for (l = old_rules; l; l = g_list_next (l))
    {
      rule = l->data;
      if (rule->config)
        {
          router_rule_destroy (rule);
        }
      else
        {
          self->rules = g_list_append (self->rules, rule);
        }
    }
  g_list_free (old_rules);
}

void
cockpit_router_dump_rules (CockpitRouter *self)
{
  GList *l;
  for (l = self->rules; l != NULL; l = g_list_next (l))
    router_rule_dump (l->data);
}
