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

typedef struct {
  const gchar *channel;
  CockpitPortalFlags flags;
  GBytes *payload;
} CockpitPortalMessage;

static CockpitPortalMessage *
cockpit_portal_message_new (const gchar *channel,
                            GBytes *payload,
                            CockpitPortalFlags flags)
{
  CockpitPortalMessage *message = g_slice_new (CockpitPortalMessage);
  message->channel = channel; /* channel must have been interned */
  message->payload = g_bytes_ref (payload);
  message->flags = flags;
  return message;
}

static void
cockpit_portal_message_free (gpointer data)
{
  CockpitPortalMessage *message = data;
  g_bytes_unref (message->payload);
  g_slice_free (CockpitPortalMessage, message);
}

enum {
    PORTAL_NONE,
    PORTAL_OPENING,
    PORTAL_OPEN,
    PORTAL_FAILED
};

static void     transition_none      (CockpitPortal *self);
static void     transition_opening   (CockpitPortal *self);
static void     transition_open      (CockpitPortal *self);
static void     transition_failed    (CockpitPortal *self);

struct _CockpitPortal {
  GObject parent_instance;

  /* Portal configuration */
  CockpitPortalFilter filter_func;
  const gchar ***argvs;
  gint argvi;

  /* Transport talking back to web service */
  CockpitTransport *transport;
  gulong transport_recv_sig;
  gulong transport_closed_sig;
  gulong transport_control_sig;
  GBytes *last_init;

  /* The other bridge */
  gint state;
  GQueue *queue;
  gchar *problem;
  GHashTable *interned;
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
    PROP_ARGVS
};

G_DEFINE_TYPE (CockpitPortal, cockpit_portal, G_TYPE_OBJECT);

static void
cockpit_portal_init (CockpitPortal *self)
{

}

static const gchar *
intern_string (CockpitPortal *self,
               const gchar *string)
{
  gchar *ret;

  if (string == NULL)
    return string;

  g_assert (self->interned != NULL);

  ret = g_hash_table_lookup (self->interned, string);
  if (!ret)
    {
      ret = g_strdup (string);
      g_hash_table_add (self->interned, ret);
    }

  return ret;
}

static const gchar **
current_argv (CockpitPortal *self)
{
  const gchar **argv = (const gchar **)(self->argvs[self->argvi]);
  g_assert (argv != NULL);
  g_assert (argv[0] != NULL);
  return argv;
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
      if (self->transport)
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
  if (g_str_equal (command, "init"))
    {
      if (self->state == PORTAL_OPENING)
        transition_open (self);
    }

  /* Only forward close and done control messages back out */
  else if (g_str_equal (command, "close") ||
           g_str_equal (command, "done"))
    {
      if (self->channels && channel)
        g_hash_table_remove (self->channels, channel);

      g_debug ("portal channel closed: %s", channel);

      if (self->transport)
        cockpit_transport_send (self->transport, NULL, payload);
    }

  return TRUE;
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
  json_object_set_string_member (object, "problem", problem);

  bytes = cockpit_json_write_bytes (object);
  json_object_unref (object);

  if (self->transport)
    cockpit_transport_send (self->transport, NULL, bytes);
  g_bytes_unref (bytes);
}

static void
on_other_closed (CockpitTransport *transport,
                 const gchar *problem,
                 gpointer user_data);

static void
disconnect_portal_bridge (CockpitPortal *self)
{
  CockpitTransport *other;

  other = self->other;
  self->other = NULL;

  if (other)
    {
      g_signal_handler_disconnect (other, self->other_recv_sig);
      g_signal_handler_disconnect (other, self->other_control_sig);
      g_signal_handler_disconnect (other, self->other_closed_sig);
      self->other_recv_sig = self->other_control_sig = self->other_closed_sig = 0;
      g_object_run_dispose (G_OBJECT (other));
      g_object_unref (other);
    }
}

static void
spawn_portal_bridge (CockpitPortal *self)
{
  CockpitPipe *pipe;
  const gchar *data;
  const gchar **argv;

  g_assert (self->other == NULL);

  argv = current_argv (self);
  g_debug ("launching portal bridge: %s", argv[0]);

  pipe = cockpit_pipe_spawn (argv, NULL, NULL, COCKPIT_PIPE_FLAGS_NONE);
  self->other = cockpit_pipe_transport_new (pipe);
  g_object_unref (pipe);

  self->other_recv_sig = g_signal_connect (self->other, "recv", G_CALLBACK (on_other_recv), self);
  self->other_control_sig = g_signal_connect (self->other, "control", G_CALLBACK (on_other_control), self);
  self->other_closed_sig = g_signal_connect (self->other, "closed", G_CALLBACK (on_other_closed), self);

  if (!self->last_init)
    {
      data = "{\"command\":\"init\",\"version\":1}";
      self->last_init = g_bytes_new_static (data, strlen (data));
    }

  cockpit_transport_send (self->other, NULL, self->last_init);
}

static void
on_other_closed (CockpitTransport *transport,
                 const gchar *problem,
                 gpointer user_data)
{
  CockpitPortal *self = user_data;
  const gchar **argv;
  CockpitPipe *pipe;
  gint status;

  if (!problem)
    problem = "disconnected";

  if (self->state == PORTAL_OPENING)
    {
      pipe = cockpit_pipe_transport_get_pipe (COCKPIT_PIPE_TRANSPORT (self->other));
      status = cockpit_pipe_exit_status (pipe);

      if (status != -1)
        {
          argv = current_argv (self);

          /* These are the problem codes from pkexec. */
          if (WIFEXITED (status))
            {
              if (g_str_equal (argv[0], PATH_PKEXEC) &&
                  (WEXITSTATUS (status) == 127 || WEXITSTATUS (status) == 126))
                problem = "access-denied";
              else if (g_str_equal (argv[0], PATH_SUDO) && WEXITSTATUS (status) == 1)
                problem = "access-denied";
            }
        }

      g_debug ("other bridge failed: %s", problem);

      if (self->argvs[self->argvi + 1] != NULL &&
          (g_str_equal (problem, "no-cockpit") ||
           g_str_equal (problem, "not-found") ||
           g_str_equal (problem, "access-denied")))
        {
          self->argvi += 1;
          disconnect_portal_bridge (self);
          spawn_portal_bridge (self);
          return;
        }

      if (g_str_equal (problem, "no-cockpit") ||
          g_str_equal (problem, "not-found"))
        problem = "not-supported";

    }
  else
    {
      g_debug ("other bridge closed: %s", problem);
    }

  g_free (self->problem);
  self->problem = g_strdup (problem);

  if (self->state == PORTAL_OPENING)
      transition_failed (self);
  else
      transition_none (self);
}

static gboolean
send_to_portal (CockpitPortal *self,
                const gchar *channel,
                GBytes *payload,
                CockpitPortalFlags flags)
{
  CockpitPortalMessage *message;

  /* What we do here depends on the state */

  switch (self->state)
    {
    case PORTAL_NONE:
      transition_opening (self);
      /* fall through */

    case PORTAL_OPENING:
      if (!self->queue)
        self->queue = g_queue_new ();
      message = cockpit_portal_message_new (intern_string (self, channel), payload, flags);
      g_queue_push_tail (self->queue, message);
      return TRUE;

    case PORTAL_OPEN:
      if (self->transport)
        cockpit_transport_send (self->other, channel, payload);
      return TRUE;

    case PORTAL_FAILED:
      if ((flags & COCKPIT_PORTAL_FALLBACK) == 0)
        {
          if (channel && g_hash_table_contains (self->channels, channel))
            {
              g_hash_table_remove (self->channels, channel);
              send_close_channel (self, channel, self->problem);
            }
          return TRUE;
        }
      return FALSE;
    default:
      g_assert_not_reached ();
    }
}

static void
transition_none (CockpitPortal *self)
{
  GHashTableIter iter;
  GHashTable *channels;
  GHashTable *interned;
  const gchar *channel;
  gchar *problem;
  GQueue *queue;

  self->state = PORTAL_NONE;

  channels = self->channels;
  self->channels = NULL;
  interned = self->interned;
  self->interned = NULL;
  queue = self->queue;
  self->queue = NULL;
  problem = self->problem;
  self->problem = NULL;

  disconnect_portal_bridge (self);

  if (queue)
    g_queue_free_full (queue, cockpit_portal_message_free);

  if (channels)
    {
      g_hash_table_iter_init (&iter, channels);
      while (g_hash_table_iter_next (&iter, (gpointer *)&channel, NULL))
        send_close_channel (self, channel, problem ? problem : "disconnected");
      g_hash_table_unref (channels);
    }

  self->argvi = 0;

  if (interned)
    g_hash_table_unref (interned);
  g_free (problem);
}

static void
transition_opening (CockpitPortal *self)
{
  g_assert (self->state == PORTAL_NONE);

  self->interned = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, NULL);
  self->channels = g_hash_table_new (g_str_hash, g_str_equal);

  self->state = PORTAL_OPENING;
  spawn_portal_bridge (self);
}

static void
flush_queue (CockpitPortal *self)
{
  CockpitPortalMessage *message;
  GQueue *queue;
  queue = self->queue;
  self->queue = NULL;

  if (queue)
    {
      g_debug ("flushing portal queue");

      for (;;)
        {
          message = g_queue_pop_head (queue);
          if (!message)
            break;
          g_assert (self->state != PORTAL_OPENING);
          if (self->transport)
            cockpit_transport_emit_recv (self->transport, message->channel, message->payload);
          cockpit_portal_message_free (message);
        }

      g_queue_free (queue);
    }
}

static void
transition_open (CockpitPortal *self)
{
  g_assert (self->state == PORTAL_OPENING);
  self->state = PORTAL_OPEN;
  flush_queue (self);
}

static void
transition_failed (CockpitPortal *self)
{
  g_assert (self->state == PORTAL_OPENING);
  g_assert (self->problem != NULL);
  self->state = PORTAL_FAILED;
  flush_queue (self);
}

static gboolean
on_transport_control (CockpitTransport *transport,
                      const char *command,
                      const gchar *channel,
                      JsonObject *options,
                      GBytes *payload,
                      gpointer user_data)
{
  CockpitPortalFlags flags = COCKPIT_PORTAL_NORMAL;
  CockpitPortal *self = user_data;
  gboolean relay = FALSE;

  if (g_str_equal (command, "init"))
    {
      if (self->last_init)
        g_bytes_unref (self->last_init);
      self->last_init = g_bytes_ref (payload);
      return FALSE;
    }

   if (channel)
     {
       if (self->channels && g_hash_table_contains (self->channels, channel))
         relay = TRUE;
     }

   if (!relay)
     {
       g_assert (self->filter_func != NULL);
       relay = self->filter_func (self, command, channel, options);
     }

   if (relay)
     {
       if (channel && self->channels)
         flags = GPOINTER_TO_INT (g_hash_table_lookup (self->channels, channel));
       if (self->state == PORTAL_FAILED && !(flags & COCKPIT_PORTAL_FALLBACK))
         {
           if (channel)
             {
               if (self->channels)
                 g_hash_table_remove (self->channels, channel);
               send_close_channel (self, channel, self->problem);
             }
           return TRUE;
         }
       else
         {
           return send_to_portal (self, NULL, payload, flags);
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
  CockpitPortal *self = user_data;
  gpointer flags;

  /*
   * Only channel data is passed from the other bridge back
   * to the web service.
   */

  if (channel && self->channels &&
      g_hash_table_lookup_extended (self->channels, channel, NULL, &flags))
    {
      return send_to_portal (self, channel, payload, GPOINTER_TO_INT (flags));
    }

  return FALSE;
}

static void
on_transport_closed (CockpitTransport *transport,
                     const gchar *problem,
                     gpointer user_data)
{
  CockpitPortal *self = user_data;
  transition_none (self);
}

static void
cockpit_portal_constructed (GObject *object)
{
  CockpitPortal *self = COCKPIT_PORTAL (object);

  G_OBJECT_CLASS (cockpit_portal_parent_class)->constructed (object);

  g_return_if_fail (self->argvs != NULL);
  g_return_if_fail (self->argvs[0] != NULL);
  g_return_if_fail (self->argvs[0][0] != NULL);
  g_return_if_fail (self->transport != NULL);
  g_return_if_fail (self->filter_func != NULL);

  self->transport_recv_sig = g_signal_connect (self->transport, "recv", G_CALLBACK (on_transport_recv), self);
  self->transport_control_sig = g_signal_connect (self->transport, "control", G_CALLBACK (on_transport_control), self);
  self->transport_closed_sig = g_signal_connect (self->transport, "closed", G_CALLBACK (on_transport_closed), self);
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
    case PROP_ARGVS:
      g_value_set_pointer (value, self->argvs);
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
    case PROP_ARGVS:
      self->argvs = g_value_get_pointer (value);
      break;
    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
cockpit_portal_dispose (GObject *object)
{
  CockpitPortal *self = COCKPIT_PORTAL (object);

  transition_none (self);

  if (self->transport)
    {
      g_signal_handler_disconnect (self->transport, self->transport_recv_sig);
      g_signal_handler_disconnect (self->transport, self->transport_control_sig);
      g_signal_handler_disconnect (self->transport, self->transport_closed_sig);
      g_object_unref (self->transport);
      self->transport = NULL;
    }

  G_OBJECT_CLASS (cockpit_portal_parent_class)->dispose (object);
}

static void
cockpit_portal_finalize (GObject *object)
{
  CockpitPortal *self = COCKPIT_PORTAL (object);

  g_assert (self->transport == NULL);
  g_assert (self->channels == NULL);
  g_assert (self->interned == NULL);
  g_assert (self->queue == NULL);
  g_assert (self->other == NULL);

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
  gobject_class->dispose = cockpit_portal_dispose;
  gobject_class->finalize = cockpit_portal_finalize;

  g_object_class_install_property (gobject_class, PROP_TRANSPORT,
              g_param_spec_object ("transport", NULL, NULL, COCKPIT_TYPE_TRANSPORT,
                                   G_PARAM_READWRITE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));

  g_object_class_install_property (gobject_class, PROP_FILTER,
              g_param_spec_pointer ("filter", NULL, NULL,
                                   G_PARAM_READWRITE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));

  g_object_class_install_property (gobject_class, PROP_ARGVS,
              g_param_spec_pointer ("argvs", NULL, NULL,
                                    G_PARAM_READWRITE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));
}

void
cockpit_portal_add_channel (CockpitPortal *self,
                            const gchar *channel,
                            CockpitPortalFlags flags)
{
  g_return_if_fail (COCKPIT_IS_PORTAL (self));
  g_return_if_fail (channel != NULL);

  if (self->state == PORTAL_NONE)
    transition_opening (self);

  g_assert (self->channels != NULL);
  g_hash_table_replace (self->channels,
                        (gchar *)intern_string (self, channel),
                        GINT_TO_POINTER (flags));
}

static gboolean
superuser_filter (CockpitPortal *self,
                  const gchar *command,
                  const gchar *channel,
                  JsonObject *options,
                  GBytes *payload)
{
  CockpitPortalFlags flags = COCKPIT_PORTAL_NORMAL;
  gboolean privileged = FALSE;
  const gchar *superuser;

  if (g_str_equal (command, "logout"))
    {
      g_debug ("got logout at super proxy");
      transition_none (self);
      return FALSE;
    }

  if (g_str_equal (command, "open") && channel)
    {
      if (!cockpit_json_get_bool (options, "superuser", FALSE, &privileged))
        {
          if (!cockpit_json_get_string (options, "superuser", NULL, &superuser))
            {
              g_warning ("invalid value for \"superuser\" channel open option");
              send_close_channel (self, channel, "protocol-error");
              return TRUE;
            }
          else if (g_strcmp0 (superuser, "try") == 0)
            {
              privileged = TRUE;
              flags = COCKPIT_PORTAL_FALLBACK;
            }
          else if (g_strcmp0 (superuser, "require") == 0)
            {
              privileged = TRUE;
            }
          else if (superuser)
            {
              g_warning ("invalid value for \"superuser\" channel open option: %s", superuser);
              send_close_channel (self, channel, "protocol-error");
              return TRUE;
            }
        }

      if (!privileged)
        return FALSE;

      g_debug ("superuser channel open: %s", channel);
      cockpit_portal_add_channel (self, channel, flags);
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
  static const gchar *pkexec_argv[] = {
    PATH_PKEXEC,
    "--disable-internal-agent",
    "cockpit-bridge",
    "--privileged",
    NULL
  };

  static const gchar *sudo_argv[] = {
    PATH_SUDO,
    "-n", /* non-interactive */
    "cockpit-bridge",
    "--privileged",
    NULL
  };


  static const gchar **argvs[] = { pkexec_argv, sudo_argv, NULL };

  return g_object_new (COCKPIT_TYPE_PORTAL,
                       "transport", transport,
                       "filter", superuser_filter,
                       "argvs", argvs,
                       NULL);
}
