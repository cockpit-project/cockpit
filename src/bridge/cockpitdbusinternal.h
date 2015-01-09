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

#ifndef __COCKPIT_DBUS_INTERNAL_H
#define __COCKPIT_DBUS_INTERNAL_H

#include <gio/gio.h>

G_BEGIN_DECLS

GDBusConnection *     cockpit_dbus_internal_client       (void);

GDBusConnection *     cockpit_dbus_internal_server       (void);

void                  cockpit_dbus_internal_startup      (void);

void                  cockpit_dbus_internal_cleanup      (void);

G_END_DECLS

#endif /* __COCKPIT_DBUS_INTERNAL_H */
