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

#include "cockpitmetrics.h"
#include "cockpitpcpmetrics.h"

#include "common/cockpitjson.h"

struct _CockpitMetricsPrivate {
  guint timeout;
  gint64 next;
  gint64 interval;
  JsonArray *last;
};

G_DEFINE_ABSTRACT_TYPE (CockpitMetrics, cockpit_metrics, COCKPIT_TYPE_CHANNEL);

static void
cockpit_metrics_init (CockpitMetrics *self)
{
  self->priv = G_TYPE_INSTANCE_GET_PRIVATE (self, COCKPIT_TYPE_METRICS,
                                            CockpitMetricsPrivate);
}

static void
cockpit_metrics_recv (CockpitChannel *channel,
                      GBytes *message)
{
  g_warning ("received unexpected metrics1 payload");
  cockpit_channel_close (channel, "protocol-error");
}

static void
cockpit_metrics_close (CockpitChannel *channel,
                       const gchar *problem)
{
  CockpitMetrics *self = COCKPIT_METRICS (channel);

  if (self->priv->timeout)
    {
      g_source_remove (self->priv->timeout);
      self->priv->timeout = 0;
    }

  COCKPIT_CHANNEL_CLASS (cockpit_metrics_parent_class)->close (channel, problem);
}

static void
cockpit_metrics_dispose (GObject *object)
{
  CockpitMetrics *self = COCKPIT_METRICS (object);

  if (self->priv->timeout)
    {
      g_source_remove (self->priv->timeout);
      self->priv->timeout = 0;
    }

  if (self->priv->last)
    {
      json_array_unref (self->priv->last);
      self->priv->last = NULL;
    }

  G_OBJECT_CLASS (cockpit_metrics_parent_class)->dispose (object);
}

static void
cockpit_metrics_class_init (CockpitMetricsClass *klass)
{
  CockpitChannelClass *channel_class = COCKPIT_CHANNEL_CLASS (klass);
  GObjectClass *object_class = G_OBJECT_CLASS (klass);

  object_class->dispose = cockpit_metrics_dispose;

  channel_class->recv = cockpit_metrics_recv;
  channel_class->close = cockpit_metrics_close;

  g_type_class_add_private (klass, sizeof (CockpitMetricsPrivate));
}

static gboolean
on_timeout_tick (gpointer data)
{
  CockpitMetrics *self = data;
  CockpitMetricsClass *klass;
  gint64 next_interval;

  if (self->priv->timeout > 0)
    {
      g_source_remove (self->priv->timeout);
      self->priv->timeout = 0;
    }

  klass = COCKPIT_METRICS_GET_CLASS (self);
  if (klass->tick)
    (klass->tick) (self, self->priv->next);

  self->priv->next += self->priv->interval;
  next_interval = self->priv->next - g_get_monotonic_time() / 1000;
  if (next_interval < 0)
    next_interval = 0;

  if (next_interval <= G_MAXUINT)
    self->priv->timeout = g_timeout_add (next_interval, on_timeout_tick, self);
  else if (next_interval / 1000 <= G_MAXUINT)
    self->priv->timeout = g_timeout_add_seconds (next_interval / 1000, on_timeout_tick, self);
  else
    cockpit_channel_close (COCKPIT_CHANNEL (self), "internal-error");

  return FALSE;
}

void
cockpit_metrics_metronome (CockpitMetrics *self,
                           gint64 interval)
{
  g_return_if_fail (self->priv->timeout == 0);
  g_return_if_fail (interval > 0);

  self->priv->next = g_get_monotonic_time() / 1000;
  self->priv->interval = interval;
  on_timeout_tick (self);
}

CockpitChannel *
cockpit_metrics_open (CockpitTransport *transport,
                      const gchar *id,
                      JsonObject *options)
{
  GType channel_type;
  const gchar *source;

    /* Source will be further validated when channel opens */
  if (!cockpit_json_get_string (options, "source", NULL, &source))
    source = NULL;

#if 0
  if (g_strcmp0 (source, "internal") == 0)
    channel_type = COCKPIT_TYPE_INTERNAL_METRICS;
  else
#endif
    channel_type = COCKPIT_TYPE_PCP_METRICS;

  return g_object_new (channel_type,
                       "transport", transport,
                       "id", id,
                       "options", options,
                       NULL);
}

static void
send_object (CockpitMetrics *self,
             JsonObject *object)
{
  CockpitChannel *channel = (CockpitChannel *)self;
  GBytes *bytes;

  bytes = cockpit_json_write_bytes (object);
  cockpit_channel_send (channel, bytes, TRUE);
  g_bytes_unref (bytes);
}

/*
 * cockpit_metrics_send_meta:
 * @self: The CockpitMetrics
 * @meta: An object containing metric meta data
 *
 * Send metrics meta data down the channel. If you use cockpit_metrics_send_data()
 * then you must use this function instead of sending stuff on the channel directly.
 */
void
cockpit_metrics_send_meta (CockpitMetrics *self,
                           JsonObject *meta)
{
  /* Cannot compress across meta message */
  if (self->priv->last)
    json_array_unref (self->priv->last);
  self->priv->last = NULL;

  send_object (self, meta);
}

static void
send_array (CockpitMetrics *self,
            JsonArray *array)
{
  CockpitChannel *channel = (CockpitChannel *)self;
  GBytes *bytes;
  JsonNode *node;
  gsize length;
  gchar *ret;

  node = json_node_new (JSON_NODE_ARRAY);
  json_node_set_array (node, array);
  ret = cockpit_json_write (node, &length);
  json_node_free (node);

  bytes = g_bytes_new_take (ret, length);
  cockpit_channel_send (channel, bytes, TRUE);
  g_bytes_unref (bytes);
}

static JsonArray *
push_array_at (JsonArray *array,
               guint index,
               JsonNode *node)
{
  if (array == NULL)
    array = json_array_new ();

  g_assert (index >= json_array_get_length (array));

  while (index > json_array_get_length (array))
    json_array_add_null_element (array);

  if (node)
    json_array_add_element (array, node);

  return array;
}

static JsonArray *
interframe_compress_samples (JsonArray *last,
                             JsonArray *samples)
{
  JsonArray *output = NULL;
  JsonArray *res = NULL;
  JsonNode *a, *b;
  JsonNode *node;
  guint alen;
  guint blen;
  guint i;

  if (last)
    {
      alen = json_array_get_length (last);
      blen = json_array_get_length (samples);

      for (i = 0; i < blen; i++)
        {
          a = NULL;
          if (i < alen)
            a = json_array_get_element (last, i);

          b = json_array_get_element (samples, i);

          if (a == NULL)
            {
              output = push_array_at (output, i, json_node_copy (b));
            }
          else if (json_node_get_node_type (a) == JSON_NODE_ARRAY &&
                   json_node_get_node_type (b) == JSON_NODE_ARRAY)
            {
              res = interframe_compress_samples (json_node_get_array (a),
                                                 json_node_get_array (b));
              node = json_node_new (JSON_NODE_ARRAY);
              json_node_take_array (node, res ? res : json_array_new ());
              output = push_array_at (output, i, node);
            }
          else if (!cockpit_json_equal (a, b))
            {
              output = push_array_at (output, i, json_node_copy (b));
            }
        }
      if (blen < alen)
        {
          output = push_array_at (output, blen, NULL);
        }
    }

  return output;
}

/*
 * cockpit_metrics_send_data:
 * @self: The CockpitMetrics
 * @data: An array of JSON arrays
 *
 * Send metrics data down the channel, possibly doing interframe
 * compression between what was sent last. @data should no longer
 * be modified by the caller.
 */
void
cockpit_metrics_send_data (CockpitMetrics *self,
                           JsonArray *data)
{
  JsonArray *res;

  res = interframe_compress_samples (self->priv->last, data);

  if (self->priv->last)
    json_array_unref (self->priv->last);
  self->priv->last = json_array_ref (data);

  if (res)
    {
      send_array (self, res);
      json_array_unref (res);
    }
  else
    {
      send_array (self, data);
    }
}
