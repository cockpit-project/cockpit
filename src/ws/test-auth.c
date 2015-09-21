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

#include "common/cockpitenums.h"
#include "common/cockpiterror.h"
#include "common/cockpittest.h"
#include "ws/cockpitauth.h"
#include "websocket/websocket.h"

#include "cockpitws.h"

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
on_ready_get_result (GObject *source,
                     GAsyncResult *result,
                     gpointer user_data)
{
  GAsyncResult **retval = user_data;
  g_assert (retval != NULL);
  g_assert (*retval == NULL);
  *retval = g_object_ref (result);
}

static void
include_cookie_as_if_client (GHashTable *resp_headers,
                             GHashTable *req_headers)
{
  gchar *cookie;
  gchar *end;

  cookie = g_strdup (g_hash_table_lookup (resp_headers, "Set-Cookie"));
  g_assert (cookie != NULL);
  end = strchr (cookie, ';');
  g_assert (end != NULL);
  end[0] = '\0';

  g_hash_table_insert (req_headers, g_strdup ("Cookie"), cookie);
}

static void
test_userpass_cookie_check (Test *test,
                            gconstpointer data)
{
  GAsyncResult *result = NULL;
  CockpitWebService *service;
  CockpitWebService *prev_service;
  CockpitCreds *creds;
  CockpitCreds *prev_creds;
  GError *error = NULL;
  GHashTable *headers;

  headers = mock_auth_basic_header ("me", "this is the password");
  cockpit_auth_login_async (test->auth, "/cockpit/", headers, NULL, on_ready_get_result, &result);
  g_hash_table_unref (headers);

  while (result == NULL)
    g_main_context_iteration (NULL, TRUE);

  headers = web_socket_util_new_headers ();
  service = cockpit_auth_login_finish (test->auth, result, 0, headers, &error);
  g_object_unref (result);
  g_assert_no_error (error);
  g_assert (service != NULL);

  creds = cockpit_web_service_get_creds (service);
  g_assert_cmpstr ("me", ==, cockpit_creds_get_user (creds));
  g_assert_cmpstr ("cockpit", ==, cockpit_creds_get_application (creds));
  g_assert_cmpstr ("this is the password", ==, cockpit_creds_get_password (creds));

  prev_service = service;
  g_object_unref (service);
  service = NULL;

  prev_creds = creds;
  creds = NULL;

  include_cookie_as_if_client (headers, headers);

  service = cockpit_auth_check_cookie (test->auth, "/cockpit", headers);
  g_assert (prev_service == service);

  creds = cockpit_web_service_get_creds (service);
  g_assert (prev_creds == creds);

  g_assert_cmpstr ("me", ==, cockpit_creds_get_user (creds));
  g_assert_cmpstr ("this is the password", ==, cockpit_creds_get_password (creds));

  g_hash_table_destroy (headers);
  g_object_unref (service);
}

static void
test_userpass_bad (Test *test,
                   gconstpointer data)
{
  GAsyncResult *result = NULL;
  CockpitWebService *service;
  GError *error = NULL;
  GHashTable *headers;

  headers = mock_auth_basic_header ("me", "bad");
  cockpit_auth_login_async (test->auth, "/cockpit", headers, NULL, on_ready_get_result, &result);
  g_hash_table_unref (headers);

  while (result == NULL)
    g_main_context_iteration (NULL, TRUE);

  headers = web_socket_util_new_headers ();
  service = cockpit_auth_login_finish (test->auth, result, 0, headers, &error);
  g_object_unref (result);

  g_assert (service == NULL);
  g_assert_error (error, COCKPIT_ERROR, COCKPIT_ERROR_AUTHENTICATION_FAILED);
  g_clear_error (&error);

  g_hash_table_destroy (headers);
}

static void
test_userpass_emptypass (Test *test,
                         gconstpointer data)
{
  GAsyncResult *result = NULL;
  CockpitWebService *service;
  GError *error = NULL;
  GHashTable *headers;

  headers = mock_auth_basic_header ("aaaaaa", "");
  cockpit_auth_login_async (test->auth, "/cockpit", headers, NULL, on_ready_get_result, &result);
  g_hash_table_unref (headers);

  while (result == NULL)
    g_main_context_iteration (NULL, TRUE);

  headers = web_socket_util_new_headers ();
  service = cockpit_auth_login_finish (test->auth, result, 0, headers, &error);
  g_object_unref (result);

  g_assert (service == NULL);
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
  if (cockpit_auth_check_cookie (test->auth, "/cockpit", headers))
      g_assert_not_reached ();

  /* Bad hash */
  g_hash_table_remove_all (headers);
  g_hash_table_insert (headers, g_strdup ("Cookie"), g_strdup ("CockpitAuth=v=2;k=blah"));
  if (cockpit_auth_check_cookie (test->auth, "/cockpit", headers))
      g_assert_not_reached ();

  g_hash_table_destroy (headers);
}

static gboolean
on_timeout_set_flag (gpointer data)
{
  gboolean *flag = data;
  g_assert (*flag == FALSE);
  *flag = TRUE;
  return FALSE;
}

static void
test_idle_timeout (Test *test,
                   gconstpointer data)
{
  GAsyncResult *result = NULL;
  CockpitWebService *service;
  GError *error = NULL;
  GHashTable *headers;
  gboolean flag = FALSE;

  /* The idle timeout is one second */
  g_assert (cockpit_ws_service_idle == 1);

  headers = mock_auth_basic_header ("me", "this is the password");
  cockpit_auth_login_async (test->auth, "/cockpit", headers, NULL, on_ready_get_result, &result);
  g_hash_table_unref (headers);

  while (result == NULL)
    g_main_context_iteration (NULL, TRUE);

  headers = web_socket_util_new_headers ();
  service = cockpit_auth_login_finish (test->auth, result, 0, headers, &error);
  g_object_unref (result);
  g_assert_no_error (error);

  /* Logged in ... the webservice is idle though */
  g_assert (service != NULL);
  g_assert (cockpit_web_service_get_idling (service));
  g_object_unref (service);

  /* We should be able to authenticate with cookie and get the web service again */
  include_cookie_as_if_client (headers, headers);

  service = cockpit_auth_check_cookie (test->auth, "/cockpit", headers);

  /* Still logged in ... the web service is still idling */
  g_assert (service != NULL);
  g_assert (cockpit_web_service_get_idling (service));
  g_object_unref (service);

  /* Now wait for 2 seconds, and the service should be gone */
  g_timeout_add_seconds (2, on_timeout_set_flag, &flag);
  while (!flag)
    g_main_context_iteration (NULL, TRUE);

  /* Timeout, no longer logged in */
  service = cockpit_auth_check_cookie (test->auth, "/cockpit", headers);
  g_assert (service == NULL);

  g_hash_table_destroy (headers);
}

static gboolean
on_idling_set_flag (CockpitAuth *auth,
                    gpointer data)
{
  gboolean *flag = data;
  g_assert (*flag == FALSE);
  *flag = TRUE;
  return FALSE;
}

static void
test_process_timeout (Test *test,
                      gconstpointer data)
{
  gboolean idling = FALSE;

  g_assert (cockpit_ws_process_idle == 2);

  g_signal_connect (test->auth, "idling", G_CALLBACK (on_idling_set_flag), &idling);

  while (!idling)
    g_main_context_iteration (NULL, TRUE);
}

int
main (int argc,
      char *argv[])
{
  cockpit_ws_bridge_program = "/bin/cat";
  cockpit_ws_service_idle = 1;
  cockpit_ws_process_idle = 2;

  cockpit_test_init (&argc, &argv);

  g_test_add ("/auth/userpass-header-check", Test, NULL, setup, test_userpass_cookie_check, teardown);
  g_test_add ("/auth/userpass-bad", Test, NULL, setup, test_userpass_bad, teardown);
  g_test_add ("/auth/userpass-emptypass", Test, NULL, setup, test_userpass_emptypass, teardown);
  g_test_add ("/auth/headers-bad", Test, NULL, setup, test_headers_bad, teardown);
  g_test_add ("/auth/idle-timeout", Test, NULL, setup, test_idle_timeout, teardown);
  g_test_add ("/auth/process-timeout", Test, NULL, setup, test_process_timeout, teardown);

  return g_test_run ();
}
