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

#include "ws/cockpitauth.h"

#define MOCK_TYPE_AUTH         (mock_auth_get_type ())
#define MOCK_AUTH(o)           (G_TYPE_CHECK_INSTANCE_CAST ((o), MOCK_TYPE_AUTH, MockAuth))
#define MOCK_IS_AUTH(o)        (G_TYPE_CHECK_INSTANCE_TYPE ((o), MOCK_TYPE_AUTH))

typedef struct _MockAuth MockAuth;

GType            mock_auth_get_type   (void);

CockpitAuth *    mock_auth_new        (const char *expect_user,
                                       const char *expect_password);

GHashTable *     mock_auth_basic_header  (const gchar *user,
                                          const gchar *password);

void             mock_auth_set_failure_data (MockAuth *self,
                                             JsonObject *data);

void            mock_auth_include_cookie_as_if_client (GHashTable *resp_headers,
                                                       GHashTable *req_headers,
                                                       const gchar *cookie_name);
