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

#ifndef COCKPIT_PACKAGE_H_
#define COCKPIT_PACKAGE_H_

#include <glib.h>

#include <json-glib/json-glib.h>

GHashTable *      cockpit_package_listing            (JsonObject **listing);

gchar *           cockpit_package_resolve            (GHashTable *mapping,
                                                      const gchar *package,
                                                      const gchar *path);

void              cockpit_package_expand             (GHashTable *mapping,
                                                      const gchar *host,
                                                      GBytes *input,
                                                      GQueue *output);

#endif /* COCKPIT_PACKAGE_H_ */
