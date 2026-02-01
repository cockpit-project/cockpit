/*
 * Copyright (C) 2015 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#ifndef __COCKPIT_CHANNEL_RESPONSE_H__
#define __COCKPIT_CHANNEL_RESPONSE_H__

#include "cockpitwebserver.h"
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
