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
#include <string.h>
#include <unistd.h>

#include "daemon.h"
#include "diskiomonitor.h"

/**
 * SECTION:diskiomonitor
 * @title: DiskIOMonitor
 * @short_description: Implementation of #CockpitResourceMonitor for disk I/O usage
 *
 * This type provides an implementation of the #CockpitResourceMonitor interface for disk I/O usage.
 */

typedef struct
{
  gint64 timestamp;
  gint64 bytes_read;
  gint64 bytes_written;
  gint64 num_ops;
  gdouble bytes_read_per_sec;
  gdouble bytes_written_per_sec;
  gdouble io_operations_per_sec;
} Sample;

typedef struct _DiskIOMonitorClass DiskIOMonitorClass;

/**
 * DiskIOMonitor:
 *
 * The #DiskIOMonitor structure contains only private data and should
 * only be accessed using the provided API.
 */
struct _DiskIOMonitor
{
  CockpitResourceMonitorSkeleton parent_instance;

  Daemon *daemon;

  guint user_hz;

  guint samples_max;
  gint samples_prev;
  guint samples_next;

  /* Arrays of samples_max Sample instances */
  Sample *samples;
};

struct _DiskIOMonitorClass
{
  CockpitResourceMonitorSkeletonClass parent_class;
};

enum
{
  PROP_0,
  PROP_DAEMON
};

static void resource_monitor_iface_init (CockpitResourceMonitorIface *iface);

G_DEFINE_TYPE_WITH_CODE (DiskIOMonitor, disk_io_monitor, COCKPIT_TYPE_RESOURCE_MONITOR_SKELETON,
                         G_IMPLEMENT_INTERFACE (COCKPIT_TYPE_RESOURCE_MONITOR, resource_monitor_iface_init));

static void on_tick (Daemon  *daemon,
                     guint64     delta_usec,
                     gpointer    user_data);

/* ---------------------------------------------------------------------------------------------------- */

static void
disk_io_monitor_init (DiskIOMonitor *monitor)
{
  const gchar *legends[4] = {"Disk Reads", "Disk Writes", "I/O Operations", NULL}; /* TODO: i18n */

  /* Assign legends */
  cockpit_resource_monitor_set_legends (COCKPIT_RESOURCE_MONITOR (monitor), legends);

  monitor->samples_prev = -1;
  monitor->samples_max = 300;
  monitor->samples = g_new0 (Sample, monitor->samples_max);
}

static void
disk_io_monitor_finalize (GObject *object)
{
  DiskIOMonitor *monitor = DISK_IO_MONITOR (object);

  g_free (monitor->samples);

  g_signal_handlers_disconnect_by_func (monitor->daemon, G_CALLBACK (on_tick), monitor);

  G_OBJECT_CLASS (disk_io_monitor_parent_class)->finalize (object);
}

static void
disk_io_monitor_get_property (GObject *object,
                              guint prop_id,
                              GValue *value,
                              GParamSpec *pspec)
{
  DiskIOMonitor *monitor = DISK_IO_MONITOR (object);

  switch (prop_id)
    {
    case PROP_DAEMON:
      g_value_set_object (value, disk_io_monitor_get_daemon (monitor));
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
disk_io_monitor_set_property (GObject *object,
                              guint prop_id,
                              const GValue *value,
                              GParamSpec *pspec)
{
  DiskIOMonitor *monitor = DISK_IO_MONITOR (object);

  switch (prop_id)
    {
    case PROP_DAEMON:
      g_assert (monitor->daemon == NULL);
      /* we don't take a reference to the daemon */
      monitor->daemon = g_value_get_object (value);
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void collect (DiskIOMonitor *monitor);

static void
on_tick (Daemon *daemon,
         guint64 delta_usec,
         gpointer user_data)
{
  DiskIOMonitor *monitor = DISK_IO_MONITOR (user_data);
  collect (monitor);
}

static void
disk_io_monitor_constructed (GObject *object)
{
  DiskIOMonitor *monitor = DISK_IO_MONITOR (object);

  cockpit_resource_monitor_set_num_samples (COCKPIT_RESOURCE_MONITOR (monitor), monitor->samples_max);
  cockpit_resource_monitor_set_num_series (COCKPIT_RESOURCE_MONITOR (monitor), 3);

  g_signal_connect (monitor->daemon, "tick", G_CALLBACK (on_tick), monitor);
  collect (monitor);

  if (G_OBJECT_CLASS (disk_io_monitor_parent_class)->constructed != NULL)
    G_OBJECT_CLASS (disk_io_monitor_parent_class)->constructed (object);
}

static void
disk_io_monitor_class_init (DiskIOMonitorClass *klass)
{
  GObjectClass *gobject_class;

  gobject_class = G_OBJECT_CLASS (klass);
  gobject_class->finalize     = disk_io_monitor_finalize;
  gobject_class->constructed  = disk_io_monitor_constructed;
  gobject_class->set_property = disk_io_monitor_set_property;
  gobject_class->get_property = disk_io_monitor_get_property;

  /**
   * DiskIOMonitor:daemon:
   *
   * The #Daemon for the object.
   */
  g_object_class_install_property (gobject_class,
                                   PROP_DAEMON,
                                   g_param_spec_object ("daemon",
                                                        NULL,
                                                        NULL,
                                                        TYPE_DAEMON,
                                                        G_PARAM_READABLE |
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY |
                                                        G_PARAM_STATIC_STRINGS));
}

/**
 * disk_io_monitor_new:
 * @daemon: A #Daemon.
 *
 * Creates a new #DiskIOMonitor instance.
 *
 * Returns: A new #DiskIOMonitor. Free with g_object_unref().
 */
CockpitResourceMonitor *
disk_io_monitor_new (Daemon *daemon)
{
  g_return_val_if_fail (IS_DAEMON (daemon), NULL);
  return COCKPIT_RESOURCE_MONITOR (g_object_new (TYPE_DISK_IO_MONITOR,
                                                 "daemon", daemon,
                                                 NULL));
}

/**
 * disk_io_monitor_get_daemon:
 * @monitor: A #DiskIOMonitor.
 *
 * Gets the daemon used by @monitor.
 *
 * Returns: A #Daemon. Do not free, the object is owned by @monitor.
 */
Daemon *
disk_io_monitor_get_daemon (DiskIOMonitor *monitor)
{
  g_return_val_if_fail (IS_DISK_IO_MONITOR (monitor), NULL);
  return monitor->daemon;
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
calc_bandwidth (DiskIOMonitor *monitor,
                Sample *sample,
                Sample *last,
                gint64 sample_value,
                gint64 last_value)
{
  gdouble ret;
  gdouble bytes_in_period;
  gdouble period;

  bytes_in_period = sample_value - last_value;
  period = ((gdouble) (sample->timestamp - last->timestamp)) / ((gdouble) G_USEC_PER_SEC);
  ret = bytes_in_period / period;
  return ret;
}

/* TODO: this should be optimized so we don't allocate network and call open()/close() all the time */
static void
collect (DiskIOMonitor *monitor)
{
  gchar *contents = NULL;
  gsize len;
  GError *error;
  gchar **lines = NULL;
  guint n;
  gint64 now;
  Sample *sample = NULL;
  Sample *last = NULL;
  GVariantBuilder builder;

  error = NULL;
  if (!g_file_get_contents ("/proc/diskstats",
                            &contents,
                            &len,
                            &error))
    {
      g_warning ("Error loading contents /proc/vmstat: %s (%s, %d)",
                 error->message, g_quark_to_string (error->domain), error->code);
      g_error_free (error);
      goto out;
    }

  now = g_get_real_time ();

  sample = &(monitor->samples[monitor->samples_next]);
  sample->timestamp = now;
  sample->bytes_read = 0;
  sample->bytes_written = 0;
  sample->num_ops = 0;

  if (monitor->samples_prev != -1)
    last = &(monitor->samples[monitor->samples_prev]);

  lines = g_strsplit (contents, "\n", -1);
  for (n = 0; lines != NULL && lines[n] != NULL; n++)
    {
      const gchar *line = lines[n];
      guint num_parsed;
      gint dev_major, dev_minor;
      gchar dev_name[64]; /* TODO: big enough? */
      guint64 num_reads,  num_reads_merged,  num_sectors_read,    num_msec_reading;
      guint64 num_writes, num_writes_merged, num_sectors_written, num_msec_writing;
      guint64 num_io_in_progress, num_msec_doing_io, weighted_num_msec_doing_io;

      if (strlen (line) == 0)
        continue;

      /* From http://www.kernel.org/doc/Documentation/iostats.txt
       *
       * Field  1 -- # of reads completed
       *     This is the total number of reads completed successfully.
       * Field  2 -- # of reads merged, field 6 -- # of writes merged
       *     Reads and writes which are adjacent to each other may be merged for
       *     efficiency.  Thus two 4K reads may become one 8K read before it is
       *     ultimately handed to the disk, and so it will be counted (and queued)
       *     as only one I/O.  This field lets you know how often this was done.
       * Field  3 -- # of sectors read
       *     This is the total number of sectors read successfully.
       * Field  4 -- # of milliseconds spent reading
       *     This is the total number of milliseconds spent by all reads (as
       *     measured from __make_request() to end_that_request_last()).
       * Field  5 -- # of writes completed
       *     This is the total number of writes completed successfully.
       * Field  7 -- # of sectors written
       *     This is the total number of sectors written successfully.
       * Field  8 -- # of milliseconds spent writing
       *     This is the total number of milliseconds spent by all writes (as
       *     measured from __make_request() to end_that_request_last()).
       * Field  9 -- # of I/Os currently in progress
       *     The only field that should go to zero. Incremented as requests are
       *     given to appropriate struct request_queue and decremented as they finish.
       * Field 10 -- # of milliseconds spent doing I/Os
       *     This field increases so long as field 9 is nonzero.
       * Field 11 -- weighted # of milliseconds spent doing I/Os
       *     This field is incremented at each I/O start, I/O completion, I/O
       *     merge, or read of these stats by the number of I/Os in progress
       *     (field 9) times the number of milliseconds spent doing I/O since the
       *     last update of this field.  This can provide an easy measure of both
       *     I/O completion time and the backlog that may be accumulating.
       */

      num_parsed = sscanf (line,
                           "%d %d %64s"
                           " %" G_GUINT64_FORMAT " %" G_GUINT64_FORMAT " %" G_GUINT64_FORMAT " %" G_GUINT64_FORMAT
                           " %" G_GUINT64_FORMAT " %" G_GUINT64_FORMAT " %" G_GUINT64_FORMAT " %" G_GUINT64_FORMAT
                           " %" G_GUINT64_FORMAT " %" G_GUINT64_FORMAT " %" G_GUINT64_FORMAT,
                           &dev_major, &dev_minor, dev_name,
                           &num_reads,  &num_reads_merged, &num_sectors_read, &num_msec_reading,
                           &num_writes, &num_writes_merged, &num_sectors_written, &num_msec_writing,
                           &num_io_in_progress, &num_msec_doing_io, &weighted_num_msec_doing_io);
      if (num_parsed != 14)
        {
          g_warning ("Error parsing line %d of file /proc/diskstats (num_parsed=%d): `%s'", n, num_parsed, line);
          continue;
        }

      /* skip mapped devices and partitions... otherwise we'll count their
       * I/O more than once
       *
       * TODO: the way we identify dm devices and partitions is not
       * very elegant... we should consult sysfs via libgudev1
       * instead.
       */
      if (dev_major == 253)
        continue;

      if (g_str_has_prefix (dev_name, "sd") && g_ascii_isdigit (dev_name[strlen (dev_name) - 1]))
        continue;

      sample->bytes_read += num_sectors_read * 512;
      sample->bytes_written += num_sectors_written * 512;
      sample->num_ops += num_reads_merged + num_writes_merged;
    }

  if (last != NULL)
    {
      sample->bytes_read_per_sec = calc_bandwidth (monitor, sample, last, sample->bytes_read, last->bytes_read);
      sample->bytes_written_per_sec = calc_bandwidth (monitor, sample, last, sample->bytes_written, last->bytes_written);
      sample->io_operations_per_sec = calc_bandwidth (monitor, sample, last, sample->num_ops, last->num_ops);
    }

out:
  g_strfreev (lines);
  g_free (contents);
  if (sample != NULL)
    {
      g_variant_builder_init (&builder, G_VARIANT_TYPE ("ad"));
      g_variant_builder_add (&builder, "d", sample->bytes_read_per_sec);
      g_variant_builder_add (&builder, "d", sample->bytes_written_per_sec);
      g_variant_builder_add (&builder, "d", sample->io_operations_per_sec);
      cockpit_resource_monitor_emit_new_sample (COCKPIT_RESOURCE_MONITOR(monitor),
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
  DiskIOMonitor *monitor = DISK_IO_MONITOR (_monitor);
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
      g_variant_builder_add (&sample_builder, "d", monitor->samples[pos].bytes_read_per_sec);
      g_variant_builder_add (&sample_builder, "d", monitor->samples[pos].bytes_written_per_sec);
      g_variant_builder_add (&sample_builder, "d", monitor->samples[pos].io_operations_per_sec);

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
