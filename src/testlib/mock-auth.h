/*
 * Copyright (C) 2013 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
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
