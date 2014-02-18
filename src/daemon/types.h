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

#ifndef COCKPIT_TYPES_H_A8D7FA297F874F028A7054AB3489F6E2
#define COCKPIT_TYPES_H_A8D7FA297F874F028A7054AB3489F6E2

#include <glib-unix.h>
#include <gio/gio.h>

#define UDISKS_API_IS_SUBJECT_TO_CHANGE
#include <udisks/udisks.h>

#include <cockpit/cockpit.h>
#include "com.redhat.lvm2.h"

struct Daemon;
typedef struct Daemon Daemon;

struct Manager;
typedef struct Manager Manager;

struct Machines;
typedef struct Machines Machines;

struct Machine;
typedef struct Machine Machine;

struct CpuMonitor;
typedef struct CpuMonitor CpuMonitor;

struct Network;
typedef struct Network Network;

struct Netinterface;
typedef struct Netinterface Netinterface;

struct MemoryMonitor;
typedef struct MemoryMonitor MemoryMonitor;

struct NetworkMonitor;
typedef struct NetworkMonitor NetworkMonitor;

struct DiskIOMonitor;
typedef struct DiskIOMonitor DiskIOMonitor;

struct StorageManager;
typedef struct StorageManager StorageManager;

struct StorageProvider;
typedef struct StorageProvider StorageProvider;

struct StorageObject;
typedef struct StorageObject StorageObject;

struct StorageBlock;
typedef struct StorageBlock StorageBlock;

struct StorageDrive;
typedef struct StorageDrive StorageDrive;

struct StorageMDRaid;
typedef struct StorageMDRaid StorageMDRaid;

struct StorageVolumeGroup;
typedef struct StorageVolumeGroup StorageVolumeGroup;

struct StorageLogicalVolume;
typedef struct StorageLogicalVolume StorageLogicalVolume;

struct StorageJob;
typedef struct StorageJob StorageJob;

struct Realms;
typedef struct Realms Realms;

struct Services;
typedef struct Services Services;

struct Journal;
typedef struct Journal Journal;

struct Accounts;
typedef struct Accounts Accounts;

struct Account;
typedef struct Account Account;

#endif /* COCKPIT_TYPES_H__ */
