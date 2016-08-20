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

G_BEGIN_DECLS

#define            COCKPIT_TYPE_AUTH_PIPE        (cockpit_auth_pipe_get_type ())
#define            COCKPIT_AUTH_PIPE(o)          (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_AUTH_PIPE, CockpitAuthPipe))

typedef struct _CockpitAuthPipe        CockpitAuthPipe;
typedef struct _CockpitAuthPipeClass   CockpitAuthPipeClass;

GType              cockpit_auth_pipe_get_type (void) G_GNUC_CONST;

const gchar *      cockpit_auth_pipe_get_id   (CockpitAuthPipe *self);

void               cockpit_auth_pipe_close    (CockpitAuthPipe *auth_pipe,
                                               const gchar *problem);

int                cockpit_auth_pipe_steal_fd (CockpitAuthPipe *auth_pipe);

void               cockpit_auth_pipe_answer   (CockpitAuthPipe *auth_pipe,
                                               GBytes *auth_data);

void               cockpit_auth_pipe_expect_answer (CockpitAuthPipe *self);
G_END_DECLS

#endif
