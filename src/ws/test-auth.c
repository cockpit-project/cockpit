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

#include "common/cockpitconf.h"
#include "common/cockpiterror.h"
#include "common/cockpittest.h"
#include "ws/cockpitauth.h"
#include "websocket/websocket.h"

#include "cockpitws.h"

#include <string.h>

/* Mock override these from other files */
extern const gchar *cockpit_config_file;
extern const gchar *cockpit_ws_max_startups;

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
setup_normal (Test *test,
              gconstpointer data)
{
  cockpit_config_file = SRCDIR "/src/ws/mock-config/cockpit/cockpit.conf";
  test->auth = cockpit_auth_new (FALSE);
}

static void
setup_alt_config (Test *test,
              gconstpointer data)
{
  cockpit_config_file = SRCDIR "/src/ws/mock-config/cockpit/cockpit-alt.conf";
  test->auth = cockpit_auth_new (FALSE);
}

static void
teardown_normal (Test *test,
                 gconstpointer data)
{
  cockpit_assert_expected ();
  g_object_unref (test->auth);
  cockpit_conf_cleanup ();
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
test_application (Test *test,
                  gconstpointer data)
{
  gchar *application = NULL;
  gboolean is_host = FALSE;

  application = cockpit_auth_parse_application ("/", &is_host);
  g_assert_cmpstr ("cockpit", ==, application);
  g_assert_false (is_host);
  g_clear_pointer (&application, g_free);

  application = cockpit_auth_parse_application ("/=", &is_host);
  g_assert_cmpstr ("cockpit", ==, application);
  g_assert_false (is_host);
  g_clear_pointer (&application, g_free);

  application = cockpit_auth_parse_application ("/other/other", &is_host);
  g_assert_cmpstr ("cockpit", ==, application);
  g_assert_false (is_host);
  g_clear_pointer (&application, g_free);

  application = cockpit_auth_parse_application ("/=other/other", &is_host);
  g_assert_true (is_host);
  g_assert_cmpstr ("cockpit+=other", ==, application);
  g_clear_pointer (&application, g_free);

  application = cockpit_auth_parse_application ("/=other", &is_host);
  g_assert_true (is_host);
  g_assert_cmpstr ("cockpit+=other", ==, application);
  g_clear_pointer (&application, g_free);

  application = cockpit_auth_parse_application ("/=other/", &is_host);
  g_assert_true (is_host);
  g_assert_cmpstr ("cockpit+=other", ==, application);
  g_clear_pointer (&application, g_free);

  application = cockpit_auth_parse_application ("/cockpit", &is_host);
  g_assert_cmpstr ("cockpit", ==, application);
  g_assert_false (is_host);
  g_clear_pointer (&application, g_free);

  application = cockpit_auth_parse_application ("/cockpit/login", &is_host);
  g_assert_cmpstr ("cockpit", ==, application);
  g_assert_false (is_host);
  g_clear_pointer (&application, g_free);

  application = cockpit_auth_parse_application ("/cockpit+application", &is_host);
  g_assert_cmpstr ("cockpit+application", ==, application);
  g_assert_false (is_host);
  g_clear_pointer (&application, g_free);

  application = cockpit_auth_parse_application ("/cockpit+application/", &is_host);
  g_assert_false (is_host);
  g_assert_cmpstr ("cockpit+application", ==, application);
  g_clear_pointer (&application, g_free);

  application = cockpit_auth_parse_application ("/cockpit+application/other/other", &is_host);
  g_assert_false (is_host);
  g_assert_cmpstr ("cockpit+application", ==, application);
  g_clear_pointer (&application, g_free);
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
  JsonObject *response = NULL;
  GError *error = NULL;
  GHashTable *headers;

  headers = mock_auth_basic_header ("me", "this is the password");
  cockpit_auth_login_async (test->auth, "/cockpit/", NULL, headers, on_ready_get_result, &result);
  g_hash_table_unref (headers);

  while (result == NULL)
    g_main_context_iteration (NULL, TRUE);

  headers = web_socket_util_new_headers ();
  response = cockpit_auth_login_finish (test->auth, result, NULL, headers, &error);

  /* Get the service */
  mock_auth_include_cookie_as_if_client (headers, headers, "cockpit");
  service = cockpit_auth_check_cookie (test->auth, "/cockpit", headers);

  g_object_unref (result);
  g_assert_no_error (error);
  g_assert (service != NULL);
  g_assert (response != NULL);

  creds = cockpit_web_service_get_creds (service);
  g_assert_cmpstr ("me", ==, cockpit_creds_get_user (creds));
  g_assert_cmpstr ("cockpit", ==, cockpit_creds_get_application (creds));
  g_assert_cmpstr ("this is the password", ==, cockpit_creds_get_password (creds));

  prev_service = service;
  g_object_unref (service);
  service = NULL;

  prev_creds = creds;
  creds = NULL;

  mock_auth_include_cookie_as_if_client (headers, headers, "cockpit");

  service = cockpit_auth_check_cookie (test->auth, "/cockpit", headers);
  g_assert (prev_service == service);

  creds = cockpit_web_service_get_creds (service);
  g_assert (prev_creds == creds);

  g_assert_cmpstr ("me", ==, cockpit_creds_get_user (creds));
  g_assert_cmpstr ("this is the password", ==, cockpit_creds_get_password (creds));

  g_hash_table_destroy (headers);
  g_object_unref (service);
  json_object_unref (response);
}

static void
test_userpass_bad (Test *test,
                   gconstpointer data)
{
  GAsyncResult *result = NULL;
  GError *error = NULL;
  JsonObject *response;
  GHashTable *headers;

  headers = mock_auth_basic_header ("me", "bad");
  cockpit_auth_login_async (test->auth, "/cockpit", NULL, headers, on_ready_get_result, &result);
  g_hash_table_unref (headers);

  while (result == NULL)
    g_main_context_iteration (NULL, TRUE);

  headers = web_socket_util_new_headers ();
  response = cockpit_auth_login_finish (test->auth, result, NULL, headers, &error);
  g_object_unref (result);

  g_assert (response == NULL);
  g_assert_error (error, COCKPIT_ERROR, COCKPIT_ERROR_AUTHENTICATION_FAILED);
  g_clear_error (&error);

  g_hash_table_destroy (headers);
}

static void
test_userpass_emptypass (Test *test,
                         gconstpointer data)
{
  GAsyncResult *result = NULL;
  JsonObject *response;
  GError *error = NULL;
  GHashTable *headers;

  headers = mock_auth_basic_header ("aaaaaa", "");
  cockpit_auth_login_async (test->auth, "/cockpit", NULL, headers, on_ready_get_result, &result);
  g_hash_table_unref (headers);

  while (result == NULL)
    g_main_context_iteration (NULL, TRUE);

  headers = web_socket_util_new_headers ();
  response = cockpit_auth_login_finish (test->auth, result, NULL, headers, &error);
  g_object_unref (result);

  g_assert (response == NULL);
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

static gboolean
on_idling_set_flag (CockpitAuth *auth,
                    gpointer data)
{
  gboolean *flag = data;
  *flag = TRUE;
  return FALSE;
}

static void
test_idle_timeout (Test *test,
                   gconstpointer data)
{
  GAsyncResult *result = NULL;
  CockpitWebService *service;
  JsonObject *login_response;
  GError *error = NULL;
  GHashTable *headers;
  gboolean flag = FALSE;
  gboolean idling = FALSE;

  /* The idle timeout is one second */
  g_assert (cockpit_ws_service_idle == 1);

  headers = mock_auth_basic_header ("me", "this is the password");
  cockpit_auth_login_async (test->auth, "/cockpit", NULL, headers, on_ready_get_result, &result);
  g_hash_table_unref (headers);

  while (result == NULL)
    g_main_context_iteration (NULL, TRUE);

  headers = web_socket_util_new_headers ();
  login_response = cockpit_auth_login_finish (test->auth, result, NULL, headers, &error);
  g_assert (login_response != NULL);
  json_object_unref (login_response);
  g_object_unref (result);
  g_assert_no_error (error);

  /* Logged in ... the webservice is idle though */
  mock_auth_include_cookie_as_if_client (headers, headers, "cockpit");
  service = cockpit_auth_check_cookie (test->auth, "/cockpit", headers);
  g_assert (service != NULL);
  g_assert (cockpit_web_service_get_idling (service));
  g_object_unref (service);

  g_assert (cockpit_ws_process_idle == 2);
  g_signal_connect (test->auth, "idling", G_CALLBACK (on_idling_set_flag), &idling);

  /* Now wait for 2 seconds, and the service should be gone */
  g_timeout_add_seconds (2, on_timeout_set_flag, &flag);
  while (!flag)
    g_main_context_iteration (NULL, TRUE);

  /* Timeout, no longer logged in */
  service = cockpit_auth_check_cookie (test->auth, "/cockpit", headers);
  g_assert (service == NULL);

  /* Now wait for 3 seconds, and the auth should have said its idling */
  flag = FALSE;
  g_timeout_add_seconds (3, on_timeout_set_flag, &flag);
  while (!flag)
    g_main_context_iteration (NULL, TRUE);

  g_assert (idling == TRUE);
  g_hash_table_destroy (headers);
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

static void
test_max_startups (Test *test,
                   gconstpointer data)
{
  GAsyncResult *result1 = NULL;
  GAsyncResult *result2 = NULL;
  GAsyncResult *result3 = NULL;

  JsonObject *response;

  GHashTable *headers_slow;
  GHashTable *headers_fail;

  GError *error1 = NULL;
  GError *error2 = NULL;
  GError *error3 = NULL;

  cockpit_expect_message ("Request dropped; too many startup connections: 2");

  headers_slow = web_socket_util_new_headers ();
  headers_fail = web_socket_util_new_headers ();
  g_hash_table_insert (headers_slow, g_strdup ("Authorization"), g_strdup ("testscheme failslow"));
  g_hash_table_insert (headers_fail, g_strdup ("Authorization"), g_strdup ("testscheme fail"));

  /* Slow request that takes a while to complete */
  cockpit_auth_login_async (test->auth, "/cockpit", NULL, headers_slow, on_ready_get_result, &result1);

  /* Request that gets dropped */
  cockpit_auth_login_async (test->auth, "/cockpit", NULL, headers_fail, on_ready_get_result, &result2);
  while (result2 == NULL)
    g_main_context_iteration (NULL, TRUE);
  response = cockpit_auth_login_finish (test->auth, result2, NULL, NULL, &error2);
  g_object_unref (result2);
  g_assert (response == NULL);
  g_assert_cmpstr ("Connection closed by host", ==, error2->message);

  /* Wait for first request to finish */
  while (result1 == NULL)
    g_main_context_iteration (NULL, TRUE);
  response = cockpit_auth_login_finish (test->auth, result1, NULL, NULL, &error1);
  g_object_unref (result1);
  g_assert (response == NULL);
  g_assert_cmpstr ("Authentication failed", ==, error1->message);

  /* Now that first is finished we can successfully run another one */
  g_hash_table_insert (headers_fail, g_strdup ("Authorization"), g_strdup ("testscheme fail"));
  cockpit_auth_login_async (test->auth, "/cockpit", NULL, headers_fail, on_ready_get_result, &result3);
  while (result3 == NULL)
    g_main_context_iteration (NULL, TRUE);
  response = cockpit_auth_login_finish (test->auth, result3, NULL, NULL, &error3);
  g_object_unref (result3);
  g_assert (response == NULL);
  g_assert_cmpstr ("Authentication failed", ==, error3->message);

  g_clear_error (&error1);
  g_clear_error (&error2);
  g_clear_error (&error3);

  g_hash_table_destroy (headers_fail);
  g_hash_table_destroy (headers_slow);
}

typedef struct {
  const gchar *header;
  const gchar *error_message;
  const gchar *warning;
  const gchar *path;
  int error_code;
} ErrorFixture;

typedef struct {
  const gchar *data;
  const gchar *warning;
  const gchar *header;
  const gchar *path;
  const gchar *user;
  const gchar *password;
  const gchar *application;
  const gchar *cookie_name;
} SuccessFixture;

static void
test_custom_fail (Test *test,
                  gconstpointer data)
{
  GAsyncResult *result = NULL;
  JsonObject *response;
  GError *error = NULL;
  GHashTable *headers;
  const ErrorFixture *fix = data;
  const gchar *path = fix->path ? fix->path : "/cockpit";

  if (fix->warning)
    cockpit_expect_warning (fix->warning);

  headers = web_socket_util_new_headers ();
  g_hash_table_insert (headers, g_strdup ("Authorization"), g_strdup (fix->header));

  cockpit_auth_login_async (test->auth, path, NULL, headers, on_ready_get_result, &result);
  g_hash_table_unref (headers);

  while (result == NULL)
    g_main_context_iteration (NULL, TRUE);

  headers = web_socket_util_new_headers ();
  response = cockpit_auth_login_finish (test->auth, result, NULL, headers, &error);
  g_object_unref (result);

  g_assert (response == NULL);
  if (fix->error_code)
    g_assert_error (error, COCKPIT_ERROR, fix->error_code);
  else
    g_assert (error != NULL);

  g_assert_cmpstr (fix->error_message, ==, error->message);
  g_clear_error (&error);

  g_hash_table_destroy (headers);
}

static void
test_custom_timeout (Test *test,
                     gconstpointer data)
{
  cockpit_expect_warning ("*Auth pipe closed: timeout*");
  test_custom_fail (test, data);
}

static void
test_bad_command (Test *test,
                  gconstpointer data)
{
  cockpit_expect_possible_log ("cockpit-protocol", G_LOG_LEVEL_WARNING,
                               "*couldn't recv*");
  cockpit_expect_possible_log ("cockpit-ws", G_LOG_LEVEL_WARNING,
                               "*Auth pipe closed: internal-error*");
  cockpit_expect_possible_log ("cockpit-ws", G_LOG_LEVEL_WARNING,
                               "*Auth pipe closed: not-found*");
  cockpit_expect_possible_log ("cockpit-ws", G_LOG_LEVEL_WARNING,
                               "*Auth pipe closed: terminated*");
  cockpit_expect_possible_log ("cockpit-ws", G_LOG_LEVEL_WARNING,
                               "*couldn't write: Connection refused*");
  cockpit_expect_possible_log ("cockpit-protocol", G_LOG_LEVEL_MESSAGE,
                               "*couldn't write: Connection refused*");
  cockpit_expect_possible_log ("cockpit-protocol", G_LOG_LEVEL_MESSAGE,
                               "*couldn't send: Connection refused*");
  test_custom_fail (test, data);
}

static void
test_custom_success (Test *test,
                     gconstpointer data)
{
  GAsyncResult *result = NULL;
  CockpitWebService *service;
  JsonObject *response;
  CockpitCreds *creds;
  GError *error = NULL;
  GHashTable *headers;
  JsonObject *login_data;
  const SuccessFixture *fix = data;
  const gchar *path = fix->path ? fix->path : "/cockpit";
  const gchar *user = fix->user ? fix->user : "me";
  const gchar *password = fix->password ? fix->password : "this is the password";
  const gchar *application = fix->application ? fix->application : "cockpit";

  if (fix->warning)
    cockpit_expect_warning (fix->warning);

  headers = web_socket_util_new_headers ();
  g_hash_table_insert (headers, g_strdup ("Authorization"), g_strdup (fix->header));
  cockpit_auth_login_async (test->auth, path, NULL, headers, on_ready_get_result, &result);
  g_hash_table_unref (headers);

  while (result == NULL)
    g_main_context_iteration (NULL, TRUE);

  headers = web_socket_util_new_headers ();
  response = cockpit_auth_login_finish (test->auth, result, NULL, headers, &error);
  g_object_unref (result);
  g_assert_no_error (error);
  g_assert (response != NULL);
  json_object_unref (response);

  mock_auth_include_cookie_as_if_client (headers, headers,
                               fix->cookie_name ? fix->cookie_name : "cockpit");
  service = cockpit_auth_check_cookie (test->auth, path, headers);
  creds = cockpit_web_service_get_creds (service);
  g_assert_cmpstr (user, ==, cockpit_creds_get_user (creds));
  g_assert_cmpstr (application, ==, cockpit_creds_get_application (creds));
  if (g_str_has_prefix (fix->header, "Basic"))
    g_assert_cmpstr (cockpit_creds_get_password (creds), == , password);
  else
    g_assert_null (cockpit_creds_get_password (creds));

  login_data = cockpit_creds_get_login_data (creds);
  if (fix->data)
    g_assert_cmpstr (json_object_get_string_member (login_data, "login"),
                     ==, fix->data);
  else
    g_assert_null (login_data);

  g_hash_table_destroy (headers);
  g_object_unref (service);
}

static const SuccessFixture fixture_ssh_basic = {
  .warning = NULL,
  .data = NULL,
  .header = "Basic bWU6dGhpcyBpcyB0aGUgcGFzc3dvcmQ="
};

static const SuccessFixture fixture_ssh_remote_basic = {
  .warning = NULL,
  .data = NULL,
  .header = "Basic cmVtb3RlLXVzZXI6dGhpcyBpcyB0aGUgbWFjaGluZSBwYXNzd29yZA==",
  .path = "/cockpit+=machine",
  .user = "remote-user",
  .password = "this is the machine password",
  .application = "cockpit+=machine",
  .cookie_name = "machine-cockpit+machine"
};

static const SuccessFixture fixture_ssh_no_data = {
  .warning = NULL,
  .data = NULL,
  .header = "testsshscheme success"
};

static const SuccessFixture fixture_ssh_remote_switched = {
  .data = NULL,
  .header = "testscheme ssh-remote-switch",
  .path = "/cockpit+=machine",
  .application = "cockpit+=machine",
  .cookie_name = "machine-cockpit+machine"
};

static const SuccessFixture fixture_ssh_alt_default = {
  .data = NULL,
  .header = "testsshscheme ssh-alt-default",
};

static const SuccessFixture fixture_ssh_alt = {
  .data = NULL,
  .path = "/cockpit+=machine",
  .application = "cockpit+=machine",
  .header = "testsshscheme ssh-alt-machine",
  .cookie_name = "machine-cockpit+machine"
};

static const SuccessFixture fixture_ssh_bad_data = {
  .warning = "*received bad login-data*",
  .data = NULL,
  .header = "testsshscheme success-bad-data"
};

static const SuccessFixture fixture_ssh_data = {
  .warning = NULL,
  .data = "data",
  .header = "testsshscheme success-with-data"
};

static const ErrorFixture fixture_ssh_basic_failed = {
  .error_message = "Authentication failed",
  .header = "Basic dXNlcjp0aGlzIGlzIHRoZSBwYXNzd29yZA=="
};

static const ErrorFixture fixture_ssh_remote_basic_failed = {
  .error_message = "Authentication failed",
  .header = "Basic d3Jvbmc6dGhpcyBpcyB0aGUgbWFjaGluZSBwYXNzd29yZA==",
  .path = "/cockpit+=machine"
};

static const ErrorFixture fixture_ssh_auth_no_write = {
  .error_message = "Authentication failed: no results",
  .header = "testsshscheme no-write",
};

static const ErrorFixture fixture_ssh_not_supported = {
  .error_code = COCKPIT_ERROR_AUTHENTICATION_FAILED,
  .error_message = "Authentication failed: authentication-not-supported",
  .header = "testsshscheme not-supported",
};

static const ErrorFixture fixture_ssh_auth_failed = {
  .error_code = COCKPIT_ERROR_AUTHENTICATION_FAILED,
  .error_message = "Authentication failed",
  .header = "testsshscheme ssh-fail",
};

static const ErrorFixture fixture_ssh_auth_no_user = {
  .error_message = "Authentication failed: missing user",
  .header = "testsshscheme no-user",
};

static const ErrorFixture fixture_ssh_auth_with_error = {
  .error_code = COCKPIT_ERROR_FAILED,
  .error_message = "Authentication failed: unknown: detail for error",
  .header = "testsshscheme with-error",
};

static const SuccessFixture fixture_no_data = {
  .warning = NULL,
  .data = NULL,
  .header = "testscheme success"
};

static const SuccessFixture fixture_bad_data = {
  .warning = "*received bad login-data*",
  .data = NULL,
  .header = "testscheme success-bad-data"
};

static const SuccessFixture fixture_data = {
  .warning = NULL,
  .data = "data",
  .header = "testscheme success-with-data"
};

static const SuccessFixture fixture_auth_fd = {
  .warning = NULL,
  .data = "data",
  .header = "testscheme-fd-4 success-with-data"
};

static const ErrorFixture fixture_bad_command = {
  .error_code = COCKPIT_ERROR_FAILED,
  .error_message = "Internal error in login process",
  .header = "badcommand bad",
};

static const ErrorFixture fixture_auth_failed = {
  .error_code = COCKPIT_ERROR_AUTHENTICATION_FAILED,
  .error_message = "Authentication failed",
  .header = "testscheme fail",
};

static const ErrorFixture fixture_auth_denied = {
  .error_code = COCKPIT_ERROR_PERMISSION_DENIED,
  .error_message = "Permission denied",
  .header = "testscheme denied",
};

static const ErrorFixture fixture_auth_no_user = {
  .error_message = "Authentication failed: missing user",
  .header = "testscheme no-user",
};

static const ErrorFixture fixture_auth_with_error = {
  .error_code = COCKPIT_ERROR_FAILED,
  .error_message = "Authentication failed: unknown: detail for error",
  .header = "testscheme with-error",
};

static const ErrorFixture fixture_auth_none = {
  .error_code = COCKPIT_ERROR_AUTHENTICATION_FAILED,
  .error_message = "Authentication disabled",
  .header = "none invalid",
};

static const ErrorFixture fixture_auth_no_write = {
  .error_message = "Authentication failed: no results",
  .header = "testscheme no-write",
};

static const ErrorFixture fixture_auth_timeout = {
  .error_message = "Authentication failed: Timeout",
  .header = "timeout-scheme too-slow",
};

typedef struct {
  const gchar **headers;
  const gchar **prompts;
  const gchar *error_message;
  const gchar *warning;
  int error_code;
  int pause;
} ErrorMultiFixture;

typedef struct {
  const gchar **headers;
  const gchar **prompts;
} SuccessMultiFixture;

static inline gchar *
str_skip (gchar *v,
          gchar c)
{
  while (v[0] == c)
    v++;
  return v;
}

static gboolean
parse_login_reply_challenge (GHashTable *headers,
                             gchar **out_id,
                             gchar **out_prompt)
{
  gchar *original;
  gchar *line;
  gchar *next;
  gchar *id = NULL;
  gchar *prompt = NULL;
  gboolean ret = FALSE;
  gpointer key;
  gsize length;

  if (!g_hash_table_lookup_extended (headers, "WWW-Authenticate", &key, (gpointer *)&original))
    goto out;

  line = original;

  // Check challenge type
  line = str_skip (line, ' ');
  if (g_ascii_strncasecmp (line, "X-Conversation ", strlen("X-Conversation ")) != 0)
    goto out;

  next = strchr (line, ' ');
  if (!next)
    goto out;

  // Get id
  line = next;
  line = str_skip (line, ' ');
  next = strchr (line, ' ');
  if (!next)
    goto out;
  id = g_strndup (line, next - line);

  // Rest should be the base64 prompt
  next = str_skip (next, ' ');
  prompt = g_strdup (next);
  if (g_base64_decode_inplace (prompt, &length) == NULL)
    goto out;
  prompt[length] = '\0';
  ret = TRUE;

out:
  if (ret)
    {
      *out_id = id;
      *out_prompt = prompt;
    }
  else
    {
      g_warning ("Got invalid WWW-Authenticate header: %s", original);
      g_free (id);
      g_free (prompt);
    }

  return ret;
}

static void
test_multi_step_success (Test *test,
                         gconstpointer data)
{
  CockpitWebService *service;
  CockpitCreds *creds;
  GHashTable *headers = NULL;
  gint spot = 0;
  gchar *id = NULL;

  const SuccessMultiFixture *fix = data;

  for (spot = 0; fix->headers[spot]; spot++)
    {
      GAsyncResult *result = NULL;
      JsonObject *response = NULL;
      GError *error = NULL;
      const gchar *header = fix->headers[spot];
      const gchar *expect_prompt = fix->prompts[spot];
      gchar *out = NULL;
      gchar *prompt = NULL;

      headers = web_socket_util_new_headers ();
      if (id)
        {
          g_assert (id != NULL);
          out = g_base64_encode ((guint8 *)header, strlen (header));
          g_hash_table_insert (headers, g_strdup ("Authorization"),
                               g_strdup_printf  ("X-Conversation %s %s", id, out));
          g_free (id);
          g_free (out);
          out = NULL;
          id = NULL;
        }
      else
        {
          g_hash_table_insert (headers, g_strdup ("Authorization"),
                               g_strdup (header));
        }
      cockpit_auth_login_async (test->auth, "/cockpit/", NULL, headers, on_ready_get_result, &result);
      g_hash_table_unref (headers);

      while (result == NULL)
        g_main_context_iteration (NULL, TRUE);

      headers = web_socket_util_new_headers ();
      response = cockpit_auth_login_finish (test->auth, result, NULL, headers, &error);
      g_object_unref (result);
      g_assert (response != NULL);

      /* Confirm we got the right prompt */
      if (expect_prompt)
        {
          g_assert (prompt == NULL);
          g_assert (id == NULL);

          g_assert (parse_login_reply_challenge (headers, &id, &prompt));
          g_assert_cmpstr (expect_prompt, ==, prompt);
          g_assert (id != NULL);
          g_free (prompt);
          prompt = NULL;

          g_assert_error (error, COCKPIT_ERROR, COCKPIT_ERROR_AUTHENTICATION_FAILED);
          g_clear_error (&error);

          g_hash_table_unref (headers);
        }
      else
        {
          g_assert_no_error (error);
        }

      json_object_unref (response);
    }

  mock_auth_include_cookie_as_if_client (headers, headers, "cockpit");
  service = cockpit_auth_check_cookie (test->auth, "/cockpit", headers);
  creds = cockpit_web_service_get_creds (service);
  g_assert_cmpstr ("me", ==, cockpit_creds_get_user (creds));
  g_assert_cmpstr ("cockpit", ==, cockpit_creds_get_application (creds));
  g_assert_null (cockpit_creds_get_password (creds));
  if (headers)
    g_hash_table_destroy (headers);
  g_object_unref (service);
}

static void
test_multi_step_fail (Test *test,
                      gconstpointer data)
{
  GHashTable *headers = NULL;
  gint spot = 0;
  gchar *id = NULL;
  gchar *prompt = NULL;
  const ErrorMultiFixture *fix = data;

  if (fix->warning)
    cockpit_expect_warning (fix->warning);

  for (spot = 0; fix->headers[spot]; spot++)
    {
      GAsyncResult *result = NULL;
      JsonObject *response = NULL;
      GError *error = NULL;
      const gchar *header = fix->headers[spot];
      const gchar *expect_prompt = fix->prompts[spot];
      gchar *out = NULL;
      gboolean ready_for_next = TRUE;

      headers = web_socket_util_new_headers ();
      if (id)
        {
          g_assert (id != NULL);
          out = g_base64_encode ((guint8 *)header, strlen (header));
          g_hash_table_insert (headers, g_strdup ("Authorization"),
                               g_strdup_printf  ("X-Conversation %s %s", id, out));
          g_free (id);
          g_free (out);
          out = NULL;
          id = NULL;
        }
      else
        {
          g_hash_table_insert (headers, g_strdup ("Authorization"),
                               g_strdup (header));
        }
      cockpit_auth_login_async (test->auth, "/cockpit/", NULL, headers, on_ready_get_result, &result);
      g_hash_table_unref (headers);

      while (result == NULL)
        g_main_context_iteration (NULL, TRUE);

      headers = web_socket_util_new_headers ();
      response = cockpit_auth_login_finish (test->auth, result, NULL, headers, &error);
      g_object_unref (result);
      g_assert (error != NULL);

      /* Confirm we got the right prompt */
      if (expect_prompt)
        {
          g_assert (prompt == NULL);
          g_assert (id == NULL);

          g_assert (parse_login_reply_challenge (headers, &id, &prompt));
          g_assert_cmpstr (expect_prompt, ==, prompt);
          g_assert (id != NULL);
          g_free (prompt);
          prompt = NULL;
          if (fix->pause)
            {
              ready_for_next = FALSE;
              g_timeout_add_seconds (fix->pause, on_timeout_set_flag, &ready_for_next);
            }

          while (ready_for_next == FALSE)
            g_main_context_iteration (NULL, TRUE);

          if (response)
            json_object_unref (response);
          g_hash_table_unref (headers);

          g_assert_error (error, COCKPIT_ERROR, COCKPIT_ERROR_AUTHENTICATION_FAILED);
          g_clear_error (&error);
        }
      else
        {
          g_assert (response == NULL);
          if (fix->error_code)
            g_assert_error (error, COCKPIT_ERROR, fix->error_code);
          else
            g_assert (error != NULL);

          g_assert_cmpstr (fix->error_message, ==, error->message);
          g_clear_error (&error);
          break;
        }
    }

  if (headers)
    g_hash_table_destroy (headers);
}

const gchar *two_steps[3] = { "testscheme two-step", "two", NULL };
const gchar *two_prompts[2] = { "type two", NULL };
const gchar *three_steps[4] = { "testscheme three-step", "two", "three", NULL };
const gchar *three_steps_ssh[4] = { "testsshscheme three-step", "two", "three", NULL };
const gchar *three_prompts[3] = { "type two", "type three", NULL };

static const SuccessMultiFixture fixture_two_steps = {
  .headers = two_steps,
  .prompts = two_prompts,
};

static const SuccessMultiFixture fixture_three_steps = {
  .headers = three_steps,
  .prompts = three_prompts,
};

static const SuccessMultiFixture fixture_ssh_three_steps = {
  .headers = three_steps_ssh,
  .prompts = three_prompts,
};

const gchar *two_steps_ssh_wrong[3] = { "testsshscheme two-step", "bad", NULL };
const gchar *two_steps_wrong[3] = { "testscheme two-step", "bad", NULL };
const gchar *three_steps_wrong[4] = { "testscheme three-step", "two", "bad", NULL };

static const ErrorMultiFixture fixture_fail_three_steps = {
  .headers = three_steps_wrong,
  .prompts = three_prompts,
  .error_code = COCKPIT_ERROR_AUTHENTICATION_FAILED,
  .error_message = "Authentication failed",
};

static const ErrorMultiFixture fixture_fail_two_steps = {
  .headers = two_steps_wrong,
  .prompts = two_prompts,
  .error_code = COCKPIT_ERROR_AUTHENTICATION_FAILED,
  .error_message = "Authentication failed",
};

static const ErrorMultiFixture fixture_fail_ssh_two_steps = {
  .headers = two_steps_ssh_wrong,
  .prompts = two_prompts,
  .error_code = COCKPIT_ERROR_AUTHENTICATION_FAILED,
  .error_message = "Authentication failed",
};

static const ErrorMultiFixture fixture_fail_step_timeout = {
  .headers = two_steps,
  .prompts = two_prompts,
  .error_code = COCKPIT_ERROR_AUTHENTICATION_FAILED,
  .error_message = "Invalid conversation token",
  .warning = "*Auth pipe closed: timeout*",
  .pause = 3,
};


typedef struct {
  const gchar *str;
  guint max_startups;
  guint max_startups_rate;
  guint max_startups_begin;
  gboolean warn;
} StartupFixture;

static void
setup_startups (Test *test,
                gconstpointer data)
{
  const StartupFixture *fix = data;
  cockpit_config_file = SRCDIR "does-not-exist";
  cockpit_ws_max_startups = fix->str;
  if (fix->warn)
    cockpit_expect_warning ("Illegal MaxStartups spec*");

  test->auth = cockpit_auth_new (FALSE);
}

static void
teardown_startups (Test *test,
                 gconstpointer data)
{
  cockpit_assert_expected ();
  g_object_unref (test->auth);
}

static const StartupFixture fixture_normal = {
  .str = "20:50:200",
  .max_startups = 200,
  .max_startups_begin = 20,
  .max_startups_rate = 50,
  .warn = FALSE,
};

static const StartupFixture fixture_single = {
  .str = "20",
  .max_startups = 20,
  .max_startups_begin = 20,
  .max_startups_rate = 100,
  .warn = FALSE,
};

static const StartupFixture fixture_double = {
  .str = "20:50",
  .max_startups = 20,
  .max_startups_begin = 20,
  .max_startups_rate = 100,
  .warn = FALSE,
};

static const StartupFixture fixture_unlimited = {
  .str = "0",
  .max_startups = 0,
  .max_startups_begin = 0,
  .max_startups_rate = 100,
  .warn = FALSE,
};

static const StartupFixture fixture_bad = {
  .str = "bad",
  .max_startups = 10,
  .max_startups_begin = 10,
  .max_startups_rate = 100,
  .warn = TRUE,
};

static const StartupFixture fixture_bad_rate = {
  .str = "20:101:40",
  .max_startups = 10,
  .max_startups_begin = 10,
  .max_startups_rate = 100,
  .warn = TRUE,
};

static const StartupFixture fixture_bad_startups = {
  .str = "40:101:20",
  .max_startups = 10,
  .max_startups_begin = 10,
  .max_startups_rate = 100,
  .warn = TRUE,
};

static const StartupFixture fixture_bad_negative = {
  .str = "-40:101:20",
  .max_startups = 10,
  .max_startups_begin = 10,
  .max_startups_rate = 100,
  .warn = TRUE,
};

static const StartupFixture fixture_bad_too_many = {
  .str = "40:101:20:50:50",
  .max_startups = 10,
  .max_startups_begin = 10,
  .max_startups_rate = 100,
  .warn = TRUE,
};

static void
test_max_startups_conf (Test *test,
                        gconstpointer data)
{
  const StartupFixture *fix = data;
  g_assert_cmpuint (fix->max_startups_begin, ==, test->auth->max_startups_begin);
  g_assert_cmpuint (fix->max_startups,  ==, test->auth->max_startups);
  g_assert_cmpuint (fix->max_startups_rate,  ==, test->auth->max_startups_rate);
}

int
main (int argc,
      char *argv[])
{
  cockpit_ws_bridge_program = "/bin/cat";
  cockpit_ws_service_idle = 1;
  cockpit_ws_process_idle = 2;

  cockpit_test_init (&argc, &argv);

  g_test_add ("/auth/application", Test, NULL, NULL, test_application, NULL);
  g_test_add ("/auth/userpass-header-check", Test, NULL, setup, test_userpass_cookie_check, teardown);
  g_test_add ("/auth/userpass-bad", Test, NULL, setup, test_userpass_bad, teardown);
  g_test_add ("/auth/userpass-emptypass", Test, NULL, setup, test_userpass_emptypass, teardown);
  g_test_add ("/auth/headers-bad", Test, NULL, setup, test_headers_bad, teardown);
  g_test_add ("/auth/idle-timeout", Test, NULL, setup, test_idle_timeout, teardown);
  g_test_add ("/auth/process-timeout", Test, NULL, setup, test_process_timeout, teardown);
  g_test_add ("/auth/custom-success", Test, &fixture_no_data,
              setup_normal, test_custom_success, teardown_normal);
  g_test_add ("/auth/custom-success-auth-fd", Test, &fixture_auth_fd,
              setup_normal, test_custom_success, teardown_normal);
  g_test_add ("/auth/custom-success-bad-data", Test, &fixture_bad_data,
              setup_normal, test_custom_success, teardown_normal);
  g_test_add ("/auth/custom-success-with-data", Test, &fixture_data,
              setup_normal, test_custom_success, teardown_normal);
  g_test_add ("/auth/custom-fail-auth", Test, &fixture_auth_failed,
              setup_normal, test_custom_fail, teardown_normal);
  g_test_add ("/auth/custom-denied-auth", Test, &fixture_auth_denied,
              setup_normal, test_custom_fail, teardown_normal);
  g_test_add ("/auth/custom-no-user", Test, &fixture_auth_no_user,
              setup_normal, test_custom_fail, teardown_normal);
  g_test_add ("/auth/custom-with-error", Test, &fixture_auth_with_error,
              setup_normal, test_custom_fail, teardown_normal);
  g_test_add ("/auth/custom-no-write", Test, &fixture_auth_no_write,
              setup_normal, test_custom_fail, teardown_normal);
  g_test_add ("/auth/custom-timeout", Test, &fixture_auth_timeout,
              setup_normal, test_custom_timeout, teardown_normal);

  g_test_add ("/auth/custom-ssh-basic-success", Test, &fixture_ssh_basic,
              setup_normal, test_custom_success, teardown_normal);
  g_test_add ("/auth/custom-ssh-remote-basic-success", Test, &fixture_ssh_remote_basic,
              setup_normal, test_custom_success, teardown_normal);
  g_test_add ("/auth/custom-ssh-remote-switched", Test, &fixture_ssh_remote_switched,
              setup_normal, test_custom_success, teardown_normal);
  g_test_add ("/auth/custom-ssh-with-conf-default", Test, &fixture_ssh_alt_default,
              setup_alt_config, test_custom_success, teardown_normal);
  g_test_add ("/auth/custom-ssh-with-conf-allow", Test, &fixture_ssh_alt,
              setup_alt_config, test_custom_success, teardown_normal);
  g_test_add ("/auth/custom-ssh-success", Test, &fixture_ssh_no_data,
              setup_normal, test_custom_success, teardown_normal);
  g_test_add ("/auth/custom-ssh-success-bad-data", Test, &fixture_ssh_bad_data,
              setup_normal, test_custom_success, teardown_normal);
  g_test_add ("/auth/custom-ssh-success-with-data", Test, &fixture_ssh_data,
              setup_normal, test_custom_success, teardown_normal);
  g_test_add ("/auth/custom-ssh-no-user", Test, &fixture_ssh_auth_no_user,
              setup_normal, test_custom_fail, teardown_normal);
  g_test_add ("/auth/custom-ssh-fail-auth", Test, &fixture_ssh_auth_failed,
              setup_normal, test_custom_fail, teardown_normal);
  g_test_add ("/auth/custom-ssh-fail-basic-auth", Test, &fixture_ssh_basic_failed,
              setup_normal, test_custom_fail, teardown_normal);
  g_test_add ("/auth/custom-ssh-remote-fail-basic-auth", Test, &fixture_ssh_remote_basic_failed,
              setup_normal, test_custom_fail, teardown_normal);
  g_test_add ("/auth/custom-ssh-not-supported", Test, &fixture_ssh_not_supported,
              setup_normal, test_custom_fail, teardown_normal);
  g_test_add ("/auth/custom-ssh-with-error", Test, &fixture_ssh_auth_with_error,
              setup_normal, test_custom_fail, teardown_normal);
  g_test_add ("/auth/custom-ssh-no-write", Test, &fixture_ssh_auth_no_write,
              setup_normal, test_custom_fail, teardown_normal);
  g_test_add ("/auth/success-ssh-multi-step-three", Test, &fixture_ssh_three_steps,
              setup_normal, test_multi_step_success, teardown_normal);
  g_test_add ("/auth/fail-ssh-multi-step-two", Test, &fixture_fail_ssh_two_steps,
              setup_normal, test_multi_step_fail, teardown_normal);

  g_test_add ("/auth/none", Test, &fixture_auth_none,
              setup_normal, test_custom_fail, teardown_normal);
  g_test_add ("/auth/bad-command", Test, &fixture_bad_command,
              setup_normal, test_bad_command, teardown_normal);
  g_test_add ("/auth/success-multi-step-two", Test, &fixture_two_steps,
              setup_normal, test_multi_step_success, teardown_normal);
  g_test_add ("/auth/success-multi-step-three", Test, &fixture_three_steps,
              setup_normal, test_multi_step_success, teardown_normal);
  g_test_add ("/auth/fail-multi-step-two", Test, &fixture_fail_two_steps,
              setup_normal, test_multi_step_fail, teardown_normal);
  g_test_add ("/auth/fail-multi-step-three", Test, &fixture_fail_three_steps,
              setup_normal, test_multi_step_fail, teardown_normal);
  g_test_add ("/auth/fail-multi-step-timeout", Test, &fixture_fail_step_timeout,
              setup_normal, test_multi_step_fail, teardown_normal);
  g_test_add ("/auth/max-startups", Test, NULL,
              setup_normal, test_max_startups, teardown_normal);
  g_test_add ("/auth/max-startups-normal", Test, &fixture_normal,
              setup_startups, test_max_startups_conf, teardown_startups);
  g_test_add ("/auth/max-startups-single", Test, &fixture_single,
              setup_startups, test_max_startups_conf, teardown_startups);
  g_test_add ("/auth/max-startups-double", Test, &fixture_double,
              setup_startups, test_max_startups_conf, teardown_startups);
  g_test_add ("/auth/max-startups-unlimited", Test, &fixture_unlimited,
              setup_startups, test_max_startups_conf, teardown_startups);
  g_test_add ("/auth/max-startups-bad", Test, &fixture_bad,
              setup_startups, test_max_startups_conf, teardown_startups);
  g_test_add ("/auth/max-startups-bad-rate", Test, &fixture_bad_rate,
              setup_startups, test_max_startups_conf, teardown_startups);
  g_test_add ("/auth/max-startups-bad-startups", Test, &fixture_bad_startups,
              setup_startups, test_max_startups_conf, teardown_startups);
  g_test_add ("/auth/max-startups-bad-negative", Test, &fixture_bad_negative,
              setup_startups, test_max_startups_conf, teardown_startups);
  g_test_add ("/auth/max-startups-too-many", Test, &fixture_bad_too_many,
              setup_startups, test_max_startups_conf, teardown_startups);
  return g_test_run ();
}
