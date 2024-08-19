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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

#ifndef COCKPIT_PACKAGES_H_
#define COCKPIT_PACKAGES_H_

#include <glib.h>
#include "common/cockpitjson.h"

typedef struct _CockpitPackage CockpitPackage;
typedef struct _CockpitPackages CockpitPackages;

CockpitPackages * cockpit_packages_new              (void);

GIOStream *       cockpit_packages_connect          (void);

const gchar *     cockpit_packages_get_checksum     (CockpitPackages *packages);

gchar **          cockpit_packages_get_names        (CockpitPackages *packages);

GList *           cockpit_packages_get_bridges      (CockpitPackages *packages);

gchar *           cockpit_packages_resolve          (CockpitPackages *packages,
                                                     const gchar *name,
                                                     const gchar *path,
                                                     CockpitPackage **package);

void              cockpit_packages_reload           (CockpitPackages *packages);

JsonObject *      cockpit_packages_peek_json        (CockpitPackages *packages);

void              cockpit_packages_dbus_startup     (CockpitPackages *packages);

void              cockpit_packages_on_change        (CockpitPackages *packages,
                                                     void (*callback) (gconstpointer user_data),
                                                     gconstpointer user_data);

void              cockpit_packages_free             (CockpitPackages *packages);

void              cockpit_packages_dump             (void);


#endif /* COCKPIT_PACKAGES_H_ */
