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

#ifndef __COCKPIT_CHANNEL_RESPONSE_H__
#define __COCKPIT_CHANNEL_RESPONSE_H__

#include "common/cockpitwebserver.h"
#include "cockpitwebservice.h"

G_BEGIN_DECLS


void             cockpit_channel_response_serve       (CockpitWebService *service,
                                                       GHashTable *headers,
                                                       CockpitWebResponse *response,
                                                       const gchar *where,
                                                       const gchar *path);

void             cockpit_channel_response_open        (CockpitWebService *service,
                                                       CockpitWebRequest *request,
                                                       JsonObject *open);

G_END_DECLS

#endif /* __COCKPIT_CHANNEL_RESPONSE_H__ */
