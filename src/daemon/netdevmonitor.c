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
#include "netdevmonitor.h"

#define SAMPLES_MAX 300

/**
 * SECTION:netdevmonitor
 * @title: NetdevMonitor
 * @short_description: Implementation of #CockpitResourceMonitor for NETDEV usage
 *
 * This type provides an implementation of the #CockpitResourceMonitor interface for NETDEV usage.
 */

typedef struct
{
  gint64 bytes_rx;
  gint64 bytes_tx;
  gdouble bytes_rx_per_sec;
  gdouble bytes_tx_per_sec;
} Sample;

typedef struct {
  gint64 last_timestamp;        // the time when this consumer disappeared, 0 when it still exists
  Sample samples[SAMPLES_MAX];
} Consumer;

typedef struct _NetdevMonitorClass NetdevMonitorClass;

/**
 * NetdevMonitor:
 *
 * The #NetdevMonitor structure contains only private data and should
 * only be accessed using the provided API.
 */

struct _NetdevMonitor
{
  CockpitMultiResourceMonitorSkeleton parent_instance;

  gint samples_prev;
  guint samples_next;

  /* interface -> Consumer
   */
  GHashTable *consumers;

  /* SAMPLES_MAX timestamps for the samples
   */
  gint64 *timestamps;
};

struct _NetdevMonitorClass
{
  CockpitMultiResourceMonitorSkeletonClass parent_class;
};

enum
{
  PROP_0,
  PROP_TICK_SOURCE
};

static void resource_monitor_iface_init (CockpitMultiResourceMonitorIface *iface);

G_DEFINE_TYPE_WITH_CODE (NetdevMonitor, netdev_monitor, COCKPIT_TYPE_MULTI_RESOURCE_MONITOR_SKELETON,
                         G_IMPLEMENT_INTERFACE (COCKPIT_TYPE_MULTI_RESOURCE_MONITOR, resource_monitor_iface_init));

static void on_tick (GObject    *unused_source,
                     guint64     delta_usec,
                     gpointer    user_data);

/* ---------------------------------------------------------------------------------------------------- */

static void
netdev_monitor_init (NetdevMonitor *monitor)
{
  monitor->samples_prev = -1;
  monitor->consumers = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, g_free);
  monitor->timestamps = g_new0 (gint64, SAMPLES_MAX);
}

static void
netdev_monitor_finalize (GObject *object)
{
  NetdevMonitor *monitor = NETDEV_MONITOR (object);

  g_hash_table_destroy (monitor->consumers);
  g_free (monitor->timestamps);

  G_OBJECT_CLASS (netdev_monitor_parent_class)->finalize (object);
}

static void
netdev_monitor_set_property (GObject *object,
                             guint prop_id,
                             const GValue *value,
                             GParamSpec *pspec)
{
  NetdevMonitor *monitor = NETDEV_MONITOR (object);

  switch (prop_id)
    {
    case PROP_TICK_SOURCE:
      g_signal_connect_object (g_value_get_object (value),
                               "tick", G_CALLBACK (on_tick),
                               monitor, 0);
      break;
    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void collect (NetdevMonitor *monitor);

static void
on_tick (GObject *unused_source,
         guint64 delta_usec,
         gpointer user_data)
{
  NetdevMonitor *monitor = NETDEV_MONITOR (user_data);
  collect (monitor);
}

static void
netdev_monitor_constructed (GObject *object)
{
  NetdevMonitor *monitor = NETDEV_MONITOR (object);

  const gchar *legends[] =
    { "Incoming Traffic",
      "Outgoing Traffic",
      NULL
    };

  cockpit_multi_resource_monitor_set_num_samples (COCKPIT_MULTI_RESOURCE_MONITOR (monitor), SAMPLES_MAX);
  cockpit_multi_resource_monitor_set_legends (COCKPIT_MULTI_RESOURCE_MONITOR (monitor), legends);
  cockpit_multi_resource_monitor_set_num_series (COCKPIT_MULTI_RESOURCE_MONITOR (monitor), 2);

  collect (monitor);

  G_OBJECT_CLASS (netdev_monitor_parent_class)->constructed (object);
}

static void
netdev_monitor_class_init (NetdevMonitorClass *klass)
{
  GObjectClass *gobject_class;

  gobject_class = G_OBJECT_CLASS (klass);
  gobject_class->finalize = netdev_monitor_finalize;
  gobject_class->constructed = netdev_monitor_constructed;
  gobject_class->set_property = netdev_monitor_set_property;

  /**
   * NetdevMonitor:tick-source:
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
}

/**
 * netdev_monitor_new:
 * @root: The name of the root of the netdev hierachy to monitor.
 * @tick_source: An object which emits a signal like a tick source
 *
 * Creates a new #NetdevMonitor instance.
 *
 * Returns: A new #NetdevMonitor. Free with g_object_unref().
 */
CockpitMultiResourceMonitor *
netdev_monitor_new (GObject *tick_source)
{
  return COCKPIT_MULTI_RESOURCE_MONITOR (g_object_new (TYPE_NETDEV_MONITOR,
                                                       "tick-source", tick_source,
                                                       NULL));
}

/* ---------------------------------------------------------------------------------------------------- */

static void
update_consumers_property (NetdevMonitor *monitor)
{
  guint n_netdevs =  g_hash_table_size (monitor->consumers);
  const gchar **prop_value = g_new0 (const gchar *, n_netdevs+1);
  GList *netdevs = g_hash_table_get_keys (monitor->consumers);

  GList *l;
  int i;
  for (l = netdevs, i = 0; l != NULL && i < n_netdevs; l = l->next, i++)
    prop_value[i] = l->data;

  g_debug ("updating to %d consumers", i);
  cockpit_multi_resource_monitor_set_consumers (COCKPIT_MULTI_RESOURCE_MONITOR (monitor), prop_value);
  g_list_free (netdevs);
  g_free (prop_value);
}

typedef struct {
  NetdevMonitor *monitor;
  gboolean need_update_consumers_property;
} CollectData;

static Consumer *
get_consumer (CollectData *data,
              const gchar *id)
{
  Consumer *consumer;

  consumer = g_hash_table_lookup (data->monitor->consumers, id);
  if (consumer == NULL)
    {
      consumer = g_new0 (Consumer, 1);
      g_hash_table_insert (data->monitor->consumers, g_strdup (id), consumer);
      data->need_update_consumers_property = TRUE;
    }
  else
    consumer->last_timestamp = 0;

  return consumer;
}

static void
bury_consumer (gpointer key,
               gpointer value,
               gpointer user_data)
{
  CollectData *data = user_data;
  NetdevMonitor *monitor = data->monitor;
  Consumer *consumer = value;
  Sample *sample = &(consumer->samples[monitor->samples_next]);

  sample->bytes_rx = 0;
  sample->bytes_tx = 0;
  sample->bytes_rx_per_sec = 0;
  sample->bytes_tx_per_sec = 0;
  consumer->last_timestamp = monitor->timestamps[monitor->samples_next];
}

static gboolean
expire_consumer (gpointer key,
                 gpointer value,
                 gpointer user_data)
{
  CollectData *data = user_data;
  NetdevMonitor *monitor = data->monitor;
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
build_sample_variant (NetdevMonitor *monitor,
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
      g_variant_builder_add (&inner_builder, "d", sample->bytes_rx_per_sec);
      g_variant_builder_add (&inner_builder, "d", sample->bytes_tx_per_sec);
      g_variant_builder_add (&builder, "{sad}", key, &inner_builder);
    }

  return g_variant_builder_end (&builder);
}

static gboolean
calc_bandwidth (guint64 sample_timestamp,
                guint64 last_timestamp,
                gint64 sample_value,
                gint64 last_value)
{
  gdouble ret;
  gdouble bytes_in_period;
  gdouble period;

  bytes_in_period = sample_value - last_value;
  period = ((gdouble) (sample_timestamp - last_timestamp)) / ((gdouble) G_USEC_PER_SEC);
  ret = bytes_in_period / period;
  return ret;
}

static void
read_proc_net_dev (CollectData *data)
{
  NetdevMonitor *monitor = data->monitor;
  gchar *contents = NULL;
  gsize len;
  GError *error;
  gchar **lines = NULL;
  guint n;

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

  lines = g_strsplit (contents, "\n", -1);
  for (n = 0; lines != NULL && lines[n] != NULL; n++)
    {
      const gchar *line = lines[n];
      gchar iface_name[64]; /* guaranteed to be max 16 chars */
      guint64 bytes_rx, packets_rx, errors_rx, dropped_rx, fifo_rx, frame_rx, compressed_rx, multicast_rx;
      guint64 bytes_tx, packets_tx, errors_tx, dropped_tx, fifo_tx, frame_tx, compressed_tx, multicast_tx;
      gint num_parsed, len;
      Consumer *consumer;
      Sample *sample;

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
                           "%64s %" G_GUINT64_FORMAT " %" G_GUINT64_FORMAT " %" G_GUINT64_FORMAT " %" G_GUINT64_FORMAT
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

      len = strlen (iface_name);
      if (len > 0 && iface_name[len-1] == ':')
        iface_name[len-1] = 0;

      consumer = get_consumer (data, iface_name);

      sample = &(consumer->samples[monitor->samples_next]);
      sample->bytes_rx = bytes_rx;
      sample->bytes_tx = bytes_tx;

      if (monitor->samples_prev >= 0)
        {
          Sample *last = &(consumer->samples[monitor->samples_prev]);
          guint sample_timestamp = monitor->timestamps[monitor->samples_next];
          guint last_timestamp = monitor->timestamps[monitor->samples_prev];
          sample->bytes_rx_per_sec = calc_bandwidth (sample_timestamp, last_timestamp,
                                                     sample->bytes_rx, last->bytes_rx);
          sample->bytes_tx_per_sec = calc_bandwidth (sample_timestamp, last_timestamp,
                                                     sample->bytes_tx, last->bytes_tx);
        }
      else
        {
          sample->bytes_rx_per_sec = 0.0;
          sample->bytes_tx_per_sec = 0.0;
        }
    }

 out:
  g_strfreev (lines);
  g_free (contents);
}

static void
collect (NetdevMonitor *monitor)
{
  guint64 now = g_get_real_time ();
  CollectData data;
  data.monitor = monitor;
  data.need_update_consumers_property = FALSE;

  monitor->timestamps[monitor->samples_next] = now;

  g_hash_table_foreach (monitor->consumers, bury_consumer, &data);

  read_proc_net_dev (&data);

  cockpit_multi_resource_monitor_emit_new_sample (COCKPIT_MULTI_RESOURCE_MONITOR (monitor),
                                                  now,
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
  NetdevMonitor *monitor = NETDEV_MONITOR (_monitor);
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
