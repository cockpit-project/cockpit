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

#include "cockpit/cockpittest.h"

#include "websocket/websocket.h"
#include "websocket/websocketprivate.h"

#include <sys/types.h>
#include <net/if.h>
#include <netinet/in.h>
#include <netinet/ip6.h>
#include <ifaddrs.h>
#include <string.h>

typedef struct {
    CockpitWebServer *web_server;
    gchar *localport;
    gchar *hostport;
} TestCase;

typedef struct {
    const gchar *cert_file;
} TestFixture;

static GInetAddress *
find_non_loopback_address (void)
{
  GInetAddress *inet = NULL;
  struct ifaddrs *ifas, *ifa;
  gpointer bytes;

  g_assert_cmpint (getifaddrs (&ifas), ==, 0);
  for (ifa = ifas; ifa != NULL; ifa = ifa->ifa_next)
    {
      if (!(ifa->ifa_flags & IFF_UP))
        continue;
      if (ifa->ifa_addr == NULL)
        continue;
      if (ifa->ifa_addr->sa_family == AF_INET)
        {
          bytes = &(((struct sockaddr_in *)ifa->ifa_addr)->sin_addr);
          inet = g_inet_address_new_from_bytes (bytes, G_SOCKET_FAMILY_IPV4);
        }
      else if (ifa->ifa_addr->sa_family == AF_INET6)
        {
          bytes = &(((struct sockaddr_in6 *)ifa->ifa_addr)->sin6_addr);
          inet = g_inet_address_new_from_bytes (bytes, G_SOCKET_FAMILY_IPV6);
        }
      if (inet)
        {
          if (!g_inet_address_get_is_loopback (inet))
            break;
          g_object_unref (inet);
          inet = NULL;
        }
    }

  freeifaddrs (ifas);
  return inet;
}

static void
setup (TestCase *tc,
       gconstpointer data)
{
  const gchar *roots[] = { BUILDDIR, NULL };
  const TestFixture *fixture = data;
  GTlsCertificate *cert = NULL;
  GError *error = NULL;
  GInetAddress *inet;
  gchar *str;
  gint port;

  if (fixture && fixture->cert_file)
    {
      cert = g_tls_certificate_new_from_file (fixture->cert_file, &error);
      g_assert_no_error (error);
    }

  tc->web_server = cockpit_web_server_new (0, cert, roots, NULL, &error);
  g_assert_no_error (error);
  g_clear_object (&cert);

  /* Automatically chosen by the web server */
  g_object_get (tc->web_server, "port", &port, NULL);
  tc->localport = g_strdup_printf ("localhost:%d", port);

  inet = find_non_loopback_address ();
  if (inet)
    {
      str = g_inet_address_to_string (inet);
      tc->hostport = g_strdup_printf ("%s:%d", str, port);
      g_free (str);
      g_object_unref (inet);
    }
}

static void
teardown (TestCase *tc,
          gconstpointer data)
{
  /* Verifies that we're not leaking the web server */
  g_object_add_weak_pointer (G_OBJECT (tc->web_server), (gpointer *)&tc->web_server);
  g_object_unref (tc->web_server);
  g_assert (tc->web_server == NULL);

  g_free (tc->localport);
  g_free (tc->hostport);

  cockpit_assert_expected ();
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

static void
test_webserver_content_type (TestCase *tc,
                             gconstpointer user_data)
{
  GHashTable *headers;
  gchar *resp;
  gsize length;
  guint status;
  gssize off;

  resp = perform_http_request (tc->localport, "GET /dbus-test.html HTTP/1.0\r\n\r\n", &length);
  g_assert (resp != NULL);
  g_assert_cmpuint (length, >, 0);

  off = web_socket_util_parse_status_line (resp, length, &status, NULL);
  g_assert_cmpuint (off, >, 0);
  g_assert_cmpint (status, ==, 200);

  off = web_socket_util_parse_headers (resp + off, length - off, &headers);
  g_assert_cmpuint (off, >, 0);

  g_assert_cmpstr (g_hash_table_lookup (headers, "Content-Type"), ==, "text/html");

  g_hash_table_unref (headers);
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

  resp = perform_http_request (tc->localport, "GET /non-existent HTTP/1.0\r\n\r\n", &length);
  g_assert (resp != NULL);
  g_assert_cmpuint (length, >, 0);

  off = web_socket_util_parse_status_line (resp, length, &status, NULL);
  g_assert_cmpuint (off, >, 0);
  g_assert_cmpint (status, ==, 404);

  g_free (resp);
}

static void
test_webserver_not_authorized (TestCase *tc,
                               gconstpointer user_data)
{
  gchar *resp;
  gsize length;
  guint status;
  gssize off;

  /* Listing a directory will result in 403 (except / -> index.html) */
  resp = perform_http_request (tc->localport, "GET /po HTTP/1.0\r\n\r\n", &length);
  g_assert (resp != NULL);
  g_assert_cmpuint (length, >, 0);

  off = web_socket_util_parse_status_line (resp, length, &status, NULL);
  g_assert_cmpuint (off, >, 0);
  g_assert_cmpint (status, ==, 403);

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

  if (!tc->hostport)
    {
      cockpit_test_skip ("no non-loopback address found");
      return;
    }

  resp = perform_http_request (tc->hostport, "GET /dbus-test.html HTTP/1.0\r\n\r\n", NULL);
  cockpit_assert_strmatch (resp, "HTTP/* 301 *\r\nLocation: https://*");
  g_free (resp);
}

static void
test_webserver_noredirect_localhost (TestCase *tc,
                                     gconstpointer data)
{
  gchar *resp;

  resp = perform_http_request (tc->localport, "GET /dbus-test.html HTTP/1.0\r\n\r\n", NULL);
  cockpit_assert_strmatch (resp, "HTTP/* 200 *\r\n*");
  g_free (resp);
}

int
main (int argc,
      char *argv[])
{
  g_setenv ("GSETTINGS_BACKEND", "memory", TRUE);
  g_setenv ("GIO_USE_PROXY_RESOLVER", "dummy", TRUE);
  g_setenv ("GIO_USE_VFS", "local", TRUE);

  cockpit_test_init (&argc, &argv);

  g_test_add_func ("/web-server/table", test_table);

  g_test_add ("/web-server/content-type", TestCase, NULL,
              setup, test_webserver_content_type, teardown);
  g_test_add ("/web-server/not-found", TestCase, NULL,
              setup, test_webserver_not_found, teardown);
  g_test_add ("/web-server/not-authorized", TestCase, NULL,
              setup, test_webserver_not_authorized, teardown);

  g_test_add ("/web-server/redirect-notls", TestCase, &fixture_with_cert,
              setup, test_webserver_redirect_notls, teardown);
  g_test_add ("/web-server/no-redirect-localhost", TestCase, &fixture_with_cert,
              setup, test_webserver_noredirect_localhost, teardown);

  return g_test_run ();
}
