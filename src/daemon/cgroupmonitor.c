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

#include "gsystem-local-alloc.h"

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
  gint64 timestamp;
  double mem_usage_in_bytes;
  double mem_limit_in_bytes;
  double memsw_usage_in_bytes;
  double memsw_limit_in_bytes;

  double cpuacct_usage;
  double cpuacct_usage_perc;
} Sample;

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

  /* Path -> Arrays of SAMPLES_MAX Sample instances
   */
  GHashTable *samples;
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
  g_dbus_interface_skeleton_set_flags (G_DBUS_INTERFACE_SKELETON (monitor),
                                       G_DBUS_INTERFACE_SKELETON_FLAGS_HANDLE_METHOD_INVOCATIONS_IN_THREAD);

  monitor->samples_prev = -1;
  monitor->samples = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, g_free);
}

static void
cgroup_monitor_finalize (GObject *object)
{
  CGroupMonitor *monitor = CGROUP_MONITOR (object);

  g_free (monitor->basedir);
  g_free (monitor->memory_root);
  g_free (monitor->cpuacct_root);
  g_hash_table_destroy (monitor->samples);


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
      NULL
    };

  cockpit_multi_resource_monitor_set_num_samples (COCKPIT_MULTI_RESOURCE_MONITOR (monitor), SAMPLES_MAX);
  cockpit_multi_resource_monitor_set_legends (COCKPIT_MULTI_RESOURCE_MONITOR (monitor), legends);
  cockpit_multi_resource_monitor_set_num_series (COCKPIT_MULTI_RESOURCE_MONITOR (monitor), 5);

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
  guint n_cgroups =  g_hash_table_size (monitor->samples);
  const gchar **prop_value = g_new0 (const gchar *, n_cgroups+1);
  GList *cgroups = g_hash_table_get_keys (monitor->samples);

  GList *l;
  int i;
  for (l = cgroups, i = 0; l != NULL && i < n_cgroups; l = l->next, i++)
    prop_value[i] = l->data;

  cockpit_multi_resource_monitor_set_consumers (COCKPIT_MULTI_RESOURCE_MONITOR (monitor), prop_value);
  g_list_free (cgroups);
  g_free (prop_value);
}

static double
read_double (const gchar *prefix,
             const gchar *suffix)
{
  gs_free gchar *path = NULL;
  gs_free gchar *file_contents = NULL;
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
  GVariantBuilder signal_builder;
  gint64 now;
  gboolean need_update_consumers_property;
} CollectData;

static void
notice_cgroup (CollectData *data,
               const gchar *cgroup)
{
  Sample *samples;

  samples = g_hash_table_lookup (data->monitor->samples, cgroup);
  if (samples == NULL)
    {
      samples = g_new0 (Sample, SAMPLES_MAX);
      g_hash_table_insert (data->monitor->samples, g_strdup (cgroup), samples);
      data->need_update_consumers_property = TRUE;
    }
}

static void
notice_cgroups_in_hierarchy (CollectData *data,
                             const gchar *prefix)
{
  FTS *fs;
  FTSENT *ent;
  gint prefix_len = strlen (prefix);
  const gchar * paths[] = { prefix, NULL };

  fs = fts_open ((gchar **)paths, FTS_NOCHDIR, NULL);
  if (fs)
    {
      while((ent = fts_read (fs)))
          {
            if (ent->fts_info == FTS_D)
              {
                const char *f = ent->fts_path + prefix_len;
                if (*f == '/')
                  f++;
                if (*f == '\0')
                  f = ".";
                notice_cgroup (data, f);
              }
          }
      fts_close (fs);
    }
}

static gboolean
calc_percentage (CGroupMonitor *monitor,
                 Sample *sample,
                 Sample *last,
                 double sample_value,
                 double last_value)
{
  gdouble ret;
  gdouble nanosecs_usage_in_period;
  gdouble nanosecs_in_period;

  nanosecs_usage_in_period = (sample_value - last_value);
  nanosecs_in_period = (sample->timestamp - last->timestamp) * 1000.0;
  ret = 100.0 * nanosecs_usage_in_period / nanosecs_in_period;
  if (ret < 0.0)
    ret = 0.0;
  return ret;
}

static gboolean
collect_cgroup (gpointer key,
                gpointer value,
                gpointer user_data)
{
  CollectData *data = user_data;
  CGroupMonitor *monitor = data->monitor;
  const gchar *cgroup = key;
  Sample *samples = value;

  Sample *sample = NULL, *prev_sample = NULL;
  GVariantBuilder builder;

  gs_free gchar *mem_dir = g_build_filename (monitor->memory_root, cgroup, NULL);
  gs_free gchar *cpu_dir = g_strdup_printf (monitor->cpuacct_root, cgroup, NULL);

  /* TODO - don't insist that we are in both hierarchies
   */
  if (access (mem_dir, F_OK) != 0
      || access (cpu_dir, F_OK) != 0)
    {
      /* Returning TRUE will remove it from the hash table.
       */
      data->need_update_consumers_property = TRUE;
      return TRUE;
    }

  sample = &(samples[monitor->samples_next]);
  sample->timestamp = data->now;

  sample->mem_usage_in_bytes = read_double (mem_dir, "memory.usage_in_bytes");
  sample->mem_limit_in_bytes = read_double (mem_dir, "memory.limit_in_bytes");
  sample->memsw_usage_in_bytes = read_double (mem_dir, "memory.memsw.usage_in_bytes");
  sample->memsw_limit_in_bytes = read_double (mem_dir, "memory.memsw.limit_in_bytes");

  sample->cpuacct_usage = read_double (cpu_dir, "cpuacct.usage");

  if (monitor->samples_prev >= 0)
    {
      prev_sample = &(samples[monitor->samples_prev]);
      sample->cpuacct_usage_perc = calc_percentage (monitor,
                                                    sample, prev_sample,
                                                    sample->cpuacct_usage, prev_sample->cpuacct_usage);
    }
  else
    {
      sample->cpuacct_usage_perc = 0.0;
    }

  g_variant_builder_init (&builder, G_VARIANT_TYPE ("ad"));
  g_variant_builder_add (&builder, "d", sample->mem_usage_in_bytes);
  g_variant_builder_add (&builder, "d", sample->mem_limit_in_bytes);
  g_variant_builder_add (&builder, "d", sample->memsw_usage_in_bytes);
  g_variant_builder_add (&builder, "d", sample->memsw_limit_in_bytes);
  g_variant_builder_add (&builder, "d", sample->cpuacct_usage_perc);
  g_variant_builder_add (&(data->signal_builder), "{sad}", cgroup, &builder);

  /* We want to keep it.
   */
  return FALSE;
}

static void
collect (CGroupMonitor *monitor)
{
  CollectData data;
  data.monitor = monitor;
  g_variant_builder_init (&data.signal_builder, G_VARIANT_TYPE("a{sad}"));
  data.now = g_get_real_time ();
  data.need_update_consumers_property = FALSE;

  /* We are looking for files like

     /sys/fs/cgroup/memory/.../memory.usage_in_bytes
     /sys/fs/cgroup/memory/.../memory.limit_in_bytes
     /sys/fs/cgroup/cpuacct/.../cpuacct.usage
  */

  notice_cgroups_in_hierarchy (&data, monitor->memory_root);
  g_hash_table_foreach_remove (monitor->samples, collect_cgroup, &data);

  if (data.need_update_consumers_property)
    update_consumers_property (monitor);

  cockpit_multi_resource_monitor_emit_new_sample (COCKPIT_MULTI_RESOURCE_MONITOR (monitor),
                                                  data.now,
                                                  g_variant_builder_end (&data.signal_builder));

  monitor->samples_prev = monitor->samples_next;
  monitor->samples_next += 1;
  if (monitor->samples_next == SAMPLES_MAX)
    monitor->samples_next = 0;
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
handle_get_samples (CockpitMultiResourceMonitor *_monitor,
                    GDBusMethodInvocation *invocation,
                    const gchar *const *arg_consumers)
{
  CGroupMonitor *monitor = CGROUP_MONITOR (_monitor);
  GVariantBuilder builder;
  Sample *samples;
  gint i, n;

  g_variant_builder_init (&builder, G_VARIANT_TYPE ("aa(xad)"));

  for (i = 0; arg_consumers[i]; i++)
    {
      GVariantBuilder consumer_builder;
      g_variant_builder_init (&consumer_builder, G_VARIANT_TYPE ("a(xad)"));

      samples = g_hash_table_lookup (monitor->samples, arg_consumers[i]);
      if (samples)
        {
          for (n = 0; n < SAMPLES_MAX; n++)
            {
              gint pos;
              GVariantBuilder sample_builder;

              pos = monitor->samples_next + n;
              if (pos > SAMPLES_MAX)
                pos -= SAMPLES_MAX;

              if (samples[pos].timestamp == 0)
                continue;

              g_variant_builder_init (&sample_builder, G_VARIANT_TYPE ("ad"));
              g_variant_builder_add (&sample_builder, "d", samples[pos].mem_usage_in_bytes);
              g_variant_builder_add (&sample_builder, "d", samples[pos].mem_limit_in_bytes);
              g_variant_builder_add (&sample_builder, "d", samples[pos].memsw_usage_in_bytes);
              g_variant_builder_add (&sample_builder, "d", samples[pos].memsw_limit_in_bytes);
              g_variant_builder_add (&sample_builder, "d", samples[pos].cpuacct_usage_perc);

              g_variant_builder_add (&consumer_builder, "(xad)",
                                     samples[pos].timestamp,
                                     &sample_builder);
            }
        }

      g_variant_builder_add (&builder, "a(xad)", &consumer_builder);
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
