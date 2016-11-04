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
#include "cockpitunixfd.h"

#include <glib-unix.h>

#include <sys/socket.h>
#include <sys/uio.h>
#include <sys/wait.h>

#include <dirent.h>
#include <errno.h>
#include <pty.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#ifdef __linux
#include <sys/prctl.h>
#endif

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
  PROP_ERR_FD,
  PROP_PID,
  PROP_PROBLEM,
  PROP_SEQ_PACKET
};

struct _CockpitPipePrivate {
  gchar *name;
  GMainContext *context;

  gboolean closed;
  gboolean closing;
  gboolean connecting;
  gchar *problem;

  GPid pid;
  GSource *child;
  gboolean exited;
  gint status;
  CockpitPipe **watch_arg;
  gboolean is_process;

  int out_fd;
  GSource *out_source;
  GQueue *out_queue;
  gsize out_partial;

  int in_fd;
  GSource *in_source;
  GByteArray *in_buffer;

  int err_fd;
  GSource *err_source;
  GByteArray *err_buffer;

  gboolean seq_packet;
};

typedef struct {
  GSource source;
  CockpitPipe *pipe;
} CockpitPipeSource;

static guint cockpit_pipe_sig_read;
static guint cockpit_pipe_sig_close;

static void  cockpit_close_later (CockpitPipe *self);

static void  set_problem_from_errno (CockpitPipe *self,
                                     const gchar *message,
                                     int errn);

G_DEFINE_TYPE (CockpitPipe, cockpit_pipe, G_TYPE_OBJECT);

static void
cockpit_pipe_init (CockpitPipe *self)
{
  self->priv = G_TYPE_INSTANCE_GET_PRIVATE (self, COCKPIT_TYPE_PIPE, CockpitPipePrivate);
  self->priv->in_buffer = g_byte_array_new ();
  self->priv->in_fd = -1;
  self->priv->out_queue = g_queue_new ();
  self->priv->out_fd = -1;
  self->priv->err_fd = -1;
  self->priv->status = -1;
  self->priv->seq_packet = FALSE;

  self->priv->context = g_main_context_ref_thread_default ();
}

static void
stop_output (CockpitPipe *self)
{
  g_assert (self->priv->out_source != NULL);
  g_source_destroy (self->priv->out_source);
  g_source_unref (self->priv->out_source);
  self->priv->out_source = NULL;
}

static void
stop_input (CockpitPipe *self)
{
  g_assert (self->priv->in_source != NULL);
  g_source_destroy (self->priv->in_source);
  g_source_unref (self->priv->in_source);
  self->priv->in_source = NULL;
}

static void
stop_error (CockpitPipe *self)
{
  g_assert (self->priv->err_source != NULL);
  g_source_destroy (self->priv->err_source);
  g_source_unref (self->priv->err_source);
  self->priv->err_source = NULL;
}

static void
close_immediately (CockpitPipe *self,
                   const gchar *problem)
{
  if (self->priv->closed)
    return;

  if (problem)
    {
      g_free (self->priv->problem);
      self->priv->problem = g_strdup (problem);
    }

  self->priv->closed = TRUE;

  g_debug ("%s: closing pipe%s%s", self->priv->name,
           self->priv->problem ? ": " : "",
           self->priv->problem ? self->priv->problem : "");

  if (self->priv->in_source)
    stop_input (self);
  if (self->priv->out_source)
    stop_output (self);
  if (self->priv->err_source)
    stop_error (self);

  if (self->priv->in_fd != -1)
    {
      close (self->priv->in_fd);
      self->priv->in_fd = -1;
    }
  if (self->priv->out_fd != -1)
    {
      close (self->priv->out_fd);
      self->priv->out_fd = -1;
    }
  if (self->priv->err_fd != -1)
    {
      close (self->priv->err_fd);
      self->priv->err_fd = -1;
    }


  if (problem && self->priv->pid && !self->priv->exited)
    {
      g_debug ("%s: killing child: %d", self->priv->name, (int)self->priv->pid);
      kill (self->priv->pid, SIGTERM);
    }

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
  if (!self->priv->closed)
    {
      if (!self->priv->in_source && !self->priv->out_source && !self->priv->err_source)
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
  CockpitPipe **arg = user_data;
  CockpitPipe *self = *arg;

  /* This happens if this child watch outlasts the pipe */
  if (!self)
    return;

  self->priv->status = status;
  self->priv->exited = TRUE;
  self->priv->watch_arg = NULL;

  /* Release our reference on watch handler */
  g_source_unref (self->priv->child);
  self->priv->child = NULL;

  /*
   * We need to wait until both the process has exited *and*
   * the output has closed before we fire our close signal.
   */

  g_debug ("%s: child process quit:%s  %d %d", self->priv->name,
           self->priv->closed ? " closed:" : "", (int)pid, status);
  if (self->priv->closed)
    g_signal_emit (self, cockpit_pipe_sig_close, 0, self->priv->problem);
}

static gboolean
dispatch_input (gint fd,
                GIOCondition cond,
                gpointer user_data)
{
  CockpitPipe *self = (CockpitPipe *)user_data;
  struct iovec vec = { NULL, };
  struct msghdr msg = { .msg_iov = &vec, .msg_iovlen = 1, };
  gssize ret = 0;
  gsize len;
  gboolean eof;
  int errn;

  g_return_val_if_fail (self->priv->in_source, FALSE);
  len = self->priv->in_buffer->len;

  /*
   * Enable clean shutdown by not reading when we just get
   * G_IO_HUP. Note that when we get G_IO_ERR we do want to read
   * just so we can get the appropriate detailed error message.
   */
  if (cond != G_IO_HUP)
    {
      g_byte_array_set_size (self->priv->in_buffer, len + MAX_PACKET_SIZE);
      if (self->priv->seq_packet)
        {
          g_debug ("%s: receiving input", self->priv->name);
          vec.iov_len = MAX_PACKET_SIZE;
          vec.iov_base = self->priv->in_buffer->data + len;
          ret = recvmsg (self->priv->in_fd, &msg, 0);
        }
      else
        {
          g_debug ("%s: reading input %x", self->priv->name, cond);
          ret = read (self->priv->in_fd, self->priv->in_buffer->data + len, MAX_PACKET_SIZE);
        }

      errn = errno;
      if (ret < 0)
        {
          g_byte_array_set_size (self->priv->in_buffer, len);
          if (errn == EAGAIN || errn == EINTR)
            {
              return TRUE;
            }
          else
            {
              if (self->priv->seq_packet)
                set_problem_from_errno (self, "couldn't recv", errn);
              else
                set_problem_from_errno (self, "couldn't read", errn);
              close_immediately (self, NULL); /* problem already set */
              return FALSE;
            }
        }
    }

  g_byte_array_set_size (self->priv->in_buffer, len + ret);

  if (ret == 0)
    {
      g_debug ("%s: end of input", self->priv->name);
      stop_input (self);
    }

  g_object_ref (self);

  eof = (self->priv->in_source == NULL);
  g_signal_emit (self, cockpit_pipe_sig_read, 0, self->priv->in_buffer, eof);

  if (eof)
    close_maybe (self);

  g_object_unref (self);
  return TRUE;
}

static gboolean
dispatch_error (gint fd,
                GIOCondition cond,
                gpointer user_data)
{
  CockpitPipe *self = (CockpitPipe *)user_data;
  gssize ret = 0;
  gsize len;
  gboolean eof;

  g_return_val_if_fail (self->priv->err_source, FALSE);
  len = self->priv->err_buffer->len;

  /*
   * Enable clean shutdown by not reading when we just get
   * G_IO_HUP. Note that when we get G_IO_ERR we do want to read
   * just so we can get the appropriate detailed error message.
   */
  if (cond != G_IO_HUP)
    {
      g_debug ("%s: reading error", self->priv->name);

      g_byte_array_set_size (self->priv->err_buffer, len + 1024);
      ret = read (self->priv->err_fd, self->priv->err_buffer->data + len, 1024);
      if (ret < 0)
        {
          g_byte_array_set_size (self->priv->err_buffer, len);
          if (errno != EAGAIN && errno != EINTR)
            {
              g_warning ("%s: couldn't read error: %s", self->priv->name, g_strerror (errno));
              close_immediately (self, "internal-error");
              return FALSE;
            }
          return TRUE;
        }
    }

  g_byte_array_set_size (self->priv->err_buffer, len + ret);

  if (ret == 0)
    {
      g_debug ("%s: end of error", self->priv->name);
      stop_error (self);
    }

  g_object_ref (self);

  eof = (self->priv->err_source == NULL);

  if (eof)
    close_maybe (self);

  g_object_unref (self);
  return TRUE;
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
              g_debug ("%s: not a socket, closing entirely", self->priv->name);
              close (self->priv->out_fd);

              if (self->priv->in_fd == self->priv->out_fd)
                {
                  self->priv->in_fd = -1;
                  if (self->priv->in_source)
                    {
                      g_debug ("%s: and closing input because same fd", self->priv->name);
                      stop_input (self);
                    }
                }

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
set_problem_from_errno (CockpitPipe *self,
                        const gchar *message,
                        int errn)
{
  const gchar *problem = NULL;

  if (errn == EPERM || errn == EACCES)
    problem = "access-denied";
  else if (errn == ENOENT || errn == ECONNREFUSED)
    problem = "not-found";

  g_free (self->priv->problem);

  if (problem)
    {
      g_message ("%s: %s: %s", self->priv->name, message, g_strerror (errn));
      self->priv->problem = g_strdup (problem);
    }
  else
    {
      g_warning ("%s: %s: %s", self->priv->name, message, g_strerror (errn));
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
      set_problem_from_errno (self, "couldn't connect", error);
      close_immediately (self, NULL); /* problem already set */
    }
  else
    {
      return TRUE;
    }

  return TRUE;
}

static gboolean
dispatch_packet (gint fd,
                 GIOCondition cond,
                 gpointer user_data)
{
  CockpitPipe *self = (CockpitPipe *)user_data;
  gconstpointer data;
  gsize length;
  GBytes *bytes;
  gssize ret;

  if (self->priv->connecting && !dispatch_connect (self))
    return TRUE;

  g_return_val_if_fail (self->priv->out_source, FALSE);

  bytes = g_queue_peek_head (self->priv->out_queue);
  if (!bytes)
    {
      g_debug ("%s: output queue empty", self->priv->name);

      /* If all messages are done, then stop polling out fd */
      stop_output (self);

      if (self->priv->closing)
        close_output (self);
      else
        close_maybe (self);

      return TRUE;
    }

  data = g_bytes_get_data (bytes, &length);
  g_debug ("%s: sending %d byte message", self->priv->name, (gint)length);

  ret = send (self->priv->out_fd, data, length, 0);

  if (ret < 0)
    {
      if (errno != EAGAIN && errno != EINTR)
        {
          if (errno == EPIPE)
            {
              g_debug ("%s: couldn't send: %s", self->priv->name, g_strerror (errno));
              close_immediately (self, "terminated");
            }
          else
            {
              set_problem_from_errno (self, "couldn't send", errno);
              close_immediately (self, NULL); /* already set */
            }
        }
      return FALSE;
    }

  if (ret > 0 && ret != length)
    {
        g_warning ("%s: partial send %d of %d bytes", self->priv->name, (gint)ret, (gint)length);
        ret = length;
    }
  if (ret == length)
    {
      g_queue_pop_head (self->priv->out_queue);
      g_bytes_unref (bytes);
    }

  return TRUE;
}

static gboolean
dispatch_output (gint fd,
                 GIOCondition cond,
                 gpointer user_data)
{
  CockpitPipe *self = (CockpitPipe *)user_data;
  struct iovec iov[4];
  gsize partial;
  gssize ret;
  gint i, count;
  GList *l;

  /* A non-blocking connect is processed here */
  if (self->priv->connecting && !dispatch_connect (self))
    return TRUE;

  g_return_val_if_fail (self->priv->out_source, FALSE);

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
          if (errno == EPIPE)
            {
              g_debug ("%s: couldn't write: %s", self->priv->name, g_strerror (errno));
              close_immediately (self, "terminated");
            }
          else
            {
              set_problem_from_errno (self, "couldn't write", errno);
              close_immediately (self, NULL); /* already set */
            }
        }
      return FALSE;
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
    return TRUE;

  g_debug ("%s: output queue empty", self->priv->name);

  /* If all messages are done, then stop polling out fd */
  stop_output (self);

  if (self->priv->closing)
    close_output (self);
  else
    close_maybe (self);

  return TRUE;
}

static void
start_output (CockpitPipe *self)
{
  g_assert (self->priv->out_source == NULL);
  self->priv->out_source = cockpit_unix_fd_source_new (self->priv->out_fd, G_IO_OUT);
  g_source_set_name (self->priv->out_source, "pipe-output");
  if (self->priv->seq_packet)
    g_source_set_callback (self->priv->out_source, (GSourceFunc)dispatch_packet, self, NULL);
  else
    g_source_set_callback (self->priv->out_source, (GSourceFunc)dispatch_output, self, NULL);
  g_source_attach (self->priv->out_source, self->priv->context);
}

static void
cockpit_pipe_constructed (GObject *object)
{
  CockpitPipe *self = COCKPIT_PIPE (object);
  GError *error = NULL;

  G_OBJECT_CLASS (cockpit_pipe_parent_class)->constructed (object);

  if (self->priv->in_fd >= 0)
    {
      if (!g_unix_set_fd_nonblocking (self->priv->in_fd, TRUE, &error))
        {
          g_warning ("%s: couldn't set file descriptor to non-blocking: %s",
                     self->priv->name, error->message);
          g_clear_error (&error);
        }

      self->priv->in_source = cockpit_unix_fd_source_new (self->priv->in_fd, G_IO_IN);
      g_source_set_name (self->priv->in_source, "pipe-input");
      g_source_set_callback (self->priv->in_source, (GSourceFunc)dispatch_input, self, NULL);
      g_source_attach (self->priv->in_source, self->priv->context);
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

  if (self->priv->err_fd >= 0)
    {
      if (!g_unix_set_fd_nonblocking (self->priv->err_fd, TRUE, &error))
        {
          g_warning ("%s: couldn't set file descriptor to non-blocking: %s",
                     self->priv->name, error->message);
          g_clear_error (&error);
        }

      self->priv->err_buffer = g_byte_array_new ();
      self->priv->err_source = cockpit_unix_fd_source_new (self->priv->err_fd, G_IO_IN);
      g_source_set_name (self->priv->err_source, "pipe-error");
      g_source_set_callback (self->priv->err_source, (GSourceFunc)dispatch_error, self, NULL);
      g_source_attach (self->priv->err_source, self->priv->context);
    }

  if (self->priv->pid)
    {
      self->priv->is_process = TRUE;

      /* We may need this watch to outlast this process ... */
      self->priv->watch_arg = g_new0 (CockpitPipe *, 1);
      *(self->priv->watch_arg) = self;

      self->priv->child = g_child_watch_source_new (self->priv->pid);
      g_source_set_callback (self->priv->child, (GSourceFunc)on_child_reap,
                             self->priv->watch_arg, g_free);
      g_source_attach (self->priv->child, self->priv->context);
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
      case PROP_ERR_FD:
        self->priv->err_fd = g_value_get_int (value);
        break;
      case PROP_PID:
        self->priv->pid = g_value_get_int (value);
        break;
      case PROP_SEQ_PACKET:
        self->priv->seq_packet = g_value_get_boolean (value);
        break;
      case PROP_PROBLEM:
        self->priv->problem = g_value_dup_string (value);
        if (self->priv->problem)
          cockpit_close_later (self);
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
    case PROP_ERR_FD:
      g_value_set_int (value, self->priv->err_fd);
      break;
    case PROP_PID:
      g_value_set_int (value, self->priv->pid);
      break;
    case PROP_SEQ_PACKET:
      g_value_set_int (value, self->priv->seq_packet);
      break;
    case PROP_PROBLEM:
      g_value_set_string (value, self->priv->problem);
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

  if (!self->priv->closed)
    close_immediately (self, "terminated");

  while (self->priv->out_queue->head)
    g_bytes_unref (g_queue_pop_head (self->priv->out_queue));

  G_OBJECT_CLASS (cockpit_pipe_parent_class)->dispose (object);
}

static void
cockpit_pipe_finalize (GObject *object)
{
  CockpitPipe *self = COCKPIT_PIPE (object);

  g_assert (self->priv->closed);
  g_assert (!self->priv->in_source);
  g_assert (!self->priv->out_source);

  /* Release our reference on watch handler */
  if (self->priv->child)
    g_source_unref (self->priv->child);

  /*
   * Tell the child watch that we've gone away ...
   * But note that if the child watch hasn't fired, it'll continue to wait
   */
  if (self->priv->watch_arg)
    *(self->priv->watch_arg) = NULL;

  g_byte_array_unref (self->priv->in_buffer);
  if (self->priv->err_buffer)
    g_byte_array_unref (self->priv->err_buffer);
  g_queue_free (self->priv->out_queue);
  g_free (self->priv->problem);
  g_free (self->priv->name);

  if (self->priv->context)
    g_main_context_unref (self->priv->context);

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
   * CockpitPipe:err-fd:
   *
   * The file descriptor the pipe reads error output from. The pipe owns the
   * file descriptor and will close it.
   */
  g_object_class_install_property (gobject_class, PROP_ERR_FD,
                g_param_spec_int ("err-fd", "err-fd", "err-fd", -1, G_MAXINT, -1,
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
   * CockpitPipe:problem:
   *
   * The problem that the pipe closed with. If used as a constructor argument then
   * the pipe will be created in a closed/failed state. Although 'closed' signal will
   * only fire once main loop is hit.
   */
  g_object_class_install_property (gobject_class, PROP_PROBLEM,
                g_param_spec_string ("problem", "problem", "problem", NULL,
                                     G_PARAM_READWRITE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));

  /**
   * CockpitPipe:seq-packet:
   *
   * Whether the fd is a SOCK_SEQPACKET socket or not.
   */
  g_object_class_install_property (gobject_class, PROP_SEQ_PACKET,
                g_param_spec_boolean ("seq-packet", "seq-packet", "seq-packet", FALSE,
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
 *
 * Zero length data blocks are ignored, it doesn't makes sense to
 * write zero bytes to a pipe.
 */
void
_cockpit_pipe_write (CockpitPipe *self,
                    GBytes *data,
                    const gchar *caller,
                    int line)
{
  g_return_if_fail (COCKPIT_IS_PIPE (self));

  /* If self->priv->io is already gone but we are still waiting for the
     child to exit, then we haven't emitted the "close" signal yet
     and it isn't an error to try to send more messages.  We drop them
     here.
  */
  if (self->priv->closed && self->priv->child && self->priv->pid != 0)
    {
      g_message ("%s: dropping message while waiting for child to exit", self->priv->name);
      return;
    }

  /*
   * Debugging this issue so have made thingcs more verbose.
   * HACK: https://github.com/cockpit-project/cockpit/issues/2978
   */
  if (self->priv->closed)
    {
      g_critical ("assertion self->priv->closed check failed at %s %d (%p %d)",
                  caller, line, self->priv->child, self->priv->pid);
      return;
    }

  if (!self->priv->seq_packet && g_bytes_get_size (data) == 0)
    {
      g_debug ("%s: ignoring zero byte data block", self->priv->name);
      return;
    }

  g_queue_push_tail (self->priv->out_queue, g_bytes_ref (data));

  if (!self->priv->out_source && self->priv->out_fd >= 0)
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
cockpit_close_later (CockpitPipe *self)
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
      set_problem_from_errno (pipe, "couldn't connect", errn);
      cockpit_close_later (pipe);
    }

  return pipe;
}

static GSpawnFlags
calculate_spawn_flags (const gchar **env,
                       CockpitPipeFlags pflags)
{
  GSpawnFlags flags = G_SPAWN_DO_NOT_REAP_CHILD;
  gboolean path_flag = FALSE;

  for (; env && env[0]; env++)
    {
      if (g_str_has_prefix (env[0], "PATH="))
        {
          flags |= G_SPAWN_SEARCH_PATH_FROM_ENVP;
          path_flag = TRUE;
          break;
        }
    }

  if (!path_flag)
    flags |= G_SPAWN_SEARCH_PATH;

  if (pflags & COCKPIT_PIPE_STDERR_TO_NULL)
    flags |= G_SPAWN_STDERR_TO_DEV_NULL;

  return flags;
}

static void
spawn_setup (gpointer data)
{
  CockpitPipeFlags flags = GPOINTER_TO_INT (data);

  /* Send this signal to all direct child processes, when bridge dies */
#ifdef __linux
  prctl (PR_SET_PDEATHSIG, SIGHUP);
#endif

  if (flags & COCKPIT_PIPE_STDERR_TO_STDOUT)
    dup2 (1, 2);
}

/**
 * cockpit_pipe_spawn:
 * @argv: null terminated string array of command arguments
 * @env: optional null terminated string array of child environment
 * @directory: optional working directory of child process
 * @flags: flags pertaining to stderr
 *
 * Launch a child process and create a CockpitPipe for it. Standard
 * in and standard out are connected to the pipe. The default location
 * for standard error usually goes to the journal.
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
cockpit_pipe_spawn (const gchar **argv,
                    const gchar **env,
                    const gchar *directory,
                    CockpitPipeFlags flags)
{
  CockpitPipe *pipe = NULL;
  int session_stdin = -1;
  int session_stdout = -1;
  int session_stderr = -1;
  GError *error = NULL;
  const gchar *problem = NULL;
  int *with_stderr = NULL;
  gchar *name;
  GPid pid = 0;

  if (flags & COCKPIT_PIPE_STDERR_TO_MEMORY)
    with_stderr = &session_stderr;

  g_spawn_async_with_pipes (directory, (gchar **)argv, (gchar **)env,
                            calculate_spawn_flags (env, flags),
                            spawn_setup, GINT_TO_POINTER (flags),
                            &pid, &session_stdin, &session_stdout, with_stderr, &error);

  name = g_path_get_basename (argv[0]);
  if (name == NULL)
    name = g_strdup (argv[0]);

  pipe = g_object_new (COCKPIT_TYPE_PIPE,
                       "name", name,
                       "in-fd", session_stdout,
                       "out-fd", session_stdin,
                       "err-fd", session_stderr,
                       "pid", pid,
                       NULL);

  /* Regardless of whether spawn succeeded or not */
  pipe->priv->is_process = TRUE;

  if (error)
    {
      if (g_error_matches (error, G_SPAWN_ERROR, G_SPAWN_ERROR_NOENT))
        problem = "not-found";
      else if (g_error_matches (error, G_SPAWN_ERROR, G_SPAWN_ERROR_PERM) ||
               g_error_matches (error, G_SPAWN_ERROR, G_SPAWN_ERROR_ACCES))
        problem = "access-denied";

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
      cockpit_close_later (pipe);
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
 * cockpit_pipe_pty:
 * @argv: null terminated string array of command arguments
 * @env: optional null terminated string array of child environment
 * @directory: optional working directory of child process
 *
 * Launch a child pty and create a CockpitPipe for it.
 *
 * If the pty or exec fails, a pipe is still returned. It will
 * close once the main loop is run with an appropriate problem.
 *
 * Returns: (transfer full): newly allocated CockpitPipe.
 */
CockpitPipe *
cockpit_pipe_pty (const gchar **argv,
                  const gchar **env,
                  const gchar *directory)
{
  CockpitPipe *pipe = NULL;
  const gchar *path = NULL;
  GPid pid = 0;
  int fd;
  struct winsize winsz = { 24, 80, 0, 0 };

  if (env)
    path = g_environ_getenv ((gchar **)env, "PATH");

  pid = forkpty (&fd, NULL, NULL, &winsz);
  if (pid == 0)
    {
      if (cockpit_unix_fd_close_all (3, -1) < 0)
        {
          g_printerr ("couldn't close file descriptors\n");
          _exit (127);
        }
      if (directory)
        {
          if (chdir (directory) < 0)
            {
              g_printerr ("couldn't change to directory: %s\n", g_strerror (errno));
              _exit (127);
            }
        }
      /* Allow the commands below to act on $PATH */
      if (path)
        putenv ((gchar *)path);
      if (env)
        execvpe (argv[0], (char *const *)argv, (char *const *)env);
      else
        execvp (argv[0], (char *const *)argv);
      g_printerr ("couldn't execute: %s: %s\n", argv[0], g_strerror (errno));
      _exit (127);
    }
  else if (pid < 0)
    {
      g_warning ("forkpty failed: %s", g_strerror (errno));
      pid = 0;
      fd = -1;
    }

  pipe = g_object_new (COCKPIT_TYPE_PIPE,
                       "name", argv[0],
                       "in-fd", fd,
                       "out-fd", fd,
                       "pid", pid,
                       NULL);

  if (fd < 0)
    {
      pipe->priv->problem = g_strdup ("internal-error");
      cockpit_close_later (pipe);
    }

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
gboolean
cockpit_pipe_get_pid (CockpitPipe *self,
                      GPid *pid)
{
  g_return_val_if_fail (COCKPIT_IS_PIPE (self), FALSE);
  if (!self->priv->is_process)
    return FALSE;
  if (pid)
    *pid = self->priv->pid;
  return TRUE;
}

/**
 * cockpit_pipe_get_name:
 * @self: a pipe
 *
 * Get the name of the pipe.
 *
 * This is used for logging.
 *
 * Returns: (transfer none): the name
 */
const gchar *
cockpit_pipe_get_name (CockpitPipe *self)
{
  g_return_val_if_fail (COCKPIT_IS_PIPE (self), NULL);
  return self->priv->name;
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

GByteArray *
cockpit_pipe_get_stderr (CockpitPipe *self)
{
  g_return_val_if_fail (COCKPIT_IS_PIPE (self), NULL);
  return self->priv->err_buffer;
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
 * @before: amount of preceeding bytes to discard
 * @length: length of data to consume
 * @after: amount of trailing bytes to discard
 *
 * Used to consume data from the buffer passed to the the
 * read signal.
 *
 * @before + @length + @after bytes will be removed from the @buffer,
 * and @length bytes will be returned.
 *
 * As an omptimization of @before + @length + @after is equal to the
 * entire length of the buffer, then the data will not
 * be copied but ownership will be transferred to the returned
 * bytes.
 *
 * Returns: (transfer full): the read bytes
 */
GBytes *
cockpit_pipe_consume (GByteArray *buffer,
                      gsize before,
                      gsize length,
                      gsize after)
{
  GBytes *bytes;
  guint8 *buf;

  g_return_val_if_fail (buffer != NULL, NULL);

  /* Optimize when we match full buffer length */
  if (buffer->len == before + length + after)
    {
      /* When array is reffed, this just clears byte array */
      g_byte_array_ref (buffer);
      buf = g_byte_array_free (buffer, FALSE);
      bytes = g_bytes_new_with_free_func (buf + before, length, g_free, buf);
    }
  else
    {
      bytes = g_bytes_new (buffer->data + before, length);
      g_byte_array_remove_range (buffer, 0, before + length + after);
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

/**
 * cockpit_pipe_new:
 * @name: a name for debugging
 * @in_fd: the input file descriptor
 * @out_fd: the output file descriptor
 *
 * Create a pipe for the given file descriptors.
 *
 * Returns: (transfer full): a new CockpitPipe
 */
CockpitPipe *
cockpit_pipe_new (const gchar *name,
                  gint in_fd,
                  gint out_fd)
{
  return g_object_new (COCKPIT_TYPE_PIPE,
                       "name", name,
                       "in-fd", in_fd,
                       "out-fd", out_fd,
                       NULL);
}
