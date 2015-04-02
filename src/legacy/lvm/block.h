/* -*- mode: C; c-file-style: "gnu"; indent-tabs-mode: nil; -*-
 *
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

#ifndef __STORAGE_BLOCK_OBJECT_H__
#define __STORAGE_BLOCK_OBJECT_H__

#include <gio/gio.h>

#include <gudev/gudev.h>

#include "types.h"

G_BEGIN_DECLS

#define STORAGE_TYPE_BLOCK         (storage_block_get_type ())
#define STORAGE_BLOCK(o)           (G_TYPE_CHECK_INSTANCE_CAST ((o), STORAGE_TYPE_BLOCK, StorageBlock))
#define STORAGE_IS_BLOCK(o)        (G_TYPE_CHECK_INSTANCE_TYPE ((o), STORAGE_TYPE_BLOCK))

GType              storage_block_get_type         (void) G_GNUC_CONST;

const gchar *      storage_block_get_object_path  (StorageBlock *self);

GUdevDevice *      storage_block_get_udev         (StorageBlock *self);

const gchar *      storage_block_get_device       (StorageBlock *self);

const gchar **     storage_block_get_symlinks     (StorageBlock *self);

const gchar *      storage_block_get_id_type      (StorageBlock *self);

const gchar *      storage_block_get_id_usage     (StorageBlock *self);

const gchar *      storage_block_get_id_version   (StorageBlock *self);

const gchar *      storage_block_get_id_label     (StorageBlock *self);

const gchar *      storage_block_get_id_uuid      (StorageBlock *self);

void               storage_block_trigger_uevent   (StorageBlock *self);

gboolean           storage_block_is_unused        (StorageBlock *self,
                                                   GError **error);

void               storage_block_update_lv        (StorageBlock *self,
                                                   StorageLogicalVolume *lv);

void               storage_block_update_pv        (StorageBlock *self,
                                                   StorageVolumeGroup *group,
                                                   GVariant *pv_info);

LvmLogicalVolumeBlock  *  storage_block_get_logical_volume_block   (StorageBlock *self);

LvmPhysicalVolumeBlock *  storage_block_get_physical_volume_block  (StorageBlock *self);

G_END_DECLS

#endif /* __STORAGE_BLOCK_OBJECT_H__ */
