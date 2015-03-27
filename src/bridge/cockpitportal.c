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

#include "cockpitportal.h"

#include "common/cockpitjson.h"
#include "common/cockpitpipetransport.h"

#include <sys/wait.h>
#include <string.h>

/**
 * CockpitPortal:
 *
 * Code which sends messages to another cockpit-bridge or helper
 * instance on stdio. For example another bridge run via with
 * elevated privileges.
 */

typedef gboolean (* CockpitPortalFilter) (CockpitPortal *portal,
                                          const gchar *command,
                                          const gchar *channel,
                                          JsonObject *options,
                                          GBytes *bytes);

struct _CockpitPortal {
  GObject parent_instance;

  CockpitPortalFilter filter_func;
  gchar **argv;

  /* Transport talking back to web service */
  CockpitTransport *transport;
  gulong transport_recv_sig;
  gulong transport_control_sig;
  GBytes *last_init;

  /* The other bridge */
  CockpitTransport *other;
  GHashTable *channels;
  gulong other_recv_sig;
  gulong other_control_sig;
  gulong other_closed_sig;
};

struct _CockpitPortalClass {
  GObjectClass parent_class;
};

enum {
    PROP_0,
    PROP_TRANSPORT,
    PROP_FILTER,
    PROP_ARGV
};

G_DEFINE_TYPE (CockpitPortal, cockpit_portal, G_TYPE_OBJECT);

static void
cockpit_portal_init (CockpitPortal *self)
{

}

static gboolean
on_other_recv (CockpitTransport *transport,
               const gchar *channel,
               GBytes *payload,
               gpointer user_data)
{
  CockpitPortal *self = user_data;

  if (channel)
    {
      cockpit_transport_send (self->transport, channel, payload);
      return TRUE;
    }

  return FALSE;
}

static gboolean
on_other_control (CockpitTransport *transport,
                  const char *command,
                  const gchar *channel,
                  JsonObject *options,
                  GBytes *payload,
                  gpointer user_data)
{
  CockpitPortal *self = user_data;

  /* Only forward close and done control messages back out */
  if (g_str_equal (command, "close") ||
      g_str_equal (command, "done"))
    {
      if (self->channels && channel)
        g_hash_table_remove (self->channels, channel);

      g_debug ("portal channel closed: %s", channel);

      cockpit_transport_send (self->transport, NULL, payload);
    }

  return TRUE;
}

static void
close_portal (CockpitPortal *self)
{
  if (self->other)
    {
      g_signal_handler_disconnect (self->other, self->other_recv_sig);
      g_signal_handler_disconnect (self->other, self->other_control_sig);
      g_signal_handler_disconnect (self->other, self->other_closed_sig);
      self->other_recv_sig = self->other_control_sig = self->other_closed_sig = 0;
      g_object_run_dispose (G_OBJECT (self->other));
      g_clear_object (&self->other);
    }
}

static void
send_close_channel (CockpitPortal *self,
                    const gchar *channel_id,
                    const gchar *problem)
{
  JsonObject *object;
  GBytes *bytes;

  g_debug ("sending close for portal channel: %s: %s", channel_id, problem);

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
on_other_closed (CockpitTransport *transport,
                 const gchar *problem,
                 gpointer user_data)
{
  CockpitPortal *self = user_data;
  const gchar *channel_id;
  GHashTable *channels;
  GHashTableIter iter;
  CockpitPipe *pipe;
  gint status;

  pipe = cockpit_pipe_transport_get_pipe (COCKPIT_PIPE_TRANSPORT (self->other));
  status = cockpit_pipe_exit_status (pipe);

  if (status != -1)
    {
      /* These are the problem codes from pkexec. */
      if (WIFEXITED (status))
        {
           if (WEXITSTATUS (status) == 127 || WEXITSTATUS (status) == 126)
             problem = "access-denied";
        }
    }

  if (!problem)
    problem = "disconnected";

  if (g_str_equal (problem, "no-cockpit"))
    problem = "not-supported";

  channels = self->channels;
  self->channels = NULL;
  close_portal (self);

  g_debug ("other bridge closed: %s", problem);

  g_hash_table_iter_init (&iter, channels);
  while (g_hash_table_iter_next (&iter, (gpointer *)&channel_id, NULL))
    send_close_channel (self, channel_id, problem);

  g_hash_table_unref (channels);
}

static void
open_portal (CockpitPortal *self)
{
  CockpitPipe *pipe;
  const gchar *data;

  if (self->other)
    return;

  g_debug ("launching other bridge");

  pipe = cockpit_pipe_spawn ((const gchar **)self->argv, NULL, NULL, COCKPIT_PIPE_FLAGS_NONE);
  self->other = cockpit_pipe_transport_new (pipe);
  g_object_unref (pipe);

  self->other_recv_sig = g_signal_connect (self->other, "recv", G_CALLBACK (on_other_recv), self);
  self->other_control_sig = g_signal_connect (self->other, "control", G_CALLBACK (on_other_control), self);
  self->other_closed_sig = g_signal_connect (self->other, "closed", G_CALLBACK (on_other_closed), self);
  self->channels = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, NULL);

  if (!self->last_init)
    {
      data = "{\"command\":\"init\",\"version\":1}";
      self->last_init = g_bytes_new_static (data, strlen (data));
    }

  cockpit_transport_send (self->other, NULL, self->last_init);
}

static gboolean
on_transport_control (CockpitTransport *transport,
                      const char *command,
                      const gchar *channel,
                      JsonObject *options,
                      GBytes *payload,
                      gpointer user_data)
{
  CockpitPortal *self = user_data;

  if (g_str_equal (command, "init"))
    {
      if (self->last_init)
        g_bytes_unref (self->last_init);
      self->last_init = g_bytes_ref (payload);
      return FALSE;
    }

   if (channel)
     {
       if (self->channels && g_hash_table_lookup (self->channels, channel))
         {
           cockpit_transport_send (self->other, NULL, payload);
           return TRUE;
         }
     }

  g_assert (self->filter_func);
  return self->filter_func (self, command, channel, options, payload);
}

static gboolean
on_transport_recv (CockpitTransport *transport,
                   const gchar *channel,
                   GBytes *payload,
                   gpointer user_data)
{
  CockpitPortal *self = user_data;

  if (channel && self->channels && g_hash_table_lookup (self->channels, channel))
    {
      cockpit_transport_send (self->other, channel, payload);
      return TRUE;
    }

  return FALSE;
}

static void
cockpit_portal_constructed (GObject *object)
{
  CockpitPortal *self = COCKPIT_PORTAL (object);

  G_OBJECT_CLASS (cockpit_portal_parent_class)->constructed (object);

  g_return_if_fail (self->argv != NULL);
  g_return_if_fail (self->transport != NULL);
  g_return_if_fail (self->filter_func != NULL);

  self->transport_recv_sig = g_signal_connect (self->transport, "recv", G_CALLBACK (on_transport_recv), self);
  self->transport_control_sig = g_signal_connect (self->transport, "control", G_CALLBACK (on_transport_control), self);
}

static void
cockpit_portal_get_property (GObject *object,
                             guint prop_id,
                             GValue *value,
                             GParamSpec *pspec)
{
  CockpitPortal *self = COCKPIT_PORTAL (object);

  switch (prop_id)
    {
    case PROP_TRANSPORT:
      g_value_set_object (value, self->transport);
      break;
    case PROP_FILTER:
      g_value_set_pointer (value, self->filter_func);
      break;
    case PROP_ARGV:
      g_value_set_boxed (value, self->argv);
      break;
    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
cockpit_portal_set_property (GObject *object,
                             guint prop_id,
                             const GValue *value,
                             GParamSpec *pspec)
{
  CockpitPortal *self = COCKPIT_PORTAL (object);

  switch (prop_id)
    {
    case PROP_TRANSPORT:
      self->transport = g_value_dup_object (value);
      break;
    case PROP_FILTER:
      self->filter_func = g_value_get_pointer (value);
      break;
    case PROP_ARGV:
      self->argv = g_value_dup_boxed (value);
      break;
    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
cockpit_portal_finalize (GObject *object)
{
  CockpitPortal *self = COCKPIT_PORTAL (object);

  close_portal (self);

  if (self->transport)
    {
      g_signal_handler_disconnect (self->transport, self->transport_recv_sig);
      g_signal_handler_disconnect (self->transport, self->transport_control_sig);
      g_object_unref (self->transport);
    }

  g_strfreev (self->argv);
  if (self->channels)
    g_hash_table_unref (self->channels);
  if (self->last_init)
    g_bytes_unref (self->last_init);

  G_OBJECT_CLASS (cockpit_portal_parent_class)->finalize (object);
}

static void
cockpit_portal_class_init (CockpitPortalClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);

  gobject_class->constructed = cockpit_portal_constructed;
  gobject_class->get_property = cockpit_portal_get_property;
  gobject_class->set_property = cockpit_portal_set_property;
  gobject_class->finalize = cockpit_portal_finalize;

  g_object_class_install_property (gobject_class, PROP_TRANSPORT,
              g_param_spec_object ("transport", NULL, NULL, COCKPIT_TYPE_TRANSPORT,
                                   G_PARAM_READWRITE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));

  g_object_class_install_property (gobject_class, PROP_FILTER,
              g_param_spec_pointer ("filter", NULL, NULL,
                                   G_PARAM_READWRITE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));

  g_object_class_install_property (gobject_class, PROP_ARGV,
              g_param_spec_boxed ("argv", NULL, NULL, G_TYPE_STRV,
                                   G_PARAM_READWRITE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));
}

static gboolean
superuser_filter (CockpitPortal *self,
                  const gchar *command,
                  const gchar *channel,
                  JsonObject *options,
                  GBytes *payload)
{
  gboolean privileged;

  if (g_str_equal (command, "logout"))
    {
      g_debug ("got logout at super proxy");
      close_portal (self);
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

      open_portal (self);
      g_debug ("super channel open: %s", channel);

      g_hash_table_add (self->channels, g_strdup (channel));
      cockpit_transport_send (self->other, NULL, payload);
      return TRUE;
    }

  return FALSE;
}

/**
 * cockpit_portal_new_superuser
 * @transport: the transport to send data over
 *
 * Create a new CockpitPortal to a privileged bridge
 *
 * Returns: (transfer full): the new transport
 */
CockpitPortal *
cockpit_portal_new_superuser (CockpitTransport *transport)
{
  const gchar *argv[] = {
    PATH_PKEXEC,
    "--disable-internal-agent",
    "cockpit-bridge",
    NULL
  };

  return g_object_new (COCKPIT_TYPE_PORTAL,
                       "transport", transport,
                       "filter", superuser_filter,
                       "argv", argv,
                       NULL);
}

static gboolean
pcp_filter (CockpitPortal *self,
            const gchar *command,
            const gchar *channel,
            JsonObject *options,
            GBytes *payload)
{
  const gchar *type;
  const gchar *source;

  if (g_str_equal (command, "open") && channel)
    {
      if (!cockpit_json_get_string (options, "payload", NULL, &type))
        type = NULL;
      if (!cockpit_json_get_string (options, "source", NULL, &source))
        source = NULL;

      if (g_strcmp0 (type, "metrics1") != 0 ||
          g_strcmp0 (source, "internal") == 0)
        {
          return FALSE;
        }

      open_portal (self);
      g_debug ("pcp portal channel: %s", channel);

      g_hash_table_add (self->channels, g_strdup (channel));
      cockpit_transport_send (self->other, NULL, payload);
      return TRUE;
    }

  return FALSE;
}

/**
 * cockpit_portal_new_pcp
 * @transport: the transport to send data over
 *
 * Create a new CockpitPortal to PCP code out of process
 *
 * Returns: (transfer full): the new transport
 */
CockpitPortal *
cockpit_portal_new_pcp (CockpitTransport *transport)
{
  const gchar *argv[] = {
    PACKAGE_LIBEXEC_DIR "/cockpit-pcp",
    NULL
  };

  return g_object_new (COCKPIT_TYPE_PORTAL,
                       "transport", transport,
                       "filter", pcp_filter,
                       "argv", argv,
                       NULL);
}
