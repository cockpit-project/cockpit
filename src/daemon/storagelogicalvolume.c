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
#include "storageblock.h"
#include "storagelogicalvolume.h"

#include "common/cockpitmemory.h"

/**
 * SECTION:storagelogicalvolume
 * @title: LogicalVolume devices
 * @short_description: Implementation of #CockpitStorageLogicalVolume
 */

typedef struct _StorageLogicalVolumeClass StorageLogicalVolumeClass;

/**
 * <private>
 * StorageLogicalVolume:
 *
 * Private.
 */
struct _StorageLogicalVolume
{
  CockpitStorageLogicalVolumeSkeleton parent_instance;

  LvmLogicalVolume *lvm_logical_volume;

  StorageObject *object;
};

struct _StorageLogicalVolumeClass
{
  CockpitStorageLogicalVolumeSkeletonClass parent_class;
};

enum
{
  PROP_0,
  PROP_OBJECT
};

static void storage_logical_volume_iface_init (CockpitStorageLogicalVolumeIface *iface);

static void on_lvm_logical_volume_notify (GObject    *object,
                                           GParamSpec *pspec,
                                           gpointer    user_data);

G_DEFINE_TYPE_WITH_CODE (StorageLogicalVolume, storage_logical_volume, COCKPIT_TYPE_STORAGE_LOGICAL_VOLUME_SKELETON,
                         G_IMPLEMENT_INTERFACE (COCKPIT_TYPE_STORAGE_LOGICAL_VOLUME, storage_logical_volume_iface_init));

/* ---------------------------------------------------------------------------------------------------- */

static void
storage_logical_volume_finalize (GObject *object)
{
  StorageLogicalVolume *logical_volume = STORAGE_LOGICAL_VOLUME (object);

  g_signal_handlers_disconnect_by_func (logical_volume->lvm_logical_volume,
                                        G_CALLBACK (on_lvm_logical_volume_notify),
                                        logical_volume);
  g_object_unref (logical_volume->lvm_logical_volume);

  G_OBJECT_CLASS (storage_logical_volume_parent_class)->finalize (object);
}

static void
storage_logical_volume_get_property (GObject *object,
                                     guint prop_id,
                                     GValue *value,
                                     GParamSpec *pspec)
{
  StorageLogicalVolume *logical_volume = STORAGE_LOGICAL_VOLUME (object);

  switch (prop_id)
    {
    case PROP_OBJECT:
      g_value_set_object (value, logical_volume->object);
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
storage_logical_volume_set_property (GObject *object,
                                     guint prop_id,
                                     const GValue *value,
                                     GParamSpec *pspec)
{
  StorageLogicalVolume *logical_volume = STORAGE_LOGICAL_VOLUME (object);

  switch (prop_id)
    {
    case PROP_OBJECT:
      g_assert (logical_volume->object == NULL);
      logical_volume->object = g_value_get_object (value);
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

void
storage_logical_volume_update (StorageLogicalVolume *logical_volume)
{
  StorageProvider *provider = storage_object_get_provider (logical_volume->object);

  CockpitStorageLogicalVolume *iface = COCKPIT_STORAGE_LOGICAL_VOLUME (logical_volume);
  cockpit_storage_logical_volume_set_uuid
    (iface, lvm_logical_volume_get_uuid (logical_volume->lvm_logical_volume));
  cockpit_storage_logical_volume_set_name
    (iface, lvm_logical_volume_get_name (logical_volume->lvm_logical_volume));
  cockpit_storage_logical_volume_set_size
    (iface, lvm_logical_volume_get_size (logical_volume->lvm_logical_volume));
  cockpit_storage_logical_volume_set_active
    (iface, lvm_logical_volume_get_active (logical_volume->lvm_logical_volume));
  cockpit_storage_logical_volume_set_type_
    (iface, lvm_logical_volume_get_type_ (logical_volume->lvm_logical_volume));
  cockpit_storage_logical_volume_set_data_allocated_ratio
    (iface, lvm_logical_volume_get_data_allocated_ratio (logical_volume->lvm_logical_volume));
  cockpit_storage_logical_volume_set_metadata_allocated_ratio
    (iface, lvm_logical_volume_get_metadata_allocated_ratio (logical_volume->lvm_logical_volume));
  cockpit_storage_logical_volume_set_volume_group
    (iface,
     storage_provider_translate_path
     (provider,
      lvm_logical_volume_get_volume_group (logical_volume->lvm_logical_volume)));
  cockpit_storage_logical_volume_set_thin_pool
    (iface,
     storage_provider_translate_path
     (provider,
      lvm_logical_volume_get_thin_pool (logical_volume->lvm_logical_volume)));
  cockpit_storage_logical_volume_set_origin
    (iface,
     storage_provider_translate_path
     (provider,
      lvm_logical_volume_get_origin (logical_volume->lvm_logical_volume)));
}

static void
on_lvm_logical_volume_notify (GObject *object,
                                 GParamSpec *pspec,
                                 gpointer user_data)
{
  StorageLogicalVolume *logical_volume = STORAGE_LOGICAL_VOLUME (user_data);
  storage_logical_volume_update (logical_volume);
}

static void
storage_logical_volume_constructed (GObject *object)
{
  StorageLogicalVolume *logical_volume = STORAGE_LOGICAL_VOLUME(object);

  logical_volume->lvm_logical_volume = g_object_ref (storage_object_get_lvm_logical_volume (logical_volume->object));
  g_signal_connect (logical_volume->lvm_logical_volume,
                    "notify",
                    G_CALLBACK (on_lvm_logical_volume_notify),
                    logical_volume);

  g_dbus_proxy_set_default_timeout (G_DBUS_PROXY (logical_volume->lvm_logical_volume), G_MAXINT);

  storage_logical_volume_update (logical_volume);

  if (G_OBJECT_CLASS (storage_logical_volume_parent_class)->constructed != NULL)
    G_OBJECT_CLASS (storage_logical_volume_parent_class)->constructed (object);
}

static void
storage_logical_volume_init (StorageLogicalVolume *logical_volume)
{
  g_dbus_interface_skeleton_set_flags (G_DBUS_INTERFACE_SKELETON (logical_volume),
                                       G_DBUS_INTERFACE_SKELETON_FLAGS_HANDLE_METHOD_INVOCATIONS_IN_THREAD);
}

static void
storage_logical_volume_class_init (StorageLogicalVolumeClass *klass)
{
  GObjectClass *gobject_class;

  gobject_class = G_OBJECT_CLASS (klass);
  gobject_class->finalize     = storage_logical_volume_finalize;
  gobject_class->constructed  = storage_logical_volume_constructed;
  gobject_class->set_property = storage_logical_volume_set_property;
  gobject_class->get_property = storage_logical_volume_get_property;

  /**
   * StorageLogicalVolume:object:
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
 * storage_logical_volume_new:
 * @object: A #CockpitStorageObject
 *
 * Creates a new #StorageLogicalVolume instance.
 *
 * Returns: A new #StorageLogicalVolume. Free with g_object_unref().
 */
CockpitStorageLogicalVolume *
storage_logical_volume_new (StorageObject *object)
{
  g_return_val_if_fail (IS_STORAGE_OBJECT (object), NULL);
  return COCKPIT_STORAGE_LOGICAL_VOLUME (g_object_new (TYPE_STORAGE_LOGICAL_VOLUME,
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
handle_delete (CockpitStorageLogicalVolume *object,
               GDBusMethodInvocation *invocation)
{
  StorageLogicalVolume *volume = STORAGE_LOGICAL_VOLUME(object);
  StorageProvider *provider = storage_object_get_provider (volume->object);
  GError *error = NULL;

  if (!storage_cleanup_logical_volume (provider,
                                       volume->lvm_logical_volume,
                                       &error)
      || !lvm_logical_volume_call_delete_sync (volume->lvm_logical_volume,
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
    cockpit_storage_logical_volume_complete_delete (object, invocation);

  return TRUE;
}

static gboolean
handle_rename (CockpitStorageLogicalVolume *object,
               GDBusMethodInvocation *invocation,
               const gchar *arg_new_name)
{
  StorageLogicalVolume *volume = STORAGE_LOGICAL_VOLUME(object);
  GError *error = NULL;
  cleanup_free gchar *result = NULL;

  if (!lvm_logical_volume_call_rename_sync (volume->lvm_logical_volume,
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
    cockpit_storage_logical_volume_complete_rename (object, invocation);

  return TRUE;
}

static gboolean
handle_resize (CockpitStorageLogicalVolume *object,
               GDBusMethodInvocation *invocation,
               guint64 arg_new_size,
               GVariant *arg_options)
{
  StorageLogicalVolume *volume = STORAGE_LOGICAL_VOLUME(object);
  GError *error = NULL;

  if (!lvm_logical_volume_call_resize_sync (volume->lvm_logical_volume,
                                            arg_new_size,
                                            arg_options,
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
    cockpit_storage_logical_volume_complete_resize (object, invocation);

  return TRUE;
}

static gboolean
handle_activate (CockpitStorageLogicalVolume *object,
                 GDBusMethodInvocation *invocation)
{
  StorageLogicalVolume *volume = STORAGE_LOGICAL_VOLUME(object);
  GError *error = NULL;
  cleanup_free gchar *result = NULL;

  if (!lvm_logical_volume_call_activate_sync (volume->lvm_logical_volume,
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
    cockpit_storage_logical_volume_complete_activate (object, invocation);

  return TRUE;
}

static gboolean
handle_deactivate (CockpitStorageLogicalVolume *object,
                   GDBusMethodInvocation *invocation)
{
  StorageLogicalVolume *volume = STORAGE_LOGICAL_VOLUME(object);
  GError *error = NULL;

  if (!lvm_logical_volume_call_deactivate_sync (volume->lvm_logical_volume,
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
    cockpit_storage_logical_volume_complete_deactivate (object, invocation);

  return TRUE;
}

static gboolean
handle_create_snapshot (CockpitStorageLogicalVolume *object,
                        GDBusMethodInvocation *invocation,
                        const gchar *arg_name,
                        guint64 arg_size)
{
  StorageLogicalVolume *volume = STORAGE_LOGICAL_VOLUME(object);
  GError *error = NULL;
  cleanup_free gchar *result = NULL;

  if (!lvm_logical_volume_call_create_snapshot_sync (volume->lvm_logical_volume,
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
    cockpit_storage_logical_volume_complete_create_snapshot (object, invocation);

  return TRUE;
}

static void
storage_logical_volume_iface_init (CockpitStorageLogicalVolumeIface *iface)
{
  iface->handle_delete = handle_delete;
  iface->handle_rename = handle_rename;
  iface->handle_resize = handle_resize;
  iface->handle_activate = handle_activate;
  iface->handle_deactivate = handle_deactivate;
  iface->handle_create_snapshot = handle_create_snapshot;
}
