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

#ifndef COCKPIT_BLOCKDEV_MONITOR_H__
#define COCKPIT_BLOCKDEV_MONITOR_H__

#include "types.h"

G_BEGIN_DECLS

#define TYPE_BLOCKDEV_MONITOR  (blockdev_monitor_get_type ())
#define BLOCKDEV_MONITOR(o)    (G_TYPE_CHECK_INSTANCE_CAST ((o), TYPE_BLOCKDEV_MONITOR, BlockdevMonitor))
#define IS_BLOCKDEV_MONITOR(o) (G_TYPE_CHECK_INSTANCE_TYPE ((o), TYPE_BLOCKDEV_MONITOR))

GType                         blockdev_monitor_get_type    (void) G_GNUC_CONST;

CockpitMultiResourceMonitor * blockdev_monitor_new         (GObject *tick_source);

G_END_DECLS

#endif /* COCKPIT_BLOCKDEV_MONITOR_H__ */
