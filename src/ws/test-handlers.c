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
#include "mock-io-stream.h"

#include "cockpitwebserver.h"
#include "cockpithandlers.h"
#include "cockpitws.h"

#include "cockpit/cockpittest.h"

#include <glib.h>

#include <limits.h>
#include <stdlib.h>
#include <string.h>

#include <sys/types.h>
#include <sys/socket.h>

#define PASSWORD "this is the password"

typedef struct {
  CockpitHandlerData data;
  CockpitWebServer *server;
  CockpitAuth *auth;
  GHashTable *headers;
  GIOStream *io;
  CockpitWebResponse *response;
  GMemoryOutputStream *output;
  GMemoryInputStream *input;
  GByteArray *buffer;
  gchar *scratch;
} Test;

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
setup (Test *test,
       gconstpointer data)
{
  const gchar *roots[] = { SRCDIR "/src/ws", NULL };
  GError *error = NULL;
  const gchar *user;

  test->server = cockpit_web_server_new (0, NULL, roots, NULL, &error);
  g_assert_no_error (error);

  /* Other test->data fields are fine NULL */
  memset (&test->data, 0, sizeof (test->data));

  user = g_get_user_name ();
  test->auth = mock_auth_new (user, PASSWORD);

  test->data.auth = test->auth;

  test->headers = cockpit_web_server_new_table ();

  test->output = G_MEMORY_OUTPUT_STREAM (g_memory_output_stream_new (NULL, 0, g_realloc, g_free));
  test->input = G_MEMORY_INPUT_STREAM (g_memory_input_stream_new ());

  test->io = mock_io_stream_new (G_INPUT_STREAM (test->input),
                                 G_OUTPUT_STREAM (test->output));

  test->response = cockpit_web_response_new (test->io, NULL);
}

static void
teardown (Test *test,
          gconstpointer data)
{
  g_clear_object (&test->auth);
  g_clear_object (&test->server);
  g_clear_object (&test->output);
  g_clear_object (&test->input);
  g_clear_object (&test->io);
  g_hash_table_destroy (test->headers);
  g_free (test->scratch);
  g_object_unref (test->response);

  cockpit_assert_expected ();
}

static const gchar *
output_as_string (Test *test)
{
  while (!g_output_stream_is_closed (G_OUTPUT_STREAM (test->output)))
    g_main_context_iteration (NULL, TRUE);

  g_free (test->scratch);
  test->scratch = g_strndup (g_memory_output_stream_get_data (test->output),
                             g_memory_output_stream_get_data_size (test->output));
  return test->scratch;
}

static void
test_login_no_cookie (Test *test,
                      gconstpointer data)
{
  GBytes *input;
  gboolean ret;

  input = g_bytes_new_static ("", 0);
  ret = cockpit_handler_login (test->server,
                               COCKPIT_WEB_SERVER_REQUEST_GET, "/login",
                               test->headers, input, test->response, &test->data);
  g_bytes_unref (input);

  g_assert (ret == TRUE);

  cockpit_assert_strmatch (output_as_string (test), "HTTP/1.1 401 Not Authorized\r\n*");
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
test_login_with_cookie (Test *test,
                        gconstpointer data)
{
  GError *error = NULL;
  GAsyncResult *result = NULL;
  CockpitWebService *service;
  const gchar *user;
  gboolean ret;
  gchar *userpass;
  gchar *expect;
  GBytes *input;

  user = g_get_user_name ();
  userpass = g_strdup_printf ("%s\n%s", user, PASSWORD);

  input = g_bytes_new_take (userpass, strlen (userpass));
  cockpit_auth_login_async (test->auth, NULL, input, NULL, on_ready_get_result, &result);
  g_bytes_unref (input);
  while (result == NULL)
    g_main_context_iteration (NULL, TRUE);
  service = cockpit_auth_login_finish (test->auth, result, TRUE, test->headers, &error);
  g_object_unref (result);

  g_assert_no_error (error);
  g_assert (service != NULL);
  g_object_unref (service);

  include_cookie_as_if_client (test->headers, test->headers);

  input = g_bytes_new_static ("", 0);
  ret = cockpit_handler_login (test->server,
                               COCKPIT_WEB_SERVER_REQUEST_GET, "/login",
                               test->headers, input, test->response, &test->data);
  g_bytes_unref (input);

  g_assert (ret == TRUE);

  expect = g_strdup_printf ("HTTP/1.1 200 OK\r\n*\r\n\r\n{\"user\"*:*\"%s\"*,*\"name\"*:*}", user);
  cockpit_assert_strmatch (output_as_string (test), expect);
  g_free (expect);
}

static void
test_login_post_bad (Test *test,
                     gconstpointer data)
{
  gboolean ret;
  GBytes *input;

  input = g_bytes_new ("boooyah", 7);

  ret = cockpit_handler_login (test->server, COCKPIT_WEB_SERVER_REQUEST_POST, "/login",
                               test->headers, input, test->response, &test->data);
  g_bytes_unref (input);

  g_assert (ret == TRUE);
  cockpit_assert_strmatch (output_as_string (test), "HTTP/1.1 400 Malformed input\r\n*");
}

static void
test_login_post_fail (Test *test,
                      gconstpointer data)
{
  gboolean ret;
  GBytes *input;

  input = g_bytes_new_static ("booo\nyah", 8);

  ret = cockpit_handler_login (test->server, COCKPIT_WEB_SERVER_REQUEST_POST, "/login",
                               test->headers, input, test->response, &test->data);
  g_bytes_unref (input);

  while (!g_output_stream_is_closed (G_OUTPUT_STREAM (test->output)))
    g_main_context_iteration (NULL, TRUE);

  g_assert (ret == TRUE);
  cockpit_assert_strmatch (output_as_string (test), "HTTP/1.1 401 Authentication failed\r\n*");
}

static GHashTable *
split_headers (const gchar *output)
{
  GHashTable *headers;
  gchar **lines;
  gchar **parts;
  gint i;

  headers = cockpit_web_server_new_table ();
  lines = g_strsplit (output, "\r\n", -1);
  for (i = 1; lines[i] != NULL && lines[i][0] != '\0'; i++)
    {
      parts = g_strsplit (lines[i], ":", 2);
      g_hash_table_insert (headers, g_strstrip (parts[0]), g_strstrip (parts[1]));
      g_free (parts);
    }

  g_strfreev (lines);
  return headers;
}

static void
test_login_post_accept (Test *test,
                        gconstpointer data)
{
  CockpitWebService *service;
  gboolean ret;
  gchar *userpass;
  const gchar *user;
  const gchar *output;
  GHashTable *headers;
  CockpitCreds *creds;
  GBytes *input;

  user = g_get_user_name ();
  userpass = g_strdup_printf ("%s\n%s", user, PASSWORD);
  input = g_bytes_new_take (userpass, strlen (userpass));

  ret = cockpit_handler_login (test->server,
                               COCKPIT_WEB_SERVER_REQUEST_POST, "/login",
                               test->headers, input, test->response, &test->data);
  g_bytes_unref (input);

  g_assert (ret == TRUE);

  output = output_as_string (test);
  cockpit_assert_strmatch (output, "HTTP/1.1 200 OK\r\n*");
  cockpit_assert_strmatch (output, "*Secure; *");

  /* Check that returned cookie that works */
  headers = split_headers (output);
  include_cookie_as_if_client (headers, test->headers);

  service = cockpit_auth_check_cookie (test->auth, test->headers);
  g_assert (service != NULL);
  creds = cockpit_web_service_get_creds (service);
  g_assert_cmpstr (cockpit_creds_get_user (creds), ==, user);
  g_assert_cmpstr (cockpit_creds_get_password (creds), ==, PASSWORD);

  g_hash_table_destroy (headers);
  g_object_unref (service);
}

static void
test_index (Test *test,
            gconstpointer data)
{
  const gchar *output;
  gboolean ret;
  gchar hostname[256];
  gchar *expected;
  GBytes *input;

  input = g_bytes_new_static ("", 0);
  ret = cockpit_handler_index (test->server,
                               COCKPIT_WEB_SERVER_REQUEST_GET, "/",
                               test->headers, input, test->response, &test->data);
  g_bytes_unref (input);

  g_assert (ret == TRUE);

  g_assert (gethostname (hostname, sizeof (hostname)) == 0);
  expected = g_strdup_printf ("HTTP/1.1 200 OK\r\n*\"hostname\":\"%s\"*",
                              hostname);

  output = output_as_string (test);
  cockpit_assert_strmatch (output, expected);
  cockpit_assert_strmatch (output, "*Content-Type: text/html; charset=utf8\r\n*");
  g_free (expected);
}

static void
test_logout (Test *test,
             gconstpointer data)
{
  const gchar *output;
  gboolean ret;
  GBytes *input;

  input = g_bytes_new_static ("", 0);
  ret = cockpit_handler_logout (test->server,
                                COCKPIT_WEB_SERVER_REQUEST_GET, "/logout",
                                test->headers, input, test->response, &test->data);
  g_bytes_unref (input);

  g_assert (ret == TRUE);

  output = output_as_string (test);
  cockpit_assert_strmatch (output, "HTTP/1.1 200 OK\r\n*Set-Cookie: CockpitAuth=blank;*Secure*Logged out*");
}

static void
test_favicon_ico (Test *test,
                  gconstpointer data)
{
  const gchar *output;
  gboolean ret;
  GBytes *input;

  input = g_bytes_new_static ("", 0);
  ret = cockpit_handler_root (test->server,
                              COCKPIT_WEB_SERVER_REQUEST_GET, "/favicon.ico",
                              test->headers, input, test->response, &test->data);

  g_assert (ret == TRUE);

  output = output_as_string (test);
  cockpit_assert_strmatch (output,
                           "HTTP/1.1 200 OK\r\n"
                           "Content-Length: 1150\r\n"
                           "*");
}

int
main (int argc,
      char *argv[])
{
  gchar *root;
  gint ret;

  root = realpath (SRCDIR "/src/static", NULL);
  g_assert (root != NULL);

  cockpit_ws_static_directory = root;
  cockpit_ws_content_directory = SRCDIR "/src/web";
  cockpit_ws_session_program = BUILDDIR "/cockpit-session";
  cockpit_ws_agent_program = BUILDDIR "/cockpit-agent";

  cockpit_test_init (&argc, &argv);

  g_test_add ("/handlers/login/no-cookie", Test, NULL,
              setup, test_login_no_cookie, teardown);
  g_test_add ("/handlers/login/with-cookie", Test, NULL,
              setup, test_login_with_cookie, teardown);
  g_test_add ("/handlers/login/post-bad", Test, NULL,
              setup, test_login_post_bad, teardown);
  g_test_add ("/handlers/login/post-fail", Test, NULL,
              setup, test_login_post_fail, teardown);
  g_test_add ("/handlers/login/post-accept", Test, NULL,
              setup, test_login_post_accept, teardown);

  g_test_add ("/handlers/logout", Test, NULL,
              setup, test_logout, teardown);

  g_test_add ("/handlers/index", Test, NULL,
              setup, test_index, teardown);

  g_test_add ("/handlers/favicon", Test, NULL,
              setup, test_favicon_ico, teardown);

  ret = g_test_run ();

  free (root);

  return ret;
}
