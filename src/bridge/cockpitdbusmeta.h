/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
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

#ifndef COCKPIT_DBUS_META_H__
#define COCKPIT_DBUS_META_H__

#include <gio/gio.h>
#include <json-glib/json-glib.h>

G_BEGIN_DECLS

JsonObject *             cockpit_dbus_meta_build     (GDBusInterfaceInfo *iface);

GDBusInterfaceInfo *     cockpit_dbus_meta_parse     (const gchar *iface_name,
                                                      JsonObject *interface,
                                                      GError **error);

G_END_DECLS

#endif /* COCKPIT_DBUS_META_H__ */
