/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2014 Red Hat, Inc.
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

#ifndef COCKPIT_PACKAGES_H_
#define COCKPIT_PACKAGES_H_

#include <glib.h>

typedef struct _CockpitPackage CockpitPackage;
typedef struct _CockpitPackages CockpitPackages;

CockpitPackages * cockpit_packages_new              (void);

const gchar *     cockpit_packages_get_checksum     (CockpitPackages *packages);

gchar **          cockpit_packages_get_names        (CockpitPackages *packages);

gchar *           cockpit_packages_resolve          (CockpitPackages *packages,
                                                     const gchar *name,
                                                     const gchar *path,
                                                     CockpitPackage **package);

void              cockpit_packages_free             (CockpitPackages *packages);

void              cockpit_packages_dump             (void);

#endif /* COCKPIT_PACKAGES_H_ */
