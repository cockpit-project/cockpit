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

#include "daemon.h"
#include "cgroupmonitor.h"

#include "gsystem-local-alloc.h"

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
  CockpitResourceMonitorSkeleton parent_instance;

  Daemon *daemon;
  gchar *cgroup;
  gchar *client;

  gchar *cgroup_memory;
  guint name_watch_id;

  guint samples_max;
  gint samples_prev;
  guint samples_next;

  /* Arrays of samples_max Sample instances */
  Sample *samples;
};

struct _CGroupMonitorClass
{
  CockpitResourceMonitorSkeletonClass parent_class;
};

enum
{
  PROP_0,
  PROP_DAEMON,
  PROP_CGROUP,
  PROP_CLIENT
};

static void resource_monitor_iface_init (CockpitResourceMonitorIface *iface);

G_DEFINE_TYPE_WITH_CODE (CGroupMonitor, cgroup_monitor, COCKPIT_TYPE_RESOURCE_MONITOR_SKELETON,
                         G_IMPLEMENT_INTERFACE (COCKPIT_TYPE_RESOURCE_MONITOR, resource_monitor_iface_init));

static void on_tick (Daemon     *daemon,
                     guint64     delta_usec,
                     gpointer    user_data);

/* ---------------------------------------------------------------------------------------------------- */

static void
cgroup_monitor_init (CGroupMonitor *monitor)
{
  const gchar *legends[5] = {"Memory in use", "Memory allowed", "Memory+swap in use", "Memory+swap allowed", NULL}; /* TODO: i18n */

  g_dbus_interface_skeleton_set_flags (G_DBUS_INTERFACE_SKELETON (monitor),
                                       G_DBUS_INTERFACE_SKELETON_FLAGS_HANDLE_METHOD_INVOCATIONS_IN_THREAD);

  /* Assign legends */
  cockpit_resource_monitor_set_legends (COCKPIT_RESOURCE_MONITOR (monitor), legends);

  monitor->samples_prev = -1;
  monitor->samples_max = 300;
  monitor->samples = g_new0 (Sample, monitor->samples_max);
}

static void
cgroup_monitor_finalize (GObject *object)
{
  CGroupMonitor *monitor = CGROUP_MONITOR (object);

  g_free (monitor->cgroup_memory);
  g_free (monitor->cgroup);
  g_free (monitor->client);
  g_free (monitor->samples);

  g_signal_handlers_disconnect_by_func (monitor->daemon, G_CALLBACK (on_tick), monitor);

  g_bus_unwatch_name (monitor->name_watch_id);

  G_OBJECT_CLASS (cgroup_monitor_parent_class)->finalize (object);
}

static void
cgroup_monitor_get_property (GObject *object,
                             guint prop_id,
                             GValue *value,
                             GParamSpec *pspec)
{
  CGroupMonitor *monitor = CGROUP_MONITOR (object);

  switch (prop_id)
    {
    case PROP_DAEMON:
      g_value_set_object (value, cgroup_monitor_get_daemon (monitor));
      break;

    case PROP_CGROUP:
      g_value_set_string (value, monitor->cgroup);
      break;

    case PROP_CLIENT:
      g_value_set_string (value, monitor->client);
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
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
    case PROP_DAEMON:
      g_assert (monitor->daemon == NULL);
      /* we don't take a reference to the daemon */
      monitor->daemon = g_value_get_object (value);
      break;

    case PROP_CGROUP:
      g_assert (monitor->cgroup == NULL);
      monitor->cgroup = g_value_dup_string (value);
      break;

    case PROP_CLIENT:
      g_assert (monitor->client == NULL);
      monitor->client = g_value_dup_string (value);
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void collect (CGroupMonitor *monitor);

static void
destroy_monitor (CGroupMonitor *monitor)
{
  GDBusObjectManagerServer *object_manager = daemon_get_object_manager (monitor->daemon);
  g_dbus_object_manager_server_unexport
    (object_manager,
     g_dbus_interface_skeleton_get_object_path (G_DBUS_INTERFACE_SKELETON (monitor)));
}

static void
on_tick (Daemon *daemon,
         guint64 delta_usec,
         gpointer user_data)
{
  CGroupMonitor *monitor = CGROUP_MONITOR (user_data);
  collect (monitor);
}

static void
on_client_vanished (GDBusConnection *connection,
                    const gchar *name,
                    gpointer user_data)
{
  CGroupMonitor *monitor = CGROUP_MONITOR (user_data);
  g_info ("Client %s has vanished", name);
  destroy_monitor (monitor);
}

static void
cgroup_monitor_constructed (GObject *object)
{
  CGroupMonitor *monitor = CGROUP_MONITOR (object);

  cockpit_resource_monitor_set_num_samples (COCKPIT_RESOURCE_MONITOR (monitor), monitor->samples_max);
  cockpit_resource_monitor_set_num_series (COCKPIT_RESOURCE_MONITOR (monitor), 4);

  monitor->cgroup_memory = g_strdup_printf ("/sys/fs/cgroup/memory/%s", monitor->cgroup);

  g_signal_connect (monitor->daemon, "tick", G_CALLBACK (on_tick), monitor);
  collect (monitor);

  g_info ("New monitor for %s", monitor->client);
  monitor->name_watch_id = g_bus_watch_name (G_BUS_TYPE_SYSTEM,
                                             monitor->client,
                                             0,
                                             NULL,
                                             on_client_vanished,
                                             monitor,
                                             NULL);

  if (G_OBJECT_CLASS (cgroup_monitor_parent_class)->constructed != NULL)
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
  gobject_class->get_property = cgroup_monitor_get_property;

  /**
   * CGroupMonitor:daemon:
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

  /**
   * CGroupMonitor:cgroup:
   */
  g_object_class_install_property (gobject_class,
                                   PROP_CGROUP,
                                   g_param_spec_string ("cgroup",
                                                        NULL,
                                                        NULL,
                                                        NULL,
                                                        G_PARAM_READABLE |
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY |
                                                        G_PARAM_STATIC_STRINGS));

  /**
   * CGroupMonitor:client:
   */
  g_object_class_install_property (gobject_class,
                                   PROP_CLIENT,
                                   g_param_spec_string ("client",
                                                        NULL,
                                                        NULL,
                                                        NULL,
                                                        G_PARAM_READABLE |
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY |
                                                        G_PARAM_STATIC_STRINGS));
}

/**
 * cgroup_monitor_new:
 * @cgroup: The name of the cgroup to monitor.
 * @daemon: A #Daemon.
 *
 * Creates a new #CGroupMonitor instance.
 *
 * Returns: A new #CGroupMonitor. Free with g_object_unref().
 */
CockpitResourceMonitor *
cgroup_monitor_new (const gchar *cgroup,
                    const gchar *client,
                    Daemon *daemon)
{
  g_return_val_if_fail (IS_DAEMON (daemon), NULL);
  return COCKPIT_RESOURCE_MONITOR (g_object_new (TYPE_CGROUP_MONITOR,
                                                 "cgroup", cgroup,
                                                 "client", client,
                                                 "daemon", daemon,
                                                 NULL));
}

/**
 * cgroup_monitor_get_daemon:
 * @monitor: A #CGroupMonitor.
 *
 * Gets the daemon used by @monitor.
 *
 * Returns: A #Daemon. Do not free, the object is owned by @monitor.
 */
Daemon *
cgroup_monitor_get_daemon (CGroupMonitor *monitor)
{
  g_return_val_if_fail (IS_CGROUP_MONITOR (monitor), NULL);
  return monitor->daemon;
}

/* ---------------------------------------------------------------------------------------------------- */

static double
read_double (const gchar *prefix,
             const gchar *suffix)
{
  gs_free gchar *path = NULL;
  gs_free gchar *file_contents = NULL;
  gsize len;
  GError *error = NULL;

  path = g_strdup_printf ("%s/%s", prefix, suffix);
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

static void
collect (CGroupMonitor *monitor)
{
  gint64 now;
  GVariantBuilder builder;
  Sample *sample = NULL;

  now = g_get_real_time ();

  sample = &(monitor->samples[monitor->samples_next]);
  sample->timestamp = now;

  sample->mem_usage_in_bytes = read_double (monitor->cgroup_memory, "memory.usage_in_bytes");
  sample->mem_limit_in_bytes = read_double (monitor->cgroup_memory, "memory.limit_in_bytes");
  sample->memsw_usage_in_bytes = read_double (monitor->cgroup_memory, "memory.memsw.usage_in_bytes");
  sample->memsw_limit_in_bytes = read_double (monitor->cgroup_memory, "memory.memsw.limit_in_bytes");

  g_variant_builder_init (&builder, G_VARIANT_TYPE ("ad"));
  g_variant_builder_add (&builder, "d", sample->mem_usage_in_bytes);
  g_variant_builder_add (&builder, "d", sample->mem_limit_in_bytes);
  g_variant_builder_add (&builder, "d", sample->memsw_usage_in_bytes);
  g_variant_builder_add (&builder, "d", sample->memsw_limit_in_bytes);
  cockpit_resource_monitor_emit_new_sample (COCKPIT_RESOURCE_MONITOR (monitor),
                                            now, g_variant_builder_end (&builder));

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
  CGroupMonitor *monitor = CGROUP_MONITOR (_monitor);
  GVariantBuilder builder;
  gint n;

  g_variant_builder_init (&builder, G_VARIANT_TYPE ("a(xat)"));
  for (n = 0; n < monitor->samples_max; n++)
    {
      gint pos;
      GVariantBuilder sample_builder;

      pos = monitor->samples_next + n;
      if (pos > monitor->samples_max)
        pos -= monitor->samples_max;

      if (monitor->samples[pos].timestamp == 0)
        continue;

      g_variant_builder_init (&sample_builder, G_VARIANT_TYPE ("ad"));
      g_variant_builder_add (&builder, "d", monitor->samples[pos].mem_usage_in_bytes);
      g_variant_builder_add (&builder, "d", monitor->samples[pos].mem_limit_in_bytes);
      g_variant_builder_add (&builder, "d", monitor->samples[pos].memsw_usage_in_bytes);
      g_variant_builder_add (&builder, "d", monitor->samples[pos].memsw_limit_in_bytes);

      g_variant_builder_add (&builder, "(x@ad)",
                             monitor->samples[pos].timestamp,
                             g_variant_builder_end (&sample_builder));
    }
  cockpit_resource_monitor_complete_get_samples (_monitor, invocation,
                                                 g_variant_builder_end (&builder));

  return TRUE;
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
handle_destroy (CockpitResourceMonitor *_monitor,
                GDBusMethodInvocation *invocation)
{
  CGroupMonitor *monitor = CGROUP_MONITOR(_monitor);
  destroy_monitor(monitor);
  cockpit_resource_monitor_complete_destroy (_monitor, invocation);
  return TRUE;
}

/* ---------------------------------------------------------------------------------------------------- */

static void
resource_monitor_iface_init (CockpitResourceMonitorIface *iface)
{
  iface->handle_get_samples = handle_get_samples;
  iface->handle_destroy = handle_destroy;
}
