/* -*- mode: C; c-file-style: "gnu"; indent-tabs-mode: nil; -*-
 *
 * Copyright (C) 2007-2010 David Zeuthen <zeuthen@gmail.com>
 * Copyright (C) 2013-2014 Red Hat, Inc.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin St, Fifth Floor, Boston, MA  02110-1301  USA
 *
 */

#include "config.h"

#include "daemon.h"
#include "physicalvolume.h"
#include "volumegroup.h"
#include "util.h"

#include <glib/gi18n-lib.h>

/**
 * SECTION:storagephysicalvolume
 * @title: StoragePhysicalVolume
 * @short_description: Linux implementation of #LvmPhysicalVolumeBlock
 *
 * This type provides an implementation of the #LvmPhysicalVolumeBlock
 * interface on Linux.
 */

typedef struct _StoragePhysicalVolumeClass   StoragePhysicalVolumeClass;

/**
 * StoragePhysicalVolume:
 *
 * The #StoragePhysicalVolume structure contains only private data and should
 * only be accessed using the provided API.
 */
struct _StoragePhysicalVolume
{
  LvmPhysicalVolumeBlockSkeleton parent_instance;
};

struct _StoragePhysicalVolumeClass
{
  LvmPhysicalVolumeBlockSkeletonClass parent_class;
};

static void physical_volume_iface_init (LvmPhysicalVolumeBlockIface *iface);

G_DEFINE_TYPE_WITH_CODE (StoragePhysicalVolume, storage_physical_volume,
                         LVM_TYPE_PHYSICAL_VOLUME_BLOCK_SKELETON,
                         G_IMPLEMENT_INTERFACE (LVM_TYPE_PHYSICAL_VOLUME_BLOCK, physical_volume_iface_init));

/* ---------------------------------------------------------------------------------------------------- */

static void
storage_physical_volume_init (StoragePhysicalVolume *self)
{

}

static void
storage_physical_volume_class_init (StoragePhysicalVolumeClass *klass)
{

}

/**
 * storage_physical_volume_new:
 *
 * Creates a new #StoragePhysicalVolume instance.
 *
 * Returns: A new #StoragePhysicalVolume. Free with g_object_unref().
 */
StoragePhysicalVolume *
storage_physical_volume_new (void)
{
  return g_object_new (STORAGE_TYPE_PHYSICAL_VOLUME, NULL);
}

/* ---------------------------------------------------------------------------------------------------- */

/**
 * storage_physical_volume_update:
 * @physical_volume: A #StoragePhysicalVolume.
 * @object: The enclosing #StorageBlockObject instance.
 *
 * Updates the interface.
 */
void
storage_physical_volume_update (StoragePhysicalVolume *self,
                                StorageVolumeGroup *group,
                                GVariant *info)
{
  LvmPhysicalVolumeBlock *iface;
  guint64 num;

  iface = LVM_PHYSICAL_VOLUME_BLOCK (self);

  lvm_physical_volume_block_set_volume_group (iface, storage_volume_group_get_object_path (group));

  if (g_variant_lookup (info, "size", "t", &num))
    lvm_physical_volume_block_set_size (iface, num);

  if (g_variant_lookup (info, "free-size", "t", &num))
    lvm_physical_volume_block_set_free_size (iface, num);
}

/* ---------------------------------------------------------------------------------------------------- */

static void
physical_volume_iface_init (LvmPhysicalVolumeBlockIface *iface)
{
}
