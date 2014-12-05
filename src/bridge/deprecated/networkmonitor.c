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

#include "networkmonitor.h"

/**
 * SECTION:networkmonitor
 * @title: NetworkMonitor
 * @short_description: Implementation of #CockpitResourceMonitor for network usage
 *
 * This type provides an implementation of the #CockpitResourceMonitor interface for network usage.
 */

typedef struct
{
  gint64 timestamp;
  gint64 bytes_rx;
  gint64 bytes_tx;
  gdouble bytes_rx_per_sec;
  gdouble bytes_tx_per_sec;
} Sample;

typedef struct _NetworkMonitor NetworkMonitor;
typedef struct _NetworkMonitorClass NetworkMonitorClass;

/**
 * NetworkMonitor:
 *
 * The #NetworkMonitor structure contains only private data and should
 * only be accessed using the provided API.
 */
struct _NetworkMonitor
{
  CockpitResourceMonitorSkeleton parent_instance;

  guint user_hz;

  guint samples_max;
  gint samples_prev;
  guint samples_next;
  guint timeout;

  /* Arrays of samples_max Sample instances */
  Sample *samples;
};

struct _NetworkMonitorClass
{
  CockpitResourceMonitorSkeletonClass parent_class;
};

static void resource_monitor_iface_init (CockpitResourceMonitorIface *iface);

G_DEFINE_TYPE_WITH_CODE (NetworkMonitor, network_monitor, COCKPIT_TYPE_RESOURCE_MONITOR_SKELETON,
                         G_IMPLEMENT_INTERFACE (COCKPIT_TYPE_RESOURCE_MONITOR, resource_monitor_iface_init));

/* ---------------------------------------------------------------------------------------------------- */

static void
network_monitor_init (NetworkMonitor *monitor)
{
  const gchar *legends[3] = {"Incoming Traffic", "Outgoing Traffic", NULL}; /* TODO: i18n */

  /* Assign legends */
  cockpit_resource_monitor_set_legends (COCKPIT_RESOURCE_MONITOR (monitor), legends);

  monitor->samples_prev = -1;
  monitor->samples_max = 300;
  monitor->samples = g_new0 (Sample, monitor->samples_max);
}

static void
network_monitor_finalize (GObject *object)
{
  NetworkMonitor *monitor = NETWORK_MONITOR (object);

  g_free (monitor->samples);
  g_source_remove (monitor->timeout);

  G_OBJECT_CLASS (network_monitor_parent_class)->finalize (object);
}

static void collect (NetworkMonitor *monitor);

static gboolean
on_tick (gpointer user_data)
{
  NetworkMonitor *monitor = NETWORK_MONITOR (user_data);
  collect (monitor);
  return TRUE;
}

static void
network_monitor_constructed (GObject *object)
{
  NetworkMonitor *monitor = NETWORK_MONITOR (object);

  cockpit_resource_monitor_set_num_samples (COCKPIT_RESOURCE_MONITOR (monitor), monitor->samples_max);
  cockpit_resource_monitor_set_num_series (COCKPIT_RESOURCE_MONITOR (monitor), 2);

  monitor->timeout = g_timeout_add_seconds (1, on_tick, monitor);
  collect (monitor);

  G_OBJECT_CLASS (network_monitor_parent_class)->constructed (object);
}

static void
network_monitor_class_init (NetworkMonitorClass *klass)
{
  GObjectClass *gobject_class;

  gobject_class = G_OBJECT_CLASS (klass);
  gobject_class->finalize     = network_monitor_finalize;
  gobject_class->constructed  = network_monitor_constructed;
}

/**
 * network_monitor_new:
 *
 * Creates a new #NetworkMonitor instance.
 *
 * Returns: A new #NetworkMonitor. Free with g_object_unref().
 */
CockpitResourceMonitor *
network_monitor_new (void)
{
  return g_object_new (TYPE_NETWORK_MONITOR, NULL);
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
calc_bandwidth (NetworkMonitor *monitor,
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
collect (NetworkMonitor *monitor)
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
  if (!g_file_get_contents ("/proc/net/dev",
                            &contents,
                            &len,
                            &error))
    {
      g_warning ("Error loading contents /proc/net/dev: %s (%s, %d)",
                 error->message, g_quark_to_string (error->domain), error->code);
      g_error_free (error);
      goto out;
    }

  now = g_get_real_time ();

  sample = &(monitor->samples[monitor->samples_next]);
  sample->timestamp = now;
  sample->bytes_rx = 0;
  sample->bytes_tx = 0;

  if (monitor->samples_prev != -1)
    last = &(monitor->samples[monitor->samples_prev]);

  lines = g_strsplit (contents, "\n", -1);
  for (n = 0; lines != NULL && lines[n] != NULL; n++)
    {
      const gchar *line = lines[n];
      gchar iface_name[64]; /* guaranteed to be max 16 chars */
      guint64 bytes_rx, packets_rx, errors_rx, dropped_rx, fifo_rx, frame_rx, compressed_rx, multicast_rx;
      guint64 bytes_tx, packets_tx, errors_tx, dropped_tx, fifo_tx, frame_tx, compressed_tx, multicast_tx;
      gint num_parsed;

      /* Format is
       *
       * Inter-|   Receive                                                |  Transmit
       * face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
       * lo: 2776770   11307    0    0    0     0          0         0  2776770   11307    0    0    0     0       0          0
       * eth0: 1215645    2751    0    0    0     0          0         0  1782404    4324    0    0    0   427       0          0
       * ppp0: 1622270    5552    1    0    0     0          0         0   354130    5669    0    0    0     0       0          0
       * tap0:    7714      81    0    0    0     0          0         0     7714      81    0    0    0     0       0          0
       */

      if (n < 2 || strlen (line) == 0)
        continue;

      num_parsed = sscanf (line,
                           "%s %" G_GUINT64_FORMAT " %" G_GUINT64_FORMAT " %" G_GUINT64_FORMAT " %" G_GUINT64_FORMAT
                           " %" G_GUINT64_FORMAT " %" G_GUINT64_FORMAT " %" G_GUINT64_FORMAT " %" G_GUINT64_FORMAT
                           " %" G_GUINT64_FORMAT " %" G_GUINT64_FORMAT " %" G_GUINT64_FORMAT " %" G_GUINT64_FORMAT
                           " %" G_GUINT64_FORMAT " %" G_GUINT64_FORMAT " %" G_GUINT64_FORMAT " %" G_GUINT64_FORMAT,
                           iface_name,
                           &bytes_rx, &packets_rx, &errors_rx, &dropped_rx,
                           &fifo_rx, &frame_rx, &compressed_rx, &multicast_rx,
                           &bytes_tx, &packets_tx, &errors_tx, &dropped_tx,
                           &fifo_tx, &frame_tx, &compressed_tx, &multicast_tx);
      if (num_parsed != 17)
        {
          g_warning ("Error parsing line %d of file /proc/net/dev (num_parsed=%d): `%s'", n, num_parsed, line);
          continue;
        }

      /* skip loopback */
      if (g_strcmp0 (iface_name, "lo:") == 0)
        continue;

      sample->bytes_rx += bytes_rx;
      sample->bytes_tx += bytes_tx;
    }

  if (last != NULL)
    {
      sample->bytes_rx_per_sec = calc_bandwidth (monitor, sample, last, sample->bytes_rx, last->bytes_rx);
      sample->bytes_tx_per_sec = calc_bandwidth (monitor, sample, last, sample->bytes_tx, last->bytes_tx);
    }

out:
  g_strfreev (lines);
  g_free (contents);
  if (sample != NULL)
    {
      g_variant_builder_init (&builder, G_VARIANT_TYPE ("ad"));
      g_variant_builder_add (&builder, "d", sample->bytes_rx_per_sec);
      g_variant_builder_add (&builder, "d", sample->bytes_tx_per_sec);
      cockpit_resource_monitor_emit_new_sample (COCKPIT_RESOURCE_MONITOR(monitor), now,
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
  NetworkMonitor *monitor = NETWORK_MONITOR (_monitor);
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

      g_variant_builder_init (&sample_builder, G_VARIANT_TYPE("ad"));
      g_variant_builder_add (&sample_builder, "d", monitor->samples[pos].bytes_rx_per_sec);
      g_variant_builder_add (&sample_builder, "d", monitor->samples[pos].bytes_tx_per_sec);

      g_variant_builder_add (&builder, "(x@ad)",
                             monitor->samples[pos].timestamp,
                             g_variant_builder_end (&sample_builder));
    }
  cockpit_resource_monitor_complete_get_samples (_monitor,
                                                 invocation,
                                                 g_variant_builder_end (&builder));

  return TRUE;
}

/* ---------------------------------------------------------------------------------------------------- */

static void
resource_monitor_iface_init (CockpitResourceMonitorIface *iface)
{
  iface->handle_get_samples = handle_get_samples;
}
