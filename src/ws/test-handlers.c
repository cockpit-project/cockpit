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

#include "cockpit/cockpittest.h"

#include <glib.h>

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
  GMemoryOutputStream *output;
  GMemoryInputStream *input;
  GDataOutputStream *dataout;
  GDataInputStream *datain;
} Test;

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
  test->dataout = g_data_output_stream_new (G_OUTPUT_STREAM (test->output));

  test->input = G_MEMORY_INPUT_STREAM (g_memory_input_stream_new ());
  test->datain = g_data_input_stream_new (G_INPUT_STREAM (test->input));

  test->io = mock_io_stream_new (G_INPUT_STREAM (test->input),
                                 G_OUTPUT_STREAM (test->output));
}

static void
teardown (Test *test,
          gconstpointer data)
{
  g_clear_object (&test->auth);
  g_clear_object (&test->server);
  g_clear_object (&test->output);
  g_clear_object (&test->dataout);
  g_clear_object (&test->input);
  g_clear_object (&test->dataout);
  g_clear_object (&test->io);
  g_hash_table_destroy (test->headers);

  cockpit_assert_expected ();
}

static const gchar *
output_as_string (Test *test)
{
  g_assert (g_output_stream_flush (G_OUTPUT_STREAM (test->dataout), NULL, NULL));
  g_assert (g_output_stream_write (G_OUTPUT_STREAM (test->output), "\0", 1, NULL, NULL) == 1);
  return g_memory_output_stream_get_data (G_MEMORY_OUTPUT_STREAM (test->output));
}

static void
test_login_no_cookie (Test *test,
                      gconstpointer data)
{
  gboolean ret;

  cockpit_expect_message ("*Returning error-response 401*");

  ret = cockpit_handler_login (test->server,
                               COCKPIT_WEB_SERVER_REQUEST_GET, "/login",
                               test->io, test->headers,
                               test->datain, test->dataout, &test->data);

  g_assert (ret == TRUE);

  cockpit_assert_strmatch (output_as_string (test), "HTTP/1.1 401 Sorry\r\n*");
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
  const gchar *user;
  CockpitCreds *creds;
  gboolean ret;
  gchar *userpass;
  gchar *expect;

  user = g_get_user_name ();
  userpass = g_strdup_printf ("%s\n%s", user, PASSWORD);
  creds = cockpit_auth_check_userpass (test->auth, userpass, FALSE, test->headers, &error);
  g_assert_no_error (error);
  g_assert (creds != NULL);
  cockpit_creds_unref (creds);
  include_cookie_as_if_client (test->headers, test->headers);
  g_free (userpass);

  ret = cockpit_handler_login (test->server,
                               COCKPIT_WEB_SERVER_REQUEST_GET, "/login",
                               test->io, test->headers,
                               test->datain, test->dataout, &test->data);

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

  g_hash_table_insert (test->headers, g_strdup ("Content-Length"), g_strdup ("7"));
  g_memory_input_stream_add_data (test->input, "boooyah", 7, NULL);

  cockpit_expect_message ("*Returning error-response 400*");

  ret = cockpit_handler_login (test->server, COCKPIT_WEB_SERVER_REQUEST_POST, "/login",
                               test->io, test->headers, test->datain, test->dataout, &test->data);

  g_assert (ret == TRUE);
  cockpit_assert_strmatch (output_as_string (test), "HTTP/1.1 400 Malformed input\r\n*");
}

static void
test_login_post_fail (Test *test,
                      gconstpointer data)
{
  gboolean ret;

  g_hash_table_insert (test->headers, g_strdup ("Content-Length"), g_strdup ("8"));
  g_memory_input_stream_add_data (test->input, "booo\nyah", 8, NULL);

  cockpit_expect_message ("*Returning error-response 401*");

  ret = cockpit_handler_login (test->server, COCKPIT_WEB_SERVER_REQUEST_POST, "/login",
                               test->io, test->headers, test->datain, test->dataout, &test->data);

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
  gboolean ret;
  gchar *userpass;
  const gchar *user;
  const gchar *output;
  GHashTable *headers;
  gint length;
  CockpitCreds *creds;

  user = g_get_user_name ();
  userpass = g_strdup_printf ("%s\n%s", user, PASSWORD);
  length = strlen (userpass);
  g_hash_table_insert (test->headers, g_strdup ("Content-Length"), g_strdup_printf ("%d", length));
  g_memory_input_stream_add_data (test->input, userpass, length, g_free);

  ret = cockpit_handler_login (test->server,
                               COCKPIT_WEB_SERVER_REQUEST_POST, "/login",
                               test->io, test->headers,
                               test->datain, test->dataout, &test->data);

  g_assert (ret == TRUE);

  output = output_as_string (test);
  cockpit_assert_strmatch (output, "HTTP/1.1 200 OK\r\n*");

  /* Check that returned cookie that works */
  headers = split_headers (output);
  include_cookie_as_if_client (headers, test->headers);

  creds = cockpit_auth_check_headers (test->auth, test->headers, NULL);
  g_assert (creds != NULL);
  g_assert_cmpstr (cockpit_creds_get_user (creds), ==, user);
  g_assert_cmpstr (cockpit_creds_get_password (creds), ==, PASSWORD);
  cockpit_creds_unref (creds);

  g_hash_table_destroy (headers);
}

static void
test_cockpitdyn (Test *test,
                 gconstpointer data)
{
  const gchar *output;
  gboolean ret;
  gchar hostname[256];
  gchar *expected;

  ret = cockpit_handler_cockpitdyn (test->server,
                                    COCKPIT_WEB_SERVER_REQUEST_GET, "/cockpitdyn.js",
                                    test->io, test->headers,
                                    test->datain, test->dataout, &test->data);

  g_assert (ret == TRUE);

  g_assert (gethostname (hostname, sizeof (hostname)) == 0);
  expected = g_strdup_printf ("HTTP/1.1 200 OK\r\n*cockpitdyn_hostname = \"%s\";\n*cockpitdyn_pretty_hostname*cockpitdyn_supported_languages*",
                              hostname);

  output = output_as_string (test);
  cockpit_assert_strmatch (output, expected);
  cockpit_assert_strmatch (output, "*Content-Type: application/javascript\r\n*");
  g_free (expected);
}

int
main (int argc,
      char *argv[])
{
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

  g_test_add ("/handlers/cockpitdyn", Test, NULL,
              setup, test_cockpitdyn, teardown);

  return g_test_run ();
}
