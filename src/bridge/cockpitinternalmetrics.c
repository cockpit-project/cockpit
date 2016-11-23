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

#include <math.h>
#include <sys/time.h>

#include "cockpitmetrics.h"
#include "cockpitinternalmetrics.h"
#include "cockpitsamples.h"
#include "cockpitcpusamples.h"
#include "cockpitmemorysamples.h"
#include "cockpitblocksamples.h"
#include "cockpitnetworksamples.h"
#include "cockpitmountsamples.h"
#include "cockpitcgroupsamples.h"
#include "cockpitdisksamples.h"

#include "common/cockpitjson.h"

/**
 * CockpitInternalMetrics:
 *
 * A #CockpitMetrics channel that pulls data from internal sources
 */

static void cockpit_samples_interface_init (CockpitSamplesIface *iface);

#define COCKPIT_INTERNAL_METRICS(o) \
  (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_INTERNAL_METRICS, CockpitInternalMetrics))

typedef enum {
  CPU_SAMPLER = 1 << 0,
  MEMORY_SAMPLER = 1 << 1,
  BLOCK_SAMPLER = 1 << 2,
  NETWORK_SAMPLER = 1 << 3,
  MOUNT_SAMPLER = 1 << 4,
  CGROUP_SAMPLER = 1 << 5,
  DISK_SAMPLER = 1 << 6
} SamplerSet;

typedef struct {
  const gchar *name;
  const gchar *units;
  const gchar *semantics;
  gboolean instanced;
  SamplerSet sampler;
} MetricDescription;

static MetricDescription metric_descriptions[] = {
  { "cpu.basic.nice",   "millisec", "counter", FALSE, CPU_SAMPLER },
  { "cpu.basic.user",   "millisec", "counter", FALSE, CPU_SAMPLER },
  { "cpu.basic.system", "millisec", "counter", FALSE, CPU_SAMPLER },
  { "cpu.basic.iowait", "millisec", "counter", FALSE, CPU_SAMPLER },

  { "memory.free",      "bytes", "instant", FALSE, MEMORY_SAMPLER },
  { "memory.used",      "bytes", "instant", FALSE, MEMORY_SAMPLER },
  { "memory.cached",    "bytes", "instant", FALSE, MEMORY_SAMPLER },
  { "memory.swap-used", "bytes", "instant", FALSE, MEMORY_SAMPLER },

  { "block.device.read",    "bytes", "counter", TRUE, BLOCK_SAMPLER },
  { "block.device.written", "bytes", "counter", TRUE, BLOCK_SAMPLER },

  { "disk.all.read",    "bytes", "counter", FALSE, DISK_SAMPLER },
  { "disk.all.written", "bytes", "counter", FALSE, DISK_SAMPLER },

  { "network.all.rx",       "bytes", "counter", FALSE, NETWORK_SAMPLER },
  { "network.all.tx",       "bytes", "counter", FALSE, NETWORK_SAMPLER },
  { "network.interface.rx", "bytes", "counter", TRUE,  NETWORK_SAMPLER },
  { "network.interface.tx", "bytes", "counter", TRUE,  NETWORK_SAMPLER },

  { "mount.total", "bytes", "instant", TRUE, MOUNT_SAMPLER },
  { "mount.used",  "bytes", "instant", TRUE, MOUNT_SAMPLER },

  { "cgroup.memory.usage",    "bytes",    "instant", TRUE, CGROUP_SAMPLER },
  { "cgroup.memory.limit",    "bytes",    "instant", TRUE, CGROUP_SAMPLER },
  { "cgroup.memory.sw-usage", "bytes",    "instant", TRUE, CGROUP_SAMPLER },
  { "cgroup.memory.sw-limit", "bytes",    "instant", TRUE, CGROUP_SAMPLER },
  { "cgroup.cpu.usage",       "millisec", "counter", TRUE, CGROUP_SAMPLER },
  { "cgroup.cpu.shares",      "count",    "instant", TRUE, CGROUP_SAMPLER },

  { NULL }
};

static MetricDescription *
find_metric_description (const gchar *name)
{
  for (MetricDescription *d = metric_descriptions; d->name; d++)
    {
      if (g_strcmp0 (d->name, name) == 0)
        return d;
    }

  return NULL;
}

typedef struct {
  gboolean seen;
  int index;
  double value;
} InstanceInfo;

typedef struct {
  MetricDescription *desc;
  const gchar *derive;

  GHashTable *instances;
  double value;
} MetricInfo;

typedef struct {
  CockpitMetrics parent;
  const gchar *name;

  gint64 interval;
  int n_metrics;
  MetricInfo *metrics;
  const gchar **instances;
  const gchar **omit_instances;
  SamplerSet samplers;

  gboolean need_meta;
} CockpitInternalMetrics;

typedef struct {
  CockpitMetricsClass parent_class;
} CockpitInternalMetricsClass;

G_DEFINE_TYPE_WITH_CODE (CockpitInternalMetrics, cockpit_internal_metrics, COCKPIT_TYPE_METRICS,
                         G_IMPLEMENT_INTERFACE (COCKPIT_TYPE_SAMPLES,
                                                cockpit_samples_interface_init))

static void
cockpit_internal_metrics_init (CockpitInternalMetrics *self)
{
}

static gint64
timestamp_from_timeval (struct timeval *tv)
{
  return tv->tv_sec * 1000 + tv->tv_usec / 1000;
}

static void
send_meta (CockpitInternalMetrics *self)
{
  JsonArray *metrics;
  JsonObject *metric;
  JsonObject *root;
  struct timeval now_timeval;
  gint64 now;

  gettimeofday (&now_timeval, NULL);
  now = timestamp_from_timeval (&now_timeval);

  root = json_object_new ();
  json_object_set_int_member (root, "timestamp", now);
  json_object_set_int_member (root, "now", now);
  json_object_set_int_member (root, "interval", self->interval);

  metrics = json_array_new ();
  for (int i = 0; i < self->n_metrics; i++)
    {
      MetricInfo *info = &self->metrics[i];
      metric = json_object_new ();

      /* Name and derivation mode
       */
      json_object_set_string_member (metric, "name", info->desc->name);
      if (info->derive)
        json_object_set_string_member (metric, "derive", info->derive);

      /* Instances
       */
      if (info->desc->instanced)
        {
          GHashTableIter iter;
          gpointer key, value;
          int index;
          JsonArray *instances = json_array_new ();

          g_hash_table_iter_init (&iter, info->instances);
          index = 0;
          while (g_hash_table_iter_next (&iter, &key, &value))
            {
              const gchar *name = key;
              InstanceInfo *inst = value;

              /* HACK: We can't use json_builder_add_string_value here since
                 it turns empty strings into 'null' values inside arrays.

                 https://bugzilla.gnome.org/show_bug.cgi?id=730803
              */
              {
                JsonNode *string_element = json_node_alloc ();
                json_node_init_string (string_element, name);
                json_array_add_element (instances, string_element);
              }

              inst->index = index++;
            }
          json_object_set_array_member (metric, "instances", instances);
        }

      /* Units and semantics
       */
      json_object_set_string_member (metric, "units", info->desc->units);
      json_object_set_string_member (metric, "semantics", info->desc->semantics);

      json_array_add_object_element (metrics, metric);
    }

  json_object_set_array_member (root, "metrics", metrics);

  cockpit_metrics_send_meta (COCKPIT_METRICS (self), root, FALSE);

  json_object_unref (root);
}

static void
cockpit_internal_metrics_sample (CockpitSamples *samples,
                                 const gchar *metric,
                                 const gchar *instance,
                                 gint64 value)
{
  CockpitInternalMetrics *self = COCKPIT_INTERNAL_METRICS (samples);

  for (int i = 0; i < self->n_metrics; i++)
    {
      MetricInfo *info = &self->metrics[i];
      if (g_strcmp0 (metric, info->desc->name) != 0)
        continue;

      if (info->desc->instanced)
        {
          InstanceInfo *inst = g_hash_table_lookup (info->instances, instance);
          if (inst == NULL)
            {
              g_debug ("%s + %s", metric, instance);
              inst = g_new0 (InstanceInfo, 1);
              g_hash_table_insert (info->instances, g_strdup (instance), inst);
              self->need_meta = TRUE;
            }
          inst->seen = TRUE;
          inst->value = value;
        }
      else
        info->value = value;
    }
}

static void
instance_reset (gpointer key,
                gpointer value,
                gpointer user_data)
{
  InstanceInfo *info = value;
  info->seen = FALSE;
}

static gboolean
instance_unseen (gpointer key,
                 gpointer value,
                 gpointer user_data)
{
  InstanceInfo *info = value;
  return !info->seen;
}

static void
cockpit_internal_metrics_tick (CockpitMetrics *metrics,
                               gint64 timestamp)
{
  CockpitInternalMetrics *self = (CockpitInternalMetrics *)metrics;
  struct timeval now_timeval;
  gint64 now;

  gettimeofday (&now_timeval, NULL);
  now = timestamp_from_timeval (&now_timeval);

  /* Reset samples
   */
  for (int i = 0; i < self->n_metrics; i++)
    {
      MetricInfo *info = &self->metrics[i];
      if (info->desc->instanced)
        g_hash_table_foreach (info->instances, instance_reset, NULL);
      else
        info->value = NAN;
    }

  /* Sample
   */
  if (self->samplers & CPU_SAMPLER)
    cockpit_cpu_samples (COCKPIT_SAMPLES (self));
  if (self->samplers & MEMORY_SAMPLER)
    cockpit_memory_samples (COCKPIT_SAMPLES (self));
  if (self->samplers & BLOCK_SAMPLER)
    cockpit_block_samples (COCKPIT_SAMPLES (self));
  if (self->samplers & NETWORK_SAMPLER)
    cockpit_network_samples (COCKPIT_SAMPLES (self));
  if (self->samplers & MOUNT_SAMPLER)
    cockpit_mount_samples (COCKPIT_SAMPLES (self));
  if (self->samplers & CGROUP_SAMPLER)
    cockpit_cgroup_samples (COCKPIT_SAMPLES (self));
  if (self->samplers & DISK_SAMPLER)
    cockpit_disk_samples (COCKPIT_SAMPLES (self));

  /* Check for disappeared instances
   */
  for (int i = 0; i < self->n_metrics; i++)
    {
      MetricInfo *info = &self->metrics[i];
      if (info->desc->instanced)
        if (g_hash_table_foreach_remove (info->instances, instance_unseen, NULL) > 0)
          self->need_meta = TRUE;
    }

  /* Send a meta message if necessary.  This will also allocate a new
     buffer and setup the instance indices.
   */
  if (self->need_meta)
    {
      send_meta (self);
      self->need_meta = FALSE;
    }

  /* Ship them out
   */
  double **buffer = cockpit_metrics_get_data_buffer (COCKPIT_METRICS (self));
  for (int i = 0; i < self->n_metrics; i++)
    {
      MetricInfo *info = &self->metrics[i];
      if (info->desc->instanced)
        {
          GHashTableIter iter;
          gpointer key, value;

          g_hash_table_iter_init (&iter, info->instances);
          while (g_hash_table_iter_next (&iter, &key, &value))
            {
              InstanceInfo *inst = value;
              buffer[i][inst->index] = inst->value;
            }
        }
      else
        buffer[i][0] = info->value;
    }

  cockpit_metrics_send_data (COCKPIT_METRICS (self), now);
  cockpit_metrics_flush_data (COCKPIT_METRICS (self));
}

static gboolean
convert_metric_description (CockpitInternalMetrics *self,
                            JsonNode *node,
                            MetricInfo *info,
                            int index)
{
  CockpitChannel *channel = COCKPIT_CHANNEL (self);
  const gchar *name;
  const gchar *units;

  if (json_node_get_node_type (node) == JSON_NODE_OBJECT)
    {
      if (!cockpit_json_get_string (json_node_get_object (node), "name", NULL, &name)
          || name == NULL)
        {
          cockpit_channel_fail (channel, "protocol-error",
                                "invalid \"metrics\" option was specified (no name for metric %d)", index);
          return FALSE;
        }

      if (!cockpit_json_get_string (json_node_get_object (node), "units", NULL, &units))
        {
          cockpit_channel_fail (channel, "protocol-error",
                                "invalid units for metric %s (not a string)", name);
          return FALSE;
        }

      if (!cockpit_json_get_string (json_node_get_object (node), "derive", NULL, &info->derive))
        {
          cockpit_channel_fail (channel, "protocol-error",
                                "invalid derivation mode for metric %s (not a string)", name);
          return FALSE;
        }
    }
  else
    {
      cockpit_channel_fail (channel, "protocol-error",
                            "invalid \"metrics\" option was specified (not an object for metric %d)", index);
      return FALSE;
    }

  MetricDescription *desc = find_metric_description (name);
  if (desc == NULL)
    {
      g_message ("unknown internal metric %s", name);
    }
  else
    {
      if (units && g_strcmp0 (desc->units, units) != 0)
        {
          cockpit_channel_fail (channel, "protocol-error",
                                "%s has units %s, not %s", name, desc->units, units);
          return FALSE;
        }

      if (desc->instanced)
        info->instances = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, g_free);

      info->desc = desc;
      self->samplers |= desc->sampler;
    }

  return TRUE;
}

static void
cockpit_internal_metrics_prepare (CockpitChannel *channel)
{
  CockpitInternalMetrics *self = COCKPIT_INTERNAL_METRICS (channel);
  JsonObject *options;
  JsonArray *metrics;
  int i;

  COCKPIT_CHANNEL_CLASS (cockpit_internal_metrics_parent_class)->prepare (channel);

  options = cockpit_channel_get_options (channel);

  /* "instances" option */
  if (!cockpit_json_get_strv (options, "instances", NULL, (gchar ***)&self->instances))
    {
      cockpit_channel_fail (channel, "protocol-error",
                            "invalid \"instances\" option (not an array of strings)");
      return;
    }

  /* "omit-instances" option */
  if (!cockpit_json_get_strv (options, "omit-instances", NULL, (gchar ***)&self->omit_instances))
    {
      cockpit_channel_fail (channel, "protocol-error",
                            "invalid \"omit-instances\" option (not an array of strings)");
      return;
    }

  /* "metrics" option */
  self->n_metrics = 0;
  if (!cockpit_json_get_array (options, "metrics", NULL, &metrics))
    {
      cockpit_channel_fail (channel, "protocol-error",
                            "invalid \"metrics\" option was specified (not an array)");
      return;
    }
  if (metrics)
    self->n_metrics = json_array_get_length (metrics);

  self->metrics = g_new0 (MetricInfo, self->n_metrics);
  for (i = 0; i < self->n_metrics; i++)
    {
      MetricInfo *info = &self->metrics[i];
      if (!convert_metric_description (self, json_array_get_element (metrics, i), info, i))
        return;
      if (!info->desc)
        {
          cockpit_channel_close (channel, "not-supported");
          return;
        }
    }

  /* "interval" option */
  if (!cockpit_json_get_int (options, "interval", 1000, &self->interval))
    {
      cockpit_channel_fail (channel, "protocol-error", "invalid \"interval\" option");
      return;
    }
  else if (self->interval <= 0 || self->interval > G_MAXINT)
    {
      cockpit_channel_fail (channel, "protocol-error",
                            "invalid \"interval\" value: %" G_GINT64_FORMAT, self->interval);
      return;
    }

  self->need_meta = TRUE;

  cockpit_metrics_metronome (COCKPIT_METRICS (self), self->interval);
  cockpit_channel_ready (channel, NULL);
}

static void
cockpit_internal_metrics_dispose (GObject *object)
{
#if 0
  CockpitInternalMetrics *self = COCKPIT_INTERNAL_METRICS (object);
#endif
  G_OBJECT_CLASS (cockpit_internal_metrics_parent_class)->dispose (object);
}

static void
cockpit_internal_metrics_finalize (GObject *object)
{
  CockpitInternalMetrics *self = COCKPIT_INTERNAL_METRICS (object);

  g_free (self->instances);
  g_free (self->omit_instances);
  g_free (self->metrics);

  G_OBJECT_CLASS (cockpit_internal_metrics_parent_class)->finalize (object);
}

static void
cockpit_internal_metrics_class_init (CockpitInternalMetricsClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);
  CockpitMetricsClass *metrics_class = COCKPIT_METRICS_CLASS (klass);
  CockpitChannelClass *channel_class = COCKPIT_CHANNEL_CLASS (klass);

  gobject_class->dispose = cockpit_internal_metrics_dispose;
  gobject_class->finalize = cockpit_internal_metrics_finalize;

  channel_class->prepare = cockpit_internal_metrics_prepare;
  metrics_class->tick = cockpit_internal_metrics_tick;
}

static void
cockpit_samples_interface_init (CockpitSamplesIface *iface)
{
  iface->sample = cockpit_internal_metrics_sample;
}
