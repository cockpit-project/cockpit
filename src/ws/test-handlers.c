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
  GError *error = NULL;
  const gchar *user;

  test->server = cockpit_web_server_new (0, NULL, SRCDIR "/src/ws", NULL, &error);
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
}

static const gchar *
output_as_string (Test *test)
{
  g_assert (g_output_stream_flush (G_OUTPUT_STREAM (test->dataout), NULL, NULL));
  g_assert (g_output_stream_write (G_OUTPUT_STREAM (test->output), "\0", 1, NULL, NULL) == 1);
  return g_memory_output_stream_get_data (G_MEMORY_OUTPUT_STREAM (test->output));
}

static void
assert_matches_msg (const char *domain,
                    const char *file,
                    int line,
                    const char *func,
                    const gchar *string,
                    const gchar *pattern)
{
  gchar *escaped;
  gchar *msg;

  if (!g_pattern_match_simple (pattern, string))
    {
      escaped = g_strescape (pattern, "");
      msg = g_strdup_printf ("does not match: %s\n>>>\n%s\n<<<\n", escaped, string);
      g_assertion_message (domain, file, line, func, msg);
      g_free (escaped);
      g_free (msg);
    }
}

#define assert_matches(str, pattern) \
  assert_matches_msg (G_LOG_DOMAIN, __FILE__, __LINE__, G_STRFUNC, (str), (pattern))

static void
test_login_no_cookie (Test *test,
                      gconstpointer data)
{
  gboolean ret;

  ret = cockpit_handler_login (test->server,
                               COCKPIT_WEB_SERVER_REQUEST_GET, "/login",
                               test->io, test->headers,
                               test->datain, test->dataout, &test->data);

  g_assert (ret == TRUE);

  assert_matches (output_as_string (test), "HTTP/1.1 403 Sorry\r\n*");
}

static void
test_login_with_cookie (Test *test,
                        gconstpointer data)
{
  GError *error = NULL;
  const gchar *user;
  gboolean ret;
  gchar *cookie;
  gchar *base64;
  gchar *userpass;
  gchar *expect;

  user = g_get_user_name ();
  userpass = g_strdup_printf ("%s\n%s", user, PASSWORD);
  cockpit_auth_check_userpass (test->auth, userpass, &cookie, NULL, NULL, &error);
  g_assert_no_error (error);
  g_free (userpass);
  base64 = g_base64_encode ((guchar *)cookie, strlen (cookie));
  g_free (cookie);
  g_hash_table_insert (test->headers, g_strdup ("Cookie"), g_strdup_printf ("CockpitAuth=%s", base64));
  g_free (base64);

  ret = cockpit_handler_login (test->server,
                               COCKPIT_WEB_SERVER_REQUEST_GET, "/login",
                               test->io, test->headers,
                               test->datain, test->dataout, &test->data);

  g_assert (ret == TRUE);

  expect = g_strdup_printf ("HTTP/1.1 200 OK\r\n*\r\n\r\n{\"user\"*:*\"%s\"*,*\"name\"*:*}", user);
  assert_matches (output_as_string (test), expect);
  g_free (expect);
}

static void
test_login_post_bad (Test *test,
                     gconstpointer data)
{
  gboolean ret;

  g_hash_table_insert (test->headers, g_strdup ("Content-Length"), g_strdup ("7"));
  g_memory_input_stream_add_data (test->input, "boooyah", 7, NULL);

  ret = cockpit_handler_login (test->server, COCKPIT_WEB_SERVER_REQUEST_POST, "/login",
                               test->io, test->headers, test->datain, test->dataout, &test->data);

  g_assert (ret == TRUE);
  assert_matches (output_as_string (test), "HTTP/1.1 400 Malformed input\r\n*");
}

static void
test_login_post_fail (Test *test,
                      gconstpointer data)
{
  gboolean ret;

  g_hash_table_insert (test->headers, g_strdup ("Content-Length"), g_strdup ("8"));
  g_memory_input_stream_add_data (test->input, "booo\nyah", 8, NULL);

  ret = cockpit_handler_login (test->server, COCKPIT_WEB_SERVER_REQUEST_POST, "/login",
                               test->io, test->headers, test->datain, test->dataout, &test->data);

  g_assert (ret == TRUE);
  assert_matches (output_as_string (test), "HTTP/1.1 403 Authentication failed\r\n*");
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
  gchar *check;
  gchar *password;
  GHashTable *headers;
  gchar *cookie;
  gchar *end;
  gint length;

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
  assert_matches (output, "HTTP/1.1 200 OK\r\n*");

  /* Check that returned cookie that works */
  headers = split_headers (output);
  cookie = g_strdup (g_hash_table_lookup (headers, "Set-Cookie"));
  g_assert (cookie != NULL);
  end = strchr (cookie, ';');
  g_assert (end != NULL);
  end[0] = '\0';

  g_hash_table_insert (test->headers, g_strdup ("Cookie"), cookie);
  g_assert (cockpit_auth_check_headers (test->auth, test->headers, &check, &password) == TRUE);
  g_assert_cmpstr (check, ==, user);
  g_assert_cmpstr (password, ==, PASSWORD);

  g_hash_table_destroy (headers);
  g_free (check);
  g_free (password);
}

int
main (int argc,
      char *argv[])
{
#if !GLIB_CHECK_VERSION(2,36,0)
  g_type_init ();
#endif

  g_set_prgname ("test-webservice");
  g_test_init (&argc, &argv, NULL);

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

  return g_test_run ();
}
