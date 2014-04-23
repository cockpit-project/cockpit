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
  CockpitPipe parent_instance;
  gchar *name;
};

struct _CockpitPipeTransportClass {
  CockpitPipeClass parent_class;
};

static void cockpit_pipe_transport_iface (CockpitTransportIface *iface);

G_DEFINE_TYPE_WITH_CODE (CockpitPipeTransport, cockpit_pipe_transport, COCKPIT_TYPE_PIPE,
                         G_IMPLEMENT_INTERFACE (COCKPIT_TYPE_TRANSPORT, cockpit_pipe_transport_iface)
);

static void
cockpit_pipe_transport_init (CockpitPipeTransport *self)
{

}

static void
cockpit_pipe_transport_read (CockpitPipe *pipe,
                             GByteArray *input,
                             gboolean end_of_data)
{
  CockpitPipeTransport *self = COCKPIT_PIPE_TRANSPORT (pipe);
  GBytes *message;
  GBytes *payload;
  guint channel;
  guint32 size;

  for (;;)
    {
      if (input->len < sizeof (size))
        {
          if (!end_of_data)
            g_debug ("%s: want more data", self->name);
          break;
        }

      memcpy (&size, input->data, sizeof (size));
      size = GUINT32_FROM_BE (size);
      if (input->len < size + sizeof (size))
        {
          g_debug ("%s: want more data", self->name);
          break;
        }

      message = cockpit_pipe_consume (input, sizeof (size), size);
      payload = cockpit_transport_parse_frame (message, &channel);
      if (payload)
        {
          g_debug ("%s: received a %d byte payload", self->name, (int)size);
          cockpit_transport_emit_recv ((CockpitTransport *)self, channel, payload);
          g_bytes_unref (payload);
        }
      g_bytes_unref (message);
    }

  if (end_of_data)
    {
      /* Received a partial message */
      if (input->len > 0)
        {
          g_warning ("%s: received truncated %d byte frame", self->name, input->len);
          cockpit_pipe_close (pipe, "internal-error");
        }
    }
}

static void
cockpit_pipe_signal_close (CockpitPipe *pipe,
                           const gchar *problem)
{
  CockpitPipeTransport *self = COCKPIT_PIPE_TRANSPORT (pipe);
  GError *error = NULL;
  gint status;

  /* This function is called by the base class when it is closed */
  if (cockpit_pipe_get_pid (pipe, NULL))
    {
      if (problem == NULL)
        {
          status = cockpit_pipe_exit_status (pipe);
          if (WIFSIGNALED (status) && WTERMSIG (status) == SIGTERM)
            problem = "terminated";
          else if (WIFEXITED (status) && WEXITSTATUS (status) == 5)
            problem = "not-authorized";  // wrong password
          else if (WIFEXITED (status) && WEXITSTATUS (status) == 6)
            problem = "unknown-hostkey";
          else if (WIFEXITED (status) && WEXITSTATUS (status) == 127)
            problem = "no-agent";        // cockpit-agent not installed
          else if (WIFEXITED (status) && WEXITSTATUS (status) == 255)
            problem = "terminated";      // ssh failed or got a signal, etc.
          else if (!g_spawn_check_exit_status (status, &error))
            {
              problem = "internal-error";
              g_warning ("%s: agent program failed: %s", self->name, error->message);
              g_error_free (error);
            }
        }
      else if (g_str_equal (problem, "not-found"))
        {
          g_message ("%s: failed to execute agent: not found", self->name);
          problem = "no-agent";
        }
    }

  g_debug ("%s: closed%s%s", self->name,
           problem ? ": " : "", problem ? problem : "");

  cockpit_transport_emit_closed (COCKPIT_TRANSPORT (pipe), problem);
}

static void
cockpit_pipe_transport_constructed (GObject *object)
{
  CockpitPipeTransport *self = COCKPIT_PIPE_TRANSPORT (object);

  G_OBJECT_CLASS (cockpit_pipe_transport_parent_class)->constructed (object);

  g_object_get (self, "name", &self->name, NULL);
}

static void
cockpit_pipe_transport_finalize (GObject *object)
{
  CockpitPipeTransport *self = COCKPIT_PIPE_TRANSPORT (object);

  g_free (self->name);

  G_OBJECT_CLASS (cockpit_pipe_transport_parent_class)->finalize (object);
}

static void
cockpit_pipe_transport_class_init (CockpitPipeTransportClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);
  CockpitPipeClass *pipe_class = COCKPIT_PIPE_CLASS (klass);

  gobject_class->constructed = cockpit_pipe_transport_constructed;
  gobject_class->finalize = cockpit_pipe_transport_finalize;

  pipe_class->read = cockpit_pipe_transport_read;
  pipe_class->close = cockpit_pipe_signal_close;

}

static void
cockpit_pipe_transport_send (CockpitTransport *transport,
                             guint channel,
                             GBytes *payload)
{
  CockpitPipeTransport *self = COCKPIT_PIPE_TRANSPORT (transport);
  CockpitPipe *pipe;
  GBytes *prefix;
  gchar *prefix_str;
  gsize prefix_len;
  guint32 size;

  prefix_str = g_strdup_printf ("xxxx%u\n", channel);
  prefix_len = strlen (prefix_str);

  /* See doc/protocol.md */
  size = GUINT32_TO_BE (g_bytes_get_size (payload) + prefix_len - 4);
  memcpy (prefix_str, &size, 4);

  prefix = g_bytes_new_take (prefix_str, prefix_len);

  pipe = COCKPIT_PIPE (self);
  cockpit_pipe_write (pipe, prefix);
  cockpit_pipe_write (pipe, payload);
  g_bytes_unref (prefix);

  g_debug ("%s: queued %d byte payload", self->name, (int)g_bytes_get_size (payload));
}

static void
cockpit_pipe_transport_close (CockpitTransport *transport,
                              const gchar *problem)
{
  cockpit_pipe_close (COCKPIT_PIPE (transport), problem);
}

static void
cockpit_pipe_transport_iface (CockpitTransportIface *iface)
{
  iface->send = cockpit_pipe_transport_send;
  iface->close = cockpit_pipe_transport_close;
}

/**
 * cockpit_pipe_transport_new:
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
cockpit_pipe_transport_new (const gchar *name,
                            int in_fd,
                            int out_fd)
{
  return g_object_new (COCKPIT_TYPE_PIPE_TRANSPORT,
                       "name", name,
                       "in-fd", in_fd,
                       "out-fd", out_fd,
                       "pid", 0,
                       NULL);
}

/**
 * cockpit_pipe_transport_spawn:
 * @agent: the process to run
 * @user: the user to use
 * @client: for logging, the caller this is being done for
 *
 * Create a new #CockpitPipeTransport for cockpit-agent
 * on the local machine.
 *
 * Returns: (transfer full): the new transport
 */
CockpitTransport *
cockpit_pipe_transport_spawn (const gchar *agent,
                              const gchar *user,
                              const gchar *client)
{
  const gchar *argv_session[] =
    { PACKAGE_LIBEXEC_DIR "/cockpit-session",
      user,
      client,
      agent,
      NULL
    };

  const gchar *argv_local[] = {
      agent,
      NULL,
  };

  gchar login[256];
  const gchar **argv;


  /*
   * If we're already in the right session, then skip cockpit-session.
   * This is used when testing, or running as your own user.
   *
   * This doesn't apply if this code is running as a service, or otherwise
   * unassociated from a terminal, we get a non-zero return value from
   * getlogin_r() in that case.
   */
  if (getlogin_r (login, sizeof (login)) == 0 &&
      g_str_equal (login, user))
    {
      argv = argv_local;
    }
  else
    {
      argv = argv_session;
    }

  return COCKPIT_TRANSPORT (cockpit_pipe_spawn (COCKPIT_TYPE_PIPE_TRANSPORT,
                                                argv, NULL, NULL));
}
