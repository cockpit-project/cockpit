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

#include "config.h"

#include "mock-auth.h"

#include "cockpit/cockpitenums.h"
#include "cockpit/cockpiterror.h"
#include "cockpit/cockpittest.h"
#include "ws/cockpitauth.h"
#include "websocket/websocket.h"

#include <string.h>

typedef struct {
  CockpitAuth *auth;
} Test;

static void
setup (Test *test,
       gconstpointer data)
{
  test->auth = mock_auth_new ("me", "this is the password");
}

static void
teardown (Test *test,
          gconstpointer data)
{
  g_object_unref (test->auth);
}

static void
test_verify_password (Test *test,
                      gconstpointer data)
{
  GError *error = NULL;

  /* A valid password */
  if (!cockpit_auth_verify_password (test->auth, "me", "this is the password", &error))
    g_assert_not_reached ();
  g_assert_no_error (error);
}

static void
test_verify_password_bad (Test *test,
                          gconstpointer data)
{
  GError *error = NULL;

  /* An invalid password */
  if (cockpit_auth_verify_password (test->auth, "me", "different password", &error))
    g_assert_not_reached ();
  g_assert_error (error, COCKPIT_ERROR, COCKPIT_ERROR_AUTHENTICATION_FAILED);
  g_clear_error (&error);

  /* An invalid user */
  if (cockpit_auth_verify_password (test->auth, "another", "this is the password", &error))
    g_assert_not_reached ();
  g_assert_error (error, COCKPIT_ERROR, COCKPIT_ERROR_AUTHENTICATION_FAILED);
  g_clear_error (&error);
}

static void
test_userpass_cookie_check (Test *test,
                            gconstpointer data)
{
  CockpitCreds *creds;
  GError *error = NULL;
  GHashTable *headers;
  gchar *cookie;
  gchar *end;

  headers = web_socket_util_new_headers ();
  creds = cockpit_auth_check_userpass (test->auth, "me\nthis is the password",
                                       TRUE, headers, &error);
  g_assert_no_error (error);
  g_assert (creds != NULL);

  g_assert_cmpstr ("me", ==, cockpit_creds_get_user (creds));
  g_assert_cmpstr ("this is the password", ==, cockpit_creds_get_password (creds));
  cockpit_creds_unref (creds);

  cookie = g_strdup (g_hash_table_lookup (headers, "Set-Cookie"));
  g_assert (cookie != NULL);

  end = strchr (cookie, ';');
  g_assert (end != NULL);
  end[0] = '\0';

  g_hash_table_insert (headers, g_strdup ("Cookie"), cookie);

  creds = cockpit_auth_check_headers (test->auth, headers, NULL);
  g_assert (creds != NULL);

  g_assert_cmpstr ("me", ==, cockpit_creds_get_user (creds));
  g_assert_cmpstr ("this is the password", ==, cockpit_creds_get_password (creds));
  cockpit_creds_unref (creds);

  g_hash_table_destroy (headers);
}

static void
test_userpass_bad (Test *test,
                   gconstpointer data)
{
  GError *error = NULL;
  GHashTable *headers;

  headers = web_socket_util_new_headers ();

  if (cockpit_auth_check_userpass (test->auth, "bad\nuser", TRUE, headers, &error))
      g_assert_not_reached ();
  g_assert_error (error, COCKPIT_ERROR, COCKPIT_ERROR_AUTHENTICATION_FAILED);
  g_clear_error (&error);

  g_hash_table_destroy (headers);
}

static void
test_headers_bad (Test *test,
                  gconstpointer data)
{
  GHashTable *headers;

  headers = web_socket_util_new_headers ();

  /* Bad version */
  g_hash_table_insert (headers, g_strdup ("Cookie"), g_strdup ("CockpitAuth=v=1;k=blah"));
  if (cockpit_auth_check_headers (test->auth, headers, NULL))
      g_assert_not_reached ();

  /* Bad hash */
  g_hash_table_remove_all (headers);
  g_hash_table_insert (headers, g_strdup ("Cookie"), g_strdup ("CockpitAuth=v=2;k=blah"));
  if (cockpit_auth_check_headers (test->auth, headers, NULL))
      g_assert_not_reached ();

  g_hash_table_destroy (headers);
}

static CockpitCreds *
on_auth_authenticate (CockpitAuth *auth,
                      GHashTable *in_headers,
                      GHashTable *out_headers,
                      gpointer user_data)
{
  g_hash_table_insert (out_headers, g_strdup ("Who"), g_strdup ("janitor"));
  g_assert_cmpstr (g_hash_table_lookup (in_headers, "Input"), ==, "value");
  g_assert_cmpstr (user_data, ==, "Marmalaade!");
  return cockpit_creds_new_password ("scruffy", "zerogjuggs");
}

static void
test_authenticate_signal (Test *test,
                          gconstpointer data)
{
  GHashTable *out_headers;
  GHashTable *in_headers;
  CockpitCreds *creds;

  out_headers = web_socket_util_new_headers ();
  in_headers = web_socket_util_new_headers ();
  g_hash_table_insert (in_headers, g_strdup ("Input"), g_strdup ("value"));

  g_signal_connect (test->auth, "authenticate", G_CALLBACK (on_auth_authenticate), "Marmalaade!");
  creds = cockpit_auth_check_headers (test->auth, in_headers, out_headers);

  g_assert (creds != NULL);
  g_assert_cmpstr (cockpit_creds_get_user (creds), ==, "scruffy");
  g_assert_cmpstr (cockpit_creds_get_password (creds), ==, "zerogjuggs");

  g_assert_cmpstr (g_hash_table_lookup (out_headers, "Who"), ==, "janitor");

  cockpit_creds_unref (creds);
  g_hash_table_destroy (in_headers);
  g_hash_table_destroy (out_headers);
}

int
main (int argc,
      char *argv[])
{
  cockpit_test_init (&argc, &argv);

  g_test_add ("/auth/verify-password", Test, NULL, setup, test_verify_password, teardown);
  g_test_add ("/auth/verify-password-bad", Test, NULL, setup, test_verify_password_bad, teardown);
  g_test_add ("/auth/userpass-header-check", Test, NULL, setup, test_userpass_cookie_check, teardown);
  g_test_add ("/auth/userpass-bad", Test, NULL, setup, test_userpass_bad, teardown);
  g_test_add ("/auth/headers-bad", Test, NULL, setup, test_headers_bad, teardown);
  g_test_add ("/auth/authenticate-signal", Test, NULL, setup, test_authenticate_signal, teardown);

  return g_test_run ();
}
