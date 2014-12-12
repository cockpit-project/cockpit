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

#ifndef COCKPIT_MACHINES_H__
#define COCKPIT_MACHINES_H__

#include <gio/gio.h>

#include "internal-generated.h"
#include "machine.h"

G_BEGIN_DECLS

#define COCKPIT_TYPE_DAEMON_MACHINES  (machines_get_type ())
#define MACHINES(o)          (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_DAEMON_MACHINES, Machines))
#define COCKPIT_IS_DAEMON_MACHINES(o) (G_TYPE_CHECK_INSTANCE_TYPE ((o), COCKPIT_TYPE_DAEMON_MACHINES))

GType             machines_get_type    (void) G_GNUC_CONST;

CockpitMachines * machines_new         (GDBusObjectManagerServer *object_manager);

gboolean          machines_write       (Machines *machines, GError **error);

G_END_DECLS

#endif /* COCKPIT_MACHINES_H__ */
