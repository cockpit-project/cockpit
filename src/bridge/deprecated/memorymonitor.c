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

#include "memorymonitor.h"
#include "internal-generated.h"

/**
 * SECTION:memorymonitor
 * @title: MemoryMonitor
 * @short_description: Implementation of #CockpitResourceMonitor for memory usage
 *
 * This type provides an implementation of the #CockpitResourceMonitor interface for memory usage.
 */

typedef struct
{
  gint64 timestamp;
  gint64 free;
  gint64 used;
  gint64 cached;
  gint64 swap_used;
} Sample;

typedef struct _MemoryMonitor MemoryMonitor;
typedef struct _MemoryMonitorClass MemoryMonitorClass;

/**
 * MemoryMonitor:
 *
 * The #MemoryMonitor structure contains only private data and should
 * only be accessed using the provided API.
 */
struct _MemoryMonitor
{
  CockpitResourceMonitorSkeleton parent_instance;

  guint samples_max;
  gint samples_prev;
  guint samples_next;
  guint timeout;

  /* Arrays of samples_max Sample instances */
  Sample *samples;
};

struct _MemoryMonitorClass
{
  CockpitResourceMonitorSkeletonClass parent_class;
};

enum
{
  PROP_0,
  PROP_DAEMON
};

static void resource_monitor_iface_init (CockpitResourceMonitorIface *iface);

G_DEFINE_TYPE_WITH_CODE (MemoryMonitor, memory_monitor, COCKPIT_TYPE_RESOURCE_MONITOR_SKELETON,
                         G_IMPLEMENT_INTERFACE (COCKPIT_TYPE_RESOURCE_MONITOR, resource_monitor_iface_init));

/* ---------------------------------------------------------------------------------------------------- */

static void
memory_monitor_init (MemoryMonitor *monitor)
{
  const gchar *legends[5] = {"Free", "Used", "Cached", "Swap Used", NULL}; /* TODO: i18n */

  /* Assign legends */
  cockpit_resource_monitor_set_legends (COCKPIT_RESOURCE_MONITOR (monitor), legends);

  monitor->samples_prev = -1;
  monitor->samples_max = 300;
  monitor->samples = g_new0 (Sample, monitor->samples_max);
}

static void
memory_monitor_finalize (GObject *object)
{
  MemoryMonitor *monitor = MEMORY_MONITOR (object);

  g_free (monitor->samples);
  g_source_remove (monitor->timeout);

  G_OBJECT_CLASS (memory_monitor_parent_class)->finalize (object);
}

static void collect (MemoryMonitor *monitor);

static gboolean
on_tick (gpointer user_data)
{
  MemoryMonitor *monitor = MEMORY_MONITOR (user_data);
  collect (monitor);
  return TRUE;
}

static void
memory_monitor_constructed (GObject *object)
{
  MemoryMonitor *monitor = MEMORY_MONITOR (object);

  cockpit_resource_monitor_set_num_samples (COCKPIT_RESOURCE_MONITOR (monitor), monitor->samples_max);
  cockpit_resource_monitor_set_num_series (COCKPIT_RESOURCE_MONITOR (monitor), 4);

  monitor->timeout = g_timeout_add_seconds (1, on_tick, monitor);
  collect (monitor);

  G_OBJECT_CLASS (memory_monitor_parent_class)->constructed (object);
}

static void
memory_monitor_class_init (MemoryMonitorClass *klass)
{
  GObjectClass *gobject_class;

  gobject_class = G_OBJECT_CLASS (klass);
  gobject_class->finalize     = memory_monitor_finalize;
  gobject_class->constructed  = memory_monitor_constructed;
}

/**
 * memory_monitor_new:
 * @daemon: A #Daemon.
 *
 * Creates a new #MemoryMonitor instance.
 *
 * Returns: A new #MemoryMonitor. Free with g_object_unref().
 */
CockpitResourceMonitor *
memory_monitor_new (void)
{
  return g_object_new (TYPE_MEMORY_MONITOR, NULL);
}

/* ---------------------------------------------------------------------------------------------------- */

/* TODO: this should be optimized so we don't allocate memory and call open()/close() all the time */
static void
collect (MemoryMonitor *monitor)
{
  gchar *contents = NULL;
  gsize len;
  GError *error;
  gchar **lines = NULL;
  guint n;
  gint64 now;
  Sample *sample = NULL;
  GVariantBuilder builder;
  guint64 free_kb = 0;
  guint64 total_kb = 0;
  guint64 buffers_kb = 0;
  guint64 cached_kb = 0;
  guint64 swap_total_kb = 0;
  guint64 swap_free_kb = 0;

  error = NULL;
  if (!g_file_get_contents ("/proc/meminfo",
                            &contents,
                            &len,
                            &error))
    {
      g_warning ("Error loading contents /proc/meminfo: %s (%s, %d)",
                 error->message, g_quark_to_string (error->domain), error->code);
      g_error_free (error);
      goto out;
    }

  now = g_get_real_time ();

  sample = &(monitor->samples[monitor->samples_next]);

  /* see 'man proc' for the format of /proc/stat */

  lines = g_strsplit (contents, "\n", -1);
  for (n = 0; lines != NULL && lines[n] != NULL; n++)
    {
      const gchar *line = lines[n];
      if (g_str_has_prefix (line, "MemTotal:"))
        g_warn_if_fail (sscanf (line + sizeof ("MemTotal:") - 1, "%" G_GUINT64_FORMAT, &total_kb) == 1);
      else if (g_str_has_prefix (line, "MemFree:"))
        g_warn_if_fail (sscanf (line + sizeof ("MemFree:") - 1, "%" G_GUINT64_FORMAT, &free_kb) == 1);
      else if (g_str_has_prefix (line, "SwapTotal:"))
        g_warn_if_fail (sscanf (line + sizeof ("SwapTotal:") - 1, "%" G_GUINT64_FORMAT, &swap_total_kb) == 1);
      else if (g_str_has_prefix (line, "SwapFree:"))
        g_warn_if_fail (sscanf (line + sizeof ("SwapFree:") - 1, "%" G_GUINT64_FORMAT, &swap_free_kb) == 1);
      else if (g_str_has_prefix (line, "Buffers:"))
        g_warn_if_fail (sscanf (line + sizeof ("Buffers:") - 1, "%" G_GUINT64_FORMAT, &buffers_kb) == 1);
      else if (g_str_has_prefix (line, "Cached:"))
        g_warn_if_fail (sscanf (line + sizeof ("Cached:") - 1, "%" G_GUINT64_FORMAT, &cached_kb) == 1);
    }

  sample->timestamp = now;
  sample->free      = free_kb * 1024;
  sample->used      = (total_kb - free_kb) * 1024;
  sample->cached    = (buffers_kb + cached_kb) * 1024;
  sample->swap_used = (swap_total_kb - swap_free_kb) * 1024;

out:
  g_strfreev (lines);
  g_free (contents);
  if (sample != NULL)
    {
      g_variant_builder_init (&builder, G_VARIANT_TYPE ("ad"));
      g_variant_builder_add (&builder, "d", (gdouble)sample->free);
      g_variant_builder_add (&builder, "d", (gdouble)sample->used);
      g_variant_builder_add (&builder, "d", (gdouble)sample->cached);
      g_variant_builder_add (&builder, "d", (gdouble)sample->swap_used);
      cockpit_resource_monitor_emit_new_sample (COCKPIT_RESOURCE_MONITOR (monitor), now,
                                                g_variant_builder_end (&builder));
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
  MemoryMonitor *monitor = MEMORY_MONITOR (_monitor);
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
      g_variant_builder_add (&sample_builder, "d", (gdouble)monitor->samples[pos].free);
      g_variant_builder_add (&sample_builder, "d", (gdouble)monitor->samples[pos].used);
      g_variant_builder_add (&sample_builder, "d", (gdouble)monitor->samples[pos].cached);
      g_variant_builder_add (&sample_builder, "d", (gdouble)monitor->samples[pos].swap_used);

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
