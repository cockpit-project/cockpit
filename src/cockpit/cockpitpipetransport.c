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
  /* This function is called by the base class when it is closed */
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
 * @host: the host to run the process on
 * @port: the ssh port, if another host
 * @agent: the process to run
 * @user: the ssh user to use
 * @password: the ssh password to use
 * @client: for logging, the caller this is being done for
 * @force_remote: force an ssh connection
 * @error: location to return an error
 *
 * Create a new #CockpitPipeTransport for cockpit-agent
 * either locally or on another machine.
 *
 * TODO: There's a lot of logic in this function, and it's not
 * general. Eventually needs refactoring. After libssh is merged
 * this should use cockpit_pipe_spawn() or some variant of it.
 *
 * Returns: (transfer full): the new transport
 */
CockpitTransport *
cockpit_pipe_transport_spawn (const gchar *host,
                              gint port,
                              const gchar *agent,
                              const gchar *user,
                              const gchar *password,
                              const gchar *client,
                              gboolean force_remote,
                              GError **error)
{
  CockpitTransport *transport = NULL;
  int session_stdin = -1;
  int session_stdout = -1;
  gchar pwfd_arg[sizeof(int) * 3];
  gchar port_arg[sizeof(int) * 3];
  gchar login[256];
  int pwpipe[2] = { -1, -1 };
  GPid pid = 0;

  gchar *argv_remote[] =
    { "/usr/bin/sshpass",
      "-d", pwfd_arg,
      "/usr/bin/ssh",
      "-o", "StrictHostKeyChecking=no",
      "-l", (gchar *)user,
      "-p", port_arg,
      (gchar *)host,
      (gchar *)agent,
      NULL
    };

  gchar *argv_session[] =
    { PACKAGE_LIBEXEC_DIR "/cockpit-session",
      (gchar *)user,
      (gchar *)client,
      (gchar *)agent,
      NULL
    };

  gchar *argv_local[] = {
      (gchar *)agent,
      NULL,
  };

  gchar **argv;

  GSpawnFlags flags = G_SPAWN_DO_NOT_REAP_CHILD;

  if (port == 0 && !force_remote &&
      g_strcmp0 (host, "localhost") == 0)
    {
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
    }
  else
    {
      argv = argv_remote;

      if (g_unix_open_pipe (pwpipe, 0, error) < 0)
        goto out;

      /* Pass the out side (by convention) of the pipe to sshpass */
      g_snprintf (pwfd_arg, sizeof (pwfd_arg), "%d", pwpipe[0]);

      flags |= G_SPAWN_LEAVE_DESCRIPTORS_OPEN;

      g_snprintf (port_arg, sizeof (port_arg), "%d", port ? port : 22);
    }

  /*
   * We leave file descriptors open for communication with sshpass. ssh
   * itself will close open file descriptors before proceeding further.
   */

  if (!g_spawn_async_with_pipes (NULL,
                                 argv,
                                 NULL,
                                 flags,
                                 NULL,
                                 NULL,
                                 &pid,
                                 &session_stdin,
                                 &session_stdout,
                                 NULL,
                                 error))
      goto out;

  if (argv == argv_remote)
    {
      FILE *stream;
      gboolean failed;

      close (pwpipe[0]);
      pwpipe[0] = -1;

      /*
       * Yes, doing a blocking write like this assumes inside knowledge of the
       * sshpass tool. We have that inside knowledge (sshpass [driven by ssh]
       * will read the password fd before blocking on stdin or stdout, besides
       * there's a kernel buffer as well) ... And this is temporary until
       * we migrate to libssh.
       */
      stream = fdopen (pwpipe[1], "w");
      if (password)
        fwrite (password, 1, strlen (password), stream);
      fputc ('\n', stream);
      fflush (stream);
      failed = ferror (stream);
      fclose (stream);
      pwpipe[1] = -1;

      if (failed)
        {
          g_set_error_literal (error, G_IO_ERROR, G_IO_ERROR_FAILED,
                               "Couldn't give password to sshpass");
          goto out;
        }
    }

  transport = g_object_new (COCKPIT_TYPE_PIPE_TRANSPORT,
                            "name", host,
                            "in-fd", session_stdout,
                            "out-fd", session_stdin,
                            "pid", pid);
  session_stdin = session_stdout = -1;

out:
  if (pwpipe[0] >= 0)
    close (pwpipe[0]);
  if (pwpipe[1] >= 0)
    close (pwpipe[1]);
  if (session_stdin >= 0)
    close (session_stdin);
  if (session_stdout >= 0)
    close (session_stdout);

  /*
   * In the case of failure, closing all the inputs
   * will make child go away.
   */

  if (!transport && pid)
      g_spawn_close_pid (pid);

  return transport;
}
