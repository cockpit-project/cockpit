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

#ifndef COCKPIT_CPU_MONITOR_H__
#define COCKPIT_CPU_MONITOR_H__

#include "types.h"

G_BEGIN_DECLS

#define TYPE_CPU_MONITOR  (cpu_monitor_get_type ())
#define CPU_MONITOR(o)    (G_TYPE_CHECK_INSTANCE_CAST ((o), TYPE_CPU_MONITOR, CpuMonitor))
#define IS_CPU_MONITOR(o) (G_TYPE_CHECK_INSTANCE_TYPE ((o), TYPE_CPU_MONITOR))

GType                     cpu_monitor_get_type    (void) G_GNUC_CONST;

CockpitResourceMonitor *  cpu_monitor_new         (Daemon     *daemon);

Daemon *                  cpu_monitor_get_daemon  (CpuMonitor *monitor);

G_END_DECLS

#endif /* COCKPIT_CPU_MONITOR_H__ */
