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

#include "common/cockpitjson.h"

#include <math.h>

enum {
  DERIVE_NONE = 0,
  DERIVE_DELTA = 1,
  DERIVE_RATE = 2,
};

typedef struct {
  gint derive;
  gboolean has_instances;
  gint n_last_instances;
  gint n_next_instances;
} MetricInfo;

struct _CockpitMetricsPrivate {
  gboolean interpolate;
  gboolean compress;

  guint timeout;
  gint64 next;
  gint64 interval;

  gint64 meta_interval;
  gboolean meta_reset;
  JsonObject *last_meta;
  JsonObject *next_meta;

  gint n_metrics;
  MetricInfo *metric_info;
  gint64 last_timestamp;
  gint64 next_timestamp;
  double **last_data;
  double **next_data;
  gboolean derived_valid;
  double **derived;

  JsonArray *message;
};

G_DEFINE_ABSTRACT_TYPE (CockpitMetrics, cockpit_metrics, COCKPIT_TYPE_CHANNEL);

static void
cockpit_metrics_init (CockpitMetrics *self)
{
  self->priv = G_TYPE_INSTANCE_GET_PRIVATE (self, COCKPIT_TYPE_METRICS,
                                            CockpitMetricsPrivate);

  self->priv->interpolate = TRUE;
  self->priv->compress = TRUE;
}

static void
cockpit_metrics_recv (CockpitChannel *channel,
                      GBytes *message)
{
  cockpit_channel_fail (channel, "protocol-error", "received unexpected metrics1 payload");
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

  if (self->priv->last_meta)
    {
      json_object_unref (self->priv->last_meta);
      self->priv->last_meta = NULL;
    }

  if (self->priv->last_data)
    {
      g_free (self->priv->last_data[0]);
      g_free (self->priv->last_data);
      self->priv->last_data = NULL;
    }

  if (self->priv->next_meta)
    {
      json_object_unref (self->priv->next_meta);
      self->priv->next_meta = NULL;
    }

  if (self->priv->next_data)
    {
      g_free (self->priv->next_data[0]);
      g_free (self->priv->next_data);
      self->priv->next_data = NULL;
    }

  if (self->priv->derived)
    {
      g_free (self->priv->derived[0]);
      g_free (self->priv->derived);
      self->priv->derived = NULL;
    }

  g_free (self->priv->metric_info);
  self->priv->metric_info = NULL;

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
    {
      cockpit_channel_fail (COCKPIT_CHANNEL (self), "internal-error",
                            "invalid metric timeout tick offset");
    }

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

static void
realloc_next_buffer (CockpitMetrics *self)
{
  int total_next_instances = 0;
  for (int i = 0; i < self->priv->n_metrics; i++)
    total_next_instances += self->priv->metric_info[i].n_next_instances;
  g_free (self->priv->next_data[0]);
  self->priv->next_data[0] = g_new (double, total_next_instances);
  for (int i = 1; i < self->priv->n_metrics; i++)
      self->priv->next_data[i] = self->priv->next_data[i-1] + self->priv->metric_info[i-1].n_next_instances;
}

static void
realloc_derived_buffer (CockpitMetrics *self)
{
  int total_next_instances = 0;
  for (int i = 0; i < self->priv->n_metrics; i++)
    total_next_instances += self->priv->metric_info[i].n_next_instances;
  g_free (self->priv->derived[0]);
  self->priv->derived[0] = g_new (double, total_next_instances);
  for (int i = 1; i < self->priv->n_metrics; i++)
      self->priv->derived[i] = self->priv->derived[i-1] + self->priv->metric_info[i-1].n_next_instances;
  self->priv->derived_valid = FALSE;
}

static gboolean
update_for_meta (CockpitMetrics *self,
                 JsonObject *meta,
                 gboolean reset)
{
  CockpitChannel *channel = COCKPIT_CHANNEL (self);
  JsonArray *array;
  JsonObject *info;
  JsonArray *instances;
  guint length;
  gchar const *derive;

  array = json_object_get_array_member (meta, "metrics");
  g_return_val_if_fail (array != NULL, FALSE);
  length = json_array_get_length (array);

  if (self->priv->metric_info == NULL)
    {
      self->priv->n_metrics = length;
      self->priv->metric_info = g_new0 (MetricInfo, length);
      self->priv->last_data = g_new0 (double *, length);
      self->priv->next_data = g_new0 (double *, length);
      self->priv->derived = g_new0 (double *, length);

      reset = TRUE;
    }
  else if (self->priv->n_metrics != length)
    {
      cockpit_channel_fail (channel, "protocol-error",
                            "number of metrics must not change");
      return FALSE;
    }

  for (int i = 0; i < length; i++)
    {
      info = json_array_get_object_element (array, i);
      g_return_val_if_fail (info != NULL, FALSE);

      if (!cockpit_json_get_string (info, "derive", NULL, &derive))
        {
          cockpit_channel_fail (channel, "protocol-error",
                                "unsupported derive value: not a string");
          return FALSE;
        }

      if (!derive)
        {
          self->priv->metric_info[i].derive = DERIVE_NONE;
        }
      else if (g_str_equal (derive, "delta"))
        {
          self->priv->metric_info[i].derive = DERIVE_DELTA;
        }
      else if (g_str_equal (derive, "rate"))
        {
          self->priv->metric_info[i].derive = DERIVE_RATE;
        }
      else
        {
          cockpit_channel_fail (channel, "protocol-error",
                                "unsupported derive function: %s", derive);
          return FALSE;
        }

      if (!cockpit_json_get_array (info, "instances", NULL, &instances))
        {
          cockpit_channel_fail (channel, "protocol-error",
                                "unsupported instances value: not a string");
          return FALSE;
        }

      if (instances)
        {
          self->priv->metric_info[i].has_instances = TRUE;
          self->priv->metric_info[i].n_next_instances = json_array_get_length (instances);
        }
      else
        {
          self->priv->metric_info[i].has_instances = FALSE;
          self->priv->metric_info[i].n_next_instances = 1;
        }
    }

  realloc_next_buffer (self);
  realloc_derived_buffer (self);

  g_return_val_if_fail (cockpit_json_get_int (meta, "interval", 1000, &self->priv->meta_interval),
                        FALSE);

  self->priv->meta_reset = reset;
  return TRUE;
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
                           JsonObject *meta,
                           gboolean reset)
{
  cockpit_metrics_flush_data (self);

  if (self->priv->next_meta)
    json_object_unref (self->priv->next_meta);
  self->priv->next_meta = json_object_ref (meta);

  if (update_for_meta (self, meta, reset))
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
compute_and_maybe_push_value (CockpitMetrics *self,
                              double interpol_r,
                              int metric,
                              int next_instance,
                              int last_instance,
                              JsonArray *array,
                              int index)
{
  double val = self->priv->next_data[metric][next_instance];

  if (last_instance >= 0)
    {
      double last_val = self->priv->last_data[metric][last_instance];

      if (self->priv->interpolate && !isnan (last_val))
        {
          val = last_val * (1.0 - interpol_r) + val * interpol_r;
          self->priv->next_data[metric][next_instance] = val;
        }

      switch (self->priv->metric_info[metric].derive)
        {
        case DERIVE_DELTA:
          val = val - last_val;
          break;
        case DERIVE_RATE:
          val = (val - last_val) / (self->priv->next_timestamp - self->priv->last_timestamp) * 1000;
          break;
        case DERIVE_NONE:
          break;
        }
    }
  else
    {
      if (self->priv->metric_info[metric].derive != DERIVE_NONE)
        val = NAN;
    }

  if (self->priv->compress == FALSE
      || next_instance != last_instance
      || !self->priv->derived_valid
      || val != self->priv->derived[metric][next_instance])
    {
      self->priv->derived[metric][next_instance] = val;

      JsonNode *node = json_node_new (JSON_NODE_VALUE);
      if (!isnan (val))
        json_node_set_double (node, val);
      else
        json_node_set_boolean (node, FALSE);
      array = push_array_at (array, index, node);
    }

  return array;
}

static int
find_last_instance (CockpitMetrics *self,
                    int metric,
                    int instance)
{
  if (self->priv->meta_reset)
    return -1;

  if (self->priv->last_meta == self->priv->next_meta)
    return instance;

  JsonArray *last_metrics = json_object_get_array_member (self->priv->last_meta, "metrics");
  JsonArray *next_metrics = json_object_get_array_member (self->priv->next_meta, "metrics");
  if (last_metrics == NULL
      || next_metrics == NULL
      || json_array_get_length (last_metrics) <= metric
      || json_array_get_length (next_metrics) <= metric)
    return -1;

  JsonObject *last_metric = json_array_get_object_element (last_metrics, metric);
  JsonObject *next_metric = json_array_get_object_element (next_metrics, metric);
  if (last_metric == NULL
      || next_metric == NULL)
    return -1;

  JsonArray *last_instances = json_object_get_array_member (last_metric, "instances");
  JsonArray *next_instances = json_object_get_array_member (next_metric, "instances");
  if (last_instances == NULL
      || next_instances == NULL
      || json_array_get_length (next_instances) <= instance)
    return -1;

  int n_last_instances = json_array_get_length (last_instances);
  const gchar *next_instance = json_array_get_string_element (next_instances, instance);
  for (int i = 0; i < n_last_instances; i++)
    {
      if (g_strcmp0 (json_array_get_string_element (last_instances, i), next_instance) == 0)
        return i;
    }

  return -1;
}

static JsonArray *
build_json_data (CockpitMetrics *self, double interpol_r)
{
  JsonArray *output = NULL;
  JsonNode *node;

  for (int i = 0; i < self->priv->n_metrics; i++)
    {
      if (self->priv->metric_info[i].has_instances)
        {
          JsonArray *res = NULL;
          for (int j = 0; j < self->priv->metric_info[i].n_next_instances; j++)
            res = compute_and_maybe_push_value (self, interpol_r, i, j, find_last_instance (self, i, j), res, j);
          node = json_node_new (JSON_NODE_ARRAY);
          json_node_take_array (node, res ? res : json_array_new ());
          output = push_array_at (output, i, node);
        }
      else
        output = compute_and_maybe_push_value (self, interpol_r, i, 0, (self->priv->meta_reset? -1 : 0), output, i);
    }

  if (output == NULL)
    output = json_array_new ();
  return output;
}

double **
cockpit_metrics_get_data_buffer (CockpitMetrics *self)
{
  return self->priv->next_data;
}

/*
 * cockpit_metrics_send_data:
 * @self: The CockpitMetrics
 *
 * Send metrics data down the channel, possibly doing interframe
 * compression between what was sent last.  The data to send comes
 * from the buffer returned by @cockpit_metrics_get_data_buffer.
 */
void
cockpit_metrics_send_data (CockpitMetrics *self, gint64 timestamp)
{
  JsonArray *res;
  double interpol_r = 1.0;

  if (self->priv->message == NULL)
    self->priv->message = json_array_new ();

  if (self->priv->interpolate && !self->priv->meta_reset)
    {
      double interval = ((double)(timestamp - self->priv->last_timestamp));
      if (interval > 0)
        {
          interpol_r = self->priv->meta_interval / interval;
          timestamp = self->priv->last_timestamp + self->priv->meta_interval;
        }
    }

  self->priv->next_timestamp = timestamp;

  res = build_json_data (self, interpol_r);
  json_array_add_array_element (self->priv->message, res);

  /* Now setup for the next round by swapping buffers and then making
     sure that the new 'next' buffer has the right layout.
   */

  double **t = self->priv->last_data;
  self->priv->last_data = self->priv->next_data;
  self->priv->next_data = t;

  if (self->priv->last_meta != self->priv->next_meta)
    {
      realloc_next_buffer (self);

      for (int i = 0; i < self->priv->n_metrics; i++)
        self->priv->metric_info[i].n_last_instances = self->priv->metric_info[i].n_next_instances;

      if (self->priv->last_meta)
        json_object_unref (self->priv->last_meta);
      self->priv->last_meta = json_object_ref (self->priv->next_meta);
    }

  self->priv->derived_valid = TRUE;
  self->priv->last_timestamp = self->priv->next_timestamp;
  self->priv->meta_reset = FALSE;
}

void
cockpit_metrics_flush_data (CockpitMetrics *self)
{
  if (self->priv->message)
    {
      send_array (self, self->priv->message);
      json_array_unref (self->priv->message);
      self->priv->message = NULL;
    }
}

void
cockpit_metrics_set_interpolate (CockpitMetrics *self,
                                 gboolean interpolate)
{
  self->priv->interpolate = interpolate;
}

void
cockpit_metrics_set_compress (CockpitMetrics *self,
                              gboolean compress)
{
  self->priv->compress = compress;
}
