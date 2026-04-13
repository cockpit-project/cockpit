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

#ifndef COCKPIT_SESSION_CONTROL_CHANNEL_H__
#define COCKPIT_SESSION_CONTROL_CHANNEL_H__

#include "common/cockpitchannel.h"

G_BEGIN_DECLS

#define COCKPIT_TYPE_SESSION_CONTROL_CHANNEL         (cockpit_session_control_channel_get_type ())

GType              cockpit_session_control_channel_get_type     (void) G_GNUC_CONST;

#endif /* COCKPIT_SESSION_CONTROL_CHANNEL_H__ */