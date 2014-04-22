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
#include "cockpitwebsocket.h"
#include "cockpitwebserver.h"
#include "cockpit/cockpittransport.h"
#include "cockpit/cockpittest.h"

#include "websocket/websocket.h"

#include <glib.h>

#include <string.h>

#include <sys/types.h>
#include <sys/socket.h>

#define WAIT_UNTIL(cond) \
  G_STMT_START \
    while (!(cond)) g_main_context_iteration (NULL, TRUE); \
  G_STMT_END

#define PASSWORD "this is the password"

typedef struct {
  /* setup_mock_sshd */
  const gchar *ssh_user;
  const gchar *ssh_password;
  GPid mock_sshd;
  guint16 ssh_port;

  /* setup_mock_webserver */
  CockpitWebServer *web_server;
  gchar *cookie;
  CockpitAuth *auth;

  /* setup_io_pair */
  GIOStream *io_a;
  GIOStream *io_b;

  /* serve_dbus */
  GThread *thread;
  const gchar *agent_program;
} Test;

static GString *
read_all_into_string (int fd)
{
  GString *input = g_string_new ("");
  gsize len;
  gssize ret;

  for (;;)
    {
      len = input->len;
      g_string_set_size (input, len + 256);
      ret = read (fd, input->str + len, 256);
      if (ret < 0)
        {
          if (errno != EAGAIN)
            {
              g_critical ("couldn't read from mock input: %s", g_strerror (errno));
              g_string_free (input, TRUE);
              return NULL;
            }
        }
      else if (ret == 0)
        {
          return input;
        }
      else
        {
          input->len = len + ret;
          input->str[input->len] = '\0';
        }
    }
}

static void
setup_mock_sshd (Test *test,
                 gconstpointer data)
{
  GError *error = NULL;
  GString *port;
  gchar *endptr;
  guint64 value;
  gint out_fd;

  const gchar *argv[] = {
      BUILDDIR "/mock-sshd",
      "--user", test->ssh_user ? test->ssh_user : g_get_user_name (),
      "--password", test->ssh_password ? test->ssh_password : PASSWORD,
      NULL
  };

  g_spawn_async_with_pipes (BUILDDIR, (gchar **)argv, NULL, G_SPAWN_DO_NOT_REAP_CHILD, NULL, NULL,
                            &test->mock_sshd, NULL, &out_fd, NULL, &error);
  g_assert_no_error (error);

  /*
   * mock-sshd prints its port on stdout, and then closes stdout
   * This also lets us know when it has initialized.
   */

  port = read_all_into_string (out_fd);
  g_assert (port != NULL);
  close (out_fd);
  g_assert_no_error (error);

  g_strstrip (port->str);
  value = g_ascii_strtoull (port->str, &endptr, 10);
  if (!endptr || *endptr != '\0' || value == 0 || value > G_MAXUSHORT)
      g_critical ("invalid port printed by mock-sshd: %s", port->str);

  test->ssh_port = (gushort)value;
  g_string_free (port, TRUE);
}

static void
teardown_mock_sshd (Test *test,
                    gconstpointer data)
{
  kill (test->mock_sshd, SIGTERM);
  g_spawn_close_pid (test->mock_sshd);
}

static void
setup_mock_webserver (Test *test,
                      gconstpointer data)
{
  const gchar *roots[] = { SRCDIR "/src/ws", NULL };
  CockpitCreds *creds;
  GError *error = NULL;
  GHashTable *headers;
  const gchar *user;
  gchar *userpass;
  gchar *end;

  /* Zero port makes server choose its own */
  test->web_server = cockpit_web_server_new (0, NULL, roots, NULL, &error);
  g_assert_no_error (error);

  user = g_get_user_name ();
  test->auth = mock_auth_new (user, PASSWORD);

  headers = web_socket_util_new_headers ();
  userpass = g_strdup_printf ("%s\n%s", user, PASSWORD);
  creds = cockpit_auth_check_userpass (test->auth, userpass, FALSE, headers, &error);
  g_assert_no_error (error);
  cockpit_creds_unref (creds);
  g_free (userpass);

  /* Dig out the cookie */
  test->cookie = g_strdup (g_hash_table_lookup (headers, "Set-Cookie"));
  end = strchr (test->cookie, ';');
  g_assert (end != NULL);
  end[0] = '\0';

  g_hash_table_unref (headers);
}

static void
teardown_mock_webserver (Test *test,
                         gconstpointer data)
{
  g_clear_object (&test->web_server);
  g_clear_object (&test->auth);
  g_free (test->cookie);
}

static void
setup_io_streams (Test *test,
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

  test->agent_program = BUILDDIR "/mock-echo";
}

static void
teardown_io_streams (Test *test,
                     gconstpointer data)
{
  g_clear_object (&test->io_a);
  g_clear_object (&test->io_b);
}

static void
setup_for_socket (Test *test,
                  gconstpointer data)
{
  setup_mock_sshd (test, data);
  setup_mock_webserver (test, data);
  setup_io_streams (test, data);
}

static void
setup_for_socket_spec (Test *test,
                       gconstpointer data)
{
  test->ssh_user = "user";
  test->ssh_password = "Another password";
  setup_for_socket (test, data);
}

static void
teardown_for_socket (Test *test,
                     gconstpointer data)
{
  teardown_mock_sshd (test, data);
  teardown_mock_webserver (test, data);
  teardown_io_streams (test, data);

  cockpit_assert_expected ();
}

static void
on_error_not_reached (WebSocketConnection *ws,
                      GError *error,
                      gpointer user_data)
{
  /* At this point we know this will fail, but is informative */
  g_assert_no_error (error);
}

static gpointer
serve_thread_func (gpointer data)
{
  Test *test = data;
  GBufferedInputStream *bis;
  GError *error = NULL;
  GHashTable *headers;
  const gchar *buffer;
  gsize count;
  gssize in1, in2;
  GByteArray *consumed;

  bis = G_BUFFERED_INPUT_STREAM (g_buffered_input_stream_new (g_io_stream_get_input_stream (test->io_b)));
  g_filter_input_stream_set_close_base_stream (G_FILTER_INPUT_STREAM (bis), FALSE);

  /*
   * Parse the headers, as that's what cockpit_web_socket_serve_dbus()
   * expects its caller to do.
   */
  g_buffered_input_stream_fill (bis, 1024, NULL, &error);
  g_assert_no_error (error);
  buffer = g_buffered_input_stream_peek_buffer (bis, &count);

  /* Assume that we got the entire header here in those 1024 bytes */
  in1 = web_socket_util_parse_req_line (buffer, count, NULL, NULL);
  g_assert (in1 > 0);

  /* Assume that we got the entire header here in those 1024 bytes */
  in2 = web_socket_util_parse_headers (buffer + in1, count - in1, &headers);
  g_assert (in2 > 0);

  if (!g_input_stream_skip (G_INPUT_STREAM (bis), in1 + in2, NULL, NULL))
    g_assert_not_reached ();

  consumed = g_byte_array_new ();
  buffer = g_buffered_input_stream_peek_buffer (bis, &count);
  g_byte_array_append (consumed, (guchar *)buffer, count);

  cockpit_web_socket_serve_dbus (test->web_server,
                              test->ssh_port,
                              test->agent_program,
                              SRCDIR "/src/ws/mock_known_hosts",
                              test->io_b, headers,
                              consumed, test->auth);

  g_io_stream_close (test->io_b, NULL, &error);
  g_assert_no_error (error);

  g_byte_array_unref (consumed);
  g_hash_table_unref (headers);
  g_object_unref (bis);

  return test;
}

static GBytes *
build_control_message (const gchar *command,
                       guint channel,
                       ...) G_GNUC_NULL_TERMINATED;

static GBytes *
build_control_message (const gchar *command,
                       guint channel,
                       ...)
{
  JsonGenerator *generator;
  JsonBuilder *builder;
  gchar *data;
  gsize length;
  va_list va;
  const gchar *option;
  GBytes *bytes;
  JsonNode *node;

  builder = json_builder_new ();
  json_builder_begin_object (builder);
  json_builder_set_member_name (builder, "command");
  json_builder_add_string_value (builder, command);
  if (channel)
    {
      json_builder_set_member_name (builder, "channel");
      json_builder_add_int_value (builder, channel);
    }

  va_start (va, channel);
  for (;;)
    {
      option = va_arg (va, const gchar *);
      if (!option)
        break;
      json_builder_set_member_name (builder, option);
      json_builder_add_string_value (builder, va_arg (va, const gchar *));
    }
  va_end (va);

  json_builder_end_object (builder);
  generator = json_generator_new ();
  node = json_builder_get_root (builder);
  json_generator_set_root (generator, node);
  data = json_generator_to_data (generator, &length);
  data = g_realloc (data, length + 2);
  memmove (data + 2, data, length);
  memcpy (data, "0\n", 2);
  bytes = g_bytes_new_take (data, length + 2);
  g_object_unref (generator);
  json_node_free (node);
  g_object_unref (builder);

  return bytes;
}

static void
expect_control_message (GBytes *message,
                        const gchar *command,
                        guint channel,
                        ...) G_GNUC_NULL_TERMINATED;

static void
expect_control_message (GBytes *message,
                        const gchar *expected_command,
                        guint expected_channel,
                        ...)
{
  guint outer_channel;
  const gchar *message_command;
  guint message_channel;
  JsonObject *options;
  JsonParser *parser;
  GBytes *payload;
  const gchar *expect_option;
  const gchar *expect_value;
  va_list va;

  payload = cockpit_transport_parse_frame (message, &outer_channel);
  g_assert (payload != NULL);
  g_assert_cmpuint (outer_channel, ==, 0);

  parser = json_parser_new ();
  g_assert (cockpit_transport_parse_command (parser, payload, &message_command,
                                             &message_channel, &options));
  g_bytes_unref (payload);

  g_assert_cmpstr (expected_command, ==, message_command);
  g_assert_cmpuint (expected_channel, ==, expected_channel);

  va_start (va, expected_channel);
  for (;;) {
      expect_option = va_arg (va, const gchar *);
      if (!expect_option)
        break;
      expect_value = va_arg (va, const gchar *);
      g_assert (expect_value != NULL);
      g_assert_cmpstr (json_object_get_string_member (options, expect_option), ==, expect_value);
  }
  va_end (va);

  g_object_unref (parser);
}

static void
start_web_service_and_create_client (Test *test,
                                     WebSocketFlavor flavor,
                                     WebSocketConnection **ws,
                                     GThread **thread)
{
  /* This is web_socket_client_new_for_stream() with a flavor passed in fixture */
  *ws = g_object_new (WEB_SOCKET_TYPE_CLIENT,
                     "url", "ws://127.0.0.1/unused",
                     "io-stream", test->io_a,
                     "flavor", flavor,
                     NULL);

  g_signal_connect (*ws, "error", G_CALLBACK (on_error_not_reached), NULL);
  web_socket_client_include_header (WEB_SOCKET_CLIENT (*ws), "Cookie", test->cookie);
  *thread = g_thread_new ("serve-thread", serve_thread_func, test);
}

static void
start_web_service_and_connect_client (Test *test,
                                      WebSocketFlavor flavor,
                                      WebSocketConnection **ws,
                                      GThread **thread)
{
  GBytes *sent;

  start_web_service_and_create_client (test, flavor, ws, thread);
  WAIT_UNTIL (web_socket_connection_get_ready_state (*ws) != WEB_SOCKET_STATE_CONNECTING);
  g_assert (web_socket_connection_get_ready_state (*ws) == WEB_SOCKET_STATE_OPEN);

  /* Send the open control message that starts the agent. */
  sent = build_control_message ("open", 4, "payload", "test-text", NULL);
  web_socket_connection_send (*ws, WEB_SOCKET_DATA_TEXT, NULL, sent);
  g_bytes_unref (sent);
}

static void
close_client_and_stop_web_service (Test *test,
                                   WebSocketConnection *ws,
                                   GThread *thread)
{
  if (web_socket_connection_get_ready_state (ws) == WEB_SOCKET_STATE_OPEN)
    {
      web_socket_connection_close (ws, 0, NULL);
      WAIT_UNTIL (web_socket_connection_get_ready_state (ws) == WEB_SOCKET_STATE_CLOSED);
    }

  g_object_unref (ws);

  g_assert (g_thread_join (thread) == test);
}

static void
test_handshake_and_auth (Test *test,
                         gconstpointer data)
{
  WebSocketConnection *ws;
  GThread *thread;

  start_web_service_and_connect_client (test, GPOINTER_TO_INT (data), &ws, &thread);
  close_client_and_stop_web_service (test, ws, thread);
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
      g_test_message ("received unexpected extra message: %*.s", (int)length, (gchar *)data);
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
  if (g_str_has_prefix (g_bytes_get_data (message, NULL), "0\n"))
      return;
  g_assert (*received == NULL);
  *received = g_bytes_ref (message);
}

static void
test_handshake_and_echo (Test *test,
                         gconstpointer data)
{
  WebSocketConnection *ws;
  GBytes *received = NULL;
  GThread *thread;
  GBytes *sent;
  gulong handler;

  start_web_service_and_connect_client (test, GPOINTER_TO_INT (data), &ws, &thread);

  sent = g_bytes_new_static ("4\nthe message", 13);
  handler = g_signal_connect (ws, "message", G_CALLBACK (on_message_get_non_control), &received);
  web_socket_connection_send (ws, WEB_SOCKET_DATA_TEXT, NULL, sent);

  WAIT_UNTIL (received != NULL);

  g_assert (g_bytes_equal (received, sent));
  g_bytes_unref (sent);
  g_bytes_unref (received);
  received = NULL;

  g_signal_handler_disconnect (ws, handler);

  close_client_and_stop_web_service (test, ws, thread);
}

static void
test_echo_large (Test *test,
                 gconstpointer data)
{
  WebSocketConnection *ws;
  GBytes *received = NULL;
  GThread *thread;
  gchar *contents;
  GBytes *sent;
  gulong handler;

  start_web_service_and_connect_client (test, GPOINTER_TO_INT (data), &ws, &thread);
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
  close_client_and_stop_web_service (test, ws, thread);
}

static void
test_close_error (Test *test,
                  gconstpointer data)
{
  WebSocketConnection *ws;
  GBytes *received = NULL;
  GThread *thread;

  start_web_service_and_connect_client (test, GPOINTER_TO_INT (data), &ws, &thread);
  g_signal_connect (ws, "message", G_CALLBACK (on_message_get_bytes), &received);

  /* Send something through to ensure it's open */
  WAIT_UNTIL (received != NULL);
  expect_control_message (received, "open", 4, NULL);
  g_bytes_unref (received);
  received = NULL;

  /* Trigger a failure message */
  kill (test->mock_sshd, SIGTERM);

  /* We should now get a close command */
  WAIT_UNTIL (received != NULL);
  expect_control_message (received, "close", 4, "reason", "disconnected", NULL);
  g_bytes_unref (received);
  received = NULL;

  close_client_and_stop_web_service (test, ws, thread);
}

static void
test_specified_creds (Test *test,
                      gconstpointer data)
{
  WebSocketConnection *ws;
  GBytes *received = NULL;
  GBytes *sent;
  GThread *thread;

  start_web_service_and_create_client (test, GPOINTER_TO_INT (data), &ws, &thread);
  WAIT_UNTIL (web_socket_connection_get_ready_state (ws) != WEB_SOCKET_STATE_CONNECTING);
  g_assert (web_socket_connection_get_ready_state (ws) == WEB_SOCKET_STATE_OPEN);

  /* Open a channel with a non-standard command */
  sent = build_control_message ("open", 4, "payload", "test-text", "user", "user", "password", "Another password", NULL);
  web_socket_connection_send (ws, WEB_SOCKET_DATA_TEXT, NULL, sent);
  g_bytes_unref (sent);

  g_signal_connect (ws, "message", G_CALLBACK (on_message_get_non_control), &received);

  sent = g_bytes_new_static ("4\nwheee", 7);
  web_socket_connection_send (ws, WEB_SOCKET_DATA_TEXT, NULL, sent);
  WAIT_UNTIL (received != NULL);
  g_assert (g_bytes_equal (received, sent));
  g_bytes_unref (sent);
  g_bytes_unref (received);
  received = NULL;

  close_client_and_stop_web_service (test, ws, thread);
}

static void
test_specified_creds_fail (Test *test,
                           gconstpointer data)
{
  WebSocketConnection *ws;
  GBytes *received = NULL;
  GBytes *sent;
  GThread *thread;

  start_web_service_and_create_client (test, GPOINTER_TO_INT (data), &ws, &thread);
  WAIT_UNTIL (web_socket_connection_get_ready_state (ws) != WEB_SOCKET_STATE_CONNECTING);
  g_assert (web_socket_connection_get_ready_state (ws) == WEB_SOCKET_STATE_OPEN);

  g_signal_connect (ws, "message", G_CALLBACK (on_message_get_bytes), &received);

  /* Open a channel with a non-standard command, but a bad password */
  sent = build_control_message ("open", 4, "payload", "test-text", "user", "user", "password", "Wrong password", NULL);
  web_socket_connection_send (ws, WEB_SOCKET_DATA_TEXT, NULL, sent);
  g_bytes_unref (sent);

  /* We should now get a close command */
  WAIT_UNTIL (received != NULL);

  /* Should have gotten a failure message, about the credentials */
  expect_control_message (received, "close", 4, "reason", "not-authorized", NULL);

  close_client_and_stop_web_service (test, ws, thread);
}

static void
test_socket_unauthenticated (Test *test,
                             gconstpointer data)
{
  WebSocketConnection *ws;
  GThread *thread;
  GBytes *received = NULL;

  start_web_service_and_create_client (test, 0, &ws, &thread);
  g_signal_connect (ws, "message", G_CALLBACK (on_message_get_bytes), &received);

  /* No authentication cookie */
  web_socket_client_include_header (WEB_SOCKET_CLIENT (ws), "Cookie", NULL);

  /* Should close right after opening */
  WAIT_UNTIL (web_socket_connection_get_ready_state (ws) == WEB_SOCKET_STATE_CLOSED);

  /* And we should have received a message */
  g_assert (received != NULL);
  expect_control_message (received, "close", 4, "reason", "no-session", NULL);
  g_bytes_unref (received);
  received = NULL;

  close_client_and_stop_web_service (test, ws, thread);
}

static void
test_fail_spawn (Test *test,
                 gconstpointer data)
{
  WebSocketConnection *ws;
  GBytes *received = NULL;
  GThread *thread;

  cockpit_expect_info ("New connection*");
  cockpit_expect_log ("libcockpit", G_LOG_LEVEL_MESSAGE, "*failed to execute*");

  /* Don't connect via SSH */
  test->ssh_port = 0;

  /* Fail to spawn this program */
  test->agent_program = "/nonexistant";

  start_web_service_and_connect_client (test, GPOINTER_TO_INT (data), &ws, &thread);
  g_signal_connect (ws, "message", G_CALLBACK (on_message_get_bytes), &received);
  g_signal_handlers_disconnect_by_func (ws, on_error_not_reached, NULL);

  /* Channel should close immediately */
  WAIT_UNTIL (received != NULL);

  /* But we should have gotten failure message, about the spawn */
  expect_control_message (received, "close", 4, "reason", "no-agent", NULL);
  g_bytes_unref (received);

  close_client_and_stop_web_service (test, ws, thread);
}

int
main (int argc,
      char *argv[])
{
  cockpit_test_init (&argc, &argv);

  g_test_add ("/web-service/handshake-and-auth/rfc6455", Test,
              GINT_TO_POINTER (WEB_SOCKET_FLAVOR_RFC6455), setup_for_socket,
              test_handshake_and_auth, teardown_for_socket);
  g_test_add ("/web-service/handshake-and-auth/hixie76", Test,
              GINT_TO_POINTER (WEB_SOCKET_FLAVOR_HIXIE76), setup_for_socket,
              test_handshake_and_auth, teardown_for_socket);

  g_test_add ("/web-service/echo-message/rfc6455", Test,
              GINT_TO_POINTER (WEB_SOCKET_FLAVOR_RFC6455), setup_for_socket,
              test_handshake_and_echo, teardown_for_socket);
  g_test_add ("/web-service/echo-message/hixie76", Test,
              GINT_TO_POINTER (WEB_SOCKET_FLAVOR_HIXIE76), setup_for_socket,
              test_handshake_and_echo, teardown_for_socket);
  g_test_add ("/web-service/echo-message/large", Test,
              GINT_TO_POINTER (WEB_SOCKET_FLAVOR_RFC6455), setup_for_socket,
              test_echo_large, teardown_for_socket);

  g_test_add ("/web-service/close-error", Test, 0, setup_for_socket,
              test_close_error, teardown_for_socket);
  g_test_add ("/web-service/unauthenticated", Test, 0, setup_for_socket,
              test_socket_unauthenticated, teardown_for_socket);

  g_test_add ("/web-service/fail-spawn/rfc6455", Test,
              GINT_TO_POINTER (WEB_SOCKET_FLAVOR_RFC6455), setup_for_socket,
              test_fail_spawn, teardown_for_socket);
  g_test_add ("/web-service/fail-spawn/hixie76", Test,
              GINT_TO_POINTER (WEB_SOCKET_FLAVOR_HIXIE76), setup_for_socket,
              test_fail_spawn, teardown_for_socket);

  g_test_add ("/web-service/specified-creds", Test,
              GINT_TO_POINTER (WEB_SOCKET_FLAVOR_RFC6455), setup_for_socket_spec,
              test_specified_creds, teardown_for_socket);
  g_test_add ("/web-service/specified-creds-fail", Test,
              GINT_TO_POINTER (WEB_SOCKET_FLAVOR_RFC6455), setup_for_socket_spec,
              test_specified_creds_fail, teardown_for_socket);

  return g_test_run ();
}
