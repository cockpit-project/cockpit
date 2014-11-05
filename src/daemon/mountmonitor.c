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
#include <ctype.h>
#include <sys/statvfs.h>

#include "daemon.h"
#include "mountmonitor.h"

#define SAMPLES_MAX 300

/**
 * SECTION:mountmonitor
 * @title: MountMonitor
 * @short_description: Implementation of #CockpitResourceMonitor for MOUNT usage
 *
 * This type provides an implementation of the #CockpitResourceMonitor interface for MOUNT usage.
 */

typedef struct
{
  gint64 bytes_used;
  gint64 bytes_total;
} Sample;

typedef struct {
  gint64 last_timestamp;        // the time when this consumer disappeared, 0 when it still exists
  Sample samples[SAMPLES_MAX];
} Consumer;

typedef struct _MountMonitorClass MountMonitorClass;

/**
 * MountMonitor:
 *
 * The #MountMonitor structure contains only private data and should
 * only be accessed using the provided API.
 */

struct _MountMonitor
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

struct _MountMonitorClass
{
  CockpitMultiResourceMonitorSkeletonClass parent_class;
};

enum
{
  PROP_0,
  PROP_TICK_SOURCE
};

static void resource_monitor_iface_init (CockpitMultiResourceMonitorIface *iface);

G_DEFINE_TYPE_WITH_CODE (MountMonitor, mount_monitor, COCKPIT_TYPE_MULTI_RESOURCE_MONITOR_SKELETON,
                         G_IMPLEMENT_INTERFACE (COCKPIT_TYPE_MULTI_RESOURCE_MONITOR, resource_monitor_iface_init));

static void on_tick (GObject    *unused_source,
                     guint64     delta_usec,
                     gpointer    user_data);

/* ---------------------------------------------------------------------------------------------------- */

static void
mount_monitor_init (MountMonitor *monitor)
{
  monitor->samples_prev = -1;
  monitor->consumers = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, g_free);
  monitor->timestamps = g_new0 (gint64, SAMPLES_MAX);
}

static void
mount_monitor_finalize (GObject *object)
{
  MountMonitor *monitor = MOUNT_MONITOR (object);

  g_hash_table_destroy (monitor->consumers);
  g_free (monitor->timestamps);

  G_OBJECT_CLASS (mount_monitor_parent_class)->finalize (object);
}

static void
mount_monitor_set_property (GObject *object,
                             guint prop_id,
                             const GValue *value,
                             GParamSpec *pspec)
{
  MountMonitor *monitor = MOUNT_MONITOR (object);

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

static void collect (MountMonitor *monitor);

static void
on_tick (GObject *unused_source,
         guint64 delta_usec,
         gpointer user_data)
{
  MountMonitor *monitor = MOUNT_MONITOR (user_data);
  collect (monitor);
}

static void
mount_monitor_constructed (GObject *object)
{
  MountMonitor *monitor = MOUNT_MONITOR (object);

  const gchar *legends[] =
    { "",
      "",
      NULL
    };

  cockpit_multi_resource_monitor_set_num_samples (COCKPIT_MULTI_RESOURCE_MONITOR (monitor), SAMPLES_MAX);
  cockpit_multi_resource_monitor_set_legends (COCKPIT_MULTI_RESOURCE_MONITOR (monitor), legends);
  cockpit_multi_resource_monitor_set_num_series (COCKPIT_MULTI_RESOURCE_MONITOR (monitor), 2);

  collect (monitor);

  G_OBJECT_CLASS (mount_monitor_parent_class)->constructed (object);
}

static void
mount_monitor_class_init (MountMonitorClass *klass)
{
  GObjectClass *gobject_class;

  gobject_class = G_OBJECT_CLASS (klass);
  gobject_class->finalize = mount_monitor_finalize;
  gobject_class->constructed = mount_monitor_constructed;
  gobject_class->set_property = mount_monitor_set_property;

  /**
   * MountMonitor:tick-source:
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
 * mount_monitor_new:
 * @root: The name of the root of the mount hierachy to monitor.
 * @tick_source: An object which emits a signal like a tick source
 *
 * Creates a new #MountMonitor instance.
 *
 * Returns: A new #MountMonitor. Free with g_object_unref().
 */
CockpitMultiResourceMonitor *
mount_monitor_new (GObject *tick_source)
{
  return COCKPIT_MULTI_RESOURCE_MONITOR (g_object_new (TYPE_MOUNT_MONITOR,
                                                       "tick-source", tick_source,
                                                       NULL));
}

/* ---------------------------------------------------------------------------------------------------- */

static void
update_consumers_property (MountMonitor *monitor)
{
  guint n_mounts =  g_hash_table_size (monitor->consumers);
  const gchar **prop_value = g_new0 (const gchar *, n_mounts+1);
  GList *mounts = g_hash_table_get_keys (monitor->consumers);

  GList *l;
  int i;
  for (l = mounts, i = 0; l != NULL && i < n_mounts; l = l->next, i++)
    prop_value[i] = l->data;

  g_debug ("updating to %d consumers", i);
  cockpit_multi_resource_monitor_set_consumers (COCKPIT_MULTI_RESOURCE_MONITOR (monitor), prop_value);
  g_list_free (mounts);
  g_free (prop_value);
}

typedef struct {
  MountMonitor *monitor;
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
  MountMonitor *monitor = data->monitor;
  Consumer *consumer = value;
  Sample *sample = &(consumer->samples[monitor->samples_next]);

  sample->bytes_used = 0;
  sample->bytes_total = 0;
  consumer->last_timestamp = monitor->timestamps[monitor->samples_next];
}

static gboolean
expire_consumer (gpointer key,
                 gpointer value,
                 gpointer user_data)
{
  CollectData *data = user_data;
  MountMonitor *monitor = data->monitor;
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
build_sample_variant (MountMonitor *monitor,
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
      g_variant_builder_add (&inner_builder, "d", (double) sample->bytes_used);
      g_variant_builder_add (&inner_builder, "d", (double) sample->bytes_total);
      g_variant_builder_add (&builder, "{sad}", key, &inner_builder);
    }

  return g_variant_builder_end (&builder);
}

static void
read_proc_mounts (CollectData *data)
{
  MountMonitor *monitor = data->monitor;
  gchar *contents = NULL;
  gsize len;
  GError *error;
  gchar **lines = NULL;
  guint n;

  error = NULL;
  if (!g_file_get_contents ("/proc/mounts",
                            &contents,
                            &len,
                            &error))
    {
      g_warning ("Error loading contents /proc/mounts: %s (%s, %d)",
                 error->message, g_quark_to_string (error->domain), error->code);
      g_error_free (error);
      goto out;
    }

  lines = g_strsplit (contents, "\n", -1);
  for (n = 0; lines != NULL && lines[n] != NULL; n++)
    {
      gchar *line = lines[n];
      gchar *esc_dir, *dir;
      struct statvfs buf;
      Consumer *consumer;
      Sample *sample;

      if (strlen (line) == 0)
        continue;

      /* Only look at real devices
       */
      if (line[0] != '/')
        continue;

      while (*line && !isspace (*line))
        line++;
      while (*line && isspace (*line))
        line++;
      esc_dir = line;
      while (*line && !isspace (*line))
        line++;
      *line = '\0';

      dir = g_strcompress (esc_dir);

      if (statvfs (dir, &buf) >= 0)
        {
          consumer = get_consumer (data, dir);

          sample = &(consumer->samples[monitor->samples_next]);
          sample->bytes_total = buf.f_frsize*buf.f_blocks;
          sample->bytes_used = sample->bytes_total - buf.f_frsize*buf.f_bfree;
        }

      g_free (dir);
    }

 out:
  g_strfreev (lines);
  g_free (contents);
}

static void
collect (MountMonitor *monitor)
{
  guint64 now = g_get_real_time ();
  CollectData data;
  data.monitor = monitor;
  data.need_update_consumers_property = FALSE;

  monitor->timestamps[monitor->samples_next] = now;

  g_hash_table_foreach (monitor->consumers, bury_consumer, &data);

  read_proc_mounts (&data);

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
  MountMonitor *monitor = MOUNT_MONITOR (_monitor);
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
