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

#ifndef __STORAGE_VOLUME_GROUP_H__
#define __STORAGE_VOLUME_GROUP_H__

#include "types.h"

G_BEGIN_DECLS

#define STORAGE_TYPE_VOLUME_GROUP         (storage_volume_group_get_type ())
#define STORAGE_VOLUME_GROUP(o)           (G_TYPE_CHECK_INSTANCE_CAST ((o), STORAGE_TYPE_VOLUME_GROUP, StorageVolumeGroup))
#define STORAGE_IS_VOLUME_GROUP(o)        (G_TYPE_CHECK_INSTANCE_TYPE ((o), STORAGE_TYPE_VOLUME_GROUP))

typedef void StorageVolumeGroupCallback (StorageVolumeGroup *self,
                                         gpointer user_data);

GType                   storage_volume_group_get_type            (void) G_GNUC_CONST;

StorageVolumeGroup *    storage_volume_group_new                 (StorageManager *manager,
                                                                  const gchar *name);

const gchar *           storage_volume_group_get_name            (StorageVolumeGroup *self);

const gchar *           storage_volume_group_get_object_path     (StorageVolumeGroup *self);

void                    storage_volume_group_update              (StorageVolumeGroup *self,
                                                                  gboolean ignore_locks,
                                                                  StorageVolumeGroupCallback *done,
                                                                  gpointer done_user_data);

void                    storage_volume_group_poll                (StorageVolumeGroup *self);

StorageLogicalVolume *  storage_volume_group_find_logical_volume (StorageVolumeGroup *self,
                                                                  const gchar *name);

void                    storage_volume_group_update_block        (StorageVolumeGroup *self,
                                                                  StorageBlock *block);

G_END_DECLS

#endif /* __STORAGE_VOLUME_GROUP_H__ */
