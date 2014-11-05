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

#include <stdio.h>
#include <unistd.h>
#include <math.h>
#include <fts.h>

#include "daemon.h"
#include "cgroupmonitor.h"

#include "common/cockpitmemory.h"

#define SAMPLES_MAX 300

/**
 * SECTION:cgroupmonitor
 * @title: CGroupMonitor
 * @short_description: Implementation of #CockpitResourceMonitor for CGROUP usage
 *
 * This type provides an implementation of the #CockpitResourceMonitor interface for CGROUP usage.
 */

typedef struct
{
  double mem_usage_in_bytes;
  double mem_limit_in_bytes;
  double memsw_usage_in_bytes;
  double memsw_limit_in_bytes;

  double cpuacct_usage;
  double cpuacct_usage_perc;
  double cpu_shares;
} Sample;

typedef struct {
  gint64 last_timestamp;        // the time when this consumer disappeared, 0 when it still exists
  Sample samples[SAMPLES_MAX];
} Consumer;

typedef struct _CGroupMonitorClass CGroupMonitorClass;

/**
 * CGroupMonitor:
 *
 * The #CGroupMonitor structure contains only private data and should
 * only be accessed using the provided API.
 */

struct _CGroupMonitor
{
  CockpitMultiResourceMonitorSkeleton parent_instance;

  gchar *basedir;

  gchar *memory_root;
  gchar *cpuacct_root;

  gint samples_prev;
  guint samples_next;

  /* Path -> Consumer
   */
  GHashTable *consumers;

  /* SAMPLES_MAX timestamps for the samples
   */
  gint64 *timestamps;
};

struct _CGroupMonitorClass
{
  CockpitMultiResourceMonitorSkeletonClass parent_class;
};

enum
{
  PROP_0,
  PROP_TICK_SOURCE,
  PROP_BASEDIR
};

static void resource_monitor_iface_init (CockpitMultiResourceMonitorIface *iface);

G_DEFINE_TYPE_WITH_CODE (CGroupMonitor, cgroup_monitor, COCKPIT_TYPE_MULTI_RESOURCE_MONITOR_SKELETON,
                         G_IMPLEMENT_INTERFACE (COCKPIT_TYPE_MULTI_RESOURCE_MONITOR, resource_monitor_iface_init));

static void on_tick (GObject    *unused_source,
                     guint64     delta_usec,
                     gpointer    user_data);

/* ---------------------------------------------------------------------------------------------------- */

static void
cgroup_monitor_init (CGroupMonitor *monitor)
{
  monitor->samples_prev = -1;
  monitor->consumers = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, g_free);
  monitor->timestamps = g_new0 (gint64, SAMPLES_MAX);
}

static void
cgroup_monitor_finalize (GObject *object)
{
  CGroupMonitor *monitor = CGROUP_MONITOR (object);

  g_free (monitor->basedir);
  g_free (monitor->memory_root);
  g_free (monitor->cpuacct_root);
  g_hash_table_destroy (monitor->consumers);
  g_free (monitor->timestamps);

  G_OBJECT_CLASS (cgroup_monitor_parent_class)->finalize (object);
}

static void
cgroup_monitor_set_property (GObject *object,
                             guint prop_id,
                             const GValue *value,
                             GParamSpec *pspec)
{
  CGroupMonitor *monitor = CGROUP_MONITOR (object);

  switch (prop_id)
    {
    case PROP_TICK_SOURCE:
      g_signal_connect_object (g_value_get_object (value),
                               "tick", G_CALLBACK (on_tick),
                               monitor, 0);
      break;
    case PROP_BASEDIR:
      monitor->basedir = g_value_dup_string (value);
      break;
    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void collect (CGroupMonitor *monitor);

static void
on_tick (GObject *unused_source,
         guint64 delta_usec,
         gpointer user_data)
{
  CGroupMonitor *monitor = CGROUP_MONITOR (user_data);
  collect (monitor);
}

static void
cgroup_monitor_constructed (GObject *object)
{
  CGroupMonitor *monitor = CGROUP_MONITOR (object);

  const gchar *legends[] =
    { "Memory in use",
      "Memory allowed",
      "Memory+swap in use",
      "Memory+swap allowed",
      "CPU",
      "CPU shares",
      NULL
    };

  cockpit_multi_resource_monitor_set_num_samples (COCKPIT_MULTI_RESOURCE_MONITOR (monitor), SAMPLES_MAX);
  cockpit_multi_resource_monitor_set_legends (COCKPIT_MULTI_RESOURCE_MONITOR (monitor), legends);
  cockpit_multi_resource_monitor_set_num_series (COCKPIT_MULTI_RESOURCE_MONITOR (monitor), 6);

  monitor->memory_root = g_build_filename (monitor->basedir, "memory", NULL);
  monitor->cpuacct_root = g_build_filename (monitor->basedir, "cpuacct", NULL);

  collect (monitor);

  G_OBJECT_CLASS (cgroup_monitor_parent_class)->constructed (object);
}

static void
cgroup_monitor_class_init (CGroupMonitorClass *klass)
{
  GObjectClass *gobject_class;

  gobject_class = G_OBJECT_CLASS (klass);
  gobject_class->finalize = cgroup_monitor_finalize;
  gobject_class->constructed = cgroup_monitor_constructed;
  gobject_class->set_property = cgroup_monitor_set_property;

  /**
   * CGroupMonitor:tick-source:
   *
   * An object which emits a tick signal, like a #Daemon
   */
  g_object_class_install_property (gobject_class,
                                   PROP_TICK_SOURCE,
                                   g_param_spec_object ("tick-source",
                                                        NULL,
                                                        NULL,
                                                        G_TYPE_OBJECT,
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY |
                                                        G_PARAM_STATIC_STRINGS));

  g_object_class_install_property (gobject_class, PROP_BASEDIR,
          g_param_spec_string ("base-directory", NULL, NULL, "/sys/fs/cgroup",
                               G_PARAM_WRITABLE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));

}

/**
 * cgroup_monitor_new:
 * @root: The name of the root of the cgroup hierachy to monitor.
 * @tick_source: An object which emits a signal like a tick source
 *
 * Creates a new #CGroupMonitor instance.
 *
 * Returns: A new #CGroupMonitor. Free with g_object_unref().
 */
CockpitMultiResourceMonitor *
cgroup_monitor_new (GObject *tick_source)
{
  return COCKPIT_MULTI_RESOURCE_MONITOR (g_object_new (TYPE_CGROUP_MONITOR,
                                                       "tick-source", tick_source,
                                                       NULL));
}

/* ---------------------------------------------------------------------------------------------------- */

static void
update_consumers_property (CGroupMonitor *monitor)
{
  guint n_cgroups =  g_hash_table_size (monitor->consumers);
  const gchar **prop_value = g_new0 (const gchar *, n_cgroups+1);
  GList *cgroups = g_hash_table_get_keys (monitor->consumers);

  GList *l;
  int i;
  for (l = cgroups, i = 0; l != NULL && i < n_cgroups; l = l->next, i++)
    prop_value[i] = l->data;

  g_debug ("updating to %d consumers", i);
  cockpit_multi_resource_monitor_set_consumers (COCKPIT_MULTI_RESOURCE_MONITOR (monitor), prop_value);
  g_list_free (cgroups);
  g_free (prop_value);
}

static double
read_double (const gchar *prefix,
             const gchar *suffix)
{
  cleanup_free gchar *path = NULL;
  cleanup_free gchar *file_contents = NULL;
  gsize len;
  GError *error = NULL;

  path = g_build_filename (prefix, suffix, NULL);
  if (!g_file_get_contents (path,
                            &file_contents,
                            &len,
                            &error))
    {
      g_debug ("Error loading contents %s: %s (%s, %d)",
               path, error->message, g_quark_to_string (error->domain), error->code);
      g_error_free (error);
      return -1;
    }

  return g_ascii_strtod (file_contents, NULL);
}

typedef struct {
  CGroupMonitor *monitor;
  gint64 now;
  gboolean need_update_consumers_property;
} CollectData;

static void
notice_cgroup (CollectData *data,
               const gchar *cgroup)
{
  Consumer *consumer;

  consumer = g_hash_table_lookup (data->monitor->consumers, cgroup);
  if (consumer == NULL)
    {
      consumer = g_new0 (Consumer, 1);
      g_hash_table_insert (data->monitor->consumers, g_strdup (cgroup), consumer);
      data->need_update_consumers_property = TRUE;
    }
  else
    consumer->last_timestamp = 0;
}

static void
notice_cgroups_in_hierarchy (CollectData *data,
                             const gchar *prefix)
{
  FTS *fs;
  FTSENT *ent;
  gint prefix_len = strlen (prefix);
  const gchar * paths[] = { prefix, NULL };

  fs = fts_open ((gchar **)paths, FTS_NOCHDIR | FTS_COMFOLLOW, NULL);
  if (fs)
    {
      while((ent = fts_read (fs)))
          {
            if (ent->fts_info == FTS_D)
              {
                const char *f = ent->fts_path + prefix_len;
                if (*f == '/')
                  f++;
                notice_cgroup (data, f);
              }
          }
      fts_close (fs);
    }
}

static gboolean
calc_percentage (CGroupMonitor *monitor,
                 gint64 sample_timestamp,
                 gint64 last_timestamp,
                 double sample_value,
                 double last_value)
{
  gdouble ret;
  gdouble nanosecs_usage_in_period;
  gdouble nanosecs_in_period;

  nanosecs_usage_in_period = (sample_value - last_value);
  nanosecs_in_period = (sample_timestamp - last_timestamp) * 1000.0;
  ret = 100.0 * nanosecs_usage_in_period / nanosecs_in_period;
  if (ret < 0.0)
    ret = 0.0;
  return ret;
}

static void
zero_sample (Sample *sample)
{
  sample->mem_usage_in_bytes = 0;
  sample->mem_limit_in_bytes = 0;
  sample->memsw_usage_in_bytes = 0;
  sample->memsw_limit_in_bytes = 0;
  sample->cpuacct_usage = 0;
  sample->cpuacct_usage_perc = 0;
  sample->cpu_shares = 0;
}

static void
collect_cgroup (gpointer key,
                gpointer value,
                gpointer user_data)
{
  CollectData *data = user_data;
  CGroupMonitor *monitor = data->monitor;
  const gchar *cgroup = key;
  Consumer *consumer = value;
  gboolean have_mem;
  gboolean have_cpu;

  Sample *sample = NULL, *prev_sample = NULL;

  sample = &(consumer->samples[monitor->samples_next]);
  zero_sample (sample);

  if (consumer->last_timestamp > 0)
    return;

  cleanup_free gchar *mem_dir = g_build_filename (monitor->memory_root, cgroup, NULL);
  cleanup_free gchar *cpu_dir = g_build_filename (monitor->cpuacct_root, cgroup, NULL);

  have_mem = access (mem_dir, F_OK) == 0;
  have_cpu = access (cpu_dir, F_OK) == 0;
  if (!have_mem && !have_cpu)
    {
      consumer->last_timestamp = data->now;
      return;
    }

  if (have_mem)
    {
      sample->mem_usage_in_bytes = read_double (mem_dir, "memory.usage_in_bytes");
      sample->mem_limit_in_bytes = read_double (mem_dir, "memory.limit_in_bytes");
      sample->memsw_usage_in_bytes = read_double (mem_dir, "memory.memsw.usage_in_bytes");
      sample->memsw_limit_in_bytes = read_double (mem_dir, "memory.memsw.limit_in_bytes");

      /* If at max for arch, then unlimited => zero */
      if (sample->mem_limit_in_bytes == (double)G_MAXSIZE ||
          sample->mem_limit_in_bytes == (double)G_MAXSSIZE)
        sample->mem_limit_in_bytes = 0;
      if (sample->memsw_limit_in_bytes == (double)G_MAXSIZE ||
          sample->memsw_limit_in_bytes == (double)G_MAXSSIZE)
        sample->memsw_limit_in_bytes = 0;
    }

  if (have_cpu)
    {
      sample->cpuacct_usage = read_double (cpu_dir, "cpuacct.usage");
      sample->cpu_shares = read_double (cpu_dir, "cpu.shares");
    }

  if (monitor->samples_prev >= 0)
    {
      prev_sample = &(consumer->samples[monitor->samples_prev]);
      sample->cpuacct_usage_perc = calc_percentage (monitor,
                                                    monitor->timestamps[monitor->samples_next],
                                                    monitor->timestamps[monitor->samples_prev],
                                                    sample->cpuacct_usage,
                                                    prev_sample->cpuacct_usage);
    }
  else
    {
      sample->cpuacct_usage_perc = 0.0;
    }
}

static gboolean
expire_consumer (gpointer key,
                 gpointer value,
                 gpointer user_data)
{
  CollectData *data = user_data;
  CGroupMonitor *monitor = data->monitor;
  Consumer *consumer = value;

  if (monitor->timestamps[monitor->samples_next]
      && monitor->timestamps[monitor->samples_next] == consumer->last_timestamp)
    {
      data->need_update_consumers_property = TRUE;
      return TRUE;
    }
  return FALSE;
}

static GVariant *
build_sample_variant (CGroupMonitor *monitor,
                      gint index)
{
  GVariantBuilder builder;
  GHashTableIter iter;
  gpointer key, value;

  g_variant_builder_init (&builder, G_VARIANT_TYPE("a{sad}"));
  g_hash_table_iter_init (&iter, monitor->consumers);
  while (g_hash_table_iter_next (&iter, &key, &value))
    {
      GVariantBuilder inner_builder;
      Sample *sample = ((Consumer *)value)->samples + index;
      g_variant_builder_init (&inner_builder, G_VARIANT_TYPE("ad"));
      g_variant_builder_add (&inner_builder, "d", sample->mem_usage_in_bytes);
      g_variant_builder_add (&inner_builder, "d", sample->mem_limit_in_bytes);
      g_variant_builder_add (&inner_builder, "d", sample->memsw_usage_in_bytes);
      g_variant_builder_add (&inner_builder, "d", sample->memsw_limit_in_bytes);
      g_variant_builder_add (&inner_builder, "d", sample->cpuacct_usage_perc);
      g_variant_builder_add (&inner_builder, "d", sample->cpu_shares);
      g_variant_builder_add (&builder, "{sad}", key, &inner_builder);
    }

  return g_variant_builder_end (&builder);
}

static void
collect (CGroupMonitor *monitor)
{
  CollectData data;
  data.monitor = monitor;
  data.now = g_get_real_time ();
  data.need_update_consumers_property = FALSE;

  /* We are looking for files like

     /sys/fs/cgroup/memory/.../memory.usage_in_bytes
     /sys/fs/cgroup/memory/.../memory.limit_in_bytes
     /sys/fs/cgroup/cpuacct/.../cpuacct.usage
  */

  monitor->timestamps[monitor->samples_next] = data.now;

  notice_cgroups_in_hierarchy (&data, monitor->memory_root);
  notice_cgroups_in_hierarchy (&data, monitor->cpuacct_root);
  g_hash_table_foreach (monitor->consumers, collect_cgroup, &data);

  cockpit_multi_resource_monitor_emit_new_sample (COCKPIT_MULTI_RESOURCE_MONITOR (monitor),
                                                  data.now,
                                                  build_sample_variant (monitor, monitor->samples_next));

  monitor->samples_prev = monitor->samples_next;
  monitor->samples_next += 1;
  if (monitor->samples_next == SAMPLES_MAX)
    monitor->samples_next = 0;

  g_hash_table_foreach_remove (monitor->consumers, expire_consumer, &data);
  if (data.need_update_consumers_property)
    update_consumers_property (monitor);
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
handle_get_samples (CockpitMultiResourceMonitor *_monitor,
                    GDBusMethodInvocation *invocation,
                    GVariant *arg_options)
{
  CGroupMonitor *monitor = CGROUP_MONITOR (_monitor);
  GVariantBuilder builder;
  gint n;

  g_variant_builder_init (&builder, G_VARIANT_TYPE ("a(xa{sad})"));

  for (n = 0; n < SAMPLES_MAX; n++)
    {
      gint pos;

      pos = monitor->samples_next + n;
      if (pos >= SAMPLES_MAX)
        pos -= SAMPLES_MAX;

      if (monitor->timestamps[pos] == 0)
        continue;

      g_variant_builder_add (&builder, "(x@a{sad})",
                             monitor->timestamps[pos],
                             build_sample_variant (monitor, pos));
    }

  cockpit_multi_resource_monitor_complete_get_samples (_monitor, invocation,
                                                       g_variant_builder_end (&builder));

  return TRUE;
}

static void
resource_monitor_iface_init (CockpitMultiResourceMonitorIface *iface)
{
  iface->handle_get_samples = handle_get_samples;
}
