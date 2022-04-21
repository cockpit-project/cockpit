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

#ifndef __MOCK_AUTH_H__
#define __MOCK_AUTH_H__

#include <glib.h>

G_BEGIN_DECLS

GHashTable *     mock_auth_basic_header  (const gchar *user,
                                          const gchar *password);

void            mock_auth_include_cookie_as_if_client (GHashTable *resp_headers,
                                                       GHashTable *req_headers,
                                                       const gchar *cookie_name);
G_END_DECLS

#endif
