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

#pragma once

#include <gio/gio.h>

G_BEGIN_DECLS

#define COCKPIT_TYPE_PASSWORD_INTERACTION         (cockpit_password_interaction_get_type ())
#define COCKPIT_PASSWORD_INTERACTION(o)           (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_PASSWORD_INTERACTION, CockpitPasswordInteraction))
#define COCKPIT_PASSWORD_INTERACTION_CLASS(k)     (G_TYPE_CHECK_CLASS_CAST((k), COCKPIT_TYPE_PASSWORD_INTERACTION, CockpitPasswordInteractionClass))
#define COCKPIT_IS_PASSWORD_INTERACTION(o)        (G_TYPE_CHECK_INSTANCE_TYPE ((o), COCKPIT_TYPE_PASSWORD_INTERACTION))
#define COCKPIT_IS_PASSWORD_INTERACTION_CLASS(k)  (G_TYPE_CHECK_CLASS_TYPE ((k), COCKPIT_TYPE_PASSWORD_INTERACTION))
#define COCKPIT_PASSWORD_INTERACTION_GET_CLASS(o) (G_TYPE_INSTANCE_GET_CLASS ((o), COCKPIT_TYPE_PASSWORD_INTERACTION, CockpitPasswordInteractionClass))

typedef struct _CockpitPasswordInteraction        CockpitPasswordInteraction;
typedef struct _CockpitPasswordInteractionClass   CockpitPasswordInteractionClass;

GType                  cockpit_password_interaction_get_type    (void) G_GNUC_CONST;

GTlsInteraction *      cockpit_password_interaction_new         (const char *password);

G_END_DECLS
