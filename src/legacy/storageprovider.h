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

#ifndef COCKPIT_STORAGE_PROVIDER_H__
#define COCKPIT_STORAGE_PROVIDER_H__

#include "types.h"
#include "udisksclient.h"

G_BEGIN_DECLS

#define TYPE_STORAGE_PROVIDER   (storage_provider_get_type ())
#define STORAGE_PROVIDER(o)     (G_TYPE_CHECK_INSTANCE_CAST ((o), TYPE_STORAGE_PROVIDER, StorageProvider))
#define IS_STORAGE_PROVIDER(o)  (G_TYPE_CHECK_INSTANCE_TYPE ((o), TYPE_STORAGE_PROVIDER))

GType             storage_provider_get_type                          (void) G_GNUC_CONST;

StorageProvider * storage_provider_new                               (Daemon *daemon);

Daemon *          storage_provider_get_daemon                        (StorageProvider *provider);

UDisksClient *    storage_provider_get_udisks_client                 (StorageProvider *provider);
GDBusObjectManager* storage_provider_get_lvm_object_manager          (StorageProvider *provider);

StorageObject*    storage_provider_lookup_for_udisks_block           (StorageProvider *provider,
                                                                      UDisksBlock *udisks_block);

StorageObject*    storage_provider_lookup_for_udisks_drive           (StorageProvider *provider,
                                                                      UDisksDrive *udisks_drive);

StorageObject*    storage_provider_lookup_for_udisks_mdraid          (StorageProvider *provider,
                                                                      UDisksMDRaid *udisks_mdraid);

StorageObject*    storage_provider_lookup_for_lvm_volume_group       (StorageProvider *provider,
                                                                      LvmVolumeGroup *lvm_volume_group);

StorageObject *   storage_provider_lookup_for_lvm_logical_volume     (StorageProvider *provider,
                                                                      LvmLogicalVolume *lvm_logical_volume);

const gchar *     storage_provider_translate_path                    (StorageProvider *provider,
                                                                      const gchar *udisks_path);

void              storage_provider_remember_config                   (StorageProvider *provider,
                                                                      const gchar *parent_path,
                                                                      const gchar *child_path,
                                                                      GVariant *config);

void              storage_provider_load_remembered_configs           (StorageProvider *provider);

void              storage_provider_save_remembered_configs           (StorageProvider *provider);

GList *           storage_provider_get_and_forget_remembered_configs (StorageProvider *provider,
                                                                      const gchar *parent_path);

G_END_DECLS

#endif /* COCKPIT_STORAGE_PROVIDER_H__ */
