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

#include "cockpitpipetransport.h"

#include "cockpitpipe.h"

#include <glib-unix.h>

#include <sys/socket.h>
#include <sys/uio.h>
#include <sys/wait.h>

#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

/**
 * CockpitPipeTransport:
 *
 * A #CockpitTransport implementation that shuttles data over a
 * #CockpitPipe. See doc/protocol.md for information on how the
 * framing looks ... including the MSB length prefix.
 */

struct _CockpitPipeTransport {
  CockpitTransport parent_instance;
  gchar *name;
  CockpitPipe *pipe;
  gboolean closed;
  gulong read_sig;
  gulong close_sig;
};

struct _CockpitPipeTransportClass {
  CockpitTransportClass parent_class;
};

enum {
    PROP_0,
    PROP_NAME,
    PROP_PIPE,
};

G_DEFINE_TYPE (CockpitPipeTransport, cockpit_pipe_transport, COCKPIT_TYPE_TRANSPORT);

static void
cockpit_pipe_transport_init (CockpitPipeTransport *self)
{

}

static void
on_pipe_read (CockpitPipe *pipe,
              GByteArray *input,
              gboolean end_of_data,
              gpointer user_data)
{
  CockpitPipeTransport *self = COCKPIT_PIPE_TRANSPORT (user_data);
  cockpit_transport_read_from_pipe (COCKPIT_TRANSPORT (self), self->name,
                                    pipe, &self->closed, input, end_of_data);
}

static void
on_pipe_close (CockpitPipe *pipe,
               const gchar *problem,
               gpointer user_data)
{
  CockpitPipeTransport *self = COCKPIT_PIPE_TRANSPORT (user_data);
  gboolean is_cockpit;
  GError *error = NULL;
  gint status;

  self->closed = TRUE;

  /* This function is called by the base class when it is closed */
  if (cockpit_pipe_get_pid (pipe, NULL))
    {
      is_cockpit = g_str_equal (self->name, "cockpit-bridge") ||
                   g_str_equal (self->name, "cockpit-session");

      if (problem == NULL ||
          g_str_equal (problem, "internal-error"))
        {
          status = cockpit_pipe_exit_status (pipe);
          if (WIFSIGNALED (status) && WTERMSIG (status) == SIGTERM)
            problem = "terminated";
          else if (is_cockpit && WIFEXITED (status) && WEXITSTATUS (status) == 127)
            problem = "no-cockpit";      // cockpit-bridge not installed
          else if (WIFEXITED (status) && WEXITSTATUS (status) == 255)
            problem = "terminated";      // failed or got a signal, etc.
          else if (!g_spawn_check_exit_status (status, &error))
            {
              problem = "internal-error";
              if (is_cockpit)
                g_warning ("%s: bridge program failed: %s", self->name, error->message);
              else
                g_debug ("%s: process failed: %s", self->name, error->message);
              g_error_free (error);
            }
        }
      else if (g_str_equal (problem, "not-found"))
        {
          if (is_cockpit)
            {
              g_message ("%s: failed to execute bridge: not found", self->name);
              problem = "no-cockpit";
            }
          else
            {
              g_debug ("%s: failed to run: not found", self->name);
            }
        }
    }

  g_debug ("%s: closed%s%s", self->name,
           problem ? ": " : "", problem ? problem : "");

  cockpit_transport_emit_closed (COCKPIT_TRANSPORT (self), problem);
}

static void
cockpit_pipe_transport_constructed (GObject *object)
{
  CockpitPipeTransport *self = COCKPIT_PIPE_TRANSPORT (object);

  G_OBJECT_CLASS (cockpit_pipe_transport_parent_class)->constructed (object);

  g_return_if_fail (self->pipe != NULL);
  g_object_get (self->pipe, "name", &self->name, NULL);
  self->read_sig = g_signal_connect (self->pipe, "read", G_CALLBACK (on_pipe_read), self);
  self->close_sig = g_signal_connect (self->pipe, "close", G_CALLBACK (on_pipe_close), self);
}

static void
cockpit_pipe_transport_get_property (GObject *object,
                                     guint prop_id,
                                     GValue *value,
                                     GParamSpec *pspec)
{
  CockpitPipeTransport *self = COCKPIT_PIPE_TRANSPORT (object);

  switch (prop_id)
    {
    case PROP_NAME:
      g_value_set_string (value, self->name);
      break;
    case PROP_PIPE:
      g_value_set_object (value, cockpit_pipe_transport_get_pipe (self));
      break;
    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
cockpit_pipe_transport_set_property (GObject *object,
                                     guint prop_id,
                                     const GValue *value,
                                     GParamSpec *pspec)
{
  CockpitPipeTransport *self = COCKPIT_PIPE_TRANSPORT (object);

  switch (prop_id)
    {
    case PROP_PIPE:
      self->pipe = g_value_dup_object (value);
      break;
    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
cockpit_pipe_transport_finalize (GObject *object)
{
  CockpitPipeTransport *self = COCKPIT_PIPE_TRANSPORT (object);

  g_signal_handler_disconnect (self->pipe, self->read_sig);
  g_signal_handler_disconnect (self->pipe, self->close_sig);

  g_free (self->name);
  g_clear_object (&self->pipe);

  G_OBJECT_CLASS (cockpit_pipe_transport_parent_class)->finalize (object);
}

static void
cockpit_pipe_transport_send (CockpitTransport *transport,
                             const gchar *channel_id,
                             GBytes *payload)
{
  CockpitPipeTransport *self = COCKPIT_PIPE_TRANSPORT (transport);
  GBytes *prefix;
  gchar *prefix_str;
  gsize payload_len;
  gsize channel_len;

  if (self->closed)
    {
      g_debug ("dropping message on closed transport");
      return;
    }

  channel_len = channel_id ? strlen (channel_id) : 0;
  payload_len = g_bytes_get_size (payload);

  prefix_str = g_strdup_printf ("%" G_GSIZE_FORMAT "\n%s\n",
                                channel_len + 1 + payload_len,
                                channel_id ? channel_id : "");
  prefix = g_bytes_new_take (prefix_str, strlen (prefix_str));

  cockpit_pipe_write (self->pipe, prefix);
  cockpit_pipe_write (self->pipe, payload);
  g_bytes_unref (prefix);

  g_debug ("%s: queued %" G_GSIZE_FORMAT " byte payload", self->name, payload_len);
}

static void
cockpit_pipe_transport_close (CockpitTransport *transport,
                              const gchar *problem)
{
  CockpitPipeTransport *self = COCKPIT_PIPE_TRANSPORT (transport);
  cockpit_pipe_close (self->pipe, problem);
}

static void
cockpit_pipe_transport_class_init (CockpitPipeTransportClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);
  CockpitTransportClass *transport_class = COCKPIT_TRANSPORT_CLASS (klass);

  transport_class->send = cockpit_pipe_transport_send;
  transport_class->close = cockpit_pipe_transport_close;

  gobject_class->constructed = cockpit_pipe_transport_constructed;
  gobject_class->get_property = cockpit_pipe_transport_get_property;
  gobject_class->set_property = cockpit_pipe_transport_set_property;
  gobject_class->finalize = cockpit_pipe_transport_finalize;

  g_object_class_override_property (gobject_class, PROP_NAME, "name");

  g_object_class_install_property (gobject_class, PROP_PIPE,
              g_param_spec_object ("pipe", NULL, NULL,
                                   COCKPIT_TYPE_PIPE,
                                   G_PARAM_READWRITE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));
}

/**
 * cockpit_pipe_transport_new:
 * @pipe: the pipe to send data over
 *
 * Create a new CockpitPipeTransport for a pipe
 *
 * Returns: (transfer full): the new transport
 */
CockpitTransport *
cockpit_pipe_transport_new (CockpitPipe *pipe)
{
  return g_object_new (COCKPIT_TYPE_PIPE_TRANSPORT,
                       "pipe", pipe,
                       NULL);
}

/**
 * cockpit_pipe_transport_new_fds:
 * @name: name for debugging
 * @in_fd: the file descriptor to read from
 * @out_fd: the file descriptor to write to
 *
 * Create a new CockpitPipeTransport for a pair
 * of file descriptors.
 *
 * Returns: (transfer full): the new transport
 */
CockpitTransport *
cockpit_pipe_transport_new_fds (const gchar *name,
                                gint in_fd,
                                gint out_fd)
{
  CockpitTransport *transport;
  CockpitPipe *pipe;

  pipe = cockpit_pipe_new (name, in_fd, out_fd);
  transport = cockpit_pipe_transport_new (pipe);
  g_object_unref (pipe);

  return transport;
}

CockpitPipe *
cockpit_pipe_transport_get_pipe (CockpitPipeTransport *self)
{
  g_return_val_if_fail (COCKPIT_IS_PIPE_TRANSPORT (self), NULL);
  return self->pipe;
}

/**
 * cockpit_transport_read_from_pipe:
 *
 * Meant to be used in a "read" handler for a #CockpitPipe
 * Closed is pointer to a boolean value that may be updated
 * during the read and parse loop.
 */
void
cockpit_transport_read_from_pipe (CockpitTransport *self,
                                  const gchar *logname,
                                  CockpitPipe *pipe,
                                  gboolean *closed,
                                  GByteArray *input,
                                  gboolean end_of_data)
{
  GBytes *message;
  GBytes *payload;
  gchar *channel;
  guint32 i, size;
  gchar *data;

  /* This may be updated during the loop. */
  g_assert (closed != NULL);
  g_object_ref (self);

  while (!*closed)
    {
      size = 0;
      data = (gchar *)input->data;
      for (i = 0; i < input->len; i++)
        {
          /* Check invalid characters, prevent integer overflow, limit max length */
          if (i > 7 || data[i] < '0' || data[i] > '9')
            break;
          size *= 10;
          size += data[i] - '0';
        }

      if (i == input->len)
        {
          if (!end_of_data)
            g_debug ("%s: want more data", logname);
          break;
        }

      if (data[i] != '\n')
        {
          g_warning ("%s: incorrect protocol: received invalid length prefix", logname);
          cockpit_pipe_close (pipe, "protocol-error");
          break;
        }

      if (input->len < i + 1 + size)
        {
          g_debug ("%s: want more data 2", logname);
          break;
        }

      message = cockpit_pipe_consume (input, i + 1, size, 0);
      payload = cockpit_transport_parse_frame (message, &channel);
      if (payload)
        {
          g_debug ("%s: received a %d byte payload", logname, (int)size);
          cockpit_transport_emit_recv (self, channel, payload);
          g_bytes_unref (payload);
          g_free (channel);
        }
      g_bytes_unref (message);
    }

  if (end_of_data)
    {
      /* Received a partial message */
      if (input->len > 0)
        {
          g_debug ("%s: received truncated %d byte frame", logname, input->len);
          cockpit_pipe_close (pipe, "disconnected");
        }
    }

  g_object_unref (self);
}
