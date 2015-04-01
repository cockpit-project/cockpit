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

#ifndef COCKPIT_STORAGE_OBJECT_H__
#define COCKPIT_STORAGE_OBJECT_H__

#include "types.h"

G_BEGIN_DECLS

#define TYPE_STORAGE_OBJECT  (storage_object_get_type ())
#define STORAGE_OBJECT(o)    (G_TYPE_CHECK_INSTANCE_CAST ((o), TYPE_STORAGE_OBJECT, StorageObject))
#define IS_STORAGE_OBJECT(o) (G_TYPE_CHECK_INSTANCE_TYPE ((o), TYPE_STORAGE_OBJECT))

GType                 storage_object_get_type                   (void) G_GNUC_CONST;

StorageObject *       storage_object_new                        (StorageProvider *provider,
                                                                 UDisksBlock *udisks_block,
                                                                 UDisksDrive *udisks_drive,
                                                                 UDisksMDRaid *udisks_raid,
                                                                 LvmVolumeGroup *lvm_volume_group,
                                                                 LvmLogicalVolume *lvm_logical_volume);

StorageProvider *      storage_object_get_provider              (StorageObject *object);

UDisksBlock *          storage_object_get_udisks_block          (StorageObject *object);

UDisksDrive *          storage_object_get_udisks_drive          (StorageObject *object);

UDisksMDRaid *         storage_object_get_udisks_mdraid         (StorageObject *object);

LvmVolumeGroup *       storage_object_get_lvm_volume_group      (StorageObject *object);

LvmLogicalVolume *     storage_object_get_lvm_logical_volume    (StorageObject *object);

void                   storage_object_update                    (StorageObject *object);

gchar *                storage_object_make_object_path          (StorageObject *object);

G_END_DECLS

#endif /* COCKPIT_STORAGE_OBJECT_H__ */
