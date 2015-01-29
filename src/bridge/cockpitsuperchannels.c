/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2014 Red Hat, Inc.
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

#include "cockpitsuperchannels.h"

#include "common/cockpitjson.h"
#include "common/cockpitpipetransport.h"

#include <sys/wait.h>

/**
 * CockpitSuperChannels:
 *
 * Code which interacts with a superuser privileged cockpit-bridge
 * and runs certain channels on that.
 */

struct _CockpitSuperChannels {
  GObject parent_instance;

  /* Transport talking back to web service */
  CockpitTransport *transport;
  gulong transport_recv_sig;
  gulong transport_control_sig;
  GBytes *last_init;

  /* The other superuser privileged bridge */
  CockpitTransport *super;
  GHashTable *channels;
  gulong super_recv_sig;
  gulong super_control_sig;
  gulong super_closed_sig;
};

struct _CockpitSuperChannelsClass {
  GObjectClass parent_class;
};

enum {
    PROP_0,
    PROP_TRANSPORT
};

G_DEFINE_TYPE (CockpitSuperChannels, cockpit_super_channels, G_TYPE_OBJECT);

static void
cockpit_super_channels_init (CockpitSuperChannels *self)
{

}

static gboolean
on_super_recv (CockpitTransport *transport,
               const gchar *channel,
               GBytes *payload,
               gpointer user_data)
{
  CockpitSuperChannels *self = user_data;

  if (channel)
    {
      cockpit_transport_send (self->transport, channel, payload);
      return TRUE;
    }

  return FALSE;
}

static gboolean
on_super_control (CockpitTransport *transport,
                  const char *command,
                  const gchar *channel,
                  JsonObject *options,
                  GBytes *payload,
                  gpointer user_data)
{
  CockpitSuperChannels *self = user_data;

  /* Only forward close control messages back out */
  if (g_str_equal (command, "close"))
    {
      if (self->channels && channel)
        g_hash_table_remove (self->channels, channel);

      g_debug ("super channel closed: %s", channel);

      cockpit_transport_send (self->transport, NULL, payload);
    }

  return TRUE;
}

static void
dispose_super (CockpitSuperChannels *self)
{
  if (self->super)
    {
      g_signal_handler_disconnect (self->super, self->super_recv_sig);
      g_signal_handler_disconnect (self->super, self->super_control_sig);
      g_signal_handler_disconnect (self->super, self->super_closed_sig);
      g_object_run_dispose (G_OBJECT (self->super));
      g_clear_object (&self->super);
      self->super_recv_sig = self->super_control_sig = self->super_closed_sig = 0;
    }
}

static void
send_close_channel (CockpitSuperChannels *self,
                    const gchar *channel_id,
                    const gchar *problem)
{
  JsonObject *object;
  GBytes *bytes;

  g_debug ("sending close for super channel: %s: %s", channel_id, problem);

  object = json_object_new ();
  json_object_set_string_member (object, "command", "close");
  json_object_set_string_member (object, "channel", channel_id);
  if (problem)
    json_object_set_string_member (object, "problem", problem);

  bytes = cockpit_json_write_bytes (object);
  json_object_unref (object);

  cockpit_transport_send (self->transport, NULL, bytes);
  g_bytes_unref (bytes);
}

static void
on_super_closed (CockpitTransport *transport,
                 const gchar *problem,
                 gpointer user_data)
{
  CockpitSuperChannels *self = user_data;
  const gchar *channel_id;
  GHashTable *channels;
  GHashTableIter iter;
  CockpitPipe *pipe;
  gint status;

  pipe = cockpit_pipe_transport_get_pipe (COCKPIT_PIPE_TRANSPORT (self->super));
  status = cockpit_pipe_exit_status (pipe);

  if (status != -1)
    {
      /* These are the problem codes from pkexec. */
      if (WIFEXITED (status))
        {
           if (WEXITSTATUS (status) == 127 || WEXITSTATUS (status) == 126)
             problem = "not-authorized";
        }
    }

  if (!problem)
    problem = "disconnected";

  channels = self->channels;
  self->channels = NULL;
  dispose_super (self);

  g_debug ("super bridge closed: %s", problem);

  g_hash_table_iter_init (&iter, channels);
  while (g_hash_table_iter_next (&iter, (gpointer *)&channel_id, NULL))
    send_close_channel (self, channel_id, problem);

  g_hash_table_unref (channels);
}

static void
ensure_super_transport (CockpitSuperChannels *self)
{
  CockpitPipe *pipe;

  const gchar *argv[] = {
    PATH_PKEXEC,
    "--disable-internal-agent",
    "cockpit-bridge",
    NULL
  };

  if (self->super)
    return;

  g_debug ("launching super bridge");

  pipe = cockpit_pipe_spawn (argv, NULL, NULL, COCKPIT_PIPE_FLAGS_NONE);
  self->super = cockpit_pipe_transport_new (pipe);
  g_object_unref (pipe);

  self->super_recv_sig = g_signal_connect (self->super, "recv", G_CALLBACK (on_super_recv), self);
  self->super_control_sig = g_signal_connect (self->super, "control", G_CALLBACK (on_super_control), self);
  self->super_closed_sig = g_signal_connect (self->super, "closed", G_CALLBACK (on_super_closed), self);
  self->channels = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, NULL);

  if (self->last_init)
    cockpit_transport_send (self->super, NULL, self->last_init);
}

static gboolean
on_transport_control (CockpitTransport *transport,
                      const char *command,
                      const gchar *channel,
                      JsonObject *options,
                      GBytes *payload,
                      gpointer user_data)
{
  CockpitSuperChannels *self = user_data;
  gboolean privileged;

  if (g_str_equal (command, "init"))
    {
      if (self->last_init)
        g_bytes_unref (self->last_init);
      self->last_init = g_bytes_ref (payload);
      return FALSE;
    }

  if (g_str_equal (command, "logout"))
    {
      g_debug ("got logout at super proxy");
      dispose_super (self);
      return TRUE;
    }

  if (g_str_equal (command, "open") && channel)
    {
      if (!cockpit_json_get_bool (options, "superuser", FALSE, &privileged))
        {
          g_warning ("invalid value for \"superuser\" channel open option");
          send_close_channel (self, channel, "protocol-error");
          return TRUE;
        }

      if (!privileged)
        return FALSE;

      ensure_super_transport (self);

      g_debug ("super channel open: %s", channel);

      g_hash_table_add (self->channels, g_strdup (channel));
      cockpit_transport_send (self->super, NULL, payload);
      return TRUE;
    }

  if (channel)
    {
      if (self->channels && g_hash_table_lookup (self->channels, channel))
        {
          cockpit_transport_send (self->super, NULL, payload);
          return TRUE;
        }
    }

  return FALSE;
}

static gboolean
on_transport_recv (CockpitTransport *transport,
                   const gchar *channel,
                   GBytes *payload,
                   gpointer user_data)
{
  CockpitSuperChannels *self = user_data;

  if (channel && self->channels && g_hash_table_lookup (self->channels, channel))
    {
      cockpit_transport_send (self->super, channel, payload);
      return TRUE;
    }

  return FALSE;
}

static void
cockpit_super_channels_constructed (GObject *object)
{
  CockpitSuperChannels *self = COCKPIT_SUPER_CHANNELS (object);

  G_OBJECT_CLASS (cockpit_super_channels_parent_class)->constructed (object);

  g_return_if_fail (self->transport != NULL);
  self->transport_recv_sig = g_signal_connect (self->transport, "recv", G_CALLBACK (on_transport_recv), self);
  self->transport_control_sig = g_signal_connect (self->transport, "control", G_CALLBACK (on_transport_control), self);
}

static void
cockpit_super_channels_get_property (GObject *object,
                                     guint prop_id,
                                     GValue *value,
                                     GParamSpec *pspec)
{
  CockpitSuperChannels *self = COCKPIT_SUPER_CHANNELS (object);

  switch (prop_id)
    {
    case PROP_TRANSPORT:
      g_value_set_object (value, self->transport);
      break;
    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
cockpit_super_channels_set_property (GObject *object,
                                     guint prop_id,
                                     const GValue *value,
                                     GParamSpec *pspec)
{
  CockpitSuperChannels *self = COCKPIT_SUPER_CHANNELS (object);

  switch (prop_id)
    {
    case PROP_TRANSPORT:
      self->transport = g_value_dup_object (value);
      break;
    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
cockpit_super_channels_finalize (GObject *object)
{
  CockpitSuperChannels *self = COCKPIT_SUPER_CHANNELS (object);

  dispose_super (self);

  if (self->transport)
    {
      g_signal_handler_disconnect (self->transport, self->transport_recv_sig);
      g_signal_handler_disconnect (self->transport, self->transport_control_sig);
      g_object_unref (self->transport);
    }

  if (self->channels)
    g_hash_table_unref (self->channels);
  if (self->last_init)
    g_bytes_unref (self->last_init);

  G_OBJECT_CLASS (cockpit_super_channels_parent_class)->finalize (object);
}

static void
cockpit_super_channels_class_init (CockpitSuperChannelsClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);

  gobject_class->constructed = cockpit_super_channels_constructed;
  gobject_class->get_property = cockpit_super_channels_get_property;
  gobject_class->set_property = cockpit_super_channels_set_property;
  gobject_class->finalize = cockpit_super_channels_finalize;

  g_object_class_install_property (gobject_class, PROP_TRANSPORT,
              g_param_spec_object ("transport", NULL, NULL, COCKPIT_TYPE_TRANSPORT,
                                   G_PARAM_READWRITE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));
}

/**
 * cockpit_super_channels_new:
 * @transport: the transport to send data over
 *
 * Create a new CockpitSuperChannels
 *
 * Returns: (transfer full): the new transport
 */
CockpitSuperChannels *
cockpit_super_channels_new (CockpitTransport *transport)
{
  return g_object_new (COCKPIT_TYPE_SUPER_CHANNELS,
                       "transport", transport,
                       NULL);
}
