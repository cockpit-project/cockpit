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

#include "cockpitwebserver.h"
#include "cockpitwebresponse.h"

#include "common/cockpittest.h"

#include "websocket/websocket.h"
#include "websocket/websocketprivate.h"

#include <string.h>

typedef struct {
    CockpitWebServer *web_server;
    gchar *localport;
    gchar *hostport;
} TestCase;

typedef struct {
    const gchar *cert_file;
    gboolean local_only;
    gboolean inet_only;
} TestFixture;

static void
setup (TestCase *tc,
       gconstpointer data)
{
  const TestFixture *fixture = data;
  GTlsCertificate *cert = NULL;
  GError *error = NULL;
  GInetAddress *inet;
  gchar *str;
  const gchar *address;
  gint port;

  inet = cockpit_test_find_non_loopback_address ();
  g_assert (inet != NULL);

  str = g_inet_address_to_string (inet);

  if (fixture && fixture->cert_file)
    {
      cert = g_tls_certificate_new_from_file (fixture->cert_file, &error);
      g_assert_no_error (error);
    }

  if (fixture && fixture->local_only)
    address = "127.0.0.1";
  else if (fixture && fixture->inet_only)
    address = str;
  else
    address = NULL;

  tc->web_server = cockpit_web_server_new (address, 0, cert, NULL, &error);
  g_assert_no_error (error);
  g_clear_object (&cert);

  /* Automatically chosen by the web server */
  g_object_get (tc->web_server, "port", &port, NULL);
  tc->localport = g_strdup_printf ("localhost:%d", port);
  tc->hostport = g_strdup_printf ("%s:%d", str, port);
  g_object_unref (inet);
  g_free (str);
}

static void
teardown (TestCase *tc,
          gconstpointer data)
{
  cockpit_assert_expected ();

  /* Verifies that we're not leaking the web server */
  g_object_add_weak_pointer (G_OBJECT (tc->web_server), (gpointer *)&tc->web_server);
  g_object_unref (tc->web_server);
  g_assert (tc->web_server == NULL);

  g_free (tc->localport);
  g_free (tc->hostport);
}

static void
test_table (void)
{
  GHashTable *table;

  table = cockpit_web_server_new_table ();

  /* Case insensitive keys */
  g_hash_table_insert (table, g_strdup ("Blah"), g_strdup ("value"));
  g_hash_table_insert (table, g_strdup ("blah"), g_strdup ("another"));
  g_hash_table_insert (table, g_strdup ("Different"), g_strdup ("One"));

  g_assert_cmpstr (g_hash_table_lookup (table, "BLAH"), ==, "another");
  g_assert_cmpstr (g_hash_table_lookup (table, "differeNT"), ==, "One");

  g_hash_table_destroy (table);
}

static void
test_cookie_simple (void)
{
  GHashTable *table = cockpit_web_server_new_table ();
  gchar *result;

  g_hash_table_insert (table, g_strdup ("Cookie"), g_strdup ("cookie1=value"));

  result = cockpit_web_server_parse_cookie (table, "cookie1");
  g_assert_cmpstr (result, ==, "value");

  g_free (result);
  g_hash_table_unref (table);
}

static void
test_cookie_multiple (void)
{
  GHashTable *table = cockpit_web_server_new_table ();
  gchar *result;

  g_hash_table_insert (table, g_strdup ("Cookie"), g_strdup ("cookie1=value;cookie2=value2; cookie23=value3"));

  result = cockpit_web_server_parse_cookie (table, "cookie1");
  g_assert_cmpstr (result, ==, "value");
  g_free (result);

  result = cockpit_web_server_parse_cookie (table, "cookie2");
  g_assert_cmpstr (result, ==, "value2");
  g_free (result);

  result = cockpit_web_server_parse_cookie (table, "cookie23");
  g_assert_cmpstr (result, ==, "value3");
  g_free (result);

  g_hash_table_unref (table);
}

static void
test_cookie_overlap (void)
{
  GHashTable *table = cockpit_web_server_new_table ();
  gchar *result;

  g_hash_table_insert (table, g_strdup ("Cookie"), g_strdup ("cookie1cookie1cookie1=value;cookie1=cookie23-value2;   cookie2=a value for cookie23=inline; cookie23=value3"));

  result = cockpit_web_server_parse_cookie (table, "cookie1cookie1cookie1");
  g_assert_cmpstr (result, ==, "value");
  g_free (result);

  result = cockpit_web_server_parse_cookie (table, "cookie1");
  g_assert_cmpstr (result, ==, "cookie23-value2");
  g_free (result);

  result = cockpit_web_server_parse_cookie (table, "cookie2");
  g_assert_cmpstr (result, ==, "a value for cookie23=inline");
  g_free (result);

  result = cockpit_web_server_parse_cookie (table, "cookie23");
  g_assert_cmpstr (result, ==, "value3");
  g_free (result);

  g_hash_table_unref (table);
}

static void
test_cookie_no_header (void)
{
  GHashTable *table = cockpit_web_server_new_table ();
  gchar *result;

  result = cockpit_web_server_parse_cookie (table, "cookie2");
  g_assert_cmpstr (result, ==, NULL);

  g_hash_table_unref (table);
}

static void
test_cookie_substring (void)
{
  GHashTable *table = cockpit_web_server_new_table ();
  gchar *result;

  g_hash_table_insert (table, g_strdup ("Cookie"), g_strdup ("cookie1=value; cookie2=value2; cookie23=value3"));

  result = cockpit_web_server_parse_cookie (table, "okie2");
  g_assert_cmpstr (result, ==, NULL);

  result = cockpit_web_server_parse_cookie (table, "cookie");
  g_assert_cmpstr (result, ==, NULL);

  result = cockpit_web_server_parse_cookie (table, "ook");
  g_assert_cmpstr (result, ==, NULL);

  g_hash_table_unref (table);
}

static void
test_cookie_decode (void)
{
  GHashTable *table = cockpit_web_server_new_table ();
  gchar *result;

  g_hash_table_insert (table, g_strdup ("Cookie"), g_strdup ("cookie1=val%20ue"));

  result = cockpit_web_server_parse_cookie (table, "cookie1");
  g_assert_cmpstr (result, ==, "val ue");
  g_free (result);

  g_hash_table_unref (table);
}

static void
test_cookie_decode_bad (void)
{
  GHashTable *table = cockpit_web_server_new_table ();
  gchar *result;

  g_hash_table_insert (table, g_strdup ("Cookie"), g_strdup ("cookie1=val%"));

  result = cockpit_web_server_parse_cookie (table, "cookie1");
  g_assert_cmpstr (result, ==, NULL);

  g_hash_table_unref (table);
}

static void
test_languages_simple (void)
{
  GHashTable *table = cockpit_web_server_new_table ();
  gchar **result;
  gchar *string;

  g_hash_table_insert (table, g_strdup ("Accept-Language"), g_strdup ("en-us,en, de"));

  result = cockpit_web_server_parse_languages (table, NULL);
  g_assert (result != NULL);

  string = g_strjoinv (", ", result);
  g_assert_cmpstr (string, ==, "en-us, en, de, en");

  g_free (string);
  g_strfreev (result);
  g_hash_table_unref (table);
}

static void
test_languages_cookie (void)
{
  GHashTable *table = cockpit_web_server_new_table ();
  gchar **result;
  gchar *string;

  g_hash_table_insert (table, g_strdup ("Accept-Language"), g_strdup ("en-us,en, de"));

  result = cockpit_web_server_parse_languages (table, "pig");
  g_assert (result != NULL);

  string = g_strjoinv (", ", result);
  g_assert_cmpstr (string, ==, "en-us, en, de, pig, en");

  g_free (string);
  g_strfreev (result);
  g_hash_table_unref (table);
}

static void
test_languages_no_header (void)
{
  GHashTable *table = cockpit_web_server_new_table ();
  gchar **result;

  result = cockpit_web_server_parse_languages (table, NULL);
  g_assert (result != NULL);
  g_assert (result[0] == NULL);

  g_strfreev (result);
  g_hash_table_unref (table);
}

static void
test_languages_order (void)
{
  GHashTable *table = cockpit_web_server_new_table ();
  gchar **result;
  gchar *string;

  g_hash_table_insert (table, g_strdup ("Accept-Language"), g_strdup ("de;q=xx, en-us;q=0.1,en;q=1,in;q=5"));

  result = cockpit_web_server_parse_languages (table, NULL);
  g_assert (result != NULL);

  string = g_strjoinv (", ", result);
  g_assert_cmpstr (string, ==, "in, en, en-us, en");

  g_free (string);
  g_strfreev (result);
  g_hash_table_unref (table);
}

static void
test_encoding_simple (void)
{
  GHashTable *table = cockpit_web_server_new_table ();
  gboolean result;

  g_hash_table_insert (table, g_strdup ("Accept-Encoding"), g_strdup ("booyah, test"));

  result = cockpit_web_server_parse_encoding (table, "test");
  g_assert (result == TRUE);

  result = cockpit_web_server_parse_encoding (table, "booyah");
  g_assert (result == TRUE);

  result = cockpit_web_server_parse_encoding (table, "notpresent");
  g_assert (result == FALSE);

  g_hash_table_unref (table);
}

static void
test_encoding_no_header (void)
{
  GHashTable *table = cockpit_web_server_new_table ();
  gboolean result;

  result = cockpit_web_server_parse_encoding (table, "test");
  g_assert (result == TRUE);

  result = cockpit_web_server_parse_encoding (table, "notpresent");
  g_assert (result == TRUE);

  g_hash_table_unref (table);
}

static void
test_encoding_zero_qvalue (void)
{
  GHashTable *table = cockpit_web_server_new_table ();
  gboolean result;

  g_hash_table_insert (table, g_strdup ("Accept-Encoding"), g_strdup ("booyah;q=0, test"));

  result = cockpit_web_server_parse_encoding (table, "test");
  g_assert (result == TRUE);

  result = cockpit_web_server_parse_encoding (table, "notpresent");
  g_assert (result == FALSE);

  g_hash_table_unref (table);
}

static void
on_ready_get_result (GObject *source,
                     GAsyncResult *result,
                     gpointer user_data)
{
  GAsyncResult **retval = user_data;
  g_assert (retval && *retval == NULL);
  *retval = g_object_ref (result);
}

static gchar *
perform_http_request (const gchar *hostport,
                      const gchar *request,
                      gsize *length)
{
  GSocketClient *client;
  GSocketConnection *conn;
  GAsyncResult *result;
  GInputStream *input;
  GError *error = NULL;
  GString *reply;
  gsize len;
  gssize ret;

  client = g_socket_client_new ();

  result = NULL;
  g_socket_client_connect_to_host_async (client, hostport, 1, NULL, on_ready_get_result, &result);
  while (result == NULL)
    g_main_context_iteration (NULL, TRUE);
  conn = g_socket_client_connect_to_host_finish (client, result, &error);
  g_object_unref (result);
  g_assert_no_error (error);

  g_output_stream_write_all (g_io_stream_get_output_stream (G_IO_STREAM (conn)),
                             request, strlen (request), NULL, NULL, &error);
  g_assert_no_error (error);

  g_socket_shutdown (g_socket_connection_get_socket (conn), FALSE, TRUE, &error);
  g_assert_no_error (error);

  reply = g_string_new ("");
  input = g_io_stream_get_input_stream (G_IO_STREAM (conn));
  for (;;)
    {
      result = NULL;
      len = reply->len;
      g_string_set_size (reply, len + 1024);
      g_input_stream_read_async (input, reply->str + len, 1024, G_PRIORITY_DEFAULT,
                                 NULL, on_ready_get_result, &result);
      while (result == NULL)
        g_main_context_iteration (NULL, TRUE);
      ret = g_input_stream_read_finish (input, result, &error);
      g_object_unref (result);
      g_assert_no_error (error);
      g_assert (ret >= 0);
      g_string_set_size (reply, len + ret);
      if (ret == 0)
        break;
    }

  g_object_unref (conn);
  g_object_unref (client);

  if (length)
    *length = reply->len;
  return g_string_free (reply, FALSE);
}

static gboolean
on_shell_index_html (CockpitWebServer *server,
                     const gchar *path,
                     GHashTable *headers,
                     CockpitWebResponse *response,
                     gpointer user_data)
{
  GBytes *bytes;
  const gchar *data;

  g_assert_cmpstr (path, ==, "/shell/index.html");
  data = "<!DOCTYPE html><html><body>index.html</body></html>";
  bytes = g_bytes_new_static (data, strlen (data));

  cockpit_web_response_content (response, NULL, bytes, NULL);
  g_bytes_unref (bytes);
  return TRUE;
}

static void
test_with_query_string (TestCase *tc,
                        gconstpointer user_data)
{
  gchar *resp;
  gsize length;

  g_signal_connect (tc->web_server, "handle-resource", G_CALLBACK (on_shell_index_html), NULL);
  resp = perform_http_request (tc->localport, "GET /shell/index.html?blah HTTP/1.0\r\nHost:test\r\n\r\n", &length);
  g_assert (resp != NULL);
  g_assert_cmpuint (length, >, 0);

  cockpit_assert_strmatch (resp, "HTTP/* 200 *\r\nContent-Length: *\r\n\r\n<!DOCTYPE html>*");
  g_free (resp);
}

static void
test_webserver_not_found (TestCase *tc,
                          gconstpointer user_data)
{
  gchar *resp;
  gsize length;
  guint status;
  gssize off;

  resp = perform_http_request (tc->localport, "GET /non-existent HTTP/1.0\r\nHost:test\r\n\r\n", &length);
  g_assert (resp != NULL);
  g_assert_cmpuint (length, >, 0);

  off = web_socket_util_parse_status_line (resp, length, NULL, &status, NULL);
  g_assert_cmpuint (off, >, 0);
  g_assert_cmpint (status, ==, 404);

  g_free (resp);
}

static const TestFixture fixture_with_cert = {
    .cert_file = SRCDIR "/src/ws/mock_cert"
};

static void
test_webserver_redirect_notls (TestCase *tc,
                               gconstpointer data)
{
  gchar *resp;

  g_signal_connect (tc->web_server, "handle-resource", G_CALLBACK (on_shell_index_html), NULL);
  resp = perform_http_request (tc->hostport, "GET /shell/index.html HTTP/1.0\r\nHost:test\r\n\r\n", NULL);
  cockpit_assert_strmatch (resp, "HTTP/* 301 *\r\nLocation: https://*");
  g_free (resp);
}

static void
test_webserver_noredirect_localhost (TestCase *tc,
                                     gconstpointer data)
{
  gchar *resp;

  g_signal_connect (tc->web_server, "handle-resource", G_CALLBACK (on_shell_index_html), NULL);
  resp = perform_http_request (tc->localport, "GET /shell/index.html HTTP/1.0\r\nHost:test\r\n\r\n", NULL);
  cockpit_assert_strmatch (resp, "HTTP/* 200 *\r\n*");
  g_free (resp);
}

static void
test_webserver_noredirect_exception (TestCase *tc,
                                     gconstpointer data)
{
  gchar *resp;

  g_object_set (tc->web_server, "ssl-exception-prefix", "/shell", NULL);
  g_signal_connect (tc->web_server, "handle-resource", G_CALLBACK (on_shell_index_html), NULL);
  resp = perform_http_request (tc->hostport, "GET /shell/index.html HTTP/1.0\r\nHost:test\r\n\r\n", NULL);
  cockpit_assert_strmatch (resp, "HTTP/* 200 *\r\n*");
  g_free (resp);
}

static void
test_webserver_noredirect_override (TestCase *tc,
                                    gconstpointer data)
{
  gchar *resp;

  cockpit_web_server_set_redirect_tls (tc->web_server, FALSE);
  g_signal_connect (tc->web_server, "handle-resource", G_CALLBACK (on_shell_index_html), NULL);
  resp = perform_http_request (tc->hostport, "GET /shell/index.html HTTP/1.0\r\nHost:test\r\n\r\n", NULL);
  cockpit_assert_strmatch (resp, "HTTP/* 200 *\r\n*");
  g_free (resp);
}

static gboolean
on_oh_resource (CockpitWebServer *server,
                const gchar *path,
                GHashTable *headers,
                CockpitWebResponse *response,
                const gchar **invoked)
{
  gchar *data;
  GBytes *bytes;

  g_assert (*invoked == NULL);
  *invoked = "oh";

  data = g_strdup_printf ("Scruffy says: %s", path);
  bytes = g_bytes_new_take (data, strlen (data));
  cockpit_web_response_content (response, NULL, bytes, NULL);
  g_bytes_unref (bytes);
  return TRUE;
}

static gboolean
on_scruffy_resource (CockpitWebServer *server,
                     const gchar *path,
                     GHashTable *headers,
                     CockpitWebResponse *response,
                     const gchar **invoked)
{
  const gchar *data;
  GBytes *bytes;

  g_assert (*invoked == NULL);
  *invoked = "scruffy";

  data = "Scruffy is here";
  bytes = g_bytes_new_static (data, strlen (data));
  cockpit_web_response_content (response, NULL, bytes, NULL);
  g_bytes_unref (bytes);
  return TRUE;
}

static gboolean
on_index_resource (CockpitWebServer *server,
                   const gchar *path,
                   GHashTable *headers,
                   CockpitWebResponse *response,
                   const gchar **invoked)
{
  const gchar *data;
  GBytes *bytes;

  g_assert (*invoked == NULL);
  *invoked = "index";

  data = "Yello from index";
  bytes = g_bytes_new_static (data, strlen (data));
  cockpit_web_response_content (response, NULL, bytes, NULL);
  g_bytes_unref (bytes);
  return TRUE;
}

static gboolean
on_default_resource (CockpitWebServer *server,
                     const gchar *path,
                     GHashTable *headers,
                     CockpitWebResponse *response,
                     const gchar **invoked)
{
  GBytes *bytes;

  g_assert (*invoked == NULL);
  *invoked = "default";

  bytes = g_bytes_new_static ("default", 7);
  cockpit_web_response_content (response, NULL, bytes, NULL);
  g_bytes_unref (bytes);
  return TRUE;
}


static void
test_handle_resource (TestCase *tc,
                      gconstpointer data)
{
  const gchar *invoked = NULL;
  gchar *resp;

  g_signal_connect (tc->web_server, "handle-resource::/oh/",
                    G_CALLBACK (on_oh_resource), &invoked);
  g_signal_connect (tc->web_server, "handle-resource::/scruffy",
                    G_CALLBACK (on_scruffy_resource), &invoked);
  g_signal_connect (tc->web_server, "handle-resource::/",
                    G_CALLBACK (on_index_resource), &invoked);
  g_signal_connect (tc->web_server, "handle-resource",
                    G_CALLBACK (on_default_resource), &invoked);

  /* Should call the /oh/ handler */
  resp = perform_http_request (tc->localport, "GET /oh/marmalade HTTP/1.0\r\nHost:test\r\n\r\n", NULL);
  g_assert_cmpstr (invoked, ==, "oh");
  invoked = NULL;
  cockpit_assert_strmatch (resp, "*Scruffy says: /oh/marmalade");
  g_free (resp);

  /* Should call the /oh/ handler */
  resp = perform_http_request (tc->localport, "GET /oh/ HTTP/1.0\r\nHost:test\r\n\r\n", NULL);
  g_assert_cmpstr (invoked, ==, "oh");
  cockpit_assert_strmatch (resp, "*Scruffy says: /oh/");
  invoked = NULL;
  g_free (resp);

  /* Should call the default handler */
  g_free (perform_http_request (tc->localport, "GET /oh HTTP/1.0\r\nHost:test\r\n\r\n", NULL));
  g_assert_cmpstr (invoked, ==, "default");
  invoked = NULL;

  /* Should call the scruffy handler */
  resp = perform_http_request (tc->localport, "GET /scruffy HTTP/1.0\r\nHost:test\r\n\r\n", NULL);
  g_assert_cmpstr (invoked, ==, "scruffy");
  invoked = NULL;
  cockpit_assert_strmatch (resp, "*Scruffy is here");
  g_free (resp);

  /* Should call the default handler */
  g_free (perform_http_request (tc->localport, "GET /scruffy/blah HTTP/1.0\r\nHost:test\r\n\r\n", NULL));
  g_assert_cmpstr (invoked, ==, "default");
  invoked = NULL;

  /* Should call the index handler */
  resp = perform_http_request (tc->localport, "GET / HTTP/1.0\r\nHost:test\r\n\r\n", NULL);
  g_assert_cmpstr (invoked, ==, "index");
  invoked = NULL;
  cockpit_assert_strmatch (resp, "*Yello from index");
  g_free (resp);

  /* Should call the default handler */
  g_free (perform_http_request (tc->localport, "GET /oooo HTTP/1.0\r\nHost:test\r\n\r\n", NULL));
  g_assert_cmpstr (invoked, ==, "default");
  invoked = NULL;
}

static void
test_webserver_host_header (TestCase *tc,
                            gconstpointer data)
{
  gsize length;
  guint status;
  gssize off;
  gchar *resp;

  cockpit_expect_log ("cockpit-protocol", G_LOG_LEVEL_MESSAGE, "received HTTP request without Host header");
  resp = perform_http_request (tc->localport, "GET /index.html HTTP/1.0\r\n\r\n", &length);
  g_assert (resp != NULL);
  g_assert_cmpuint (length, >, 0);

  off = web_socket_util_parse_status_line (resp, length, NULL, &status, NULL);
  g_assert_cmpuint (off, >, 0);
  g_assert_cmpint (status, ==, 400);

  g_free (resp);
}

static void
test_url_root (TestCase *tc,
                 gconstpointer unused)
{
  gchar *url_root = NULL;

  g_object_get (tc->web_server, "url-root", &url_root, NULL);
  g_assert (url_root == NULL);

  g_object_set (tc->web_server, "url-root", "/", NULL);
  g_object_get (tc->web_server, "url-root", &url_root, NULL);
  g_assert (url_root == NULL);

  g_object_set (tc->web_server, "url-root", "/path/", NULL);
  g_object_get (tc->web_server, "url-root", &url_root, NULL);
  g_assert_cmpstr (url_root, ==, "/path");
  g_free (url_root);
  url_root = NULL;

  g_object_set (tc->web_server, "url-root", "//path//", NULL);
  g_object_get (tc->web_server, "url-root", &url_root, NULL);
  g_assert_cmpstr (url_root, ==, "/path");
  g_free (url_root);
  url_root = NULL;

  g_object_set (tc->web_server, "url-root", "path/", NULL);
  g_object_get (tc->web_server, "url-root", &url_root, NULL);
  g_assert_cmpstr (url_root, ==, "/path");
  g_free (url_root);
  url_root = NULL;

  g_object_set (tc->web_server, "url-root", "path", NULL);
  g_object_get (tc->web_server, "url-root", &url_root, NULL);
  g_assert_cmpstr (url_root, ==, "/path");
  g_free (url_root);
  url_root = NULL;
}


static void
test_handle_resource_url_root (TestCase *tc,
                                 gconstpointer unused)
{
  const gchar *invoked = NULL;
  gchar *resp;

  g_object_set (tc->web_server, "url-root", "/path/", NULL);

  g_signal_connect (tc->web_server, "handle-resource::/oh/",
                    G_CALLBACK (on_oh_resource), &invoked);
  g_signal_connect (tc->web_server, "handle-resource::/scruffy",
                    G_CALLBACK (on_scruffy_resource), &invoked);
  g_signal_connect (tc->web_server, "handle-resource::/",
                    G_CALLBACK (on_index_resource), &invoked);
  g_signal_connect (tc->web_server, "handle-resource",
                    G_CALLBACK (on_default_resource), &invoked);

  /* Should call the /oh/ handler */
  resp = perform_http_request (tc->localport, "GET /path/oh/marmalade HTTP/1.0\r\nHost:test\r\n\r\n", NULL);
  g_assert_cmpstr (invoked, ==, "oh");
  invoked = NULL;
  cockpit_assert_strmatch (resp, "*Scruffy says: /oh/marmalade");
  g_free (resp);

  /* Should call the /oh/ handler */
  resp = perform_http_request (tc->localport, "GET /path/oh/ HTTP/1.0\r\nHost:test\r\n\r\n", NULL);
  g_assert_cmpstr (invoked, ==, "oh");
  cockpit_assert_strmatch (resp, "*Scruffy says: /oh/");
  invoked = NULL;
  g_free (resp);

  /* Should call the default handler */
  g_free (perform_http_request (tc->localport, "GET /path/oh HTTP/1.0\r\nHost:test\r\n\r\n", NULL));
  g_assert_cmpstr (invoked, ==, "default");
  invoked = NULL;

  /* Should call the scruffy handler */
  resp = perform_http_request (tc->localport, "GET /path/scruffy HTTP/1.0\r\nHost:test\r\n\r\n", NULL);
  g_assert_cmpstr (invoked, ==, "scruffy");
  invoked = NULL;
  cockpit_assert_strmatch (resp, "*Scruffy is here");
  g_free (resp);

  /* Should call the default handler */
  g_free (perform_http_request (tc->localport, "GET /path/scruffy/blah HTTP/1.0\r\nHost:test\r\n\r\n", NULL));
  g_assert_cmpstr (invoked, ==, "default");
  invoked = NULL;

  /* Should call the index handler */
  resp = perform_http_request (tc->localport, "GET /path/ HTTP/1.0\r\nHost:test\r\n\r\n", NULL);
  g_assert_cmpstr (invoked, ==, "index");
  invoked = NULL;
  cockpit_assert_strmatch (resp, "*Yello from index");
  g_free (resp);

  /* Should call the default handler */
  g_free (perform_http_request (tc->localport, "GET /path/oooo HTTP/1.0\r\nHost:test\r\n\r\n", NULL));
  g_assert_cmpstr (invoked, ==, "default");
  invoked = NULL;

  /* Should fail */
  resp = perform_http_request (tc->hostport, "GET /oooo HTTP/1.0\r\nHost:test\r\n\r\n", NULL);
  cockpit_assert_strmatch (resp, "HTTP/* 404 *\r\n");
  g_free (resp);
  g_assert (invoked == NULL);
}

static void
assert_cannot_connect (const gchar *hostport)
{
  GSocketClient *client;
  GSocketConnection *conn;
  GAsyncResult *result;
  GError *error = NULL;

  client = g_socket_client_new ();

  result = NULL;
  g_socket_client_connect_to_host_async (client, hostport, 1, NULL, on_ready_get_result, &result);
  while (result == NULL)
    g_main_context_iteration (NULL, TRUE);
  conn = g_socket_client_connect_to_host_finish (client, result, &error);
  g_object_unref (result);
  g_assert_null (conn);
  g_assert_error (error,  G_IO_ERROR, G_IO_ERROR_CONNECTION_REFUSED);
  g_clear_error (&error);
  g_object_unref (client);
}

static void
test_address (TestCase *tc,
              gconstpointer data)
{
  gchar *resp = NULL;
  const TestFixture *fix = data;

  cockpit_web_server_set_redirect_tls (tc->web_server, FALSE);
  g_signal_connect (tc->web_server, "handle-resource", G_CALLBACK (on_shell_index_html), NULL);
  if (fix->local_only)
    {
      resp = perform_http_request (tc->localport, "GET /shell/index.html HTTP/1.0\r\nHost:test\r\n\r\n", NULL);
      cockpit_assert_strmatch (resp, "HTTP/* 200 *\r\n*");
      g_free (resp);
      resp = NULL;
    }
  else
    {
      assert_cannot_connect (tc->localport);
    }

  if (fix->inet_only)
    {
      resp = perform_http_request (tc->hostport, "GET /shell/index.html HTTP/1.0\r\nHost:test\r\n\r\n", NULL);
      cockpit_assert_strmatch (resp, "HTTP/* 200 *\r\n*");
      g_free (resp);
      resp = NULL;
    }
  else
    {
      assert_cannot_connect (tc->hostport);
    }
}

static void
test_bad_address (TestCase *tc,
                  gconstpointer unused)
{
  CockpitWebServer *server = NULL;
  GError *error = NULL;
  gint port;

  cockpit_expect_warning ("Couldn't parse IP address from: bad");
  server = cockpit_web_server_new ("bad", 0, NULL, NULL, &error);

  g_assert_no_error (error);
  g_object_get (server, "port", &port, NULL);
  g_assert (port > 0);

  g_object_unref (server);
}

static const TestFixture fixture_inet_address = {
    .inet_only = TRUE
};

static const TestFixture fixture_local_address = {
    .local_only = TRUE
};

int
main (int argc,
      char *argv[])
{
  g_setenv ("GSETTINGS_BACKEND", "memory", TRUE);
  g_setenv ("GIO_USE_PROXY_RESOLVER", "dummy", TRUE);
  g_setenv ("GIO_USE_VFS", "local", TRUE);

  cockpit_test_init (&argc, &argv);

  g_test_add_func ("/web-server/table", test_table);

  g_test_add_func ("/web-server/cookie/simple", test_cookie_simple);
  g_test_add_func ("/web-server/cookie/multiple", test_cookie_multiple);
  g_test_add_func ("/web-server/cookie/overlap", test_cookie_overlap);
  g_test_add_func ("/web-server/cookie/no-header", test_cookie_no_header);
  g_test_add_func ("/web-server/cookie/substring", test_cookie_substring);
  g_test_add_func ("/web-server/cookie/decode", test_cookie_decode);
  g_test_add_func ("/web-server/cookie/decode-bad", test_cookie_decode_bad);

  g_test_add_func ("/web-server/languages/simple", test_languages_simple);
  g_test_add_func ("/web-server/languages/cookie", test_languages_cookie);
  g_test_add_func ("/web-server/languages/no-header", test_languages_no_header);
  g_test_add_func ("/web-server/languages/order", test_languages_order);

  g_test_add_func ("/web-server/encoding/simple", test_encoding_simple);
  g_test_add_func ("/web-server/encoding/no-header", test_encoding_no_header);
  g_test_add_func ("/web-server/encoding/zero-qvalue", test_encoding_zero_qvalue);

  g_test_add ("/web-server/query-string", TestCase, NULL,
              setup, test_with_query_string, teardown);
  g_test_add ("/web-server/host-header", TestCase, NULL,
              setup, test_webserver_host_header, teardown);
  g_test_add ("/web-server/not-found", TestCase, NULL,
              setup, test_webserver_not_found, teardown);

  g_test_add ("/web-server/redirect-notls", TestCase, &fixture_with_cert,
              setup, test_webserver_redirect_notls, teardown);
  g_test_add ("/web-server/no-redirect-localhost", TestCase, &fixture_with_cert,
              setup, test_webserver_noredirect_localhost, teardown);
  g_test_add ("/web-server/no-redirect-exception", TestCase, &fixture_with_cert,
              setup, test_webserver_noredirect_exception, teardown);
  g_test_add ("/web-server/no-redirect-override", TestCase, &fixture_with_cert,
              setup, test_webserver_noredirect_override, teardown);

  g_test_add ("/web-server/handle-resource", TestCase, NULL,
              setup, test_handle_resource, teardown);

  g_test_add ("/web-server/url-root", TestCase, NULL,
              setup, test_url_root, teardown);
  g_test_add ("/web-server/url-root-handlers", TestCase, NULL,
              setup, test_handle_resource_url_root, teardown);

  g_test_add ("/web-server/local-address-only", TestCase, &fixture_local_address,
              setup, test_address, teardown);
  g_test_add ("/web-server/inet-address-only", TestCase, &fixture_inet_address,
              setup, test_address, teardown);
  g_test_add ("/web-server/bad-address", TestCase, NULL,
              NULL, test_bad_address, NULL);

  return g_test_run ();
}
