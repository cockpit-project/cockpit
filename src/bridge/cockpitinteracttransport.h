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

#ifndef __COCKPIT_INTERACT_TRANSPORT_H__
#define __COCKPIT_INTERACT_TRANSPORT_H__

#include <gio/gio.h>

#include "common/cockpittransport.h"

G_BEGIN_DECLS

#define COCKPIT_TYPE_INTERACT_TRANSPORT         (cockpit_interact_transport_get_type ())
#define COCKPIT_INTERACT_TRANSPORT(o)           (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_INTERACT_TRANSPORT, CockpitInteractTransport))
#define COCKPIT_IS_INTERACT_TRANSPORT(o)        (G_TYPE_CHECK_INSTANCE_TYPE ((o), COCKPIT_TYPE_INTERACT_TRANSPORT))

typedef struct _CockpitInteractTransport        CockpitInteractTransport;

GType              cockpit_interact_transport_get_type   (void) G_GNUC_CONST;

CockpitTransport * cockpit_interact_transport_new        (gint in_fd,
                                                          gint out_fd,
                                                          const gchar *boundary);

G_END_DECLS

#endif /* __COCKPIT_INTERACT_TRANSPORT_H__ */
