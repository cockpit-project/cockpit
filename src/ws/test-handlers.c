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

#include "common/cockpitconf.h"
#include "common/cockpittest.h"
#include "common/mock-io-stream.h"
#include "common/cockpitwebserver.h"

#include <glib.h>

#include <limits.h>
#include <stdlib.h>
#include <string.h>

#include <sys/types.h>
#include <sys/socket.h>

/* Mock override this from cockpitconf.c */
extern const gchar *cockpit_config_file;

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
  gchar *login_html;
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
base_setup (Test *test)
{
  const gchar *static_roots[] = { SRCDIR "/src/ws", SRCDIR "/src/branding/default", NULL };
  GError *error = NULL;
  const gchar *user;

  test->server = cockpit_web_server_new (NULL, 0, NULL, NULL, &error);
  g_assert_no_error (error);

  /* Other test->data fields are fine NULL */
  memset (&test->data, 0, sizeof (test->data));

  user = g_get_user_name ();
  test->auth = mock_auth_new (user, PASSWORD);
  test->roots = cockpit_web_response_resolve_roots (static_roots);
  test->login_html = g_strdup(SRCDIR "/src/ws/login.html");

  test->data.auth = test->auth;
  test->data.branding_roots = (const gchar **)test->roots;
  test->data.login_html = (const gchar *)test->login_html;

  test->headers = cockpit_web_server_new_table ();

  test->output = G_MEMORY_OUTPUT_STREAM (g_memory_output_stream_new (NULL, 0, g_realloc, g_free));
  test->input = G_MEMORY_INPUT_STREAM (g_memory_input_stream_new ());

  test->io = mock_io_stream_new (G_INPUT_STREAM (test->input),
                                 G_OUTPUT_STREAM (test->output));
}

static void
setup (Test *test,
       gconstpointer path)
{
  base_setup (test);
  test->response = cockpit_web_response_new (test->io, path, path, NULL, NULL);
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
  g_free (test->login_html);
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
  JsonObject *response;
  GHashTable *headers;
  const gchar *user;
  gboolean ret;

  user = g_get_user_name ();
  headers = mock_auth_basic_header (user, PASSWORD);

  cockpit_auth_login_async (test->auth, path, NULL, headers, on_ready_get_result, &result);
  g_hash_table_unref (headers);
  while (result == NULL)
    g_main_context_iteration (NULL, TRUE);
  response = cockpit_auth_login_finish (test->auth, result, NULL, test->headers, &error);
  g_object_unref (result);

  g_assert_no_error (error);
  g_assert (response != NULL);
  json_object_unref (response);

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

static void
test_login_fail_with_data (Test *test,
                           gconstpointer path)
{
  gboolean ret;
  GHashTable *headers;
  JsonObject *object = json_object_new ();

  mock_auth_set_failure_data ((MockAuth *)test->auth, object);

  headers = mock_auth_basic_header ("booo", "yah");
  ret = cockpit_handler_default (test->server, path, test->headers, test->response, &test->data);
  g_hash_table_unref (headers);

  while (!test->response_done)
    g_main_context_iteration (NULL, TRUE);

  g_assert (ret == TRUE);
  cockpit_assert_strmatch (output_as_string (test), "HTTP/1.1 401 Authentication required\r\n*");
  cockpit_assert_strmatch (output_as_string (test), "*{}*");
  cockpit_assert_strmatch (output_as_string (test), "*\r\nContent-Type: application/json\r\n*");
  json_object_unref (object);
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
  const gchar *token;

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
  g_assert_cmpstr (g_bytes_get_data (cockpit_creds_get_password (creds), NULL), ==, PASSWORD);

  token = cockpit_creds_get_csrf_token (creds);
  g_assert (strstr (output, token));

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
  const gchar *org_path;
  const gchar *auth;
  const gchar *expect;
  const gchar *config;
  gboolean with_home;
} DefaultFixture;

static void
setup_default (Test *test,
               gconstpointer data)
{
  const DefaultFixture *fixture = data;
  JsonObject *response;
  GError *error = NULL;
  GAsyncResult *result = NULL;
  GHashTable *headers;
  const gchar *user;

  cockpit_config_file = fixture->config;

  g_setenv ("XDG_DATA_DIRS", SRCDIR "/src/bridge/mock-resource/system", TRUE);
  if (fixture->with_home)
    g_setenv ("XDG_DATA_HOME", SRCDIR "/src/bridge/mock-resource/home", TRUE);
  else
    g_setenv ("XDG_DATA_HOME", "/nonexistant", TRUE);

  base_setup (test);
  test->response = cockpit_web_response_new (test->io,
                                            fixture->org_path ? fixture->org_path : fixture->path,
                                            fixture->path, NULL, NULL);
  g_signal_connect (test->response, "done",
                    G_CALLBACK (on_web_response_done_set_flag),
                    &test->response_done);

  if (fixture->auth)
    {
      user = g_get_user_name ();
      headers = mock_auth_basic_header (user, PASSWORD);

      cockpit_auth_login_async (test->auth, fixture->auth, NULL, headers, on_ready_get_result, &result);
      g_hash_table_unref (headers);
      while (result == NULL)
        g_main_context_iteration (NULL, TRUE);
      response = cockpit_auth_login_finish (test->auth, result, NULL, test->headers, &error);
      g_object_unref (result);

      g_assert_no_error (error);
      g_assert (response != NULL);
      json_object_unref (response);

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
  cockpit_conf_cleanup ();
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
  .path = "/cockpit/$386257ed81a663cdd7ee12633056dee18d60ddca/test/sub/file.ext",
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
  response = cockpit_web_response_new (io, path, path, NULL, NULL);
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


static const DefaultFixture fixture_shell_path_index = {
  .path = "/",
  .org_path = "/path/",
  .auth = "/cockpit",
  .with_home = TRUE,
  .expect = "HTTP/1.1 200*"
      "<base href=\"/path/cockpit/@localhost/another/test.html\">*"
      "<title>In home dir</title>*"
};

static const DefaultFixture fixture_shell_path_package = {
  .path = "/system/host",
  .org_path = "/path/system/host",
  .auth = "/cockpit",
  .expect = "HTTP/1.1 200*"
      "<base href=\"/path/cockpit/$386257ed81a663cdd7ee12633056dee18d60ddca/another/test.html\">*"
      "<title>In system dir</title>*"
};

static const DefaultFixture fixture_shell_path_host = {
  .path = "/@localhost/system/host",
  .org_path = "/path/@localhost/system/host",
  .with_home = TRUE,
  .auth = "/cockpit",
  .expect = "HTTP/1.1 200*"
      "<base href=\"/path/cockpit/@localhost/another/test.html\">*"
      "<title>In home dir</title>*"
};

static const DefaultFixture fixture_shell_path_login = {
  .path = "/system/host",
  .org_path = "/path/system/host",
  .auth = NULL,
  .expect = "HTTP/1.1 200*"
      "<html>*"
      "<base href=\"/path/\">*"
      "login-button*"
};

static const DefaultFixture fixture_shell_index = {
  .path = "/",
  .auth = "/cockpit",
  .with_home = TRUE,
  .expect = "HTTP/1.1 200*"
      "<base href=\"/cockpit/@localhost/another/test.html\">*"
      "<title>In home dir</title>*"
};

static const DefaultFixture fixture_machine_shell_index = {
  .path = "/=machine",
  .auth = "/cockpit+=machine",
  .with_home = TRUE,
  .expect = "HTTP/1.1 200*"
      "<base href=\"/cockpit+=machine/@localhost/another/test.html\">*"
      "<title>In home dir</title>*"
};

static const DefaultFixture fixture_shell_configured_index = {
  .path = "/",
  .auth = "/cockpit",
  .with_home = TRUE,
  .config = SRCDIR "/src/ws/mock-config/cockpit/cockpit.conf",
  .expect = "HTTP/1.1 200*"
      "<base href=\"/cockpit/@localhost/second/test.html\">*"
      "<title>In system dir</title>*"
};

static const DefaultFixture fixture_shell_package = {
  .path = "/system/host",
  .auth = "/cockpit",
  .expect = "HTTP/1.1 200*"
      "<base href=\"/cockpit/$386257ed81a663cdd7ee12633056dee18d60ddca/another/test.html\">*"
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

static const DefaultFixture fixture_machine_shell_package_short = {
  .path = "/=/",
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
      "<base href=\"/\">*"
      "login-button*"
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
    "login-button*"
};

static const DefaultFixture fixture_static_simple = {
  .path = "/cockpit/static/branding.css",
  .auth = "/cockpit",
  .expect = "HTTP/1.1 200*"
    "Cache-Control: max-age=31556926, public*"
    "#badge*"
    "url(\"logo.png\");*"
};

static const DefaultFixture fixture_host_static = {
  .path = "/cockpit+=host/static/branding.css",
  .auth = "/cockpit+=host",
  .expect = "HTTP/1.1 200*"
    "Cache-Control: max-age=86400, private*"
    "#badge*"
    "url(\"logo.png\");*"
};

static const DefaultFixture fixture_host_static_no_auth = {
  .path = "/cockpit+=host/static/branding.css",
  .expect = "HTTP/1.1 403*"
};

static const DefaultFixture fixture_static_application = {
  .path = "/cockpit+application/static/branding.css",
  .auth = NULL,
  .expect = "HTTP/1.1 200*"
    "Cache-Control: max-age=31556926, public*"
    "#badge*"
    "url(\"logo.png\");*"
};

static void
make_io_streams (GIOStream **io_a,
                 GIOStream **io_b)
{
  GSocket *socket1, *socket2;
  GError *error = NULL;
  int fds[2];

  if (socketpair (PF_UNIX, SOCK_STREAM, 0, fds) < 0)
    g_assert_not_reached ();

  socket1 = g_socket_new_from_fd (fds[0], &error);
  g_assert_no_error (error);

  socket2 = g_socket_new_from_fd (fds[1], &error);
  g_assert_no_error (error);

  *io_a = G_IO_STREAM (g_socket_connection_factory_create_connection (socket1));
  *io_b = G_IO_STREAM (g_socket_connection_factory_create_connection (socket2));

  g_object_unref (socket1);
  g_object_unref (socket2);
}

static void
on_error_not_reached (WebSocketConnection *ws,
                      GError *error,
                      gpointer user_data)
{
  g_assert (error != NULL);

  /* At this point we know this will fail, but is informative */
  g_assert_no_error (error);
}

static void
on_message_get_bytes (WebSocketConnection *ws,
                      WebSocketDataType type,
                      GBytes *message,
                      gpointer user_data)
{
  GBytes **received = user_data;
  g_assert_cmpint (type, ==, WEB_SOCKET_DATA_TEXT);
  if (*received != NULL)
    {
      gsize length;
      gconstpointer data = g_bytes_get_data (message, &length);
      g_test_message ("received unexpected extra message: %.*s", (int)length, (gchar *)data);
      g_assert_not_reached ();
    }
  *received = g_bytes_ref (message);
}

static void
test_socket_unauthenticated (void)
{
  WebSocketConnection *client;
  GBytes *received = NULL;
  GIOStream *io_a, *io_b;
  GBytes *payload;
  const gchar *problem;
  const gchar *command;
  const gchar *unused;
  gchar *channel;
  JsonObject *options;

  make_io_streams (&io_a, &io_b);

  client = g_object_new (WEB_SOCKET_TYPE_CLIENT,
                         "url", "ws://127.0.0.1/unused",
                         "origin", "http://127.0.0.1",
                         "io-stream", io_a,
                         NULL);

  g_signal_connect (client, "error", G_CALLBACK (on_error_not_reached), NULL);

  /* Matching the above origin */
  cockpit_ws_default_host_header = "127.0.0.1";

  g_assert (cockpit_handler_socket (NULL, "/cockpit/socket", "/cockpit/socket",
                                    io_b, NULL, NULL, NULL));

  g_signal_connect (client, "message", G_CALLBACK (on_message_get_bytes), &received);

  /* Should close right after opening */
  while (web_socket_connection_get_ready_state (client) != WEB_SOCKET_STATE_CLOSED)
    g_main_context_iteration (NULL, TRUE);

  /* And we should have received a message */
  g_assert (received != NULL);

  payload = cockpit_transport_parse_frame (received, &channel);
  g_assert (payload != NULL);
  g_assert (channel == NULL);
  g_bytes_unref (received);

  g_assert (cockpit_transport_parse_command (payload, &command, &unused, &options));
  g_bytes_unref (payload);

  g_assert_cmpstr (command, ==, "init");
  g_assert (cockpit_json_get_string (options, "problem", NULL, &problem));
  g_assert_cmpstr (problem, ==, "no-session");
  json_object_unref (options);

  g_object_unref (client);

  while (g_main_context_iteration (NULL, FALSE));

  g_object_unref (io_a);
  g_object_unref (io_b);
}

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
  g_test_add ("/handlers/login/post-fail-with-data", Test, "/cockpit/login",
              setup, test_login_fail_with_data, teardown);
  g_test_add ("/handlers/login/post-accept", Test, "/cockpit/login",
              setup, test_login_accept, teardown);

  g_test_add ("/handlers/ping", Test, "/ping",
              setup, test_ping, teardown);

  g_test_add ("/handlers/shell/index", Test, &fixture_shell_index,
              setup_default, test_default, teardown_default);
  g_test_add ("/handlers/shell/machine-index", Test, &fixture_machine_shell_index,
              setup_default, test_default, teardown_default);
  g_test_add ("/handlers/shell/configured_index", Test, &fixture_shell_configured_index,
              setup_default, test_default, teardown_default);
  g_test_add ("/handlers/shell/package", Test, &fixture_shell_package,
              setup_default, test_default, teardown_default);
  g_test_add ("/handlers/shell/host", Test, &fixture_shell_host,
              setup_default, test_default, teardown_default);
  g_test_add ("/handlers/shell/host-short", Test, &fixture_shell_host_short,
              setup_default, test_default, teardown_default);
  g_test_add ("/handlers/shell/package-short", Test, &fixture_shell_package_short,
              setup_default, test_default, teardown_default);
  g_test_add ("/handlers/shell/machine-package-short", Test, &fixture_machine_shell_package_short,
              setup_default, test_default, teardown_default);
  g_test_add ("/handlers/shell/package-invalid", Test, &fixture_shell_package_invalid,
              setup_default, test_default, teardown_default);
  g_test_add ("/handlers/shell/login", Test, &fixture_shell_login,
              setup_default, test_default, teardown_default);
  g_test_add ("/handlers/shell/path-index", Test, &fixture_shell_path_index,
              setup_default, test_default, teardown_default);
  g_test_add ("/handlers/shell/path-package", Test, &fixture_shell_path_package,
              setup_default, test_default, teardown_default);
  g_test_add ("/handlers/shell/path-host", Test, &fixture_shell_path_host,
              setup_default, test_default, teardown_default);
  g_test_add ("/handlers/shell/path-login", Test, &fixture_shell_path_login,
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
  g_test_add ("/handlers/static/host-static", Test, &fixture_host_static,
              setup_default, test_default, teardown_default);
  g_test_add ("/handlers/static/host-static-no-auth", Test, &fixture_host_static_no_auth,
              setup_default, test_default, teardown_default);
  g_test_add ("/handlers/static/application", Test, &fixture_static_application,
              setup_default, test_default, teardown_default);

  g_test_add ("/handlers/favicon", Test, "/favicon.ico",
              setup, test_favicon_ico, teardown);

  g_test_add_func ("/handlers/noauth", test_socket_unauthenticated);

  return g_test_run ();
}
