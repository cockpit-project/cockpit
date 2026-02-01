/*
 * Copyright (C) 2015 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#ifndef __COCKPIT_CHANNEL_SOCKET_H__
#define __COCKPIT_CHANNEL_SOCKET_H__

#include "cockpitwebserver.h"

#include "cockpitwebservice.h"

G_BEGIN_DECLS


void                 cockpit_channel_socket_open     (CockpitWebService *service,
                                                      JsonObject *open,
                                                      CockpitWebRequest *request);

G_END_DECLS

#endif /* __COCKPIT_CHANNEL_SOCKET_H__ */
