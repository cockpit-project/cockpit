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

#ifndef __STORAGE_MANAGER_H__
#define __STORAGE_MANAGER_H__

#include "daemon.h"
#include "volumegroup.h"

G_BEGIN_DECLS

#define STORAGE_TYPE_MANAGER         (storage_manager_get_type ())
#define STORAGE_MANAGER(o)           (G_TYPE_CHECK_INSTANCE_CAST ((o), STORAGE_TYPE_MANAGER, StorageManager))
#define STORAGE_IS_MANAGER(o)        (G_TYPE_CHECK_INSTANCE_TYPE ((o), STORAGE_TYPE_MANAGER))

GType                  storage_manager_get_type            (void) G_GNUC_CONST;

void                   storage_manager_new_async           (GAsyncReadyCallback callback,
                                                            gpointer user_data);

StorageManager        *storage_manager_new_finish          (GObject *source,
                                                            GAsyncResult *res);

StorageVolumeGroup *   storage_manager_find_volume_group   (StorageManager *self,
                                                            const gchar *name);

GList *                storage_manager_get_blocks          (StorageManager *self);

StorageBlock *         storage_manager_find_block          (StorageManager *self,
                                                            const gchar *udisks_path);

G_END_DECLS

#endif /* __STORAGE_MANAGER_H__ */
