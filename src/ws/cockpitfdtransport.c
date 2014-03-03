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

#include "cockpitfdtransport.h"

#include <glib-unix.h>

#include <sys/socket.h>
#include <sys/uio.h>
#include <sys/wait.h>

#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

enum {
  PROP_0,
  PROP_NAME,
  PROP_IN_FD,
  PROP_OUT_FD,
  PROP_PID,
};

typedef struct _Message Message;

struct _Message {
  guint channel;
  GBytes *payload;
  struct _Message *next;
};

struct _CockpitFdTransport {
  GObject parent_instance;

  gchar *name;
  gboolean closing;
  const gchar *problem;

  GPid pid;
  GSource *child;

  GSource *io;
  int out_fd;
  Message *out_first;
  Message *out_last;
  gsize out_partial;
  GPollFD *out_poll;

  int in_fd;
  GByteArray *in_buffer;
  GPollFD *in_poll;
};

struct _CockpitFdTransportClass {
  GObjectClass parent_class;
};

typedef struct {
  GSource source;
  CockpitFdTransport *transport;
} CockpitFdSource;

static void cockpit_fd_transport_iface (CockpitTransportIface *iface);

G_DEFINE_TYPE_WITH_CODE (CockpitFdTransport, cockpit_fd_transport, G_TYPE_OBJECT,
                         G_IMPLEMENT_INTERFACE (COCKPIT_TYPE_TRANSPORT, cockpit_fd_transport_iface)
);

static void
cockpit_fd_transport_init (CockpitFdTransport *self)
{
  self->in_buffer = g_byte_array_new ();
  self->in_fd = -1;

  self->out_fd = -1;
}

static void
close_immediately (CockpitFdTransport *self,
                   const gchar *problem)
{
  GSource *source = self->io;

  g_return_if_fail (self->io != NULL);

  g_debug ("%s: closing io%s%s", self->name,
           problem ? ": " : "",
           problem ? problem : "");

  if (problem)
    self->problem = problem;

  self->io = NULL;

  g_source_destroy (source);
  g_source_unref (source);

  g_free (self->in_poll);
  g_free (self->out_poll);
  self->in_poll = self->out_poll = NULL;

  if (self->in_fd != -1)
    close (self->in_fd);
  if (self->out_fd != -1)
    close (self->out_fd);

  /* If not tracking a pid, then we are now closed. */
  if (!self->child)
    {
      g_debug ("%s: no child process to wait for: closed", self->name);
      cockpit_transport_emit_closed (COCKPIT_TRANSPORT (self), self->problem);
    }
}

static void
close_maybe (CockpitFdTransport *self)
{
  if (self->io)
    {
      if (!self->in_poll && !self->out_poll)
        {
          g_debug ("%s: input and output done", self->name);
          close_immediately (self, NULL);
        }
    }
}

static gboolean
fd_transport_prepare (GSource *source,
                      gint *timeout)
{
  *timeout = -1;
  return FALSE;
}

static inline gboolean
have_events (GPollFD *pfd)
{
  return pfd && (pfd->revents & (pfd->events | G_IO_NVAL | G_IO_ERR));
}

static gboolean
fd_transport_check (GSource *source)
{
  CockpitFdSource *fs = (CockpitFdSource *)source;
  CockpitFdTransport *self = fs->transport;
  return have_events (self->out_poll) || have_events (self->in_poll);
}

static void
transport_dispatch_in (CockpitFdTransport *self)
{
  GBytes *message;
  GBytes *payload;
  guint channel;
  guint32 size;
  guint32 frame;
  guint8 *buf;
  gssize ret;
  gsize len;

  g_debug ("%s: reading input", self->name);

  g_assert (self->in_poll);

  len = self->in_buffer->len;
  g_byte_array_set_size (self->in_buffer, len + 1024);
  ret = read (self->in_fd, self->in_buffer->data + len, 1024);
  if (ret < 0)
    {
      g_byte_array_set_size (self->in_buffer, len);
      if (errno != EAGAIN && errno != EINTR)
        {
          g_warning ("%s: couldn't read: %s", self->name, g_strerror (errno));
          close_immediately (self, "internal-error");
        }
      return;
    }
  else if (ret == 0)
    {
      g_debug ("%s: end of input", self->name);
      g_source_remove_poll (self->io, self->in_poll);
      g_free (self->in_poll);
      self->in_poll = NULL;
    }

  g_byte_array_set_size (self->in_buffer, len + ret);

  for (;;)
    {
      if (self->in_buffer->len < sizeof (size))
        {
          if (self->in_poll)
            g_debug ("%s: waiting for more data", self->name);
          break;
        }

      memcpy (&size, self->in_buffer->data, sizeof (size));
      size = GUINT32_FROM_BE (size);
      frame = size + sizeof (size);
      if (self->in_buffer->len < frame)
        {
          g_debug ("%s: waiting for more data", self->name);
          break;
        }

      /* Optimize when we match full buffer length */
      if (self->in_buffer->len == frame)
        {
          /* When array is reffed, this just clears byte array */
          g_byte_array_ref (self->in_buffer);
          buf = g_byte_array_free (self->in_buffer, FALSE);
          message = g_bytes_new_with_free_func (buf + sizeof (size), size, g_free, buf);
        }
      else
        {
          message = g_bytes_new (self->in_buffer->data + sizeof (size), size);
          g_byte_array_remove_range (self->in_buffer, 0, frame);
        }

      payload = cockpit_transport_parse_frame (message, &channel);
      if (payload)
        {
          g_debug ("%s: received a %d byte payload", self->name, (int)size);
          cockpit_transport_emit_recv ((CockpitTransport *)self, channel, payload);
          g_bytes_unref (payload);
        }

      g_bytes_unref (message);
    }

  if (!self->in_poll)
    {
      /* Received a partial message */
      if (self->in_buffer->len > 0)
        {
          g_warning ("%s: received truncated %d byte frame",
                     self->name, self->in_buffer->len);
          close_immediately (self, "internal-error");
        }
      else
        {
          close_maybe (self);
        }
    }
}

static gssize
offset_iov (struct iovec *iov,
            int count,
            gsize offset)
{
  gsize total = 0;
  int i;

  for (i = 0; i < count; i++)
    {
      if (iov[i].iov_len < offset)
        {
          offset -= iov[i].iov_len;
          iov[i].iov_len = 0;
        }
      else
        {
          iov[i].iov_base = ((gchar *)iov[i].iov_base) + offset;
          iov[i].iov_len -= offset;
          total += iov[i].iov_len;
          offset = 0;
        }
    }

  return total;
}

static void
transport_close_out (CockpitFdTransport *self)
{
  g_debug ("%s: end of output", self->name);

  /* And if closing, then we need to shutdown the output fd */
  if (shutdown (self->out_fd, SHUT_WR) < 0)
    {
      if (errno == ENOTSOCK)
        {
          close (self->out_fd);
          self->out_fd = -1;
        }
      else
        {
          g_warning ("%s: couldn't shutdown fd: %s", self->name, g_strerror (errno));
          close_immediately (self, "internal-error");
        }
    }

  close_maybe (self);
}

static void
transport_dispatch_out (CockpitFdTransport *self)
{
  gchar channel[sizeof(guint) * 3];
  struct iovec iov[4];
  Message *message;
  gsize channel_len;
  guint32 size;
  gssize total;
  gsize len;
  gssize ret;

  g_debug ("%s: writing output", self->name);

  g_assert (self->out_poll);
  message = self->out_first;
  g_assert (message != NULL);

  g_snprintf (channel, sizeof (channel), "%u", message->channel);
  channel_len = strlen (channel);

  len = g_bytes_get_size (message->payload);

  /* See doc/protocol.md */
  size = GUINT32_TO_BE (len + 1 + channel_len);

  iov[0].iov_base = &size;
  iov[0].iov_len = sizeof (size);
  iov[1].iov_base = channel;
  iov[1].iov_len = channel_len;
  iov[2].iov_base = "\n";
  iov[2].iov_len = 1;
  iov[3].iov_base = (void *)g_bytes_get_data (message->payload, NULL);
  iov[3].iov_len = len;

  total = offset_iov (iov, 4, self->out_partial);
  ret = writev (self->out_fd, iov, 4);
  if (ret < 0)
    {
      if (errno != EAGAIN && errno != EINTR)
        {
          g_warning ("%s: couldn't write: %s", self->name, g_strerror (errno));
          close_immediately (self, "internal-error");
        }
      return;
    }

  /* Not all written? */
  if (ret != total)
    {
      g_debug ("%s: partial write %d of %d bytes", self->name, (int)ret, (int)total);
      self->out_partial += ret;
      return;
    }

  /* Done with that queued message */
  self->out_partial = 0;
  self->out_first = self->out_first->next;

  g_bytes_unref (message->payload);
  g_free (message);

  if (self->out_first != NULL)
    return;

  self->out_last = NULL;
  g_debug ("%s: output queue empty", self->name);

  /* If all messages are done, then stop polling out fd */
  g_source_remove_poll (self->io, self->out_poll);
  g_free (self->out_poll);
  self->out_poll = NULL;

  if (!self->closing)
    return;

  transport_close_out (self);
}

static gboolean
fd_transport_dispatch (GSource *source,
                       GSourceFunc callback,
                       gpointer user_data)
{
  CockpitFdSource *fs = (CockpitFdSource *)source;
  CockpitFdTransport *self = fs->transport;

  if (have_events (self->out_poll))
    transport_dispatch_out (self);
  if (have_events (self->in_poll))
    transport_dispatch_in (self);

  return TRUE;
}

static GSourceFuncs source_funcs = {
  fd_transport_prepare,
  fd_transport_check,
  fd_transport_dispatch,
  NULL,
};

static void
on_child_reap (GPid pid,
               gint status,
               gpointer user_data)
{
  CockpitFdTransport *self = COCKPIT_FD_TRANSPORT (user_data);
  const gchar *problem = NULL;
  GError *error = NULL;

  g_debug ("%s: reaping child: %d %d", self->name, (int)pid, status);

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
      g_warning ("session program failed: %s", error->message);
      g_error_free (error);
    }

  if (!self->problem)
    self->problem = problem;

  g_spawn_close_pid (self->pid);
  self->pid = 0;

  /*
   * When a pid is present then this is the definitive way of
   * determining when the process has closed.
   */
  g_debug ("%s: child process quit: closed%s%s",
           self->name, problem ? ": " : "",
           problem ? problem : "");

  cockpit_transport_emit_closed (COCKPIT_TRANSPORT (self), self->problem);
}

static void
cockpit_fd_transport_constructed (GObject *object)
{
  CockpitFdTransport *self = COCKPIT_FD_TRANSPORT (object);
  CockpitFdSource *fs;
  GMainContext *ctx;
  GError *error = NULL;

  G_OBJECT_CLASS (cockpit_fd_transport_parent_class)->constructed (object);

  if (!g_unix_set_fd_nonblocking (self->in_fd, TRUE, &error) ||
      !g_unix_set_fd_nonblocking (self->out_fd, TRUE, &error))
    {
      g_warning ("%s: couldn't set file descriptor to non-blocking: %s",
                 self->name, error->message);
      g_clear_error (&error);
    }

  self->in_poll = g_new0 (GPollFD, 1);
  self->in_poll->fd = self->in_fd;
  self->in_poll->events = G_IO_IN | G_IO_HUP | G_IO_ERR;

  ctx = g_main_context_get_thread_default ();

  self->io = g_source_new (&source_funcs, sizeof (CockpitFdSource));
  fs = (CockpitFdSource *)self->io;
  fs->transport = self;
  g_source_add_poll (self->io, self->in_poll);
  g_source_attach (self->io, ctx);

  if (self->pid)
    {
      self->child = g_child_watch_source_new (self->pid);
      g_source_set_callback (self->child, (GSourceFunc)on_child_reap, self, NULL);
      g_source_attach (self->child, ctx);
    }
}

static void
cockpit_fd_transport_set_property (GObject *obj,
                                   guint prop_id,
                                   const GValue *value,
                                   GParamSpec *pspec)
{
  CockpitFdTransport *self = COCKPIT_FD_TRANSPORT (obj);

  switch (prop_id)
    {
      case PROP_NAME:
        self->name = g_value_dup_string (value);
        break;
      case PROP_IN_FD:
        self->in_fd = g_value_get_int (value);
        g_return_if_fail (self->in_fd >= 0);
        break;
      case PROP_OUT_FD:
        self->out_fd = g_value_get_int (value);
        g_return_if_fail (self->out_fd >= 0);
        break;
      case PROP_PID:
        self->pid = g_value_get_int (value);
        break;
      default:
        G_OBJECT_WARN_INVALID_PROPERTY_ID (obj, prop_id, pspec);
        break;
    }
}

static void
cockpit_fd_transport_get_property (GObject *obj,
                                   guint prop_id,
                                   GValue *value,
                                   GParamSpec *pspec)
{
  CockpitFdTransport *self = COCKPIT_FD_TRANSPORT (obj);

  switch (prop_id)
  {
    case PROP_NAME:
      g_value_set_string (value, self->name);
      break;
    case PROP_IN_FD:
      g_value_set_int (value, self->in_fd);
      break;
    case PROP_OUT_FD:
      g_value_set_int (value, self->out_fd);
      break;
    case PROP_PID:
      g_value_set_int (value, self->pid);
      break;
    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (obj, prop_id, pspec);
      break;
  }
}

static void
cockpit_fd_transport_dispose (GObject *object)
{
  CockpitFdTransport *self = COCKPIT_FD_TRANSPORT (object);
  Message *message;

  if (self->pid)
    {
      g_debug ("%s: killing child: %d", self->name, (int)self->pid);
      kill (self->pid, SIGTERM);
      g_spawn_close_pid (self->pid);
      self->pid = 0;
    }

  if (self->io)
    close_immediately (self, "terminated");

  while (self->out_first)
    {
      message = self->out_first;
      self->out_first = message->next;
      g_bytes_unref (message->payload);
      g_free (message);
    }

  G_OBJECT_CLASS (cockpit_fd_transport_parent_class)->dispose (object);
}

static void
cockpit_fd_transport_finalize (GObject *object)
{
  CockpitFdTransport *self = COCKPIT_FD_TRANSPORT (object);

  g_assert (!self->io);
  g_assert (!self->in_poll);
  g_assert (!self->out_poll);

  g_byte_array_unref (self->in_buffer);

  if (self->child)
    {
      g_source_destroy (self->child);
      g_source_unref (self->child);
    }

  g_free (self->name);

  G_OBJECT_CLASS (cockpit_fd_transport_parent_class)->finalize (object);
}

static void
cockpit_fd_transport_class_init (CockpitFdTransportClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);

  gobject_class->constructed = cockpit_fd_transport_constructed;
  gobject_class->get_property = cockpit_fd_transport_get_property;
  gobject_class->set_property = cockpit_fd_transport_set_property;
  gobject_class->dispose = cockpit_fd_transport_dispose;
  gobject_class->finalize = cockpit_fd_transport_finalize;

  g_object_class_install_property (gobject_class, PROP_IN_FD,
                g_param_spec_int ("in-fd", "in-fd", "in-fd", -1, G_MAXINT, -1,
                                  G_PARAM_READWRITE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));

  g_object_class_install_property (gobject_class, PROP_OUT_FD,
                g_param_spec_int ("out-fd", "out-fd", "out-fd", -1, G_MAXINT, -1,
                                  G_PARAM_READWRITE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));

  g_object_class_install_property (gobject_class, PROP_PID,
                g_param_spec_int ("pid", "pid", "pid", 0, G_MAXINT, 0,
                                  G_PARAM_READWRITE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));

  g_object_class_override_property (gobject_class, PROP_NAME, "name");
}

static void
cockpit_fd_transport_send (CockpitTransport *transport,
                           guint channel,
                           GBytes *payload)
{
  CockpitFdTransport *self = COCKPIT_FD_TRANSPORT (transport);
  Message *message;

  g_return_if_fail (!self->closing);
  g_return_if_fail (self->io != NULL);

  message = g_new (Message, 1);
  message->payload = g_bytes_ref (payload);
  message->channel = channel;
  message->next = NULL;
  if (self->out_last)
    self->out_last->next = message;
  else
    self->out_first = message;
  self->out_last = message;

  if (!self->out_poll)
    {
      self->out_poll = g_new0 (GPollFD, 1);
      self->out_poll->fd = self->out_fd;
      self->out_poll->events = G_IO_OUT | G_IO_ERR;
      g_source_add_poll (self->io, self->out_poll);
    }

  /*
   * If this becomes thread-safe, then something like this is needed:
   * g_main_context_wakeup (g_source_get_context (self->source));
   */

  g_debug ("%s: queued %d byte payload", self->name, (int)g_bytes_get_size (payload));
}

static void
cockpit_fd_transport_close (CockpitTransport *transport,
                            const gchar *problem)
{
  CockpitFdTransport *self = COCKPIT_FD_TRANSPORT (transport);

  self->closing = TRUE;

  if (problem)
      close_immediately (self, problem);
  else if (!self->out_first)
    transport_close_out (self);
}

static void
cockpit_fd_transport_iface (CockpitTransportIface *iface)
{
  iface->send = cockpit_fd_transport_send;
  iface->close = cockpit_fd_transport_close;
}

CockpitTransport *
cockpit_fd_transport_new (const gchar *name,
                          int in_fd,
                          int out_fd)
{
  return g_object_new (COCKPIT_TYPE_FD_TRANSPORT,
                       "name", name,
                       "in-fd", in_fd,
                       "out-fd", out_fd,
                       "pid", 0,
                       NULL);
}

CockpitTransport *
cockpit_fd_transport_spawn (const gchar *host,
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
  GPid pid;

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

  transport = g_object_new (COCKPIT_TYPE_FD_TRANSPORT,
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

  if (!transport)
      g_spawn_close_pid (pid);

  return transport;
}
