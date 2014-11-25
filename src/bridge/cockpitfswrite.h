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

#ifndef COCKPIT_FSWRITE_H__
#define COCKPIT_FSWRITE_H__

#include <gio/gio.h>

#include "cockpitchannel.h"

G_BEGIN_DECLS

#define COCKPIT_TYPE_FSWRITE         (cockpit_fswrite_get_type ())

GType              cockpit_fswrite_get_type     (void) G_GNUC_CONST;

CockpitChannel *   cockpit_fswrite_open         (CockpitTransport *transport,
                                                 const gchar *channel_id,
                                                 const gchar *path,
                                                 const gchar *tag);

#endif /* COCKPIT_FSWRITE_H__ */
