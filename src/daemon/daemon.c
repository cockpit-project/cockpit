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

#include "daemon.h"
#include "storageprovider.h"
#include "storagemanager.h"
#include "realms.h"
#include "accounts.h"

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
};

struct _DaemonClass
{
  GObjectClass parent_class;
};

enum
{
  PROP_0,
  PROP_CONNECTION,
  PROP_OBJECT_MANAGER,
};

G_DEFINE_TYPE(Daemon, daemon, G_TYPE_OBJECT);

static void
daemon_finalize (GObject *object)
{
  Daemon *daemon = DAEMON (object);

  g_object_unref (daemon->storage_provider);
  g_object_unref (daemon->object_manager);
  g_object_unref (daemon->connection);
  g_object_unref (daemon->system_bus_proxy);

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

static Daemon *_daemon_instance;

static void
daemon_constructed (GObject *_object)
{
  Daemon *daemon = DAEMON (_object);
  CockpitRealms *realms;
  CockpitAccounts *accounts;
  CockpitStorageManager *storage_manager;
  CockpitObjectSkeleton *object = NULL;

  g_assert (_daemon_instance == NULL);
  _daemon_instance = daemon;

  g_debug ("creating bus proxy");

  daemon->system_bus_proxy = g_dbus_proxy_new_sync (daemon->connection, G_DBUS_PROXY_FLAGS_DO_NOT_LOAD_PROPERTIES,
                                                    NULL, "org.freedesktop.DBus",
                                                    "/org/freedesktop/DBus",
                                                    "org.freedesktop.DBus", NULL, NULL);
  g_assert (daemon->system_bus_proxy != NULL);

  g_debug ("creating object manager");

  daemon->object_manager = g_dbus_object_manager_server_new ("/com/redhat/Cockpit");

  /* /com/redhat/Cockpit/Realms */
  realms = realms_new (daemon);
  object = cockpit_object_skeleton_new ("/com/redhat/Cockpit/Realms");
  cockpit_object_skeleton_set_realms (object, realms);
  g_dbus_object_manager_server_export (daemon->object_manager, G_DBUS_OBJECT_SKELETON (object));
  g_object_unref (realms);
  g_object_unref (object);

  g_debug ("exported realms");

  /* /com/redhat/Cockpit/Accounts */
  accounts = accounts_new ();
  if (accounts_is_valid (ACCOUNTS (accounts)))
    {
      object = cockpit_object_skeleton_new ("/com/redhat/Cockpit/Accounts");
      cockpit_object_skeleton_set_accounts (object, accounts);
      g_dbus_object_manager_server_export (daemon->object_manager, G_DBUS_OBJECT_SKELETON (object));
      g_object_unref (object);

      g_debug ("exported accounts");
    }
  g_object_unref (accounts);

  /* /com/redhat/Cockpit/Storage/Manager */
  storage_manager = storage_manager_new (daemon);
  object = cockpit_object_skeleton_new ("/com/redhat/Cockpit/Storage/Manager");
  cockpit_object_skeleton_set_storage_manager (object, storage_manager);
  g_dbus_object_manager_server_export (daemon->object_manager, G_DBUS_OBJECT_SKELETON (object));
  g_object_unref (storage_manager);
  g_object_unref (object);

  g_debug ("exported storage manager");

  daemon->storage_provider = storage_provider_new (daemon);

  /* Export the ObjectManager */
  g_dbus_object_manager_server_set_connection (daemon->object_manager, daemon->connection);

  g_debug ("daemon constructed");

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

StorageProvider *
daemon_get_storage_provider (Daemon *daemon)
{
  return daemon->storage_provider;
}
