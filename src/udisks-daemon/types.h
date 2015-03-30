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

#ifndef COCKPIT_TYPES_H__
#define COCKPIT_TYPES_H__

#include <glib-unix.h>
#include <gio/gio.h>

#define UDISKS_API_IS_SUBJECT_TO_CHANGE
#include <udisks/udisks.h>

#include "common/cockpittypes.h"
#include "common/cockpitenums.h"
#include "common/cockpiterror.h"
#include "common/cockpitlog.h"

#include "cockpit-udisks-generated.h"
#include "com.redhat.lvm2.h"

#include <stdint.h>
#include <string.h>

struct _Daemon;
typedef struct _Daemon Daemon;

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

#endif /* COCKPIT_TYPES_H__ */
