/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013 Red Hat, Inc.
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

#include "cpumonitor.h"

/**
 * SECTION:cpumonitor
 * @title: CpuMonitor
 * @short_description: Implementation of #CockpitResourceMonitor for CPU usage
 *
 * This type provides an implementation of the #CockpitResourceMonitor interface for CPU usage.
 */

typedef struct
{
  gint64 timestamp;
  gint64 nice_value;
  gint64 user_value;
  gint64 system_value;
  gint64 iowait_value;
  gdouble nice_percentage;
  gdouble user_percentage;
  gdouble system_percentage;
  gdouble iowait_percentage;
} Sample;

typedef struct _CpuMonitor CpuMonitor;
typedef struct _CpuMonitorClass CpuMonitorClass;

/**
 * CpuMonitor:
 *
 * The #CpuMonitor structure contains only private data and should
 * only be accessed using the provided API.
 */
struct _CpuMonitor
{
  CockpitResourceMonitorSkeleton parent_instance;

  guint user_hz;

  guint samples_max;
  gint samples_prev;
  guint samples_next;
  guint timeout;

  /* Arrays of samples_max Sample instances (nice, user, system, iowait) */
  Sample *samples;
};

struct _CpuMonitorClass
{
  CockpitResourceMonitorSkeletonClass parent_class;
};

static void resource_monitor_iface_init (CockpitResourceMonitorIface *iface);

G_DEFINE_TYPE_WITH_CODE (CpuMonitor, cpu_monitor, COCKPIT_TYPE_RESOURCE_MONITOR_SKELETON,
                         G_IMPLEMENT_INTERFACE (COCKPIT_TYPE_RESOURCE_MONITOR, resource_monitor_iface_init));

/* ---------------------------------------------------------------------------------------------------- */

static void
cpu_monitor_init (CpuMonitor *monitor)
{
  const gchar *legends[5] = {"Nice", "User", "Kernel", "I/O Wait", NULL}; /* TODO: i18n */

  monitor->user_hz = sysconf (_SC_CLK_TCK);
  if (monitor->user_hz == -1 || monitor->user_hz == 0)
    {
      monitor->user_hz = 100;
      g_warning ("sysconf (_SC_CLK_TCK) returned %d - forcing user_hz to 100", monitor->user_hz);
    }

  /* Assign legends */
  cockpit_resource_monitor_set_legends (COCKPIT_RESOURCE_MONITOR (monitor), legends);

  monitor->samples_prev = -1;
  monitor->samples_max = 300;
  monitor->samples = g_new0 (Sample, monitor->samples_max);
}

static void
cpu_monitor_finalize (GObject *object)
{
  CpuMonitor *monitor = CPU_MONITOR (object);

  g_free (monitor->samples);
  g_source_remove (monitor->timeout);

  G_OBJECT_CLASS (cpu_monitor_parent_class)->finalize (object);
}

static void collect (CpuMonitor *monitor);

static gboolean
on_tick (gpointer user_data)
{
  CpuMonitor *monitor = CPU_MONITOR (user_data);
  collect (monitor);
  return TRUE;
}

static void
cpu_monitor_constructed (GObject *object)
{
  CpuMonitor *monitor = CPU_MONITOR (object);

  cockpit_resource_monitor_set_num_samples (COCKPIT_RESOURCE_MONITOR (monitor), monitor->samples_max);
  cockpit_resource_monitor_set_num_series (COCKPIT_RESOURCE_MONITOR (monitor), 4);

  monitor->timeout = g_timeout_add_seconds (1, on_tick, monitor);
  collect (monitor);

  G_OBJECT_CLASS (cpu_monitor_parent_class)->constructed (object);
}

static void
cpu_monitor_class_init (CpuMonitorClass *klass)
{
  GObjectClass *gobject_class;

  gobject_class = G_OBJECT_CLASS (klass);
  gobject_class->finalize = cpu_monitor_finalize;
  gobject_class->constructed = cpu_monitor_constructed;
}

/**
 * cpu_monitor_new:
 * @daemon: A #Daemon.
 *
 * Creates a new #CpuMonitor instance.
 *
 * Returns: A new #CpuMonitor. Free with g_object_unref().
 */
CockpitResourceMonitor *
cpu_monitor_new (void)
{
  return g_object_new (TYPE_CPU_MONITOR, NULL);
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
calc_percentage (CpuMonitor *monitor,
                 Sample *sample,
                 Sample *last,
                 gint64 sample_value,
                 gint64 last_value)
{
  gdouble ret;
  gdouble secs_usage_in_period;
  gdouble period;

  secs_usage_in_period = (((gdouble) sample_value) - ((gdouble) last_value)) / monitor->user_hz;
  period = ((gdouble) (sample->timestamp - last->timestamp)) / ((gdouble) G_USEC_PER_SEC);
  ret = 100.0 * secs_usage_in_period / period;
  if (ret < 0.0)
    ret = 0.0;
  if (ret > 100.0)
    ret = 1.0;
  return ret;
}

/* TODO: this should be optimized so we don't allocate memory and call open()/close() all the time */
static void
collect (CpuMonitor *monitor)
{
  gchar *contents = NULL;
  gsize len;
  GError *error;
  gchar **lines = NULL;
  guint n;
  gint64 now;
  GVariantBuilder builder;
  Sample *sample = NULL;

  error = NULL;
  if (!g_file_get_contents ("/proc/stat",
                            &contents,
                            &len,
                            &error))
    {
      g_warning ("Error loading contents /proc/stat: %s (%s, %d)",
                 error->message, g_quark_to_string (error->domain), error->code);
      g_error_free (error);
      goto out;
    }

  now = g_get_real_time ();

  /* see 'man proc' for the format of /proc/stat */

  lines = g_strsplit (contents, "\n", -1);
  for (n = 0; lines != NULL && lines[n] != NULL; n++)
    {
      const gchar *line = lines[n];
      guint64 user;
      guint64 nice;
      guint64 system;
      guint64 idle;
      guint64 iowait;
      Sample *last;

      if (!(g_str_has_prefix (line, "cpu ")))
        continue;

      last = NULL;
      if (monitor->samples_prev != -1)
        last = &(monitor->samples[monitor->samples_prev]);
      sample = &(monitor->samples[monitor->samples_next]);

#define FMT64 "%" G_GUINT64_FORMAT " "
      if (sscanf (line + sizeof ("cpu ") - 1, FMT64 FMT64 FMT64 FMT64 FMT64,
                  &user,
                  &nice,
                  &system,
                  &idle,
                  &iowait) != 5)
        {
          g_warning ("Error parsing line %d of /proc/stat with content `%s'", n, line);
          continue;
        }

      sample->timestamp    = now;
      sample->nice_value   = nice;
      sample->user_value   = user;
      sample->system_value = system;
      sample->iowait_value = iowait;

      if (last != NULL)
        {
          sample->nice_percentage   = calc_percentage (monitor, sample, last, sample->nice_value,   last->nice_value);
          sample->user_percentage   = calc_percentage (monitor, sample, last, sample->user_value,   last->user_value);
          sample->system_percentage = calc_percentage (monitor, sample, last, sample->system_value, last->system_value);
          sample->iowait_percentage = calc_percentage (monitor, sample, last, sample->iowait_value, last->iowait_value);
        }

      break;
    }

out:
  g_strfreev (lines);
  g_free (contents);

  if (sample != NULL)
    {
      g_variant_builder_init (&builder, G_VARIANT_TYPE ("ad"));
      g_variant_builder_add (&builder, "d", sample->nice_percentage);
      g_variant_builder_add (&builder, "d", sample->user_percentage);
      g_variant_builder_add (&builder, "d", sample->system_percentage);
      g_variant_builder_add (&builder, "d", sample->iowait_percentage);
      cockpit_resource_monitor_emit_new_sample (COCKPIT_RESOURCE_MONITOR (monitor),
                                                now, g_variant_builder_end (&builder));
    }

  monitor->samples_prev = monitor->samples_next;
  monitor->samples_next += 1;
  if (monitor->samples_next == monitor->samples_max)
    monitor->samples_next = 0;
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
handle_get_samples (CockpitResourceMonitor *_monitor,
                    GDBusMethodInvocation *invocation,
                    GVariant *arg_options)
{
  CpuMonitor *monitor = CPU_MONITOR (_monitor);
  GVariantBuilder builder;
  gint n;

  g_variant_builder_init (&builder, G_VARIANT_TYPE ("a(xad)"));
  for (n = 0; n < monitor->samples_max; n++)
    {
      gint pos;
      GVariantBuilder sample_builder;

      pos = monitor->samples_next + n;
      if (pos >= monitor->samples_max)
        pos -= monitor->samples_max;

      if (monitor->samples[pos].timestamp == 0)
        continue;

      g_variant_builder_init (&sample_builder, G_VARIANT_TYPE ("ad"));
      g_variant_builder_add (&sample_builder, "d", monitor->samples[pos].nice_percentage);
      g_variant_builder_add (&sample_builder, "d", monitor->samples[pos].user_percentage);
      g_variant_builder_add (&sample_builder, "d", monitor->samples[pos].system_percentage);
      g_variant_builder_add (&sample_builder, "d", monitor->samples[pos].iowait_percentage);

      g_variant_builder_add (&builder, "(x@ad)",
                             monitor->samples[pos].timestamp,
                             g_variant_builder_end (&sample_builder));
    }
  cockpit_resource_monitor_complete_get_samples (_monitor, invocation,
                                                 g_variant_builder_end (&builder));

  return TRUE;
}

/* ---------------------------------------------------------------------------------------------------- */

static void
resource_monitor_iface_init (CockpitResourceMonitorIface *iface)
{
  iface->handle_get_samples = handle_get_samples;
}
