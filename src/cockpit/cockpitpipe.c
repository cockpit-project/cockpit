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
 * CockpitPipe:
 *
 * A pipe with queued input and output similar in concept to a
 * a unix shell pipe or pipe().
 *
 * When talking to a process the CockpitPipe:pid property
 * will be non-zero. In that case the transport waits for the child
 * process to exit before it closes.
*/

enum {
  PROP_0,
  PROP_NAME,
  PROP_IN_FD,
  PROP_OUT_FD,
  PROP_PID
};

struct _CockpitPipePrivate {
  gchar *name;
  gboolean closing;
  gboolean connecting;
  gchar *problem;

  GSource *io;
  GPid pid;
  GSource *child;
  gboolean exited;
  gint status;

  int out_fd;
  GQueue *out_queue;
  gsize out_partial;
  GPollFD *out_poll;

  int in_fd;
  GByteArray *in_buffer;
  GPollFD *in_poll;
};

typedef struct {
  GSource source;
  CockpitPipe *pipe;
} CockpitPipeSource;

static guint cockpit_pipe_sig_read;
static guint cockpit_pipe_sig_close;

G_DEFINE_TYPE (CockpitPipe, cockpit_pipe, G_TYPE_OBJECT);

static void
cockpit_pipe_init (CockpitPipe *self)
{
  self->priv = G_TYPE_INSTANCE_GET_PRIVATE (self, COCKPIT_TYPE_PIPE, CockpitPipePrivate);
  self->priv->in_buffer = g_byte_array_new ();
  self->priv->in_fd = -1;
  self->priv->out_queue = g_queue_new ();
  self->priv->out_fd = -1;
  self->priv->status = -1;
}

static void
close_immediately (CockpitPipe *self,
                   const gchar *problem)
{
  GSource *source;

  if (!self->priv->io)
    return;

  if (problem)
    {
      g_free (self->priv->problem);
      self->priv->problem = g_strdup (problem);
    }

  g_debug ("%s: closing io%s%s", self->priv->name,
           self->priv->problem ? ": " : "",
           self->priv->problem ? self->priv->problem : "");

  source = self->priv->io;
  self->priv->io = NULL;

  g_source_destroy (source);
  g_source_unref (source);

  g_free (self->priv->in_poll);
  g_free (self->priv->out_poll);
  self->priv->in_poll = self->priv->out_poll = NULL;

  if (self->priv->in_fd != -1)
    close (self->priv->in_fd);
  if (self->priv->out_fd != -1)
    close (self->priv->out_fd);

  /* If not tracking a pid, then we are now closed. */
  if (!self->priv->child)
    {
      g_debug ("%s: no child process to wait for: closed", self->priv->name);
      g_signal_emit (self, cockpit_pipe_sig_close, 0, self->priv->problem);
    }
}

static void
close_maybe (CockpitPipe *self)
{
  if (self->priv->io)
    {
      if (!self->priv->in_poll && !self->priv->out_poll)
        {
          g_debug ("%s: input and output done", self->priv->name);
          close_immediately (self, NULL);
        }
    }
}

static void
on_child_reap (GPid pid,
               gint status,
               gpointer user_data)
{
  CockpitPipe *self = COCKPIT_PIPE (user_data);

  self->priv->status = status;
  self->priv->exited = TRUE;

  /*
   * When a pid is present then this is the definitive way of
   * determining when the process has closed.
   */

  g_debug ("%s: child process quit: closed: %d %d", self->priv->name, (int)pid, status);
  g_signal_emit (self, cockpit_pipe_sig_close, 0, self->priv->problem);
}


static gboolean
pipe_prepare (GSource *source,
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
pipe_check (GSource *source)
{
  CockpitPipeSource *fs = (CockpitPipeSource *)source;
  CockpitPipe *self = fs->pipe;
  return have_events (self->priv->out_poll) || have_events (self->priv->in_poll);
}

static void
dispatch_input (CockpitPipe *self)
{
  gssize ret;
  gsize len;
  gboolean eof;

  g_debug ("%s: reading input", self->priv->name);

  g_assert (self->priv->in_poll);

  len = self->priv->in_buffer->len;
  g_byte_array_set_size (self->priv->in_buffer, len + 1024);
  ret = read (self->priv->in_fd, self->priv->in_buffer->data + len, 1024);
  if (ret < 0)
    {
      g_byte_array_set_size (self->priv->in_buffer, len);
      if (errno != EAGAIN && errno != EINTR)
        {
          g_warning ("%s: couldn't read: %s", self->priv->name, g_strerror (errno));
          close_immediately (self, "internal-error");
        }
      return;
    }
  else if (ret == 0)
    {
      g_debug ("%s: end of input", self->priv->name);
      g_source_remove_poll (self->priv->io, self->priv->in_poll);
      g_free (self->priv->in_poll);
      self->priv->in_poll = NULL;
    }

  g_byte_array_set_size (self->priv->in_buffer, len + ret);

  eof = (self->priv->in_poll == NULL);
  g_signal_emit (self, cockpit_pipe_sig_read, 0, self->priv->in_buffer, eof);

  if (eof)
    close_maybe (self);
}

static void
close_output (CockpitPipe *self)
{
  if (self->priv->out_fd != -1)
    {
      g_debug ("%s: end of output", self->priv->name);

      /* And if closing, then we need to shutdown the output fd */
      if (shutdown (self->priv->out_fd, SHUT_WR) < 0)
        {
          if (errno == ENOTSOCK)
            {
              close (self->priv->out_fd);
              self->priv->out_fd = -1;
            }
          else
            {
              g_warning ("%s: couldn't shutdown fd: %s", self->priv->name, g_strerror (errno));
              close_immediately (self, "internal-error");
            }
        }
    }

  close_maybe (self);
}

static void
start_output (CockpitPipe *self)
{
  g_assert (self->priv->io != NULL);
  g_assert (self->priv->out_poll == NULL);
  self->priv->out_poll = g_new0 (GPollFD, 1);
  self->priv->out_poll->fd = self->priv->out_fd;
  self->priv->out_poll->events = G_IO_OUT | G_IO_ERR;
  g_source_add_poll (self->priv->io, self->priv->out_poll);
}

static void
set_problem_from_connect_errno (CockpitPipe *self,
                                int errn)
{
  const gchar *problem = NULL;

  if (errn == EPERM || errn == EACCES)
    problem = "not-authorized";
  else if (errn == ENOENT)
    problem = "not-found";

  g_free (self->priv->problem);

  if (problem)
    {
      g_message ("%s: couldn't connect: %s", self->priv->name, g_strerror (errn));
      self->priv->problem = g_strdup (problem);
    }
  else
    {
      g_warning ("%s: couldn't connect: %s", self->priv->name, g_strerror (errn));
      self->priv->problem = g_strdup ("internal-error");
    }
}

static gboolean
dispatch_connect (CockpitPipe *self)
{
  socklen_t slen;
  int error;

  self->priv->connecting = FALSE;

  slen = sizeof (error);
  if (getsockopt (self->priv->out_fd, SOL_SOCKET, SO_ERROR, &error, &slen) != 0)
    {
      g_warning ("%s: couldn't get connection result", self->priv->name);
      close_immediately (self, "internal-error");
    }
  else if (error == EINPROGRESS)
    {
      /* keep connecting */
      self->priv->connecting = TRUE;
    }
  else if (error != 0)
    {
      set_problem_from_connect_errno (self, error);
      close_immediately (self, NULL); /* problem already set */
    }
  else
    {
      return TRUE;
    }

  return TRUE;
}

static void
dispatch_output (CockpitPipe *self)
{
  struct iovec iov[4];
  gsize partial;
  gssize ret;
  gint i, count;
  GList *l;

  /* A non-blocking connect is processed here */
  if (self->priv->connecting && !dispatch_connect (self))
    return;

  g_assert (self->priv->out_poll);

  /* Note we fall through when nothing to write */
  partial = self->priv->out_partial;
  for (l = self->priv->out_queue->head, i = 0;
      i < G_N_ELEMENTS (iov) && l != NULL;
      i++, l = g_list_next (l))
    {
      iov[i].iov_base = (gpointer)g_bytes_get_data (l->data, &iov[i].iov_len);

      if (partial)
        {
          g_assert (partial < iov[i].iov_len);
          iov[i].iov_len -= partial;
          iov[i].iov_base = ((gchar *)iov[i].iov_base) + partial;
          partial = 0;
        }
    }
  count = i;

  if (count == 0)
    ret = 0;
  else
    ret = writev (self->priv->out_fd, iov, count);
  if (ret < 0)
    {
      if (errno != EAGAIN && errno != EINTR)
        {
          g_warning ("%s: couldn't write: %s", self->priv->name, g_strerror (errno));
          close_immediately (self, "internal-error");
        }
      return;
    }

  /* Figure out what was written */
  for (i = 0; ret > 0 && i < count; i++)
    {
      if (ret >= iov[i].iov_len)
        {
          g_debug ("%s: wrote %d bytes", self->priv->name, (int)iov[i].iov_len);
          g_bytes_unref (g_queue_pop_head (self->priv->out_queue));
          self->priv->out_partial = 0;
          ret -= iov[i].iov_len;
        }
      else
        {
          g_debug ("%s: partial write %d of %d bytes", self->priv->name,
                   (int)ret, (int)iov[i].iov_len);
          self->priv->out_partial += ret;
          ret = 0;
        }
    }

  if (self->priv->out_queue->head)
    return;

  g_debug ("%s: output queue empty", self->priv->name);

  /* If all messages are done, then stop polling out fd */
  g_source_remove_poll (self->priv->io, self->priv->out_poll);
  g_free (self->priv->out_poll);
  self->priv->out_poll = NULL;

  if (!self->priv->closing)
    return;

  close_output (self);
}

static gboolean
pipe_dispatch (GSource *source,
               GSourceFunc callback,
               gpointer user_data)
{
  CockpitPipeSource *fs = (CockpitPipeSource *)source;
  CockpitPipe *self = fs->pipe;

  g_object_ref (self);
  if (have_events (self->priv->out_poll))
    dispatch_output (self);
  if (have_events (self->priv->in_poll))
    dispatch_input (self);
  g_object_unref (self);

  return TRUE;
}

static GSourceFuncs source_funcs = {
  pipe_prepare,
  pipe_check,
  pipe_dispatch,
  NULL,
};

static void
cockpit_pipe_constructed (GObject *object)
{
  CockpitPipe *self = COCKPIT_PIPE (object);
  CockpitPipeSource *fs;
  GMainContext *ctx;
  GError *error = NULL;

  G_OBJECT_CLASS (cockpit_pipe_parent_class)->constructed (object);

  ctx = g_main_context_get_thread_default ();

  self->priv->io = g_source_new (&source_funcs, sizeof (CockpitPipeSource));
  fs = (CockpitPipeSource *)self->priv->io;
  fs->pipe = self;

  if (self->priv->in_fd >= 0)
    {
      if (!g_unix_set_fd_nonblocking (self->priv->in_fd, TRUE, &error))
        {
          g_warning ("%s: couldn't set file descriptor to non-blocking: %s",
                     self->priv->name, error->message);
          g_clear_error (&error);
        }

      self->priv->in_poll = g_new0 (GPollFD, 1);
      self->priv->in_poll->fd = self->priv->in_fd;
      self->priv->in_poll->events = G_IO_IN | G_IO_HUP | G_IO_ERR;
      g_source_add_poll (self->priv->io, self->priv->in_poll);
    }

  if (self->priv->out_fd >= 0)
    {
      if (!g_unix_set_fd_nonblocking (self->priv->out_fd, TRUE, &error))
        {
          g_warning ("%s: couldn't set file descriptor to non-blocking: %s",
                     self->priv->name, error->message);
          g_clear_error (&error);
        }
      start_output (self);
    }

  g_source_attach (self->priv->io, ctx);

  if (self->priv->pid)
    {
      self->priv->child = g_child_watch_source_new (self->priv->pid);
      g_source_set_callback (self->priv->child, (GSourceFunc)on_child_reap, self, NULL);
      g_source_attach (self->priv->child, ctx);
    }
}

static void
cockpit_pipe_set_property (GObject *obj,
                           guint prop_id,
                           const GValue *value,
                           GParamSpec *pspec)
{
  CockpitPipe *self = COCKPIT_PIPE (obj);

  switch (prop_id)
    {
      case PROP_NAME:
        self->priv->name = g_value_dup_string (value);
        break;
      case PROP_IN_FD:
        self->priv->in_fd = g_value_get_int (value);
        break;
      case PROP_OUT_FD:
        self->priv->out_fd = g_value_get_int (value);
        break;
      case PROP_PID:
        self->priv->pid = g_value_get_int (value);
        break;
      default:
        G_OBJECT_WARN_INVALID_PROPERTY_ID (obj, prop_id, pspec);
        break;
    }
}

static void
cockpit_pipe_get_property (GObject *obj,
                           guint prop_id,
                           GValue *value,
                           GParamSpec *pspec)
{
  CockpitPipe *self = COCKPIT_PIPE (obj);

  switch (prop_id)
  {
    case PROP_NAME:
      g_value_set_string (value, self->priv->name);
      break;
    case PROP_IN_FD:
      g_value_set_int (value, self->priv->in_fd);
      break;
    case PROP_OUT_FD:
      g_value_set_int (value, self->priv->out_fd);
      break;
    case PROP_PID:
      g_value_set_int (value, self->priv->pid);
      break;
    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (obj, prop_id, pspec);
      break;
  }
}

static void
cockpit_pipe_dispose (GObject *object)
{
  CockpitPipe *self = COCKPIT_PIPE (object);

  if (self->priv->pid && !self->priv->exited)
    {
      g_debug ("%s: killing child: %d", self->priv->name, (int)self->priv->pid);
      kill (self->priv->pid, SIGTERM);
    }

  if (self->priv->pid)
    {
      g_spawn_close_pid (self->priv->pid);
      self->priv->pid = 0;
    }

  if (self->priv->io)
    close_immediately (self, "terminated");

  while (self->priv->out_queue->head)
    g_bytes_unref (g_queue_pop_head (self->priv->out_queue));

  G_OBJECT_CLASS (cockpit_pipe_parent_class)->dispose (object);
}

static void
cockpit_pipe_finalize (GObject *object)
{
  CockpitPipe *self = COCKPIT_PIPE (object);

  g_assert (!self->priv->io);
  g_assert (!self->priv->in_poll);
  g_assert (!self->priv->out_poll);

  if (self->priv->child)
    {
      g_source_destroy (self->priv->child);
      g_source_unref (self->priv->child);
    }

  g_byte_array_unref (self->priv->in_buffer);
  g_queue_free (self->priv->out_queue);
  g_free (self->priv->problem);
  g_free (self->priv->name);

  G_OBJECT_CLASS (cockpit_pipe_parent_class)->finalize (object);
}

static void
cockpit_pipe_class_init (CockpitPipeClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);

  gobject_class->constructed = cockpit_pipe_constructed;
  gobject_class->get_property = cockpit_pipe_get_property;
  gobject_class->set_property = cockpit_pipe_set_property;
  gobject_class->dispose = cockpit_pipe_dispose;
  gobject_class->finalize = cockpit_pipe_finalize;

  /**
   * CockpitPipe:in-fd:
   *
   * The file descriptor the pipe reads from. The pipe owns the
   * file descriptor and will close it.
   */
  g_object_class_install_property (gobject_class, PROP_IN_FD,
                g_param_spec_int ("in-fd", "in-fd", "in-fd", -1, G_MAXINT, -1,
                                  G_PARAM_READWRITE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));

  /**
   * CockpitPipe:out-fd:
   *
   * The file descriptor the pipe writes to. The pipe owns the
   * file descriptor and will close it.
   */
  g_object_class_install_property (gobject_class, PROP_OUT_FD,
                g_param_spec_int ("out-fd", "out-fd", "out-fd", -1, G_MAXINT, -1,
                                  G_PARAM_READWRITE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));

  /**
   * CockpitPipe:pid:
   *
   * The process id of the pipe, if the pipe is talking to a process.
   * Otherwise set to zero.
   *
   * If you use cockpit_pipe_transport_spawn() to create the
   * #CockpitPipe then this will be non zero.
   */
  g_object_class_install_property (gobject_class, PROP_PID,
                g_param_spec_int ("pid", "pid", "pid", 0, G_MAXINT, 0,
                                  G_PARAM_READWRITE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));
  /**
   * CockpitPipe:name:
   *
   * Pipe name used for debugging purposes.
   */
  g_object_class_install_property (gobject_class, PROP_NAME,
                g_param_spec_string ("name", "name", "name", "<unnamed>",
                                     G_PARAM_READWRITE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));

  /**
   * CockpitPipe::read:
   * @buffer: a GByteArray of the read data
   * @eof: whether the pipe is done reading
   *
   * Emitted when data is read from the input file descriptor of the
   * pipe.
   *
   * Data consumed from @buffer by the handler should be removed from
   * the GByteArray. This can be done with the cockpit_pipe_consume()
   * function.
   *
   * This handler will only be called once with @eof set to TRUE. But
   * in error conditions it may not be called with @eof set to TRUE
   * at all, and the CockpitPipe::close signal will simply fire.
   */
  cockpit_pipe_sig_read = g_signal_new ("read", COCKPIT_TYPE_PIPE, G_SIGNAL_RUN_LAST,
                                        G_STRUCT_OFFSET (CockpitPipeClass, read),
                                        NULL, NULL, NULL,
                                        G_TYPE_NONE, 2, G_TYPE_BYTE_ARRAY, G_TYPE_BOOLEAN);

  /**
   * CockpitPipe::close:
   * @problem: problem string or %NULL
   *
   * Emitted when the pipe closes, whether due to a problem or a normal
   * shutdown.
   *
   * @problem will be NULL if the pipe closed normally.
   */
  cockpit_pipe_sig_close = g_signal_new ("close", COCKPIT_TYPE_PIPE, G_SIGNAL_RUN_FIRST,
                                         G_STRUCT_OFFSET (CockpitPipeClass, close),
                                         NULL, NULL, NULL,
                                         G_TYPE_NONE, 1, G_TYPE_STRING);

  g_type_class_add_private (klass, sizeof (CockpitPipePrivate));
}

/**
 * cockpit_pipe_write:
 * @self: the pipe
 * @data: the data to write
 *
 * Write @data to the pipe. This is not done immediately, it's
 * queued and written when the pipe is ready.
 *
 * If you cockpit_pipe_close() with a @problem, then queued data
 * will be discarded.
 *
 * Calling this function on a closed or closing pipe (one on which
 * cockpit_pipe_close() has been called) is invalid.
 */
void
cockpit_pipe_write (CockpitPipe *self,
                    GBytes *data)
{
  g_return_if_fail (COCKPIT_IS_PIPE (self));
  g_return_if_fail (!self->priv->closing);

  /* If self->priv->io is already gone but we are still waiting for the
     child to exit, then we haven't emitted the "close" signal yet
     and it isn't an error to try to send more messages.  We drop them
     here.
  */
  if (self->priv->io == NULL && self->priv->child && self->priv->pid != 0)
    {
      g_message ("%s: dropping message while waiting for child to exit", self->priv->name);
      return;
    }

  g_return_if_fail (self->priv->io != NULL);

  g_queue_push_tail (self->priv->out_queue, g_bytes_ref (data));

  if (!self->priv->out_poll && self->priv->out_fd >= 0)
    {
      start_output (self);
    }

  /*
   * If this becomes thread-safe, then something like this is needed:
   * g_main_context_wakeup (g_source_get_context (self->priv->source));
   */
}

/**
 * cockpit_pipe_close:
 * @self: a pipe
 * @problem: a problem or NULL
 *
 * Close the pipe. If @problem is non NULL, then it's treated
 * as if an error occurred, and the pipe is closed immediately.
 * Otherwise the pipe output is closed when all data has been sent.
 *
 * The 'close' signal will be fired when the pipe actually closes.
 * This may be during this function call (esp. in the case of a
 * non-NULL @problem) or later.
 */
void
cockpit_pipe_close (CockpitPipe *self,
                    const gchar *problem)
{
  g_return_if_fail (COCKPIT_IS_PIPE (self));

  self->priv->closing = TRUE;

  if (problem)
      close_immediately (self, problem);
  else if (g_queue_is_empty (self->priv->out_queue))
    close_output (self);
}

static gboolean
on_later_close (gpointer user_data)
{
  close_immediately (user_data, NULL); /* problem already set */
  return FALSE;
}

static void
close_later (CockpitPipe *self)
{
  GSource *source = g_idle_source_new ();
  g_source_set_priority (source, G_PRIORITY_HIGH);
  g_source_set_callback (source, on_later_close, g_object_ref (self), g_object_unref);
  g_source_attach (source, g_main_context_get_thread_default ());
  g_source_unref (source);
}

/**
 * cockpit_pipe_connect:
 * @name: name for pipe, for debugging
 * @address: socket address to connect to
 *
 * Create a new pipe connected as a client to the given socket
 * address, which can be a unix or inet address. Will connect
 * in stream mode.
 *
 * If the connection fails, a pipe is still returned. It will
 * close once the main loop is run with an appropriate problem.
 *
 * Returns: (transfer full): newly allocated CockpitPipe.
 */
CockpitPipe *
cockpit_pipe_connect (const gchar *name,
                      GSocketAddress *address)
{
  gboolean connecting = FALSE;
  gsize native_len;
  gpointer native;
  CockpitPipe *pipe;
  int errn = 0;
  int sock;

  g_return_val_if_fail (G_IS_SOCKET_ADDRESS (address), NULL);

  sock = socket (g_socket_address_get_family (address), SOCK_STREAM, 0);
  if (sock < 0)
    {
      errn = errno;
    }
  else
    {
      if (!g_unix_set_fd_nonblocking (sock, TRUE, NULL))
        g_return_val_if_reached (NULL);
      native_len = g_socket_address_get_native_size (address);
      native = g_malloc (native_len);
      if (!g_socket_address_to_native (address, native, native_len, NULL))
        g_return_val_if_reached (NULL);
      if (connect (sock, native, native_len) < 0)
        {
          if (errno == EINPROGRESS)
            {
              connecting = TRUE;
            }
          else
            {
              errn = errno;
              close (sock);
              sock = -1;
            }
        }
      g_free (native);
    }

  pipe = g_object_new (COCKPIT_TYPE_PIPE,
                       "in-fd", sock,
                       "out-fd", sock,
                       "name", name,
                       NULL);

  pipe->priv->connecting = connecting;
  if (errn != 0)
    {
      set_problem_from_connect_errno (pipe, errn);
      close_later (pipe);
    }

  return pipe;
}

/**
 * cockpit_pipe_spawn:
 * @pipe_gtype: the GType of the resulting pipe object
 * @argv: null terminated string array of command arguments
 * @env: optional null terminated string array of child environment
 * @directory: optional working directory of child process
 *
 * Launch a child process and create a CockpitPipe for it. Standard
 * in and standard out are connected to the pipe. Standard error
 * goes to the standard error output of parent process.
 *
 * If the spawn fails, a pipe is still returned. It will
 * close once the main loop is run with an appropriate problem.
 *
 * NOTE: Although we could probably implement this as construct arguments
 * and without the @pipe_gtype argument, this is just simpler
 * for now.
 *
 * Returns: (transfer full): newly allocated CockpitPipe.
 */
CockpitPipe *
cockpit_pipe_spawn (GType pipe_gtype,
                    const gchar **argv,
                    const gchar **env,
                    const gchar *directory)
{
  CockpitPipe *pipe = NULL;
  int session_stdin = -1;
  int session_stdout = -1;
  GError *error = NULL;
  const gchar *problem = NULL;
  gchar *name;
  GPid pid = 0;

  GSpawnFlags flags = G_SPAWN_DO_NOT_REAP_CHILD;

  g_spawn_async_with_pipes (directory, (gchar **)argv, (gchar **)env,
                            flags, NULL, NULL,
                            &pid, &session_stdin, &session_stdout, NULL,
                            &error);

  name = g_path_get_basename (argv[0]);
  if (name == NULL)
    name = g_strdup (argv[0]);

  pipe = g_object_new (pipe_gtype,
                       "name", name,
                       "in-fd", session_stdout,
                       "out-fd", session_stdin,
                       "pid", pid,
                       NULL);

  if (error)
    {
      if (g_error_matches (error, G_SPAWN_ERROR, G_SPAWN_ERROR_NOENT))
        problem = "not-found";
      else if (g_error_matches (error, G_SPAWN_ERROR, G_SPAWN_ERROR_PERM) ||
               g_error_matches (error, G_SPAWN_ERROR, G_SPAWN_ERROR_ACCES))
        problem = "not-authorized";

      if (problem)
        {
          g_debug ("%s: couldn't run %s: %s", name, argv[0], error->message);
        }
      else
        {
          g_message ("%s: couldn't run %s: %s", name, argv[0], error->message);
          problem = "internal-error";
        }
      pipe->priv->problem = g_strdup (problem);
      close_later (pipe);
      g_error_free (error);
    }
  else
    {
      g_debug ("%s: spawned: %s", name, argv[0]);
    }

  g_free (name);

  return pipe;
}

/**
 * cockpit_pipe_get_pid:
 * @self: a pipe
 *
 * Get the pid of this pipe or zero if not a process
 * pipe.
 *
 * Returns: the pid or zero
 */
GPid
cockpit_pipe_get_pid (CockpitPipe *self)
{
  g_return_val_if_fail (COCKPIT_IS_PIPE (self), 0);
  return self->priv->pid;
}

/**
 * cockpit_pipe_get_buffer:
 * @self: a pipe
 *
 * Get the input buffer for the pipe.
 *
 * This can change when the main loop is run. You can use
 * cockpit_pipe_consume() to consume data from it.
 *
 * Returns: (transfer none): the buffer
 */
GByteArray *
cockpit_pipe_get_buffer (CockpitPipe *self)
{
  g_return_val_if_fail (COCKPIT_IS_PIPE (self), NULL);
  return self->priv->in_buffer;
}

/**
 * cockpit_pipe_exit_status:
 * @self: a pipe
 *
 * Get the exit status of a process pipe. This is only
 * valid if this pipe has a CockpitPipe:pid property
 * and the CockpitPipe::closed signal has fired.
 *
 * This is the raw exit status from waitpid() and friends
 * and needs to be checked if it's a signal or exit return
 * value.
 *
 * Returns: the exit signal.
 */
gint
cockpit_pipe_exit_status (CockpitPipe *self)
{
  g_return_val_if_fail (COCKPIT_IS_PIPE (self), -1);
  return self->priv->status;
}

/**
 * cockpit_pipe_consume:
 * @buffer: a data buffer
 * @skip: amount of bytes to skip
 * @length: length of data to consume
 *
 * Used to consume data from the buffer passed to the the
 * read signal.
 *
 * @skip + @length bytes will be removed from the @buffer,
 * and @length bytes will be returned.
 *
 * As an omptimization of @skip + @length is equal to the
 * entire length of the buffer, then the data will not
 * be copied but ownership will be transferred to the returned
 * bytes.
 *
 * Returns: (transfer full): the read bytes
 */
GBytes *
cockpit_pipe_consume (GByteArray *buffer,
                      gsize skip,
                      gsize length)
{
  GBytes *bytes;
  guint8 *buf;

  g_return_val_if_fail (buffer != NULL, NULL);

  /* Optimize when we match full buffer length */
  if (buffer->len == skip + length)
    {
      /* When array is reffed, this just clears byte array */
      g_byte_array_ref (buffer);
      buf = g_byte_array_free (buffer, FALSE);
      bytes = g_bytes_new_with_free_func (buf + skip, length, g_free, buf);
    }
  else
    {
      bytes = g_bytes_new (buffer->data + skip, length);
      g_byte_array_remove_range (buffer, 0, skip + length);
    }

  return bytes;
}

/**
 * cockpit_pipe_skip:
 * @buffer: a data buffer
 * @skip: amount of bytes to skip
 *
 * Used to remove data from the front of the buffer.
 * @skip should be less than the number of bytes in
 * the buffer.
 */
void
cockpit_pipe_skip (GByteArray *buffer,
                   gsize skip)
{
  g_return_if_fail (buffer != NULL);
  g_byte_array_remove_range (buffer, 0, skip);
}
