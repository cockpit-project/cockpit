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

#ifndef COCKPIT_DISK_IO_MONITOR_H__
#define COCKPIT_DISK_IO_MONITOR_H__

#include "types.h"

G_BEGIN_DECLS

#define TYPE_DISK_IO_MONITOR  (disk_io_monitor_get_type ())
#define DISK_IO_MONITOR(o)    (G_TYPE_CHECK_INSTANCE_CAST ((o), TYPE_DISK_IO_MONITOR, DiskIOMonitor))
#define IS_DISK_IO_MONITOR(o) (G_TYPE_CHECK_INSTANCE_TYPE ((o), TYPE_DISK_IO_MONITOR))

GType                     disk_io_monitor_get_type   (void) G_GNUC_CONST;

CockpitResourceMonitor *  disk_io_monitor_new        (Daemon *daemon);

Daemon *                  disk_io_monitor_get_daemon (DiskIOMonitor *monitor);

G_END_DECLS

#endif /* COCKPIT_DISK_IO_MONITOR_H__ */
