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

#ifndef COCKPIT_LVM_UTIL_H__
#define COCKPIT_LVM_UTIL_H__

#include "types.h"
#include "udisksclient.h"

G_BEGIN_DECLS

LvmVolumeGroup *lvm_util_get_volume_group_for_logical_volume (GDBusObjectManager *objman,
                                                              LvmLogicalVolume *vol);

GList *lvm_util_get_logical_volumes_for_volume_group (GDBusObjectManager *objman,
                                                      LvmVolumeGroup *group);

UDisksBlock *lvm_util_peek_block_for_logical_volume (GDBusObjectManager *objman,
                                                     UDisksClient *client,
                                                     LvmLogicalVolume *logical_volume);

G_END_DECLS

#endif /* COCKPIT_LVM_UTIL_H__ */
