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

#include "websocket.h"
#include "websocketprivate.h"

#include <sys/types.h>
#include <sys/socket.h>

#include <string.h>

typedef struct {
  WebSocketConnection *client;
  WebSocketConnection *server;
} Test;

typedef struct {
  WebSocketFlavor flavor;
  const gchar *flavor_name;
} FlavorFixture;

static void
null_log_handler (const gchar *log_domain,
                  GLogLevelFlags log_level,
                  const gchar *message,
                  gpointer user_data)
{
  /*
   * HACK: Use g_test_expect_message() to quieten things down once this lands:
   * https://bugzilla.gnome.org/show_bug.cgi?id=710991
   */
}

#define WAIT_UNTIL(cond) \
  G_STMT_START \
    while (!(cond)) g_main_context_iteration (NULL, TRUE); \
  G_STMT_END

static void
test_parse_url (void)
{
  gboolean ret;
  GError *error = NULL;
  gchar *host;
  gchar *path;
  gchar *scheme;

  ret = _web_socket_util_parse_url ("scheme://host:port/path/part",
                                    &scheme, &host, &path, &error);
  g_assert_no_error (error);
  g_assert (ret == TRUE);
  g_assert_cmpstr (scheme, ==, "scheme");
  g_assert_cmpstr (host, ==, "host:port");
  g_assert_cmpstr (path, ==, "/path/part");
  g_free (scheme);
  g_free (host);
  g_free (path);
}

static void
test_parse_url_no_out (void)
{
  gboolean ret;
  GError *error = NULL;

  ret = _web_socket_util_parse_url ("scheme://host:port/path/part",
                                    NULL, NULL, NULL, &error);
  g_assert_no_error (error);
  g_assert (ret == TRUE);
}

static void
test_parse_url_bad (void)
{
  const gchar *bads[] = {
      "/host:port/path/part",
      "http://@/",
      "http:///",
      "http://",
  };

  gboolean ret;
  GError *error = NULL;
  gint i;

  for (i = 0; i < G_N_ELEMENTS (bads); i++)
    {
      ret = _web_socket_util_parse_url (bads[i], NULL, NULL, NULL, &error);
      g_assert_error (error, G_IO_ERROR, G_IO_ERROR_INVALID_ARGUMENT);
      g_assert (ret == FALSE);
      g_clear_error (&error);
    }
}

static void
test_parse_url_no_path (void)
{
  gboolean ret;
  gchar *path;

  ret = _web_socket_util_parse_url ("scheme://host:port",
                                    NULL, NULL, &path, NULL);
  g_assert (ret == TRUE);
  g_assert_cmpstr (path, ==, "/");
  g_free (path);
}

static void
test_parse_url_with_user (void)
{
  gboolean ret;
  gchar *host;

  ret = _web_socket_util_parse_url ("scheme://user:password@host",
                                    NULL, &host, NULL, NULL);
  g_assert (ret == TRUE);
  g_assert_cmpstr (host, ==, "host");
  g_free (host);
}

static void
test_parse_req (void)
{
  const gchar *reqs[] = {
      "GET /path/part HTTP/1.0\r\n  ",
      "GET /path/part HTTP/1.0\n  ",
      "GET  /path/part  HTTP/1.0  \r\n  ",
  };

  gchar *path;
  gchar *method;
  gssize ret;
  gint i;

  for (i = 0; i < G_N_ELEMENTS (reqs); i++)
    {
      ret = web_socket_util_parse_req_line (reqs[i], strlen (reqs[i]), &method, &path);
      g_assert_cmpint (ret, ==, strlen (reqs[i]) - 2);
      g_assert_cmpstr (method, ==, "GET");
      g_assert_cmpstr (path, ==, "/path/part");
      g_free (method);
      g_free (path);
    }
}

static void
test_parse_req_no_out (void)
{
  const gchar *data = "GET /path/part HTTP/1.0\r\n  ";
  gssize ret;

  ret = web_socket_util_parse_req_line (data, strlen (data), NULL, NULL);
  g_assert_cmpint (ret, ==, 25);
}

static void
test_parse_req_not_enough (void)
{
  const gchar *data = "GET /path/par";
  gssize ret;

  ret = web_socket_util_parse_req_line (data, strlen (data), NULL, NULL);
  g_assert_cmpint (ret, ==, 0);
}

static void
test_parse_req_bad (void)
{
  const gchar *bads[] = {
      " GET /path/part HTTP/1.0\r\n  ",
      "GET /path/part\r\n  ",
      "GET /path/part HTTP/4.4\r\n  ",
      "GET /path/part HTTP/1.0X\r\n  ",
      "GET /path/part XXX/2\r\n  ",
      "TESTONE\r\n  ",
  };

  gssize ret;
  gint i;

  for (i = 0; i < G_N_ELEMENTS (bads); i++)
    {
      ret = web_socket_util_parse_req_line (bads[i], strlen (bads[i]), NULL, NULL);
      g_assert_cmpint (ret, ==, -1);
    }
}

static void
test_parse_status (void)
{
  const gchar *lines[] = {
      "HTTP/1.0 101 Switching Protocols\r\n  ",
      "HTTP/1.0  101  Switching Protocols\n  ",
      "HTTP/1.1  101  Switching Protocols  \r\n  ",
  };

  guint status;
  gchar *reason;
  gssize ret;
  gint i;

  for (i = 0; i < G_N_ELEMENTS (lines); i++)
    {
      ret = web_socket_util_parse_status_line (lines[i], strlen (lines[i]), NULL, &status, &reason);
      g_assert_cmpint (ret, ==, strlen (lines[i]) - 2);
      g_assert_cmpuint (status, ==, 101);
      g_assert_cmpstr (reason, ==, "Switching Protocols");
      g_free (reason);
    }
}

static void
test_parse_status_no_out (void)
{
  const gchar *line = "HTTP/1.0 101 Switching Protocols\r\n  ";
  gssize ret;

  ret = web_socket_util_parse_status_line (line, strlen (line), NULL, NULL, NULL);
  g_assert_cmpint (ret, ==, strlen (line) - 2);
}

static void
test_parse_status_not_enough (void)
{
  const gchar *data = "HTTP/";
  gssize ret;

  ret = web_socket_util_parse_status_line (data, strlen (data), NULL, NULL, NULL);
  g_assert_cmpint (ret, ==, 0);
}

static void
test_parse_status_bad (void)
{
  const gchar *lines[] = {
      " HTTP/1.0 101 Switching Protocols\r\n  ",
      "HTTP/1.0  101\r\n  ",
      "HTTP/1.1  1A01  Switching Protocols  \r\n  ",
      "TESTONE\r\n  ",
  };

  gssize ret;
  gint i;

  for (i = 0; i < G_N_ELEMENTS (lines); i++)
    {
      ret = web_socket_util_parse_status_line (lines[i], strlen (lines[i]), NULL, NULL, NULL);
      g_assert_cmpint (ret, ==, -1);
    }
}

static void
test_parse_version_1_0 (void)
{
  gchar *version;
  const gchar *line;
  gssize ret;

  line = "HTTP/1.0 101 Switching Protocols\r\n  ";
  ret = web_socket_util_parse_status_line (line, strlen (line), &version, NULL, NULL);
  g_assert_cmpint (ret, ==, strlen (line) - 2);
  g_assert_cmpstr (version, ==, "HTTP/1.0");
  g_free (version);
}

static void
test_parse_version_1_1 (void)
{
  gchar *version;
  const gchar *line;
  gssize ret;

  line = "HTTP/1.1 101 Switching Protocols\r\n  ";
  ret = web_socket_util_parse_status_line (line, strlen (line), &version, NULL, NULL);
  g_assert_cmpint (ret, ==, strlen (line) - 2);
  g_assert_cmpstr (version, ==, "HTTP/1.1");
  g_free (version);
}

static void
test_parse_headers (void)
{
  const gchar *input[] = {
      "Header1: value3\r\n"
      "Header2:  field\r\n"
      "Head3:  Another \r\n"
      "Host:http://cockpit-project.org\r\n"
      "\r\n"
      "BODY  ",
  };

  GHashTable *headers;
  gssize ret;
  gint i;

  for (i = 0; i < G_N_ELEMENTS (input); i++)
    {
      ret = web_socket_util_parse_headers (input[i], strlen (input[i]), &headers);
      g_assert_cmpint (ret, ==, strlen (input[i]) - 6);
      g_assert_cmpstr (g_hash_table_lookup (headers, "header1"), ==, "value3");
      g_assert_cmpstr (g_hash_table_lookup (headers, "Header2"), ==, "field");
      g_assert_cmpstr (g_hash_table_lookup (headers, "hEAD3"), ==, "Another");
      g_assert_cmpstr (g_hash_table_lookup (headers, "Host"), ==, "http://cockpit-project.org");
      g_assert (g_hash_table_lookup (headers, "Something else") == NULL);
      g_hash_table_unref (headers);
    }
}

static void
test_parse_headers_no_out (void)
{
  const gchar *input =
      "Header1: value3\r\n"
      "Header2:  field\r\n"
      "Head3:  Another \r\n"
      "\r\n"
      "BODY  ";

  gssize ret;

  ret = web_socket_util_parse_headers (input, strlen (input), NULL);
  g_assert_cmpint (ret, ==, strlen (input) - 6);
}

static void
test_parse_headers_not_enough (void)
{
  const gchar *input =
      "Header1: value3\r\n"
      "Header2:  field\r\n"
      "Head3:  Anothe";

  gssize ret;

  ret = web_socket_util_parse_headers (input, strlen (input), NULL);
  g_assert_cmpint (ret, ==, 0);
}

static void
test_parse_headers_bad (void)
{
  const gchar *input[] = {
      "Header1 value3\r\n"
      "\r\n"
      "BODY  ",
  };

  gssize ret;
  gint i;

  g_test_expect_message (G_LOG_DOMAIN, G_LOG_LEVEL_MESSAGE,
                         "received invalid header line*");

  for (i = 0; i < G_N_ELEMENTS (input); i++)
    {
      ret = web_socket_util_parse_headers (input[i], strlen (input[i]), NULL);
      g_assert_cmpint (ret, ==, -1);
    }
}

static void
test_header_equals (void)
{
  GHashTable *headers = web_socket_util_new_headers ();
  g_hash_table_insert (headers, g_strdup ("Blah"), g_strdup ("VALUE"));

  g_assert (_web_socket_util_header_equals (headers, "blah", "Value"));

  g_test_expect_message (G_LOG_DOMAIN, G_LOG_LEVEL_MESSAGE,
                         "received invalid or missing Blah header*");
  g_assert (!_web_socket_util_header_equals (headers, "Blah", "test"));

  g_test_expect_message (G_LOG_DOMAIN, G_LOG_LEVEL_MESSAGE,
                         "received invalid or missing Extra header*");
  g_assert (!_web_socket_util_header_equals (headers, "Extra", "test"));
  g_hash_table_unref (headers);
}

static void
test_header_contains (void)
{
  GHashTable *headers = web_socket_util_new_headers ();
  g_hash_table_insert (headers, g_strdup ("Blah"), g_strdup ("one two three"));

  g_assert (_web_socket_util_header_contains (headers, "blah", "one"));
  g_assert (_web_socket_util_header_contains (headers, "blah", "two"));
  g_assert (_web_socket_util_header_contains (headers, "blah", "three"));

  g_test_expect_message (G_LOG_DOMAIN, G_LOG_LEVEL_MESSAGE,
                         "received invalid or missing Blah header*");
  g_assert (!_web_socket_util_header_contains (headers, "Blah", "thre"));

  g_test_expect_message (G_LOG_DOMAIN, G_LOG_LEVEL_MESSAGE,
                         "received invalid or missing Blah header*");
  g_assert (!_web_socket_util_header_contains (headers, "Blah", "four"));

  g_test_expect_message (G_LOG_DOMAIN, G_LOG_LEVEL_MESSAGE,
                         "received invalid or missing Extra header*");
  g_assert (!_web_socket_util_header_contains (headers, "Extra", "test"));
  g_hash_table_unref (headers);
}

static void
test_header_empty (void)
{
  GHashTable *headers = web_socket_util_new_headers ();
  g_hash_table_insert (headers, g_strdup ("Empty"), g_strdup (""));
  g_hash_table_insert (headers, g_strdup ("Blah"), g_strdup ("value"));

  g_assert (_web_socket_util_header_empty (headers, "empty"));
  g_assert (_web_socket_util_header_empty (headers, "Another"));

  g_test_expect_message (G_LOG_DOMAIN, G_LOG_LEVEL_MESSAGE,
                         "received unsupported Blah header*");
  g_assert (!_web_socket_util_header_empty (headers, "Blah"));
  g_hash_table_unref (headers);
}

static void
create_iostream_pair (GIOStream **io1,
                      GIOStream **io2)
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

  *io1 = G_IO_STREAM (g_socket_connection_factory_create_connection (socket1));
  *io2 = G_IO_STREAM (g_socket_connection_factory_create_connection (socket2));

  g_object_unref (socket1);
  g_object_unref (socket2);
}

static gboolean
on_error_not_reached (WebSocketConnection *ws,
                      GError *error,
                      gpointer user_data)
{
  /* At this point we know this will fail, but is informative */
  g_assert_no_error (error);
  return TRUE;
}

static gboolean
on_error_copy (WebSocketConnection *ws,
               GError *error,
               gpointer user_data)
{
  GError **copy = user_data;
  g_assert (*copy == NULL);
  *copy = g_error_copy (error);
  return TRUE;
}

static WebSocketConnection *
client_new_for_stream_and_flavor (GIOStream *io,
                                  WebSocketFlavor flavor)
{
  /* The default */
  if (flavor == WEB_SOCKET_FLAVOR_RFC6455 || flavor == WEB_SOCKET_FLAVOR_UNKNOWN)
    return web_socket_client_new_for_stream ("ws://localhost/unix", NULL, NULL, io);
  else
    return g_object_new (WEB_SOCKET_TYPE_CLIENT,
                         "url", "ws://localhost/unix",
                         "io-stream", io,
                         "flavor", flavor,
                         NULL);
}

static void
setup_pair (Test *test,
            gconstpointer data)
{
  const FlavorFixture *fixture = data;
  GIOStream *ioc;
  GIOStream *ios;

  create_iostream_pair (&ioc, &ios);

  test->server = web_socket_server_new_for_stream ("ws://localhost/unix", NULL, NULL, ios, NULL, NULL);
  test->client = client_new_for_stream_and_flavor (ioc, fixture->flavor);

  g_signal_connect (test->server, "error", G_CALLBACK (on_error_not_reached), NULL);

  g_object_unref (ioc);
  g_object_unref (ios);
}

static void
teardown (Test *test,
          gconstpointer data)
{
  g_clear_object (&test->client);
  g_clear_object (&test->server);
}

static void
on_text_message (WebSocketConnection *ws,
                 WebSocketDataType type,
                 GBytes *message,
                 gpointer user_data)
{
  GBytes **receive = user_data;
  g_assert_cmpint (type, ==, WEB_SOCKET_DATA_TEXT);
  g_assert (*receive == NULL);
  g_assert (message != NULL);
  *receive = g_bytes_ref (message);
}

static void
on_close_set_flag (WebSocketConnection *ws,
                   gpointer user_data)
{
  gboolean *flag = user_data;
  g_assert (*flag == FALSE);
  *flag = TRUE;
}

static void
on_open_set_flag (WebSocketConnection *ws,
                  gpointer user_data)
{
  gboolean *flag = user_data;
  g_assert (*flag == FALSE);
  *flag = TRUE;
}

static void
test_handshake (Test *test,
                gconstpointer data)
{
  gboolean open_event_client = FALSE;
  gboolean open_event_server = FALSE;
  GHashTable *headers;

  g_signal_connect (test->client, "open", G_CALLBACK (on_open_set_flag), &open_event_client);
  g_signal_connect (test->server, "open", G_CALLBACK (on_open_set_flag), &open_event_server);

  WAIT_UNTIL (web_socket_connection_get_ready_state (test->client) != WEB_SOCKET_STATE_CONNECTING);
  g_assert_cmpint (web_socket_connection_get_ready_state (test->client), ==, WEB_SOCKET_STATE_OPEN);

  WAIT_UNTIL (web_socket_connection_get_ready_state (test->server) != WEB_SOCKET_STATE_CONNECTING);
  g_assert_cmpint (web_socket_connection_get_ready_state (test->server), ==, WEB_SOCKET_STATE_OPEN);

  headers = web_socket_client_get_headers (WEB_SOCKET_CLIENT (test->client));
  g_assert (headers != NULL);
#if 0
  GHashTableIter iter;
  gpointer key, value;
  g_hash_table_iter_init (&iter, headers);
  while (g_hash_table_iter_next (&iter, &key, &value))
    g_printerr ("headers: %s %s\n", (gchar *)key, (gchar *)value);
#endif
  g_assert_cmpstr (g_hash_table_lookup (headers, "connection"), ==, "Upgrade");

  g_assert (open_event_client);
  g_assert (open_event_server);
}

static void
test_send_client_to_server (Test *test,
                            gconstpointer data)
{
  GBytes *sent = NULL;
  GBytes *received = NULL;
  const gchar *contents;
  gsize len;

  g_signal_connect (test->server, "message", G_CALLBACK (on_text_message), &received);

  WAIT_UNTIL (web_socket_connection_get_ready_state (test->client) != WEB_SOCKET_STATE_CONNECTING);
  g_assert_cmpint (web_socket_connection_get_ready_state (test->client), ==, WEB_SOCKET_STATE_OPEN);

  sent = g_bytes_new ("this is a test", 14);
  web_socket_connection_send (test->client, WEB_SOCKET_DATA_TEXT, NULL, sent);

  WAIT_UNTIL (received != NULL);

  g_assert (g_bytes_equal (sent, received));

  /* Received messages should be null terminated (outside of len) */
  contents = g_bytes_get_data (received, &len);
  g_assert (contents[len] == '\0');

  g_bytes_unref (sent);
  g_bytes_unref (received);
}

static void
test_send_server_to_client (Test *test,
                            gconstpointer data)
{
  GBytes *sent = NULL;
  GBytes *received = NULL;
  const gchar *contents;
  gsize len;

  g_signal_connect (test->client, "message", G_CALLBACK (on_text_message), &received);

  WAIT_UNTIL (web_socket_connection_get_ready_state (test->server) != WEB_SOCKET_STATE_CONNECTING);
  g_assert_cmpint (web_socket_connection_get_ready_state (test->server), ==, WEB_SOCKET_STATE_OPEN);

  sent = g_bytes_new ("this is a test", 14);
  web_socket_connection_send (test->server, WEB_SOCKET_DATA_TEXT, NULL, sent);

  WAIT_UNTIL (received != NULL);

  g_assert (g_bytes_equal (sent, received));

  /* Received messages should be null terminated (outside of len) */
  contents = g_bytes_get_data (received, &len);
  g_assert (contents[len] == '\0');

  g_bytes_unref (sent);
  g_bytes_unref (received);
}

static void
test_send_big_packets (Test *test,
                       gconstpointer data)
{
  GBytes *sent = NULL;
  GBytes *received = NULL;

  g_signal_connect (test->client, "message", G_CALLBACK (on_text_message), &received);

  WAIT_UNTIL (web_socket_connection_get_ready_state (test->server) != WEB_SOCKET_STATE_CONNECTING);
  g_assert_cmpint (web_socket_connection_get_ready_state (test->server), ==, WEB_SOCKET_STATE_OPEN);

  sent = g_bytes_new_take (g_strnfill (400, '!'), 400);
  web_socket_connection_send (test->server, WEB_SOCKET_DATA_TEXT, NULL, sent);
  WAIT_UNTIL (received != NULL);
  g_assert (g_bytes_equal (sent, received));
  g_bytes_unref (sent);
  g_bytes_unref (received);
  received = NULL;

  sent = g_bytes_new_take (g_strnfill (100 * 1000, '?'), 100 * 1000);
  web_socket_connection_send (test->server, WEB_SOCKET_DATA_TEXT, NULL, sent);
  WAIT_UNTIL (received != NULL);
  g_assert (g_bytes_equal (sent, received));
  g_bytes_unref (sent);
  g_bytes_unref (received);
}

static void
test_send_prefixed (Test *test,
                    gconstpointer data)
{
  GBytes *prefix = NULL;
  GBytes *payload = NULL;
  GBytes *received = NULL;

  g_signal_connect (test->client, "message", G_CALLBACK (on_text_message), &received);

  WAIT_UNTIL (web_socket_connection_get_ready_state (test->server) != WEB_SOCKET_STATE_CONNECTING);
  g_assert_cmpint (web_socket_connection_get_ready_state (test->server), ==, WEB_SOCKET_STATE_OPEN);

  prefix = g_bytes_new_static ("funny ", 6);
  payload = g_bytes_new_static ("thing", 5);

  web_socket_connection_send (test->server, WEB_SOCKET_DATA_TEXT, prefix, payload);
  WAIT_UNTIL (received != NULL);
  g_assert_cmpstr (g_bytes_get_data (received, NULL), ==, "funny thing");
  g_assert_cmpint (g_bytes_get_size (received), ==, 11);
  g_bytes_unref (payload);
  g_bytes_unref (prefix);
  g_bytes_unref (received);
}

static void
test_send_bad_data (Test *test,
                    gconstpointer unused)
{
  WebSocketFlavor flavor;
  GError *error = NULL;
  GIOStream *io;
  gsize written;
  const gchar *frame;
  guint logid;

  g_signal_handlers_disconnect_by_func (test->server, on_error_not_reached, NULL);
  g_signal_connect (test->server, "error", G_CALLBACK (on_error_copy), &error);

  WAIT_UNTIL (web_socket_connection_get_ready_state (test->client) != WEB_SOCKET_STATE_CONNECTING);

  io = web_socket_connection_get_io_stream (test->client);

  logid = g_log_set_handler (G_LOG_DOMAIN, G_LOG_LEVEL_MESSAGE, null_log_handler, NULL);

  /* Bad UTF-8 raw frames, for each flavor */
  flavor = web_socket_connection_get_flavor (test->client);
  if (flavor == WEB_SOCKET_FLAVOR_RFC6455)
      frame = "\x81\x04\xEE\xEE\xEE\xEE";
  else
      frame = "\x00\xEE\xEE\xEE\xEE\xFF";

  if (!g_output_stream_write_all (g_io_stream_get_output_stream (io),
                                  frame, 6, &written, NULL, NULL))
    g_assert_not_reached ();
  g_assert_cmpuint (written, ==, 6);

  WAIT_UNTIL (error != NULL);
  g_assert_error (error, WEB_SOCKET_ERROR, WEB_SOCKET_CLOSE_BAD_DATA);

  WAIT_UNTIL (web_socket_connection_get_ready_state (test->client) == WEB_SOCKET_STATE_CLOSED);

  /* Hixie76 doesn't support close codes */
  if (flavor == WEB_SOCKET_FLAVOR_RFC6455)
    g_assert_cmpuint (web_socket_connection_get_close_code (test->client), ==, WEB_SOCKET_CLOSE_BAD_DATA);

  g_error_free (error);

  g_log_remove_handler (G_LOG_DOMAIN, logid);
}

static void
test_protocol_negotiate (Test *test,
                         gconstpointer unused)
{
  const gchar *server_protocols[] = { "aaa", "bbb", "ccc", NULL };
  const gchar *client_protocols[] = { "bbb", "ccc", NULL };

  g_object_set (test->server, "protocols", server_protocols, NULL);
  g_object_set (test->client, "protocols", client_protocols, NULL);

  WAIT_UNTIL (web_socket_connection_get_ready_state (test->client) != WEB_SOCKET_STATE_CONNECTING);
  g_assert_cmpstr (web_socket_connection_get_protocol (test->client), ==, "bbb");
  g_assert_cmpstr (web_socket_connection_get_protocol (test->server), ==, "bbb");
}

static void
test_protocol_mismatch (Test *test,
                        gconstpointer unused)
{
  GError *error = NULL;
  guint logid;

  const gchar *server_protocols[] = { "aaa", "bbb", "ccc", NULL };
  const gchar *client_protocols[] = { "ddd", NULL };

  g_signal_handlers_disconnect_by_func (test->client, on_error_not_reached, NULL);
  g_signal_handlers_disconnect_by_func (test->server, on_error_not_reached, NULL);
  g_signal_connect (test->client, "error", G_CALLBACK (on_error_copy), &error);

  logid = g_log_set_handler (G_LOG_DOMAIN, G_LOG_LEVEL_MESSAGE, null_log_handler, NULL);

  g_object_set (test->server, "protocols", server_protocols, NULL);
  g_object_set (test->client, "protocols", client_protocols, NULL);

  WAIT_UNTIL (web_socket_connection_get_ready_state (test->client) != WEB_SOCKET_STATE_CONNECTING);

  g_assert_error (error, WEB_SOCKET_ERROR, WEB_SOCKET_CLOSE_PROTOCOL);
  g_error_free (error);

  g_log_remove_handler (G_LOG_DOMAIN, logid);
}

static void
test_protocol_server_any (Test *test,
                          gconstpointer unused)
{
  GError *error = NULL;

  /* Server accepts any protocol */
  const gchar *client_protocols[] = { "aaa", "bbb", "ccc", NULL };

  g_signal_handlers_disconnect_by_func (test->client, on_error_not_reached, NULL);
  g_signal_connect (test->client, "error", G_CALLBACK (on_error_copy), &error);

  g_object_set (test->client, "protocols", client_protocols, NULL);

  WAIT_UNTIL (web_socket_connection_get_ready_state (test->client) != WEB_SOCKET_STATE_CONNECTING);

  WAIT_UNTIL (web_socket_connection_get_ready_state (test->client) != WEB_SOCKET_STATE_CONNECTING);
  g_assert_cmpstr (web_socket_connection_get_protocol (test->client), ==, "aaa");
  g_assert_cmpstr (web_socket_connection_get_protocol (test->server), ==, "aaa");

  g_clear_error (&error);
}

static void
test_protocol_client_any (Test *test,
                          gconstpointer unused)
{
  GError *error = NULL;

  /* Client accepts any protocol */
  const gchar *server_protocols[] = { "aaa", "bbb", "ccc", NULL };

  g_signal_handlers_disconnect_by_func (test->client, on_error_not_reached, NULL);
  g_signal_connect (test->client, "error", G_CALLBACK (on_error_copy), &error);

  g_object_set (test->server, "protocols", server_protocols, NULL);

  WAIT_UNTIL (web_socket_connection_get_ready_state (test->client) != WEB_SOCKET_STATE_CONNECTING);

  WAIT_UNTIL (web_socket_connection_get_ready_state (test->client) != WEB_SOCKET_STATE_CONNECTING);
  g_assert_cmpstr (web_socket_connection_get_protocol (test->client), ==, "aaa");
  g_assert_cmpstr (web_socket_connection_get_protocol (test->server), ==, "aaa");

  g_clear_error (&error);
}

static void
test_close_clean_client (Test *test,
                         gconstpointer data)
{
  gboolean close_event_client = FALSE;
  gboolean close_event_server = FALSE;

  g_signal_connect (test->client, "close", G_CALLBACK (on_close_set_flag), &close_event_client);
  g_signal_connect (test->server, "close", G_CALLBACK (on_close_set_flag), &close_event_server);

  WAIT_UNTIL (web_socket_connection_get_ready_state (test->server) == WEB_SOCKET_STATE_OPEN);
  WAIT_UNTIL (web_socket_connection_get_ready_state (test->client) == WEB_SOCKET_STATE_OPEN);

  web_socket_connection_close (test->client, WEB_SOCKET_CLOSE_GOING_AWAY, "give me a reason");
  g_assert_cmpint (web_socket_connection_get_ready_state (test->client), ==, WEB_SOCKET_STATE_CLOSING);

  WAIT_UNTIL (web_socket_connection_get_ready_state (test->server) == WEB_SOCKET_STATE_CLOSED);
  WAIT_UNTIL (web_socket_connection_get_ready_state (test->client) == WEB_SOCKET_STATE_CLOSED);

  g_assert (close_event_client);
  g_assert (close_event_server);

  /* No close code in hixie76 */
  if (web_socket_connection_get_flavor (test->client) != WEB_SOCKET_FLAVOR_HIXIE76)
    {
      g_assert_cmpint (web_socket_connection_get_close_code (test->client), ==, WEB_SOCKET_CLOSE_GOING_AWAY);
      g_assert_cmpint (web_socket_connection_get_close_code (test->server), ==, WEB_SOCKET_CLOSE_GOING_AWAY);
      g_assert_cmpstr (web_socket_connection_get_close_data (test->server), ==, "give me a reason");
    }
}

static void
test_close_clean_server (Test *test,
                         gconstpointer data)
{
  gboolean close_event_client = FALSE;
  gboolean close_event_server = FALSE;

  g_signal_connect (test->client, "close", G_CALLBACK (on_close_set_flag), &close_event_client);
  g_signal_connect (test->server, "close", G_CALLBACK (on_close_set_flag), &close_event_server);

  WAIT_UNTIL (web_socket_connection_get_ready_state (test->server) == WEB_SOCKET_STATE_OPEN);
  WAIT_UNTIL (web_socket_connection_get_ready_state (test->client) == WEB_SOCKET_STATE_OPEN);

  web_socket_connection_close (test->server, WEB_SOCKET_CLOSE_GOING_AWAY, "another reason");
  g_assert_cmpint (web_socket_connection_get_ready_state (test->server), ==, WEB_SOCKET_STATE_CLOSING);

  WAIT_UNTIL (web_socket_connection_get_ready_state (test->server) == WEB_SOCKET_STATE_CLOSED);
  WAIT_UNTIL (web_socket_connection_get_ready_state (test->client) == WEB_SOCKET_STATE_CLOSED);

  g_assert (close_event_client);
  g_assert (close_event_server);

  /* No close code in hixie76 */
  if (web_socket_connection_get_flavor (test->client) != WEB_SOCKET_FLAVOR_HIXIE76)
    {
      g_assert_cmpint (web_socket_connection_get_close_code (test->server), ==, WEB_SOCKET_CLOSE_GOING_AWAY);
      g_assert_cmpint (web_socket_connection_get_close_code (test->client), ==, WEB_SOCKET_CLOSE_GOING_AWAY);
      g_assert_cmpstr (web_socket_connection_get_close_data (test->client), ==, "another reason");
    }
}

static void
test_close_immediately (void)
{
  WebSocketConnection *client;
  gboolean close_event = FALSE;

  client = web_socket_client_new ("ws://localhost/unix", NULL, NULL);
  g_signal_connect (client, "close", G_CALLBACK (on_close_set_flag), &close_event);
  g_assert_cmpint (web_socket_connection_get_ready_state (client), ==, WEB_SOCKET_STATE_CONNECTING);

  web_socket_connection_close (client, 0, NULL);
  g_assert_cmpint (web_socket_connection_get_ready_state (client), ==, WEB_SOCKET_STATE_CLOSED);
  g_assert (close_event == TRUE);

  g_object_unref (client);
}

static gboolean
on_idle_real_close (gpointer data)
{
  WebSocketConnection *ws = data;
  web_socket_connection_close (ws, 0, NULL);
  return FALSE;
}

static gboolean
on_closing_send_message (WebSocketConnection *ws,
                         gpointer data)
{
  GBytes *message = data;
  web_socket_connection_send (ws, WEB_SOCKET_DATA_TEXT, NULL, message);
  g_signal_handlers_disconnect_by_func (ws, on_closing_send_message, data);
  g_idle_add (on_idle_real_close, ws);
  return TRUE;
}

static void
test_message_after_closing (Test *test,
                            gconstpointer data)
{
  gboolean close_event_client = FALSE;
  gboolean close_event_server = FALSE;
  GBytes *received = NULL;
  GBytes *message;

  message = g_bytes_new ("another test because", 20);
  g_signal_connect (test->client, "close", G_CALLBACK (on_close_set_flag), &close_event_client);
  g_signal_connect (test->client, "message", G_CALLBACK (on_text_message), &received);
  g_signal_connect (test->server, "close", G_CALLBACK (on_close_set_flag), &close_event_server);
  g_signal_connect (test->server, "closing", G_CALLBACK (on_closing_send_message), message);

  WAIT_UNTIL (web_socket_connection_get_ready_state (test->server) == WEB_SOCKET_STATE_OPEN);
  WAIT_UNTIL (web_socket_connection_get_ready_state (test->client) == WEB_SOCKET_STATE_OPEN);

  web_socket_connection_close (test->client, WEB_SOCKET_CLOSE_GOING_AWAY, "another reason");
  g_assert_cmpint (web_socket_connection_get_ready_state (test->client), ==, WEB_SOCKET_STATE_CLOSING);

  WAIT_UNTIL (web_socket_connection_get_ready_state (test->server) == WEB_SOCKET_STATE_CLOSED);
  WAIT_UNTIL (web_socket_connection_get_ready_state (test->client) == WEB_SOCKET_STATE_CLOSED);

  g_assert (close_event_client);
  g_assert (close_event_server);

  g_assert (received != NULL);
  g_assert (g_bytes_equal (message, received));

  g_bytes_unref (received);
  g_bytes_unref (message);
}

static void
mock_perform_handshake (GIOStream *io)
{
  GHashTable *headers;
  gchar buffer[1024];
  gssize count;
  gssize ret;
  const gchar *key;
  gchar *accept;
  gsize written;

  /* Assumes client codes sends headers as a single write() */
  count = g_input_stream_read (g_io_stream_get_input_stream (io),
                               buffer, sizeof (buffer), NULL, NULL);
  g_assert (count > 0);

  /* Parse the incoming request */
  ret = web_socket_util_parse_req_line (buffer, count, NULL, NULL);
  g_assert_cmpint (ret, >, 0);
  ret = web_socket_util_parse_headers (buffer + ret, count - ret, &headers);
  g_assert_cmpint (ret, >, 0);

  key = g_hash_table_lookup (headers, "Sec-WebSocket-Key");
  accept = _web_socket_complete_accept_key_rfc6455 (key);

  count = g_snprintf (buffer, sizeof (buffer),
                      "HTTP/1.1 101 Switching Protocols\r\n"
                      "Upgrade: websocket\r\n"
                      "Connection: Upgrade\r\n"
                      "Sec-WebSocket-Accept: %s\r\n"
                      "\r\n", accept);
  g_free (accept);

  if (!g_output_stream_write_all (g_io_stream_get_output_stream (io),
                                  buffer, count, &written, NULL, NULL))
    g_assert_not_reached ();
  g_assert_cmpuint (count, ==, written);

  g_hash_table_unref (headers);
}

static gpointer
handshake_then_timeout_server_thread (gpointer user_data)
{
  GIOStream *io = user_data;
  mock_perform_handshake (io);
  return NULL;
}

static void
test_close_after_timeout (void)
{
  WebSocketConnection *client;
  gboolean close_event = FALSE;
  GIOStream *io_a;
  GIOStream *io_b;
  GThread *thread;

  /* Note that no server is around in this test, so no close happens */
  create_iostream_pair (&io_a, &io_b);
  thread = g_thread_new ("timeout-thread", handshake_then_timeout_server_thread, io_a);

  client = web_socket_client_new_for_stream ("ws://localhost/unix", NULL, NULL, io_b);

  g_signal_connect (client, "close", G_CALLBACK (on_close_set_flag), &close_event);
  g_signal_connect (client, "error", G_CALLBACK (on_error_not_reached), NULL);
  WAIT_UNTIL (web_socket_connection_get_ready_state (client) == WEB_SOCKET_STATE_OPEN);

  /* Now try and close things */
  web_socket_connection_close (client, 0, NULL);
  g_assert_cmpint (web_socket_connection_get_ready_state (client), ==, WEB_SOCKET_STATE_CLOSING);

#if 0
  /* g_test_expect_message is pretty much incompatible with g_debug() */
  g_test_expect_message (G_LOG_DOMAIN, G_LOG_LEVEL_MESSAGE, "server did not close io when expected");
#endif
  WAIT_UNTIL (web_socket_connection_get_ready_state (client) == WEB_SOCKET_STATE_CLOSED);

  g_assert (close_event == TRUE);
  g_object_unref (client);

  /* Now actually close the server side stream */
  g_thread_join (thread);
  g_object_unref (io_a);
  g_object_unref (io_b);
}

static gpointer
send_fragments_server_thread (gpointer user_data)
{
  GIOStream *io = user_data;
  gsize written;

  const gchar fragments[] = "\x01\x04""one "   /* !fin | opcode */
                            "\x00\x04""two "   /* !fin | no opcode */
                            "\x80\x05""three"; /* fin  | no opcode */

  mock_perform_handshake (io);

  if (!g_output_stream_write_all (g_io_stream_get_output_stream (io),
                                  fragments, sizeof (fragments) -1, &written, NULL, NULL))
    g_assert_not_reached ();
  g_assert_cmpuint (written, ==, sizeof (fragments) - 1);

  return NULL;
}

static void
test_receive_fragmented (void)
{
  WebSocketConnection *client;
  GIOStream *io_a;
  GIOStream *io_b;
  GThread *thread;
  GBytes *received = NULL;
  GBytes *expect;

  /* Note that no server is around in this test, so no close happens */
  create_iostream_pair (&io_a, &io_b);
  thread = g_thread_new ("fragment-thread", send_fragments_server_thread, io_a);

  client = web_socket_client_new_for_stream ("ws://localhost/unix", NULL, NULL, io_b);
  g_signal_connect (client, "error", G_CALLBACK (on_error_not_reached), NULL);
  g_signal_connect (client, "message", G_CALLBACK (on_text_message), &received);

  WAIT_UNTIL (received != NULL);
  expect = g_bytes_new ("one two three", 13);
  g_assert (g_bytes_equal (expect, received));
  g_bytes_unref (expect);
  g_bytes_unref (received);

  g_thread_join (thread);
  g_object_unref (client);
  g_object_unref (io_a);
  g_object_unref (io_b);
}

static gpointer
client_thread (gpointer data)
{
  GIOStream *io = data;
  GMainContext *context;
  WebSocketConnection *client;

  context = g_main_context_new ();
  g_main_context_push_thread_default (context);

  client = web_socket_client_new_for_stream ("ws://localhost/unix", NULL, NULL, io);
  g_signal_connect (client, "error", G_CALLBACK (on_error_not_reached), NULL);

  while (web_socket_connection_get_ready_state (client) != WEB_SOCKET_STATE_CLOSED)
    g_main_context_iteration (context, TRUE);

  g_main_context_pop_thread_default (context);
  g_main_context_unref (context);

  g_object_unref (client);
  return NULL;
}

static gpointer
server_thread (gpointer data)
{
  WebSocketConnection *server;
  GMainContext *context;

  context = g_main_context_new ();
  g_main_context_push_thread_default (context);

  /* Create a server and respond to handshake */
  server = web_socket_server_new_for_stream ("ws://localhost/unix", NULL,
                                             NULL, data, NULL, NULL);
  g_signal_connect (server, "error", G_CALLBACK (on_error_not_reached), NULL);

  while (web_socket_connection_get_ready_state (server) != WEB_SOCKET_STATE_CLOSED)
    g_main_context_iteration (context, TRUE);

  g_object_unref (server);

  g_main_context_pop_thread_default (context);
  g_main_context_unref (context);

  return NULL;
}

static void
test_handshake_with_buffer_and_headers (void)
{
  WebSocketConnection *server;
  GHashTable *headers;
  GByteArray *input;
  gchar buffer[1024];
  GIOStream *ioc;
  GIOStream *ios;
  gssize count;
  gssize in1, in2;
  GThread *thread;

  create_iostream_pair (&ioc, &ios);

  thread = g_thread_new ("client-thread", client_thread, ioc);

  count = g_input_stream_read (g_io_stream_get_input_stream (ios), buffer,
                               sizeof (buffer), NULL, NULL);
  g_assert_cmpint (count, >, 0);

  /* Parse the incoming request */
  in1 = web_socket_util_parse_req_line (buffer, count, NULL, NULL);
  g_assert_cmpint (in1, >, 0);
  in2 = web_socket_util_parse_headers (buffer + in1, count - in1, &headers);
  g_assert_cmpint (in2, >, 0);

  /* Make a buffer for the rest */
  input = g_byte_array_new ();
  g_byte_array_append (input, (guchar *)buffer + (in1 + in2), count - (in1 + in2));

  server = web_socket_server_new_for_stream ("ws://localhost/unix", NULL,
                                             NULL, ios, headers, input);
  g_signal_connect (server, "error", G_CALLBACK (on_error_not_reached), NULL);

  WAIT_UNTIL (web_socket_connection_get_ready_state (server) != WEB_SOCKET_STATE_CONNECTING);
  g_assert_cmpint (web_socket_connection_get_ready_state (server), ==, WEB_SOCKET_STATE_OPEN);

  web_socket_connection_close (server, 0, NULL);
  WAIT_UNTIL (web_socket_connection_get_ready_state (server) == WEB_SOCKET_STATE_CLOSED);

  g_byte_array_unref (input);
  g_hash_table_unref (headers);
  g_object_unref (server);
  g_thread_join (thread);

  g_object_unref (ioc);
  g_object_unref (ios);
}

typedef struct {
  const gchar *name;
  const gchar *key1;
  const gchar *key2;
} BadHixie76KeyFixture;

static BadHixie76KeyFixture bad_hixie76_key_fixtures[] = {
    { "no-numbers", "no numbers", "no numbers" },
    { "no-spaces", "33456", "992929" },
};

static void
test_bad_hixie76_keys (Test *unused,
                       gconstpointer data)
{
  const BadHixie76KeyFixture *fixture = data;
  WebSocketConnection *server;
  GIOStream *ioc;
  GIOStream *ios;
  gsize count;
  GError *error = NULL;
  gchar *handshake;
  guint logid;

  create_iostream_pair (&ioc, &ios);

  handshake = g_strdup_printf ("GET / HTTP/1.1\r\n"
                               "Host: localhost\r\n"
                               "Upgrade: websocket\r\n"
                               "Connection: upgrade\r\n"
                               "Sec-WebSocket-Key1: %s\r\n"
                               "Sec-WebSocket-Key2: %s\r\n"
                               "\r\n"
                               "01234567", fixture->key1, fixture->key2);

  /* We rely on kernel buffers here, to prevent deadlock in this test */
  if (!g_output_stream_write_all (g_io_stream_get_output_stream (ioc), handshake,
                                  strlen (handshake), &count, NULL, NULL))
    g_assert_not_reached ();
  g_assert_cmpint (count, ==, strlen (handshake));

  logid = g_log_set_handler (G_LOG_DOMAIN, G_LOG_LEVEL_MESSAGE, null_log_handler, NULL);

  server = web_socket_server_new_for_stream ("ws://localhost/unix", NULL,
                                             NULL, ios, NULL, NULL);
  g_signal_connect (server, "error", G_CALLBACK (on_error_copy), &error);

  WAIT_UNTIL (web_socket_connection_get_ready_state (server) != WEB_SOCKET_STATE_CONNECTING);
  g_assert_error (error, WEB_SOCKET_ERROR, WEB_SOCKET_CLOSE_PROTOCOL);

  /* Should close by itself when invalid handshake */
  WAIT_UNTIL (web_socket_connection_get_ready_state (server) == WEB_SOCKET_STATE_CLOSED);

  g_free (handshake);
  g_error_free (error);
  g_object_unref (server);
  g_object_unref (ioc);
  g_object_unref (ios);

  g_log_remove_handler (G_LOG_DOMAIN, logid);
}

static void
test_hixie76_response_headers (void)
{
  GIOStream *ioc;
  GIOStream *ios;
  gsize written;
  gssize count;
  gchar buffer[1024];
  GHashTable *headers;
  guint status;
  const gchar *handshake;
  gssize in1, in2;
  GThread *thread;

  create_iostream_pair (&ioc, &ios);

  handshake = "GET /this/is/my/path HTTP/1.1\r\n"
              "Host: example.com:3838\r\n"
              "Upgrade: websocket\r\n"
              "Connection: upgrade\r\n"
              "Sec-WebSocket-Key1: m2 304 4880M 4. } Y z 6\r\n"
              "Sec-WebSocket-Key2: u1   9 944  5$ %s40   <  U96`\r\n"
              "Sec-WebSocket-Protocol: cockpit1\r\n"
              "Origin: http://example.com\r\n"
              "\r\n"
              "01234567";

  /* We rely on kernel buffers here, to prevent deadlock in this test */
  if (!g_output_stream_write_all (g_io_stream_get_output_stream (ioc), handshake,
                                  strlen (handshake), &written, NULL, NULL))
    g_assert_not_reached ();
  g_assert_cmpint (written, ==, strlen (handshake));

  thread = g_thread_new ("server-thread", server_thread, ios);

  /* We rely on kernel buffers here, to prevent deadlock in this test */
  count = g_input_stream_read (g_io_stream_get_input_stream (ioc), buffer,
                               sizeof (buffer), NULL, NULL);
  g_assert (count > 0);

  /* Parse things out */
  in1 = web_socket_util_parse_status_line (buffer, count, NULL, &status, NULL);
  g_assert_cmpint (in1, >, 0);
  in2 = web_socket_util_parse_headers (buffer + in1, count - in1, &headers);
  g_assert_cmpint (in2, >, 0);

  /* Check what we got back */
  g_assert_cmpuint (status, ==, 101);
  g_assert_cmpstr (g_hash_table_lookup (headers, "Sec-WebSocket-Location"), ==, "ws://example.com:3838/this/is/my/path");
  g_assert_cmpstr (g_hash_table_lookup (headers, "Sec-WebSocket-Origin"), ==, "http://example.com");
  g_assert_cmpstr (g_hash_table_lookup (headers, "Sec-WebSocket-Protocol"), ==, "cockpit1");
  g_assert_cmpstr (g_hash_table_lookup (headers, "Upgrade"), ==, "WebSocket");
  g_assert_cmpstr (g_hash_table_lookup (headers, "Connection"), ==, "Upgrade");

  g_object_unref (ioc);

  g_thread_join (thread);
  g_hash_table_unref (headers);
  g_object_unref (ios);
}

static gpointer
close_rough_thread (gpointer data)
{
  GIOStream *io = data;
  const gchar *handshake;
  gchar buffer[1024];
  GError *error = NULL;
  gssize count;
  gsize written;

  /* hixie76 handshake */
  handshake = "GET /this/is/my/path HTTP/1.1\r\n"
              "Host: example.com:3838\r\n"
              "Upgrade: websocket\r\n"
              "Connection: upgrade\r\n"
              "Sec-WebSocket-Key1: m2 304 4880M 4. } Y z 6\r\n"
              "Sec-WebSocket-Key2: u1   9 944  5$ %s40   <  U96`\r\n"
              "Sec-WebSocket-Protocol: cockpit1\r\n"
              "Origin: http://example.com\r\n"
              "\r\n"
              "01234567";

  /* We rely on kernel buffers here, to prevent deadlock in this test */
  if (!g_output_stream_write_all (g_io_stream_get_output_stream (io), handshake,
                                  strlen (handshake), &written, NULL, NULL))
    g_assert_not_reached ();
  g_assert_cmpint (written, ==, strlen (handshake));

  /* We rely on kernel buffers here, to prevent deadlock in this test */
  count = g_input_stream_read (g_io_stream_get_input_stream (io), buffer,
                               sizeof (buffer), NULL, NULL);
  g_assert (count > 0);

  /* Now close it hard */
  g_io_stream_close (io, NULL, &error);
  g_assert_no_error (error);

  return NULL;
}

static void
test_hixie76_rough_close (void)
{
  gboolean opened = FALSE;
  WebSocketConnection *server;
  GMainContext *context;
  GIOStream *ioc;
  GIOStream *ios;
  GThread *thread;

  create_iostream_pair (&ioc, &ios);

  context = g_main_context_new ();
  g_main_context_push_thread_default (context);

  /* Create a server and respond to handshake */
  server = web_socket_server_new_for_stream ("ws://localhost/unix", NULL,
                                             NULL, ios, NULL, NULL);
  g_signal_connect (server, "error", G_CALLBACK (on_error_not_reached), NULL);
  g_signal_connect (server, "open", G_CALLBACK (on_open_set_flag), &opened);

  thread = g_thread_new ("rough-thread", close_rough_thread, ioc);

  while (web_socket_connection_get_ready_state (server) != WEB_SOCKET_STATE_CLOSED)
    g_main_context_iteration (context, TRUE);

  /*
   * HACK: in the future assert no g_message, but message asserts are broken in glib + g_debug
   * https://bugzilla.gnome.org/show_bug.cgi?id=710991
   */
  g_assert (opened == TRUE);
  g_assert (g_io_stream_is_closed (ios));

  g_thread_join (thread);
  g_assert (g_io_stream_is_closed (ioc));

  g_object_unref (server);

  g_main_context_pop_thread_default (context);
  g_main_context_unref (context);

  g_object_unref (ioc);
  g_object_unref (ios);
}

int
main (int argc,
      char *argv[])
{
  gchar *name;
  gint i, j;

  FlavorFixture fixtures[] = {
      { WEB_SOCKET_FLAVOR_RFC6455, "rfc6455" },
      { WEB_SOCKET_FLAVOR_HIXIE76, "hixie76" },
  };

  struct {
    void (* func) (Test *, gconstpointer);
    const gchar *name;
  } tests_with_client_server_pair[] = {
      { test_handshake, "handshake" },
      { test_send_client_to_server, "send-client-to-server" },
      { test_send_server_to_client, "send-server-to-client" },
      { test_send_big_packets, "send-big-packets" },
      { test_send_prefixed, "send-prefixed" },
      { test_send_bad_data, "send-bad-data" },
      { test_protocol_negotiate, "protocol-negotiate" },
      { test_protocol_mismatch, "protocol-mismatch" },
      { test_protocol_server_any, "protocol-server-any" },
      { test_protocol_client_any, "protocol-client-any" },
      { test_close_clean_client, "close-clean-client" },
      { test_close_clean_server, "close-clean-server" },
  };

  signal (SIGPIPE, SIG_IGN);
  g_setenv ("GSETTINGS_BACKEND", "memory", TRUE);
  g_setenv ("GIO_USE_PROXY_RESOLVER", "dummy", TRUE);
  g_setenv ("GIO_USE_VFS", "local", TRUE);

#if !GLIB_CHECK_VERSION(2,36,0)
  g_type_init ();
#endif

  g_set_prgname ("test-websocket");
  g_test_init (&argc, &argv, NULL);

  g_test_add_func ("/web-socket/parse-url", test_parse_url);
  g_test_add_func ("/web-socket/parse-url-no-out", test_parse_url_no_out);
  g_test_add_func ("/web-socket/parse-url-bad", test_parse_url_bad);
  g_test_add_func ("/web-socket/parse-url-no-path", test_parse_url_no_path);
  g_test_add_func ("/web-socket/parse-url-with-user", test_parse_url_with_user);
  g_test_add_func ("/web-socket/parse-req", test_parse_req);
  g_test_add_func ("/web-socket/parse-req-no-out", test_parse_req_no_out);
  g_test_add_func ("/web-socket/parse-req-not-enough", test_parse_req_not_enough);
  g_test_add_func ("/web-socket/parse-req-bad", test_parse_req_bad);
  g_test_add_func ("/web-socket/parse-status", test_parse_status);
  g_test_add_func ("/web-socket/parse-status-no-out", test_parse_status_no_out);
  g_test_add_func ("/web-socket/parse-status-not-enough", test_parse_status_not_enough);
  g_test_add_func ("/web-socket/parse-status-bad", test_parse_status_bad);
  g_test_add_func ("/web-socket/parse-version-1-0", test_parse_version_1_0);
  g_test_add_func ("/web-socket/parse-version-1-1", test_parse_version_1_1);
  g_test_add_func ("/web-socket/parse-headers", test_parse_headers);
  g_test_add_func ("/web-socket/parse-headers-no-out", test_parse_headers_no_out);
  g_test_add_func ("/web-socket/parse-headers-bad", test_parse_headers_bad);
  g_test_add_func ("/web-socket/parse-headers-not-enough", test_parse_headers_not_enough);
  g_test_add_func ("/web-socket/header-equals", test_header_equals);
  g_test_add_func ("/web-socket/header-contains", test_header_contains);
  g_test_add_func ("/web-socket/header-empty", test_header_empty);

  for (i = 0; i < G_N_ELEMENTS (fixtures); i++)
    {
      for (j = 0; j < G_N_ELEMENTS (tests_with_client_server_pair); j++)
        {
          name = g_strdup_printf ("/web-socket/%s/%s", fixtures[i].flavor_name, tests_with_client_server_pair[j].name);
          g_test_add (name, Test, fixtures + i, setup_pair, tests_with_client_server_pair[j].func, teardown);
          g_free (name);
        }
    }

  g_test_add_func ("/web-socket/close-immediately", test_close_immediately);
  if (g_test_slow ())
    g_test_add_func ("/web-socket/close-after-timeout", test_close_after_timeout);
  g_test_add_func ("/web-socket/receive-fragmented", test_receive_fragmented);
  g_test_add_func ("/web-socket/handshake-with-buffer-headers", test_handshake_with_buffer_and_headers);

  g_test_add ("/web-socket/message-after-closing", Test, fixtures,
              setup_pair, test_message_after_closing, teardown);

  for (i = 0; i < G_N_ELEMENTS (bad_hixie76_key_fixtures); i++)
    {
      name = g_strdup_printf ("/web-socket/hixie76/bad-keys-%s", bad_hixie76_key_fixtures[i].name);
      g_test_add (name, Test, bad_hixie76_key_fixtures + i, NULL, test_bad_hixie76_keys, NULL);
      g_free (name);
    }

  g_test_add_func ("/web-socket/hixie76/response-headers", test_hixie76_response_headers);
  g_test_add_func ("/web-socket/hixie76/rough-close", test_hixie76_rough_close);

  return g_test_run ();
}
