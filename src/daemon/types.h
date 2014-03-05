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

#ifndef COCKPIT_TYPES_H_
#define COCKPIT_TYPES_H_

#include <glib-unix.h>
#include <gio/gio.h>

#define UDISKS_API_IS_SUBJECT_TO_CHANGE
#include <udisks/udisks.h>

#include <cockpit/cockpit.h>
#include "com.redhat.lvm2.h"

struct Daemon_;
typedef struct Daemon_ Daemon;

struct Manager_;
typedef struct Manager_ Manager;

struct Machines_;
typedef struct Machines_ Machines;

struct Machine_;
typedef struct Machine_ Machine;

struct CpuMonitor_;
typedef struct CpuMonitor_ CpuMonitor;

struct Network_;
typedef struct Network_ Network;

struct Netinterface_;
typedef struct Netinterface_ Netinterface;

struct MemoryMonitor;
typedef struct MemoryMonitor_ MemoryMonitor;

struct NetworkMonitor_;
typedef struct NetworkMonitor_ NetworkMonitor;

struct DiskIOMonitor_;
typedef struct DiskIOMonitor_ DiskIOMonitor;

struct StorageManager_;
typedef struct StorageManager_ StorageManager;

struct StorageProvider_;
typedef struct StorageProvider_ StorageProvider;

struct StorageObject_;
typedef struct StorageObject_ StorageObject;

struct StorageBlock_;
typedef struct StorageBlock_ StorageBlock;

struct StorageDrive_;
typedef struct StorageDrive_ StorageDrive;

struct StorageMDRaid_;
typedef struct StorageMDRaid_ StorageMDRaid;

struct StorageVolumeGroup_;
typedef struct StorageVolumeGroup_ StorageVolumeGroup;

struct StorageLogicalVolume_;
typedef struct StorageLogicalVolume_ StorageLogicalVolume;

struct StorageJob_;
typedef struct StorageJob_ StorageJob;

struct Realms_;
typedef struct Realms_ Realms;

struct Services_;
typedef struct Services_ Services;

struct Journal_;
typedef struct Journal_ Journal;

struct Accounts_;
typedef struct Accounts_ Accounts;

struct Account_;
typedef struct Account_ Account;

#endif /* COCKPIT_TYPES_H_ */
