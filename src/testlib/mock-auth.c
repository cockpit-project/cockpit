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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

#include "config.h"

#include "mock-auth.h"

#include "common/cockpitauthorize.h"

#include "websocket/websocket.h"

#include <string.h>

GHashTable *
mock_auth_basic_header (const gchar *user,
                        const gchar *password)
{
  GHashTable *headers;
  gchar *userpass;
  gchar *encoded;
  gchar *header;

  userpass = g_strdup_printf ("%s:%s", user, password);
  encoded = g_base64_encode ((guchar *)userpass, strlen (userpass));
  header = g_strdup_printf ("Basic %s", encoded);

  g_free (userpass);
  g_free (encoded);

  headers = web_socket_util_new_headers ();
  g_hash_table_insert (headers, g_strdup ("Authorization"), header);
  return headers;
}

void
mock_auth_include_cookie_as_if_client (GHashTable *resp_headers,
                                       GHashTable *req_headers,
                                       const gchar *cookie_name)
{
  gchar *cookie;
  gchar *end;
  gchar *expected = g_strdup_printf ("%s=", cookie_name);

  cookie = g_strdup (g_hash_table_lookup (resp_headers, "Set-Cookie"));
  g_assert (cookie != NULL);
  end = strchr (cookie, ';');
  g_assert (end != NULL);
  end[0] = '\0';

  g_assert (strncmp (cookie, expected, strlen(expected)) == 0);

  g_hash_table_insert (req_headers, g_strdup ("Cookie"), cookie);
  g_free (expected);
}
