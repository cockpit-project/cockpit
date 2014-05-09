/*
 * This file is part of Cockpit.
 *
 * Copyright © 2008-2010 Red Hat, Inc.
 * Copyright © 2011 Nokia Corporation
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 2 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General
 * Public License along with this library; if not, write to the
 * Free Software Foundation, Inc., 51 Franklin Street, Fifth Floor,
 * Boston, MA 02110-1301, USA.
 *
 * Author: David Zeuthen <davidz@redhat.com>
 * Author: Simon McVittie <simon.mcvittie@collabora.co.uk>
 */

#include "config.h"

#include "mock-io-stream.h"

struct _MockIOStream {
  GIOStream parent;
  GInputStream *input_stream;
  GOutputStream *output_stream;
};

typedef struct _GIOStreamClass MockIOStreamClass;

G_DEFINE_TYPE (MockIOStream, mock_io_stream, G_TYPE_IO_STREAM)

static void
mock_io_stream_finalize (GObject *object)
{
  MockIOStream *stream = MOCK_IO_STREAM (object);

  /* strictly speaking we should unref these in dispose, but
   * g_io_stream_dispose() wants them to still exist
   */
  g_clear_object (&stream->input_stream);
  g_clear_object (&stream->output_stream);

  G_OBJECT_CLASS (mock_io_stream_parent_class)->finalize (object);
}

static void
mock_io_stream_init (MockIOStream *stream)
{
}

static GInputStream *
mock_io_stream_get_input_stream (GIOStream *_stream)
{
  MockIOStream *stream = MOCK_IO_STREAM (_stream);

  return stream->input_stream;
}

static GOutputStream *
mock_io_stream_get_output_stream (GIOStream *_stream)
{
  MockIOStream *stream = MOCK_IO_STREAM (_stream);

  return stream->output_stream;
}

static void
mock_io_stream_class_init (MockIOStreamClass *klass)
{
  GObjectClass *gobject_class;
  GIOStreamClass *giostream_class;

  gobject_class = G_OBJECT_CLASS (klass);
  gobject_class->finalize = mock_io_stream_finalize;

  giostream_class = G_IO_STREAM_CLASS (klass);
  giostream_class->get_input_stream  = mock_io_stream_get_input_stream;
  giostream_class->get_output_stream = mock_io_stream_get_output_stream;
}

GIOStream *
mock_io_stream_new (GInputStream  *input_stream,
                    GOutputStream *output_stream)
{
  MockIOStream *stream;

  g_return_val_if_fail (G_IS_INPUT_STREAM (input_stream), NULL);
  g_return_val_if_fail (G_IS_OUTPUT_STREAM (output_stream), NULL);
  stream = MOCK_IO_STREAM (g_object_new (MOCK_TYPE_IO_STREAM, NULL));
  stream->input_stream = g_object_ref (input_stream);
  stream->output_stream = g_object_ref (output_stream);
  return G_IO_STREAM (stream);
}

struct _MockOutputStream {
  GOutputStream parent;
  GString *buffer;
  GError *write_error;
  GError *flush_error;
  GError *close_error;
};

typedef struct {
  GOutputStreamClass parent;
} MockOutputStreamClass;

static void mock_output_stream_pollable_init (GPollableOutputStreamInterface *iface);

G_DEFINE_TYPE_WITH_CODE (MockOutputStream, mock_output_stream, G_TYPE_OUTPUT_STREAM,
                         G_IMPLEMENT_INTERFACE (G_TYPE_POLLABLE_OUTPUT_STREAM, mock_output_stream_pollable_init);
);

static void
mock_output_stream_init (MockOutputStream *self)
{

}

static void
mock_output_stream_finalize (GObject *object)
{
  MockOutputStream *self = (MockOutputStream *)object;

  g_string_free (self->buffer, TRUE);
  g_clear_error (&self->write_error);
  g_clear_error (&self->flush_error);
  g_clear_error (&self->close_error);

  G_OBJECT_CLASS (mock_output_stream_parent_class)->finalize (object);
}

static gssize
mock_output_stream_write (GOutputStream *stream,
                          const void *buffer,
                          gsize count,
                          GCancellable *cancellable,
                          GError **error)
{
  MockOutputStream *self = MOCK_OUTPUT_STREAM (stream);

  if (self->write_error)
    {
      g_propagate_error (error, self->write_error);
      self->write_error = NULL;
      return -1;
    }

  if (g_cancellable_set_error_if_cancelled (cancellable, error))
    return -1;

  if (count == 0)
    return 0;

  if (count > 16)
    {
      g_string_append_len (self->buffer, buffer, 16);
      return 16;
    }
  else
    {
      g_string_append_len (self->buffer, buffer, count);
      return count;
    }
}

static void
mock_output_stream_write_async (GOutputStream *stream,
                                const void *buffer,
                                gsize count,
                                int io_priority,
                                GCancellable *cancellable,
                                GAsyncReadyCallback callback,
                                gpointer user_data)
{
  GSimpleAsyncResult *result;
  GError *error = NULL;
  gssize res;

  result = g_simple_async_result_new (G_OBJECT (stream), callback, user_data,
                                      mock_output_stream_write_async);

  res = mock_output_stream_write (stream, buffer, count, cancellable, &error);
  g_simple_async_result_set_op_res_gssize (result, res);
  if (error)
    g_simple_async_result_take_error (result, error);
  g_simple_async_result_complete_in_idle (result);
  g_object_unref (result);
}

static gssize
mock_output_stream_write_finish (GOutputStream *stream,
                                 GAsyncResult *result,
                                 GError **error)
{
  g_return_val_if_fail (g_simple_async_result_is_valid (result, G_OBJECT (stream),
                                                        mock_output_stream_write_async), FALSE);

  if (g_simple_async_result_propagate_error (G_SIMPLE_ASYNC_RESULT (result), error))
    return -1;

  return g_simple_async_result_get_op_res_gssize (G_SIMPLE_ASYNC_RESULT (result));
}

static gboolean
mock_output_stream_flush (GOutputStream *stream,
                          GCancellable *cancellable,
                          GError **error)
{
  MockOutputStream *self = MOCK_OUTPUT_STREAM (stream);

  if (self->flush_error)
    {
      g_propagate_error (error, self->flush_error);
      self->flush_error = NULL;
      return FALSE;
    }

  if (g_cancellable_set_error_if_cancelled (cancellable, error))
    return FALSE;

  return TRUE;
}

static void
mock_output_stream_flush_async (GOutputStream *stream,
                                int io_priority,
                                GCancellable *cancellable,
                                GAsyncReadyCallback callback,
                                gpointer data)
{
  GSimpleAsyncResult *result;

  result = g_simple_async_result_new (G_OBJECT (stream), callback, data,
                                      mock_output_stream_flush_async);

  if (cancellable)
    {
      g_simple_async_result_set_op_res_gpointer (result,
                                                 g_object_ref (cancellable),
                                                 g_object_unref);
    }

  g_simple_async_result_complete_in_idle (result);
  g_object_unref (result);
}

static gboolean
mock_output_stream_flush_finish (GOutputStream *stream,
                                 GAsyncResult *result,
                                 GError **error)
{
  GCancellable *cancellable;

  g_return_val_if_fail (g_simple_async_result_is_valid (result, G_OBJECT (stream),
                                                        mock_output_stream_flush_async), FALSE);

  cancellable = g_simple_async_result_get_op_res_gpointer (G_SIMPLE_ASYNC_RESULT (result));
  return mock_output_stream_flush (stream, cancellable, error);
}

static gboolean
mock_output_stream_close (GOutputStream *stream,
                          GCancellable *cancellable,
                          GError **error)
{
  MockOutputStream *self = MOCK_OUTPUT_STREAM (stream);

  if (self->close_error)
    {
      g_propagate_error (error, self->close_error);
      self->close_error = NULL;
      return FALSE;
    }

  if (g_cancellable_set_error_if_cancelled (cancellable, error))
    return FALSE;

  return TRUE;
}

static void
mock_output_stream_close_async (GOutputStream *stream,
                                int io_priority,
                                GCancellable *cancellable,
                                GAsyncReadyCallback callback,
                                gpointer data)
{
  GSimpleAsyncResult *result;

  result = g_simple_async_result_new (G_OBJECT (stream), callback, data,
                                      mock_output_stream_close_async);

  if (cancellable)
    {
      g_simple_async_result_set_op_res_gpointer (result,
                                                 g_object_ref (cancellable),
                                                 g_object_unref);
    }

  g_simple_async_result_complete_in_idle (result);
  g_object_unref (result);
}

static gboolean
mock_output_stream_close_finish (GOutputStream *stream,
                                 GAsyncResult *result,
                                 GError **error)
{
  GCancellable *cancellable;

  g_return_val_if_fail (g_simple_async_result_is_valid (result, G_OBJECT (stream),
                                                        mock_output_stream_close_async), FALSE);

  cancellable = g_simple_async_result_get_op_res_gpointer (G_SIMPLE_ASYNC_RESULT (result));
  return mock_output_stream_close (stream, cancellable, error);
}

static void
mock_output_stream_class_init (MockOutputStreamClass *klass)
{
  GObjectClass *object_class = G_OBJECT_CLASS (klass);
  GOutputStreamClass *ostream_class = G_OUTPUT_STREAM_CLASS (klass);

  object_class->finalize = mock_output_stream_finalize;

  ostream_class->write_fn = mock_output_stream_write;
  ostream_class->write_async  = mock_output_stream_write_async;
  ostream_class->write_finish = mock_output_stream_write_finish;
  ostream_class->close_fn = mock_output_stream_close;
  ostream_class->close_async  = mock_output_stream_close_async;
  ostream_class->close_finish = mock_output_stream_close_finish;
  ostream_class->flush = mock_output_stream_flush;
  ostream_class->flush_async  = mock_output_stream_flush_async;
  ostream_class->flush_finish = mock_output_stream_flush_finish;
}

static gboolean
mock_output_stream_is_writable (GPollableOutputStream *stream)
{
  return TRUE;
}

static GSource *
mock_output_stream_create_source (GPollableOutputStream *stream,
                                  GCancellable *cancellable)
{
  GSource *base_source, *pollable_source;

  base_source = g_timeout_source_new (0);
  pollable_source = g_pollable_source_new_full (stream, base_source, cancellable);
  g_source_unref (base_source);

  return pollable_source;
}

static void
mock_output_stream_pollable_init (GPollableOutputStreamInterface *iface)
{
  iface->is_writable = mock_output_stream_is_writable;
  iface->create_source = mock_output_stream_create_source;
}

GOutputStream *
mock_output_stream_new (GString *buffer)
{
  MockOutputStream *self = g_object_new (MOCK_TYPE_OUTPUT_STREAM, NULL);
  self->buffer = buffer;
  return G_OUTPUT_STREAM (self);
}

void
mock_output_stream_fail (MockOutputStream *self,
                         GError *write_error,
                         GError *flush_error,
                         GError *close_error)
{
  g_clear_error (&self->write_error);
  self->write_error = write_error;

  g_clear_error (&self->flush_error);
  self->flush_error = flush_error;

  g_clear_error (&self->close_error);
  self->close_error = close_error;
}
