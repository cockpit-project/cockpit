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
#include "storageobject.h"
#include "storagemdraid.h"

#include "common/cockpitmemory.h"

/**
 * SECTION:storagemdraid
 * @title: Mdraid devices
 * @short_description: Implementation of #CockpitStorageMDRaid
 *
 * Instances of the #CockpitStorageMDRaid type are mdraid devices.
 */

typedef struct _StorageMDRaidClass StorageMDRaidClass;

/**
 * <private>
 * StorageMDRaid:
 *
 * Private.
 */
struct _StorageMDRaid
{
  CockpitStorageMDRaidSkeleton parent_instance;

  UDisksMDRaid *udisks_mdraid;

  StorageObject *object;
};

struct _StorageMDRaidClass
{
  CockpitStorageMDRaidSkeletonClass parent_class;
};

enum
{
  PROP_0,
  PROP_OBJECT
};

static void storage_mdraid_iface_init (CockpitStorageMDRaidIface *iface);

static void on_udisks_mdraid_notify (GObject    *object,
                                     GParamSpec *pspec,
                                     gpointer    user_data);

G_DEFINE_TYPE_WITH_CODE (StorageMDRaid, storage_mdraid, COCKPIT_TYPE_STORAGE_MDRAID_SKELETON,
                         G_IMPLEMENT_INTERFACE (COCKPIT_TYPE_STORAGE_MDRAID, storage_mdraid_iface_init));

/* ---------------------------------------------------------------------------------------------------- */

static void
storage_mdraid_finalize (GObject *object)
{
  StorageMDRaid *mdraid = STORAGE_MDRAID (object);

  g_signal_handlers_disconnect_by_func (mdraid->udisks_mdraid,
                                        G_CALLBACK (on_udisks_mdraid_notify),
                                        mdraid);
  g_object_unref (mdraid->udisks_mdraid);

  G_OBJECT_CLASS (storage_mdraid_parent_class)->finalize (object);
}

static void
storage_mdraid_get_property (GObject *object,
                             guint prop_id,
                             GValue *value,
                             GParamSpec *pspec)
{
  StorageMDRaid *mdraid = STORAGE_MDRAID (object);

  switch (prop_id)
    {
    case PROP_OBJECT:
      g_value_set_object (value, mdraid->object);
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
storage_mdraid_set_property (GObject *object,
                             guint prop_id,
                             const GValue *value,
                             GParamSpec *pspec)
{
  StorageMDRaid *mdraid = STORAGE_MDRAID (object);

  switch (prop_id)
    {
    case PROP_OBJECT:
      g_assert (mdraid->object == NULL);
      mdraid->object = g_value_get_object (value);
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

void
storage_mdraid_update (StorageMDRaid *mdraid)
{
  UDisksMDRaid *udisks_mdraid = mdraid->udisks_mdraid;
  CockpitStorageMDRaid *iface = COCKPIT_STORAGE_MDRAID (mdraid);
  StorageProvider *provider = storage_object_get_provider (mdraid->object);
  UDisksClient *udisks_client = storage_provider_get_udisks_client (provider);

  cockpit_storage_mdraid_set_uuid (iface, udisks_mdraid_get_uuid (udisks_mdraid));
  cockpit_storage_mdraid_set_name (iface, udisks_mdraid_get_name (udisks_mdraid));
  cockpit_storage_mdraid_set_level (iface, udisks_mdraid_get_level (udisks_mdraid));
  cockpit_storage_mdraid_set_num_devices (iface, udisks_mdraid_get_num_devices (udisks_mdraid));
  cockpit_storage_mdraid_set_size (iface, udisks_mdraid_get_size (udisks_mdraid));
  cockpit_storage_mdraid_set_sync_action (iface, udisks_mdraid_get_sync_action (udisks_mdraid));
  cockpit_storage_mdraid_set_sync_completed (iface, udisks_mdraid_get_sync_completed (udisks_mdraid));
  cockpit_storage_mdraid_set_sync_rate (iface, udisks_mdraid_get_sync_rate (udisks_mdraid));
  cockpit_storage_mdraid_set_sync_remaining_time (iface, udisks_mdraid_get_sync_remaining_time (udisks_mdraid));
  cockpit_storage_mdraid_set_degraded (iface, udisks_mdraid_get_degraded (udisks_mdraid));
  {
    cleanup_free gchar *loc = g_locale_to_utf8 (udisks_mdraid_get_bitmap_location (udisks_mdraid),
                                            -1, NULL, NULL, NULL);
    cockpit_storage_mdraid_set_bitmap_location (iface, loc);
  }
  cockpit_storage_mdraid_set_chunk_size (iface, udisks_mdraid_get_chunk_size (udisks_mdraid));

  GVariantBuilder devices;
  g_variant_builder_init (&devices, G_VARIANT_TYPE("a(oiast)"));

  GVariantIter iter;
  gint disk_slot;
  const gchar *disk_block_objpath;
  cleanup_unref_variant GVariant *disk_states = NULL;
  guint64 disk_num_errors;
  g_variant_iter_init (&iter, udisks_mdraid_get_active_devices (udisks_mdraid));
  while (g_variant_iter_next (&iter, "(&oi@asta{sv})",
                              &disk_block_objpath,
                              &disk_slot,
                              &disk_states,
                              &disk_num_errors,
                              NULL))
    {
      UDisksObject *udisks_object;
      UDisksBlock *udisks_block;
      StorageObject *object;

      if ((udisks_object = udisks_client_peek_object (udisks_client, disk_block_objpath))
          && (udisks_block = udisks_object_peek_block (udisks_object))
          && (object = storage_provider_lookup_for_udisks_block (provider, udisks_block)))
        {
          g_variant_builder_add (&devices, "(oi@ast)",
                                 g_dbus_object_get_object_path (G_DBUS_OBJECT(object)),
                                 disk_slot,
                                 disk_states,
                                 disk_num_errors);
        }
    }
  cockpit_storage_mdraid_set_active_devices (iface, g_variant_builder_end (&devices));
}

static void
on_udisks_mdraid_notify (GObject *object,
                         GParamSpec *pspec,
                         gpointer user_data)
{
  StorageMDRaid *mdraid = STORAGE_MDRAID (user_data);
  storage_mdraid_update (mdraid);
}

static void
storage_mdraid_constructed (GObject *object)
{
  StorageMDRaid *mdraid = STORAGE_MDRAID (object);

  mdraid->udisks_mdraid = g_object_ref (storage_object_get_udisks_mdraid (mdraid->object));
  g_signal_connect (mdraid->udisks_mdraid,
                    "notify",
                    G_CALLBACK (on_udisks_mdraid_notify),
                    mdraid);

  storage_mdraid_update (mdraid);

  if (G_OBJECT_CLASS (storage_mdraid_parent_class)->constructed != NULL)
    G_OBJECT_CLASS (storage_mdraid_parent_class)->constructed (object);
}

static void
storage_mdraid_init (StorageMDRaid *mdraid)
{
}

static void
storage_mdraid_class_init (StorageMDRaidClass *klass)
{
  GObjectClass *gobject_class;

  gobject_class = G_OBJECT_CLASS (klass);
  gobject_class->finalize     = storage_mdraid_finalize;
  gobject_class->constructed  = storage_mdraid_constructed;
  gobject_class->set_property = storage_mdraid_set_property;
  gobject_class->get_property = storage_mdraid_get_property;

  /**
   * StorageMDRaid:object:
   *
   * The #CockpitStorageObject for the object.
   */
  g_object_class_install_property (gobject_class,
                                   PROP_OBJECT,
                                   g_param_spec_object ("object",
                                                        NULL,
                                                        NULL,
                                                        TYPE_STORAGE_OBJECT,
                                                        G_PARAM_READABLE |
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY |
                                                        G_PARAM_STATIC_STRINGS));
}

/**
 * storage_mdraid_new:
 * @object: A #CockpitStorageObject
 *
 * Creates a new #StorageMDRaid instance.
 *
 * Returns: A new #StorageMDRaid. Free with g_object_unref().
 */
CockpitStorageMDRaid *
storage_mdraid_new (StorageObject *object)
{
  g_return_val_if_fail (IS_STORAGE_OBJECT (object), NULL);
  return COCKPIT_STORAGE_MDRAID (g_object_new (TYPE_STORAGE_MDRAID,
                                               "object", object,
                                               NULL));
}

static gboolean
handle_start (CockpitStorageMDRaid *object,
              GDBusMethodInvocation *invocation)
{
  StorageMDRaid *mdraid = STORAGE_MDRAID(object);
  GError *error = NULL;

  GVariantBuilder options;
  g_variant_builder_init (&options, G_VARIANT_TYPE("a{sv}"));
  g_variant_builder_add (&options, "{sv}", "start-degraded", g_variant_new_boolean (TRUE));

  if (!udisks_mdraid_call_start_sync (mdraid->udisks_mdraid,
                                      g_variant_builder_end (&options),
                                      NULL,
                                      &error))
    {
      g_dbus_error_strip_remote_error (error);
      g_dbus_method_invocation_return_error (invocation,
                                             COCKPIT_ERROR,
                                             COCKPIT_ERROR_FAILED,
                                             "%s", error->message);
      g_error_free (error);
    }
  else
    cockpit_storage_mdraid_complete_start (object, invocation);

  return TRUE;
}

static gboolean
handle_stop (CockpitStorageMDRaid *object,
             GDBusMethodInvocation *invocation)
{
  StorageMDRaid *mdraid = STORAGE_MDRAID(object);
  GError *error = NULL;

  GVariantBuilder options;
  g_variant_builder_init (&options, G_VARIANT_TYPE("a{sv}"));

  if (!udisks_mdraid_call_stop_sync (mdraid->udisks_mdraid,
                                     g_variant_builder_end (&options),
                                     NULL,
                                     &error))
    {
      g_dbus_error_strip_remote_error (error);
      g_dbus_method_invocation_return_error (invocation,
                                             COCKPIT_ERROR,
                                             COCKPIT_ERROR_FAILED,
                                             "%s", error->message);
      g_error_free (error);
    }
  else
    cockpit_storage_mdraid_complete_stop (object, invocation);

  return TRUE;
}

static gboolean
handle_delete (CockpitStorageMDRaid *object,
               GDBusMethodInvocation *invocation)
{
  StorageMDRaid *mdraid = STORAGE_MDRAID(object);
  StorageProvider *provider = storage_object_get_provider (mdraid->object);
  UDisksClient *udisks_client = storage_provider_get_udisks_client (provider);
  cleanup_unref_object UDisksBlock *block = NULL;
  GList *members = NULL;
  GError *error = NULL;

  /* Delete is Stop followed by wiping of all member devices.
   */

  block = udisks_client_get_block_for_mdraid (udisks_client, mdraid->udisks_mdraid);
  if (block)
    {
      if (!storage_cleanup_block (provider, block, &error))
        goto out;
    }

  GVariantBuilder options;
  g_variant_builder_init (&options, G_VARIANT_TYPE("a{sv}"));

  if (!udisks_mdraid_call_stop_sync (mdraid->udisks_mdraid,
                                     g_variant_builder_end (&options),
                                     NULL,
                                     &error))
    goto out;

  members = udisks_client_get_members_for_mdraid (udisks_client,
                                                  mdraid->udisks_mdraid);
  for (GList *m = members; m; m = m->next)
    {
      UDisksBlock *block = m->data;
      GVariantBuilder options;
      g_variant_builder_init (&options, G_VARIANT_TYPE("a{sv}"));
      udisks_block_call_format_sync (block,
                                     "empty",
                                     g_variant_builder_end (&options),
                                     NULL,
                                     error ? NULL : &error);
    }

out:
  if (error)
    {
      g_dbus_error_strip_remote_error (error);
      g_dbus_method_invocation_return_error (invocation,
                                             COCKPIT_ERROR,
                                             COCKPIT_ERROR_FAILED,
                                             "%s", error->message);
    }
  else
    cockpit_storage_mdraid_complete_stop (object, invocation);

  g_list_free_full (members, g_object_unref);
  g_clear_error (&error);
  return TRUE;
}

static gboolean
handle_request_sync_action (CockpitStorageMDRaid *object,
                            GDBusMethodInvocation *invocation,
                            const gchar *arg_sync_action)
{
  StorageMDRaid *mdraid = STORAGE_MDRAID(object);
  GError *error = NULL;

  GVariantBuilder options;
  g_variant_builder_init (&options, G_VARIANT_TYPE("a{sv}"));

  if (!udisks_mdraid_call_request_sync_action_sync (mdraid->udisks_mdraid,
                                                    arg_sync_action,
                                                    g_variant_builder_end (&options),
                                                    NULL,
                                                    &error))
    {
      g_dbus_error_strip_remote_error (error);
      g_dbus_method_invocation_return_error (invocation,
                                             COCKPIT_ERROR,
                                             COCKPIT_ERROR_FAILED,
                                             "%s", error->message);
      g_error_free (error);
    }
  else
    cockpit_storage_mdraid_complete_request_sync_action (object, invocation);

  return TRUE;
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
handle_set_bitmap_location (CockpitStorageMDRaid *object,
                            GDBusMethodInvocation *invocation,
                            const gchar *arg_value)
{
  StorageMDRaid *mdraid = STORAGE_MDRAID(object);
  GError *error = NULL;

  GVariantBuilder options;
  g_variant_builder_init (&options, G_VARIANT_TYPE("a{sv}"));

  if (!udisks_mdraid_call_set_bitmap_location_sync (mdraid->udisks_mdraid,
                                                    arg_value,
                                                    g_variant_builder_end (&options),
                                                    NULL,
                                                    &error))
    {
      g_dbus_error_strip_remote_error (error);
      g_dbus_method_invocation_return_error (invocation,
                                             COCKPIT_ERROR,
                                             COCKPIT_ERROR_FAILED,
                                             "%s", error->message);
      g_error_free (error);
    }
  else
    cockpit_storage_mdraid_complete_set_bitmap_location (object, invocation);

  return TRUE;
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
handle_remove_devices (CockpitStorageMDRaid *object,
                       GDBusMethodInvocation *invocation,
                       const gchar *const *arg_devices)
{
  StorageMDRaid *mdraid = STORAGE_MDRAID(object);
  StorageProvider *provider = storage_object_get_provider (mdraid->object);
  Daemon *daemon = storage_provider_get_daemon (provider);
  GDBusObjectManagerServer *object_manager_server = daemon_get_object_manager (daemon);
  GDBusObjectManager *object_manager = G_DBUS_OBJECT_MANAGER (object_manager_server);
  GError *error = NULL;

  int n_devices = 0;
  for (int i = 0; arg_devices[i]; i++)
    n_devices += 1;

  const gchar *udisks_devices[n_devices + 1];

  for (int i = 0; arg_devices[i]; i++)
    {
      StorageObject *stobj =
          STORAGE_OBJECT(g_dbus_object_manager_get_object (object_manager, arg_devices[i]));
      UDisksBlock *block = storage_object_get_udisks_block (stobj);
      if (block)
        udisks_devices[i] = g_dbus_proxy_get_object_path (G_DBUS_PROXY(block));
      else
        udisks_devices[i] = "XXX";
    }
  udisks_devices[n_devices] = NULL;

  for (int i = 0; udisks_devices[i]; i++)
    {
      GVariantBuilder options;
      g_variant_builder_init (&options, G_VARIANT_TYPE("a{sv}"));
      g_variant_builder_add (&options, "{sv}", "wipe", g_variant_new_boolean (TRUE));

      if (!udisks_mdraid_call_remove_device_sync (mdraid->udisks_mdraid,
                                                  udisks_devices[i],
                                                  g_variant_builder_end (&options),
                                                  NULL,
                                                  &error))
        {
          g_dbus_error_strip_remote_error (error);
          g_dbus_method_invocation_return_error (invocation,
                                                 COCKPIT_ERROR,
                                                 COCKPIT_ERROR_FAILED,
                                                 "%s", error->message);
          g_error_free (error);
          return TRUE;
        }
    }

  cockpit_storage_mdraid_complete_remove_devices (object, invocation);
  return TRUE;
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
handle_add_devices (CockpitStorageMDRaid *object,
                    GDBusMethodInvocation *invocation,
                    const gchar * const *arg_devices)
{
  StorageMDRaid *mdraid = STORAGE_MDRAID(object);
  StorageProvider *provider = storage_object_get_provider (mdraid->object);
  Daemon *daemon = storage_provider_get_daemon (provider);
  GDBusObjectManagerServer *object_manager_server = daemon_get_object_manager (daemon);
  GDBusObjectManager *object_manager = G_DBUS_OBJECT_MANAGER (object_manager_server);
  GError *error = NULL;

  int n_devices = 0;
  for (int i = 0; arg_devices[i]; i++)
    n_devices += 1;

  const gchar *udisks_devices[n_devices + 1];

  for (int i = 0; arg_devices[i]; i++)
    {
      StorageObject *stobj =
        STORAGE_OBJECT (g_dbus_object_manager_get_object (object_manager, arg_devices[i]));
      UDisksBlock *block = storage_object_get_udisks_block (stobj);
      if (block)
        udisks_devices[i] = g_dbus_proxy_get_object_path (G_DBUS_PROXY(block));
      else
        udisks_devices[i] = "XXX";
    }
  udisks_devices[n_devices] = NULL;

  for (int i = 0; udisks_devices[i]; i++)
    {
      GVariantBuilder options;
      g_variant_builder_init (&options, G_VARIANT_TYPE("a{sv}"));

      if (!udisks_mdraid_call_add_device_sync (mdraid->udisks_mdraid,
                                               udisks_devices[i],
                                               g_variant_builder_end (&options),
                                               NULL,
                                               &error))
        {
          g_dbus_error_strip_remote_error (error);
          g_dbus_method_invocation_return_error (invocation,
                                                 COCKPIT_ERROR,
                                                 COCKPIT_ERROR_FAILED,
                                                 "%s", error->message);
          g_error_free (error);
          return TRUE;
        }
    }

  cockpit_storage_mdraid_complete_add_devices (object, invocation);
  return TRUE;
}

/* ---------------------------------------------------------------------------------------------------- */

static void
storage_mdraid_iface_init (CockpitStorageMDRaidIface *iface)
{
  iface->handle_start = handle_start;
  iface->handle_stop = handle_stop;
  iface->handle_delete = handle_delete;
  iface->handle_request_sync_action = handle_request_sync_action;
  iface->handle_set_bitmap_location = handle_set_bitmap_location;
  iface->handle_remove_devices = handle_remove_devices;
  iface->handle_add_devices = handle_add_devices;
}
