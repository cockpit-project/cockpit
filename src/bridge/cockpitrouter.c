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
#include "cockpitdbusinternal.h"

#include "common/cockpitchannel.h"
#include "common/cockpitjson.h"
#include "common/cockpittransport.h"
#include "common/cockpitpipe.h"
#include "common/cockpitpipetransport.h"
#include "common/cockpittemplate.h"
#include "common/cockpithex.h"

#include <stdlib.h>
#include <string.h>
#include <stdio.h>

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

struct _CockpitRouter {
  GObjectClass parent;

  gboolean privileged;
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

  /* Superuser */
  RouterRule *superuser_rule;
  CockpitTransport *superuser_transport;

  gboolean superuser_dbus_inited;
  GDBusMethodInvocation *superuser_start_invocation;
  GDBusMethodInvocation *superuser_stop_invocation;

  gboolean superuser_init_in_progress;
  gboolean superuser_legacy_init;

  CockpitRouterPromptAnswerFunction *superuser_answer_function;
  gpointer superuser_answer_data;
};

typedef struct _CockpitRouterClass {
  GObjectClass parent_class;
} CockpitRouterClass;

G_DEFINE_TYPE (CockpitRouter, cockpit_router, G_TYPE_OBJECT);

enum {
  PROP_0,
  PROP_TRANSPORT,
};

static void superuser_init (CockpitRouter *self, JsonObject *options);
static void superuser_legacy_init (CockpitRouter *self);
static void superuser_transport_closed (CockpitRouter *self);

typedef struct {
  JsonObject *config;
  GHashTable *peers;
} DynamicPeer;

static DynamicPeer *
dynamic_peer_create (JsonObject *config)
{
  DynamicPeer *p = g_new0 (DynamicPeer, 1);

  p->peers = g_hash_table_new_full (json_object_hash, json_object_equal,
                                    (GDestroyNotify) json_object_unref,
                                    g_object_unref);
  p->config = json_object_ref (config);

  return p;
}

static void
dynamic_peer_free (gpointer data)
{
  DynamicPeer *p = data;
  json_object_unref (p->config);
  g_hash_table_unref (p->peers);
  g_free (p);
}

static void
router_rule_compile (RouterRule *rule,
                     JsonObject *object)
{
  RouterMatch *match;
  GList *names, *l;
  JsonNode *node;
  gint i;

  g_assert (rule->matches == NULL);

  if (object == NULL)
    return;

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

  if (rule->matches == NULL)
    return FALSE;

  for (i = 0; rule->matches[i].name != NULL; i++)
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
  gboolean privileged;
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
  if (rule->config && cockpit_json_get_bool (rule->config, "privileged", FALSE, &privileged) && privileged)
    g_print ("  privileged\n");
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

      JsonNode *superuser_options = json_object_get_member (options, "superuser");
      if (superuser_options)
        {
          if (JSON_NODE_HOLDS_OBJECT (superuser_options))
            superuser_init (self, json_node_get_object (superuser_options));
        }
      else
        superuser_legacy_init (self);
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
  const gchar *shareable = NULL;
  const gchar *user = NULL;
  gboolean needs_private = FALSE;

  if (!cockpit_json_get_string (options, "session", NULL, &shareable))
    shareable = NULL;

  if (!cockpit_json_get_string (options, "user", NULL, &user))
    user = NULL;

  if (!shareable)
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

static gboolean
process_open_dynamic_peer (CockpitRouter *self,
                           const gchar *channel,
                           JsonObject *options,
                           GBytes *data,
                           gpointer user_data)
{
  DynamicPeer *dp = user_data;

  g_autoptr(JsonObject) config = cockpit_template_expand_json (dp->config, "${", "}",
                                                               substitute_json_string, options);

  CockpitPeer *peer = g_hash_table_lookup (dp->peers, config);
  if (!peer)
    {
      peer = g_object_new (COCKPIT_TYPE_PEER,
                           "transport", self->transport,
                           "router", self,
                           "config", config,
                           NULL);

      g_hash_table_insert (dp->peers, json_object_ref (config), peer);
    }

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
process_open_access_denied (CockpitRouter *self,
                            const gchar *channel)
{
  GBytes *control = cockpit_transport_build_control ("command", "close",
                                                     "channel", channel,
                                                     "problem", "access-denied",
                                                     NULL);
  cockpit_transport_send (self->transport, NULL, control);
  g_bytes_unref (control);
}

static void superuser_notify_property (CockpitRouter *self, const gchar *prop);

static gboolean
process_open_superuser (CockpitRouter *self,
                        CockpitTransport *transport,
                        const gchar *channel,
                        JsonObject *options,
                        GBytes *data)
{
  const gchar *host = NULL;
  const gchar *superuser_string;

  /* If we are already privileged, let the normal rules handle everything.
   */
  if (self->privileged)
    return FALSE;

  /* Remote superuser is not handled here.
   */
  if (cockpit_json_get_string (options, "host", NULL, &host) && host)
    return FALSE;

  if (!cockpit_json_get_string (options, "superuser", NULL, &superuser_string))
    {
      gboolean superuser_boolean;
      if (!cockpit_json_get_bool (options, "superuser", FALSE, &superuser_boolean))
        superuser_boolean = FALSE;
      superuser_string = superuser_boolean ? "require" : NULL;
    }

  if (superuser_string == NULL)
    return FALSE;

  if (!g_str_equal (superuser_string, "require") && self->superuser_rule == NULL)
    return FALSE;

  if (self->superuser_rule == NULL)
    process_open_access_denied (self, channel);
  else
    {
      GBytes *new_payload = cockpit_json_write_bytes (options);
      router_rule_invoke (self->superuser_rule, self, channel, options, new_payload);
      g_bytes_unref (new_payload);
    }

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

  else if (process_open_superuser (self, transport, channel, options, data))
    {
      /* all done above */
    }

  /* Now go through the rules */
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
  const gchar *auth_cookie;
  const gchar *auth_response;

  if (g_str_equal (command, "authorize")
      && cockpit_json_get_string (options, "cookie", NULL, &auth_cookie)
      && g_str_equal (auth_cookie, "super1")
      && cockpit_json_get_string (options, "response", NULL, &auth_response)
      && self->superuser_answer_function)
    {
      self->superuser_answer_function (auth_response, self->superuser_answer_data);
      self->superuser_answer_function = NULL;
      self->superuser_answer_data = NULL;
      return TRUE;
    }

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
  JsonObject *match = json_object_new ();

  /* Owns the channels */
  self->channels = g_hash_table_new_full (g_str_hash, g_str_equal, NULL, object_unref_if_not_null);
  self->groups = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, g_free);
  self->fences = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, NULL);

  /* The rules, including a default */
  rule = g_new0 (RouterRule, 1);
  rule->callback = process_open_not_supported;
  router_rule_compile (rule, match);

  self->rules = g_list_prepend (self->rules, rule);
  json_object_unref (match);
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
  self->privileged = (geteuid() == 0);
}

static void
cockpit_router_class_init (CockpitRouterClass *class)
{
  GObjectClass *object_class;

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
  g_return_if_fail (config && json_object_is_immutable (config));

  /* Actual descriptive warning displayed elsewhere */
  if (!cockpit_json_get_object (config, "match", NULL, &match))
    match = NULL;

  /* See if we have any variables in the JSON */
  bytes = cockpit_json_write_bytes (config);
  output = cockpit_template_expand (bytes, "${", "}", substitute_json_string, NULL);
  rule = g_new0 (RouterRule, 1);
  rule->config = json_object_ref (config);

  if (!output->next)
    {
      rule->callback = process_open_peer;
      rule->user_data = g_object_new (COCKPIT_TYPE_PEER,
                                      "transport", self->transport,
                                      "router", self,
                                      "config", config,
                                      NULL);
      rule->destroy = g_object_unref;
    }
  else
    {
      gboolean privileged;

      if (cockpit_json_get_bool (rule->config, "privileged", FALSE, &privileged)
          && privileged)
        {
          g_warning ("privileged bridges can't be dynamic");
          json_object_unref (rule->config);
          g_free (rule);
          goto out;
        }

      rule->callback = process_open_dynamic_peer;
      rule->user_data = dynamic_peer_create (config);
      rule->destroy = dynamic_peer_free;
    }

  router_rule_compile (rule, match);
  self->rules = g_list_prepend (self->rules, rule);

 out:
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
          if (rule == self->superuser_rule)
            superuser_transport_closed (self);

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

/* Superuser rules */

static gchar *
rule_superuser_id (RouterRule *rule)
{
  gboolean privileged;

  if (rule->config
      && cockpit_json_get_bool (rule->config, "privileged", FALSE, &privileged)
      && privileged) {
      /* if bridge has a label, prefer that */
      const gchar *label;
      if (cockpit_json_get_string (rule->config, "label", NULL, &label) && label)
        return g_strdup (label);

      /* else, use program name */
      g_autofree const gchar **spawn = NULL;
      if (cockpit_json_get_strv (rule->config, "spawn", NULL, &spawn) && spawn)
        return g_path_get_basename (spawn[0]);
    }

  return NULL;
}

/* D-Bus interface */

static void
superuser_notify_property (CockpitRouter *self, const gchar *prop)
{
  if (!self->superuser_dbus_inited)
    return;

  GDBusConnection *connection = cockpit_dbus_internal_server ();
  GVariant *signal_value;
  GVariantBuilder builder;

  g_variant_builder_init (&builder, G_VARIANT_TYPE ("as"));
  g_variant_builder_add (&builder, "s", prop);
  signal_value = g_variant_ref_sink (g_variant_new ("(sa{sv}as)", "cockpit.Superuser", NULL, &builder));

  g_dbus_connection_emit_signal (connection,
                                 NULL,
                                 "/superuser",
                                 "org.freedesktop.DBus.Properties",
                                 "PropertiesChanged",
                                 signal_value,
                                 NULL);

  g_variant_unref (signal_value);
}

static void
superuser_start_done (const gchar *error, const gchar *stderr, gpointer user_data)
{
  CockpitRouter *router = user_data;

  if (error)
    {
      const gchar *message;
      if (g_strcmp0 (error, "cancelled") == 0 || stderr == NULL || *stderr == '\0')
        message = error;
      else
        message = stderr;

      router->superuser_rule = NULL;
      g_dbus_method_invocation_return_error (router->superuser_start_invocation, G_DBUS_ERROR, G_DBUS_ERROR_FAILED,
                                             "%s", message);
    }
  else
    g_dbus_method_invocation_return_value (router->superuser_start_invocation, NULL);

  router->superuser_answer_function = NULL;
  router->superuser_answer_data = NULL;
  router->superuser_start_invocation = NULL;
  superuser_notify_property (router, "Current");
  g_object_unref (router);
}

static void
superuser_transport_closed (CockpitRouter *self)
{
  if (self->superuser_stop_invocation)
    g_dbus_method_invocation_return_value (self->superuser_stop_invocation, NULL);
  self->superuser_stop_invocation = NULL;
  self->superuser_rule = NULL;
  self->superuser_transport = NULL;
  superuser_notify_property (self, "Current");
}

static void
on_superuser_transport_closed (CockpitTransport *transport,
                               const gchar *problem,
                               gpointer user_data)
{
  CockpitRouter *router = user_data;

  if (router->superuser_transport == transport)
    superuser_transport_closed (router);
}

static void
superuser_method_call (GDBusConnection *connection,
                       const gchar *sender,
                       const gchar *object_path,
                       const gchar *interface_name,
                       const gchar *method_name,
                       GVariant *parameters,
                       GDBusMethodInvocation *invocation,
                       gpointer user_data)
{
  CockpitRouter *router = user_data;

  if (g_str_equal (method_name, "Start"))
    {
      const gchar *id;

      if (router->superuser_rule)
        {
          g_dbus_method_invocation_return_error (invocation, G_DBUS_ERROR, G_DBUS_ERROR_FAILED,
                                                 "Already started a superuser bridge");
          return;
        }

      g_variant_get (parameters, "(&s)", &id);

      for (GList *l = router->rules; l; l = g_list_next (l))
        {
          g_autofree gchar *rule_id = rule_superuser_id (l->data);
          if (rule_id)
            {
              if (g_str_equal (id, rule_id))
                {
                  router->superuser_start_invocation = invocation;
                  router->superuser_rule = l->data;
                  cockpit_peer_reset (router->superuser_rule->user_data);
                  router->superuser_transport = cockpit_peer_ensure_with_done (router->superuser_rule->user_data,
                                                                               superuser_start_done,
                                                                               g_object_ref (router));
                  if (router->superuser_transport)
                      g_signal_connect (router->superuser_transport, "closed",
                                        G_CALLBACK (on_superuser_transport_closed), router);
                  return;
                }
            }
        }

      g_dbus_method_invocation_return_error (invocation, G_DBUS_ERROR, G_DBUS_ERROR_NOT_SUPPORTED,
                                             "No such superuser bridge");
    }
  else if (g_str_equal (method_name, "Stop"))
    {
      if (router->superuser_rule == NULL)
        {
          g_dbus_method_invocation_return_error (invocation, G_DBUS_ERROR, G_DBUS_ERROR_FAILED,
                                                 "No superuser bridge running");
          return;
        }

      router->superuser_stop_invocation = invocation;
      cockpit_transport_close (router->superuser_transport,
                               router->superuser_start_invocation ? "cancelled" : "terminated");
    }
  else if (g_str_equal (method_name, "Answer"))
    {
      const gchar *value;

      if (router->superuser_start_invocation == NULL)
        {
          g_dbus_method_invocation_return_error (invocation, G_DBUS_ERROR, G_DBUS_ERROR_FAILED,
                                                 "No bridge startup going on");
          return;
        }

      g_variant_get (parameters, "(&s)", &value);
      if (router->superuser_answer_function)
        {
          router->superuser_answer_function (value, router->superuser_answer_data);
          router->superuser_answer_function = NULL;
          router->superuser_answer_data = NULL;
        }
      g_dbus_method_invocation_return_value (invocation, NULL);
    }
  else
    g_return_if_reached ();
}

static GVariant *
superuser_get_property (GDBusConnection *connection,
                        const gchar *sender,
                        const gchar *object_path,
                        const gchar *interface_name,
                        const gchar *property_name,
                        GError **error,
                        gpointer user_data)
{
  CockpitRouter *router = user_data;

  g_return_val_if_fail (property_name != NULL, NULL);

  if (g_str_equal (property_name, "Bridges"))
    {
      GVariantBuilder bob;

      g_variant_builder_init (&bob, G_VARIANT_TYPE("as"));
      for (GList *l = router->rules; l; l = g_list_next (l))
        {
          gchar *id = rule_superuser_id (l->data);
          if (id)
            {
              g_variant_builder_add (&bob, "s", id);
              g_free (id);
            }
        }

      return g_variant_new ("as", &bob);
    }
  if (g_str_equal (property_name, "Methods"))
    {
      GVariantBuilder bob;
      GVariant *value;

      g_variant_builder_init (&bob, G_VARIANT_TYPE("a{sv}"));
      for (GList *l = router->rules; l; l = g_list_next (l))
        {
          RouterRule *rule = l->data;
          gchar *id = rule_superuser_id (rule);
          if (id)
            {
              GVariantBuilder config_builder;
              const gchar *label;
              if (cockpit_json_get_string (rule->config, "label", NULL, &label) && label) {
                g_variant_builder_init (&config_builder, G_VARIANT_TYPE("a{sv}"));
                g_variant_builder_add (&config_builder, "{sv}", "label", g_variant_new_string (label));
                g_variant_builder_add (&bob, "{sv}", id, g_variant_builder_end (&config_builder));
              }
              g_free (id);
            }
        }

      value = g_variant_builder_end (&bob);
      if (g_variant_n_children (value) > 0)
        return value;
      else
        {
          g_variant_unref (value);
          return NULL;
        }
    }
  else if (g_str_equal (property_name, "Current"))
    {
      /* The Current property is either the "superuser id" of the
       * current superuser rule, or one of the special values "none",
       * "init", or "root", with the following meaning:
       *
       * "none": No superuser bridge running.
       *
       * "init": Bridge is still initializing and in the process of
       *         starting up a superuser bridge.
       *
       * "root": The whole session is running as root and there is no
       *         separate superuser bridge.
       *
       * The first value after the bridge starts is always one of
       * "none", "init", or "root".  "init" will change later on to a
       * concrete superuser id, or to "none" when starting the
       * superuser bridge has failed.
       *
       * When calling the Stop method, the value will change to "none"
       * at some point before the method call finishes (or remain
       * unchanged when the method call fails).
       *
       * When calling the Start method, the value will change to the
       * concrete superuser id once the superuser bridge is running.
       * During the whole startup it will remain "none", and will only
       * change when the startup was successful.
       *
       * The motivation for having the special "init" value is to give
       * pages enough information to manage their automatic reloading.
       * They want to reload when a superuser bridge is actually
       * started or stopped, but not when the startup during
       * initialization fails.
       */

      if (router->privileged)
        return g_variant_new ("s", "root");
      else if (router->superuser_init_in_progress)
        return g_variant_new ("s", "init");
      else if (router->superuser_rule == NULL
               || router->superuser_start_invocation)
        return g_variant_new ("s", "none");
      else
        return g_variant_new_take_string (rule_superuser_id (router->superuser_rule));
    }
  else
    g_return_val_if_reached (NULL);
}

static GDBusInterfaceVTable superuser_vtable = {
  .method_call = superuser_method_call,
  .get_property = superuser_get_property,
};

static GDBusArgInfo superuser_start_id_arg = {
  -1, "id", "s", NULL
};

static GDBusArgInfo *superuser_start_args[] = {
  &superuser_start_id_arg,
  NULL
};

static GDBusMethodInfo superuser_start_method = {
  -1, "Start", superuser_start_args, NULL, NULL
};

static GDBusMethodInfo superuser_stop_method = {
  -1, "Stop", NULL, NULL, NULL
};

static GDBusArgInfo superuser_answer_value_arg = {
  -1, "value", "s", NULL
};

static GDBusArgInfo *superuser_answer_args[] = {
  &superuser_answer_value_arg,
  NULL
};

static GDBusMethodInfo superuser_answer_method = {
  -1, "Answer", superuser_answer_args, NULL, NULL
};

static GDBusMethodInfo *superuser_methods[] = {
  &superuser_start_method,
  &superuser_stop_method,
  &superuser_answer_method,
  NULL
};

static GDBusPropertyInfo superuser_bridges_property = {
  -1, "Bridges", "as", G_DBUS_PROPERTY_INFO_FLAGS_READABLE, NULL
};

static GDBusPropertyInfo superuser_methods_property = {
  -1, "Methods", "a{sv}", G_DBUS_PROPERTY_INFO_FLAGS_READABLE, NULL
};

static GDBusPropertyInfo superuser_current_property = {
  -1, "Current", "s", G_DBUS_PROPERTY_INFO_FLAGS_READABLE, NULL
};

static GDBusPropertyInfo *superuser_properties[] = {
  &superuser_bridges_property,
  &superuser_methods_property,
  &superuser_current_property,
  NULL
};

static GDBusInterfaceInfo superuser_interface = {
  -1, "cockpit.Superuser",
  superuser_methods,
  NULL, /* signals */
  superuser_properties,
  NULL  /* annotations */
};

void
cockpit_router_dbus_startup (CockpitRouter *router)
{
  GDBusConnection *connection;
  GError *error = NULL;

  connection = cockpit_dbus_internal_server ();
  g_return_if_fail (connection != NULL);

  g_dbus_connection_register_object (connection, "/superuser", &superuser_interface,
                                     &superuser_vtable, router, NULL, &error);

  g_object_unref (connection);

  router->superuser_dbus_inited = TRUE;

  if (error != NULL)
    {
      g_critical ("couldn't register DBus cockpit.Superuser object: %s", error->message);
      g_error_free (error);
      return;
    }
}

/* Superuser init */

static void
superuser_init_done (const gchar *error, const gchar *stderr, gpointer user_data)
{
  CockpitRouter *router = user_data;

  if (error)
    router->superuser_rule = NULL;

  router->superuser_init_in_progress = FALSE;
  superuser_notify_property (router, "Current");

  if (!router->superuser_legacy_init)
    {
      GBytes *request = cockpit_transport_build_control ("command", "superuser-init-done",
                                                         NULL);
      cockpit_transport_send (router->transport, NULL, request);
      g_bytes_unref (request);
    }

  g_object_unref (router);
}

static void
superuser_init_start (CockpitRouter *router,
                      const gchar *id)
{
  router->superuser_init_in_progress = TRUE;

  if (!router->privileged)
    {
      for (GList *l = router->rules; l; l = g_list_next (l))
        {
          g_autofree gchar *rule_id = rule_superuser_id (l->data);
          if (rule_id && (id == NULL || g_str_equal (id, rule_id)))
            {
              router->superuser_rule = l->data;
              cockpit_peer_reset (router->superuser_rule->user_data);
              router->superuser_transport = cockpit_peer_ensure_with_done (router->superuser_rule->user_data,
                                                                           superuser_init_done,
                                                                           g_object_ref (router));
              g_signal_connect (router->superuser_transport, "closed",
                                G_CALLBACK (on_superuser_transport_closed), router);
              return;
            }
        }

      if (id)
        g_warning ("No such superuser bridge: %s", id);
    }

  superuser_init_done (NULL, NULL, g_object_ref (router));
}

static void
superuser_init (CockpitRouter *router,
                JsonObject *options)
{
  const gchar *id;

  if (!cockpit_json_get_string (options, "id", NULL, &id)
      || id == NULL)
    {
      g_warning ("invalid superuser options in \"init\" message");
      superuser_init_done (NULL, NULL, g_object_ref (router));
      return;
    }

  if (g_str_equal (id, "any"))
    id = NULL;

  superuser_init_start (router, id);
}

static void
superuser_legacy_init (CockpitRouter *router)
{
  router->superuser_legacy_init = TRUE;
  superuser_init_start (router, NULL);
}

/* Prompting
 */

void
cockpit_router_prompt (CockpitRouter *self,
                       const gchar *user,
                       const gchar *prompt,
                       const gchar *previous_error,
                       CockpitRouterPromptAnswerFunction *answer,
                       gpointer data)
{
  if (prompt == NULL)
    prompt = "";

  if (previous_error == NULL)
    previous_error = "";

  if (self->superuser_answer_function)
    {
      g_warning ("Overlapping prompts");
      answer (NULL, data);
      return;
    }

  if (self->superuser_start_invocation)
    {
      self->superuser_answer_function = answer;
      self->superuser_answer_data = data;
      g_dbus_connection_emit_signal (cockpit_dbus_internal_server (),
                                     NULL,
                                     "/superuser",
                                     "cockpit.Superuser",
                                     "Prompt",
                                     g_variant_new ("(sssbs)", "", prompt, "", FALSE, previous_error),
                                     NULL);
    }
  else if (self->superuser_init_in_progress)
    {
      self->superuser_answer_function = answer;
      self->superuser_answer_data = data;

      char *user_hex = cockpit_hex_encode (user, -1);
      gchar *challenge = g_strdup_printf ("plain1:%s:", user_hex);
      GBytes *request = cockpit_transport_build_control ("command", "authorize",
                                                         "challenge", challenge,
                                                         "cookie", "super1",
                                                         NULL);
      cockpit_transport_send (self->transport, NULL, request);
      g_bytes_unref (request);
      g_free (challenge);
      free (user_hex);
    }
  else
    {
      g_warning ("Out of context prompt");
      answer (NULL, data);
    }
}

void
cockpit_router_prompt_cancel (CockpitRouter *self,
                              gpointer data)
{
  if (self->superuser_answer_data == data)
    {
      self->superuser_answer_function = NULL;
      self->superuser_answer_data = NULL;
    }
}
