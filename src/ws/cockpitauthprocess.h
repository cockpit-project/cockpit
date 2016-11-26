/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
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

#ifndef __COCKPIT_AUTH_PIPE_H__
#define __COCKPIT_AUTH_PIPE_H__

#include <glib.h>
#include <glib-object.h>
#include <gio/gio.h>
#include <json-glib/json-glib.h>
#include "common/cockpitpipe.h"

G_BEGIN_DECLS

#define            COCKPIT_TYPE_AUTH_PROCESS        (cockpit_auth_process_get_type ())
#define            COCKPIT_AUTH_PROCESS(o)          (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_AUTH_PROCESS, CockpitAuthProcess))

typedef struct      _CockpitAuthProcess             CockpitAuthProcess;
typedef struct      _CockpitAuthProcessClass        CockpitAuthProcessClass;

GType              cockpit_auth_process_get_type    (void) G_GNUC_CONST;

gboolean           cockpit_auth_process_start       (CockpitAuthProcess *self,
                                                     const gchar** command_args,
                                                     const gchar** env,
                                                     gint agent_fd,
                                                     gboolean should_respond,
                                                     GError **error);

void               cockpit_auth_process_terminate   (CockpitAuthProcess *self);


CockpitPipe *      cockpit_auth_process_claim_as_pipe           (CockpitAuthProcess *self);

JsonObject *       cockpit_auth_process_parse_result            (CockpitAuthProcess *self,
                                                                 gchar *response_data,
                                                                 GError **error);

void               cockpit_auth_process_write_auth_bytes        (CockpitAuthProcess *self,
                                                                 GBytes *auth_data);

const gchar *      cockpit_auth_process_get_authenticated_user  (CockpitAuthProcess *self,
                                                                 JsonObject *results,
                                                                 JsonObject **prompt_data,
                                                                 GError **error);

const gchar *      cockpit_auth_process_get_conversation        (CockpitAuthProcess *self);
G_END_DECLS

#endif
