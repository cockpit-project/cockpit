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

#ifndef __STORAGE_PHYSICAL_VOLUME_H__
#define __STORAGE_PHYSICAL_VOLUME_H__

#include "types.h"

G_BEGIN_DECLS

#define STORAGE_TYPE_PHYSICAL_VOLUME         (storage_physical_volume_get_type ())
#define STORAGE_PHYSICAL_VOLUME(o)           (G_TYPE_CHECK_INSTANCE_CAST ((o), STORAGE_TYPE_PHYSICAL_VOLUME, StoragePhysicalVolume))
#define STORAGE_IS_PHYSICAL_VOLUME(o)        (G_TYPE_CHECK_INSTANCE_TYPE ((o), STORAGE_TYPE_PHYSICAL_VOLUME))

GType                    storage_physical_volume_get_type   (void) G_GNUC_CONST;

StoragePhysicalVolume *  storage_physical_volume_new        (void);

void                     storage_physical_volume_update     (StoragePhysicalVolume *self,
                                                             StorageVolumeGroup *group,
                                                             GVariant *info);

G_END_DECLS

#endif /* __STORAGE_PHYSICAL_VOLUME_H__ */
