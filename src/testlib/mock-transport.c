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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

#include "config.h"

#include "mock-transport.h"

#include "common/cockpitjson.h"

#include <gio/gio.h>

typedef CockpitTransportClass MockTransportClass;

typedef struct {
  gpointer data;
  GDestroyNotify func;
} Trash;

G_DEFINE_TYPE (MockTransport, mock_transport, COCKPIT_TYPE_TRANSPORT);

static void
trash_free (gpointer data)
{
  Trash *trash = data;
  (trash->func) (trash->data);
  g_free (trash);
}

static void
trash_push (MockTransport *self,
            gpointer data,
            GDestroyNotify func)
{
  Trash *trash = g_new0 (Trash, 1);
  g_assert (func != NULL);
  trash->data = data;
  trash->func = func;
  self->trash = g_list_prepend (self->trash, trash);
}

static void
mock_transport_init (MockTransport *self)
{
  self->channels = g_hash_table_new_full (g_str_hash, g_str_equal,
                                          g_free, (GDestroyNotify)g_queue_free);
  self->control = g_queue_new ();
}

static void
mock_transport_get_property (GObject *object,
                             guint prop_id,
                             GValue *value,
                             GParamSpec *pspec)
{
  switch (prop_id)
    {
    case 1:
      g_value_set_string (value, "mock-name");
      break;
    default:
      g_assert_not_reached ();
      break;
    }
}

static void
mock_transport_set_property (GObject *object,
                             guint prop_id,
                             const GValue *value,
                             GParamSpec *pspec)
{
  switch (prop_id)
    {
    case 1:
      break;
    default:
      g_assert_not_reached ();
      break;
    }
}

static void
mock_transport_finalize (GObject *object)
{
  MockTransport *self = (MockTransport *)object;

  g_free (self->problem);
  g_queue_free (self->control);
  g_list_free_full (self->trash, trash_free);
  g_hash_table_destroy (self->channels);

  G_OBJECT_CLASS (mock_transport_parent_class)->finalize (object);
}

static void
mock_transport_send (CockpitTransport *transport,
                     const gchar *channel_id,
                     GBytes *data)
{
  MockTransport *self = (MockTransport *)transport;
  JsonObject *object;
  GError *error = NULL;
  GQueue *queue;

  if (!channel_id)
    {
      object = cockpit_json_parse_bytes (data, &error);
      g_assert_no_error (error);
      g_queue_push_tail (self->control, object);
      trash_push (self, object, (GDestroyNotify)json_object_unref);
    }
  else
    {
      queue = g_hash_table_lookup (self->channels, channel_id);
      if (!queue)
        {
          queue = g_queue_new ();
          g_hash_table_insert (self->channels, g_strdup (channel_id), queue);
        }
      g_queue_push_tail (queue, g_bytes_ref (data));
      trash_push (self, data, (GDestroyNotify)g_bytes_unref);
    }
  self->count++;
}

static void
mock_transport_close (CockpitTransport *transport,
                      const gchar *problem)
{
  MockTransport *self = (MockTransport *)transport;
  g_assert (!self->closed);
  self->problem = g_strdup (problem);
  self->closed = TRUE;
  cockpit_transport_emit_closed (transport, problem);
}

static void
mock_transport_class_init (MockTransportClass *klass)
{
  GObjectClass *object_class = G_OBJECT_CLASS (klass);
  CockpitTransportClass *transport_class = COCKPIT_TRANSPORT_CLASS (klass);
  object_class->finalize = mock_transport_finalize;
  object_class->get_property = mock_transport_get_property;
  object_class->set_property = mock_transport_set_property;
  g_object_class_override_property (object_class, 1, "name");
  transport_class->send = mock_transport_send;
  transport_class->close = mock_transport_close;
}

MockTransport *
mock_transport_new (void)
{
  return g_object_new (MOCK_TYPE_TRANSPORT, NULL);
}

GBytes *
mock_transport_pop_channel (MockTransport *mock,
                            const gchar *channel_id)
{
  GQueue *queue;

  g_assert (channel_id != NULL);

  queue = g_hash_table_lookup (mock->channels, channel_id);
  if (queue)
    return g_queue_pop_head (queue);
  return NULL;
}

JsonObject *
mock_transport_pop_control (MockTransport *mock)
{
  return g_queue_pop_head (mock->control);
}

guint
mock_transport_count_sent (MockTransport *mock)
{
  return mock->count;
}

GBytes *
mock_transport_combine_output (MockTransport *transport,
                               const gchar *channel_id,
                               guint *count)
{
  GByteArray *combined;
  GBytes *block;

  if (count)
    *count = 0;

  combined = g_byte_array_new ();
  for (;;)
    {
      block = mock_transport_pop_channel (transport, channel_id);
      if (!block)
        break;

      g_byte_array_append (combined, g_bytes_get_data (block, NULL), g_bytes_get_size (block));
      if (count)
        (*count)++;
    }
  return g_byte_array_free_to_bytes (combined);
}
