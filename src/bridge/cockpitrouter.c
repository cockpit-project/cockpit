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

#include "cockpitchannel.h"
#include "cockpitpeer.h"
#include "cockpitrouter.h"

#include "common/cockpitjson.h"
#include "common/cockpittransport.h"
#include "common/cockpitpipe.h"
#include "common/cockpitpipetransport.h"

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
  gchar *name;
  GPatternSpec *glob;
  JsonNode *node;
} RouterMatch;

typedef struct {
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

#ifdef WITH_DEBUG
static void
router_rule_dump (RouterRule *rule)
{
  RouterMatch *match;
  gchar *text;
  guint i;

  g_debug ("rule:");
  for (i = 0; rule->matches && rule->matches[i].name != NULL; i++)
    {
      match = &rule->matches[i];
      if (match->node)
        {
          text = cockpit_json_write (match->node, NULL);
          g_debug ("  %s: %s", match->name, text);
          g_free (text);
        }
      else if (match->glob)
        {
          g_debug ("  %s: glob", match->name);
        }
      else
        {
          g_debug ("  %s", match->name);
        }
    }
}
#endif

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
process_open_channel (CockpitRouter *self,
                      const gchar *channel,
                      JsonObject *options,
                      GBytes *data,
                      gpointer user_data)
{
  GType (* type_function) (void) = user_data;
  GType channel_type = 0;
  const gchar *group;

  if (!cockpit_json_get_string (options, "group", NULL, &group))
    g_warning ("%s: caller specified invalid 'group' field in open message", channel);

  g_assert (type_function != NULL);
  channel_type = type_function ();

  if (group && g_str_equal (group, "fence"))
    g_hash_table_add (self->fences, g_strdup (channel));

  if (group)
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
  const gchar *host;
  GList *l;

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

  /* TODO: These will move into actual bridges sections */
  else if (!cockpit_json_get_string (options, "host", self->init_host, &host))
    {
      g_warning ("%s: caller specified invalid 'host' field in open message", channel);
      process_open_not_supported (self, channel, options, data, NULL);
    }
  else if (g_strcmp0 (self->init_host, host) != 0)
    {
      g_message ("%s: this process does not support connecting to another host", channel);
      process_open_not_supported (self, channel, options, data, NULL);
    }

  /* Now go throgh the rules */
  else
    {
      for (l = self->rules; l != NULL; l = g_list_next (l))
        {
          if (router_rule_match (l->data, options) &&
              router_rule_invoke (l->data, self, channel, options, data))
            {
              break;
            }
        }
    }
}

static void
process_kill (CockpitRouter *self,
              JsonObject *options)
{
  CockpitChannel *channel;
  GHashTableIter iter;
  const gchar *group;
  gpointer id, value;
  GList *list, *l;

  if (!cockpit_json_get_string (options, "group", NULL, &group))
    {
      g_warning ("received invalid \"group\" field in kill command");
      return;
    }

  list = NULL;
  if (group)
    g_hash_table_iter_init (&iter, self->groups);
  else
    g_hash_table_iter_init (&iter, self->channels);
  while (g_hash_table_iter_next (&iter, &id, &value))
    {
      if (group && !g_str_equal (group, value))
        continue;
      channel = g_hash_table_lookup (self->channels, id);
      if (channel)
        {
          g_debug ("killing channel: %s", (gchar *)id);
          list = g_list_prepend (list, g_object_ref (channel));
        }
    }

  for (l = list; l != NULL; l = g_list_next (l))
    {
      cockpit_channel_close (l->data, "terminated");
      g_object_unref (l->data);
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
      return TRUE;
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
cockpit_router_dispose (GObject *object)
{
  CockpitRouter *self = COCKPIT_ROUTER (object);
  RouterRule *rule;
  GList *l;
  gint i;

  if (self->signal_id)
    {
      g_signal_handler_disconnect (self->transport, self->signal_id);
      self->signal_id = 0;
    }

  g_hash_table_remove_all (self->channels);
  g_hash_table_remove_all (self->groups);
  g_hash_table_remove_all (self->fences);

  for (l = self->rules; l != NULL; l = g_list_next (l))
    {
      rule = l->data;
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
      g_free (rule);
    }
  g_list_free (self->rules);
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
  CockpitPeer *peer;
  JsonObject *match;
  GList *l;
  guint i;

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

  /* Enumerated in reverse, since the last rule is matched first */
  for (l = g_list_last (bridges); l != NULL; l = g_list_previous (l))
    {
      /* Actual descriptive warning displayed elsewhere */
      if (!cockpit_json_get_object (l->data, "match", NULL, &match))
        match = NULL;

      peer = cockpit_peer_new (transport, l->data);
      cockpit_router_add_bridge (router, match, peer);
      g_object_unref (peer);
    }

#ifdef WITH_DEBUG
  for (l = router->rules; l != NULL; l = g_list_next (l))
    router_rule_dump (l->data);
#endif

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
 * cockpit_router_add_bridge:
 * @self: The router object
 * @match: JSON configuration on what to match
 * @config: The peer bridge config
 *
 * Add a peer bridge to the router for handling channels.
 * The @match JSON object as described in doc/guide/ and
 * matches against "open" messages in order to determine whether
 * to send channels to this peer bridge.
 *
 * The @config is the peer bridge config passed to
 * cockpit_peer_new().
 *
 * Returns: The new peer bridge.
 */
CockpitPeer *
cockpit_router_add_bridge (CockpitRouter *self,
                           JsonObject *match,
                           CockpitPeer *peer)
{
  RouterRule *rule;

  g_return_val_if_fail (COCKPIT_IS_ROUTER (self), NULL);
  g_return_val_if_fail (match != NULL, NULL);
  g_return_val_if_fail (COCKPIT_IS_PEER (peer), NULL);

  rule = g_new0 (RouterRule, 1);
  rule->callback = process_open_peer;
  rule->user_data = g_object_ref (peer);
  rule->destroy = g_object_unref;
  router_rule_compile (rule, match);

  self->rules = g_list_prepend (self->rules, rule);

  return peer;
}
