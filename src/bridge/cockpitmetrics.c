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

typedef struct {
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
} CockpitMetricsPrivate;

G_DEFINE_ABSTRACT_TYPE_WITH_CODE (CockpitMetrics, cockpit_metrics, COCKPIT_TYPE_CHANNEL,
                                  G_ADD_PRIVATE (CockpitMetrics));

#define GET_PRIV(self) ((CockpitMetricsPrivate *) cockpit_metrics_get_instance_private (self))

static void
cockpit_metrics_init (CockpitMetrics *self)
{
  GET_PRIV(self)->interpolate = TRUE;
  GET_PRIV(self)->compress = TRUE;
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

  if (GET_PRIV(self)->timeout)
    {
      g_source_remove (GET_PRIV(self)->timeout);
      GET_PRIV(self)->timeout = 0;
    }

  COCKPIT_CHANNEL_CLASS (cockpit_metrics_parent_class)->close (channel, problem);
}

static void
cockpit_metrics_dispose (GObject *object)
{
  CockpitMetrics *self = COCKPIT_METRICS (object);

  if (GET_PRIV(self)->timeout)
    {
      g_source_remove (GET_PRIV(self)->timeout);
      GET_PRIV(self)->timeout = 0;
    }

  if (GET_PRIV(self)->last_meta)
    {
      json_object_unref (GET_PRIV(self)->last_meta);
      GET_PRIV(self)->last_meta = NULL;
    }

  if (GET_PRIV(self)->last_data)
    {
      g_free (GET_PRIV(self)->last_data[0]);
      g_free (GET_PRIV(self)->last_data);
      GET_PRIV(self)->last_data = NULL;
    }

  if (GET_PRIV(self)->next_meta)
    {
      json_object_unref (GET_PRIV(self)->next_meta);
      GET_PRIV(self)->next_meta = NULL;
    }

  if (GET_PRIV(self)->next_data)
    {
      g_free (GET_PRIV(self)->next_data[0]);
      g_free (GET_PRIV(self)->next_data);
      GET_PRIV(self)->next_data = NULL;
    }

  if (GET_PRIV(self)->derived)
    {
      g_free (GET_PRIV(self)->derived[0]);
      g_free (GET_PRIV(self)->derived);
      GET_PRIV(self)->derived = NULL;
    }

  g_free (GET_PRIV(self)->metric_info);
  GET_PRIV(self)->metric_info = NULL;

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
}

static gboolean
on_timeout_tick (gpointer data)
{
  CockpitMetrics *self = data;
  CockpitMetricsClass *klass;
  gint64 next_interval;

  if (GET_PRIV(self)->timeout > 0)
    {
      g_source_remove (GET_PRIV(self)->timeout);
      GET_PRIV(self)->timeout = 0;
    }

  klass = COCKPIT_METRICS_GET_CLASS (self);
  if (klass->tick)
    (klass->tick) (self, GET_PRIV(self)->next);

  GET_PRIV(self)->next += GET_PRIV(self)->interval;
  next_interval = GET_PRIV(self)->next - g_get_monotonic_time() / 1000;
  if (next_interval < 0)
    next_interval = 0;

  if (next_interval <= G_MAXUINT)
    GET_PRIV(self)->timeout = g_timeout_add (next_interval, on_timeout_tick, self);
  else if (next_interval / 1000 <= G_MAXUINT)
    GET_PRIV(self)->timeout = g_timeout_add_seconds (next_interval / 1000, on_timeout_tick, self);
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
  g_return_if_fail (GET_PRIV(self)->timeout == 0);
  g_return_if_fail (interval > 0);

  GET_PRIV(self)->next = g_get_monotonic_time() / 1000;
  GET_PRIV(self)->interval = interval;
  on_timeout_tick (self);
}

static void
realloc_next_buffer (CockpitMetrics *self)
{
  int total_next_instances = 0;
  for (int i = 0; i < GET_PRIV(self)->n_metrics; i++)
    total_next_instances += GET_PRIV(self)->metric_info[i].n_next_instances;
  g_free (GET_PRIV(self)->next_data[0]);
  GET_PRIV(self)->next_data[0] = g_new (double, total_next_instances);
  for (int i = 1; i < GET_PRIV(self)->n_metrics; i++)
      GET_PRIV(self)->next_data[i] = GET_PRIV(self)->next_data[i-1] + GET_PRIV(self)->metric_info[i-1].n_next_instances;
}

static void
realloc_derived_buffer (CockpitMetrics *self)
{
  int total_next_instances = 0;
  for (int i = 0; i < GET_PRIV(self)->n_metrics; i++)
    total_next_instances += GET_PRIV(self)->metric_info[i].n_next_instances;
  g_free (GET_PRIV(self)->derived[0]);
  GET_PRIV(self)->derived[0] = g_new (double, total_next_instances);
  for (int i = 1; i < GET_PRIV(self)->n_metrics; i++)
      GET_PRIV(self)->derived[i] = GET_PRIV(self)->derived[i-1] + GET_PRIV(self)->metric_info[i-1].n_next_instances;
  GET_PRIV(self)->derived_valid = FALSE;
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

  if (GET_PRIV(self)->metric_info == NULL)
    {
      GET_PRIV(self)->n_metrics = length;
      GET_PRIV(self)->metric_info = g_new0 (MetricInfo, length);
      GET_PRIV(self)->last_data = g_new0 (double *, length);
      GET_PRIV(self)->next_data = g_new0 (double *, length);
      GET_PRIV(self)->derived = g_new0 (double *, length);

      reset = TRUE;
    }
  else if (GET_PRIV(self)->n_metrics != length)
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
          GET_PRIV(self)->metric_info[i].derive = DERIVE_NONE;
        }
      else if (g_str_equal (derive, "delta"))
        {
          GET_PRIV(self)->metric_info[i].derive = DERIVE_DELTA;
        }
      else if (g_str_equal (derive, "rate"))
        {
          GET_PRIV(self)->metric_info[i].derive = DERIVE_RATE;
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
          GET_PRIV(self)->metric_info[i].has_instances = TRUE;
          GET_PRIV(self)->metric_info[i].n_next_instances = json_array_get_length (instances);
        }
      else
        {
          GET_PRIV(self)->metric_info[i].has_instances = FALSE;
          GET_PRIV(self)->metric_info[i].n_next_instances = 1;
        }
    }

  realloc_next_buffer (self);
  realloc_derived_buffer (self);

  g_return_val_if_fail (cockpit_json_get_int (meta, "interval", 1000, &GET_PRIV(self)->meta_interval),
                        FALSE);

  GET_PRIV(self)->meta_reset = reset;
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

  if (GET_PRIV(self)->next_meta)
    json_object_unref (GET_PRIV(self)->next_meta);
  GET_PRIV(self)->next_meta = json_object_ref (meta);

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
  double val = GET_PRIV(self)->next_data[metric][next_instance];

  if (last_instance >= 0)
    {
      double last_val = GET_PRIV(self)->last_data[metric][last_instance];

      if (GET_PRIV(self)->interpolate && !isnan (last_val))
        {
          val = last_val * (1.0 - interpol_r) + val * interpol_r;
          GET_PRIV(self)->next_data[metric][next_instance] = val;
        }

      switch (GET_PRIV(self)->metric_info[metric].derive)
        {
        case DERIVE_DELTA:
          val = val - last_val;
          break;
        case DERIVE_RATE:
          val = (val - last_val) / (GET_PRIV(self)->next_timestamp - GET_PRIV(self)->last_timestamp) * 1000;
          break;
        case DERIVE_NONE:
          break;
        }
    }
  else
    {
      if (GET_PRIV(self)->metric_info[metric].derive != DERIVE_NONE)
        val = NAN;
    }

  if (GET_PRIV(self)->compress == FALSE
      || next_instance != last_instance
      || !GET_PRIV(self)->derived_valid
      || val != GET_PRIV(self)->derived[metric][next_instance])
    {
      GET_PRIV(self)->derived[metric][next_instance] = val;

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
  if (GET_PRIV(self)->meta_reset)
    return -1;

  if (GET_PRIV(self)->last_meta == GET_PRIV(self)->next_meta)
    return instance;

  JsonArray *last_metrics = json_object_get_array_member (GET_PRIV(self)->last_meta, "metrics");
  JsonArray *next_metrics = json_object_get_array_member (GET_PRIV(self)->next_meta, "metrics");
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

  for (int i = 0; i < GET_PRIV(self)->n_metrics; i++)
    {
      if (GET_PRIV(self)->metric_info[i].has_instances)
        {
          JsonArray *res = NULL;
          for (int j = 0; j < GET_PRIV(self)->metric_info[i].n_next_instances; j++)
            res = compute_and_maybe_push_value (self, interpol_r, i, j, find_last_instance (self, i, j), res, j);
          node = json_node_new (JSON_NODE_ARRAY);
          json_node_take_array (node, res ? res : json_array_new ());
          output = push_array_at (output, i, node);
        }
      else
        output = compute_and_maybe_push_value (self, interpol_r, i, 0, (GET_PRIV(self)->meta_reset? -1 : 0), output, i);
    }

  if (output == NULL)
    output = json_array_new ();
  return output;
}

double **
cockpit_metrics_get_data_buffer (CockpitMetrics *self)
{
  return GET_PRIV(self)->next_data;
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

  if (GET_PRIV(self)->message == NULL)
    GET_PRIV(self)->message = json_array_new ();

  if (GET_PRIV(self)->interpolate && !GET_PRIV(self)->meta_reset)
    {
      double interval = ((double)(timestamp - GET_PRIV(self)->last_timestamp));
      if (interval > 0)
        {
          interpol_r = GET_PRIV(self)->meta_interval / interval;
          timestamp = GET_PRIV(self)->last_timestamp + GET_PRIV(self)->meta_interval;
        }
    }

  GET_PRIV(self)->next_timestamp = timestamp;

  res = build_json_data (self, interpol_r);
  json_array_add_array_element (GET_PRIV(self)->message, res);

  /* Now setup for the next round by swapping buffers and then making
     sure that the new 'next' buffer has the right layout.
   */

  double **t = GET_PRIV(self)->last_data;
  GET_PRIV(self)->last_data = GET_PRIV(self)->next_data;
  GET_PRIV(self)->next_data = t;

  if (GET_PRIV(self)->last_meta != GET_PRIV(self)->next_meta)
    {
      realloc_next_buffer (self);

      for (int i = 0; i < GET_PRIV(self)->n_metrics; i++)
        GET_PRIV(self)->metric_info[i].n_last_instances = GET_PRIV(self)->metric_info[i].n_next_instances;

      if (GET_PRIV(self)->last_meta)
        json_object_unref (GET_PRIV(self)->last_meta);
      GET_PRIV(self)->last_meta = json_object_ref (GET_PRIV(self)->next_meta);
    }

  GET_PRIV(self)->derived_valid = TRUE;
  GET_PRIV(self)->last_timestamp = GET_PRIV(self)->next_timestamp;
  GET_PRIV(self)->meta_reset = FALSE;
}

void
cockpit_metrics_flush_data (CockpitMetrics *self)
{
  if (GET_PRIV(self)->message)
    {
      send_array (self, GET_PRIV(self)->message);
      json_array_unref (GET_PRIV(self)->message);
      GET_PRIV(self)->message = NULL;
    }
}

void
cockpit_metrics_set_interpolate (CockpitMetrics *self,
                                 gboolean interpolate)
{
  GET_PRIV(self)->interpolate = interpolate;
}

void
cockpit_metrics_set_compress (CockpitMetrics *self,
                              gboolean compress)
{
  GET_PRIV(self)->compress = compress;
}
