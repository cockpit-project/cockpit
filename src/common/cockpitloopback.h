/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
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

#ifndef __COCKPIT_LOOPBACK_H__
#define __COCKPIT_LOOPBACK_H__

#include <gio/gio.h>

G_BEGIN_DECLS

#define COCKPIT_TYPE_LOOPBACK         (cockpit_loopback_get_type ())
G_DECLARE_FINAL_TYPE(CockpitLoopback, cockpit_loopback, COCKPIT, LOOPBACK, GSocketAddressEnumerator)

GSocketConnectable *  cockpit_loopback_new          (guint16 port);

G_END_DECLS

#endif /* __COCKPIT_LOOPBACK_H__ */
