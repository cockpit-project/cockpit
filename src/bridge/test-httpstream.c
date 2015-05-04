
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

#include "cockpithttpstream.h"
#include "cockpithttpstream.c"
#include "common/cockpittest.h"
#include "common/cockpitwebresponse.h"
#include "common/cockpitwebserver.h"

#include "mock-transport.h"
#include <json-glib/json-glib.h>

/* -----------------------------------------------------------------------------
 * Test
 */

typedef struct {
  gchar *problem;
  gboolean done;
} TestResult;

/*
 * Yes this is a magic number. It's the lowest number that would
 * trigger a bug where chunked data would be rejected due to an incomplete read.
 */
const gint MAGIC_NUMBER = 3068;

static gboolean
handle_chunked (CockpitWebServer *server,
                const gchar *path,
                GHashTable *headers,
                CockpitWebResponse *response,
                gpointer user_data)
{
  GBytes *bytes;
  GHashTable *h = g_hash_table_new (g_str_hash,  g_str_equal);

  cockpit_web_response_headers_full (response, 200,
                                     "OK", -1, h);
  bytes = g_bytes_new_take (g_strdup_printf ("%0*d",
                                             MAGIC_NUMBER, 0),
                            MAGIC_NUMBER);
  cockpit_web_response_queue (response, bytes);
  cockpit_web_response_complete (response);

  g_bytes_unref (bytes);
  g_hash_table_unref (h);
  return TRUE;
}

static void
on_channel_close (CockpitChannel *channel,
                  const gchar *problem,
                  gpointer user_data)
{
  TestResult *tr = user_data;
  g_assert (tr->done == FALSE);
  tr->done = TRUE;
  tr->problem = g_strdup (problem);
}

static void
on_transport_closed (CockpitTransport *transport,
                     const gchar *problem,
                     gpointer user_data)
{
  g_assert_not_reached ();
}

static void
test_http_chunked (void)
{
  MockTransport *transport = NULL;
  CockpitChannel *channel = NULL;
  CockpitWebServer *web_server = NULL;
  JsonObject *options = NULL;
  JsonObject *headers = NULL;
  TestResult *tr = g_slice_new (TestResult);

  GBytes *bytes = NULL;
  GBytes *data = NULL;

  const gchar *control;
  gchar *expected = g_strdup_printf ("{\"status\":200,\"reason\":\"OK\",\"headers\":{}}%0*d", MAGIC_NUMBER, 0);
  guint count;
  guint port;

  web_server = cockpit_web_server_new (0, NULL,
                                      NULL, NULL, NULL);
  g_assert (web_server);
  port = cockpit_web_server_get_port (web_server);
  g_signal_connect (web_server, "handle-resource::/",
                    G_CALLBACK (handle_chunked), NULL);

  transport = mock_transport_new ();
  g_signal_connect (transport, "closed", G_CALLBACK (on_transport_closed), NULL);

  options = json_object_new ();
  json_object_set_int_member (options, "port", port);
  json_object_set_string_member (options, "payload", "http-stream1");
  json_object_set_string_member (options, "method", "GET");
  json_object_set_string_member (options, "path", "/");

  headers = json_object_new ();
  json_object_set_string_member (headers, "Pragma", "no-cache");
  json_object_set_object_member (options, "headers", headers);

  channel = g_object_new (COCKPIT_TYPE_HTTP_STREAM,
                              "transport", transport,
                              "id", "444",
                              "options", options,
                              NULL);

  json_object_unref (options);

  /* Tell HTTP we have no more data to send */
  control = "{\"command\": \"done\", \"channel\": \"444\"}";
  bytes = g_bytes_new_static (control, strlen (control));
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (transport), NULL, bytes);
  g_bytes_unref (bytes);

  tr->done = FALSE;
  g_signal_connect (channel, "closed", G_CALLBACK (on_channel_close), tr);

  while (tr->done == FALSE)
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpstr (tr->problem, ==, NULL);

  data = mock_transport_combine_output (transport, "444", &count);
  cockpit_assert_bytes_eq (data, expected, -1);
  g_assert_cmpuint (count, ==, 2);

  g_bytes_unref (data);
  g_free (expected);

  g_object_unref (transport);
  g_object_add_weak_pointer (G_OBJECT (channel), (gpointer *)&channel);
  g_object_unref (channel);
  g_assert (channel == NULL);
  g_clear_object (&web_server);

  g_free (tr->problem);
  g_slice_free (TestResult, tr);
}

static void
test_parse_keep_alive (void)
{
  const gchar *version;
  GHashTable *headers;
  MockTransport *transport;
  CockpitHttpStream *stream;

  JsonObject *options;
  options = json_object_new ();
  transport = g_object_new (mock_transport_get_type (), NULL);
  stream = g_object_new (COCKPIT_TYPE_HTTP_STREAM,
                            "transport", transport,
                            "id", "1",
                            "options", options,
                            NULL);

  headers = g_hash_table_new (g_str_hash, g_str_equal);

  version = "HTTP/1.1";
  g_hash_table_insert (headers, "Connection", "keep-alive");

  parse_keep_alive (stream, version, headers);
  g_assert (stream->keep_alive == TRUE);

  version = "HTTP/1.0";
  parse_keep_alive (stream, version, headers);
  g_assert (stream->keep_alive == TRUE);


  g_hash_table_remove (headers, "Connection");

  parse_keep_alive (stream, version, headers);
  g_assert (stream->keep_alive == FALSE);

  version = "HTTP/1.1";
  parse_keep_alive (stream, version, headers);
  g_assert (stream->keep_alive == TRUE);

  g_hash_table_destroy (headers);
  g_object_unref (transport);
  g_object_unref (stream);
  json_object_unref (options);
}

typedef struct {
  GTlsCertificate *certificate;
  CockpitWebServer *web_server;
  guint port;
  MockTransport *transport;
} TestTls;

static gboolean
handle_test (CockpitWebServer *server,
             const gchar *path,
             GHashTable *headers,
             CockpitWebResponse *response,
             gpointer user_data)
{
  const gchar *data = "Oh Marmalaade!";
  GBytes *bytes;

  bytes = g_bytes_new_static (data, strlen (data));
  cockpit_web_response_content (response, NULL, bytes, NULL);
  g_bytes_unref (bytes);
  return TRUE;
}

static void
setup_tls (TestTls *test,
           gconstpointer data)
{
  GError *error = NULL;

  test->certificate = g_tls_certificate_new_from_files (SRCDIR "/src/bridge/mock-client.crt",
                                                        SRCDIR "/src/bridge/mock-client.key", &error);
  g_assert_no_error (error);

  test->web_server = cockpit_web_server_new (0, test->certificate, NULL, NULL, &error);
  g_assert_no_error (error);

  test->port = cockpit_web_server_get_port (test->web_server);
  g_signal_connect (test->web_server, "handle-resource::/test", G_CALLBACK (handle_test), NULL);

  test->transport = mock_transport_new ();
  g_signal_connect (test->transport, "closed", G_CALLBACK (on_transport_closed), NULL);

}

static void
teardown_tls (TestTls *test,
              gconstpointer data)
{
  g_object_unref (test->certificate);
  g_object_unref (test->web_server);
  g_object_unref (test->transport);
}

static void
on_closed_set_flag (CockpitChannel *channel,
                    const gchar *problem,
                    gpointer user_data)
{
  gboolean *flag = user_data;
  g_assert (*flag == FALSE);
  *flag = TRUE;
}

static void
test_tls_client (TestTls *test,
                 gconstpointer unused)
{
  gboolean closed = FALSE;
  CockpitChannel *channel;
  JsonObject *options;
  const gchar *control;
  GBytes *bytes;
  GBytes *data;

  options = json_object_new ();
  json_object_set_int_member (options, "port", test->port);
  json_object_set_string_member (options, "payload", "http-stream1");
  json_object_set_string_member (options, "method", "GET");
  json_object_set_string_member (options, "path", "/test");
  json_object_set_object_member (options, "tls", json_object_new ());

  channel = g_object_new (COCKPIT_TYPE_HTTP_STREAM,
                          "transport", test->transport,
                          "id", "444",
                          "options", options,
                          NULL);

  json_object_unref (options);

  /* Tell HTTP we have no more data to send */
  control = "{\"command\": \"done\", \"channel\": \"444\"}";
  bytes = g_bytes_new_static (control, strlen (control));
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (test->transport), NULL, bytes);
  g_bytes_unref (bytes);

  g_signal_connect (channel, "closed", G_CALLBACK (on_closed_set_flag), &closed);

  while (closed == FALSE)
    g_main_context_iteration (NULL, TRUE);

  data = mock_transport_combine_output (test->transport, "444", NULL);
  cockpit_assert_bytes_eq (data, "{\"status\":200,\"reason\":\"OK\",\"headers\":{}}Oh Marmalaade!", -1);

  g_bytes_unref (data);

  g_object_add_weak_pointer (G_OBJECT (channel), (gpointer *)&channel);
  g_object_unref (channel);
  g_assert (channel == NULL);
}

int
main (int argc,
      char *argv[])
{
  cockpit_test_init (&argc, &argv);
  g_test_add_func  ("/http-stream/parse_keepalive", test_parse_keep_alive);
  g_test_add_func  ("/http-stream/http_chunked", test_http_chunked);

  g_test_add ("/http-stream/tls/client", TestTls, NULL,
              setup_tls, test_tls_client, teardown_tls);

  return g_test_run ();
}
