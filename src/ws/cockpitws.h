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

#ifndef __COCKPIT_WS_H__
#define __COCKPIT_WS_H__

#include <gio/gio.h>

G_BEGIN_DECLS

#include <cockpitwstypes.h>
#include <cockpitwsenumtypes.h>
#include <cockpitwebserver.h>
#include <cockpitwebsocket.h>
#include <cockpitauth.h>

/* Some tunables that can be set from tests. See cockpitwebsocket.c */
extern const gchar *cockpit_ws_session_program;
extern const gchar *cockpit_ws_agent_program;
extern const gchar *cockpit_ws_known_hosts;
extern gint cockpit_ws_specific_ssh_port;

G_END_DECLS

#endif /* __COCKPIT_WS_H__ */
