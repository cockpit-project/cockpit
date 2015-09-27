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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

#include "config.h"

#include "cockpitstream.h"

#include <errno.h>
#include <string.h>

/**
 * CockpitStream:
 *
 * A stream with queued input and output based on top of a GIOStream
 */

enum {
  PROP_0,
  PROP_NAME,
  PROP_IO_STREAM,
  PROP_PROBLEM
};

struct _CockpitStreamPrivate {
  gchar *name;
  GMainContext *context;
  CockpitStreamOptions *options;

  gboolean closed;
  gboolean closing;
  GSocketAddressEnumerator *connecting;
  GError *connect_error;
  gchar *problem;

  GIOStream *io;

  GSource *out_source;
  GQueue *out_queue;
  gsize out_partial;
  gboolean out_closed;

  GSource *in_source;
  GByteArray *in_buffer;
  gboolean received;
};

static guint cockpit_stream_sig_read;
static guint cockpit_stream_sig_close;

static void  cockpit_close_later (CockpitStream *self);

G_DEFINE_TYPE (CockpitStream, cockpit_stream, G_TYPE_OBJECT);

static void
cockpit_stream_init (CockpitStream *self)
{
  self->priv = G_TYPE_INSTANCE_GET_PRIVATE (self, COCKPIT_TYPE_STREAM, CockpitStreamPrivate);
  self->priv->in_buffer = g_byte_array_new ();
  self->priv->out_queue = g_queue_new ();

  self->priv->context = g_main_context_ref_thread_default ();
}

static void
stop_output (CockpitStream *self)
{
  g_assert (self->priv->out_source != NULL);
  g_source_destroy (self->priv->out_source);
  g_source_unref (self->priv->out_source);
  self->priv->out_source = NULL;
}

static void
stop_input (CockpitStream *self)
{
  g_assert (self->priv->in_source != NULL);
  g_source_destroy (self->priv->in_source);
  g_source_unref (self->priv->in_source);
  self->priv->in_source = NULL;
}

static void
close_immediately (CockpitStream *self,
                   const gchar *problem)
{
  GError *error = NULL;
  GIOStream *io;

  if (self->priv->closed)
    return;

  if (problem)
    {
      g_free (self->priv->problem);
      self->priv->problem = g_strdup (problem);
    }

  if (self->priv->connecting)
    {
      g_object_unref (self->priv->connecting);
      self->priv->connecting = NULL;
    }

  g_clear_error (&self->priv->connect_error);
  self->priv->closed = TRUE;

  g_debug ("%s: closing stream%s%s", self->priv->name,
           self->priv->problem ? ": " : "",
           self->priv->problem ? self->priv->problem : "");

  if (self->priv->in_source)
    stop_input (self);
  if (self->priv->out_source)
    stop_output (self);

  if (self->priv->io)
    {
      io = self->priv->io;
      self->priv->io = NULL;

      g_io_stream_close (io, NULL, &error);
      if (error)
        {
          g_message ("%s: close failed: %s", self->priv->name, error->message);
          g_clear_error (&error);
        }
      g_object_unref (io);
    }

  g_debug ("%s: closed", self->priv->name);
  g_signal_emit (self, cockpit_stream_sig_close, 0, self->priv->problem);
}

static void
close_maybe (CockpitStream *self)
{
  if (!self->priv->closed)
    {
      if (!self->priv->in_source && !self->priv->out_source)
        {
          g_debug ("%s: input and output done", self->priv->name);
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

  g_output_stream_close_finish (G_OUTPUT_STREAM (object), result, &error);
  if (error)
    {
      g_warning ("%s: couldn't close output stream: %s", self->priv->name, error->message);
      close_immediately (self, "internal-error");
    }

  close_maybe (self);
  g_object_unref (self);
}

static void
close_output (CockpitStream *self)
{
  if (self->priv->out_closed)
    return;

  g_debug ("%s: end of output", self->priv->name);

  self->priv->out_closed = TRUE;
  if (!self->priv->io)
    {
      close_maybe (self);
      return;
    }

  g_output_stream_close_async (g_io_stream_get_output_stream (self->priv->io),
                               G_PRIORITY_DEFAULT, NULL, on_output_closed, g_object_ref (self));
}

#if !GLIB_CHECK_VERSION(2,43,2)
#define G_IO_ERROR_CONNECTION_CLOSED G_IO_ERROR_BROKEN_PIPE
#endif

static gchar *
describe_certificate_errors (CockpitStream *self)
{
  GTlsCertificateFlags flags;
  GString *str;

  if (!G_IS_TLS_CONNECTION (self->priv->io))
    return NULL;

  flags = g_tls_connection_get_peer_certificate_errors (G_TLS_CONNECTION (self->priv->io));
  if (flags == 0)
    return NULL;

  str = g_string_new ("");

  if (flags & G_TLS_CERTIFICATE_UNKNOWN_CA)
    {
      g_string_append (str, "untrusted-issuer ");
      flags &= ~G_TLS_CERTIFICATE_UNKNOWN_CA;
    }
  if (flags & G_TLS_CERTIFICATE_BAD_IDENTITY)
    {
      g_string_append (str, "bad-server-identity ");
      flags &= ~G_TLS_CERTIFICATE_BAD_IDENTITY;
    }
  if (flags & G_TLS_CERTIFICATE_NOT_ACTIVATED)
    {
      g_string_append (str, "not-yet-valid ");
      flags &= ~G_TLS_CERTIFICATE_NOT_ACTIVATED;
    }
  if (flags & G_TLS_CERTIFICATE_EXPIRED)
    {
      g_string_append (str, "expired ");
      flags &= ~G_TLS_CERTIFICATE_EXPIRED;
    }
  if (flags & G_TLS_CERTIFICATE_REVOKED)
    {
      g_string_append (str, "revoked ");
      flags &= ~G_TLS_CERTIFICATE_REVOKED;
    }
  if (flags & G_TLS_CERTIFICATE_INSECURE)
    {
      g_string_append (str, "insecure ");
      flags &= ~G_TLS_CERTIFICATE_INSECURE;
    }
  if (flags & G_TLS_CERTIFICATE_GENERIC_ERROR)
    {
      g_string_append (str, "generic-error ");
      flags &= ~G_TLS_CERTIFICATE_GENERIC_ERROR;
    }

  if (flags != 0)
    {
      g_string_append (str, "...");
    }

  return g_string_free (str, FALSE);
}

static void
set_problem_from_error (CockpitStream *self,
                        const gchar *summary,
                        GError *error)
{
  const gchar *problem = NULL;
  gchar *details = NULL;

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
           g_error_matches (error, G_TLS_ERROR, G_TLS_ERROR_EOF) ||
           (self->priv->received && g_error_matches (error, G_TLS_ERROR, G_TLS_ERROR_MISC)))
    problem = "disconnected";
#if !GLIB_CHECK_VERSION(2,43,2)
  else if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_FAILED) &&
           strstr (error->message, g_strerror (ECONNRESET)))
    problem = "disconnected";
#endif
  else if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_TIMED_OUT))
    problem = "timeout";
  else if (g_error_matches (error, G_TLS_ERROR, G_TLS_ERROR_NOT_TLS) ||
           (!self->priv->received && g_error_matches (error, G_TLS_ERROR, G_TLS_ERROR_MISC)))
    problem = "protocol-error";
  else if (g_error_matches (error, G_TLS_ERROR, G_TLS_ERROR_BAD_CERTIFICATE))
    {
      problem = "unknown-hostkey";
      details = describe_certificate_errors (self);
    }

  g_free (self->priv->problem);

  if (problem)
    {
      g_message ("%s: %s: %s%s%s", self->priv->name, summary, error->message,
                 details ? ": " : "", details ? details : "");
      self->priv->problem = g_strdup (problem);
    }
  else
    {
      g_warning ("%s: %s: %s", self->priv->name, summary, error->message);
      self->priv->problem = g_strdup ("internal-error");
    }

  g_free (details);
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
  gboolean eof;

  for (;;)
    {
      g_return_val_if_fail (self->priv->in_source, FALSE);
      len = self->priv->in_buffer->len;

      g_byte_array_set_size (self->priv->in_buffer, len + 1024);
      ret = g_pollable_input_stream_read_nonblocking (is, self->priv->in_buffer->data + len,
                                                      1024, NULL, &error);

      if (ret < 0)
        {
          g_byte_array_set_size (self->priv->in_buffer, len);
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

      g_byte_array_set_size (self->priv->in_buffer, len + ret);

      if (ret == 0)
        {
          g_debug ("%s: end of input", self->priv->name);
          stop_input (self);
          break;
        }
      else if (ret > 0)
        {
          g_debug ("%s: read %d bytes", self->priv->name, (int)ret);
          self->priv->received = TRUE;
          read = TRUE;
        }
    }

  g_object_ref (self);

  eof = (self->priv->in_source == NULL);
  if (eof || read)
    g_signal_emit (self, cockpit_stream_sig_read, 0, self->priv->in_buffer, eof);

  if (eof)
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
  gsize len;
  gssize ret;

  g_return_val_if_fail (self->priv->out_source, FALSE);
  while (self->priv->out_queue->head)
    {
      data = g_bytes_get_data (self->priv->out_queue->head->data, &len);
      g_assert (self->priv->out_partial <= len);

      ret = g_pollable_output_stream_write_nonblocking (os, data + self->priv->out_partial,
                                                        len - self->priv->out_partial, NULL, &error);

      if (ret < 0)
        {
          if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_WOULD_BLOCK))
            {
              g_debug ("%s: output would block", self->priv->name);
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

      self->priv->out_partial += ret;
      if (self->priv->out_partial >= len)
        {
          g_debug ("%s: wrote %d bytes", self->priv->name, (int)len);
          g_bytes_unref (g_queue_pop_head (self->priv->out_queue));
          self->priv->out_partial = 0;
        }
      else
        {
          if (ret > 0)
            g_debug ("%s: partial write %d of %d bytes", self->priv->name, (int)ret, (int)len);
          return TRUE;
        }
    }

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
start_output (CockpitStream *self)
{
  GOutputStream *os;

  g_assert (self->priv->out_source == NULL);

  if (self->priv->connecting || self->priv->out_closed || self->priv->closed)
    return;

  g_assert (self->priv->io);

  os = g_io_stream_get_output_stream (self->priv->io);
  self->priv->out_source = g_pollable_output_stream_create_source (G_POLLABLE_OUTPUT_STREAM (os), NULL);
  g_source_set_name (self->priv->out_source, "stream-output");
  g_source_set_callback (self->priv->out_source, (GSourceFunc)dispatch_output, self, NULL);
  g_source_attach (self->priv->out_source, self->priv->context);
}

static void
initialize_io (CockpitStream *self)
{
  GInputStream *is;
  GOutputStream *os;

  g_return_if_fail (self->priv->in_source == NULL);

  is = g_io_stream_get_input_stream (self->priv->io);
  os = g_io_stream_get_output_stream (self->priv->io);

  if (!G_IS_POLLABLE_INPUT_STREAM (is) ||
      !g_pollable_input_stream_can_poll (G_POLLABLE_INPUT_STREAM (is)) ||
      !G_IS_POLLABLE_OUTPUT_STREAM (os) ||
      !g_pollable_output_stream_can_poll (G_POLLABLE_OUTPUT_STREAM (os)))
    {
      g_warning ("%s: stream is not pollable", self->priv->name);
      close_immediately (self, "internal-error");
      return;
    }

  if (self->priv->connecting)
    {
      g_object_unref (self->priv->connecting);
      self->priv->connecting = NULL;
    }

  self->priv->in_source = g_pollable_input_stream_create_source (G_POLLABLE_INPUT_STREAM (is), NULL);
  g_source_set_name (self->priv->in_source, "stream-input");
  g_source_set_callback (self->priv->in_source, (GSourceFunc)dispatch_input, self, NULL);
  g_source_attach (self->priv->in_source, self->priv->context);

  start_output (self);
}

static void
cockpit_stream_constructed (GObject *object)
{
  CockpitStream *self = COCKPIT_STREAM (object);

  G_OBJECT_CLASS (cockpit_stream_parent_class)->constructed (object);

  if (self->priv->io)
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
        self->priv->name = g_value_dup_string (value);
        break;
      case PROP_IO_STREAM:
        self->priv->io = g_value_dup_object (value);
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
cockpit_stream_get_property (GObject *obj,
                           guint prop_id,
                           GValue *value,
                           GParamSpec *pspec)
{
  CockpitStream *self = COCKPIT_STREAM (obj);

  switch (prop_id)
  {
    case PROP_NAME:
      g_value_set_string (value, self->priv->name);
      break;
    case PROP_IO_STREAM:
      g_value_set_object (value, self->priv->io);
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
cockpit_stream_dispose (GObject *object)
{
  CockpitStream *self = COCKPIT_STREAM (object);

  if (!self->priv->closed)
    close_immediately (self, "terminated");

  while (self->priv->out_queue->head)
    g_bytes_unref (g_queue_pop_head (self->priv->out_queue));

  if (self->priv->options)
    cockpit_stream_options_unref (self->priv->options);
  self->priv->options = NULL;

  G_OBJECT_CLASS (cockpit_stream_parent_class)->dispose (object);
}

static void
cockpit_stream_finalize (GObject *object)
{
  CockpitStream *self = COCKPIT_STREAM (object);

  g_assert (self->priv->closed);
  g_assert (!self->priv->in_source);
  g_assert (!self->priv->out_source);

  g_byte_array_unref (self->priv->in_buffer);
  g_queue_free (self->priv->out_queue);
  g_free (self->priv->problem);
  g_free (self->priv->name);

  if (self->priv->context)
    g_main_context_unref (self->priv->context);

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

  g_type_class_add_private (klass, sizeof (CockpitStreamPrivate));
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
  g_return_if_fail (COCKPIT_IS_STREAM (self));
  g_return_if_fail (!self->priv->closing);

  g_return_if_fail (!self->priv->closed);

  if (g_bytes_get_size (data) == 0)
    {
      g_debug ("%s: ignoring zero byte data block", self->priv->name);
      return;
    }

  g_queue_push_tail (self->priv->out_queue, g_bytes_ref (data));

  if (!self->priv->out_source && !self->priv->out_closed)
    {
      start_output (self);
    }

  /*
   * If this becomes thread-safe, then something like this is needed:
   * g_main_context_wakeup (g_source_get_context (self->priv->source));
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
cockpit_close_later (CockpitStream *self)
{
  GSource *source = g_idle_source_new ();
  g_source_set_priority (source, G_PRIORITY_HIGH);
  g_source_set_callback (source, on_later_close, g_object_ref (self), g_object_unref);
  g_source_attach (source, g_main_context_get_thread_default ());
  g_source_unref (source);
}

static void
on_address_next (GObject *object,
                 GAsyncResult *result,
                 gpointer user_data);

static void
on_socket_connect (GObject *object,
                   GAsyncResult *result,
                   gpointer user_data)
{
  CockpitStream *self = user_data;
  GError *error = NULL;

  g_socket_connection_connect_finish (G_SOCKET_CONNECTION (object), result, &error);

  if (!error && !self->priv->closed)
    {
      g_debug ("%s: connected", self->priv->name);

      if (self->priv->options && self->priv->options->tls_client)
        {
          self->priv->io = g_tls_client_connection_new (G_IO_STREAM (object), NULL, &error);
          if (self->priv->io)
            {
              g_debug ("%s: tls handshake", self->priv->name);

              g_tls_client_connection_set_validation_flags (G_TLS_CLIENT_CONNECTION (self->priv->io),
                                                            self->priv->options->tls_client_flags);

              if (self->priv->options->tls_cert)
                {
                  g_tls_connection_set_certificate (G_TLS_CONNECTION (self->priv->io),
                                                    self->priv->options->tls_cert);
                }
              if (self->priv->options->tls_database)
                {
                  g_tls_connection_set_database (G_TLS_CONNECTION (self->priv->io),
                                                 self->priv->options->tls_database);
                }

              /* We track data end the same way we do for HTTP */
              g_tls_connection_set_require_close_notify (G_TLS_CONNECTION (self->priv->io), FALSE);
            }
        }
      else
        {
          self->priv->io = g_object_ref (object);
        }
    }

  if (error)
    {
      g_debug ("%s: couldn't connect: %s", self->priv->name, error->message);
      g_clear_error (&self->priv->connect_error);
      self->priv->connect_error = error;

      g_socket_address_enumerator_next_async (self->priv->connecting, NULL,
                                              on_address_next, g_object_ref (self));
    }
  else
    {
      initialize_io (self);
    }

  g_object_unref (object);
  g_object_unref (self);
}

static void
on_address_next (GObject *object,
                 GAsyncResult *result,
                 gpointer user_data)
{
  CockpitStream *self = user_data;
  GSocketConnection *connection;
  GSocketAddress *address;
  GError *error = NULL;
  GSocket *sock;

  address = g_socket_address_enumerator_next_finish (G_SOCKET_ADDRESS_ENUMERATOR (object),
                                                     result, &error);

  if (error)
    {
      set_problem_from_error (self, "couldn't resolve", error);
      g_error_free (error);
      close_immediately (self, NULL);
    }
  else if (address)
    {
      sock = g_socket_new (g_socket_address_get_family (address), G_SOCKET_TYPE_STREAM, 0, &error);
      if (sock)
        {
          g_socket_set_blocking (sock, FALSE);

          connection = g_socket_connection_factory_create_connection (sock);
          g_object_unref (sock);

          g_socket_connection_connect_async (connection, address, NULL,
                                             on_socket_connect, g_object_ref (self));
        }

      if (error)
        {
          g_debug ("%s: couldn't open socket: %s", self->priv->name, error->message);
          g_clear_error (&self->priv->connect_error);
          self->priv->connect_error = error;
        }
      g_object_unref (address);
    }
  else
    {
      if (self->priv->connect_error)
        {
          set_problem_from_error (self, "couldn't connect", self->priv->connect_error);
          close_immediately (self, NULL);
        }
      else
        {
          g_message ("%s: no addresses found", self->priv->name);
          close_immediately (self, "not-found");
        }
    }

  g_object_unref (self);
}

/**
 * cockpit_stream_connect:
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
 * Returns: (transfer full): newly allocated CockpitStream.
 */
CockpitStream *
cockpit_stream_connect (const gchar *name,
                        GSocketConnectable *connectable,
                        CockpitStreamOptions *options)
{
  CockpitStream *stream;

  g_return_val_if_fail (G_IS_SOCKET_CONNECTABLE (connectable), NULL);

  stream = g_object_new (COCKPIT_TYPE_STREAM,
                         "io-stream", NULL,
                         "name", name,
                         NULL);

  if (options)
    stream->priv->options = cockpit_stream_options_ref (options);

  stream->priv->connecting = g_socket_connectable_enumerate (connectable);
  g_socket_address_enumerator_next_async (stream->priv->connecting, NULL,
                                          on_address_next, g_object_ref (stream));

  return stream;
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
  return self->priv->name;
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
  return self->priv->in_buffer;
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

CockpitStreamOptions *
cockpit_stream_options_ref (CockpitStreamOptions *options)
{
  g_return_val_if_fail (options != NULL, NULL);
  options->refs++;
  return options;
}

void
cockpit_stream_options_unref (gpointer data)
{
  CockpitStreamOptions *options = data;

  g_return_if_fail (options != NULL);

  if (--(options->refs) <= 0)
    {
      if (options->tls_cert)
        g_object_unref (options->tls_cert);
      if (options->tls_database)
        g_object_unref (options->tls_database);
      g_free (options);
    }
}
