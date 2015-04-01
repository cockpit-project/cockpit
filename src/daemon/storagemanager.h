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

#ifndef COCKPIT_STORAGE_MANAGER_H__
#define COCKPIT_STORAGE_MANAGER_H__

#include "types.h"
#include "org.freedesktop.UDisks2.h"

G_BEGIN_DECLS

#define TYPE_STORAGE_MANAGER   (storage_manager_get_type ())
#define STORAGE_MANAGER(o)     (G_TYPE_CHECK_INSTANCE_CAST ((o), TYPE_STORAGE_MANAGER, StorageManager))
#define IS_STORAGE_MANAGER(o)  (G_TYPE_CHECK_INSTANCE_TYPE ((o), TYPE_STORAGE_MANAGER))

GType                    storage_manager_get_type          (void) G_GNUC_CONST;

CockpitStorageManager *  storage_manager_new               (Daemon *daemon);

Daemon *                 storage_manager_get_daemon        (StorageManager *storage_manager);

// Utility functions

/* These clean up block device etc before they are used for something
   else.  Specifically:

   - Any entries in fstab and crpyttab that refer to it are removed.

   - If this device contains a partition table, then all contained
     partitions are cleaned up as well.

   - If this device is encrypted, then the corresponding cleartext
     device is cleaned up, and this device is locked so that it is no
     longer in use.

   - Snapshots of logical volumes are cleaned up.

   - Thin volumes belonging to a thin pool are cleaned up.

   - Logical volumes of a volume group are cleaned up.

   - Systemd is reloaded so that it re-syncs itself with the modified
     fstab and crypttab.

   The functions also check whether any of the block devices etc that
   are to be cleaned are in active use before making any changes.
*/

gboolean   storage_remove_fstab_config      (UDisksBlock *block,
                                             GError **error);

gboolean   storage_remove_crypto_config     (UDisksBlock *block,
                                             GError **error);

gboolean   storage_cleanup_block            (StorageProvider *provider,
                                             UDisksBlock *block,
                                             GError **error);

gboolean   storage_cleanup_logical_volume   (StorageProvider *provider,
                                             LvmLogicalVolume *volume,
                                             GError **error);

gboolean   storage_cleanup_volume_group     (StorageProvider *provider,
                                             LvmVolumeGroup *group,
                                             GError **error);

void       storage_remember_block_configs   (StorageProvider *provider,
                                             UDisksBlock *block);

G_END_DECLS

#endif /* COCKPIT_STORAGE_MANAGER_H__ */
