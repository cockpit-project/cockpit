
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

#include "common/cockpitjson.h"
#include "common/cockpittest.h"
#include "common/cockpitwebresponse.h"
#include "common/cockpitwebserver.h"

#include "mock-transport.h"

#include <string.h>

static void
on_closed_set_flag (CockpitChannel *channel,
                    const gchar *problem,
                    gpointer user_data)
{
  gboolean *flag = user_data;
  g_assert (flag != NULL);
  g_assert (*flag != TRUE);
  *flag = TRUE;
}

typedef struct {
  CockpitWebServer *web_server;
  guint port;
  MockTransport *transport;
  const char *host;
} TestGeneral;


static gchar *
non_local_ip (void)
{
  GInetAddress *inet;
  gchar *str = NULL;
  inet = cockpit_test_find_non_loopback_address ();
  if (inet)
    {
      str = g_inet_address_to_string (inet);
      g_object_unref (inet);
    }

  return str;
}

static void
setup_general (TestGeneral *tt,
               gconstpointer host_fixture)
{
  tt->web_server = cockpit_web_server_new (NULL, 0, NULL, NULL, NULL);
  tt->port = cockpit_web_server_get_port (tt->web_server);
  tt->transport = mock_transport_new ();
  tt->host = host_fixture;
}

static void
teardown_general (TestGeneral *tt,
                  gconstpointer unused)
{
  g_object_unref (tt->web_server);
  g_object_unref (tt->transport);

  cockpit_assert_expected ();
}

static gboolean
handle_host_header (CockpitWebServer *server,
                    const gchar *path,
                    GHashTable *headers,
                    CockpitWebResponse *response,
                    gpointer user_data)
{
  TestGeneral *tt = user_data;
  const gchar *data = "Da Da Da";
  gchar *expected;
  GBytes *bytes;

  expected = g_strdup_printf ("%s:%d", tt->host, tt->port);
  g_assert_cmpstr (g_hash_table_lookup (headers, "Host"), ==, expected);
  g_free (expected);

  bytes = g_bytes_new_static (data, strlen (data));
  cockpit_web_response_content (response, NULL, bytes, NULL);
  g_bytes_unref (bytes);

  return TRUE;
}

static void
test_host_header (TestGeneral *tt,
                  gconstpointer unused)
{
  CockpitChannel *channel;
  GBytes *bytes;
  JsonObject *options;
  const gchar *control;
  gboolean closed;
  GBytes *data;
  guint count;

  if (tt->host == NULL)
    {
      cockpit_test_skip ("Couldn't determine non local ip");
      return;
    }

  g_signal_connect (tt->web_server, "handle-resource::/", G_CALLBACK (handle_host_header), tt);

  options = json_object_new ();
  json_object_set_int_member (options, "port", tt->port);
  json_object_set_string_member (options, "payload", "http-stream1");
  json_object_set_string_member (options, "method", "GET");
  json_object_set_string_member (options, "path", "/");

  if (g_strcmp0 (tt->host, "localhost") != 0)
    json_object_set_string_member (options, "address", tt->host);

  channel = g_object_new (COCKPIT_TYPE_HTTP_STREAM,
                          "transport", tt->transport,
                          "id", "444",
                          "options", options,
                          NULL);

  json_object_unref (options);

  /* Tell HTTP we have no more data to send */
  control = "{\"command\": \"done\", \"channel\": \"444\"}";
  bytes = g_bytes_new_static (control, strlen (control));
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (tt->transport), NULL, bytes);
  g_bytes_unref (bytes);

  closed = FALSE;
  g_signal_connect (channel, "closed", G_CALLBACK (on_closed_set_flag), &closed);
  while (!closed)
    g_main_context_iteration (NULL, TRUE);

  data = mock_transport_combine_output (tt->transport, "444", &count);
  cockpit_assert_bytes_eq (data, "{\"status\":200,\"reason\":\"OK\",\"headers\":{}}Da Da Da", -1);
  g_assert_cmpuint (count, ==, 2);
  g_bytes_unref (data);
}

static gboolean
handle_default (CockpitWebServer *server,
                const gchar *path,
                GHashTable *headers,
                CockpitWebResponse *response,
                gpointer user_data)
{
  const gchar *data = "Da Da Da";
  GBytes *bytes;

  bytes = g_bytes_new_static (data, strlen (data));
  cockpit_web_response_content (response, NULL, bytes, NULL);
  g_bytes_unref (bytes);

  return TRUE;
}

static void
test_http_stream2 (TestGeneral *tt,
                   gconstpointer unused)
{
  CockpitChannel *channel;
  GBytes *bytes;
  JsonObject *options;
  const gchar *control;
  JsonObject *object;
  gboolean closed;
  GBytes *data;
  guint count;

  g_signal_connect (tt->web_server, "handle-resource::/", G_CALLBACK (handle_default), tt);

  options = json_object_new ();
  json_object_set_int_member (options, "port", tt->port);
  json_object_set_string_member (options, "payload", "http-stream2");
  json_object_set_string_member (options, "method", "GET");
  json_object_set_string_member (options, "path", "/");

  channel = g_object_new (COCKPIT_TYPE_HTTP_STREAM,
                          "transport", tt->transport,
                          "id", "444",
                          "options", options,
                          NULL);

  json_object_unref (options);

  /* Tell HTTP we have no more data to send */
  control = "{\"command\": \"done\", \"channel\": \"444\"}";
  bytes = g_bytes_new_static (control, strlen (control));
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (tt->transport), NULL, bytes);
  g_bytes_unref (bytes);

  closed = FALSE;
  g_signal_connect (channel, "closed", G_CALLBACK (on_closed_set_flag), &closed);
  while (!closed)
    g_main_context_iteration (NULL, TRUE);

  object = mock_transport_pop_control (tt->transport);
  cockpit_assert_json_eq (object, "{\"command\":\"ready\",\"channel\":\"444\"}");
  object = mock_transport_pop_control (tt->transport);
  cockpit_assert_json_eq (object, "{\"command\":\"response\",\"channel\":\"444\",\"status\":200,\"reason\":\"OK\",\"headers\":{}}");

  data = mock_transport_combine_output (tt->transport, "444", &count);
  cockpit_assert_bytes_eq (data, "Da Da Da", -1);
  g_assert_cmpuint (count, ==, 1);
  g_bytes_unref (data);
}

static void
test_cannot_connect (TestGeneral *tt,
                     gconstpointer unused)
{
  CockpitChannel *channel;
  GBytes *bytes;
  JsonObject *options;
  const gchar *control;
  JsonObject *object;
  gboolean closed;

  cockpit_expect_log ("cockpit-bridge", G_LOG_LEVEL_MESSAGE, "*couldn't connect*");

  options = json_object_new ();
  json_object_set_int_member (options, "port", 5555);
  json_object_set_string_member (options, "payload", "http-stream2");
  json_object_set_string_member (options, "method", "GET");
  json_object_set_string_member (options, "path", "/");
  json_object_set_string_member (options, "address", "0.0.0.0");

  channel = g_object_new (COCKPIT_TYPE_HTTP_STREAM,
                          "transport", tt->transport,
                          "id", "444",
                          "options", options,
                          NULL);

  json_object_unref (options);

  /* Tell HTTP we have no more data to send */
  control = "{\"command\": \"done\", \"channel\": \"444\"}";
  bytes = g_bytes_new_static (control, strlen (control));
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (tt->transport), NULL, bytes);
  g_bytes_unref (bytes);

  closed = FALSE;
  g_signal_connect (channel, "closed", G_CALLBACK (on_closed_set_flag), &closed);
  while (!closed)
    g_main_context_iteration (NULL, TRUE);

  object = mock_transport_pop_control (tt->transport);
  cockpit_assert_json_eq (object, "{\"command\":\"close\",\"channel\":\"444\",\"problem\":\"not-found\"}");
}

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

  web_server = cockpit_web_server_new (NULL, 0, NULL, NULL, NULL);
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
  gboolean keep_alive;

  headers = g_hash_table_new (g_str_hash, g_str_equal);

  version = "HTTP/1.1";
  g_hash_table_insert (headers, "Connection", "keep-alive");

  keep_alive = cockpit_http_stream_parse_keep_alive (version, headers);
  g_assert (keep_alive == TRUE);

  version = "HTTP/1.0";
  keep_alive = cockpit_http_stream_parse_keep_alive (version, headers);
  g_assert (keep_alive == TRUE);


  g_hash_table_remove (headers, "Connection");

  keep_alive = cockpit_http_stream_parse_keep_alive (version, headers);
  g_assert (keep_alive == FALSE);

  version = "HTTP/1.1";
  keep_alive = cockpit_http_stream_parse_keep_alive (version, headers);
  g_assert (keep_alive == TRUE);

  g_hash_table_destroy (headers);
}

typedef struct {
  GTlsCertificate *certificate;
  CockpitWebServer *web_server;
  guint port;
  MockTransport *transport;
  GTlsCertificate *peer;
} TestTls;

static gboolean
handle_test (CockpitWebServer *server,
             const gchar *path,
             GHashTable *headers,
             CockpitWebResponse *response,
             gpointer user_data)
{
  const gchar *data = "Oh Marmalaade!";
  GTlsConnection *connection;
  TestTls *test = user_data;
  GBytes *bytes;

  bytes = g_bytes_new_static (data, strlen (data));
  cockpit_web_response_content (response, NULL, bytes, NULL);
  g_bytes_unref (bytes);

  connection = G_TLS_CONNECTION (cockpit_web_response_get_stream (response));

  g_clear_object (&test->peer);
  test->peer = g_tls_connection_get_peer_certificate (connection);
  if (test->peer)
    g_object_ref (test->peer);

  return TRUE;
}

static void
setup_tls (TestTls *test,
           gconstpointer data)
{
  GError *error = NULL;

  test->certificate = g_tls_certificate_new_from_files (SRCDIR "/src/bridge/mock-server.crt",
                                                        SRCDIR "/src/bridge/mock-server.key", &error);
  g_assert_no_error (error);

  test->web_server = cockpit_web_server_new (NULL, 0, test->certificate, NULL, &error);
  g_assert_no_error (error);

  test->port = cockpit_web_server_get_port (test->web_server);
  g_signal_connect (test->web_server, "handle-resource::/test", G_CALLBACK (handle_test), test);

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
  g_clear_object (&test->peer);
}

static void
test_tls_basic (TestTls *test,
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

static const gchar fixture_tls_certificate_data[] =
"{ \"certificate\": { \"data\": "
"\"-----BEGIN CERTIFICATE-----\n"
"MIICxzCCAa+gAwIBAgIJANDrBNw3XYJ0MA0GCSqGSIb3DQEBCwUAMBQxEjAQBgNV\n"
"BAMMCWxvY2FsaG9zdDAgFw0xNTAzMjUxMDMzMzRaGA8yMTE1MDMwMTEwMzMzNFow\n"
"FDESMBAGA1UEAwwJbG9jYWxob3N0MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIB\n"
"CgKCAQEA8l1q01B5N/biaFDazUtuPuOrFsLOC67LX1iiE62guchEf9FyEagglGzt\n"
"XOSCpY/qX0HWmIkE3Pqotb8lPQ0mUHleYCvzY85cFmj4mu+rDIPxK/lw37Xu00iP\n"
"/rbcCA6K6dgMjp0TJzZvMnU2PywtFqDpw6ZchcMi517keMfLwscUC/7Y80lP0PGA\n"
"1wTDaYoxuMlUhqTTfdLoBZ73eA9YzgqBeZ9ePxoUFk9AtJtlOlR60mGbEOweDUfc\n"
"l1biKtarDW5SJYbVTFjWdPsCV6czZndfVKAAkDd+bsbFMcEiq/doHU092Yy3sZ9g\n"
"hnOBw5sCq8iTXQ9cmejxUrsu/SvL3QIDAQABoxowGDAJBgNVHRMEAjAAMAsGA1Ud\n"
"DwQEAwIF4DANBgkqhkiG9w0BAQsFAAOCAQEAalykXV+z1tQOv1ZRvJmppjEIYTa3\n"
"pFehy97BiNGERTQJQDSzOgptIaCJb1vE34KNL349QEO4F8XTPWhwsCAXNTBN4yhm\n"
"NJ6qbYkz0HbBmdM4k0MgbB9VG00Hy+TmwEt0zVryICZY4IomKmS1No0Lai5hOqdz\n"
"afUMVIIYjVB1WYIsIaXXug7Mik/O+6K5hIbqm9HkwRwfoVaOLNG9EPUM14vFnN5p\n"
"EyHSBByk0mOU8EUK/qsAnbTwABEKsMxCopmvPTguGHTwllEvxPgt5BcYMU9oXlvc\n"
"cSvnU4a6M2qxQn3LUqxENh9QaQ8vV4l/avZBi1cFKVs1rza36eOGxrJxQw==\n"
"-----END CERTIFICATE-----\""
"}, \"key\": { \"data\": "
"\"-----BEGIN PRIVATE KEY-----\n"
"MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDyXWrTUHk39uJo\n"
"UNrNS24+46sWws4LrstfWKITraC5yER/0XIRqCCUbO1c5IKlj+pfQdaYiQTc+qi1\n"
"vyU9DSZQeV5gK/NjzlwWaPia76sMg/Er+XDfte7TSI/+ttwIDorp2AyOnRMnNm8y\n"
"dTY/LC0WoOnDplyFwyLnXuR4x8vCxxQL/tjzSU/Q8YDXBMNpijG4yVSGpNN90ugF\n"
"nvd4D1jOCoF5n14/GhQWT0C0m2U6VHrSYZsQ7B4NR9yXVuIq1qsNblIlhtVMWNZ0\n"
"+wJXpzNmd19UoACQN35uxsUxwSKr92gdTT3ZjLexn2CGc4HDmwKryJNdD1yZ6PFS\n"
"uy79K8vdAgMBAAECggEAILEJH8fTEgFzOK7vVJHAJSuAgGl2cYz6Uboa4pyg+W5S\n"
"DwupX0hWXK70tXr9RGfNLVwsHhcdWNFWwG0wELQdXu2AFWjYQ7YqJbuzDPMXF3EU\n"
"ruHOn95igI1hHvJ7a3rKshA6YWI+myN0jFHTJ2JGEq9R2Nov0LspkhvypXgNvA/r\n"
"JfFZ9IsPJZDWCnGXkPLlW2X1XEXw2BPs8ib+ZkbzGNiLsy/i4M/oA+g6lz4LU/ll\n"
"J6cLhwPrBu02+PJt7MaYaNk5zqhyJs0AMjeBlNnXFIWAlTrIe/h8z/gL8ABrYWAA\n"
"1kgZ11GO8bNAEfLOIUrA1/vq9aK00WDwFLXWJdVE4QKBgQD+R/J+AbYSImeoAj/3\n"
"hfsFkaUNLyw1ZEO4LG2id0dnve1paL6Y/uXKKqxq0jiyMLT243Vi+1fzth7RNXOl\n"
"ui0nnVWO7x68FsYcdIM7w+tryh2Y+UhCfwNCakM0GTohcXqFUEzHcwuOv8hAfRQ5\n"
"jPBCwJdUHpIimVOo5/WRbQGW+wKBgQD0ANkof+jagdNqOkCvFnTPiFlPYrpDzeU5\n"
"ZxhLlVxnr6G2MPoUO0IqTWVA7uCn29i0yUUXAtRHrkNI1EtKXRIUe2bChVegTBHx\n"
"26PqXEOonSUJdpUzyzXVX2vSqICm0tTbqyZ0GbjP4y5qQOQHdTGFsHDfSTa5//P+\n"
"0BLpci4RBwKBgQDBR8DrxLM3b41o6GTk6aNXpVBXCC9LWi4bVTH0l0PgeD54rBSM\n"
"SNwz4mHyRF6yG1HChDybAz/kUN912HJSW4StIuuA3QN4prrpsCp8iDxvT09WEs25\n"
"NcAtgIYamL5V42Lk6Jej1y/GzsIROsHfyOBrbObaGu6re+5aag5//uKBdwKBgQDp\n"
"i4ZPBV7TBkBdBLS04UGdAly5Zz3xeDlW4B6Y+bUgaTLXN7mlc7K42qt3oyzUfdDF\n"
"+X9vrv2QPnOYWdpWqw6LHDIXLZnZi/YBEMGrp/P6h67Th/T3RiGYwWRqlW3OPy4N\n"
"s5tytMv37vKWMNYRbVKhK2hdz63aCep4kqAHYYpGMQKBgF83LTyRFwGFos/wDrgY\n"
"eieLiipmdXGvlrBq6SBzKglIYwNRSGiWkXAuHRzD/2S546ioQKZr7AKuijKGdLMz\n"
"ABVl/bqqqRXSDbvf+XEdU2rJpxhYWxlsJZMFBFIwuxR2jRqmCgbCvoZQcbIr1ZLr\n"
"02eC2pQ5eio2+CKqBfqxbnwk\n"
"-----END PRIVATE KEY-----\""
" } }";

static const gchar fixture_tls_certificate_file[] =
"{ \"certificate\": { \"file\": \"" SRCDIR "/src/bridge/mock-client.crt\" },"
"\"key\": { \"file\": \"" SRCDIR "/src/bridge/mock-client.key\" } }";

static const gchar fixture_tls_certificate_data_file[] =
"{ \"certificate\": { \"data\": "
"\"-----BEGIN CERTIFICATE-----\n"
"MIICxzCCAa+gAwIBAgIJANDrBNw3XYJ0MA0GCSqGSIb3DQEBCwUAMBQxEjAQBgNV\n"
"BAMMCWxvY2FsaG9zdDAgFw0xNTAzMjUxMDMzMzRaGA8yMTE1MDMwMTEwMzMzNFow\n"
"FDESMBAGA1UEAwwJbG9jYWxob3N0MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIB\n"
"CgKCAQEA8l1q01B5N/biaFDazUtuPuOrFsLOC67LX1iiE62guchEf9FyEagglGzt\n"
"XOSCpY/qX0HWmIkE3Pqotb8lPQ0mUHleYCvzY85cFmj4mu+rDIPxK/lw37Xu00iP\n"
"/rbcCA6K6dgMjp0TJzZvMnU2PywtFqDpw6ZchcMi517keMfLwscUC/7Y80lP0PGA\n"
"1wTDaYoxuMlUhqTTfdLoBZ73eA9YzgqBeZ9ePxoUFk9AtJtlOlR60mGbEOweDUfc\n"
"l1biKtarDW5SJYbVTFjWdPsCV6czZndfVKAAkDd+bsbFMcEiq/doHU092Yy3sZ9g\n"
"hnOBw5sCq8iTXQ9cmejxUrsu/SvL3QIDAQABoxowGDAJBgNVHRMEAjAAMAsGA1Ud\n"
"DwQEAwIF4DANBgkqhkiG9w0BAQsFAAOCAQEAalykXV+z1tQOv1ZRvJmppjEIYTa3\n"
"pFehy97BiNGERTQJQDSzOgptIaCJb1vE34KNL349QEO4F8XTPWhwsCAXNTBN4yhm\n"
"NJ6qbYkz0HbBmdM4k0MgbB9VG00Hy+TmwEt0zVryICZY4IomKmS1No0Lai5hOqdz\n"
"afUMVIIYjVB1WYIsIaXXug7Mik/O+6K5hIbqm9HkwRwfoVaOLNG9EPUM14vFnN5p\n"
"EyHSBByk0mOU8EUK/qsAnbTwABEKsMxCopmvPTguGHTwllEvxPgt5BcYMU9oXlvc\n"
"cSvnU4a6M2qxQn3LUqxENh9QaQ8vV4l/avZBi1cFKVs1rza36eOGxrJxQw==\n"
"-----END CERTIFICATE-----\""
"}, \"key\": { \"file\": \"" SRCDIR "/src/bridge/mock-client.key\""
"} }";

static const gchar fixture_tls_certificate_file_data[] =
"{ \"certificate\": { \"file\": \"" SRCDIR "/src/bridge/mock-client.crt\""
"}, \"key\": { \"data\": "
"\"-----BEGIN PRIVATE KEY-----\n"
"MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDyXWrTUHk39uJo\n"
"UNrNS24+46sWws4LrstfWKITraC5yER/0XIRqCCUbO1c5IKlj+pfQdaYiQTc+qi1\n"
"vyU9DSZQeV5gK/NjzlwWaPia76sMg/Er+XDfte7TSI/+ttwIDorp2AyOnRMnNm8y\n"
"dTY/LC0WoOnDplyFwyLnXuR4x8vCxxQL/tjzSU/Q8YDXBMNpijG4yVSGpNN90ugF\n"
"nvd4D1jOCoF5n14/GhQWT0C0m2U6VHrSYZsQ7B4NR9yXVuIq1qsNblIlhtVMWNZ0\n"
"+wJXpzNmd19UoACQN35uxsUxwSKr92gdTT3ZjLexn2CGc4HDmwKryJNdD1yZ6PFS\n"
"uy79K8vdAgMBAAECggEAILEJH8fTEgFzOK7vVJHAJSuAgGl2cYz6Uboa4pyg+W5S\n"
"DwupX0hWXK70tXr9RGfNLVwsHhcdWNFWwG0wELQdXu2AFWjYQ7YqJbuzDPMXF3EU\n"
"ruHOn95igI1hHvJ7a3rKshA6YWI+myN0jFHTJ2JGEq9R2Nov0LspkhvypXgNvA/r\n"
"JfFZ9IsPJZDWCnGXkPLlW2X1XEXw2BPs8ib+ZkbzGNiLsy/i4M/oA+g6lz4LU/ll\n"
"J6cLhwPrBu02+PJt7MaYaNk5zqhyJs0AMjeBlNnXFIWAlTrIe/h8z/gL8ABrYWAA\n"
"1kgZ11GO8bNAEfLOIUrA1/vq9aK00WDwFLXWJdVE4QKBgQD+R/J+AbYSImeoAj/3\n"
"hfsFkaUNLyw1ZEO4LG2id0dnve1paL6Y/uXKKqxq0jiyMLT243Vi+1fzth7RNXOl\n"
"ui0nnVWO7x68FsYcdIM7w+tryh2Y+UhCfwNCakM0GTohcXqFUEzHcwuOv8hAfRQ5\n"
"jPBCwJdUHpIimVOo5/WRbQGW+wKBgQD0ANkof+jagdNqOkCvFnTPiFlPYrpDzeU5\n"
"ZxhLlVxnr6G2MPoUO0IqTWVA7uCn29i0yUUXAtRHrkNI1EtKXRIUe2bChVegTBHx\n"
"26PqXEOonSUJdpUzyzXVX2vSqICm0tTbqyZ0GbjP4y5qQOQHdTGFsHDfSTa5//P+\n"
"0BLpci4RBwKBgQDBR8DrxLM3b41o6GTk6aNXpVBXCC9LWi4bVTH0l0PgeD54rBSM\n"
"SNwz4mHyRF6yG1HChDybAz/kUN912HJSW4StIuuA3QN4prrpsCp8iDxvT09WEs25\n"
"NcAtgIYamL5V42Lk6Jej1y/GzsIROsHfyOBrbObaGu6re+5aag5//uKBdwKBgQDp\n"
"i4ZPBV7TBkBdBLS04UGdAly5Zz3xeDlW4B6Y+bUgaTLXN7mlc7K42qt3oyzUfdDF\n"
"+X9vrv2QPnOYWdpWqw6LHDIXLZnZi/YBEMGrp/P6h67Th/T3RiGYwWRqlW3OPy4N\n"
"s5tytMv37vKWMNYRbVKhK2hdz63aCep4kqAHYYpGMQKBgF83LTyRFwGFos/wDrgY\n"
"eieLiipmdXGvlrBq6SBzKglIYwNRSGiWkXAuHRzD/2S546ioQKZr7AKuijKGdLMz\n"
"ABVl/bqqqRXSDbvf+XEdU2rJpxhYWxlsJZMFBFIwuxR2jRqmCgbCvoZQcbIr1ZLr\n"
"02eC2pQ5eio2+CKqBfqxbnwk\n"
"-----END PRIVATE KEY-----\""
" } }";

static void
test_tls_certificate (TestTls *test,
                      gconstpointer json)
{
  gboolean closed = FALSE;
  CockpitChannel *channel;
  JsonObject *options;
  JsonObject *tls;
  GError *error = NULL;
  GTlsCertificate *cert;
  const gchar *control;
  GBytes *bytes;
  GBytes *data;

  tls = cockpit_json_parse_object (json, -1, &error);
  g_assert_no_error (error);

  options = json_object_new ();
  json_object_set_int_member (options, "port", test->port);
  json_object_set_string_member (options, "payload", "http-stream1");
  json_object_set_string_member (options, "method", "GET");
  json_object_set_string_member (options, "path", "/test");
  json_object_set_object_member (options, "tls", tls);

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

  g_assert (test->peer != NULL);

  /* Should have used our expected certificate */
  cert = g_tls_certificate_new_from_files (SRCDIR "/src/bridge/mock-client.crt",
                                           SRCDIR "/src/bridge/mock-client.key", &error);
  g_assert_no_error (error);

  g_assert (g_tls_certificate_is_same (test->peer, cert));
  g_object_unref (cert);

  g_object_add_weak_pointer (G_OBJECT (channel), (gpointer *)&channel);
  g_object_unref (channel);
  g_assert (channel == NULL);
}

static const gchar fixture_tls_authority_good[] =
  "{ \"authority\": { \"file\": \"" SRCDIR "/src/bridge/mock-server.crt\" } }";

static void
test_tls_authority_good (TestTls *test,
                         gconstpointer json)
{
  gboolean closed = FALSE;
  CockpitChannel *channel;
  JsonObject *options;
  JsonObject *tls;
  GError *error = NULL;
  const gchar *control;
  GBytes *bytes;
  GBytes *data;

  tls = cockpit_json_parse_object (json, -1, &error);
  g_assert_no_error (error);

  options = json_object_new ();
  json_object_set_int_member (options, "port", test->port);
  json_object_set_string_member (options, "payload", "http-stream1");
  json_object_set_string_member (options, "method", "GET");
  json_object_set_string_member (options, "path", "/test");
  json_object_set_object_member (options, "tls", tls);

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

static const gchar fixture_tls_authority_bad[] =
  "{ \"authority\": { \"file\": \"" SRCDIR "/src/bridge/mock-client.crt\" } }";

static void
test_tls_authority_bad (TestTls *test,
                         gconstpointer json)
{
  CockpitChannel *channel;
  JsonObject *options;
  JsonObject *tls;
  GError *error = NULL;
  const gchar *control;
  GBytes *bytes;
  JsonObject *resp;
  gchar *expected_pem = NULL;
  gchar *expected_json = NULL;
  const gchar *expected_fmt;

  g_object_get (test->certificate, "certificate-pem", &expected_pem, NULL);
  g_assert_true (expected_pem != NULL);

  tls = cockpit_json_parse_object (json, -1, &error);
  g_assert_no_error (error);

  options = json_object_new ();
  json_object_set_int_member (options, "port", test->port);
  json_object_set_string_member (options, "payload", "http-stream1");
  json_object_set_string_member (options, "method", "GET");
  json_object_set_string_member (options, "path", "/test");
  json_object_set_object_member (options, "tls", tls);

  channel = g_object_new (COCKPIT_TYPE_HTTP_STREAM,
                          "transport", test->transport,
                          "id", "444",
                          "options", options,
                          NULL);

  cockpit_expect_log ("cockpit-bridge", G_LOG_LEVEL_MESSAGE,
                      "*Unacceptable TLS certificate:*untrusted-issuer*");
  cockpit_expect_log ("cockpit-bridge", G_LOG_LEVEL_MESSAGE,
                      "*Unacceptable TLS certificate");

  json_object_unref (options);

  /* Tell HTTP we have no more data to send */
  control = "{\"command\": \"done\", \"channel\": \"444\"}";
  bytes = g_bytes_new_static (control, strlen (control));
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (test->transport), NULL, bytes);
  g_bytes_unref (bytes);

  while (mock_transport_count_sent (test->transport) < 2)
    g_main_context_iteration (NULL, TRUE);

  resp = mock_transport_pop_control (test->transport);
  cockpit_assert_json_eq (resp, "{\"command\":\"ready\",\"channel\":\"444\"}");

  resp = mock_transport_pop_control (test->transport);
  expected_fmt = "{\"command\":\"close\",\"channel\":\"444\",\"problem\":\"unknown-hostkey\", \"rejected-certificate\":\"%s\"}";
  expected_json = g_strdup_printf (expected_fmt, expected_pem);
  cockpit_assert_json_eq (resp, expected_json);

  g_object_add_weak_pointer (G_OBJECT (channel), (gpointer *)&channel);
  g_object_unref (channel);
  g_assert (channel == NULL);
  g_free (expected_pem);
  g_free (expected_json);
}

/* Declared in cockpitwebserver.c */
extern gboolean cockpit_webserver_want_certificate;

int
main (int argc,
      char *argv[])
{
  char *ip = non_local_ip ();
  int result;

  cockpit_webserver_want_certificate = TRUE;

  cockpit_test_init (&argc, &argv);

  g_test_add ("/http-stream/host-header", TestGeneral, "localhost",
              setup_general, test_host_header, teardown_general);
  g_test_add ("/http-stream/address-host-header", TestGeneral, ip,
              setup_general, test_host_header, teardown_general);

  g_test_add ("/http-stream/http-stream2", TestGeneral, NULL,
              setup_general, test_http_stream2, teardown_general);
  g_test_add ("/http-stream/cannot-connect", TestGeneral, NULL,
              setup_general, test_cannot_connect, teardown_general);

  g_test_add_func  ("/http-stream/parse_keepalive", test_parse_keep_alive);
  g_test_add_func  ("/http-stream/http_chunked", test_http_chunked);

  g_test_add ("/http-stream/tls/basic", TestTls, NULL,
              setup_tls, test_tls_basic, teardown_tls);
  g_test_add ("/http-stream/tls/certificate-data", TestTls, fixture_tls_certificate_data,
              setup_tls, test_tls_certificate, teardown_tls);
  g_test_add ("/http-stream/tls/certificate-file", TestTls, fixture_tls_certificate_file,
              setup_tls, test_tls_certificate, teardown_tls);
  g_test_add ("/http-stream/tls/certificate-data-file", TestTls, fixture_tls_certificate_data_file,
              setup_tls, test_tls_certificate, teardown_tls);
  g_test_add ("/http-stream/tls/certificate-file-data", TestTls, fixture_tls_certificate_file_data,
              setup_tls, test_tls_certificate, teardown_tls);
  g_test_add ("/http-stream/tls/authority-good", TestTls, fixture_tls_authority_good,
              setup_tls, test_tls_authority_good, teardown_tls);
  g_test_add ("/http-stream/tls/authority-bad", TestTls, fixture_tls_authority_bad,
              setup_tls, test_tls_authority_bad, teardown_tls);

  result = g_test_run ();
  g_free (ip);
  return result;
}
