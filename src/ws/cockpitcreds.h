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

#ifndef __COCKPIT_CREDS_H__
#define __COCKPIT_CREDS_H__

#include <glib.h>
#include <glib-object.h>

G_BEGIN_DECLS

typedef struct _CockpitCreds       CockpitCreds;

#define         COCKPIT_TYPE_CREDS           (cockpit_creds_get_type ())

GType           cockpit_creds_get_type       (void) G_GNUC_CONST;

CockpitCreds *  cockpit_creds_new_password   (const gchar *user,
                                              const gchar *password);

CockpitCreds *  cockpit_creds_ref            (CockpitCreds *creds);

void            cockpit_creds_unref          (gpointer creds);

const gchar *   cockpit_creds_get_user       (CockpitCreds *creds);

const gchar *   cockpit_creds_get_password   (CockpitCreds *creds);

G_END_DECLS

#endif
