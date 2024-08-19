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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

#ifndef COCKPIT_FSWATCH_H__
#define COCKPIT_FSWATCH_H__

#include <gio/gio.h>

#include "common/cockpitchannel.h"

G_BEGIN_DECLS

#define COCKPIT_TYPE_FSWATCH         (cockpit_fswatch_get_type ())

GType              cockpit_fswatch_get_type     (void) G_GNUC_CONST;

CockpitChannel *   cockpit_fswatch_open         (CockpitTransport *transport,
                                                 const gchar *channel_id,
                                                 const gchar *path);

gchar *            cockpit_file_type_to_string  (GFileType file_type);

void
cockpit_fswatch_emit_event (CockpitChannel    *channel,
                            GFile             *file,
                            GFile             *other_file,
                            GFileMonitorEvent  event_type);

#endif /* COCKPIT_FSWATCH_H__ */
