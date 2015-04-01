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

#ifndef COCKPIT_STORAGE_MDRAID_H__
#define COCKPIT_STORAGE_MDRAID_H__

#include "types.h"

G_BEGIN_DECLS

#define TYPE_STORAGE_MDRAID  (storage_mdraid_get_type ())
#define STORAGE_MDRAID(o)    (G_TYPE_CHECK_INSTANCE_CAST ((o), TYPE_STORAGE_MDRAID, StorageMDRaid))
#define IS_STORAGE_MDRAID(o) (G_TYPE_CHECK_INSTANCE_TYPE ((o), TYPE_STORAGE_MDRAID))

GType                   storage_mdraid_get_type    (void) G_GNUC_CONST;

CockpitStorageMDRaid *  storage_mdraid_new         (StorageObject *object);

void                    storage_mdraid_update      (StorageMDRaid  *mdraid);

G_END_DECLS

#endif /* COCKPIT_STORAGE_MDRAID_H__ */
