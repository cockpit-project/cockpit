/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
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

#include "common/cockpitjson.h"
#include "common/cockpittransport.h"

#include "cockpitshim.h"
#include "cockpitchannel.h"

#include <sys/wait.h>
#include <string.h>

/**
 * CockpitShim:
 *
 * A channel which relays its messages to another cockpit-bridge
 * or helper on stdio.
 */

#define COCKPIT_SHIM(o)    (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_SHIM, CockpitShim))
#define COCKPIT_IS_SHIM(o)        (G_TYPE_CHECK_INSTANCE_TYPE ((o), COCKPIT_TYPE_SHIM))

typedef struct {
  CockpitChannel parent;

  CockpitTransport *shim_transport;
  gulong shim_recv_sig;
  gulong shim_closed_sig;
  gulong shim_control_sig;

  gboolean sent_close;
} CockpitShim;

typedef struct {
  CockpitChannelClass parent_class;
} CockpitShimClass;

G_DEFINE_TYPE (CockpitShim, cockpit_shim, COCKPIT_TYPE_CHANNEL);

enum {
    PROP_0,
    PROP_SHIM_TRANSPORT,
};

static void
cockpit_shim_init (CockpitShim *self)
{
  self->sent_close = FALSE;
  self->shim_transport = NULL;

}

static void
disconnect_shim (CockpitShim *self)
{
  CockpitTransport *transport;

  transport = self->shim_transport;
  self->shim_transport = NULL;

  if (transport)
    {
      g_signal_handler_disconnect (transport, self->shim_recv_sig);
      g_signal_handler_disconnect (transport, self->shim_control_sig);
      g_signal_handler_disconnect (transport, self->shim_closed_sig);
      self->shim_recv_sig = self->shim_control_sig = self->shim_closed_sig = 0;
      g_object_unref (transport);
    }
}

static void
on_shim_closed (CockpitTransport *transport,
                const gchar *problem,
                gpointer user_data)
{
  CockpitShim *self = user_data;

  if (!problem)
    problem = "disconnected";

  cockpit_channel_close (COCKPIT_CHANNEL (self), problem);
}

static gboolean
on_shim_recv (CockpitTransport *transport,
              const gchar *channel,
              GBytes *payload,
              gpointer user_data)
{
  CockpitShim *self = user_data;
  const gchar *id = cockpit_channel_get_id (COCKPIT_CHANNEL (self));

  if (channel && g_str_equal (channel, id))
    {
      cockpit_channel_send (COCKPIT_CHANNEL (self), payload, TRUE);
      return TRUE;
    }

  return FALSE;
}


static gboolean
on_shim_control (CockpitTransport *transport,
                 const char *command,
                 const gchar *channel,
                 JsonObject *options,
                 GBytes *payload,
                 gpointer user_data)
{
  CockpitShim *self = user_data;
  const gchar *id = cockpit_channel_get_id (COCKPIT_CHANNEL (self));
  const gchar *chan = channel;

  if (!chan && options)
    cockpit_json_get_string (options, "channel", NULL, &chan);

  /* Only forward message that reference this channel */
  if (!chan || g_strcmp0 (chan, id) != 0)
    return FALSE;

  if (g_str_equal (command, "close"))
    {
      self->sent_close = TRUE;
      disconnect_shim (self);
    }

  if (g_str_equal (command, "ready"))
    cockpit_channel_ready (COCKPIT_CHANNEL (self), options);
  else
    cockpit_channel_control (COCKPIT_CHANNEL (self), command, options);

  return TRUE;
}

static void
cockpit_shim_prepare (CockpitChannel *channel)
{
  CockpitShim *self = COCKPIT_SHIM (channel);
  GBytes *bytes = NULL;

  if (!self->shim_transport)
    {
      cockpit_channel_close (channel, "not-supported");
      return;
    }

  bytes = cockpit_json_write_bytes (cockpit_channel_get_options (channel));
  cockpit_transport_send (self->shim_transport, NULL, bytes);
  g_bytes_unref (bytes);
}

static void
cockpit_shim_recv (CockpitChannel *channel,
                   GBytes *message)
{
  CockpitShim *self = COCKPIT_SHIM (channel);
  const gchar *id = cockpit_channel_get_id (channel);

  if (self->shim_transport)
    cockpit_transport_send (self->shim_transport, id, message);
}

static gboolean
cockpit_shim_control (CockpitChannel *channel,
                      const gchar *command,
                      JsonObject *message)
{
  CockpitShim *self = COCKPIT_SHIM (channel);
  GBytes *bytes = NULL;

  if (self->shim_transport)
    {
      bytes = cockpit_json_write_bytes (message);
      cockpit_transport_send (self->shim_transport, NULL, bytes);
    }

  g_bytes_unref (bytes);
  return TRUE;
}

static void
send_close_channel (CockpitShim *self,
                    const gchar *problem)
{
  JsonObject *object;
  GBytes *bytes;
  const gchar *id = cockpit_channel_get_id (COCKPIT_CHANNEL (self));

  g_return_if_fail (self->sent_close == FALSE);
  g_return_if_fail (self->shim_transport != NULL);

  g_debug ("sending close for shim channel: %s: %s", id, problem);

  object = json_object_new ();
  json_object_set_string_member (object, "command", "close");
  json_object_set_string_member (object, "channel", id);
  json_object_set_string_member (object, "problem", problem);

  bytes = cockpit_json_write_bytes (object);
  json_object_unref (object);

  cockpit_transport_send (self->shim_transport, NULL, bytes);
  self->sent_close = TRUE;
  g_bytes_unref (bytes);
}

static void
cockpit_shim_close (CockpitChannel *channel,
                    const gchar *problem)
{
  CockpitShim *self = COCKPIT_SHIM (channel);

  if (!self->sent_close && self->shim_closed_sig)
    {
      send_close_channel (self, problem);
      self->sent_close = TRUE;
    }

  disconnect_shim (self);
  COCKPIT_CHANNEL_CLASS (cockpit_shim_parent_class)->close (channel, problem);
}

static void
cockpit_shim_constructed (GObject *object)
{
  CockpitShim *self = COCKPIT_SHIM (object);

  G_OBJECT_CLASS (cockpit_shim_parent_class)->constructed (object);

  if (self->shim_transport)
    {
      self->shim_closed_sig = g_signal_connect (self->shim_transport, "closed", G_CALLBACK (on_shim_closed), self);
      self->shim_recv_sig = g_signal_connect (self->shim_transport, "recv", G_CALLBACK (on_shim_recv), self);
      self->shim_control_sig = g_signal_connect (self->shim_transport, "control", G_CALLBACK (on_shim_control), self);
    }
}

static void
cockpit_shim_dispose (GObject *object)
{
  disconnect_shim (COCKPIT_SHIM (object));
  G_OBJECT_CLASS (cockpit_shim_parent_class)->dispose (object);
}

static void
cockpit_shim_set_property (GObject *object,
                           guint prop_id,
                           const GValue *value,
                           GParamSpec *pspec)
{
  CockpitShim *self = COCKPIT_SHIM (object);

  switch (prop_id)
    {
    case PROP_SHIM_TRANSPORT:
      self->shim_transport = g_value_dup_object (value);
      break;
    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
cockpit_shim_class_init (CockpitShimClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);
  CockpitChannelClass *channel_class = COCKPIT_CHANNEL_CLASS (klass);

  gobject_class->dispose = cockpit_shim_dispose;
  gobject_class->set_property = cockpit_shim_set_property;
  gobject_class->constructed = cockpit_shim_constructed;

  channel_class->prepare = cockpit_shim_prepare;
  channel_class->recv = cockpit_shim_recv;
  channel_class->control = cockpit_shim_control;
  channel_class->close = cockpit_shim_close;

  /**
   * CockpitShim:shim-transport:
   *
   * The CockpitTransport instance that is connected to the other bridge.
   */
  g_object_class_install_property (gobject_class, PROP_SHIM_TRANSPORT,
                                   g_param_spec_object ("shim-transport", "shim-transport", "shim-transport",
                                                        COCKPIT_TYPE_TRANSPORT,
                                                        G_PARAM_WRITABLE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));
}
