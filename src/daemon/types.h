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

#ifndef __TYPES_H__
#define __TYPES_H__

#include <glib-unix.h>
#include <gio/gio.h>

#define UDISKS_API_IS_SUBJECT_TO_CHANGE
#include <udisks/udisks.h>

#include <cockpit/cockpit.h>

struct _Daemon;
typedef struct _Daemon Daemon;

struct _Manager;
typedef struct _Manager Manager;

struct _Machines;
typedef struct _Machines Machines;

struct _Machine;
typedef struct _Machine Machine;

struct _CpuMonitor;
typedef struct _CpuMonitor CpuMonitor;

struct _Network;
typedef struct _Network Network;

struct _Netinterface;
typedef struct _Netinterface Netinterface;

struct _MemoryMonitor;
typedef struct _MemoryMonitor MemoryMonitor;

struct _NetworkMonitor;
typedef struct _NetworkMonitor NetworkMonitor;

struct _DiskIOMonitor;
typedef struct _DiskIOMonitor DiskIOMonitor;

struct _StorageManager;
typedef struct _StorageManager StorageManager;

struct _StorageProvider;
typedef struct _StorageProvider StorageProvider;

struct _StorageObject;
typedef struct _StorageObject StorageObject;

struct _StorageBlock;
typedef struct _StorageBlock StorageBlock;

struct _StorageDrive;
typedef struct _StorageDrive StorageDrive;

struct _StorageMDRaid;
typedef struct _StorageMDRaid StorageMDRaid;

struct _StorageVolumeGroup;
typedef struct _StorageVolumeGroup StorageVolumeGroup;

struct _StorageLogicalVolume;
typedef struct _StorageLogicalVolume StorageLogicalVolume;

struct _StorageJob;
typedef struct _StorageJob StorageJob;

struct _Realms;
typedef struct _Realms Realms;

struct _Services;
typedef struct _Services Services;

struct _Journal;
typedef struct _Journal Journal;

struct _Accounts;
typedef struct _Accounts Accounts;

struct _Account;
typedef struct _Account Account;

#endif /* __TYPES_H__ */
