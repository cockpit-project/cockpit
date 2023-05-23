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

#include "cockpitflow.h"
#include "cockpithacks.h"
#include "cockpitunicode.h"

#include <glib-unix.h>

#include <sys/socket.h>
#include <sys/uio.h>
#include <sys/wait.h>

#include <dirent.h>
#include <errno.h>
#include <poll.h>
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
 *
 * This pipe can do flow control in two ways:
 *
 *  - Its input can be throttled, it can listen to a "pressure" signal
 *    from another object passed into cockpit_flow_throttle()
 *  - It can optionally control another flow, by emitting a "pressure" signal
 *    when its output queue is too large
 */

#define DEF_PACKET_SIZE  (64UL * 1024UL)

enum {
  PROP_0,
  PROP_NAME,
  PROP_IN_FD,
  PROP_OUT_FD,
  PROP_ERR_FD,
  PROP_PID,
  PROP_PROBLEM,
};

typedef struct {
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
  gboolean out_done;
  GSource *out_source;
  GQueue *out_queue;
  gsize out_queued;
  gsize out_partial;

  int in_fd;
  gboolean in_done;
  GSource *in_source;
  GByteArray *in_buffer;

  int err_fd;
  gboolean err_done;
  GSource *err_source;
  GByteArray *err_buffer;
  gboolean err_forward_to_log;

  gboolean is_user_fd;

  /* Pressure which throttles input on this pipe */
  CockpitFlow *pressure;
  gulong pressure_sig;
} CockpitPipePrivate;

typedef struct {
  GSource source;
  CockpitPipe *pipe;
} CockpitPipeSource;

/* A megabyte is when we start to consider queue full enough */
#define QUEUE_PRESSURE 1024UL * 1024UL

static guint cockpit_pipe_sig_read;
static guint cockpit_pipe_sig_close;

static void  start_input         (CockpitPipe *self);

static void  start_output        (CockpitPipe *self);

static void  close_output        (CockpitPipe *self);

static void  cockpit_close_later (CockpitPipe *self);

static void  set_problem_from_errno (CockpitPipe *self,
                                     const gchar *message,
                                     int errn);

static void  cockpit_pipe_throttle  (CockpitFlow *flow,
                                     CockpitFlow *controlling);

static void  cockpit_pipe_flow_iface_init (CockpitFlowInterface *iface);

G_DEFINE_TYPE_WITH_CODE (CockpitPipe, cockpit_pipe, G_TYPE_OBJECT,
                         G_IMPLEMENT_INTERFACE (COCKPIT_TYPE_FLOW, cockpit_pipe_flow_iface_init)
                         G_ADD_PRIVATE (CockpitPipe));

static void
cockpit_pipe_init (CockpitPipe *self)
{
  CockpitPipePrivate *priv = cockpit_pipe_get_instance_private (self);

  priv->in_buffer = g_byte_array_new ();
  priv->in_fd = -1;
  priv->out_queue = g_queue_new ();
  priv->out_fd = -1;
  priv->err_fd = -1;
  priv->status = -1;

  priv->context = g_main_context_ref_thread_default ();
}

static void
stop_output (CockpitPipe *self)
{
  CockpitPipePrivate *priv = cockpit_pipe_get_instance_private (self);

  g_assert (priv->out_source != NULL);
  g_source_destroy (priv->out_source);
  g_source_unref (priv->out_source);
  priv->out_source = NULL;
}

static void
stop_input (CockpitPipe *self)
{
  CockpitPipePrivate *priv = cockpit_pipe_get_instance_private (self);

  g_assert (priv->in_source != NULL);
  g_source_destroy (priv->in_source);
  g_source_unref (priv->in_source);
  priv->in_source = NULL;
}

static void
stop_error (CockpitPipe *self)
{
  CockpitPipePrivate *priv = cockpit_pipe_get_instance_private (self);

  g_assert (priv->err_source != NULL);
  g_source_destroy (priv->err_source);
  g_source_unref (priv->err_source);
  priv->err_source = NULL;
}

static void
close_immediately (CockpitPipe *self,
                   const gchar *problem)
{
  CockpitPipePrivate *priv = cockpit_pipe_get_instance_private (self);

  if (priv->closed)
    return;

  if (problem)
    {
      g_free (priv->problem);
      priv->problem = g_strdup (problem);
    }

  priv->closed = TRUE;

  g_debug ("%s: closing pipe%s%s", priv->name,
           priv->problem ? ": " : "",
           priv->problem ? priv->problem : "");

  if (priv->in_source)
    stop_input (self);
  priv->in_done = TRUE;
  if (priv->out_source)
    stop_output (self);
  priv->out_done = TRUE;
  if (priv->err_source)
    stop_error (self);
  priv->err_done = TRUE;

  if (priv->in_fd != -1)
    {
      close (priv->in_fd);
      priv->in_fd = -1;
    }
  if (priv->out_fd != -1)
    {
      close (priv->out_fd);
      priv->out_fd = -1;
    }
  if (priv->err_fd != -1)
    {
      close (priv->err_fd);
      priv->err_fd = -1;
    }


  if (problem && priv->pid && !priv->exited)
    {
      g_debug ("%s: killing child: %d", priv->name, (int)priv->pid);
      kill (priv->pid, SIGTERM);
    }

  /* If not tracking a pid, then we are now closed. */
  if (!priv->child)
    {
      g_debug ("%s: no child process to wait for: closed", priv->name);
      g_signal_emit (self, cockpit_pipe_sig_close, 0, priv->problem);
    }
}

static void
close_maybe (CockpitPipe *self)
{
  CockpitPipePrivate *priv = cockpit_pipe_get_instance_private (self);

  if (!priv->closed)
    {
      if (priv->in_done && priv->out_done && priv->err_done)
        {
          g_debug ("%s: input and output done", priv->name);
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
  CockpitPipePrivate *priv = cockpit_pipe_get_instance_private (self);

  /* This happens if this child watch outlasts the pipe */
  if (!self)
    return;

  priv->status = status;
  priv->exited = TRUE;
  priv->watch_arg = NULL;

  /* Release our reference on watch handler */
  g_source_unref (priv->child);
  priv->child = NULL;

  /*
   * We need to wait until both the process has exited *and*
   * the output has closed before we fire our close signal.
   */

  g_debug ("%s: child process quit:%s  %d %d", priv->name,
           priv->closed ? " closed:" : "", (int)pid, status);

  /* Start input and output to get to completion */
  if (!priv->out_done)
    close_output (self);
  else if (priv->closed)
    g_signal_emit (self, cockpit_pipe_sig_close, 0, priv->problem);
}

static gboolean
dispatch_input (gint fd,
                GIOCondition cond,
                gpointer user_data)
{
  CockpitPipe *self = (CockpitPipe *)user_data;
  CockpitPipePrivate *priv = cockpit_pipe_get_instance_private (self);
  gssize ret = 0;
  gsize len;
  int errn;

  g_return_val_if_fail (priv->in_source, FALSE);
  len = priv->in_buffer->len;

  /*
   * Enable clean shutdown by not reading when we just get
   * G_IO_HUP. Note that when we get G_IO_ERR we do want to read
   * just so we can get the appropriate detailed error message.
   */
  if (cond != G_IO_HUP)
    {
      g_byte_array_set_size (priv->in_buffer, len + DEF_PACKET_SIZE);
      g_debug ("%s: reading input %x", priv->name, cond);
      ret = read (priv->in_fd, priv->in_buffer->data + len, DEF_PACKET_SIZE);

      errn = errno;
      if (ret < 0)
        {
          g_byte_array_set_size (priv->in_buffer, len);
          if (errn == EAGAIN || errn == EINTR)
            {
              return TRUE;
            }
          else if (errn == ECONNRESET)
            {
              g_debug ("couldn't read: %s", g_strerror (errn));
              ret = 0;
            }
          else
            {
              set_problem_from_errno (self, "couldn't read", errn);
              close_immediately (self, NULL); /* problem already set */
              return FALSE;
            }
        }
    }

  g_byte_array_set_size (priv->in_buffer, len + ret);

  if (ret == 0)
    {
      g_debug ("%s: end of input", priv->name);
      priv->in_done = TRUE;
      stop_input (self);
    }

  g_object_ref (self);

  g_signal_emit (self, cockpit_pipe_sig_read, 0, priv->in_buffer, priv->in_done);

  if (priv->in_done)
    close_maybe (self);

  g_object_unref (self);
  return TRUE;
}

static void
forward_error (CockpitPipe *self)
{
  CockpitPipePrivate *priv = cockpit_pipe_get_instance_private (self);

  if (priv->err_buffer->len > 0)
    {
      g_warning ("%s: unexpected stderr output: %.*s", priv->name, priv->err_buffer->len, priv->err_buffer->data);
      g_byte_array_set_size (priv->err_buffer, 0);
    }
}

static gboolean
dispatch_error (gint fd,
                GIOCondition cond,
                gpointer user_data)
{
  CockpitPipe *self = (CockpitPipe *)user_data;
  CockpitPipePrivate *priv = cockpit_pipe_get_instance_private (self);
  gssize ret = 0;
  gsize len;

  g_return_val_if_fail (priv->err_source, FALSE);
  len = priv->err_buffer->len;

  /*
   * Enable clean shutdown by not reading when we just get
   * G_IO_HUP. Note that when we get G_IO_ERR we do want to read
   * just so we can get the appropriate detailed error message.
   */
  if (cond != G_IO_HUP)
    {
      g_debug ("%s: reading error", priv->name);

      g_byte_array_set_size (priv->err_buffer, len + 1024);
      ret = read (priv->err_fd, priv->err_buffer->data + len, 1024);
      if (ret < 0)
        {
          g_byte_array_set_size (priv->err_buffer, len);
          if (errno != EAGAIN && errno != EINTR)
            {
              g_warning ("%s: couldn't read error: %s", priv->name, g_strerror (errno));
              close_immediately (self, "internal-error");
              return FALSE;
            }

          if (priv->err_forward_to_log)
            forward_error (self);

          return TRUE;
        }
    }

  g_byte_array_set_size (priv->err_buffer, len + ret);

  if (priv->err_forward_to_log)
    forward_error (self);

  if (ret == 0)
    {
      g_debug ("%s: end of error", priv->name);
      priv->err_done = TRUE;
      stop_error (self);
    }

  g_object_ref (self);

  if (priv->err_done)
    close_maybe (self);

  g_object_unref (self);
  return TRUE;
}

static gboolean
fd_readable (int fd)
{
  struct pollfd pfd = { .fd = fd, .events = POLLIN };
  return poll (&pfd, 1, 0) > 0 && (pfd.revents & POLLIN);
}

static void
drain_error (CockpitPipe *self)
{
  CockpitPipePrivate *priv = cockpit_pipe_get_instance_private (self);

  while (priv->err_source && fd_readable (priv->err_fd))
    dispatch_error (priv->err_fd, G_IO_IN, self);
}

static void
close_output (CockpitPipe *self)
{
  CockpitPipePrivate *priv = cockpit_pipe_get_instance_private (self);

  priv->out_done = TRUE;

  if (priv->out_fd != -1)
    {
      g_debug ("%s: end of output", priv->name);

      /* And if closing, then we need to shutdown the output fd */
      if (shutdown (priv->out_fd, SHUT_WR) < 0)
        {
          if (errno == ENOTSOCK)
            {
              g_debug ("%s: not a socket, closing entirely", priv->name);
              close (priv->out_fd);

              if (priv->in_fd == priv->out_fd)
                {
                  priv->in_done = TRUE;
                  priv->in_fd = -1;
                  if (priv->in_source)
                    {
                      g_debug ("%s: and closing input because same fd", priv->name);
                      stop_input (self);
                    }
                }

              priv->out_fd = -1;
            }
          else
            {
              g_warning ("%s: couldn't shutdown fd: %s", priv->name, g_strerror (errno));
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
  CockpitPipePrivate *priv = cockpit_pipe_get_instance_private (self);
  const gchar *problem = NULL;

  if (errn == EPERM || errn == EACCES)
    problem = "access-denied";
  else if (errn == ENOENT || errn == ECONNREFUSED)
    problem = "not-found";
  /* only warn about Cockpit-internal fds, not opaque user ones */
  else if (errn == EBADF && priv->is_user_fd)
    problem = "protocol-error";

  g_free (priv->problem);

  if (problem)
    {
      g_message ("%s: %s: %s", priv->name, message, g_strerror (errn));
      priv->problem = g_strdup (problem);
    }
  else
    {
      g_warning ("%s: %s: %s", priv->name, message, g_strerror (errn));
      priv->problem = g_strdup ("internal-error");
    }
}

static gboolean
dispatch_connect (CockpitPipe *self)
{
  CockpitPipePrivate *priv = cockpit_pipe_get_instance_private (self);
  socklen_t slen;
  int error;

  priv->connecting = FALSE;

  slen = sizeof (error);
  if (getsockopt (priv->out_fd, SOL_SOCKET, SO_ERROR, &error, &slen) != 0)
    {
      g_warning ("%s: couldn't get connection result", priv->name);
      close_immediately (self, "internal-error");
    }
  else if (error == EINPROGRESS)
    {
      /* keep connecting */
      priv->connecting = TRUE;
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

  return FALSE;
}

static gboolean
dispatch_output (gint fd,
                 GIOCondition cond,
                 gpointer user_data)
{
  CockpitPipe *self = (CockpitPipe *)user_data;
  CockpitPipePrivate *priv = cockpit_pipe_get_instance_private (self);
  struct iovec iov[4];
  gsize partial, size, before;
  GBytes *popped;
  gssize ret;
  gint i, count;
  GList *l;

  /* A non-blocking connect is processed here */
  if (priv->connecting && !dispatch_connect (self))
    return TRUE;

  g_return_val_if_fail (priv->out_source, FALSE);

  before = priv->out_queued;

  /* Note we fall through when nothing to write */
  partial = priv->out_partial;
  for (l = priv->out_queue->head, i = 0;
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
    ret = writev (priv->out_fd, iov, count);
  if (ret < 0)
    {
      if (errno != EAGAIN && errno != EINTR)
        {
          if (errno == EPIPE)
            {
              g_debug ("%s: couldn't write: %s", priv->name, g_strerror (errno));
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
          g_debug ("%s: wrote %d bytes", priv->name, (int)iov[i].iov_len);
          popped = g_queue_pop_head (priv->out_queue);
          size = g_bytes_get_size (popped);
          g_assert (size <= priv->out_queued);
          priv->out_queued -= size;
          g_bytes_unref (popped);
          priv->out_partial = 0;
          ret -= iov[i].iov_len;
        }
      else
        {
          g_debug ("%s: partial write %d of %d bytes", priv->name,
                   (int)ret, (int)iov[i].iov_len);
          priv->out_partial += ret;
          ret = 0;
        }
    }

  /*
   * If we're controlling another flow, turn it on again when our output
   * buffer size becomes less than the low mark.
   */
  if (before >= QUEUE_PRESSURE && priv->out_queued < QUEUE_PRESSURE)
    {
      g_debug ("%s: have %" G_GSIZE_FORMAT " bytes queued, releasing pressure", priv->name, priv->out_queued);
      cockpit_flow_emit_pressure (COCKPIT_FLOW (self), FALSE);
    }

  if (priv->out_queue->head)
    return TRUE;

  g_debug ("%s: output queue empty", priv->name);

  /* If all messages are done, then stop polling out fd */
  stop_output (self);

  if (priv->closing)
    close_output (self);
  else
    close_maybe (self);

  return TRUE;
}

static void
start_output (CockpitPipe *self)
{
  CockpitPipePrivate *priv = cockpit_pipe_get_instance_private (self);

  g_assert (priv->out_source == NULL);
  priv->out_source = g_unix_fd_source_new (priv->out_fd, G_IO_OUT);
  g_source_set_name (priv->out_source, "pipe-output");
  g_source_set_callback (priv->out_source, (GSourceFunc)dispatch_output, self, NULL);
  g_source_attach (priv->out_source, priv->context);
}

static void
start_input (CockpitPipe *self)
{
  CockpitPipePrivate *priv = cockpit_pipe_get_instance_private (self);

  g_assert (priv->in_source == NULL);
  priv->in_source = g_unix_fd_source_new (priv->in_fd, G_IO_IN);
  g_source_set_name (priv->in_source, "pipe-input");
  g_source_set_callback (priv->in_source, (GSourceFunc)dispatch_input, self, NULL);
  g_source_attach (priv->in_source, priv->context);
}

static void
cockpit_pipe_constructed (GObject *object)
{
  CockpitPipe *self = COCKPIT_PIPE (object);
  CockpitPipePrivate *priv = cockpit_pipe_get_instance_private (self);
  GError *error = NULL;

  G_OBJECT_CLASS (cockpit_pipe_parent_class)->constructed (object);

  if (priv->name == NULL)
    priv->name = g_strdup ("pipe");

  if (priv->in_fd >= 0)
    {
      if (!g_unix_set_fd_nonblocking (priv->in_fd, TRUE, &error))
        {
          g_warning ("%s: couldn't set file descriptor to non-blocking: %s",
                     priv->name, error->message);
          g_clear_error (&error);
        }

      start_input (self);
    }
  else
    {
      priv->in_done = TRUE;
    }

  if (priv->out_fd >= 0)
    {
      if (!g_unix_set_fd_nonblocking (priv->out_fd, TRUE, &error))
        {
          g_warning ("%s: couldn't set file descriptor to non-blocking: %s",
                     priv->name, error->message);
          g_clear_error (&error);
        }
      start_output (self);
    }
  else
    {
      priv->out_done = TRUE;
    }

  if (priv->err_fd >= 0)
    {
      if (!g_unix_set_fd_nonblocking (priv->err_fd, TRUE, &error))
        {
          g_warning ("%s: couldn't set file descriptor to non-blocking: %s",
                     priv->name, error->message);
          g_clear_error (&error);
        }

      priv->err_buffer = g_byte_array_new ();
      priv->err_source = g_unix_fd_source_new (priv->err_fd, G_IO_IN);
      g_source_set_name (priv->err_source, "pipe-error");
      g_source_set_callback (priv->err_source, (GSourceFunc)dispatch_error, self, NULL);
      g_source_attach (priv->err_source, priv->context);
    }
  else
    {
      priv->err_done = TRUE;
    }

  if (priv->pid)
    {
      priv->is_process = TRUE;

      /* We may need this watch to outlast this process ... */
      priv->watch_arg = g_new0 (CockpitPipe *, 1);
      *(priv->watch_arg) = self;

      priv->child = g_child_watch_source_new (priv->pid);
      g_source_set_callback (priv->child, (GSourceFunc)on_child_reap,
                             priv->watch_arg, g_free);
      g_source_attach (priv->child, priv->context);
    }
}

static void
cockpit_pipe_set_property (GObject *obj,
                           guint prop_id,
                           const GValue *value,
                           GParamSpec *pspec)
{
  CockpitPipe *self = COCKPIT_PIPE (obj);
  CockpitPipePrivate *priv = cockpit_pipe_get_instance_private (self);

  switch (prop_id)
    {
      case PROP_NAME:
        priv->name = g_value_dup_string (value);
        break;
      case PROP_IN_FD:
        priv->in_fd = g_value_get_int (value);
        break;
      case PROP_OUT_FD:
        priv->out_fd = g_value_get_int (value);
        break;
      case PROP_ERR_FD:
        priv->err_fd = g_value_get_int (value);
        break;
      case PROP_PID:
        priv->pid = g_value_get_int (value);
        break;
      case PROP_PROBLEM:
        priv->problem = g_value_dup_string (value);
        if (priv->problem)
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
  CockpitPipePrivate *priv = cockpit_pipe_get_instance_private (self);

  switch (prop_id)
  {
    case PROP_NAME:
      g_value_set_string (value, priv->name);
      break;
    case PROP_IN_FD:
      g_value_set_int (value, priv->in_fd);
      break;
    case PROP_OUT_FD:
      g_value_set_int (value, priv->out_fd);
      break;
    case PROP_ERR_FD:
      g_value_set_int (value, priv->err_fd);
      break;
    case PROP_PID:
      g_value_set_int (value, priv->pid);
      break;
    case PROP_PROBLEM:
      g_value_set_string (value, priv->problem);
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
  CockpitPipePrivate *priv = cockpit_pipe_get_instance_private (self);

  if (priv->pid && !priv->exited)
    {
      g_debug ("%s: killing child: %d", priv->name, (int)priv->pid);
      kill (priv->pid, SIGTERM);
    }

  if (!priv->closed)
    close_immediately (self, "terminated");

  cockpit_pipe_throttle (COCKPIT_FLOW (self), NULL);
  g_assert (priv->pressure == NULL);

  while (priv->out_queue->head)
    g_bytes_unref (g_queue_pop_head (priv->out_queue));
  priv->out_queued = 0;

  G_OBJECT_CLASS (cockpit_pipe_parent_class)->dispose (object);
}

static void
cockpit_pipe_finalize (GObject *object)
{
  CockpitPipe *self = COCKPIT_PIPE (object);
  CockpitPipePrivate *priv = cockpit_pipe_get_instance_private (self);

  g_assert (priv->closed);
  g_assert (!priv->in_source);
  g_assert (!priv->out_source);

  /* Release our reference on watch handler */
  if (priv->child)
    g_source_unref (priv->child);

  /*
   * Tell the child watch that we've gone away ...
   * But note that if the child watch hasn't fired, it'll continue to wait
   */
  if (priv->watch_arg)
    *(priv->watch_arg) = NULL;

  g_byte_array_unref (priv->in_buffer);
  if (priv->err_buffer)
    g_byte_array_unref (priv->err_buffer);
  g_queue_free (priv->out_queue);
  g_free (priv->problem);
  g_free (priv->name);

  if (priv->context)
    g_main_context_unref (priv->context);

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
  CockpitPipePrivate *priv = cockpit_pipe_get_instance_private (self);
  gsize size, before;

  g_return_if_fail (COCKPIT_IS_PIPE (self));

  /* If priv->io is already gone but we are still waiting for the
     child to exit, then we haven't emitted the "close" signal yet
     and it isn't an error to try to send more messages.  We drop them
     here.
  */
  if (priv->closed && priv->child && priv->pid != 0)
    {
      g_debug ("%s: dropping message while waiting for child to exit", priv->name);
      return;
    }

  /*
   * Debugging this issue so have made thingcs more verbose.
   * HACK: https://github.com/cockpit-project/cockpit/issues/2978
   */
  if (priv->closed)
    {
      g_critical ("assertion priv->closed check failed at %s %d (%p %d)",
                  caller, line, priv->child, priv->pid);
      return;
    }

  size = g_bytes_get_size (data);
  if (size == 0)
    {
      g_debug ("%s: ignoring zero byte data block", priv->name);
      return;
    }

  before = priv->out_queued;
  g_return_if_fail (G_MAXSIZE - size > priv->out_queued);
  priv->out_queued += size;
  g_queue_push_tail (priv->out_queue, g_bytes_ref (data));

  /*
   * If we have too much data queued, and are controlling another flow
   * tell it to stop sending data, each time we cross over the high bound.
   */
  if (before < QUEUE_PRESSURE && priv->out_queued >= QUEUE_PRESSURE)
    {
      g_debug ("%s: have %" G_GSIZE_FORMAT "bytes queued, emitting pressure", priv->name, priv->out_queued);
      cockpit_flow_emit_pressure (COCKPIT_FLOW (self), TRUE);
    }

  if (!priv->out_source && priv->out_fd >= 0)
    {
      start_output (self);
    }

  /*
   * If this becomes thread-safe, then something like this is needed:
   * g_main_context_wakeup (g_source_get_context (priv->source));
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
  CockpitPipePrivate *priv = cockpit_pipe_get_instance_private (self);

  g_return_if_fail (COCKPIT_IS_PIPE (self));

  priv->closing = TRUE;

  if (problem)
      close_immediately (self, problem);
  else if (g_queue_is_empty (priv->out_queue))
    close_output (self);
  else
    g_debug ("%s: pipe closing when output queue empty", priv->name);
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
  CockpitPipePrivate *priv;
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
        {
          close (sock);
          g_return_val_if_reached (NULL);
        }

      native_len = g_socket_address_get_native_size (address);
      native = g_malloc (native_len);
      if (!g_socket_address_to_native (address, native, native_len, NULL))
        {
          close (sock);
          g_return_val_if_reached (NULL);
        }
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
  priv = cockpit_pipe_get_instance_private (pipe);

  priv->connecting = connecting;
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

  if (flags & COCKPIT_PIPE_STDERR_TO_STDOUT) {
    int r = dup2 (1, 2);
    g_assert (r == 2); /* that should really never fail */
  }
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
  CockpitPipePrivate *priv;
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

  priv = cockpit_pipe_get_instance_private (pipe);

  /* Regardless of whether spawn succeeded or not */
  priv->is_process = TRUE;

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
      priv->problem = g_strdup (problem);
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
 * @window_rows: initial number of rows in the window
 * @window_cols: initial number of columns in the window
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
                  const gchar *directory,
                  guint16 window_rows,
                  guint16 window_cols)
{
  CockpitPipe *pipe = NULL;
  CockpitPipePrivate *priv;
  const gchar *path = NULL;
  GPid pid = 0;
  int fd;
  struct winsize winsz = { window_rows, window_cols, 0, 0 };

  if (env)
    path = g_environ_getenv ((gchar **)env, "PATH");

  pid = forkpty (&fd, NULL, NULL, &winsz);
  if (pid == 0)
    {
      closefrom (3);

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

  priv = cockpit_pipe_get_instance_private (pipe);

  if (fd < 0)
    {
      priv->problem = g_strdup ("internal-error");
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
  CockpitPipePrivate *priv = cockpit_pipe_get_instance_private (self);

  g_return_val_if_fail (COCKPIT_IS_PIPE (self), FALSE);
  if (!priv->is_process)
    return FALSE;
  if (pid)
    *pid = priv->pid;
  return TRUE;
}

/**
 * cockpit_pipe_is_closed:
 * @self: a pipe
 *
 * Returns: TRUE if the pipe is closed
 */
gboolean
cockpit_pipe_is_closed (CockpitPipe *self)
{
  CockpitPipePrivate *priv = cockpit_pipe_get_instance_private (self);

  g_return_val_if_fail (COCKPIT_IS_PIPE (self), FALSE);

  return priv->closed;
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
  CockpitPipePrivate *priv = cockpit_pipe_get_instance_private (self);

  g_return_val_if_fail (COCKPIT_IS_PIPE (self), NULL);
  return priv->name;
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
  CockpitPipePrivate *priv = cockpit_pipe_get_instance_private (self);

  g_return_val_if_fail (COCKPIT_IS_PIPE (self), NULL);
  return priv->in_buffer;
}

GByteArray *
cockpit_pipe_get_stderr (CockpitPipe *self)
{
  CockpitPipePrivate *priv = cockpit_pipe_get_instance_private (self);

  g_return_val_if_fail (COCKPIT_IS_PIPE (self), NULL);
  return priv->err_buffer;
}

gchar *
cockpit_pipe_take_stderr_as_utf8 (CockpitPipe *self)
{
  GByteArray *buffer;
  GBytes *clean;
  gchar *data;
  gsize length;

  drain_error (self);

  buffer = cockpit_pipe_get_stderr (self);
  if (!buffer)
    return NULL;

  /* A little more complicated to avoid big copies */
  g_byte_array_ref (buffer);
  g_byte_array_append (buffer, (guint8 *)"x", 1); /* place holder for null terminate */

  {
    g_autoptr(GBytes) bytes = g_byte_array_free_to_bytes (buffer);
    clean = cockpit_unicode_force_utf8 (bytes);
  }

  data = g_bytes_unref_to_data (clean, &length);

  /* Fill in null terminate, for x above */
  g_assert (length > 0);
  data[length - 1] = '\0';

  return data;
}

void
cockpit_pipe_stop_stderr_capture (CockpitPipe *self)
{
  CockpitPipePrivate *priv = cockpit_pipe_get_instance_private (self);

  if (priv->err_buffer)
    {
      priv->err_forward_to_log = TRUE;
      forward_error (self);
    }
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
  CockpitPipePrivate *priv = cockpit_pipe_get_instance_private (self);

  g_return_val_if_fail (COCKPIT_IS_PIPE (self), -1);
  return priv->status;
}

/**
 * cockpit_pipe_consume:
 * @buffer: a data buffer
 * @before: amount of preceding bytes to discard
 * @length: length of data to consume
 * @after: amount of trailing bytes to discard
 *
 * Used to consume data from the buffer passed to the
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

/**
 * cockpit_pipe_new_user_fd:
 * @name: a name for debugging
 * @fd: the file descriptor (might be input or output or both)
 *
 * Create a pipe for the given user-supplied opaque file descriptor. This is
 * not being read/written by cockpit itself, but intended for passing fds.
 *
 * Returns: (transfer full): a new CockpitPipe
 */
CockpitPipe *
cockpit_pipe_new_user_fd (const gchar *name,
                          gint fd)
{
  CockpitPipe *p = g_object_new (COCKPIT_TYPE_PIPE,
                                 "name", name,
                                 "in-fd", fd,
                                 "out-fd", fd,
                                 NULL);
  CockpitPipePrivate *priv = cockpit_pipe_get_instance_private (p);
  priv->is_user_fd = TRUE;
  return p;
}

static gint
environ_find (gchar **env,
              const gchar *variable)
{
  gint len, x;
  gchar *pos;

  pos = strchr (variable, '=');
  if (pos == NULL)
    len = strlen (variable);
  else
    len = pos - variable;

  for (x = 0; env && env[x]; x++)
    {
      if (strncmp (env[x], variable, len) == 0 &&
          env[x][len] == '=')
        return x;
    }

  return -1;
}

/**
 * cockpit_pipe_get_environ:
 * @input: Input environment array
 * @directory: Working directory to put in environment
 *
 * Prepares an environment for spawning a CockpitPipe process.
 * This merges the fields in @input with the current process
 * environment.
 *
 * This is the standard way of processing an "environ" field
 * in either an "open" message or a "bridges" definition in
 * manifest.json.
 *
 * The current working @directory for the new process is
 * optionally specified. It will set a $PWD environment
 * variable as expected by shells.
 *
 * Returns: (transfer full): A new environment block to
 *          be freed with g_strfreev().
 */
gchar **
cockpit_pipe_get_environ (const gchar **input,
                          const gchar *directory)
{
  gchar **env = g_get_environ ();
  gsize length = g_strv_length (env);
  gboolean had_pwd = FALSE;
  gint i, x;

  for (i = 0; input && input[i] != NULL; i++)
    {
      if (g_str_has_prefix (input[i], "PWD="))
        had_pwd = TRUE;
      x = environ_find (env, input[i]);
      if (x != -1)
        {
          g_free (env[x]);
          env[x] = g_strdup (input[i]);
        }
      else
        {
          env = g_renew (gchar *, env, length + 2);
          env[length] = g_strdup (input[i]);
          env[length + 1] = NULL;
          length++;
        }
    }

  /*
   * The kernel only knows about the inode of the current directory.
   * So when we spawn a shell, it won't know the directory it's
   * meant to display. Pass it the path we care about in $PWD
   */
  if (!had_pwd && directory)
    env = g_environ_setenv (env, "PWD", directory, TRUE);

  return env;
}

static void
on_throttle_pressure (GObject *object,
                      gboolean throttle,
                      gpointer user_data)
{
  CockpitPipe *self = COCKPIT_PIPE (user_data);
  CockpitPipePrivate *priv = cockpit_pipe_get_instance_private (self);

  if (throttle)
    {
      if (priv->in_source != NULL)
        {
          g_debug ("%s: applying back pressure in pipe", priv->name);
          stop_input (self);
        }
    }
  else
    {
      if (priv->in_source == NULL && !priv->in_done)
        {
          g_debug ("%s: relieving back pressure in pipe", priv->name);
          start_input (self);
        }
    }
}

static void
cockpit_pipe_throttle (CockpitFlow *flow,
                       CockpitFlow *controlling)
{
  CockpitPipe *self = COCKPIT_PIPE (flow);
  CockpitPipePrivate *priv = cockpit_pipe_get_instance_private (self);

  if (priv->pressure)
    {
      g_signal_handler_disconnect (priv->pressure, priv->pressure_sig);
      g_object_remove_weak_pointer (G_OBJECT (priv->pressure), (gpointer *)&priv->pressure);
      priv->pressure = NULL;
    }

  if (controlling)
    {
      priv->pressure = controlling;
      g_object_add_weak_pointer (G_OBJECT (priv->pressure), (gpointer *)&priv->pressure);
      priv->pressure_sig = g_signal_connect (controlling, "pressure", G_CALLBACK (on_throttle_pressure), self);
    }
}

static void
cockpit_pipe_flow_iface_init (CockpitFlowInterface *iface)
{
  iface->throttle = cockpit_pipe_throttle;
}
