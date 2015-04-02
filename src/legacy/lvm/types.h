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

#ifndef __STORAGE_TYPES_H__
#define __STORAGE_TYPES_H__

#include "com.redhat.lvm2.h"

G_BEGIN_DECLS

typedef struct _StorageBlock          StorageBlock;
typedef struct _StorageLogicalVolume  StorageLogicalVolume;
typedef struct _StoragePhysicalVolume StoragePhysicalVolume;
typedef struct _StorageVolumeGroup    StorageVolumeGroup;
typedef struct _StorageDaemon         StorageDaemon;
typedef struct _StorageManager        StorageManager;
typedef struct _StorageJob            StorageJob;
typedef struct _StorageSpawnedJob     StorageSpawnedJob;
typedef struct _StorageThreadedJob    StorageThreadedJob;

G_END_DECLS

#endif /* __STORAGE_DAEMON_H__ */
