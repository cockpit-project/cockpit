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

#include "cockpithandlers.h"
#include "cockpitws.h"

#include "common/cockpittest.h"
#include "common/mock-io-stream.h"
#include "common/cockpitwebserver.h"

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
  gboolean response_done;
  GMemoryOutputStream *output;
  GMemoryInputStream *input;
  GByteArray *buffer;
  gchar *scratch;
  gchar **roots;
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
on_web_response_done_set_flag (CockpitWebResponse *response,
                               gboolean reuse,
                               gpointer user_data)
{
  gboolean *flag = user_data;
  g_assert (flag != NULL);
  g_assert (*flag == FALSE);
  *flag = TRUE;
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
  test->roots = cockpit_web_server_resolve_roots (SRCDIR "/src/static", SRCDIR "/branding/default", NULL);

  test->data.auth = test->auth;
  test->data.static_roots = (const gchar **)test->roots;

  test->headers = cockpit_web_server_new_table ();

  test->output = G_MEMORY_OUTPUT_STREAM (g_memory_output_stream_new (NULL, 0, g_realloc, g_free));
  test->input = G_MEMORY_INPUT_STREAM (g_memory_input_stream_new ());

  test->io = mock_io_stream_new (G_INPUT_STREAM (test->input),
                                 G_OUTPUT_STREAM (test->output));

  test->response = cockpit_web_response_new (test->io, NULL, NULL, NULL);
  g_signal_connect (test->response, "done",
                    G_CALLBACK (on_web_response_done_set_flag),
                    &test->response_done);
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
  g_strfreev (test->roots);

  cockpit_assert_expected ();
}

static const gchar *
output_as_string (Test *test)
{
  while (!test->response_done)
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
  gboolean ret;

  ret = cockpit_handler_login (test->server, "/login",
                               test->headers, test->response, &test->data);

  g_assert (ret == TRUE);

  cockpit_assert_strmatch (output_as_string (test), "HTTP/1.1 401 Authentication failed\r\n*");
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
  GHashTable *headers;
  const gchar *user;
  gboolean ret;

  user = g_get_user_name ();
  headers = mock_auth_basic_header (user, PASSWORD);

  cockpit_auth_login_async (test->auth, headers, NULL, on_ready_get_result, &result);
  g_hash_table_unref (headers);
  while (result == NULL)
    g_main_context_iteration (NULL, TRUE);
  service = cockpit_auth_login_finish (test->auth, result, 0, test->headers, &error);
  g_object_unref (result);

  g_assert_no_error (error);
  g_assert (service != NULL);
  g_object_unref (service);

  include_cookie_as_if_client (test->headers, test->headers);

  ret = cockpit_handler_login (test->server, "/login",
                               test->headers, test->response, &test->data);

  g_assert (ret == TRUE);

  cockpit_assert_strmatch (output_as_string (test), "HTTP/1.1 200 OK\r\n*\r\n\r\n{*");
}

static void
test_login_bad (Test *test,
                gconstpointer data)
{
  gboolean ret;
  GHashTable *headers;

  headers = cockpit_web_server_new_table ();
  g_hash_table_insert (headers, g_strdup ("Authorization"), g_strdup ("booyah"));
  ret = cockpit_handler_login (test->server, "/login",
                               headers, test->response, &test->data);
  g_hash_table_unref (headers);

  g_assert (ret == TRUE);
  cockpit_assert_strmatch (output_as_string (test), "HTTP/1.1 401 Authentication failed\r\n*");
}

static void
test_login_fail (Test *test,
                 gconstpointer data)
{
  gboolean ret;
  GHashTable *headers;

  headers = mock_auth_basic_header ("booo", "yah");
  ret = cockpit_handler_login (test->server, "/login",
                               test->headers, test->response, &test->data);
  g_hash_table_unref (headers);

  while (!test->response_done)
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
test_login_accept (Test *test,
                   gconstpointer data)
{
  CockpitWebService *service;
  gboolean ret;
  const gchar *user;
  const gchar *output;
  GHashTable *headers;
  CockpitCreds *creds;

  user = g_get_user_name ();
  headers = mock_auth_basic_header (user, PASSWORD);

  ret = cockpit_handler_login (test->server, "/login",
                               headers, test->response, &test->data);
  g_hash_table_unref (headers);

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

  ret = cockpit_handler_resource (test->server, "/",
                                  test->headers, test->response, &test->data);

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
test_favicon_ico (Test *test,
                  gconstpointer data)
{
  const gchar *output;
  gboolean ret;

  ret = cockpit_handler_root (test->server, "/favicon.ico",
                              test->headers, test->response, &test->data);

  g_assert (ret == TRUE);

  output = output_as_string (test);
  cockpit_assert_strmatch (output,
                           "HTTP/1.1 200 OK\r\n"
                           "Content-Length: *\r\n"
                           "*");
}

static void
test_ping (Test *test,
           gconstpointer data)
{
  const gchar *output;
  gboolean ret;

  ret = cockpit_handler_ping (test->server, "/ping",
                              test->headers, test->response, &test->data);

  g_assert (ret == TRUE);

  output = output_as_string (test);
  cockpit_assert_strmatch (output,
                           "HTTP/1.1 200 OK\r\n*"
                           "Access-Control-Allow-Origin: *\r\n*"
                           "\"cockpit\"*");
}

int
main (int argc,
      char *argv[])
{
  cockpit_ws_session_program = BUILDDIR "/cockpit-session";
  cockpit_ws_bridge_program = "/bin/cat";

  cockpit_test_init (&argc, &argv);

  g_test_add ("/handlers/login/no-cookie", Test, NULL,
              setup, test_login_no_cookie, teardown);
  g_test_add ("/handlers/login/with-cookie", Test, NULL,
              setup, test_login_with_cookie, teardown);
  g_test_add ("/handlers/login/post-bad", Test, NULL,
              setup, test_login_bad, teardown);
  g_test_add ("/handlers/login/post-fail", Test, NULL,
              setup, test_login_fail, teardown);
  g_test_add ("/handlers/login/post-accept", Test, NULL,
              setup, test_login_accept, teardown);

  g_test_add ("/handlers/ping", Test, NULL,
              setup, test_ping, teardown);

  g_test_add ("/handlers/index", Test, NULL,
              setup, test_index, teardown);

  g_test_add ("/handlers/favicon", Test, NULL,
              setup, test_favicon_ico, teardown);

  return g_test_run ();
}
