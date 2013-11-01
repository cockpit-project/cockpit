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
#include "storagedrive.h"
#include "storagemdraid.h"
#include "storagevolumegroup.h"
#include "storagelogicalvolume.h"
#include "utils.h"

/**
 * SECTION:storageobject
 * @title: Storage object
 * @short_description: Object for storage interfaces
 *
 * Object for storage infaces.
 */

typedef struct _StorageObjectClass StorageObjectClass;

/**
 * <private>
 * StorageObject:
 *
 * Private.
 */
struct _StorageObject
{
  CockpitObjectSkeleton parent_instance;

  StorageProvider *provider;

  UDisksBlock *udisks_block;
  UDisksDrive *udisks_drive;
  UDisksMDRaid *udisks_mdraid;
  UDisksVolumeGroup *udisks_volume_group;
  UDisksLogicalVolume *udisks_logical_volume;

  CockpitStorageBlock *storage_block_iface;
  CockpitStorageDrive *storage_drive_iface;
  CockpitStorageMDRaid *storage_mdraid_iface;
  CockpitStorageVolumeGroup *storage_volume_group_iface;
  CockpitStorageLogicalVolume *storage_logical_volume_iface;
};

struct _StorageObjectClass
{
  CockpitObjectSkeletonClass parent_class;
};

enum
{
  PROP_0,
  PROP_PROVIDER,
  PROP_UDISKS_BLOCK,
  PROP_UDISKS_DRIVE,
  PROP_UDISKS_MDRAID,
  PROP_UDISKS_VOLUME_GROUP,
  PROP_UDISKS_LOGICAL_VOLUME,
};

G_DEFINE_TYPE (StorageObject, storage_object, COCKPIT_TYPE_OBJECT_SKELETON);

/* ---------------------------------------------------------------------------------------------------- */

static void
storage_object_finalize (GObject *_object)
{
  StorageObject *object = STORAGE_OBJECT (_object);

  /* ->provider is a borrowed reference */
  g_clear_object (&object->udisks_block);
  g_clear_object (&object->udisks_drive);
  g_clear_object (&object->udisks_mdraid);
  g_clear_object (&object->udisks_volume_group);
  g_clear_object (&object->udisks_logical_volume);

  G_OBJECT_CLASS (storage_object_parent_class)->finalize (_object);
}

static void
storage_object_get_property (GObject *_object,
                             guint prop_id,
                             GValue *value,
                             GParamSpec *pspec)
{
  StorageObject *object = STORAGE_OBJECT (_object);

  switch (prop_id)
    {
    case PROP_PROVIDER:
      g_value_set_object (value, storage_object_get_provider (object));
      break;

    case PROP_UDISKS_BLOCK:
      g_value_set_object (value, storage_object_get_udisks_block (object));
      break;

    case PROP_UDISKS_DRIVE:
      g_value_set_object (value, storage_object_get_udisks_drive (object));
      break;

    case PROP_UDISKS_MDRAID:
      g_value_set_object (value, storage_object_get_udisks_mdraid (object));
      break;

    case PROP_UDISKS_VOLUME_GROUP:
      g_value_set_object (value, storage_object_get_udisks_volume_group (object));
      break;

    case PROP_UDISKS_LOGICAL_VOLUME:
      g_value_set_object (value, storage_object_get_udisks_logical_volume (object));
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
storage_object_set_property (GObject *_object,
                             guint prop_id,
                             const GValue *value,
                             GParamSpec *pspec)
{
  StorageObject *object = STORAGE_OBJECT (_object);

  switch (prop_id)
    {
    case PROP_PROVIDER:
      g_assert (object->provider == NULL);
      object->provider = g_value_get_object (value);
      break;

    case PROP_UDISKS_BLOCK:
      g_assert (object->udisks_block == NULL);
      object->udisks_block = g_value_dup_object (value);
      break;

    case PROP_UDISKS_DRIVE:
      g_assert (object->udisks_drive == NULL);
      object->udisks_drive = g_value_dup_object (value);
      break;

    case PROP_UDISKS_MDRAID:
      g_assert (object->udisks_mdraid == NULL);
      object->udisks_mdraid = g_value_dup_object (value);
      break;

    case PROP_UDISKS_VOLUME_GROUP:
      g_assert (object->udisks_volume_group == NULL);
      object->udisks_volume_group = g_value_dup_object (value);
      break;

    case PROP_UDISKS_LOGICAL_VOLUME:
      g_assert (object->udisks_logical_volume == NULL);
      object->udisks_logical_volume = g_value_dup_object (value);
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
storage_object_init (StorageObject *object)
{
}

void
storage_object_update (StorageObject *object)
{
  if (object->udisks_drive != NULL)
    {
      if (object->storage_drive_iface == NULL)
        {
          object->storage_drive_iface = storage_drive_new (object);
          cockpit_object_skeleton_set_storage_drive (COCKPIT_OBJECT_SKELETON (object), object->storage_drive_iface);
        }
      else
        {
          storage_drive_update (STORAGE_DRIVE (object->storage_drive_iface));
        }
    }

  if (object->udisks_block != NULL)
    {
      if (object->storage_block_iface == NULL)
        {
          object->storage_block_iface = storage_block_new (object);
          cockpit_object_skeleton_set_storage_block (COCKPIT_OBJECT_SKELETON (object), object->storage_block_iface);
        }
      else
        {
          storage_block_update (STORAGE_BLOCK (object->storage_block_iface));
        }
      storage_remember_block_configs (object->provider, object->udisks_block);
    }

  if (object->udisks_mdraid != NULL)
    {
      if (object->storage_mdraid_iface == NULL)
        {
          object->storage_mdraid_iface = storage_mdraid_new (object);
          cockpit_object_skeleton_set_storage_mdraid (COCKPIT_OBJECT_SKELETON (object), object->storage_mdraid_iface);
        }
      else
        {
          storage_mdraid_update (STORAGE_MDRAID (object->storage_mdraid_iface));
        }
    }

  if (object->udisks_volume_group != NULL)
    {
      if (object->storage_volume_group_iface == NULL)
        {
          object->storage_volume_group_iface = storage_volume_group_new (object);
          cockpit_object_skeleton_set_storage_volume_group (COCKPIT_OBJECT_SKELETON (object), object->storage_volume_group_iface);
        }
      else
        {
          storage_volume_group_update (STORAGE_VOLUME_GROUP (object->storage_volume_group_iface));
        }
    }

  if (object->udisks_logical_volume != NULL)
    {
      if (object->storage_logical_volume_iface == NULL)
        {
          object->storage_logical_volume_iface = storage_logical_volume_new (object);
          cockpit_object_skeleton_set_storage_logical_volume (COCKPIT_OBJECT_SKELETON (object), object->storage_logical_volume_iface);
        }
      else
        {
          storage_logical_volume_update (STORAGE_LOGICAL_VOLUME (object->storage_logical_volume_iface));
        }
    }
}

static void
storage_object_constructed (GObject *_object)
{
  StorageObject *object = STORAGE_OBJECT (_object);

  /* TODO: listen for changes when we go into the add/remove interfaces as needed */
  storage_object_update (object);

  if (G_OBJECT_CLASS (storage_object_parent_class)->constructed != NULL)
    G_OBJECT_CLASS (storage_object_parent_class)->constructed (_object);
}

static void
storage_object_class_init (StorageObjectClass *klass)
{
  GObjectClass *gobject_class;

  gobject_class = G_OBJECT_CLASS (klass);
  gobject_class->finalize     = storage_object_finalize;
  gobject_class->constructed  = storage_object_constructed;
  gobject_class->set_property = storage_object_set_property;
  gobject_class->get_property = storage_object_get_property;

  /**
   * StorageObject:provider:
   *
   * The #StorageProvider for the object.
   */
  g_object_class_install_property (gobject_class,
                                   PROP_PROVIDER,
                                   g_param_spec_object ("provider",
                                                        NULL,
                                                        NULL,
                                                        TYPE_STORAGE_PROVIDER,
                                                        G_PARAM_READABLE |
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY |
                                                        G_PARAM_STATIC_STRINGS));

  /**
   * StorageObject:udisks-block:
   *
   * The #UDisksBlock for the object.
   */
  g_object_class_install_property (gobject_class,
                                   PROP_UDISKS_BLOCK,
                                   g_param_spec_object ("udisks-block",
                                                        NULL,
                                                        NULL,
                                                        UDISKS_TYPE_BLOCK,
                                                        G_PARAM_READABLE |
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY |
                                                        G_PARAM_STATIC_STRINGS));

  /**
   * StorageObject:udisks-drive:
   *
   * The #UDisksDrive for the object.
   */
  g_object_class_install_property (gobject_class,
                                   PROP_UDISKS_DRIVE,
                                   g_param_spec_object ("udisks-drive",
                                                        NULL,
                                                        NULL,
                                                        UDISKS_TYPE_DRIVE,
                                                        G_PARAM_READABLE |
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY |
                                                        G_PARAM_STATIC_STRINGS));
  /**
   * StorageObject:udisks-drive:
   *
   * The #UDisksMDRaid for the object.
   */
  g_object_class_install_property (gobject_class,
                                   PROP_UDISKS_MDRAID,
                                   g_param_spec_object ("udisks-mdraid",
                                                        NULL,
                                                        NULL,
                                                        UDISKS_TYPE_MDRAID,
                                                        G_PARAM_READABLE |
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY |
                                                        G_PARAM_STATIC_STRINGS));

  /**
   * StorageObject:udisks-volume-group:
   *
   * The #UDisksVolumeGroup for the object.
   */
  g_object_class_install_property (gobject_class,
                                   PROP_UDISKS_VOLUME_GROUP,
                                   g_param_spec_object ("udisks-volume-group",
                                                        NULL,
                                                        NULL,
                                                        UDISKS_TYPE_VOLUME_GROUP,
                                                        G_PARAM_READABLE |
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY |
                                                        G_PARAM_STATIC_STRINGS));
  /**
   * StorageObject:udisks-logical-volume:
   *
   * The #UDisksLogicalVolume for the object.
   */
  g_object_class_install_property (gobject_class,
                                   PROP_UDISKS_LOGICAL_VOLUME,
                                   g_param_spec_object ("udisks-logical-volume",
                                                        NULL,
                                                        NULL,
                                                        UDISKS_TYPE_LOGICAL_VOLUME,
                                                        G_PARAM_READABLE |
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY |
                                                        G_PARAM_STATIC_STRINGS));
}

/**
 * storage_object_new:
 * @provider: A #StorageProvider.
 * @udisks_block: A #UDisksBlock instance or %NULL.
 * @udisks_drive: A #UDisksDrive instance or %NULL.
 *
 * Creates a new #StorageObject instance.
 *
 * Returns: A new #StorageObject. Free with g_object_unref().
 */
StorageObject *
storage_object_new (StorageProvider *provider,
                    UDisksBlock *udisks_block,
                    UDisksDrive *udisks_drive,
                    UDisksMDRaid *udisks_mdraid,
                    UDisksVolumeGroup *udisks_volume_group,
                    UDisksLogicalVolume *udisks_logical_volume)
{
  g_return_val_if_fail (udisks_block == NULL || UDISKS_IS_BLOCK (udisks_block), NULL);
  g_return_val_if_fail (udisks_drive == NULL || UDISKS_IS_DRIVE (udisks_drive), NULL);
  g_return_val_if_fail (udisks_mdraid == NULL || UDISKS_IS_MDRAID (udisks_mdraid), NULL);
  g_return_val_if_fail (udisks_volume_group == NULL || UDISKS_IS_VOLUME_GROUP (udisks_volume_group), NULL);
  g_return_val_if_fail (udisks_logical_volume == NULL || UDISKS_IS_LOGICAL_VOLUME (udisks_logical_volume), NULL);
  return STORAGE_OBJECT (g_object_new (TYPE_STORAGE_OBJECT,
                                       "provider", provider,
                                       "udisks-block", udisks_block,
                                       "udisks-drive", udisks_drive,
                                       "udisks-mdraid", udisks_mdraid,
                                       "udisks-volume-group", udisks_volume_group,
                                       "udisks-logical-volume", udisks_logical_volume,
                                       NULL));
}

StorageProvider *
storage_object_get_provider (StorageObject *object)
{
  g_return_val_if_fail (IS_STORAGE_OBJECT (object), NULL);
  return object->provider;
}

UDisksBlock *
storage_object_get_udisks_block (StorageObject *object)
{
  g_return_val_if_fail (IS_STORAGE_OBJECT (object), NULL);
  return object->udisks_block;
}

UDisksDrive *
storage_object_get_udisks_drive (StorageObject *object)
{
  g_return_val_if_fail (IS_STORAGE_OBJECT (object), NULL);
  return object->udisks_drive;
}

UDisksMDRaid *
storage_object_get_udisks_mdraid (StorageObject *object)
{
  g_return_val_if_fail (IS_STORAGE_OBJECT (object), NULL);
  return object->udisks_mdraid;
}

UDisksVolumeGroup *
storage_object_get_udisks_volume_group (StorageObject *object)
{
  g_return_val_if_fail (IS_STORAGE_OBJECT (object), NULL);
  return object->udisks_volume_group;
}

UDisksLogicalVolume *
storage_object_get_udisks_logical_volume (StorageObject *object)
{
  g_return_val_if_fail (IS_STORAGE_OBJECT (object), NULL);
  return object->udisks_logical_volume;
}

gchar *
storage_object_make_object_path (StorageObject *object)
{
  g_return_val_if_fail (IS_STORAGE_OBJECT (object), NULL);

  if (object->udisks_block)
    {
      /* Avoid leading /dev/ in object path, if possible */
      const gchar *device_file = udisks_block_get_device (object->udisks_block);
      if (g_str_has_prefix (device_file, "/dev/"))
        return utils_generate_object_path ("/com/redhat/Cockpit/Storage/block_devices",
                                           device_file + strlen ("/dev/"));
      else
        return utils_generate_object_path ("/com/redhat/Cockpit/Storage/block_devices", device_file);
    }

  if (object->udisks_drive)
    {
      GString *s = g_string_new (NULL);
      gchar *object_path;
      g_string_append (s, udisks_drive_get_vendor (object->udisks_drive));
      if (s->len > 0)
        g_string_append_c (s, '_');
      g_string_append (s, udisks_drive_get_model (object->udisks_drive));
      if (s->len > 0)
        g_string_append_c (s, '_');
      g_string_append (s, udisks_drive_get_revision (object->udisks_drive));
      if (s->len > 0)
        g_string_append_c (s, '_');
      g_string_append (s, udisks_drive_get_serial (object->udisks_drive));
      object_path = utils_generate_object_path ("/com/redhat/Cockpit/Storage/drives", s->str);
      g_string_free (s, TRUE);
      return object_path;
    }

  if (object->udisks_mdraid)
    {
      return utils_generate_object_path ("/com/redhat/Cockpit/Storage/raids",
                                         udisks_mdraid_get_uuid (object->udisks_mdraid));
    }

  if (object->udisks_volume_group)
    {
      return utils_generate_object_path ("/com/redhat/Cockpit/Storage/lvm",
                                         udisks_volume_group_get_name (object->udisks_volume_group));
    }

  if (object->udisks_logical_volume)
    {
      const gchar *vg_path = udisks_logical_volume_get_volume_group (object->udisks_logical_volume);
      UDisksClient *client = storage_provider_get_udisks_client (object->provider);
      GDBusObjectManager *manager = udisks_client_get_object_manager (client);
      UDisksVolumeGroup *vg =
        UDISKS_VOLUME_GROUP (g_dbus_object_manager_get_interface (manager, vg_path,
                                                                  "org.freedesktop.UDisks2.VolumeGroup"));

      gchar *prefix = utils_generate_object_path ("/com/redhat/Cockpit/Storage/lvm",
                                                  udisks_volume_group_get_name (vg));
      gchar *full = utils_generate_object_path (prefix,
                                                udisks_logical_volume_get_name (object->udisks_logical_volume));
      g_free (prefix);
      return full;
    }

  return NULL;
}

/* ---------------------------------------------------------------------------------------------------- */
