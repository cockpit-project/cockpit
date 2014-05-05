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

#include <string.h>

#include <gsystem-local-alloc.h>

#include "daemon.h"
#include "auth.h"
#include "manager.h"
#include "machines.h"
#include "cpumonitor.h"
#include "memorymonitor.h"
#include "networkmonitor.h"
#include "diskiomonitor.h"
#include "cgroupmonitor.h"
#include "storageprovider.h"
#include "storagemanager.h"
#include "realms.h"
#include "services.h"
#include "journal.h"
#include "accounts.h"

#include <cockpit/cockpit.h>

/**
 * SECTION:daemon
 * @title: Daemon
 * @short_description: Main daemon object
 *
 * Object holding all global state.
 */

typedef struct _DaemonClass DaemonClass;

/**
 * Daemon:
 *
 * The #Daemon structure contains only private data and should only be
 * accessed using the provided API.
 */
struct _Daemon
{
  GObject parent_instance;
  GDBusProxy *system_bus_proxy;
  GDBusConnection *connection;
  GDBusObjectManagerServer *object_manager;

  Machines *machines;
  StorageProvider *storage_provider;

  guint tick_timeout_id;
  gint64 last_tick;
};

struct _DaemonClass
{
  GObjectClass parent_class;

  void (*tick) (Daemon *daemon,
                guint64 delta_usec);
};

enum
{
  PROP_0,
  PROP_CONNECTION,
  PROP_OBJECT_MANAGER,
};

enum
{
  TICK_SIGNAL,
  LAST_SIGNAL
};

static guint signals[LAST_SIGNAL] = { 0 };

G_DEFINE_TYPE(Daemon, daemon, G_TYPE_OBJECT);

static void
daemon_finalize (GObject *object)
{
  Daemon *daemon = DAEMON (object);

  g_object_unref (daemon->storage_provider);
  g_object_unref (daemon->object_manager);
  g_object_unref (daemon->connection);
  g_object_unref (daemon->system_bus_proxy);

  if (daemon->tick_timeout_id > 0)
    g_source_remove (daemon->tick_timeout_id);

  if (G_OBJECT_CLASS (daemon_parent_class)->finalize != NULL)
    G_OBJECT_CLASS (daemon_parent_class)->finalize (object);
}

static void
daemon_get_property (GObject *object,
                     guint prop_id,
                     GValue *value,
                     GParamSpec *pspec)
{
  Daemon *daemon = DAEMON (object);

  switch (prop_id)
    {
    case PROP_CONNECTION:
      g_value_set_object (value, daemon_get_connection (daemon));
      break;

    case PROP_OBJECT_MANAGER:
      g_value_set_object (value, daemon_get_object_manager (daemon));
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
daemon_set_property (GObject *object,
                     guint prop_id,
                     const GValue *value,
                     GParamSpec *pspec)
{
  Daemon *daemon = DAEMON (object);

  switch (prop_id)
    {
    case PROP_CONNECTION:
      g_assert (daemon->connection == NULL);
      daemon->connection = g_value_dup_object (value);
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
daemon_init (Daemon *daemon)
{
}

static gboolean
on_timeout (gpointer user_data)
{
  Daemon *daemon = DAEMON (user_data);
  guint64 delta_usec = 0;
  gint64 now;

  now = g_get_monotonic_time ();
  if (daemon->last_tick != 0)
    delta_usec = now - daemon->last_tick;
  daemon->last_tick = now;

  g_signal_emit (daemon, signals[TICK_SIGNAL], 0, delta_usec);

  return TRUE; /* keep source around */
}

static Daemon *_daemon_instance;

static void
daemon_constructed (GObject *_object)
{
  Daemon *daemon = DAEMON (_object);
  CockpitManager *manager;
  CockpitMachines *machines;
  CockpitResourceMonitor *monitor;
  CockpitMultiResourceMonitor *multi_monitor;
  CockpitRealms *realms;
  CockpitServices *services;
  CockpitJournal *journal;
  CockpitAccounts *accounts;
  CockpitStorageManager *storage_manager;
  CockpitObjectSkeleton *object = NULL;

  g_assert (_daemon_instance == NULL);
  _daemon_instance = daemon;

  daemon->system_bus_proxy = g_dbus_proxy_new_sync (daemon->connection, G_DBUS_PROXY_FLAGS_DO_NOT_LOAD_PROPERTIES,
                                                    NULL, "org.freedesktop.DBus",
                                                    "/org/freedesktop/DBus",
                                                    "org.freedesktop.DBus", NULL, NULL);
  g_assert (daemon->system_bus_proxy != NULL);

  daemon->object_manager = g_dbus_object_manager_server_new ("/com/redhat/Cockpit");

  /* /com/redhat/Cockpit/Machines */
  machines = machines_new (daemon_get_object_manager (daemon));
  daemon->machines = MACHINES (machines);
  object = cockpit_object_skeleton_new ("/com/redhat/Cockpit/Machines");
  cockpit_object_skeleton_set_machines (object, machines);
  g_dbus_object_manager_server_export (daemon->object_manager, G_DBUS_OBJECT_SKELETON (object));
  g_object_unref (machines);
  g_object_unref (object);

  /* /com/redhat/Cockpit/Manager */
  manager = manager_new (daemon);
  object = cockpit_object_skeleton_new ("/com/redhat/Cockpit/Manager");
  cockpit_object_skeleton_set_manager (object, manager);
  g_dbus_object_manager_server_export (daemon->object_manager, G_DBUS_OBJECT_SKELETON (object));
  g_object_unref (manager);
  g_object_unref (object);

  /* /com/redhat/Cockpit/CpuMonitor */
  monitor = cpu_monitor_new (daemon);
  object = cockpit_object_skeleton_new ("/com/redhat/Cockpit/CpuMonitor");
  cockpit_object_skeleton_set_resource_monitor (object, monitor);
  g_dbus_object_manager_server_export (daemon->object_manager, G_DBUS_OBJECT_SKELETON (object));
  g_object_unref (monitor);
  g_object_unref (object);

  /* /com/redhat/Cockpit/MemoryMonitor */
  monitor = memory_monitor_new (daemon);
  object = cockpit_object_skeleton_new ("/com/redhat/Cockpit/MemoryMonitor");
  cockpit_object_skeleton_set_resource_monitor (object, monitor);
  g_dbus_object_manager_server_export (daemon->object_manager, G_DBUS_OBJECT_SKELETON (object));
  g_object_unref (monitor);
  g_object_unref (object);

  /* /com/redhat/Cockpit/NetworkMonitor */
  monitor = network_monitor_new (daemon);
  object = cockpit_object_skeleton_new ("/com/redhat/Cockpit/NetworkMonitor");
  cockpit_object_skeleton_set_resource_monitor (object, monitor);
  g_dbus_object_manager_server_export (daemon->object_manager, G_DBUS_OBJECT_SKELETON (object));
  g_object_unref (monitor);
  g_object_unref (object);

  /* /com/redhat/Cockpit/DiskIOMonitor */
  monitor = disk_io_monitor_new (daemon);
  object = cockpit_object_skeleton_new ("/com/redhat/Cockpit/DiskIOMonitor");
  cockpit_object_skeleton_set_resource_monitor (object, monitor);
  g_dbus_object_manager_server_export (daemon->object_manager, G_DBUS_OBJECT_SKELETON (object));
  g_object_unref (monitor);
  g_object_unref (object);

  /* /com/redhat/Cockpit/LxcMonitor */
  multi_monitor = cgroup_monitor_new (G_OBJECT (daemon));
  object = cockpit_object_skeleton_new ("/com/redhat/Cockpit/LxcMonitor");
  cockpit_object_skeleton_set_multi_resource_monitor (object, multi_monitor);
  g_dbus_object_manager_server_export (daemon->object_manager, G_DBUS_OBJECT_SKELETON (object));
  g_object_unref (multi_monitor);
  g_object_unref (object);

  /* /com/redhat/Cockpit/Realms */
  realms = realms_new (daemon);
  object = cockpit_object_skeleton_new ("/com/redhat/Cockpit/Realms");
  cockpit_object_skeleton_set_realms (object, realms);
  g_dbus_object_manager_server_export (daemon->object_manager, G_DBUS_OBJECT_SKELETON (object));
  g_object_unref (realms);
  g_object_unref (object);

  /* /com/redhat/Cockpit/Services */
  services = services_new (daemon);
  object = cockpit_object_skeleton_new ("/com/redhat/Cockpit/Services");
  cockpit_object_skeleton_set_services (object, services);
  g_dbus_object_manager_server_export (daemon->object_manager, G_DBUS_OBJECT_SKELETON (object));
  g_object_unref (services);
  g_object_unref (object);

  /* /com/redhat/Cockpit/Journal */
  journal = journal_new ();
  object = cockpit_object_skeleton_new ("/com/redhat/Cockpit/Journal");
  cockpit_object_skeleton_set_journal (object, journal);
  g_dbus_object_manager_server_export (daemon->object_manager, G_DBUS_OBJECT_SKELETON (object));
  g_object_unref (journal);

  /* /com/redhat/Cockpit/Accounts */
  accounts = accounts_new ();
  object = cockpit_object_skeleton_new ("/com/redhat/Cockpit/Accounts");
  cockpit_object_skeleton_set_accounts (object, accounts);
  g_dbus_object_manager_server_export (daemon->object_manager, G_DBUS_OBJECT_SKELETON (object));
  g_object_unref (accounts);

  g_object_unref (object);

  /* /com/redhat/Cockpit/Storage/Manager */
  storage_manager = storage_manager_new (daemon);
  object = cockpit_object_skeleton_new ("/com/redhat/Cockpit/Storage/Manager");
  cockpit_object_skeleton_set_storage_manager (object, storage_manager);
  g_dbus_object_manager_server_export (daemon->object_manager, G_DBUS_OBJECT_SKELETON (object));
  g_object_unref (storage_manager);
  g_object_unref (object);

  daemon->storage_provider = storage_provider_new (daemon);

  /* Export the ObjectManager */
  g_dbus_object_manager_server_set_connection (daemon->object_manager, daemon->connection);

  daemon->tick_timeout_id = g_timeout_add_seconds (1, on_timeout, daemon);

  if (G_OBJECT_CLASS (daemon_parent_class)->constructed != NULL)
    G_OBJECT_CLASS (daemon_parent_class)->constructed (_object);
}

static void
daemon_class_init (DaemonClass *klass)
{
  GObjectClass *gobject_class;

  gobject_class = G_OBJECT_CLASS (klass);
  gobject_class->finalize     = daemon_finalize;
  gobject_class->constructed  = daemon_constructed;
  gobject_class->set_property = daemon_set_property;
  gobject_class->get_property = daemon_get_property;

  /**
   * Daemon:connection:
   *
   * The #GDBusConnection the daemon is for.
   */
  g_object_class_install_property (gobject_class,
                                   PROP_CONNECTION,
                                   g_param_spec_object ("connection",
                                                        "Connection",
                                                        "The D-Bus connection the daemon is for",
                                                        G_TYPE_DBUS_CONNECTION,
                                                        G_PARAM_READABLE |
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY |
                                                        G_PARAM_STATIC_STRINGS));

  /**
   * Daemon:object-manager:
   *
   * The #GDBusObjectManager used by the daemon
   */
  g_object_class_install_property (gobject_class,
                                   PROP_OBJECT_MANAGER,
                                   g_param_spec_object ("object-manager",
                                                        "Object Manager",
                                                        "The D-Bus Object Manager server used by the daemon",
                                                        G_TYPE_DBUS_OBJECT_MANAGER_SERVER,
                                                        G_PARAM_READABLE |
                                                        G_PARAM_STATIC_STRINGS));

  /**
   * Daemon::tick
   * @daemon: A #Daemon.
   * @delta_usec: The number of micro-seconds since this was last emitted or 0 if the first time it's emitted.
   *
   * Emitted every second - subsystems should use this signal instead
   * of setting up their own timeout.
   *
   * This signal is emitted in the
   * <link linkend="g-main-context-push-thread-default">thread-default main loop</link>
   * that @daemon was created in.
   */
  signals[TICK_SIGNAL] = g_signal_new ("tick",
                                       G_OBJECT_CLASS_TYPE (klass),
                                       G_SIGNAL_RUN_LAST,
                                       G_STRUCT_OFFSET (DaemonClass, tick),
                                       NULL,
                                       NULL,
                                       g_cclosure_marshal_generic,
                                       G_TYPE_NONE,
                                       1,
                                       G_TYPE_UINT64);
}

/**
 * daemon_new:
 * @connection: A #GDBusConnection.
 *
 * Create a new daemon object for exporting objects on @connection.
 *
 * Returns: A #Daemon object. Free with g_object_unref().
 */
Daemon *
daemon_new (GDBusConnection *connection)
{
  g_return_val_if_fail (G_IS_DBUS_CONNECTION (connection), NULL);
  return DAEMON (g_object_new (TYPE_DAEMON,
                                    "connection", connection,
                                    NULL));
}

/**
 * daemon_get:
 *
 * Returns: (transfer none): Th singleton #Daemon instance
 */
Daemon *
daemon_get (void)
{
  g_assert (_daemon_instance);
  return _daemon_instance;
}

/**
 * daemon_get_connection:
 * @daemon: A #Daemon.
 *
 * Gets the D-Bus connection used by @daemon.
 *
 * Returns: A #GDBusConnection. Do not free, the object is owned by @daemon.
 */
GDBusConnection *
daemon_get_connection (Daemon *daemon)
{
  g_return_val_if_fail (IS_DAEMON (daemon), NULL);
  return daemon->connection;
}

/**
 * daemon_get_object_manager:
 * @daemon: A #Daemon.
 *
 * Gets the D-Bus object manager used by @daemon.
 *
 * Returns: A #GDBusObjectManagerServer. Do not free, the object is owned by @daemon.
 */
GDBusObjectManagerServer *
daemon_get_object_manager (Daemon *daemon)
{
  g_return_val_if_fail (IS_DAEMON (daemon), NULL);
  return daemon->object_manager;
}

static gboolean
authorize_method (Daemon *daemon,
                  GDBusMethodInvocation *invocation,
                  gboolean *out_is_authorized,
                  GCancellable *cancellable,
                  GError **error)
{
  const char *sender = g_dbus_method_invocation_get_sender (invocation);
  gs_unref_variant GVariant *reply = NULL;
  guint32 uid = 42;

  reply = g_dbus_proxy_call_sync (daemon->system_bus_proxy, "org.freedesktop.DBus.GetConnectionUnixUser",
                                  g_variant_new ("(s)", sender), 0, -1,
                                  cancellable, error);
  if (reply == NULL)
    return FALSE;

  g_variant_get (reply, "(u)", &uid);

  *out_is_authorized = (uid == 0 || auth_uid_is_wheel (uid));
  return TRUE;
}

/**
 * daemon_authorize_method:
 * @daemon: a #Daemon
 * @invocation: method invocation handle
 *
 * Global hook used to authorize DBus methods.  We restrict them to
 * root at the moment (but this forces the bridge to run as root).
 *
 * Possibly a better long term fix is that the bridge actually starts
 * cockpitd as root, opens a private socketpair between them to speak
 * DBus, then drops privileges.
 *
 * Returns: %TRUE if call should be authorized, %FALSE otherwise
 */
gboolean
daemon_authorize_method (Daemon *daemon,
                         GDBusMethodInvocation *invocation)
{
  GError *error = NULL;
  gboolean is_authorized = FALSE;

  if (!authorize_method (daemon, invocation, &is_authorized, NULL, &error))
    {
      g_warning ("Error while authorizing method %s.%s: %s",
                 g_dbus_method_invocation_get_interface_name (invocation),
                 g_dbus_method_invocation_get_method_name (invocation),
                 error->message);
      g_clear_error (&error);
      return FALSE;
    }
  if (!is_authorized)
    {
      g_dbus_method_invocation_return_error (invocation, G_DBUS_ERROR,
                                             G_DBUS_ERROR_ACCESS_DENIED,
                                             "Method %s.%s cannot be invoked by non-root",
                                             g_dbus_method_invocation_get_interface_name (invocation),
                                             g_dbus_method_invocation_get_method_name (invocation));
    }
  return is_authorized;
}

gboolean
daemon_get_sender_uid (Daemon *daemon,
                       GDBusMethodInvocation *invocation,
                       uid_t *uid)
{
  GError *error = NULL;
  const char *sender = g_dbus_method_invocation_get_sender (invocation);
  gs_unref_variant GVariant *reply = NULL;

  reply = g_dbus_proxy_call_sync (daemon->system_bus_proxy, "org.freedesktop.DBus.GetConnectionUnixUser",
                                  g_variant_new ("(s)", sender), 0, -1,
                                  NULL, &error);
  if (reply == NULL)
    {
      g_dbus_method_invocation_take_error (invocation, error);
      return FALSE;
    }

  if (g_variant_is_of_type (reply, G_VARIANT_TYPE("(u)")))
    g_variant_get (reply, "(u)", uid);
  else
    {
      g_dbus_method_invocation_return_error (invocation,
                                             COCKPIT_ERROR, COCKPIT_ERROR_FAILED,
                                             "DBus is broken");
      return FALSE;
    }

  return TRUE;
}
