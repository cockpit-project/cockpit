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
#include "cockpitrouter.h"
#include "cockpitshim.h"

#include "common/cockpitjson.h"
#include "common/cockpittransport.h"
#include "common/cockpitpipe.h"
#include "common/cockpitpipetransport.h"

#include <string.h>

gint cockpit_router_bridge_timeout = 30;

struct _CockpitRouter {
  GObjectClass parent;

  gchar *init_host;
  gulong signal_id;

  CockpitTransport *transport;

  GList *channel_functions;

  GHashTable *payloads;
  GHashTable *channels;
  GHashTable *groups;

  GHashTable *fences;
  guint thawing;

  GHashTable *bridges_by_id;
  GHashTable *bridges_by_transport;
  GHashTable *bridges_by_channel;
};

typedef struct _CockpitRouterClass {
  GObjectClass parent_class;
} CockpitRouterClass;

G_DEFINE_TYPE (CockpitRouter, cockpit_router, G_TYPE_OBJECT);

enum {
  PROP_0,
  PROP_TRANSPORT,
  PROP_INIT_HOST,
};

typedef GType (* TypeFunction) (void);

typedef struct {
  CockpitTransport *transport;
  GHashTable *channels;
  gchar *id;

  gulong closed_sig;
  guint timeout;
} ExternalBridge;

static void
external_bridge_free (gpointer data)
{
  ExternalBridge *b = data;
  if (b->timeout)
    g_source_remove (b->timeout);

  if (b->closed_sig)
    g_signal_handler_disconnect (b->transport, b->closed_sig);

  g_hash_table_destroy (b->channels);
  g_object_unref (b->transport);
  g_free (b->id);
  g_free (b);
}

static void
external_bridge_destroy (CockpitRouter *router,
                         ExternalBridge *bridge)
{
  GHashTableIter iter;
  const gchar *chan;

  g_debug ("destroy bridge: %s", bridge->id);

  g_hash_table_iter_init (&iter, bridge->channels);
  while (g_hash_table_iter_next (&iter, (gpointer *)&chan, NULL))
    g_hash_table_remove (router->bridges_by_channel, chan);
  g_hash_table_remove_all (bridge->channels);

  g_hash_table_remove (router->bridges_by_id, bridge->id);

  /* This owns the bridge */
  g_hash_table_remove (router->bridges_by_transport, bridge->transport);
}

static gboolean
on_timeout_cleanup_bridge (gpointer user_data)
{
  ExternalBridge *b = user_data;

  b->timeout = 0;
  if (g_hash_table_size (b->channels) == 0)
    {
      /*
       * This should cause the transport to immediately be closed
       * and that will trigger removal from the main router lookup tables.
       */
      g_debug ("bridge: (%s) timed out without channels", b->id);
      cockpit_transport_close (b->transport, "timeout");
    }

  return FALSE;
}

static gboolean
on_idle_thaw (gpointer user_data)
{
  CockpitRouter *self = user_data;
  GList *list, *l;

  self->thawing = 0;

  list = g_hash_table_get_values (self->channels);
  for (l = list; l != NULL; l = g_list_next (l))
    cockpit_channel_thaw (l->data);
  g_list_free (list);

  return FALSE;
}

static void
on_channel_closed (CockpitChannel *channel,
                   const gchar *problem,
                   gpointer user_data)
{
  CockpitRouter *self = user_data;
  ExternalBridge *bridge = NULL;
  const gchar *id;

  id = cockpit_channel_get_id (channel);
  g_hash_table_remove (self->channels, id);
  g_hash_table_remove (self->groups, id);

  bridge = g_hash_table_lookup (self->bridges_by_channel, id);
  if (bridge)
    {
      g_hash_table_remove (self->bridges_by_channel, id);
      g_hash_table_remove (bridge->channels, id);
      if (g_hash_table_size (bridge->channels) == 0)
        {
          /*
           * Close sessions that are no longer in use after N seconds
           * of them being that way.
           */
          g_debug ("removed last channel %s for bridge %s", id, bridge->id);
          bridge->timeout = g_timeout_add_seconds (cockpit_router_bridge_timeout,
                                                   on_timeout_cleanup_bridge, bridge);
        }
    }

  /*
   * If this was the last channel in the fence group,
   * then resume all other channels as there's no barrier
   * preventing them from functioning.
   */
  if (!self->thawing)
    {
      if (g_hash_table_remove (self->fences, id) && g_hash_table_size (self->fences) == 0)
        self->thawing = g_idle_add_full (G_PRIORITY_HIGH, on_idle_thaw, self, NULL);
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
on_external_transport_closed (CockpitTransport *transport,
                              const gchar *problem,
                              gpointer user_data)
{
  CockpitRouter *self = user_data;
  ExternalBridge *b = NULL;

  b = g_hash_table_lookup (self->bridges_by_transport, transport);
  if (b)
    external_bridge_destroy (self, b);
}

static void
process_open (CockpitRouter *self,
              CockpitTransport *transport,
              const gchar *channel_id,
              JsonObject *options)
{
  CockpitChannel *channel = NULL;
  GType channel_type;
  TypeFunction type_function = NULL;
  CockpitRouterChannelFunc channel_function = NULL;
  GList *l;

  const gchar *payload = NULL;
  const gchar *host = NULL;
  const gchar *group = NULL;
  gboolean frozen;

  if (!channel_id)
    {
      g_warning ("Caller tried to open channel with invalid id");
      cockpit_transport_close (transport, "protocol-error");
    }
  else if (g_hash_table_lookup (self->channels, channel_id))
    {
      g_warning ("%s: caller tried to reuse a channel that's already in use", channel_id);
      cockpit_transport_close (transport, "protocol-error");
    }
  else
    {
      if (!cockpit_json_get_string (options, "host", self->init_host, &host))
        g_warning ("%s: caller specified invalid 'host' field in open message", channel_id);
      else if (g_strcmp0 (self->init_host, host) != 0)
        g_message ("%s: this process does not support connecting to another host", channel_id);
      else if (!cockpit_json_get_string (options, "group", NULL, &group))
        g_warning ("%s: caller specified invalid 'group' field in open message", channel_id);
      else if (!cockpit_json_get_string (options, "payload", NULL, &payload))
        g_warning ("%s: caller specified invalid 'payload' field in open message", channel_id);
      else if (payload == NULL)
        g_warning ("%s: caller didn't provide a 'payload' field in open message", channel_id);

      /* This will close with "not-supported", both bad payload and host get this code */
      channel_type = COCKPIT_TYPE_CHANNEL;
      frozen = g_hash_table_size (self->fences) ? TRUE : FALSE;

      for (l = self->channel_functions; l != NULL; l = g_list_next (l))
        {
          channel_function = l->data;
          channel = channel_function (self, transport, channel_id, options, frozen);
          if (channel)
            break;
        }

      if (payload && !channel)
        {
          type_function = g_hash_table_lookup (self->payloads, payload);
          if (type_function)
            channel_type = type_function ();
          if (channel_type == COCKPIT_TYPE_CHANNEL)
            g_warning ("%s: bridge doesn't support 'payload' of type: %s", channel_id, payload);
        }

      if (!channel)
        {
          channel = g_object_new (channel_type,
                                  "transport", transport,
                                  "id", channel_id,
                                  "options", options,
                                  "frozen", frozen,
                                  NULL);
        }

      g_hash_table_insert (self->channels, g_strdup (channel_id), channel);
      if (group)
        {
          g_hash_table_insert (self->groups, g_strdup (channel_id), g_strdup (group));
          if (g_str_equal (group, "fence"))
            g_hash_table_add (self->fences, g_strdup (channel_id));
        }
      g_signal_connect (channel, "closed", G_CALLBACK (on_channel_closed), self);
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
      if (!group || g_str_equal (group, value))
        {
          channel = g_hash_table_lookup (self->channels, id);
          if (channel)
            {
              g_debug ("killing channel: %s", (gchar *)id);
              list = g_list_prepend (list, g_object_ref (channel));
            }
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
      process_open (self, transport, channel_id, options);
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
cockpit_router_init (CockpitRouter *self)
{
  /* Owns the channels */
  self->channels = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, g_object_unref);
  self->groups = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, g_free);
  self->fences = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, NULL);
  self->payloads = g_hash_table_new_full (g_str_hash, g_str_equal, NULL, NULL);

  /* Owns the ExternalBridge */
  self->bridges_by_transport = g_hash_table_new_full (g_direct_hash, g_direct_equal, NULL, external_bridge_free);
  self->bridges_by_id = g_hash_table_new_full (g_str_hash, g_str_equal, NULL, NULL);
  self->bridges_by_channel = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, NULL);
}

static void
cockpit_router_dispose (GObject *object)
{
  CockpitRouter *self = COCKPIT_ROUTER (object);
  GHashTableIter iter;
  ExternalBridge *b = NULL;

  if (self->signal_id)
    {
      g_signal_handler_disconnect (self->transport, self->signal_id);
      self->signal_id = 0;
    }

  g_hash_table_remove_all (self->channels);
  g_hash_table_remove_all (self->groups);
  g_hash_table_remove_all (self->fences);

  g_hash_table_iter_init (&iter, self->bridges_by_transport);
  while (g_hash_table_iter_next (&iter, NULL, (gpointer *)&b))
    {
      cockpit_transport_close (b->transport, NULL);
    }
}

static void
cockpit_router_finalize (GObject *object)
{
  CockpitRouter *self = COCKPIT_ROUTER (object);

  if (self->transport)
    g_object_unref (self->transport);

  if (self->thawing)
    g_source_remove (self->thawing);

  g_free (self->init_host);
  g_hash_table_destroy (self->channels);
  g_hash_table_destroy (self->payloads);
  g_hash_table_destroy (self->groups);
  g_hash_table_destroy (self->fences);
  g_hash_table_destroy (self->bridges_by_id);
  g_hash_table_destroy (self->bridges_by_channel);
  g_hash_table_destroy (self->bridges_by_transport);
  g_list_free (self->channel_functions);

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
    case PROP_INIT_HOST:
      self->init_host = g_value_dup_string (value);
      break;
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

  g_object_class_install_property (object_class, PROP_INIT_HOST,
                                   g_param_spec_string ("init-host", NULL, NULL, NULL,
                                                         G_PARAM_WRITABLE |
                                                         G_PARAM_CONSTRUCT_ONLY |
                                                         G_PARAM_STATIC_STRINGS));
}

static gboolean
cockpit_router_add_payload (CockpitRouter *self,
                            const gchar *type,
                            TypeFunction channel_function)
{
  return g_hash_table_insert (self->payloads, (gchar *) type,
                              channel_function);
}

void
cockpit_router_add_channel_function (CockpitRouter *self,
                                     CockpitRouterChannelFunc channel_function)
{
  self->channel_functions = g_list_append (self->channel_functions, channel_function);
}

CockpitRouter *
cockpit_router_new (CockpitTransport *transport,
                    CockpitPayloadType *payload_types,
                    const gchar *init_host)
{
  gint i;
  CockpitRouter *router;

  g_return_val_if_fail (transport != NULL, NULL);

  router = g_object_new (COCKPIT_TYPE_ROUTER,
                         "transport", transport,
                         "init-host", init_host,
                         NULL);

  if (payload_types)
    {
      for (i = 0; payload_types[i].name != NULL; i++)
        {
          cockpit_router_add_payload (router, payload_types[i].name,
                                      payload_types[i].function);
        }
    }

  return router;
}

/**
 * cockpit_router_ensure_external_bridge:
 * @self: a Router
 * @channel: Channel this bridge is for
 * @host: Host this bridge is for, used for init message
 * @argv: Arguments to launch a new bridge
 * @env: Custom environment variables to use when launching a new bridge.
 *
 * If no current transport has already been launched matching the
 * given environment a new transport will be created
 * and tracked by this router. Otherwise the existing transport
 * will be returned.
 *
 * Returns: (transfer none): a CockpitTransport instance
 */
CockpitTransport *
cockpit_router_ensure_external_bridge (CockpitRouter *self,
                                       const gchar *channel,
                                       const gchar *host,
                                       const gchar **argv,
                                       const gchar **env)
{
  gchar *id = NULL;
  gchar *args = NULL;
  gchar *envs = NULL;
  gchar *data = NULL;
  GBytes *bytes = NULL;

  CockpitPipe *pipe = NULL;
  ExternalBridge *bridge = NULL;

  args = g_strjoinv ("|", (gchar **) argv);
  if (env)
    envs = g_strjoinv ("|", (gchar **) env);

  id = g_strdup_printf ("CMD=%s|EVN=%s", args, envs);
  bridge = g_hash_table_lookup (self->bridges_by_id, id);
  if (!bridge)
    {
      pipe = cockpit_pipe_spawn ((const gchar**) argv, (const gchar**) env, NULL, 0);

      bridge = g_new0 (ExternalBridge, 1);
      bridge->transport = cockpit_pipe_transport_new (pipe);
      bridge->id = g_strdup (id);
      bridge->channels = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, NULL);
      bridge->closed_sig = g_signal_connect (bridge->transport, "closed",
                                            G_CALLBACK (on_external_transport_closed), self);

      g_hash_table_insert (self->bridges_by_transport, bridge->transport, bridge);
      g_hash_table_insert (self->bridges_by_id, bridge->id, bridge);

      data = g_strdup_printf ("{\"command\":\"init\",\"host\":\"%s\",\"version\":1}",
                              host ? host : self->init_host);
      bytes = g_bytes_new (data, strlen (data));
      cockpit_transport_send (bridge->transport, NULL, bytes);
    }

  if (bridge->timeout)
    {
      g_source_remove (bridge->timeout);
      bridge->timeout = 0;
    }

  g_hash_table_add (bridge->channels, g_strdup (channel));
  g_hash_table_replace (self->bridges_by_channel, g_strdup (channel), bridge);

  g_free (id);
  g_free (args);
  g_free (envs);
  g_free (data);

  if (bytes)
    g_bytes_unref (bytes);

  return bridge->transport;
}
