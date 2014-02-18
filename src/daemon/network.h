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

#ifndef COCKPIT_NETWORK_H_0E18B8D8A1A94533A9EBC4AAD7DA7FE8
#define COCKPIT_NETWORK_H_0E18B8D8A1A94533A9EBC4AAD7DA7FE8

#include "types.h"

G_BEGIN_DECLS

#define TYPE_NETWORK  (network_get_type ())
#define NETWORK(o)    (G_TYPE_CHECK_INSTANCE_CAST ((o), TYPE_NETWORK, Network))
#define IS_NETWORK(o) (G_TYPE_CHECK_INSTANCE_TYPE ((o), TYPE_NETWORK))

GType             network_get_type    (void) G_GNUC_CONST;

CockpitNetwork *  network_new         (Daemon *daemon);

Daemon *          network_get_daemon  (Network *network);

G_END_DECLS

#endif /* COCKPIT_NETWORK_H__ */
