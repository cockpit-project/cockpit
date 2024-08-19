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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

#include "config.h"

#include "websocket.h"
#include "websocketprivate.h"

#include "common/cockpitflow.h"
#include "common/cockpitsocket.h"
#include "testlib/mock-pressure.h"

#include <string.h>

typedef struct {
  WebSocketConnection *client;
  WebSocketConnection *server;
} Test;

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

  for (gint i = 0; i < G_N_ELEMENTS (reqs); i++)
    {
      gchar *path;
      gchar *method;

      gssize ret = web_socket_util_parse_req_line (reqs[i], strlen (reqs[i]), &method, &path);
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

  for (gint i = 0; i < G_N_ELEMENTS (lines); i++)
    {
      guint status;
      gchar *reason;

      gssize ret = web_socket_util_parse_status_line (lines[i], strlen (lines[i]), NULL, &status, &reason);
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
  GHashTable *headers;
  gssize ret;

  const gchar *input =
      "Header1: value3\r\n"
      "Header2:  field\r\n"
      "Head3:  Another \r\n"
      "Host:https://cockpit-project.org\r\n"
      "Funny:  a☺b\r\n"
      "\r\n"
      "BODY  ";

  ret = web_socket_util_parse_headers (input, strlen (input), &headers);
  g_assert_cmpint (ret, ==, strlen (input) - 6);
  g_assert_cmpstr (g_hash_table_lookup (headers, "header1"), ==, "value3");
  g_assert_cmpstr (g_hash_table_lookup (headers, "Header2"), ==, "field");
  g_assert_cmpstr (g_hash_table_lookup (headers, "hEAD3"), ==, "Another");
  g_assert_cmpstr (g_hash_table_lookup (headers, "Host"), ==, "https://cockpit-project.org");
  g_assert_cmpstr (g_hash_table_lookup (headers, "Funny"), ==, "a☺b");
  g_assert (g_hash_table_lookup (headers, "Something else") == NULL);
  g_hash_table_unref (headers);
}

static void
test_parse_duplicate_headers (void)
{
  GHashTable *headers;
  gssize ret;

  const gchar *input =
      "header1: value2\r\n"
      "Header1: value3\r\n"
      "\r\n"
      "BODY  ";

  ret = web_socket_util_parse_headers (input, strlen (input), &headers);
  g_assert_cmpint (ret, ==, strlen (input) - 6);
  g_assert_cmpstr (g_hash_table_lookup (headers, "header1"), ==, "value3");
  g_assert (g_hash_table_lookup (headers, "Something else") == NULL);
  g_hash_table_unref (headers);
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
      "Head3:  Another";

  gssize ret;

  ret = web_socket_util_parse_headers (input, strlen (input), NULL);
  g_assert_cmpint (ret, ==, 0);
}

static void
test_parse_headers_bad (void)
{
  const gchar *input[] = {
      /* missing : */
      "Header1 value3\r\n"
      "\r\n"
      "BODY  ",

      /* binary garbage (not even UTF8) */
      "Header1: a\xFF\x01b\r\n"
      "\r\n"
      "BODY  ",
  };

  gssize ret;
  gint i;

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
  g_hash_table_insert (headers, g_strdup ("Funny"), g_strdup ("a☺b"));

  g_assert (_web_socket_util_header_equals (headers, "blah", "Value"));
  g_assert (_web_socket_util_header_equals (headers, "Funny", "a☺b"));

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

static void
setup_pair (Test *test,
            gconstpointer data)
{
  GIOStream *ioc;
  GIOStream *ios;

  cockpit_socket_streampair (&ioc, &ios);

  test->server = web_socket_server_new_for_stream ("ws://localhost/unix", NULL, NULL, ios, NULL, NULL);
  test->client =  web_socket_client_new_for_stream ("ws://localhost/unix", NULL, NULL, ioc);

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

static gboolean
on_timeout_set_flag (gpointer user_data)
{
  gboolean *data = user_data;
  g_assert (user_data);
  g_assert (*data == FALSE);
  *data = TRUE;
  return FALSE;
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
on_message_append (WebSocketConnection *ws,
                   WebSocketDataType type,
                   GBytes *message,
                   gpointer user_data)
{
  GByteArray *received = user_data;
  g_assert (received != NULL);
  g_byte_array_append (received, g_bytes_get_data (message, NULL), g_bytes_get_size (message));
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
on_pressure_set_throttle (WebSocketConnection *socket,
                          gboolean throttle,
                          gpointer user_data)
{
  gint *data = user_data;
  g_assert (user_data != NULL);
  *data = throttle ? 1 : 0;
}

static void
test_pressure_queue (Test *test,
                     gconstpointer data)
{
  GBytes *sent = NULL;
  gint throttle = -1;
  gint i;

  g_signal_connect (test->server, "pressure", G_CALLBACK (on_pressure_set_throttle), &throttle);

  WAIT_UNTIL (web_socket_connection_get_ready_state (test->server) != WEB_SOCKET_STATE_CONNECTING);
  g_assert_cmpint (web_socket_connection_get_ready_state (test->server), ==, WEB_SOCKET_STATE_OPEN);

  sent = g_bytes_new_take (g_strnfill (10 * 1000, '!'), 10 * 1000);
  for (i = 0; i < 1000; i++)
    web_socket_connection_send (test->server, WEB_SOCKET_DATA_TEXT, NULL, sent);
  g_bytes_unref (sent);

  /*
   * This should have put way too much in the queue, and thus
   * emitted the back-pressure signal. This signal would normally
   * be used by others to slow down their queueing, but in this
   * case we just check that it was fired.
   */
  g_assert_cmpint (throttle, ==, 1);
  throttle = -1;

  /*
   * Now the queue is getting drained. At some point, it will be
   * signaled that back pressure has been turned off
   */
  while (throttle == -1)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpint (throttle, ==, 0);
}

static void
test_pressure_throttle (Test *test,
                        gconstpointer data)
{
  CockpitFlow *pressure = mock_pressure_new ();
  GBytes *sent = NULL;
  GByteArray *received = NULL;
  gboolean timeout = FALSE;
  gsize length;
  gint i;

  received = g_byte_array_new ();
  cockpit_flow_throttle (COCKPIT_FLOW (test->client), pressure);
  g_signal_connect (test->client, "message", G_CALLBACK (on_message_append), received);

  while (web_socket_connection_get_ready_state (test->server) == WEB_SOCKET_STATE_CONNECTING)
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpint (web_socket_connection_get_ready_state (test->server), ==, WEB_SOCKET_STATE_OPEN);

  /* Send this a thousand times over the socket */
  sent = g_bytes_new_take (g_strnfill (10 * 1000, '?'), 10 * 1000);
  for (i = 0; i < 1000; i++)
    web_socket_connection_send (test->server, WEB_SOCKET_DATA_TEXT, NULL, sent);
  g_bytes_unref (sent);

  /*
   * So we should start receiving the echoed data. But we apply
   * the throttle pressure after receiving some data, and the rest
   * just waits.
   */
  while (received->len == 0)
    g_main_context_iteration (NULL, TRUE);
  g_signal_emit_by_name (pressure, "pressure", TRUE);

  length = received->len;
  g_assert_cmpint (length, <, 10 * 1000 * 1000);

  /* Now remaining data input should wait, no further data received*/
  g_timeout_add_seconds (2, on_timeout_set_flag, &timeout);
  while (timeout == FALSE)
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpint (length, ==, received->len);

  /* Remove the pressure, and we should get more data */
  g_signal_emit_by_name (pressure, "pressure", FALSE);
  while (length < received->len)
    g_main_context_iteration (NULL, TRUE);

  /* Clearing the throttle should work too. This pressure signal has no effect */
  cockpit_flow_throttle (COCKPIT_FLOW (test->client), NULL);
  g_signal_emit_by_name (pressure, "pressure", TRUE);

  /* Now wait for the remaining data */
  while (received->len < 10 * 1000 * 1000)
    g_main_context_iteration (NULL, TRUE);

  g_byte_array_free (received, TRUE);
  g_object_unref (pressure);
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

  /* Bad UTF-8 raw frames */
  frame = "\x81\x04\xEE\xEE\xEE\xEE";

  if (!g_output_stream_write_all (g_io_stream_get_output_stream (io),
                                  frame, 6, &written, NULL, NULL))
    g_assert_not_reached ();
  g_assert_cmpuint (written, ==, 6);

  WAIT_UNTIL (error != NULL);
  g_assert_error (error, WEB_SOCKET_ERROR, WEB_SOCKET_CLOSE_BAD_DATA);

  WAIT_UNTIL (web_socket_connection_get_ready_state (test->client) == WEB_SOCKET_STATE_CLOSED);

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

  g_assert_cmpint (web_socket_connection_get_close_code (test->client), ==, WEB_SOCKET_CLOSE_GOING_AWAY);
  g_assert_cmpint (web_socket_connection_get_close_code (test->server), ==, WEB_SOCKET_CLOSE_GOING_AWAY);
  g_assert_cmpstr (web_socket_connection_get_close_data (test->server), ==, "give me a reason");
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

  g_assert_cmpint (web_socket_connection_get_close_code (test->server), ==, WEB_SOCKET_CLOSE_GOING_AWAY);
  g_assert_cmpint (web_socket_connection_get_close_code (test->client), ==, WEB_SOCKET_CLOSE_GOING_AWAY);
  g_assert_cmpstr (web_socket_connection_get_close_data (test->client), ==, "another reason");
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
  cockpit_socket_streampair (&io_a, &io_b);
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
  cockpit_socket_streampair (&io_a, &io_b);
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

  cockpit_socket_streampair (&ioc, &ios);

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

int
main (int argc,
      char *argv[])
{
  gchar *name;
  gint j;

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
      { test_pressure_queue, "pressure-queue" },
      { test_pressure_throttle, "pressure-throttle" },
      { test_protocol_negotiate, "protocol-negotiate" },
      { test_protocol_mismatch, "protocol-mismatch" },
      { test_protocol_server_any, "protocol-server-any" },
      { test_protocol_client_any, "protocol-client-any" },
      { test_close_clean_client, "close-clean-client" },
      { test_close_clean_server, "close-clean-server" },
  };

  signal (SIGPIPE, SIG_IGN);
  g_assert (g_setenv ("GSETTINGS_BACKEND", "memory", TRUE));
  g_assert (g_setenv ("GIO_USE_PROXY_RESOLVER", "dummy", TRUE));
  g_assert (g_setenv ("GIO_USE_VFS", "local", TRUE));

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
  g_test_add_func ("/web-socket/parse-duplicate-headers", test_parse_duplicate_headers);
  g_test_add_func ("/web-socket/parse-headers-no-out", test_parse_headers_no_out);
  g_test_add_func ("/web-socket/parse-headers-bad", test_parse_headers_bad);
  g_test_add_func ("/web-socket/parse-headers-not-enough", test_parse_headers_not_enough);
  g_test_add_func ("/web-socket/header-equals", test_header_equals);
  g_test_add_func ("/web-socket/header-contains", test_header_contains);
  g_test_add_func ("/web-socket/header-empty", test_header_empty);

  for (j = 0; j < G_N_ELEMENTS (tests_with_client_server_pair); j++)
    {
      name = g_strdup_printf ("/web-socket/%s", tests_with_client_server_pair[j].name);
      g_test_add (name, Test, NULL, setup_pair, tests_with_client_server_pair[j].func, teardown);
      g_free (name);
    }

  g_test_add_func ("/web-socket/close-immediately", test_close_immediately);
  if (g_test_slow ())
    g_test_add_func ("/web-socket/close-after-timeout", test_close_after_timeout);
  g_test_add_func ("/web-socket/receive-fragmented", test_receive_fragmented);
  g_test_add_func ("/web-socket/handshake-with-buffer-headers", test_handshake_with_buffer_and_headers);

  g_test_add ("/web-socket/message-after-closing", Test, NULL, setup_pair, test_message_after_closing, teardown);

  return g_test_run ();
}
