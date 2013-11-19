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
      "--user", g_get_user_name (),
      "--password", PASSWORD,
      NULL
  };

  g_spawn_async_with_pipes (BUILDDIR, (gchar **)argv, NULL, 0, NULL, NULL,
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
  GError *error = NULL;
  const gchar *user;
  gchar *userpass;
  gchar *cookie;
  gchar *base64;

  /* Zero port makes server choose its own */
  test->web_server = cockpit_web_server_new (0, NULL, SRCDIR "/src/ws", NULL, &error);
  g_assert_no_error (error);

  user = g_get_user_name ();
  test->auth = mock_auth_new (user, PASSWORD);

  userpass = g_strdup_printf ("%s\n%s", user, PASSWORD);
  cockpit_auth_check_userpass (test->auth, userpass, &cookie, NULL, NULL, &error);
  g_assert_no_error (error);
  g_free (userpass);

  base64 = g_base64_encode ((guchar *)cookie, strlen (cookie));
  g_free (cookie);

  test->cookie = g_strdup_printf ("CockpitAuth=%s", base64);
  g_free (base64);
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
teardown_for_socket (Test *test,
                     gconstpointer data)
{
  teardown_mock_sshd (test, data);
  teardown_mock_webserver (test, data);
  teardown_io_streams (test, data);
}

static void
on_error_not_reached (WebSocketConnection *ws,
                      GError *error,
                      gpointer user_data)
{
  /* At this point we know this will fail, but is informative */
  g_assert_no_error (error);
}

static gboolean
on_log_ignore_warnings (const gchar *log_domain,
                        GLogLevelFlags log_level,
                        const gchar *message,
                        gpointer user_data)
{
  switch (log_level & G_LOG_LEVEL_MASK)
    {
    case G_LOG_LEVEL_WARNING:
    case G_LOG_LEVEL_MESSAGE:
    case G_LOG_LEVEL_INFO:
    case G_LOG_LEVEL_DEBUG:
      return FALSE;
    default:
      return TRUE;
    }
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
                              "localhost", test->ssh_port,
                              test->agent_program,
                              test->io_b, headers,
                              consumed, test->auth);

  g_io_stream_close (test->io_b, NULL, &error);
  g_assert_no_error (error);

  g_byte_array_unref (consumed);
  g_hash_table_unref (headers);
  g_object_unref (bis);

  return test;
}

static void
start_web_service_and_create_client (Test *test,
                                     WebSocketFlavor flavor,
                                     WebSocketConnection **ws,
                                     GThread **thread)
{
  /* This is web_socket_client_new_for_stream() with a flavor passed in fixture */
  *ws = g_object_new (WEB_SOCKET_TYPE_CLIENT,
                     "url", "ws://localhost/unused",
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
  start_web_service_and_create_client (test, flavor, ws, thread);
  WAIT_UNTIL (web_socket_connection_get_ready_state (*ws) != WEB_SOCKET_STATE_CONNECTING);
  g_assert (web_socket_connection_get_ready_state (*ws) == WEB_SOCKET_STATE_OPEN);
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

  sent = g_bytes_new_static ("the message", 11);
  handler = g_signal_connect (ws, "message", G_CALLBACK (on_message_get_bytes), &received);
  web_socket_connection_send (ws, WEB_SOCKET_DATA_TEXT, sent);

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
  GBytes *sent;
  gulong handler;

  start_web_service_and_connect_client (test, GPOINTER_TO_INT (data), &ws, &thread);
  handler = g_signal_connect (ws, "message", G_CALLBACK (on_message_get_bytes), &received);

  /* Medium length */
  sent = g_bytes_new_take (g_strnfill (1020, '!'), 1020);
  web_socket_connection_send (ws, WEB_SOCKET_DATA_TEXT, sent);
  WAIT_UNTIL (received != NULL);
  g_assert (g_bytes_equal (received, sent));
  g_bytes_unref (sent);
  g_bytes_unref (received);
  received = NULL;

  /* Extra large */
  sent = g_bytes_new_take (g_strnfill (100 * 1000, '?'), 100 * 1000);
  web_socket_connection_send (ws, WEB_SOCKET_DATA_TEXT, sent);
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
  GBytes *sent;
  GThread *thread;

  start_web_service_and_connect_client (test, GPOINTER_TO_INT (data), &ws, &thread);
  g_signal_connect (ws, "message", G_CALLBACK (on_message_get_bytes), &received);

  /* Send something through to ensure it's open */
  sent = g_bytes_new_static ("wheee", 5);
  web_socket_connection_send (ws, WEB_SOCKET_DATA_TEXT, sent);
  WAIT_UNTIL (received != NULL);
  g_assert (g_bytes_equal (received, sent));
  g_bytes_unref (sent);
  g_bytes_unref (received);
  received = NULL;

  /* Trigger a failure message */
  kill (test->mock_sshd, SIGTERM);

  web_socket_connection_close (ws, 0, NULL);
  WAIT_UNTIL (web_socket_connection_get_ready_state (ws) == WEB_SOCKET_STATE_CLOSED);

  g_assert (received != NULL);
  g_assert_cmpstr (g_bytes_get_data (received, NULL), ==,
                   "{\"command\": \"error\", \"data\": \"terminated\"}");
  g_bytes_unref (received);
  received = NULL;

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
  g_assert_cmpstr (g_bytes_get_data (received, NULL), ==,
                   "{\"command\": \"error\", \"data\": \"no-session\"}");
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

  /* Below we cause a warning, and g_test_expect_message() is broken */
  g_test_log_set_fatal_handler (on_log_ignore_warnings, NULL);

  /* Don't connect via SSH */
  test->ssh_port = 0;

  /* Fail to spawn this program */
  test->agent_program = "/nonexistant";

  start_web_service_and_create_client (test, GPOINTER_TO_INT (data), &ws, &thread);
  g_signal_connect (ws, "message", G_CALLBACK (on_message_get_bytes), &received);
  g_signal_handlers_disconnect_by_func (ws, on_error_not_reached, NULL);

  /* Connection should close immediately */
  WAIT_UNTIL (web_socket_connection_get_ready_state (ws) == WEB_SOCKET_STATE_CLOSED);

  /* But we should have gotten failure message, about the spawn */
  g_assert (received != NULL);
  g_assert_cmpstr (g_bytes_get_data (received, NULL), ==,
                   "{\"command\": \"error\", \"data\": \"internal-error\"}");

  if (GPOINTER_TO_INT (data) == WEB_SOCKET_FLAVOR_RFC6455)
      g_assert_cmpuint (web_socket_connection_get_close_code (ws), ==, WEB_SOCKET_CLOSE_SERVER_ERROR);

  close_client_and_stop_web_service (test, ws, thread);
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

  return g_test_run ();
}
