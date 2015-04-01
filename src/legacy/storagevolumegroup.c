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
#include "storagemanager.h"
#include "storageprovider.h"
#include "storageobject.h"
#include "storagevolumegroup.h"

#include "common/cockpitmemory.h"

/**
 * SECTION:storagevolume_group
 * @title: Volume_Group devices
 * @short_description: Implementation of #CockpitStorageVolumeGroup
 */

typedef struct _StorageVolumeGroupClass StorageVolumeGroupClass;

/**
 * <private>
 * StorageVolumeGroup:
 *
 * Private.
 */

struct _StorageVolumeGroup
{
  CockpitStorageVolumeGroupSkeleton parent_instance;

  LvmVolumeGroup *lvm_volume_group;
  StorageObject *object;
};

struct _StorageVolumeGroupClass
{
  CockpitStorageVolumeGroupSkeletonClass parent_class;
};

enum
  {
    PROP_0,
    PROP_OBJECT
  };

static void storage_volume_group_iface_init (CockpitStorageVolumeGroupIface *iface);

static void on_lvm_volume_group_notify (GObject    *object,
                                        GParamSpec *pspec,
                                        gpointer    user_data);

G_DEFINE_TYPE_WITH_CODE (StorageVolumeGroup, storage_volume_group, COCKPIT_TYPE_STORAGE_VOLUME_GROUP_SKELETON,
                         G_IMPLEMENT_INTERFACE (COCKPIT_TYPE_STORAGE_VOLUME_GROUP, storage_volume_group_iface_init));

/* ---------------------------------------------------------------------------------------------------- */

static void
storage_volume_group_finalize (GObject *object)
{
  StorageVolumeGroup *volume_group = STORAGE_VOLUME_GROUP (object);

  g_signal_handlers_disconnect_by_func (volume_group->lvm_volume_group,
                                        G_CALLBACK (on_lvm_volume_group_notify),
                                        volume_group);
  g_object_unref (volume_group->lvm_volume_group);

  G_OBJECT_CLASS (storage_volume_group_parent_class)->finalize (object);
}

static void
storage_volume_group_get_property (GObject *object,
                                   guint prop_id,
                                   GValue *value,
                                   GParamSpec *pspec)
{
  StorageVolumeGroup *volume_group = STORAGE_VOLUME_GROUP (object);

  switch (prop_id)
    {
    case PROP_OBJECT:
      g_value_set_object (value, volume_group->object);
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
storage_volume_group_set_property (GObject *object,
                                   guint prop_id,
                                   const GValue *value,
                                   GParamSpec *pspec)
{
  StorageVolumeGroup *volume_group = STORAGE_VOLUME_GROUP (object);

  switch (prop_id)
    {
    case PROP_OBJECT:
      g_assert (volume_group->object == NULL);
      volume_group->object = g_value_get_object (value);
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

void
storage_volume_group_update (StorageVolumeGroup *volume_group)
{
  CockpitStorageVolumeGroup *iface = COCKPIT_STORAGE_VOLUME_GROUP (volume_group);
  cockpit_storage_volume_group_set_uuid (iface, lvm_volume_group_get_uuid (volume_group->lvm_volume_group));
  cockpit_storage_volume_group_set_name (iface, lvm_volume_group_get_name (volume_group->lvm_volume_group));
  cockpit_storage_volume_group_set_size (iface, lvm_volume_group_get_size (volume_group->lvm_volume_group));
  cockpit_storage_volume_group_set_free_size (iface, lvm_volume_group_get_free_size (volume_group->lvm_volume_group));
  cockpit_storage_volume_group_set_needs_polling (iface, lvm_volume_group_get_needs_polling (volume_group->lvm_volume_group));
}

static void
on_lvm_volume_group_notify (GObject *object,
                            GParamSpec *pspec,
                            gpointer user_data)
{
  StorageVolumeGroup *volume_group = STORAGE_VOLUME_GROUP (user_data);
  storage_volume_group_update (volume_group);
}

static void
storage_volume_group_constructed (GObject *object)
{
  StorageVolumeGroup *volume_group = STORAGE_VOLUME_GROUP (object);

  volume_group->lvm_volume_group = g_object_ref (storage_object_get_lvm_volume_group (volume_group->object));
  g_signal_connect (volume_group->lvm_volume_group,
                    "notify",
                    G_CALLBACK (on_lvm_volume_group_notify),
                    volume_group);

  g_dbus_proxy_set_default_timeout (G_DBUS_PROXY (volume_group->lvm_volume_group), G_MAXINT);

  storage_volume_group_update (volume_group);

  if (G_OBJECT_CLASS (storage_volume_group_parent_class)->constructed != NULL)
    G_OBJECT_CLASS (storage_volume_group_parent_class)->constructed (object);
}

static void
storage_volume_group_init (StorageVolumeGroup *volume_group)
{
  g_dbus_interface_skeleton_set_flags (G_DBUS_INTERFACE_SKELETON (volume_group),
                                       G_DBUS_INTERFACE_SKELETON_FLAGS_HANDLE_METHOD_INVOCATIONS_IN_THREAD);
}

static void
storage_volume_group_class_init (StorageVolumeGroupClass *klass)
{
  GObjectClass *gobject_class;

  gobject_class = G_OBJECT_CLASS (klass);
  gobject_class->finalize     = storage_volume_group_finalize;
  gobject_class->constructed  = storage_volume_group_constructed;
  gobject_class->set_property = storage_volume_group_set_property;
  gobject_class->get_property = storage_volume_group_get_property;

  /**
   * StorageVolumeGroup:object:
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
 * storage_volume_group_new:
 * @object: A #CockpitStorageObject
 *
 * Creates a new #StorageVolumeGroup instance.
 *
 * Returns: A new #StorageVolumeGroup. Free with g_object_unref().
 */
CockpitStorageVolumeGroup *
storage_volume_group_new (StorageObject *object)
{
  g_return_val_if_fail (IS_STORAGE_OBJECT (object), NULL);
  return COCKPIT_STORAGE_VOLUME_GROUP (g_object_new (TYPE_STORAGE_VOLUME_GROUP,
                                                     "object", object,
                                                     NULL));
}

static GVariant *
null_asv (void)
{
  GVariantBuilder options;
  g_variant_builder_init (&options, G_VARIANT_TYPE("a{sv}"));
  return g_variant_builder_end (&options);
}

static gboolean
handle_poll (CockpitStorageVolumeGroup *object,
             GDBusMethodInvocation *invocation)
{
  StorageVolumeGroup *group = STORAGE_VOLUME_GROUP(object);
  GError *error = NULL;

  if (!lvm_volume_group_call_poll_sync (group->lvm_volume_group,
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
    cockpit_storage_volume_group_complete_poll (object, invocation);

  return TRUE;
}

static gboolean
handle_delete (CockpitStorageVolumeGroup *object,
               GDBusMethodInvocation *invocation)
{
  StorageVolumeGroup *group = STORAGE_VOLUME_GROUP(object);
  StorageProvider *provider = storage_object_get_provider (group->object);
  GError *error = NULL;

  if (!storage_cleanup_volume_group (provider,
                                     group->lvm_volume_group,
                                     &error)
      || !lvm_volume_group_call_delete_sync (group->lvm_volume_group,
                                             TRUE,
                                             null_asv (),
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
    cockpit_storage_volume_group_complete_delete (object, invocation);

  return TRUE;
}

static gboolean
handle_rename (CockpitStorageVolumeGroup *object,
               GDBusMethodInvocation *invocation,
               const gchar *arg_new_name)
{
  StorageVolumeGroup *group = STORAGE_VOLUME_GROUP(object);
  GError *error = NULL;
  cleanup_free gchar *result = NULL;

  if (!lvm_volume_group_call_rename_sync (group->lvm_volume_group,
                                          arg_new_name,
                                          null_asv (),
                                          &result,
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
    cockpit_storage_volume_group_complete_rename (object, invocation);

  return TRUE;
}

static gboolean
handle_add_device (CockpitStorageVolumeGroup *object,
                   GDBusMethodInvocation *invocation,
                   const gchar *arg_objpath)
{
  StorageVolumeGroup *group = STORAGE_VOLUME_GROUP(object);
  GError *error = NULL;
  const gchar *block_path = "/";

  StorageProvider *provider = storage_object_get_provider (group->object);
  Daemon *daemon = storage_provider_get_daemon (provider);
  GDBusObjectManagerServer *object_manager_server = daemon_get_object_manager (daemon);
  GDBusObjectManager *object_manager = G_DBUS_OBJECT_MANAGER (object_manager_server);

  StorageObject *block_object =
    STORAGE_OBJECT (g_dbus_object_manager_get_object (object_manager, arg_objpath));
  UDisksBlock *udisks_block = storage_object_get_udisks_block (block_object);

  if (udisks_block)
    block_path = g_dbus_proxy_get_object_path (G_DBUS_PROXY (udisks_block));

  if (!lvm_volume_group_call_add_device_sync (group->lvm_volume_group,
                                              block_path,
                                              null_asv (),
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
    cockpit_storage_volume_group_complete_add_device (object, invocation);

  return TRUE;
}

static gboolean
handle_remove_device (CockpitStorageVolumeGroup *object,
                      GDBusMethodInvocation *invocation,
                      const gchar *arg_objpath)
{
  StorageVolumeGroup *group = STORAGE_VOLUME_GROUP(object);
  GError *error = NULL;
  const gchar *block_path = "/";

  StorageProvider *provider = storage_object_get_provider (group->object);
  Daemon *daemon = storage_provider_get_daemon (provider);
  GDBusObjectManagerServer *object_manager_server = daemon_get_object_manager (daemon);
  GDBusObjectManager *object_manager = G_DBUS_OBJECT_MANAGER (object_manager_server);

  StorageObject *block_object =
    STORAGE_OBJECT (g_dbus_object_manager_get_object (object_manager, arg_objpath));
  UDisksBlock *udisks_block = storage_object_get_udisks_block (block_object);

  if (udisks_block)
    block_path = g_dbus_proxy_get_object_path (G_DBUS_PROXY (udisks_block));

  if (!lvm_volume_group_call_remove_device_sync (group->lvm_volume_group,
                                                 block_path,
                                                 TRUE,
                                                 null_asv (),
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
    cockpit_storage_volume_group_complete_remove_device (object, invocation);

  return TRUE;
}

static gboolean
handle_empty_device (CockpitStorageVolumeGroup *object,
                     GDBusMethodInvocation *invocation,
                     const gchar *arg_objpath)
{
  StorageVolumeGroup *group = STORAGE_VOLUME_GROUP(object);
  GError *error = NULL;
  const gchar *block_path = "/";

  StorageProvider *provider = storage_object_get_provider (group->object);
  Daemon *daemon = storage_provider_get_daemon (provider);
  GDBusObjectManagerServer *object_manager_server = daemon_get_object_manager (daemon);
  GDBusObjectManager *object_manager = G_DBUS_OBJECT_MANAGER (object_manager_server);

  StorageObject *block_object =
    STORAGE_OBJECT (g_dbus_object_manager_get_object (object_manager, arg_objpath));
  UDisksBlock *udisks_block = storage_object_get_udisks_block (block_object);

  if (udisks_block)
    block_path = g_dbus_proxy_get_object_path (G_DBUS_PROXY (udisks_block));

  g_dbus_proxy_set_default_timeout (G_DBUS_PROXY (group->lvm_volume_group),
                                    G_MAXINT);

  if (!lvm_volume_group_call_empty_device_sync (group->lvm_volume_group,
                                                block_path,
                                                null_asv (),
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
    cockpit_storage_volume_group_complete_empty_device (object, invocation);

  g_dbus_proxy_set_default_timeout (G_DBUS_PROXY (group->lvm_volume_group),
                                    -1);

  return TRUE;
}

static gboolean
handle_create_plain_volume (CockpitStorageVolumeGroup *object,
                            GDBusMethodInvocation *invocation,
                            const gchar *arg_name,
                            guint64 arg_size)
{
  StorageVolumeGroup *group = STORAGE_VOLUME_GROUP(object);
  GError *error = NULL;
  cleanup_free gchar *result = NULL;

  if (!lvm_volume_group_call_create_plain_volume_sync (group->lvm_volume_group,
                                                       arg_name,
                                                       arg_size,
                                                       null_asv (),
                                                       &result,
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
    cockpit_storage_volume_group_complete_create_plain_volume (object, invocation);

  return TRUE;
}

static gboolean
handle_create_thin_pool_volume (CockpitStorageVolumeGroup *object,
                                GDBusMethodInvocation *invocation,
                                const gchar *arg_name,
                                guint64 arg_size)
{
  StorageVolumeGroup *group = STORAGE_VOLUME_GROUP(object);
  GError *error = NULL;
  cleanup_free gchar *result = NULL;

  if (!lvm_volume_group_call_create_thin_pool_volume_sync (group->lvm_volume_group,
                                                           arg_name,
                                                           arg_size,
                                                           null_asv (),
                                                           &result,
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
    cockpit_storage_volume_group_complete_create_thin_pool_volume (object, invocation);

  return TRUE;
}

static gboolean
handle_create_thin_volume (CockpitStorageVolumeGroup *object,
                           GDBusMethodInvocation *invocation,
                           const gchar *arg_name,
                           guint64 arg_size,
                           const gchar *arg_pool)
{
  StorageVolumeGroup *group = STORAGE_VOLUME_GROUP(object);
  GError *error = NULL;
  cleanup_free gchar *result = NULL;
  const gchar *pool_path = "/";

  StorageProvider *provider = storage_object_get_provider (group->object);
  Daemon *daemon = storage_provider_get_daemon (provider);
  GDBusObjectManagerServer *object_manager_server = daemon_get_object_manager (daemon);
  GDBusObjectManager *object_manager = G_DBUS_OBJECT_MANAGER (object_manager_server);

  StorageObject *pool_object =
    STORAGE_OBJECT (g_dbus_object_manager_get_object (object_manager, arg_pool));
  LvmLogicalVolume *lvm_pool_lvol = storage_object_get_lvm_logical_volume (pool_object);

  if (lvm_pool_lvol)
    pool_path = g_dbus_proxy_get_object_path (G_DBUS_PROXY (lvm_pool_lvol));

  if (!lvm_volume_group_call_create_thin_volume_sync (group->lvm_volume_group,
                                                      arg_name,
                                                      arg_size,
                                                      pool_path,
                                                      null_asv (),
                                                      &result,
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
    cockpit_storage_volume_group_complete_create_thin_pool_volume (object, invocation);

  return TRUE;
}

static void
storage_volume_group_iface_init (CockpitStorageVolumeGroupIface *iface)
{
  iface->handle_poll = handle_poll;

  iface->handle_delete = handle_delete;
  iface->handle_rename = handle_rename;

  iface->handle_add_device = handle_add_device;
  iface->handle_remove_device = handle_remove_device;
  iface->handle_empty_device = handle_empty_device;

  iface->handle_create_plain_volume = handle_create_plain_volume;
  iface->handle_create_thin_pool_volume = handle_create_thin_pool_volume;
  iface->handle_create_thin_volume = handle_create_thin_volume;
}
