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
