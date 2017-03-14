/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013-2014 Red Hat, Inc.
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

#ifndef __COCKPIT_SSH_SERVICE_H__
#define __COCKPIT_SSH_SERVICE_H__

G_BEGIN_DECLS

#define COCKPIT_TYPE_SSH_SERVICE         (cockpit_ssh_service_get_type ())
#define COCKPIT_SSH_SERVICE(o)           (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_SSH_SERVICE, CockpitSshService))
#define COCKPIT_IS_SSH_SERVICE(o)        (G_TYPE_CHECK_INSTANCE_TYPE ((o), COCKPIT_TYPE_SSH_SERVICE))

typedef struct _CockpitSshService   CockpitSshService;

GType                cockpit_ssh_service_get_type    (void);

CockpitSshService *  cockpit_ssh_service_new         (CockpitTransport *transport);

extern gint cockpit_ssh_specific_port;
extern gint cockpit_ssh_session_timeout;
extern const gchar *cockpit_ssh_known_hosts;
extern const gchar *cockpit_ssh_bridge_program;

G_END_DECLS

#endif /* __COCKPIT_SSH_SERVICE_H__ */
