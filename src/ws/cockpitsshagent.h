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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

#ifndef __COCKPIT_SSH_AGENT_H__
#define __COCKPIT_SSH_AGENT_H__

#include <glib.h>
#include <glib-object.h>

#include "common/cockpittransport.h"

G_BEGIN_DECLS

#define            COCKPIT_TYPE_SSH_AGENT        (cockpit_ssh_agent_get_type ())

typedef struct _CockpitSshAgent        CockpitSshAgent;
typedef struct _CockpitSshAgentClass   CockpitSshAgentClass;

GType              cockpit_ssh_agent_get_type (void) G_GNUC_CONST;

CockpitSshAgent *  cockpit_ssh_agent_new      (CockpitTransport *transport,
                                               const gchar *logname,
                                               const gchar *channel_id);

void               cockpit_ssh_agent_close    (CockpitSshAgent *agent);

int                cockpit_ssh_agent_steal_fd (CockpitSshAgent *agent);
G_END_DECLS

#endif
