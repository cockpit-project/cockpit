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
       gconstpointer path)
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

  test->response = cockpit_web_response_new (test->io, path, NULL, NULL);
  g_signal_connect (test->response, "done",
                    G_CALLBACK (on_web_response_done_set_flag),
                    &test->response_done);
}

static void
teardown (Test *test,
          gconstpointer path)
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
                      gconstpointer path)
{
  gboolean ret;

  ret = cockpit_handler_default (test->server, path, test->headers, test->response, &test->data);

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
                        gconstpointer path)
{
  GError *error = NULL;
  GAsyncResult *result = NULL;
  CockpitWebService *service;
  GHashTable *headers;
  const gchar *user;
  gboolean ret;

  user = g_get_user_name ();
  headers = mock_auth_basic_header (user, PASSWORD);

  cockpit_auth_login_async (test->auth, path, headers, NULL, on_ready_get_result, &result);
  g_hash_table_unref (headers);
  while (result == NULL)
    g_main_context_iteration (NULL, TRUE);
  service = cockpit_auth_login_finish (test->auth, result, 0, test->headers, &error);
  g_object_unref (result);

  g_assert_no_error (error);
  g_assert (service != NULL);
  g_object_unref (service);

  include_cookie_as_if_client (test->headers, test->headers);

  ret = cockpit_handler_default (test->server, path, test->headers, test->response, &test->data);

  g_assert (ret == TRUE);

  cockpit_assert_strmatch (output_as_string (test), "HTTP/1.1 200 OK\r\n*\r\n\r\n{*");
}

static void
test_login_bad (Test *test,
                gconstpointer path)
{
  gboolean ret;
  GHashTable *headers;

  headers = cockpit_web_server_new_table ();
  g_hash_table_insert (headers, g_strdup ("Authorization"), g_strdup ("booyah"));
  ret = cockpit_handler_default (test->server, path, headers, test->response, &test->data);
  g_hash_table_unref (headers);

  g_assert (ret == TRUE);
  cockpit_assert_strmatch (output_as_string (test), "HTTP/1.1 401 Authentication failed\r\n*");
}

static void
test_login_fail (Test *test,
                 gconstpointer path)
{
  gboolean ret;
  GHashTable *headers;

  headers = mock_auth_basic_header ("booo", "yah");
  ret = cockpit_handler_default (test->server, path, test->headers, test->response, &test->data);
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
                   gconstpointer path)
{
  CockpitWebService *service;
  gboolean ret;
  const gchar *user;
  const gchar *output;
  GHashTable *headers;
  CockpitCreds *creds;

  user = g_get_user_name ();
  headers = mock_auth_basic_header (user, PASSWORD);

  ret = cockpit_handler_default (test->server, path, headers, test->response, &test->data);
  g_hash_table_unref (headers);

  g_assert (ret == TRUE);

  output = output_as_string (test);
  cockpit_assert_strmatch (output, "HTTP/1.1 200 OK\r\n*");
  cockpit_assert_strmatch (output, "*Secure; *");

  /* Check that returned cookie that works */
  headers = split_headers (output);
  include_cookie_as_if_client (headers, test->headers);

  service = cockpit_auth_check_cookie (test->auth, "/cockpit", test->headers);
  g_assert (service != NULL);
  creds = cockpit_web_service_get_creds (service);
  g_assert_cmpstr (cockpit_creds_get_user (creds), ==, user);
  g_assert_cmpstr (cockpit_creds_get_password (creds), ==, PASSWORD);

  g_hash_table_destroy (headers);
  g_object_unref (service);
}

static void
test_favicon_ico (Test *test,
                  gconstpointer path)
{
  const gchar *output;
  gboolean ret;

  ret = cockpit_handler_root (test->server, path, test->headers, test->response, &test->data);

  g_assert (ret == TRUE);

  output = output_as_string (test);
  cockpit_assert_strmatch (output,
                           "HTTP/1.1 200 OK\r\n*"
                           "Content-Length: *\r\n"
                           "*");
}

static void
test_ping (Test *test,
           gconstpointer path)
{
  const gchar *output;
  gboolean ret;

  ret = cockpit_handler_ping (test->server, path, test->headers, test->response, &test->data);

  g_assert (ret == TRUE);

  output = output_as_string (test);
  cockpit_assert_strmatch (output,
                           "HTTP/1.1 200 OK\r\n*"
                           "Access-Control-Allow-Origin: *\r\n*"
                           "\"cockpit\"*");
}

typedef struct {
  const gchar *path;
  const gchar *auth;
  const gchar *expect;
  gboolean with_home;
} DefaultFixture;

static void
setup_default (Test *test,
               gconstpointer data)
{
  const DefaultFixture *fixture = data;
  CockpitWebService *service;
  GError *error = NULL;
  GAsyncResult *result = NULL;
  GHashTable *headers;
  const gchar *user;

  g_setenv ("XDG_DATA_DIRS", SRCDIR "/src/bridge/mock-resource/system", TRUE);
  if (fixture->with_home)
    g_setenv ("XDG_DATA_HOME", SRCDIR "/src/bridge/mock-resource/home", TRUE);
  else
    g_setenv ("XDG_DATA_HOME", "/nonexistant", TRUE);

  setup (test, fixture->path);

  if (fixture->auth)
    {
      user = g_get_user_name ();
      headers = mock_auth_basic_header (user, PASSWORD);

      cockpit_auth_login_async (test->auth, fixture->auth, headers, NULL, on_ready_get_result, &result);
      g_hash_table_unref (headers);
      while (result == NULL)
        g_main_context_iteration (NULL, TRUE);
      service = cockpit_auth_login_finish (test->auth, result, 0, test->headers, &error);
      g_object_unref (result);

      g_assert_no_error (error);
      g_assert (service != NULL);
      g_object_unref (service);

      include_cookie_as_if_client (test->headers, test->headers);
    }
}

static void
teardown_default (Test *test,
                  gconstpointer data)
{
  const DefaultFixture *fixture = data;

  g_unsetenv ("XDG_DATA_DIRS");
  g_unsetenv ("XDG_DATA_HOME");

  teardown (test, fixture->path);
};

static void
test_default (Test *test,
              gconstpointer data)
{
  const DefaultFixture *fixture = data;
  gboolean ret;

  ret = cockpit_handler_default (test->server, fixture->path, test->headers, test->response, &test->data);

  if (fixture->expect)
    {
      g_assert (ret == TRUE);
      cockpit_assert_strmatch (output_as_string (test), fixture->expect);
    }
  else
    {
      g_assert (ret == FALSE);
    }
}

static const DefaultFixture fixture_resource_checksum = {
  .path = "/cockpit/$71100b932eb766ef9043f855974ae8e3834173e2/test/sub/file.ext",
  .auth = "/cockpit",
  .expect = "HTTP/1.1 200*"
    "These are the contents of file.ext*"
};

static void
test_resource_checksum (Test *test,
                        gconstpointer data)
{
  CockpitWebResponse *response;
  gboolean response_done = FALSE;
  GInputStream *input;
  GOutputStream *output;
  GIOStream *io;
  gchar *string;
  const gchar *path;

  /* Prime the checksums with dummy request */
  output = g_memory_output_stream_new (NULL, 0, g_realloc, g_free);
  input = g_memory_input_stream_new ();
  io = mock_io_stream_new (input, output);
  path = "/cockpit/@localhost/checksum";
  response = cockpit_web_response_new (io, path, NULL, NULL);
  g_signal_connect (response, "done", G_CALLBACK (on_web_response_done_set_flag), &response_done);
  g_assert (cockpit_handler_default (test->server, path, test->headers, response, &test->data));

  while (!response_done)
    g_main_context_iteration (NULL, TRUE);

  string = g_strndup (g_memory_output_stream_get_data (G_MEMORY_OUTPUT_STREAM (output)),
                      g_memory_output_stream_get_data_size (G_MEMORY_OUTPUT_STREAM (output)));
  cockpit_assert_strmatch (string, "HTTP/1.1 200*");
  g_free (string);

  g_object_unref (output);
  g_object_unref (input);
  g_object_unref (io);
  g_object_unref (response);

  /* And now run the real test */
  test_default (test, data);
}


static const DefaultFixture fixture_shell_index = {
  .path = "/",
  .auth = "/cockpit",
  .with_home = TRUE,
  .expect = "HTTP/1.1 200*"
      "<base href=\"/cockpit/@localhost/another/test.html\">*"
      "<title>In home dir</title>*"
};

static const DefaultFixture fixture_shell_package = {
  .path = "/system/host",
  .auth = "/cockpit",
  .expect = "HTTP/1.1 200*"
      "<base href=\"/cockpit/$71100b932eb766ef9043f855974ae8e3834173e2/another/test.html\">*"
      "<title>In system dir</title>*"
};

static const DefaultFixture fixture_shell_host = {
  .path = "/@localhost/system/host",
  .with_home = TRUE,
  .auth = "/cockpit",
  .expect = "HTTP/1.1 200*"
      "<base href=\"/cockpit/@localhost/another/test.html\">*"
      "<title>In home dir</title>*"
};

static const DefaultFixture fixture_shell_host_short = {
  .path = "/@/system/page",
  .auth = "/cockpit",
  .expect = "HTTP/1.1 404*"
};

static const DefaultFixture fixture_shell_package_short = {
  .path = "//page",
  .auth = "/cockpit",
  .expect = "HTTP/1.1 404*"
};

static const DefaultFixture fixture_shell_package_invalid = {
  .path = "/invalid.path/page",
  .auth = "/cockpit",
  .expect = "HTTP/1.1 404*"
};

static const DefaultFixture fixture_shell_login = {
  .path = "/system/host",
  .auth = NULL,
  .expect = "HTTP/1.1 200*"
      "<html>*"
      "show_login()*"
};

static const DefaultFixture fixture_resource_short = {
  .path = "/cockpit",
  .auth = "/cockpit",
  .expect = "HTTP/1.1 404*"
};

static const DefaultFixture fixture_resource_host = {
  .path = "/cockpit/@localhost/test/sub/file.ext",
  .auth = "/cockpit",
  .expect = "HTTP/1.1 200*"
    "These are the contents of file.ext*"
};

static const DefaultFixture fixture_resource_host_short = {
  .path = "/cockpit/@/test/sub/file.ext",
  .auth = "/cockpit",
  .expect = "HTTP/1.1 404*"
};

static const DefaultFixture fixture_resource_application = {
  .path = "/cockpit+application/@localhost/test/sub/file.ext",
  .auth = "/cockpit+application",
  .expect = "HTTP/1.1 200*"
    "These are the contents of file.ext*"
};

static const DefaultFixture fixture_resource_application_short = {
  .path = "/cockpit+/@localhost/test/sub/file.ext",
  .auth = "/cockpit+",
  .expect = "HTTP/1.1 401*"
};

static const DefaultFixture fixture_resource_missing = {
  .path = "/cockpit/another/file.html",
  .auth = "/cockpit",
  .expect = "HTTP/1.1 404*"
};

static const DefaultFixture fixture_resource_auth = {
  .path = "/cockpit/@localhost/yyy/zzz",
  .auth = NULL,
  .expect = "HTTP/1.1 401*"
};

static const DefaultFixture fixture_resource_login = {
  .path = "/cockpit/@localhost/yyy/zzz.html",
  .auth = NULL,
  .expect = "HTTP/1.1 200*"
    "<html>*"
    "show_login()*"
};

static const DefaultFixture fixture_static_simple = {
  .path = "/cockpit/static/branding.css",
  .auth = NULL,
  .expect = "HTTP/1.1 200*"
    "#index-brand*"
    "url(\"brand.png\");*"
};

static const DefaultFixture fixture_static_application = {
  .path = "/cockpit+application/static/branding.css",
  .auth = NULL,
  .expect = "HTTP/1.1 200*"
    "#index-brand*"
    "url(\"brand.png\");*"
};

int
main (int argc,
      char *argv[])
{
  /* See mock-resource */
  cockpit_ws_shell_component = "/another/test.html";

  cockpit_test_init (&argc, &argv);

  g_test_add ("/handlers/login/no-cookie", Test, "/cockpit/login",
              setup, test_login_no_cookie, teardown);
  g_test_add ("/handlers/login/with-cookie", Test, "/cockpit+app/login",
              setup, test_login_with_cookie, teardown);
  g_test_add ("/handlers/login/post-bad", Test, "/cockpit/login",
              setup, test_login_bad, teardown);
  g_test_add ("/handlers/login/post-fail", Test, "/cockpit/login",
              setup, test_login_fail, teardown);
  g_test_add ("/handlers/login/post-accept", Test, "/cockpit/login",
              setup, test_login_accept, teardown);

  g_test_add ("/handlers/ping", Test, "/ping",
              setup, test_ping, teardown);

  g_test_add ("/handlers/shell/index", Test, &fixture_shell_index,
              setup_default, test_default, teardown_default);
  g_test_add ("/handlers/shell/package", Test, &fixture_shell_package,
              setup_default, test_default, teardown_default);
  g_test_add ("/handlers/shell/host", Test, &fixture_shell_host,
              setup_default, test_default, teardown_default);
  g_test_add ("/handlers/shell/host-short", Test, &fixture_shell_host_short,
              setup_default, test_default, teardown_default);
  g_test_add ("/handlers/shell/package-short", Test, &fixture_shell_package_short,
              setup_default, test_default, teardown_default);
  g_test_add ("/handlers/shell/package-invalid", Test, &fixture_shell_package_invalid,
              setup_default, test_default, teardown_default);
  g_test_add ("/handlers/shell/login", Test, &fixture_shell_login,
              setup_default, test_default, teardown_default);

  g_test_add ("/handlers/resource/checksum", Test, &fixture_resource_checksum,
              setup_default, test_resource_checksum, teardown_default);

  g_test_add ("/handlers/resource/short", Test, &fixture_resource_short,
              setup_default, test_default, teardown_default);
  g_test_add ("/handlers/resource/host", Test, &fixture_resource_host,
              setup_default, test_default, teardown_default);
  g_test_add ("/handlers/resource/host-short", Test, &fixture_resource_host_short,
              setup_default, test_default, teardown_default);
  g_test_add ("/handlers/resource/application", Test, &fixture_resource_application,
              setup_default, test_default, teardown_default);
  g_test_add ("/handlers/resource/application-short", Test, &fixture_resource_application_short,
              setup_default, test_default, teardown_default);
  g_test_add ("/handlers/resource/missing", Test, &fixture_resource_missing,
              setup_default, test_default, teardown_default);
  g_test_add ("/handlers/resource/auth", Test, &fixture_resource_auth,
              setup_default, test_default, teardown_default);
  g_test_add ("/handlers/resource/login", Test, &fixture_resource_login,
              setup_default, test_default, teardown_default);

  g_test_add ("/handlers/static/simple", Test, &fixture_static_simple,
              setup_default, test_default, teardown_default);
  g_test_add ("/handlers/static/application", Test, &fixture_static_application,
              setup_default, test_default, teardown_default);

  g_test_add ("/handlers/favicon", Test, "/favicon.ico",
              setup, test_favicon_ico, teardown);

  return g_test_run ();
}
