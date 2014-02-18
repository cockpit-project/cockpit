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

#ifndef COCKPIT_MACHINE_H_631E03962695406D8FD846A5010DE2C5
#define COCKPIT_MACHINE_H_631E03962695406D8FD846A5010DE2C5

#include "types.h"

G_BEGIN_DECLS

#define COCKPIT_TYPE_DAEMON_MACHINE  (machine_get_type ())
#define MACHINE(o)                   (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_DAEMON_MACHINE, Machine))
#define COCKPIT_IS_DAEMON_MACHINE(o) (G_TYPE_CHECK_INSTANCE_TYPE ((o), COCKPIT_TYPE_DAEMON_MACHINE))

GType             machine_get_type    (void) G_GNUC_CONST;

CockpitMachine *  machine_new         (Daemon  *daemon, const gchar *id);

Daemon *          machine_get_daemon  (Machine *machine);

void              machine_read        (Machine *machine, GKeyFile *file, const gchar *group);
void              machine_write       (Machine *machine, GKeyFile *file);
void              machine_export      (Machine *machine);
void              machine_unexport    (Machine *machine);

G_END_DECLS

#endif /* COCKPIT_MACHINE_H__ */
