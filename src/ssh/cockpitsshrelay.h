/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
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

#ifndef __COCKPIT_SSH_RELAY_H__
#define __COCKPIT_SSH_RELAY_H__

#include <glib.h>
#include <glib-object.h>

G_BEGIN_DECLS

/* EXIT CODE CONSTANTS */
#define INTERNAL_ERROR 1
#define AUTHENTICATION_FAILED 2
#define DISCONNECTED 254
#define TERMINATED 255
#define NO_COCKPIT 127

#define            COCKPIT_TYPE_SSH_RELAY       (cockpit_ssh_relay_get_type ())

typedef struct _CockpitSshRelay                  CockpitSshRelay;
typedef struct _CockpitSshRelay                  CockpitSshRelayClass;

GType                   cockpit_ssh_relay_get_type     (void) G_GNUC_CONST;

CockpitSshRelay *       cockpit_ssh_relay_new          (const gchar *connection_string);

gint                    cockpit_ssh_relay_result       (CockpitSshRelay* self);

G_END_DECLS

#endif
