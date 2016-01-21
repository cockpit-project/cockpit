
/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
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

#include "cockpitwebsocketstream.h"
#include "cockpitchannel.h"

#include "common/cockpittest.h"
#include "common/cockpitwebresponse.h"
#include "common/cockpitwebserver.h"
#include "websocket/websocketclient.h"

#include "mock-transport.h"

#include <string.h>

static void
on_closed_get_problem (CockpitChannel *channel,
                       const gchar *problem,
                       gpointer user_data)
{
  gchar **result = user_data;
  g_assert (problem != NULL);
  g_assert (*result == NULL);
  *result = g_strdup (problem);
}

typedef struct {
  MockTransport *transport;
  CockpitWebServer *server;
  GIOStream *client;
  guint port;
  gchar *origin;
  gchar *url;
  gboolean ws_closed;
} TestCase;

static void
on_socket_message (WebSocketConnection *self,
                   WebSocketDataType type,
                   GBytes *message,
                   gpointer user_data)
{
  GByteArray *array = g_bytes_unref_to_array (g_bytes_ref (message));
  GBytes *payload;
  guint i;

  /* Capitalize and relay back */
  for (i = 0; i < array->len; i++)
    array->data[i] = g_ascii_toupper (array->data[i]);

  payload = g_byte_array_free_to_bytes (array);
  web_socket_connection_send (self, type, NULL, payload);
  g_bytes_unref (payload);
}

static void
on_socket_close (WebSocketConnection *ws,
                 gpointer user_data)
{
  TestCase *test = user_data;
  g_object_unref (ws);
  test->ws_closed = TRUE;
}

static gboolean
handle_socket (CockpitWebServer *server,
               const gchar *path,
               GIOStream *io_stream,
               GHashTable *headers,
               GByteArray *input,
               gpointer data)
{
  const gchar *origins[] = { NULL, NULL };
  const gchar *protocols[] = { "one", "two", "three", NULL };
  WebSocketConnection *ws = NULL;
  TestCase *test = data;

  if (!g_str_equal (path, "/socket"))
    return FALSE;

  origins[0] = test->origin;
  ws = web_socket_server_new_for_stream (test->url, (const gchar **)origins,
                                         protocols, io_stream, headers, input);

  g_signal_connect (ws, "message", G_CALLBACK (on_socket_message), NULL);
  g_signal_connect (ws, "close", G_CALLBACK (on_socket_close), test);
  return TRUE;
}


static void
setup (TestCase *test,
       gconstpointer data)
{
  test->server = cockpit_web_server_new (0, NULL, NULL, NULL, NULL);
  test->port = cockpit_web_server_get_port (test->server);
  test->transport = mock_transport_new ();
  test->ws_closed = FALSE;
  test->origin = g_strdup_printf ("http://localhost:%u", test->port);
  test->url = g_strdup_printf ("ws://localhost:%u/socket", test->port);
  g_signal_connect (test->server, "handle-stream",
                    G_CALLBACK (handle_socket), test);
}

static void
teardown (TestCase *test,
          gconstpointer data)
{
  g_object_unref (test->server);
  g_object_unref (test->transport);

  g_free (test->origin);
  g_free (test->url);
  cockpit_assert_expected ();
}

static void
test_basic (TestCase *test,
            gconstpointer data)
{
  JsonObject *options;
  CockpitChannel *channel;
  GBytes *bytes = NULL;
  GBytes *recv = NULL;

  options = json_object_new ();
  json_object_set_int_member (options, "port", test->port);
  json_object_set_string_member (options, "payload", "websocket-stream1");
  json_object_set_string_member (options, "path", "/socket");

  channel = g_object_new (COCKPIT_TYPE_WEB_SOCKET_STREAM,
                          "transport", test->transport,
                          "id", "444",
                          "options", options,
                          NULL);
  json_object_unref (options);

  bytes = g_bytes_new ("Message", 7);
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (test->transport), "444", bytes);
  g_bytes_unref (bytes);

  while (mock_transport_count_sent (test->transport) < 3)
    g_main_context_iteration (NULL, TRUE);

  recv = mock_transport_pop_channel (test->transport, "444");
  cockpit_assert_bytes_eq (recv, "MESSAGE", 7);
  g_bytes_unref (recv);

  cockpit_channel_close (channel, "ending");

  while (!test->ws_closed)
    g_main_context_iteration (NULL, TRUE);

  g_object_unref (channel);
}

static void
test_bad_origin (TestCase *test,
                 gconstpointer data)
{
  JsonObject *options;
  CockpitChannel *channel;
  gchar *problem = NULL;

  options = json_object_new ();
  json_object_set_int_member (options, "port", test->port);
  json_object_set_string_member (options, "payload", "websocket-stream1");
  json_object_set_string_member (options, "path", "/socket");

  g_free (test->origin);
  test->origin = g_strdup ("bad-origin");

  channel = g_object_new (COCKPIT_TYPE_WEB_SOCKET_STREAM,
                          "transport", test->transport,
                          "id", "444",
                          "options", options,
                          NULL);
  g_signal_connect (channel, "closed", G_CALLBACK (on_closed_get_problem), &problem);
  json_object_unref (options);

  while (problem == NULL)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpstr (problem, ==, "protocol-error");
  while (!test->ws_closed)
    g_main_context_iteration (NULL, TRUE);

  g_object_unref (channel);
  g_free (problem);
}

int
main (int argc,
      char *argv[])
{
  cockpit_test_init (&argc, &argv);

  g_test_add ("/websocket-stream/test_basic", TestCase, NULL,
              setup, test_basic, teardown);
  g_test_add ("/websocket-stream/test_bad_origin", TestCase, NULL,
              setup, test_bad_origin, teardown);
  return g_test_run ();
}
