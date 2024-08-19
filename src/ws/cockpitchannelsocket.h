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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

#ifndef __COCKPIT_CHANNEL_SOCKET_H__
#define __COCKPIT_CHANNEL_SOCKET_H__

#include "common/cockpitwebserver.h"

#include "cockpitwebservice.h"

G_BEGIN_DECLS


void                 cockpit_channel_socket_open     (CockpitWebService *service,
                                                      JsonObject *open,
                                                      CockpitWebRequest *request);

G_END_DECLS

#endif /* __COCKPIT_CHANNEL_SOCKET_H__ */
