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

#include "cockpitcreds.h"
#include "cockpitwebservice.h"
#include "cockpitws.h"

#include "common/cockpitpipe.h"
#include "common/cockpitpipetransport.h"
#include "common/cockpittransport.h"
#include "common/cockpitjson.h"
#include "common/cockpittest.h"
#include "common/mock-io-stream.h"
#include "common/cockpitwebserver.h"
#include "common/cockpitconf.h"

#include "websocket/websocket.h"

#include <glib.h>

#include <string.h>
#include <errno.h>

#include <sys/types.h>
#include <sys/socket.h>
#include <sys/wait.h>

/* Mock override from cockpitconf.c */
extern const gchar *cockpit_config_file;

/* Mock override from cockpitwebservice.c */
extern const gchar *cockpit_ws_default_protocol_header;

#define TIMEOUT 30

#define WAIT_UNTIL(cond) \
  G_STMT_START \
    while (!(cond)) g_main_context_iteration (NULL, TRUE); \
  G_STMT_END

#define PASSWORD "this is the password"

typedef struct {
  /* setup default transport */
  CockpitTransport *mock_bridge;
  GPid mock_bridge_pid;

  /* setup_mock_webserver */
  CockpitWebServer *web_server;
  gchar *cookie;
  CockpitCreds *creds;

  /* setup_io_pair */
  GIOStream *io_a;
  GIOStream *io_b;

  /* serve_socket */
  CockpitWebService *service;
} TestCase;

typedef struct {
  const char *origin;
  const char *config;
  const char *forward;
  const char *bridge;
} TestFixture;

static gboolean
on_transport_control (CockpitTransport *transport,
                      const char *command,
                      const gchar *channel,
                      JsonObject *options,
                      GBytes *payload,
                      gpointer data)
{
  gboolean *flag = data;
  g_assert (flag != NULL);

  if (g_str_equal (command, "init"))
    *flag = TRUE;

  return FALSE;
}

static void
setup_mock_bridge (TestCase *test,
                   gconstpointer data)
{
  const TestFixture *fix = data;

  CockpitPipe *pipe = NULL;
  const gchar *cmd;

  if (fix && fix->bridge)
    cmd = fix->bridge;
  else
    cmd = BUILDDIR "/mock-echo";

  const gchar *argv[] = {
      cmd,
      NULL
  };

  pipe = cockpit_pipe_spawn (argv, NULL, NULL, COCKPIT_PIPE_FLAGS_NONE);
  test->mock_bridge = cockpit_pipe_transport_new (pipe);
  g_assert (cockpit_pipe_get_pid (pipe, &test->mock_bridge_pid));
  g_object_unref (pipe);
}

static void
teardown_mock_bridge (TestCase *test,
                      gconstpointer data)
{
  if (test->mock_bridge)
    {
      cockpit_transport_close (test->mock_bridge, "terminate");
      g_object_add_weak_pointer (G_OBJECT (test->mock_bridge), (gpointer *)&test->mock_bridge);
      g_object_unref (test->mock_bridge);
      g_assert (test->mock_bridge == NULL);
    }
}

static void
setup_mock_webserver (TestCase *test,
                      gconstpointer data)
{
  GError *error = NULL;
  GBytes *password;

  /* Zero port makes server choose its own */
  test->web_server = cockpit_web_server_new (NULL, 0, NULL, NULL, &error);
  g_assert_no_error (error);

  cockpit_web_server_start (test->web_server);

  password = g_bytes_new_take (g_strdup (PASSWORD), strlen (PASSWORD));
  test->creds = cockpit_creds_new ("cockpit",
                                   COCKPIT_CRED_USER, "me",
                                   COCKPIT_CRED_PASSWORD, password,
                                   COCKPIT_CRED_CSRF_TOKEN, "my-csrf-token",
                                   NULL);
  g_bytes_unref (password);
}

static void
teardown_mock_webserver (TestCase *test,
                         gconstpointer data)
{
  g_clear_object (&test->web_server);
  if (test->creds)
    cockpit_creds_unref (test->creds);
  g_free (test->cookie);
}

static void
setup_io_streams (TestCase *test,
                  gconstpointer data)
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

  test->io_a = G_IO_STREAM (g_socket_connection_factory_create_connection (socket1));
  test->io_b = G_IO_STREAM (g_socket_connection_factory_create_connection (socket2));

  g_object_unref (socket1);
  g_object_unref (socket2);
}

static void
teardown_io_streams (TestCase *test,
                     gconstpointer data)
{
  g_clear_object (&test->io_a);
  g_clear_object (&test->io_b);
}

static void
setup_for_socket (TestCase *test,
                  gconstpointer data)
{
  alarm (TIMEOUT);

  setup_mock_bridge (test, data);
  setup_mock_webserver (test, data);
  setup_io_streams (test, data);
}

static void
teardown_for_socket (TestCase *test,
                     gconstpointer data)
{
  teardown_mock_bridge (test, data);
  teardown_mock_webserver (test, data);
  teardown_io_streams (test, data);

  cockpit_assert_expected ();
  alarm (0);
}

static gboolean
on_error_not_reached (WebSocketConnection *ws,
                      GError *error,
                      gpointer user_data)
{
  g_assert (error != NULL);

  /* At this point we know this will fail, but is informative */
  g_assert_no_error (error);
  return TRUE;
}

static gboolean
on_error_copy (WebSocketConnection *ws,
               GError *error,
               gpointer user_data)
{
  GError **result = user_data;
  g_assert (error != NULL);
  g_assert (result != NULL);
  g_assert (*result == NULL);
  *result = g_error_copy (error);
  return TRUE;
}

static gboolean
on_timeout_fail (gpointer data)
{
  g_error ("timeout during test: %s", (gchar *)data);
  return FALSE;
}

#define BUILD_INTS GINT_TO_POINTER(1)

static GBytes *
builder_to_bytes (JsonBuilder *builder)
{
  GBytes *bytes;
  gchar *data;
  gsize length;
  JsonNode *node;

  json_builder_end_object (builder);
  node = json_builder_get_root (builder);
  data = cockpit_json_write (node, &length);
  data = g_realloc (data, length + 1);
  memmove (data + 1, data, length);
  memcpy (data, "\n", 1);
  bytes = g_bytes_new_take (data, length + 1);
  json_node_free (node);
  return bytes;
}

static GBytes *
build_control_va (const gchar *command,
                  const gchar *channel,
                  va_list va)
{
  GBytes *bytes;
  JsonBuilder *builder;
  const gchar *option;
  gboolean strings = TRUE;

  builder = json_builder_new ();
  json_builder_begin_object (builder);
  json_builder_set_member_name (builder, "command");
  json_builder_add_string_value (builder, command);
  if (channel)
    {
      json_builder_set_member_name (builder, "channel");
      json_builder_add_string_value (builder, channel);
    }

  for (;;)
    {
      option = va_arg (va, const gchar *);
      if (option == BUILD_INTS)
        {
          strings = FALSE;
          option = va_arg (va, const gchar *);
        }
      if (!option)
        break;
      json_builder_set_member_name (builder, option);
      if (strings)
        json_builder_add_string_value (builder, va_arg (va, const gchar *));
      else
        json_builder_add_int_value (builder, va_arg (va, gint));
    }

  bytes = builder_to_bytes (builder);
  g_object_unref (builder);

  return bytes;
}

static void
send_control_message (WebSocketConnection *ws,
                      const gchar *command,
                      const gchar *channel,
                      ...) G_GNUC_NULL_TERMINATED;

static void
send_control_message (WebSocketConnection *ws,
                      const gchar *command,
                      const gchar *channel,
                      ...)
{
  GBytes *payload;
  va_list va;

  va_start (va, channel);
  payload = build_control_va (command, channel, va);
  va_end (va);

  web_socket_connection_send (ws, WEB_SOCKET_DATA_TEXT, NULL, payload);
  g_bytes_unref (payload);
}

static void
expect_control_message (GBytes *message,
                        const gchar *command,
                        const gchar *expected_channel,
                        ...) G_GNUC_NULL_TERMINATED;

static void
expect_control_message (GBytes *message,
                        const gchar *expected_command,
                        const gchar *expected_channel,
                        ...)
{
  gchar *outer_channel;
  const gchar *message_command;
  const gchar *message_channel;
  JsonObject *options;
  GBytes *payload;
  const gchar *expect_option;
  const gchar *expect_value;
  const gchar *value;
  va_list va;

  payload = cockpit_transport_parse_frame (message, &outer_channel);
  g_assert (payload != NULL);
  g_assert_cmpstr (outer_channel, ==, NULL);
  g_free (outer_channel);

  g_assert (cockpit_transport_parse_command (payload, &message_command,
                                             &message_channel, &options));
  g_bytes_unref (payload);

  g_assert_cmpstr (expected_command, ==, message_command);
  g_assert_cmpstr (expected_channel, ==, expected_channel);

  va_start (va, expected_channel);
  for (;;) {
      expect_option = va_arg (va, const gchar *);
      if (!expect_option)
        break;
      expect_value = va_arg (va, const gchar *);
      g_assert (expect_value != NULL);
      value = NULL;
      if (json_object_has_member (options, expect_option))
        value = json_object_get_string_member (options, expect_option);
      g_assert_cmpstr (value, ==, expect_value);
  }
  va_end (va);

  json_object_unref (options);
}

static void
start_web_service_and_create_client (TestCase *test,
                                     const TestFixture *fixture,
                                     WebSocketConnection **ws,
                                     CockpitWebService **service)
{
  cockpit_config_file = fixture ? fixture->config : NULL;
  const char *origin = fixture ? fixture->origin : NULL;
  gboolean ready = FALSE;
  gulong handler;

  if (!origin)
    origin = "http://127.0.0.1";

  /* This is web_socket_client_new_for_stream() */
  *ws = g_object_new (WEB_SOCKET_TYPE_CLIENT,
                     "url", "ws://127.0.0.1/unused",
                     "origin", origin,
                     "io-stream", test->io_a,
                     NULL);

  g_signal_connect (*ws, "error", G_CALLBACK (on_error_not_reached), NULL);
  web_socket_client_include_header (WEB_SOCKET_CLIENT (*ws), "Cookie", test->cookie);

  /* Matching the above origin */
  cockpit_ws_default_host_header = "127.0.0.1";
  cockpit_ws_default_protocol_header = fixture ? fixture->forward : NULL;

  *service = cockpit_web_service_new (test->creds, test->mock_bridge);

  /* Manually created services won't be init'd yet, wait for that before sending data */
  handler = g_signal_connect (test->mock_bridge, "control", G_CALLBACK (on_transport_control), &ready);

  while (!ready)
    g_main_context_iteration (NULL, TRUE);

  /* Note, we are forcing the websocket to parse its own headers */
  cockpit_web_service_socket (*service, "/unused", test->io_b, NULL, NULL);

  g_signal_handler_disconnect (test->mock_bridge, handler);
}

static void
start_web_service_and_connect_client (TestCase *test,
                                      const TestFixture *fixture,
                                      WebSocketConnection **ws,
                                      CockpitWebService **service)
{
  GBytes *message;

  start_web_service_and_create_client (test, fixture, ws, service);
  WAIT_UNTIL (web_socket_connection_get_ready_state (*ws) != WEB_SOCKET_STATE_CONNECTING);
  g_assert (web_socket_connection_get_ready_state (*ws) == WEB_SOCKET_STATE_OPEN);

  /* Send the open control message that starts the bridge. */
  send_control_message (*ws, "init", NULL, BUILD_INTS, "version", 1, NULL);
  send_control_message (*ws, "open", "4", "payload", "echo", NULL);

  /* This message should be echoed */
  message = g_bytes_new ("4\ntest", 6);
  web_socket_connection_send (*ws, WEB_SOCKET_DATA_TEXT, NULL, message);
  g_bytes_unref (message);
}

static void
close_client_and_stop_web_service (TestCase *test,
                                   WebSocketConnection *ws,
                                   CockpitWebService *service)
{
  guint timeout;

  if (web_socket_connection_get_ready_state (ws) == WEB_SOCKET_STATE_OPEN)
    {
      web_socket_connection_close (ws, 0, NULL);
      WAIT_UNTIL (web_socket_connection_get_ready_state (ws) == WEB_SOCKET_STATE_CLOSED);
    }

  g_object_unref (ws);

  /* Wait until service is done */
  timeout = g_timeout_add_seconds (20, on_timeout_fail, "closing web service");
  g_object_add_weak_pointer (G_OBJECT (service), (gpointer *)&service);
  g_object_unref (service);
  while (service != NULL)
    g_main_context_iteration (NULL, TRUE);
  g_source_remove (timeout);
  cockpit_conf_cleanup ();
}

static void
test_handshake_and_auth (TestCase *test,
                         gconstpointer data)
{
  WebSocketConnection *ws;
  CockpitWebService *service;

  start_web_service_and_connect_client (test, data, &ws, &service);
  close_client_and_stop_web_service (test, ws, service);
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
on_message_get_non_control (WebSocketConnection *ws,
                            WebSocketDataType type,
                            GBytes *message,
                            gpointer user_data)
{
  GBytes **received = user_data;
  g_assert_cmpint (type, ==, WEB_SOCKET_DATA_TEXT);
  /* Control messages have this prefix: ie: a zero channel */
  if (g_str_has_prefix (g_bytes_get_data (message, NULL), "\n"))
      return;
  g_assert (*received == NULL);
  *received = g_bytes_ref (message);
}

static void
on_message_get_control (WebSocketConnection *ws,
                        WebSocketDataType type,
                        GBytes *message,
                        gpointer user_data)
{
  JsonObject **received = user_data;
  GError *error = NULL;

  g_assert_cmpint (type, ==, WEB_SOCKET_DATA_TEXT);

  /* Control messages have this prefix: ie: a zero channel */
  if (g_str_has_prefix (g_bytes_get_data (message, NULL), "\n"))
    {
      g_assert (*received == NULL);
      *received = cockpit_json_parse_bytes (message, &error);
      g_assert_no_error (error);
    }
}


static void
test_handshake_and_echo (TestCase *test,
                         gconstpointer data)
{
  WebSocketConnection *ws;
  GBytes *received = NULL;
  GBytes *control = NULL;
  CockpitWebService *service;
  CockpitCreds *creds;
  GBytes *sent;
  gulong handler;
  const gchar *token;

  /* Sends a "test" message in channel "4" */
  start_web_service_and_connect_client (test, data, &ws, &service);

  sent = g_bytes_new_static ("4\ntest", 6);
  handler = g_signal_connect (ws, "message", G_CALLBACK (on_message_get_bytes), &control);

  WAIT_UNTIL (control != NULL);

  creds = cockpit_web_service_get_creds (service);
  g_assert (creds != NULL);

  token = cockpit_creds_get_csrf_token (creds);
  g_assert_cmpstr (token, ==, "my-csrf-token");

  expect_control_message (control, "init", NULL, "csrf-token", token, NULL);
  g_bytes_unref (control);

  g_signal_handler_disconnect (ws, handler);
  handler = g_signal_connect (ws, "message", G_CALLBACK (on_message_get_non_control), &received);

  WAIT_UNTIL (received != NULL);

  g_assert (g_bytes_equal (received, sent));
  g_bytes_unref (sent);
  g_bytes_unref (received);
  received = NULL;

  g_signal_handler_disconnect (ws, handler);

  close_client_and_stop_web_service (test, ws, service);
}

static void
test_echo_large (TestCase *test,
                 gconstpointer data)
{
  WebSocketConnection *ws;
  GBytes *received = NULL;
  CockpitWebService *service;
  gchar *contents;
  GBytes *sent;
  gulong handler;

  start_web_service_and_create_client (test, data, &ws, &service);
  while (web_socket_connection_get_ready_state (ws) == WEB_SOCKET_STATE_CONNECTING)
    g_main_context_iteration (NULL, TRUE);
  g_assert (web_socket_connection_get_ready_state (ws) == WEB_SOCKET_STATE_OPEN);

  /* Send the open control message that starts the bridge. */
  send_control_message (ws, "init", NULL, BUILD_INTS, "version", 1, NULL);
  send_control_message (ws, "open", "4", "payload", "test-text", NULL);
  handler = g_signal_connect (ws, "message", G_CALLBACK (on_message_get_non_control), &received);

  /* Medium length */
  contents = g_strnfill (1020, '!');
  contents[0] = '4'; /* channel */
  contents[1] = '\n';
  sent = g_bytes_new_take (contents, 1020);
  web_socket_connection_send (ws, WEB_SOCKET_DATA_TEXT, NULL, sent);
  WAIT_UNTIL (received != NULL);
  g_assert (g_bytes_equal (received, sent));
  g_bytes_unref (sent);
  g_bytes_unref (received);
  received = NULL;

  /* Extra large */
  contents = g_strnfill (100 * 1000, '?');
  contents[0] = '4'; /* channel */
  contents[1] = '\n';
  sent = g_bytes_new_take (contents, 100 * 1000);
  web_socket_connection_send (ws, WEB_SOCKET_DATA_TEXT, NULL, sent);
  WAIT_UNTIL (received != NULL);
  g_assert (g_bytes_equal (received, sent));
  g_bytes_unref (sent);
  g_bytes_unref (received);
  received = NULL;

  g_signal_handler_disconnect (ws, handler);
  close_client_and_stop_web_service (test, ws, service);
}

static void
test_close_error (TestCase *test,
                  gconstpointer data)
{
  WebSocketConnection *ws;
  GBytes *received = NULL;
  CockpitWebService *service;

  start_web_service_and_connect_client (test, data, &ws, &service);
  g_signal_connect (ws, "message", G_CALLBACK (on_message_get_bytes), &received);

  WAIT_UNTIL (received != NULL);
  expect_control_message (received, "init", NULL, NULL);
  g_bytes_unref (received);
  received = NULL;

  WAIT_UNTIL (received != NULL);
  expect_control_message (received, "hint", NULL, NULL);
  g_bytes_unref (received);
  received = NULL;

 /* Silly test echos the "open" message */
  WAIT_UNTIL (received != NULL);
  expect_control_message (received, "open", "4", NULL);
  g_bytes_unref (received);
  received = NULL;

  WAIT_UNTIL (received != NULL);
  g_bytes_unref (received);
  received = NULL;

  /* Trigger a failure message */
  g_assert (web_socket_connection_get_ready_state (ws) == WEB_SOCKET_STATE_OPEN);
  kill (test->mock_bridge_pid, SIGTERM);

  /* We should now get a close command */
  WAIT_UNTIL (web_socket_connection_get_ready_state (ws) == WEB_SOCKET_STATE_CLOSED);

  close_client_and_stop_web_service (test, ws, service);
}

static void
test_no_init (TestCase *test,
              gconstpointer data)
{
  WebSocketConnection *ws;
  GBytes *received = NULL;
  CockpitWebService *service;

  start_web_service_and_create_client (test, data, &ws, &service);
  g_signal_connect (ws, "message", G_CALLBACK (on_message_get_bytes), &received);

  while (web_socket_connection_get_ready_state (ws) == WEB_SOCKET_STATE_CONNECTING)
    g_main_context_iteration (NULL, TRUE);
  g_assert (web_socket_connection_get_ready_state (ws) == WEB_SOCKET_STATE_OPEN);

  cockpit_expect_message ("*socket did not send*init*");
  cockpit_expect_log ("WebSocket", G_LOG_LEVEL_MESSAGE, "connection unexpectedly closed*");

  /* Sending an open message before init, should cause problems */
  send_control_message (ws, "ping", NULL, NULL);

  /* The init from the other end */
  while (received == NULL)
    g_main_context_iteration (NULL, TRUE);
  expect_control_message (received, "init", NULL, NULL);
  g_bytes_unref (received);
  received = NULL;

  /* A hint from the other end */
  while (received == NULL)
    g_main_context_iteration (NULL, TRUE);
  expect_control_message (received, "hint", NULL, NULL);
  g_bytes_unref (received);
  received = NULL;

  /* We should now get a failure */
  while (received == NULL)
    g_main_context_iteration (NULL, TRUE);
  expect_control_message (received, "close", NULL, "problem", "protocol-error", NULL);
  g_bytes_unref (received);
  received = NULL;

  close_client_and_stop_web_service (test, ws, service);
}

static void
test_wrong_init_version (TestCase *test,
                         gconstpointer data)
{
  WebSocketConnection *ws;
  GBytes *received = NULL;
  CockpitWebService *service;

  start_web_service_and_create_client (test, data, &ws, &service);
  g_signal_connect (ws, "message", G_CALLBACK (on_message_get_bytes), &received);

  while (web_socket_connection_get_ready_state (ws) == WEB_SOCKET_STATE_CONNECTING)
    g_main_context_iteration (NULL, TRUE);
  g_assert (web_socket_connection_get_ready_state (ws) == WEB_SOCKET_STATE_OPEN);

  cockpit_expect_message ("*socket used unsupported*");
  cockpit_expect_log ("WebSocket", G_LOG_LEVEL_MESSAGE, "connection unexpectedly closed*");

  send_control_message (ws, "init", NULL, BUILD_INTS, "version", 888, NULL);

  /* The init from the other end */
  while (received == NULL)
    g_main_context_iteration (NULL, TRUE);
  expect_control_message (received, "init", NULL, NULL);
  g_bytes_unref (received);
  received = NULL;

  /* A hint from the other end */
  while (received == NULL)
    g_main_context_iteration (NULL, TRUE);
  expect_control_message (received, "hint", NULL, NULL);
  g_bytes_unref (received);
  received = NULL;

  /* We should now get a failure */
  while (received == NULL)
    g_main_context_iteration (NULL, TRUE);
  expect_control_message (received, "close", NULL, "problem", "not-supported", NULL);
  g_bytes_unref (received);
  received = NULL;

  close_client_and_stop_web_service (test, ws, service);
}

static void
test_bad_init_version (TestCase *test,
                       gconstpointer data)
{
  WebSocketConnection *ws;
  GBytes *received = NULL;
  CockpitWebService *service;

  start_web_service_and_create_client (test, data, &ws, &service);
  g_signal_connect (ws, "message", G_CALLBACK (on_message_get_bytes), &received);

  while (web_socket_connection_get_ready_state (ws) == WEB_SOCKET_STATE_CONNECTING)
    g_main_context_iteration (NULL, TRUE);
  g_assert (web_socket_connection_get_ready_state (ws) == WEB_SOCKET_STATE_OPEN);

  cockpit_expect_warning ("*invalid version field*");
  cockpit_expect_log ("WebSocket", G_LOG_LEVEL_MESSAGE, "connection unexpectedly closed*");

  send_control_message (ws, "init", NULL, "version", "blah", NULL);

  /* The init from the other end */
  while (received == NULL)
    g_main_context_iteration (NULL, TRUE);
  expect_control_message (received, "init", NULL, NULL);
  g_bytes_unref (received);
  received = NULL;

  /* A hint from the other end */
  while (received == NULL)
    g_main_context_iteration (NULL, TRUE);
  expect_control_message (received, "hint", NULL, NULL);
  g_bytes_unref (received);
  received = NULL;

  /* We should now get a failure */
  while (received == NULL)
    g_main_context_iteration (NULL, TRUE);
  expect_control_message (received, "close", NULL, "problem", "protocol-error", NULL);
  g_bytes_unref (received);
  received = NULL;

  close_client_and_stop_web_service (test, ws, service);
}

static void
test_socket_null_creds (TestCase *test,
                        gconstpointer data)
{
  CockpitWebService *service;
  CockpitTransport *session;
  int pair[2];

  /*
   * These are tests double checking that we *never*
   * open up a real CockpitWebService for NULL creds.
   *
   * Other code paths do the real checks, but these are
   * the last resorts.
   */

  cockpit_expect_critical ("*assertion*failed*");

  service = cockpit_web_service_new (NULL, NULL);
  g_assert (service == NULL);

  cockpit_expect_critical ("*assertion*failed*");

  g_assert (pipe(pair) >= 0);
  session = cockpit_pipe_transport_new_fds ("dummy", pair[0], pair[1]);
  service = cockpit_web_service_new (NULL, session);
  g_assert (service == NULL);
  g_object_unref (session);
}

static const TestFixture fixture_bad_origin_rfc6455 = {
  .origin = "http://another-place.com",
  .config = NULL
};

static const TestFixture fixture_allowed_origin_rfc6455 = {
  .origin = "https://another-place.com",
  .config = SRCDIR "/src/ws/mock-config/cockpit/cockpit.conf"
};

static const TestFixture fixture_allowed_origin_proto_header = {
  .origin = "https://127.0.0.1",
  .forward = "https",
  .config = SRCDIR "/src/ws/mock-config/cockpit/cockpit-alt.conf"
};

static const TestFixture fixture_bad_origin_proto_no_header = {
  .origin = "https://127.0.0.1",
  .config = SRCDIR "/src/ws/mock-config/cockpit/cockpit-alt.conf"
};

static const TestFixture fixture_bad_origin_proto_no_config = {
  .origin = "https://127.0.0.1",
  .forward = "https",
  .config = NULL
};

static void
test_bad_origin (TestCase *test,
                 gconstpointer data)
{
  WebSocketConnection *ws;
  CockpitWebService *service;
  GError *error = NULL;

  cockpit_expect_log ("WebSocket", G_LOG_LEVEL_MESSAGE, "*received request from bad Origin*");
  cockpit_expect_log ("WebSocket", G_LOG_LEVEL_MESSAGE, "*invalid handshake*");
  cockpit_expect_log ("WebSocket", G_LOG_LEVEL_MESSAGE, "*unexpected status: 403*");

  start_web_service_and_create_client (test, data, &ws, &service);

  g_signal_handlers_disconnect_by_func (ws, on_error_not_reached, NULL);
  g_signal_connect (ws, "error", G_CALLBACK (on_error_copy), &error);

  while (web_socket_connection_get_ready_state (ws) == WEB_SOCKET_STATE_CONNECTING ||
         web_socket_connection_get_ready_state (ws) == WEB_SOCKET_STATE_CLOSING)
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpint (web_socket_connection_get_ready_state (ws), ==, WEB_SOCKET_STATE_CLOSED);
  g_assert_error (error, WEB_SOCKET_ERROR, WEB_SOCKET_CLOSE_PROTOCOL);

  close_client_and_stop_web_service (test, ws, service);
  g_clear_error (&error);
}

static const TestFixture fixture_kill_group = {
    .bridge = BUILDDIR "/cockpit-bridge"
};

static void
test_kill_group (TestCase *test,
                 gconstpointer data)
{
  WebSocketConnection *ws;
  GBytes *received = NULL;
  CockpitWebService *service;
  GHashTable *seen;
  gchar *ochannel;
  const gchar *channel;
  const gchar *command;
  JsonObject *options;
  GBytes *sent;
  GBytes *payload;
  gulong handler;

  /* Sends a "test" message in channel "4" */
  start_web_service_and_connect_client (test, data, &ws, &service);

  sent = g_bytes_new_static ("4\ntest", 6);
  handler = g_signal_connect (ws, "message", G_CALLBACK (on_message_get_non_control), &received);

  /* Drain the initial message */
  WAIT_UNTIL (received != NULL);
  g_assert (g_bytes_equal (sent, received));
  g_bytes_unref (received);
  received = NULL;

  g_signal_handler_disconnect (ws, handler);
  handler = g_signal_connect (ws, "message", G_CALLBACK (on_message_get_bytes), &received);

  seen = g_hash_table_new (g_str_hash, g_str_equal);
  g_hash_table_add (seen, "a");
  g_hash_table_add (seen, "b");
  g_hash_table_add (seen, "c");

  send_control_message (ws, "open", "a", "payload", "echo", "group", "test", NULL);
  send_control_message (ws, "open", "b", "payload", "echo", "group", "test", NULL);
  send_control_message (ws, "open", "c", "payload", "echo", "group", "test", NULL);

  /* Kill all the above channels */
  send_control_message (ws, "kill", NULL, "group", "test", NULL);

  /* All the close messages */
  while (g_hash_table_size (seen) > 0)
    {
      WAIT_UNTIL (received != NULL);

      payload = cockpit_transport_parse_frame (received, &ochannel);
      g_bytes_unref (received);
      received = NULL;

      g_assert (payload != NULL);
      g_assert_cmpstr (ochannel, ==, NULL);
      g_free (ochannel);

      g_assert (cockpit_transport_parse_command (payload, &command, &channel, &options));
      g_bytes_unref (payload);

      if (!g_str_equal (command, "open") && !g_str_equal (command, "ready"))
        {
          g_assert_cmpstr (command, ==, "close");
          g_assert_cmpstr (json_object_get_string_member (options, "problem"), ==, "terminated");
          g_assert (g_hash_table_remove (seen, channel));
        }
      json_object_unref (options);
    }

  g_hash_table_destroy (seen);

  g_signal_handler_disconnect (ws, handler);
  handler = g_signal_connect (ws, "message", G_CALLBACK (on_message_get_non_control), &received);

  /* Now verify that the original channel is still open */
  web_socket_connection_send (ws, WEB_SOCKET_DATA_TEXT, NULL, sent);

  WAIT_UNTIL (received != NULL);
  g_assert (g_bytes_equal (received, sent));
  g_bytes_unref (sent);
  g_bytes_unref (received);
  received = NULL;

  g_signal_handler_disconnect (ws, handler);

  close_client_and_stop_web_service (test, ws, service);
}

static void
test_kill_host (TestCase *test,
                gconstpointer data)
{
  WebSocketConnection *ws;
  GBytes *received = NULL;
  CockpitWebService *service;
  GHashTable *seen;
  gchar *ochannel;
  const gchar *channel;
  const gchar *command;
  JsonObject *options;
  GBytes *payload;
  gulong handler;

  /* Sends a "test" message in channel "4" */
  start_web_service_and_connect_client (test, data, &ws, &service);

  handler = g_signal_connect (ws, "message", G_CALLBACK (on_message_get_non_control), &received);

  /* Drain the initial message */
  WAIT_UNTIL (received != NULL);
  g_bytes_unref (received);
  received = NULL;

  g_signal_handler_disconnect (ws, handler);
  handler = g_signal_connect (ws, "message", G_CALLBACK (on_message_get_bytes), &received);

  seen = g_hash_table_new (g_str_hash, g_str_equal);
  g_hash_table_add (seen, "a");
  g_hash_table_add (seen, "b");
  g_hash_table_add (seen, "c");
  g_hash_table_add (seen, "4");

  send_control_message (ws, "open", "a", "payload", "echo", "group", "test", NULL);
  send_control_message (ws, "open", "b", "payload", "echo", "group", "test", NULL);
  send_control_message (ws, "open", "c", "payload", "echo", "group", "test", NULL);

  /* Kill all the above channels */
  send_control_message (ws, "kill", NULL, "host", "localhost", NULL);

  /* All the close messages */
  while (g_hash_table_size (seen) > 0)
    {
      WAIT_UNTIL (received != NULL);

      payload = cockpit_transport_parse_frame (received, &ochannel);
      g_bytes_unref (received);
      received = NULL;

      g_assert (payload != NULL);
      g_assert_cmpstr (ochannel, ==, NULL);
      g_free (ochannel);

      g_assert (cockpit_transport_parse_command (payload, &command, &channel, &options));
      g_bytes_unref (payload);

      if (!g_str_equal (command, "open") && !g_str_equal (command, "ready"))
        {
          g_assert_cmpstr (command, ==, "close");
          g_assert_cmpstr (json_object_get_string_member (options, "problem"), ==, "terminated");
          g_assert (g_hash_table_remove (seen, channel));
        }
      json_object_unref (options);
    }

  g_hash_table_destroy (seen);

  g_signal_handler_disconnect (ws, handler);

  close_client_and_stop_web_service (test, ws, service);
}

static void
on_idling_set_flag (CockpitWebService *service,
                    gpointer data)
{
  gboolean *flag = data;
  g_assert (*flag == FALSE);
  *flag = TRUE;
}

static void
test_idling (TestCase *test,
             gconstpointer data)
{
  WebSocketConnection *client;
  CockpitWebService *service;
  gboolean flag = FALSE;
  CockpitTransport *transport;
  CockpitPipe *pipe;

  const gchar *argv[] = {
    BUILDDIR "/cockpit-bridge",
    NULL
  };

  cockpit_ws_default_host_header = "127.0.0.1";

  /* This is web_socket_client_new_for_stream() */
  client = g_object_new (WEB_SOCKET_TYPE_CLIENT,
                         "url", "ws://127.0.0.1/unused",
                         "origin", "http://127.0.0.1",
                         "io-stream", test->io_a,
                         NULL);

  pipe = cockpit_pipe_spawn (argv, NULL, NULL, COCKPIT_PIPE_FLAGS_NONE);
  transport = cockpit_pipe_transport_new (pipe);
  service = cockpit_web_service_new (test->creds, transport);
  g_object_unref (transport);
  g_object_unref (pipe);

  g_signal_connect (service, "idling", G_CALLBACK (on_idling_set_flag), &flag);
  g_assert (cockpit_web_service_get_idling (service));

  cockpit_web_service_socket (service, "/unused", test->io_b, NULL, NULL);
  g_assert (!cockpit_web_service_get_idling (service));

  while (web_socket_connection_get_ready_state (client) == WEB_SOCKET_STATE_CONNECTING)
    g_main_context_iteration (NULL, TRUE);
  g_assert (web_socket_connection_get_ready_state (client) == WEB_SOCKET_STATE_OPEN);

  web_socket_connection_close (client, WEB_SOCKET_CLOSE_NORMAL, "aoeuaoeuaoeu");
  while (web_socket_connection_get_ready_state (client) != WEB_SOCKET_STATE_CLOSED)
    g_main_context_iteration (NULL, TRUE);

  /* Now the web service should go idle and fire idling signal */
  while (!flag)
    g_main_context_iteration (NULL, TRUE);

  g_assert (cockpit_web_service_get_idling (service));

  g_object_unref (service);
  g_object_unref (client);
}

static void
test_dispose (TestCase *test,
              gconstpointer data)
{
  WebSocketConnection *client;
  CockpitWebService *service;
  CockpitTransport *transport;
  CockpitPipe *pipe;

  const gchar *argv[] = {
    BUILDDIR "/cockpit-bridge",
    NULL
  };

  cockpit_ws_default_host_header = "127.0.0.1";

  /* This is web_socket_client_new_for_stream() */
  client = g_object_new (WEB_SOCKET_TYPE_CLIENT,
                         "url", "ws://127.0.0.1/unused",
                         "origin", "http://127.0.0.1",
                         "io-stream", test->io_a,
                         NULL);

  pipe = cockpit_pipe_spawn (argv, NULL, NULL, COCKPIT_PIPE_FLAGS_NONE);
  transport = cockpit_pipe_transport_new (pipe);
  service = cockpit_web_service_new (test->creds, transport);
  g_object_unref (transport);
  g_object_unref (pipe);

  cockpit_web_service_socket (service, "/unused", test->io_b, NULL, NULL);

  while (web_socket_connection_get_ready_state (client) == WEB_SOCKET_STATE_CONNECTING)
    g_main_context_iteration (NULL, TRUE);
  g_assert (web_socket_connection_get_ready_state (client) == WEB_SOCKET_STATE_OPEN);

  /* Dispose the WebSocket ... this is what happens on forceful logout */
  g_object_run_dispose (G_OBJECT (service));

  while (web_socket_connection_get_ready_state (client) != WEB_SOCKET_STATE_CLOSED)
    g_main_context_iteration (NULL, TRUE);

  g_object_unref (service);
  g_object_unref (client);
}

static void
test_logout (TestCase *test,
             gconstpointer data)
{
  WebSocketConnection *ws;
  CockpitWebService *service;
  GBytes *message = NULL;

  start_web_service_and_create_client (test, data, &ws, &service);
  WAIT_UNTIL (web_socket_connection_get_ready_state (ws) != WEB_SOCKET_STATE_CONNECTING);
  g_assert (web_socket_connection_get_ready_state (ws) == WEB_SOCKET_STATE_OPEN);

  /* Send the logout control message */
  send_control_message (ws, "init", NULL, BUILD_INTS, "version", 1, NULL);

  data = "\n{ \"command\": \"logout\", \"disconnect\": true }";
  message = g_bytes_new_static (data, strlen (data));
  web_socket_connection_send (ws, WEB_SOCKET_DATA_TEXT, NULL, message);
  g_bytes_unref (message);

  while (web_socket_connection_get_ready_state (ws) != WEB_SOCKET_STATE_CLOSED)
    g_main_context_iteration (NULL, TRUE);

  close_client_and_stop_web_service (test, ws, service);
}

static void
test_hint_credential (TestCase *test,
                      gconstpointer data)
{
  WebSocketConnection *ws;
  JsonObject *received = NULL;
  CockpitWebService *service;
  GBytes *message = NULL;

  start_web_service_and_create_client (test, data, &ws, &service);
  WAIT_UNTIL (web_socket_connection_get_ready_state (ws) != WEB_SOCKET_STATE_CONNECTING);
  g_assert (web_socket_connection_get_ready_state (ws) == WEB_SOCKET_STATE_OPEN);

  /* Send the logout control message */
  send_control_message (ws, "init", NULL, BUILD_INTS, "version", 1, NULL);


  g_signal_connect (ws, "message", G_CALLBACK (on_message_get_control), &received);

  /* First an init message */
  while (received == NULL)
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpstr (json_object_get_string_member (received, "command"), ==, "init");
  json_object_unref (received);
  received = NULL;

  /* Then a hint that we have a password */
  while (received == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_json_eq (received, "{\"command\":\"hint\",\"credential\":\"password\"}");
  json_object_unref (received);
  received = NULL;

  /* Now drop privileges */
  data = "\n{ \"command\": \"logout\", \"disconnect\": false }";
  message = g_bytes_new_static (data, strlen (data));
  web_socket_connection_send (ws, WEB_SOCKET_DATA_TEXT, NULL, message);
  g_bytes_unref (message);

  /* We should now get a hint that we have no password */
  while (received == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_json_eq (received, "{\"command\":\"hint\",\"credential\":\"none\"}");
  json_object_unref (received);

  close_client_and_stop_web_service (test, ws, service);
}

static void
test_authorize_password (TestCase *test,
                         gconstpointer data)
{
  WebSocketConnection *ws;
  JsonObject *control = NULL;
  CockpitWebService *service;
  GBytes *payload = NULL;
  gulong handler1;
  gulong handler2;

  start_web_service_and_create_client (test, data, &ws, &service);
  WAIT_UNTIL (web_socket_connection_get_ready_state (ws) != WEB_SOCKET_STATE_CONNECTING);
  g_assert (web_socket_connection_get_ready_state (ws) == WEB_SOCKET_STATE_OPEN);

  /* Send the logout control message */
  send_control_message (ws, "init", NULL, BUILD_INTS, "version", 1, NULL);
  send_control_message (ws, "open", "444", "payload", "echo", NULL);

  handler1 = g_signal_connect (ws, "message", G_CALLBACK (on_message_get_control), &control);
  handler2 = g_signal_connect (ws, "message", G_CALLBACK (on_message_get_non_control), &payload);

  /* First an init message */
  while (control == NULL)
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpstr (json_object_get_string_member (control, "command"), ==, "init");
  json_object_unref (control);
  control = NULL;

  /* Then a hint that we have a password */
  while (control == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_json_eq (control, "{\"command\":\"hint\",\"credential\":\"password\"}");
  json_object_unref (control);
  control = NULL;

  /* Then a message that echo channel is open */
  while (control == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_json_eq (control, "{\"command\":\"open\",\"channel\":\"444\",\"payload\":\"echo\"}");
  json_object_unref (control);
  control = NULL;

  /* Now clear the password */
  send_control_message (ws, "authorize", NULL, "response", "basic", NULL);

  /* We should now get a hint that we have no password */
  while (control == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_json_eq (control, "{\"command\":\"hint\",\"credential\":\"none\"}");
  json_object_unref (control);
  control = NULL;

  g_signal_handler_disconnect (ws, handler1);
  g_signal_handler_disconnect (ws, handler2);

  if (control != NULL)
    json_object_unref (control);

  close_client_and_stop_web_service (test, ws, service);
}

static void
test_parse_external (void)
{
  const gchar *content_disposition;
  const gchar *content_type;
  const gchar *content_encoding;
  gchar **protocols;
  JsonObject *object;
  JsonObject *external;
  JsonArray *array;
  gboolean ret;

  object = json_object_new ();

  ret = cockpit_web_service_parse_external (object, NULL, NULL, NULL, NULL);
  g_assert (ret == TRUE);

  ret = cockpit_web_service_parse_external (object, &content_type, &content_encoding, &content_disposition, &protocols);
  g_assert (ret == TRUE);
  g_assert (content_type == NULL);
  g_assert (content_encoding == NULL);
  g_assert (content_disposition == NULL);
  g_assert (protocols == NULL);

  external = json_object_new ();
  json_object_set_object_member (object, "external", external);

  ret = cockpit_web_service_parse_external (object, &content_type, &content_encoding, &content_disposition, &protocols);
  g_assert (ret == TRUE);
  g_assert (content_type == NULL);
  g_assert (content_encoding == NULL);
  g_assert (content_disposition == NULL);
  g_assert (protocols == NULL);

  array = json_array_new ();
  json_array_add_string_element (array, "one");
  json_array_add_string_element (array, "two");
  json_array_add_string_element (array, "three");
  json_object_set_array_member (external, "protocols", array);

  json_object_set_string_member (external, "content-type", "text/plain");
  json_object_set_string_member (external, "content-encoding", "gzip");
  json_object_set_string_member (external, "content-disposition", "filename; test");

  ret = cockpit_web_service_parse_external (object, &content_type, &content_encoding, &content_disposition, &protocols);
  g_assert (ret == TRUE);
  g_assert_cmpstr (content_type, ==, "text/plain");
  g_assert_cmpstr (content_encoding, ==, "gzip");
  g_assert_cmpstr (content_disposition, ==, "filename; test");
  g_assert (protocols != NULL);
  g_assert_cmpstr (protocols[0], ==, "one");
  g_assert_cmpstr (protocols[1], ==, "two");
  g_assert_cmpstr (protocols[2], ==, "three");
  g_assert_cmpstr (protocols[3], ==, NULL);
  g_free (protocols);

  json_object_unref (object);
}

static void
test_host_checksums (void)
{
  CockpitTransport *transport;
  CockpitWebService *service;
  CockpitCreds *creds;
  int fds[2];

  if (pipe(fds) < 0)
    g_assert_not_reached();
  transport = cockpit_pipe_transport_new_fds ("unused", fds[0], fds[1]);
  creds = cockpit_creds_new ("cockpit", NULL);
  service = cockpit_web_service_new (creds, transport);
  cockpit_web_service_set_host_checksum(service, "localhost", "checksum1");
  cockpit_web_service_set_host_checksum(service, "host1", "checksum1");
  cockpit_web_service_set_host_checksum(service, "host2", "checksum2");

  g_assert_cmpstr (cockpit_web_service_get_host (service, "checksum1"), ==, "localhost");
  g_assert_cmpstr (cockpit_web_service_get_host (service, "checksum2"), ==, "host2");
  g_assert_cmpstr (cockpit_web_service_get_host (service, "bad"), ==, NULL);

  g_assert_cmpstr (cockpit_web_service_get_checksum (service, "host1"), ==, "checksum1");
  g_assert_cmpstr (cockpit_web_service_get_checksum (service, "host2"), ==, "checksum2");
  g_assert_cmpstr (cockpit_web_service_get_checksum (service, "localhost"), ==, "checksum1");
  g_assert_cmpstr (cockpit_web_service_get_checksum (service, "bad"), ==, NULL);

  cockpit_web_service_set_host_checksum(service, "host2", "checksum3");
  g_assert_cmpstr (cockpit_web_service_get_checksum (service, "host2"), ==, "checksum3");
  g_assert_cmpstr (cockpit_web_service_get_host (service, "checksum3"), ==, "host2");
  g_assert_cmpstr (cockpit_web_service_get_host (service, "checksum2"), ==, NULL);

  g_object_unref (service);
  g_object_unref (transport);
  cockpit_creds_unref (creds);
}

typedef struct {
  const gchar *name;
  const gchar *input;
  const gchar *message;
} ParseExternalFailure;

static ParseExternalFailure external_failure_fixtures[] = {
  { "bad-channel", "{ \"channel\": \"blah\" }", "don't specify \"channel\" on external channel" },
  { "bad-command", "{ \"command\": \"test\" }", "don't specify \"command\" on external channel" },
  { "bad-external", "{ \"external\": \"test\" }", "invalid \"external\" option" },
  { "bad-disposition", "{ \"external\": { \"content-disposition\": 5 } }", "invalid*content-disposition*" },
  { "invalid-disposition", "{ \"external\": { \"content-disposition\": \"xx\nx\" } }", "invalid*content-disposition*" },
  { "bad-type", "{ \"external\": { \"content-type\": 5 } }", "invalid*content-type*" },
  { "invalid-type", "{ \"external\": { \"content-type\": \"xx\nx\" } }", "invalid*content-type*" },
  { "bad-protocols", "{ \"external\": { \"protocols\": \"xx\nx\" } }", "invalid*protocols*" },
};

static void
test_parse_external_failure (gconstpointer data)
{
  const ParseExternalFailure *fixture = data;
  GError *error = NULL;
  JsonObject *object;
  gboolean ret;

  object = cockpit_json_parse_object (fixture->input, -1, &error);
  g_assert_no_error (error);

  cockpit_expect_message (fixture->message);

  ret = cockpit_web_service_parse_external (object, NULL, NULL, NULL, NULL);
  g_assert (ret == FALSE);

  json_object_unref (object);

  cockpit_assert_expected ();
}

static gboolean
on_hack_raise_sigchld (gpointer user_data)
{
  raise (SIGCHLD);
  return TRUE;
}

int
main (int argc,
      char *argv[])
{
  gchar *name;
  gint i;

  cockpit_test_init (&argc, &argv);

  /*
   * HACK: Work around races in glib SIGCHLD handling.
   *
   * https://bugzilla.gnome.org/show_bug.cgi?id=731771
   * https://bugzilla.gnome.org/show_bug.cgi?id=711090
   */
  g_timeout_add_seconds (1, on_hack_raise_sigchld, NULL);

  /* Try to debug crashing during tests */
  signal (SIGSEGV, cockpit_test_signal_backtrace);

  /* We don't want to test the ping functionality in these tests */
  cockpit_ws_ping_interval = G_MAXUINT;

  static const TestFixture fixture_rfc6455 = {
      .config = NULL
  };

  g_test_add ("/web-service/handshake-and-auth/rfc6455", TestCase,
              &fixture_rfc6455, setup_for_socket,
              test_handshake_and_auth, teardown_for_socket);

  g_test_add ("/web-service/echo-message/rfc6455", TestCase,
              &fixture_rfc6455, setup_for_socket,
              test_handshake_and_echo, teardown_for_socket);
  g_test_add ("/web-service/echo-message/large", TestCase,
              &fixture_rfc6455, setup_for_socket,
              test_echo_large, teardown_for_socket);

  g_test_add ("/web-service/null-creds", TestCase, NULL,
              setup_for_socket, test_socket_null_creds, teardown_for_socket);
  g_test_add ("/web-service/no-init", TestCase, NULL,
              setup_for_socket, test_no_init, teardown_for_socket);
  g_test_add ("/web-service/wrong-init-version", TestCase, NULL,
              setup_for_socket, test_wrong_init_version, teardown_for_socket);
  g_test_add ("/web-service/bad-init-version", TestCase, NULL,
              setup_for_socket, test_bad_init_version, teardown_for_socket);

  g_test_add ("/web-service/bad-origin/rfc6455", TestCase,
              &fixture_bad_origin_rfc6455, setup_for_socket,
              test_bad_origin, teardown_for_socket);
  g_test_add ("/web-service/bad-origin/withallowed", TestCase,
              &fixture_bad_origin_rfc6455, setup_for_socket,
              test_bad_origin, teardown_for_socket);
  g_test_add ("/web-service/allowed-origin/rfc6455", TestCase,
              &fixture_allowed_origin_rfc6455, setup_for_socket,
              test_handshake_and_auth, teardown_for_socket);

  g_test_add ("/web-service/bad-origin/protocol-no-config", TestCase,
              &fixture_bad_origin_proto_no_config, setup_for_socket,
              test_bad_origin, teardown_for_socket);
  g_test_add ("/web-service/bad-origin/protocol-no-header", TestCase,
              &fixture_bad_origin_proto_no_header, setup_for_socket,
              test_bad_origin, teardown_for_socket);
  g_test_add ("/web-service/allowed-origin/protocol-header", TestCase,
              &fixture_allowed_origin_proto_header, setup_for_socket,
              test_handshake_and_auth, teardown_for_socket);

  g_test_add ("/web-service/close-error", TestCase,
              NULL, setup_for_socket,
              test_close_error, teardown_for_socket);

  g_test_add ("/web-service/kill-group", TestCase, &fixture_kill_group,
              setup_for_socket, test_kill_group, teardown_for_socket);
  g_test_add ("/web-service/kill-host", TestCase, &fixture_kill_group,
              setup_for_socket, test_kill_host, teardown_for_socket);

  g_test_add ("/web-service/idling-signal", TestCase, NULL,
              setup_for_socket, test_idling, teardown_for_socket);
  g_test_add ("/web-service/force-dispose", TestCase, NULL,
              setup_for_socket, test_dispose, teardown_for_socket);
  g_test_add ("/web-service/logout", TestCase, NULL,
              setup_for_socket, test_logout, teardown_for_socket);

  g_test_add ("/web-service/authorize/hint", TestCase, NULL,
              setup_for_socket, test_hint_credential, teardown_for_socket);
  g_test_add ("/web-service/authorize/password", TestCase, NULL,
              setup_for_socket, test_authorize_password, teardown_for_socket);

  g_test_add_func ("/web-service/parse-external/success", test_parse_external);
  g_test_add_func ("/web-service/host-checksums", test_host_checksums);
  for (i = 0; i < G_N_ELEMENTS (external_failure_fixtures); i++)
    {
      name = g_strdup_printf ("/web-service/parse-external/%s", external_failure_fixtures[i].name);
      g_test_add_data_func (name, external_failure_fixtures + i, test_parse_external_failure);
      g_free (name);
    }

  return g_test_run ();
}
