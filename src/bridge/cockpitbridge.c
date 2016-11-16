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
#include "cockpitbridge.h"

#include "common/cockpitjson.h"
#include "common/cockpittransport.h"

struct _CockpitBridge {
  GObjectClass parent;

  gchar *init_host;
  gulong signal_id;

  CockpitTransport *transport;

  GHashTable *payloads;
  GHashTable *channels;
};

struct _CockpitBridgeClass {
  GObjectClass parent_class;
};

G_DEFINE_TYPE (CockpitBridge, cockpit_bridge, G_TYPE_OBJECT);

enum {
  PROP_0,
  PROP_TRANSPORT,
  PROP_INIT_HOST,
};

typedef GType (* TypeFunction) (void);

static void
on_channel_closed (CockpitChannel *channel,
                   const gchar *problem,
                   gpointer user_data)
{
  CockpitBridge *self = user_data;
  g_hash_table_remove (self->channels, cockpit_channel_get_id (channel));
}

static void
process_init (CockpitBridge *self,
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
process_open (CockpitBridge *self,
              CockpitTransport *transport,
              const gchar *channel_id,
              JsonObject *options)
{
  CockpitChannel *channel;
  GType channel_type;
  TypeFunction channel_function = NULL;
  const gchar *payload = NULL;
  const gchar *host = NULL;

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
      else if (!cockpit_json_get_string (options, "payload", NULL, &payload))
        g_warning ("%s: caller specified invalid 'payload' field in open message", channel_id);
      else if (payload == NULL)
        g_warning ("%s: caller didn't provide a 'payload' field in open message", channel_id);

      /* This will close with "not-supported", both bad payload and host get this code */
      channel_type = COCKPIT_TYPE_CHANNEL;

      if (payload)
        {
          channel_function = g_hash_table_lookup (self->payloads, payload);
          if (channel_function)
            channel_type = channel_function ();
          if (channel_type == COCKPIT_TYPE_CHANNEL)
            g_warning ("%s: bridge doesn't support 'payload' of type: %s", channel_id, payload);
        }


      channel = g_object_new (channel_type,
                              "transport", transport,
                              "id", channel_id,
                              "options", options,
                              NULL);

      g_hash_table_insert (self->channels, g_strdup (channel_id), channel);
      g_signal_connect (channel, "closed", G_CALLBACK (on_channel_closed), self);
    }
}

static gboolean
on_transport_control (CockpitTransport *transport,
                      const char *command,
                      const gchar *channel_id,
                      JsonObject *options,
                      GBytes *message,
                      gpointer user_data)
{
  CockpitBridge *self = user_data;

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
  else if (g_str_equal (command, "close"))
    {
      if (!channel_id)
        {
          g_warning ("Caller tried to close channel without an id");
          cockpit_transport_close (transport, "protocol-error");
        }
      else
        {
          /*
           * The channel may no longer exist due to a race of the bridge closing
           * a channel and the web closing it at the same time.
           */

          g_debug ("already closed channel %s", channel_id);
        }
    }

  return FALSE;
}

static void
cockpit_bridge_init (CockpitBridge *self)
{
  /* Owns the channels */
  self->channels = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, g_object_unref);
  self->payloads = g_hash_table_new_full (g_str_hash, g_str_equal, NULL, NULL);
}

static void
cockpit_bridge_dispose (GObject *object)
{
  CockpitBridge *self = COCKPIT_BRIDGE (object);

  if (self->signal_id)
    {
      g_signal_handler_disconnect (self->transport, self->signal_id);
      self->signal_id = 0;
    }
}

static void
cockpit_bridge_finalize (GObject *object)
{
  CockpitBridge *self = COCKPIT_BRIDGE (object);

  if (self->transport)
    g_object_unref (self->transport);

  g_free (self->init_host);
  g_hash_table_destroy (self->channels);
  g_hash_table_destroy (self->payloads);

  G_OBJECT_CLASS (cockpit_bridge_parent_class)->finalize (object);
}

static void
cockpit_bridge_set_property (GObject *obj,
                             guint prop_id,
                             const GValue *value,
                             GParamSpec *pspec)
{
  CockpitBridge *self = COCKPIT_BRIDGE (obj);

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
cockpit_bridge_constructed (GObject *object)
{
  CockpitBridge *self = COCKPIT_BRIDGE (object);

  G_OBJECT_CLASS (cockpit_bridge_parent_class)->constructed (object);

  g_return_if_fail (self->transport != NULL);

  self->signal_id = g_signal_connect (self->transport, "control",
                                      G_CALLBACK (on_transport_control),
                                      self);
}

static void
cockpit_bridge_class_init (CockpitBridgeClass *class)
{
  GObjectClass *object_class;

  object_class = G_OBJECT_CLASS (class);
  object_class->set_property = cockpit_bridge_set_property;
  object_class->finalize = cockpit_bridge_finalize;
  object_class->dispose = cockpit_bridge_dispose;
  object_class->constructed = cockpit_bridge_constructed;

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
cockpit_bridge_add_payload (CockpitBridge *self,
                            const gchar *type,
                            TypeFunction channel_function)
{
  return g_hash_table_insert (self->payloads, (gchar *) type,
                              channel_function);
}

CockpitBridge *
cockpit_bridge_new (CockpitTransport *transport,
                    CockpitPayloadType *payload_types,
                    const gchar *init_host)
{
  gint i;
  CockpitBridge *bridge;

  g_return_val_if_fail (transport != NULL, NULL);

  bridge = g_object_new (COCKPIT_TYPE_BRIDGE,
                         "transport", transport,
                         "init-host", init_host,
                         NULL);

  /* Set a path if nothing is set */
  g_setenv ("PATH", "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", 0);

  for (i = 0; payload_types[i].name != NULL; i++)
    {
      cockpit_bridge_add_payload (bridge, payload_types[i].name,
                                  payload_types[i].function);
    }

  return bridge;
}
