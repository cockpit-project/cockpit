/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

#include "config.h"

#include "cockpitstream.h"

#include "common/cockpitflow.h"
#include "common/cockpitjson.h"

#include <errno.h>
#include <string.h>

/**
 * CockpitStream:
 *
 * A stream with queued input and output based on top of a GIOStream
 *
 * This stream can do flow control in two ways:
 *
 *  - Its input can be throttled, it can listen to a "pressure" signal
 *    from another object passed into cockpit_stream_throttle()
 *  - It can optionally control another flow, by emitting a "pressure" signal
 *    when its output queue is too large
 */

enum {
  PROP_0,
  PROP_NAME,
  PROP_IO_STREAM,
  PROP_PROBLEM
};

typedef struct {
  gchar *name;
  GMainContext *context;

  gboolean closed;
  gboolean closing;
  CockpitConnectable *connecting;
  gchar *problem;

  GIOStream *io;

  GSource *out_source;
  GQueue *out_queue;
  gsize out_queued;
  gsize out_partial;
  gboolean out_closed;

  gboolean in_done;
  GSource *in_source;
  GByteArray *in_buffer;
  gboolean received;

  /* Throttle this flow based on back pressure from another object */
  CockpitFlow *pressure;
  gulong pressure_sig;
} CockpitStreamPrivate;

/* A megabyte is when we start to consider queue full enough */
#define QUEUE_PRESSURE 1024UL * 1024UL

static guint cockpit_stream_sig_open;
static guint cockpit_stream_sig_read;
static guint cockpit_stream_sig_close;

static void  cockpit_close_later (CockpitStream *self);

static void  cockpit_stream_flow_iface_init (CockpitFlowInterface *iface);

G_DEFINE_TYPE_WITH_CODE (CockpitStream, cockpit_stream, G_TYPE_OBJECT,
                         G_ADD_PRIVATE(CockpitStream)
                         G_IMPLEMENT_INTERFACE (COCKPIT_TYPE_FLOW, cockpit_stream_flow_iface_init));

#define GET_PRIV(self)  ((CockpitStreamPrivate *) cockpit_stream_get_instance_private(self))

static void
cockpit_stream_init (CockpitStream *self)
{
  GET_PRIV(self)->in_buffer = g_byte_array_new ();
  GET_PRIV(self)->out_queue = g_queue_new ();

  GET_PRIV(self)->context = g_main_context_ref_thread_default ();
}

static void
stop_output (CockpitStream *self)
{
  g_assert (GET_PRIV(self)->out_source != NULL);
  g_source_destroy (GET_PRIV(self)->out_source);
  g_source_unref (GET_PRIV(self)->out_source);
  GET_PRIV(self)->out_source = NULL;
}

static void
stop_input (CockpitStream *self)
{
  g_assert (GET_PRIV(self)->in_source != NULL);
  g_source_destroy (GET_PRIV(self)->in_source);
  g_source_unref (GET_PRIV(self)->in_source);
  GET_PRIV(self)->in_source = NULL;
}

static void
close_immediately (CockpitStream *self,
                   const gchar *problem)
{
  GError *error = NULL;
  GIOStream *io;

  if (GET_PRIV(self)->closed)
    return;

  if (problem)
    {
      g_free (GET_PRIV(self)->problem);
      GET_PRIV(self)->problem = g_strdup (problem);
    }

  if (GET_PRIV(self)->connecting)
    {
      cockpit_connectable_unref (GET_PRIV(self)->connecting);
      GET_PRIV(self)->connecting = NULL;
    }

  GET_PRIV(self)->closed = TRUE;

  g_debug ("%s: closing stream%s%s", GET_PRIV(self)->name,
           GET_PRIV(self)->problem ? ": " : "",
           GET_PRIV(self)->problem ? GET_PRIV(self)->problem : "");

  if (GET_PRIV(self)->in_source)
    stop_input (self);
  if (GET_PRIV(self)->out_source)
    stop_output (self);

  if (GET_PRIV(self)->io)
    {
      io = GET_PRIV(self)->io;
      GET_PRIV(self)->io = NULL;

      g_io_stream_close (io, NULL, &error);
      if (error)
        {
          g_message ("%s: close failed: %s", GET_PRIV(self)->name, error->message);
          g_clear_error (&error);
        }
      g_object_unref (io);
    }

  g_debug ("%s: closed", GET_PRIV(self)->name);
  g_signal_emit (self, cockpit_stream_sig_close, 0, GET_PRIV(self)->problem);
}

static void
close_maybe (CockpitStream *self)
{
  if (!GET_PRIV(self)->closed)
    {
      if (GET_PRIV(self)->in_done && GET_PRIV(self)->out_closed)
        {
          g_debug ("%s: input and output done", GET_PRIV(self)->name);
          close_immediately (self, NULL);
        }
    }
}

static void
on_output_closed (GObject *object,
                  GAsyncResult *result,
                  gpointer user_data)
{
  CockpitStream *self = COCKPIT_STREAM (user_data);
  GError *error = NULL;

  GET_PRIV(self)->out_closed = TRUE;

  g_output_stream_close_finish (G_OUTPUT_STREAM (object), result, &error);
  if (error)
    {
      g_warning ("%s: couldn't close output stream: %s", GET_PRIV(self)->name, error->message);
      close_immediately (self, "internal-error");
    }

  close_maybe (self);
  g_object_unref (self);
}

static void
close_output (CockpitStream *self)
{
  if (GET_PRIV(self)->out_closed)
    return;

  g_debug ("%s: end of output", GET_PRIV(self)->name);

  if (!GET_PRIV(self)->io)
    {
      close_maybe (self);
      return;
    }

  g_output_stream_close_async (g_io_stream_get_output_stream (GET_PRIV(self)->io),
                               G_PRIORITY_DEFAULT, NULL, on_output_closed, g_object_ref (self));
}

#if !GLIB_CHECK_VERSION(2,43,2)
#define G_IO_ERROR_CONNECTION_CLOSED G_IO_ERROR_BROKEN_PIPE
#endif

const gchar *
cockpit_stream_problem (GError *error,
                        const gchar *name,
                        const gchar *summary,
                        JsonObject *options)
{
  const gchar *problem = NULL;
  gchar *message;

  if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_PERMISSION_DENIED))
    problem = "access-denied";
  else if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_NOT_FOUND) ||
           g_error_matches (error, G_IO_ERROR, G_IO_ERROR_CONNECTION_REFUSED) ||
           g_error_matches (error, G_IO_ERROR, G_IO_ERROR_HOST_UNREACHABLE) ||
           g_error_matches (error, G_IO_ERROR, G_IO_ERROR_NETWORK_UNREACHABLE) ||
           g_error_matches (error, G_IO_ERROR, G_IO_ERROR_HOST_NOT_FOUND) ||
           g_error_matches (error, G_RESOLVER_ERROR, G_RESOLVER_ERROR_NOT_FOUND))
    problem = "not-found";
  else if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_BROKEN_PIPE) ||
           g_error_matches (error, G_IO_ERROR, G_IO_ERROR_CONNECTION_CLOSED) ||
           g_error_matches (error, G_TLS_ERROR, G_TLS_ERROR_EOF))
    problem = "disconnected";
#if !GLIB_CHECK_VERSION(2,43,2)
  else if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_FAILED) &&
           strstr (error->message, g_strerror (ECONNRESET)))
    problem = "disconnected";
#endif
  else if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_TIMED_OUT))
    problem = "timeout";
  else if (g_error_matches (error, G_TLS_ERROR, G_TLS_ERROR_NOT_TLS) ||
           g_error_matches (error, G_TLS_ERROR, G_TLS_ERROR_MISC))
    problem = "protocol-error";
  else if (g_error_matches (error, G_TLS_ERROR, G_TLS_ERROR_BAD_CERTIFICATE))
    {
      problem = "unknown-hostkey";
    }

  if (problem)
    {
      message = g_strdup_printf ("%s: %s: %s", name, summary, error->message);
    }
  else
    {
      message = g_strdup_printf ("%s: %s: %s", name, summary, error->message);
      problem = "internal-error";
    }
  if (options)
    {
      if (!json_object_has_member (options, "message"))
        json_object_set_string_member (options, "message", message);
    }
  g_message ("%s", message);
  g_free (message);

  return problem;
}

static void
set_problem_from_error (CockpitStream *self,
                        const gchar *summary,
                        GError *error)
{
  const gchar *problem;

  if (g_error_matches (error, G_TLS_ERROR, G_TLS_ERROR_MISC))
    {
      g_message ("%s: %s: %s", GET_PRIV(self)->name, summary, error->message);
      if (GET_PRIV(self)->received)
        problem = "disconnected";
      else
        problem = "protocol-error";
    }
  else
    {
      problem = cockpit_stream_problem (error, GET_PRIV(self)->name, summary, NULL);
    }

  g_free (GET_PRIV(self)->problem);
  GET_PRIV(self)->problem = g_strdup (problem);
}

static gboolean
dispatch_input (GPollableInputStream *is,
                gpointer user_data)
{
  CockpitStream *self = (CockpitStream *)user_data;
  GError *error = NULL;
  gboolean read = FALSE;
  gssize ret = 0;
  gsize len;

  for (;;)
    {
      g_return_val_if_fail (GET_PRIV(self)->in_source, FALSE);
      len = GET_PRIV(self)->in_buffer->len;

      g_byte_array_set_size (GET_PRIV(self)->in_buffer, len + 1024);
      ret = g_pollable_input_stream_read_nonblocking (is, GET_PRIV(self)->in_buffer->data + len,
                                                      1024, NULL, &error);

      if (ret < 0)
        {
          g_byte_array_set_size (GET_PRIV(self)->in_buffer, len);
          if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_WOULD_BLOCK))
            {
              g_error_free (error);
              break;
            }
          else
            {
              set_problem_from_error (self, "couldn't read", error);
              g_error_free (error);
              close_immediately (self, NULL);
              return FALSE;
            }
        }

      g_byte_array_set_size (GET_PRIV(self)->in_buffer, len + ret);

      if (ret == 0)
        {
          g_debug ("%s: end of input", GET_PRIV(self)->name);
          GET_PRIV(self)->in_done = TRUE;
          stop_input (self);
          break;
        }

      g_debug ("%s: read %d bytes", GET_PRIV(self)->name, (int)ret);
      GET_PRIV(self)->received = TRUE;
      read = TRUE;
    }

  g_object_ref (self);

  if (GET_PRIV(self)->in_done || read)
    g_signal_emit (self, cockpit_stream_sig_read, 0, GET_PRIV(self)->in_buffer, GET_PRIV(self)->in_done);

  if (GET_PRIV(self)->in_done)
    close_maybe (self);

  g_object_unref (self);
  return TRUE;
}

static gboolean
dispatch_output (GPollableOutputStream *os,
                 gpointer user_data)
{
  CockpitStream *self = (CockpitStream *)user_data;
  GError *error = NULL;
  const gint8 *data;
  gsize len, size, before;
  GBytes *popped;
  gssize ret;

  g_return_val_if_fail (GET_PRIV(self)->out_source, FALSE);
  while (GET_PRIV(self)->out_queue->head)
    {
      data = g_bytes_get_data (GET_PRIV(self)->out_queue->head->data, &len);
      g_assert (GET_PRIV(self)->out_partial <= len);

      ret = g_pollable_output_stream_write_nonblocking (os, data + GET_PRIV(self)->out_partial,
                                                        len - GET_PRIV(self)->out_partial, NULL, &error);

      if (ret < 0)
        {
          if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_WOULD_BLOCK))
            {
              g_debug ("%s: output would block", GET_PRIV(self)->name);
              g_error_free (error);
              return TRUE;
            }
          else
            {
              set_problem_from_error (self, "couldn't write", error);
              g_error_free (error);
              close_immediately (self, NULL);
              return FALSE;
            }
        }

      GET_PRIV(self)->out_partial += ret;
      if (GET_PRIV(self)->out_partial >= len)
        {
          before = GET_PRIV(self)->out_queued;

          g_debug ("%s: wrote %d bytes", GET_PRIV(self)->name, (int)len);
          popped = g_queue_pop_head (GET_PRIV(self)->out_queue);
          size = g_bytes_get_size (popped);
          g_assert (size <= GET_PRIV(self)->out_queued);
          GET_PRIV(self)->out_queued -= size;
          g_bytes_unref (popped);
          GET_PRIV(self)->out_partial = 0;

          if (before >= QUEUE_PRESSURE && GET_PRIV(self)->out_queued < QUEUE_PRESSURE)
            cockpit_flow_emit_pressure (COCKPIT_FLOW (self), FALSE);
        }
      else
        {
          if (ret > 0)
            g_debug ("%s: partial write %d of %d bytes", GET_PRIV(self)->name, (int)ret, (int)len);
          return TRUE;
        }
    }

  g_debug ("%s: output queue empty", GET_PRIV(self)->name);

  /* If all messages are done, then stop polling out fd */
  stop_output (self);

  if (GET_PRIV(self)->closing)
    close_output (self);
  else
    close_maybe (self);

  return TRUE;
}

static void
start_output (CockpitStream *self)
{
  GOutputStream *os;

  g_assert (GET_PRIV(self)->out_source == NULL);

  if (GET_PRIV(self)->connecting || GET_PRIV(self)->out_closed || GET_PRIV(self)->closed)
    return;

  g_assert (GET_PRIV(self)->io);

  os = g_io_stream_get_output_stream (GET_PRIV(self)->io);
  GET_PRIV(self)->out_source = g_pollable_output_stream_create_source (G_POLLABLE_OUTPUT_STREAM (os), NULL);
  g_source_set_name (GET_PRIV(self)->out_source, "stream-output");
  g_source_set_callback (GET_PRIV(self)->out_source, (GSourceFunc)dispatch_output, self, NULL);
  g_source_attach (GET_PRIV(self)->out_source, GET_PRIV(self)->context);
}

static void
start_input (CockpitStream *self)
{
  GInputStream *is;

  g_assert (GET_PRIV(self)->in_source == NULL);
  g_assert (!GET_PRIV(self)->connecting);
  g_assert (GET_PRIV(self)->io != NULL);

  is = g_io_stream_get_input_stream (GET_PRIV(self)->io);
  GET_PRIV(self)->in_source = g_pollable_input_stream_create_source (G_POLLABLE_INPUT_STREAM (is), NULL);
  g_source_set_name (GET_PRIV(self)->in_source, "stream-input");
  g_source_set_callback (GET_PRIV(self)->in_source, (GSourceFunc)dispatch_input, self, NULL);
  g_source_attach (GET_PRIV(self)->in_source, GET_PRIV(self)->context);
}

static void
initialize_io (CockpitStream *self)
{
  GInputStream *is;
  GOutputStream *os;

  g_return_if_fail (GET_PRIV(self)->in_source == NULL);

  is = g_io_stream_get_input_stream (GET_PRIV(self)->io);
  os = g_io_stream_get_output_stream (GET_PRIV(self)->io);

  if (!G_IS_POLLABLE_INPUT_STREAM (is) ||
      !g_pollable_input_stream_can_poll (G_POLLABLE_INPUT_STREAM (is)) ||
      !G_IS_POLLABLE_OUTPUT_STREAM (os) ||
      !g_pollable_output_stream_can_poll (G_POLLABLE_OUTPUT_STREAM (os)))
    {
      g_warning ("%s: stream is not pollable", GET_PRIV(self)->name);
      close_immediately (self, "internal-error");
      return;
    }

  if (GET_PRIV(self)->connecting)
    {
      cockpit_connectable_unref (GET_PRIV(self)->connecting);
      GET_PRIV(self)->connecting = NULL;
    }

  start_input (self);

  start_output (self);

  g_signal_emit (self, cockpit_stream_sig_open, 0);
}

static void
cockpit_stream_constructed (GObject *object)
{
  CockpitStream *self = COCKPIT_STREAM (object);

  G_OBJECT_CLASS (cockpit_stream_parent_class)->constructed (object);

  if (GET_PRIV(self)->io)
    initialize_io (self);
}

static void
cockpit_stream_set_property (GObject *obj,
                           guint prop_id,
                           const GValue *value,
                           GParamSpec *pspec)
{
  CockpitStream *self = COCKPIT_STREAM (obj);

  switch (prop_id)
    {
      case PROP_NAME:
        GET_PRIV(self)->name = g_value_dup_string (value);
        break;
      case PROP_IO_STREAM:
        GET_PRIV(self)->io = g_value_dup_object (value);
        break;
      case PROP_PROBLEM:
        GET_PRIV(self)->problem = g_value_dup_string (value);
        if (GET_PRIV(self)->problem)
          cockpit_close_later (self);
        break;
      default:
        G_OBJECT_WARN_INVALID_PROPERTY_ID (obj, prop_id, pspec);
        break;
    }
}

static void
cockpit_stream_get_property (GObject *obj,
                           guint prop_id,
                           GValue *value,
                           GParamSpec *pspec)
{
  CockpitStream *self = COCKPIT_STREAM (obj);

  switch (prop_id)
  {
    case PROP_NAME:
      g_value_set_string (value, GET_PRIV(self)->name);
      break;
    case PROP_IO_STREAM:
      g_value_set_object (value, GET_PRIV(self)->io);
      break;
    case PROP_PROBLEM:
      g_value_set_string (value, GET_PRIV(self)->problem);
      break;
    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (obj, prop_id, pspec);
      break;
  }
}

static void
cockpit_stream_dispose (GObject *object)
{
  CockpitStream *self = COCKPIT_STREAM (object);

  if (!GET_PRIV(self)->closed)
    close_immediately (self, "terminated");

  cockpit_flow_throttle (COCKPIT_FLOW (self), NULL);
  g_assert (GET_PRIV(self)->pressure == NULL);

  while (GET_PRIV(self)->out_queue->head)
    g_bytes_unref (g_queue_pop_head (GET_PRIV(self)->out_queue));
  GET_PRIV(self)->out_queued = 0;

  G_OBJECT_CLASS (cockpit_stream_parent_class)->dispose (object);
}

static void
cockpit_stream_finalize (GObject *object)
{
  CockpitStream *self = COCKPIT_STREAM (object);

  g_assert (GET_PRIV(self)->closed);
  g_assert (!GET_PRIV(self)->in_source);
  g_assert (!GET_PRIV(self)->out_source);

  g_byte_array_unref (GET_PRIV(self)->in_buffer);
  g_queue_free (GET_PRIV(self)->out_queue);
  g_free (GET_PRIV(self)->problem);
  g_free (GET_PRIV(self)->name);

  if (GET_PRIV(self)->context)
    g_main_context_unref (GET_PRIV(self)->context);

  G_OBJECT_CLASS (cockpit_stream_parent_class)->finalize (object);
}

static void
cockpit_stream_class_init (CockpitStreamClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);

  gobject_class->constructed = cockpit_stream_constructed;
  gobject_class->get_property = cockpit_stream_get_property;
  gobject_class->set_property = cockpit_stream_set_property;
  gobject_class->dispose = cockpit_stream_dispose;
  gobject_class->finalize = cockpit_stream_finalize;

  /**
   * CockpitStream:io-stream:
   *
   * The underlying io stream. The input and output streams should
   * be pollable.
   */
  g_object_class_install_property (gobject_class, PROP_IO_STREAM,
                g_param_spec_object ("io-stream", "io-stream", "io-stream", G_TYPE_IO_STREAM,
                                     G_PARAM_READWRITE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));

  /**
   * CockpitStream:name:
   *
   * Pipe name used for debugging purposes.
   */
  g_object_class_install_property (gobject_class, PROP_NAME,
                g_param_spec_string ("name", "name", "name", "<unnamed>",
                                     G_PARAM_READWRITE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));

  /**
   * CockpitStream:problem:
   *
   * The problem that the pipe closed with. If used as a constructor argument then
   * the pipe will be created in a closed/failed state. Although 'closed' signal will
   * only fire once main loop is hit.
   */
  g_object_class_install_property (gobject_class, PROP_PROBLEM,
                g_param_spec_string ("problem", "problem", "problem", NULL,
                                     G_PARAM_READWRITE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));

  /**
   * CockpitStream::open:
   *
   * Emitted when actually open and connected.
   */
  cockpit_stream_sig_open = g_signal_new ("open", COCKPIT_TYPE_STREAM, G_SIGNAL_RUN_LAST,
                                          G_STRUCT_OFFSET (CockpitStreamClass, open),
                                          NULL, NULL, NULL, G_TYPE_NONE, 0);

  /**
   * CockpitStream::read:
   * @buffer: a GByteArray of the read data
   * @eof: whether the pipe is done reading
   *
   * Emitted when data is read from the input file descriptor of the
   * pipe.
   *
   * Data consumed from @buffer by the handler should be removed from
   * the GByteArray. This can be done with the cockpit_stream_consume()
   * function.
   *
   * This handler will only be called once with @eof set to TRUE. But
   * in error conditions it may not be called with @eof set to TRUE
   * at all, and the CockpitStream::close signal will simply fire.
   */
  cockpit_stream_sig_read = g_signal_new ("read", COCKPIT_TYPE_STREAM, G_SIGNAL_RUN_LAST,
                                        G_STRUCT_OFFSET (CockpitStreamClass, read),
                                        NULL, NULL, NULL,
                                        G_TYPE_NONE, 2, G_TYPE_BYTE_ARRAY, G_TYPE_BOOLEAN);

  /**
   * CockpitStream::close:
   * @problem: problem string or %NULL
   *
   * Emitted when the pipe closes, whether due to a problem or a normal
   * shutdown.
   *
   * @problem will be NULL if the pipe closed normally.
   */
  cockpit_stream_sig_close = g_signal_new ("close", COCKPIT_TYPE_STREAM, G_SIGNAL_RUN_FIRST,
                                         G_STRUCT_OFFSET (CockpitStreamClass, close),
                                         NULL, NULL, NULL,
                                         G_TYPE_NONE, 1, G_TYPE_STRING);
}

/**
 * cockpit_stream_write:
 * @self: the pipe
 * @data: the data to write
 *
 * Write @data to the pipe. This is not done immediately, it's
 * queued and written when the pipe is ready.
 *
 * If you cockpit_stream_close() with a @problem, then queued data
 * will be discarded.
 *
 * Calling this function on a closed or closing pipe (one on which
 * cockpit_stream_close() has been called) is invalid.
 *
 * Zero length data blocks are ignored, it doesn't makes sense to
 * write zero bytes to a pipe.
 */
void
cockpit_stream_write (CockpitStream *self,
                      GBytes *data)
{
  gsize size, before;

  g_return_if_fail (COCKPIT_IS_STREAM (self));
  g_return_if_fail (!GET_PRIV(self)->closing);

  g_return_if_fail (!GET_PRIV(self)->closed);

  size = g_bytes_get_size (data);
  if (size == 0)
    {
      g_debug ("%s: ignoring zero byte data block", GET_PRIV(self)->name);
      return;
    }

  before = GET_PRIV(self)->out_queued;
  g_return_if_fail (G_MAXSIZE - size > GET_PRIV(self)->out_queued);
  GET_PRIV(self)->out_queued += size;
  g_queue_push_tail (GET_PRIV(self)->out_queue, g_bytes_ref (data));

  /* No longer have pressure in the queue? */
  if (before < QUEUE_PRESSURE && GET_PRIV(self)->out_queued >= QUEUE_PRESSURE)
    cockpit_flow_emit_pressure (COCKPIT_FLOW (self), TRUE);

  if (!GET_PRIV(self)->out_source && !GET_PRIV(self)->out_closed)
    {
      start_output (self);
    }

  /*
   * If this becomes thread-safe, then something like this is needed:
   * g_main_context_wakeup (g_source_get_context (GET_PRIV(self)->source));
   */
}

/**
 * cockpit_stream_close:
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
cockpit_stream_close (CockpitStream *self,
                    const gchar *problem)
{
  g_return_if_fail (COCKPIT_IS_STREAM (self));

  GET_PRIV(self)->closing = TRUE;

  if (problem)
    close_immediately (self, problem);
  else if (g_queue_is_empty (GET_PRIV(self)->out_queue))
    close_output (self);
}

static gboolean
on_later_close (gpointer user_data)
{
  close_immediately (user_data, NULL); /* problem already set */
  return FALSE;
}

static void
cockpit_close_later (CockpitStream *self)
{
  GSource *source = g_idle_source_new ();
  g_source_set_priority (source, G_PRIORITY_HIGH);
  g_source_set_callback (source, on_later_close, g_object_ref (self), g_object_unref);
  g_source_attach (source, g_main_context_get_thread_default ());
  g_source_unref (source);
}

static void
on_connect_stream (GObject *object,
                   GAsyncResult *result,
                   gpointer user_data)
{
  CockpitStream *self = COCKPIT_STREAM (user_data);
  GError *error = NULL;
  GIOStream *io;

  io = cockpit_connect_stream_finish (result, &error);
  if (error)
    {
      set_problem_from_error (self, "couldn't connect", error);
      close_immediately (self, NULL);
      g_error_free (error);
    }
  else if (!GET_PRIV(self)->closed)
    {
      GET_PRIV(self)->io = g_object_ref (io);
      initialize_io (self);
    }

  g_clear_object (&io);
  g_object_unref (self);
}

CockpitStream *
cockpit_stream_connect (const gchar *name,
                        CockpitConnectable *connectable)
{
  CockpitStream *self;

  g_return_val_if_fail (connectable != NULL, NULL);

  self = g_object_new (COCKPIT_TYPE_STREAM,
                       "io-stream", NULL,
                       "name", name,
                       NULL);

  GET_PRIV(self)->connecting = cockpit_connectable_ref (connectable);
  cockpit_connect_stream_full (GET_PRIV(self)->connecting, NULL,
                               on_connect_stream, g_object_ref (self));

  return self;
}

/**
 * cockpit_stream_get_name:
 * @self: a pipe
 *
 * Get the name of the pipe.
 *
 * This is used for logging.
 *
 * Returns: (transfer none): the name
 */
const gchar *
cockpit_stream_get_name (CockpitStream *self)
{
  g_return_val_if_fail (COCKPIT_IS_STREAM (self), NULL);
  return GET_PRIV(self)->name;
}

/**
 * cockpit_stream_get_buffer:
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
cockpit_stream_get_buffer (CockpitStream *self)
{
  g_return_val_if_fail (COCKPIT_IS_STREAM (self), NULL);
  return GET_PRIV(self)->in_buffer;
}

/**
 * cockpit_stream_new:
 * @name: a name for debugging
 * @io_stream: A stream to wrap
 *
 * Create a stream for the given io stream
 *
 * Returns: (transfer full): a new CockpitStream
 */
CockpitStream *
cockpit_stream_new (const gchar *name,
                    GIOStream *io_stream)
{
  return g_object_new (COCKPIT_TYPE_STREAM,
                       "name", name,
                       "io-stream", io_stream,
                       NULL);
}

static void
on_throttle_pressure (GObject *object,
                      gboolean throttle,
                      gpointer user_data)
{
  CockpitStream *self = COCKPIT_STREAM (user_data);
  if (throttle)
    {
      if (GET_PRIV(self)->in_source != NULL)
        {
          g_debug ("%s: applying back pressure in stream", GET_PRIV(self)->name);
          stop_input (self);
        }
    }
  else
    {
      if (GET_PRIV(self)->in_source == NULL && GET_PRIV(self)->io && !GET_PRIV(self)->connecting)
        {
          g_debug ("%s: relieving back pressure in stream", GET_PRIV(self)->name);
          start_input (self);
        }
    }
}

static void
cockpit_stream_throttle (CockpitFlow *flow,
                         CockpitFlow *controlling)
{
  CockpitStream *self = COCKPIT_STREAM (flow);

  if (GET_PRIV(self)->pressure)
    {
      g_signal_handler_disconnect (GET_PRIV(self)->pressure, GET_PRIV(self)->pressure_sig);
      g_object_remove_weak_pointer (G_OBJECT (GET_PRIV(self)->pressure), (gpointer *)&GET_PRIV(self)->pressure);
      GET_PRIV(self)->pressure = NULL;
    }

  if (controlling)
    {
      GET_PRIV(self)->pressure = controlling;
      g_object_add_weak_pointer (G_OBJECT (GET_PRIV(self)->pressure), (gpointer *)&GET_PRIV(self)->pressure);
      GET_PRIV(self)->pressure_sig = g_signal_connect (controlling, "pressure", G_CALLBACK (on_throttle_pressure), self);
    }
}

static void
cockpit_stream_flow_iface_init (CockpitFlowInterface *iface)
{
  iface->throttle = cockpit_stream_throttle;
}
