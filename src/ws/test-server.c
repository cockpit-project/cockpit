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

#include "cockpitwebservice.h"
#include "cockpitchannelresponse.h"
#include "cockpitchannelsocket.h"
#include "cockpitws.h"

#include "common/cockpitpipe.h"
#include "common/cockpitconf.h"
#include "common/cockpitpipetransport.h"
#include "common/cockpitsystem.h"
#include "testlib/cockpittest.h"
#include "common/cockpitwebserver.h"
#include "common/cockpitwebinject.h"

#include "ws/mock-service.h"

#include <gio/gio.h>
#include <glib-unix.h>
#include <glib/gstdio.h>
#include <string.h>

/* Override from cockpitconf.c */
extern const gchar *cockpit_config_file;

static GMainLoop *loop = NULL;
static gboolean signalled = FALSE;
static int exit_code = 0;
static gint server_port = 0;
static gchar **bridge_argv;
static const gchar *bus_address;
static const gchar *direct_address;
static gchar **server_roots;

/* ---------------------------------------------------------------------------------------------------- */

static GObject *exported = NULL;
static GObject *exported_b = NULL;
static GObject *direct = NULL;
static GObject *direct_b = NULL;

static GDBusMessage *
on_filter_func (GDBusConnection *connection,
                GDBusMessage *message,
                gboolean incoming,
                gpointer user_data)
{
  GError *error = NULL;
  GDBusMessage *reply = NULL;

  if (incoming)
    {
      if (g_dbus_message_get_message_type (message) == G_DBUS_MESSAGE_TYPE_METHOD_CALL &&
          g_str_equal (g_dbus_message_get_path (message), "/bork") &&
          g_str_equal (g_dbus_message_get_interface (message), "borkety.Bork") &&
          g_str_equal (g_dbus_message_get_member (message), "Echo"))
      {
        reply = g_dbus_message_new_method_reply (message);
        g_dbus_message_set_body (reply, g_dbus_message_get_body (message));
      }

      if (g_dbus_message_get_message_type (message) == G_DBUS_MESSAGE_TYPE_SIGNAL &&
          g_str_equal (g_dbus_message_get_path (message), "/bork") &&
          g_str_equal (g_dbus_message_get_interface (message), "borkety.Bork"))
        {
          reply = g_dbus_message_new_signal ("/bork", "borkety.Bork",
                                             g_dbus_message_get_member (message));
          g_dbus_message_set_body (reply, g_dbus_message_get_body (message));
        }

      if (reply)
        {
          g_dbus_connection_send_message (connection, reply, G_DBUS_SEND_MESSAGE_FLAGS_NONE, NULL, &error);
          if (error != NULL)
            {
              g_warning ("Couldn't send DBus message: %s", error->message);
              g_error_free (error);
            }
          g_object_unref (reply);
          g_object_unref (message);
          return NULL;
        }
    }

  return message;
}

static void
on_bus_acquired (GDBusConnection *connection,
                 const gchar *name,
                 gpointer user_data)
{
  exported = mock_service_create_and_export (connection, "/otree");
  exported_b = mock_service_create_and_export (connection, "/different");
  g_dbus_connection_add_filter (connection, on_filter_func, NULL, NULL);
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
mock_http_info (CockpitWebRequest *request,
                CockpitWebResponse *response)
{
  g_autoptr(JsonObject) info = json_object_new ();
  json_object_set_boolean_member (info, "pybridge", strstr (bridge_argv[0], "py") != NULL);
  json_object_set_boolean_member (info, "skip_slow_tests", g_getenv ("COCKPIT_SKIP_SLOW_TESTS") != NULL);

  g_autoptr(GBytes) bytes = cockpit_json_write_bytes (info);
  cockpit_web_response_content (response, NULL, bytes, NULL);
  return TRUE;
}

static gboolean
mock_http_qs (CockpitWebRequest *request,
              CockpitWebResponse *response)
{
  const gchar *qs;
  GBytes *bytes;

  qs = cockpit_web_request_get_query (request);
  if (!qs)
    {
      cockpit_web_response_error (response, 400, NULL, "No query string");
    }
  else
    {
      bytes = g_bytes_new (qs, strlen (qs));
      cockpit_web_response_content (response, NULL, bytes, NULL);
      g_bytes_unref (bytes);
    }

  return TRUE;
}

static gboolean
send_numbers (gpointer data)
{
  CockpitWebResponse *response = data;
  gint *at = g_object_get_data (data, "at");
  gchar *string;
  GBytes *bytes;

  string = g_strdup_printf ("%d ", *at);
  (*at) += 1;

  bytes = g_bytes_new_take (string, strlen (string));
  cockpit_web_response_queue (response, bytes);
  g_bytes_unref (bytes);

  if (*at == 10)
    {
      cockpit_web_response_complete (response);
      return FALSE;
    }

  return TRUE;
}

static const char* SPLIT_UTF8_FRAMES[] = {
    "initial",
    /* split an é in the middle */
    "first half \xc3",
    "\xa9 second half",
    "final",
    NULL,
};

static gboolean
send_split_utf8 (gpointer data)
{
  CockpitWebResponse *response = data;
  gint *at = g_object_get_data (data, "at");
  const char *frame = SPLIT_UTF8_FRAMES[*at];

  if (frame == NULL)
    {
      cockpit_web_response_complete (response);
      return FALSE;
    }

  (*at) += 1;

  g_autoptr(GBytes) bytes = g_bytes_new_static (frame, strlen (frame));
  cockpit_web_response_queue (response, bytes);
  return TRUE;
}

static gboolean
send_truncated_utf8 (gpointer data)
{
  CockpitWebResponse *response = data;
  gint *at = g_object_get_data (data, "at");
  const char *frame = SPLIT_UTF8_FRAMES[*at];

  /* only send the first two frames */
  if (*at == 2)
    {
      cockpit_web_response_complete (response);
      return FALSE;
    }

  (*at) += 1;

  g_autoptr(GBytes) bytes = g_bytes_new_static (frame, strlen (frame));
  cockpit_web_response_queue (response, bytes);
  return TRUE;
}

static gboolean
send_binary_data (gpointer data)
{
  CockpitWebResponse *response = data;
  g_autoptr(GBytes) bytes = g_bytes_new_static ("\xFF\x01\xFF\x02", 4);
  cockpit_web_response_queue (response, bytes);
  cockpit_web_response_complete (response);
  return FALSE;
}

static gboolean
mock_http_stream (CockpitWebResponse *response, GSourceFunc func)
{
  cockpit_web_response_headers (response, 200, "OK", -1, NULL);
  g_object_set_data_full (G_OBJECT (response), "at", g_new0 (gint, 1), g_free);
  g_timeout_add_full (G_PRIORITY_DEFAULT, 100, func,
                      g_object_ref (response), g_object_unref);

  return TRUE;
}

static gboolean
mock_http_headers (CockpitWebResponse *response,
                   GHashTable *in_headers)
{
  GHashTableIter iter;
  GHashTable *headers;
  gpointer name, value;

  headers = cockpit_web_server_new_table();
  g_hash_table_iter_init (&iter, in_headers);
  while (g_hash_table_iter_next (&iter, &name, &value))
    {
      if (g_str_has_prefix (name, "Header"))
        g_hash_table_insert (headers, g_strdup (name), g_strdup (value));
    }
  g_hash_table_replace (headers, g_strdup ("Header3"), g_strdup ("three"));
  g_hash_table_replace (headers, g_strdup ("Header4"), g_strdup ("marmalade"));

  cockpit_web_response_headers_full (response, 201, "Yoo Hoo", -1, headers);
  cockpit_web_response_complete (response);

  g_hash_table_unref (headers);

  return TRUE;
}

static gboolean
mock_http_host (CockpitWebResponse *response,
                GHashTable *in_headers)
{
  GHashTable *headers;

  headers = cockpit_web_server_new_table();
  g_hash_table_insert (headers, g_strdup ("Host"), g_strdup (g_hash_table_lookup (in_headers, "Host")));
  cockpit_web_response_headers_full (response, 201, "Yoo Hoo", -1, headers);
  cockpit_web_response_complete (response);

  g_hash_table_unref (headers);

  return TRUE;
}

static gboolean
mock_http_connection (CockpitWebResponse *response)
{
  GIOStream *io;
  GBytes *bytes;
  gchar *output;

  /* Lets caller have an indication of which IO stream is being used */

  io = cockpit_web_response_get_stream (response);
  output = g_strdup_printf ("%p", io);
  bytes = g_bytes_new_take (output, strlen (output));

  cockpit_web_response_content (response, NULL, bytes, NULL);
  g_bytes_unref (bytes);

  return TRUE;
}

static gboolean
mock_http_headonly (CockpitWebRequest *request,
                    CockpitWebResponse *response)
{
  if (!g_str_equal (cockpit_web_request_get_method (request), "HEAD"))
    {
      cockpit_web_response_error (response, 400, NULL, "Only HEAD allowed on this path");
    }
  else
    {
      const char *input_data = cockpit_web_request_lookup_header (request, "InputData");
      if (!input_data)
        {
          cockpit_web_response_error (response, 400, NULL, "Requires InputData header");
          return TRUE;
        }

      g_autoptr(GHashTable) headers = cockpit_web_server_new_table();
      g_hash_table_insert (headers, g_strdup ("InputDataLength"), g_strdup_printf ("%zu", strlen (input_data)));
      cockpit_web_response_headers_full (response, 200, "OK", -1, headers);
      cockpit_web_response_complete (response);
    }

  return TRUE;
}

static gboolean
mock_http_expect_warnings (CockpitWebResponse *response,
                           GLogLevelFlags warnings)
{
  g_log_set_always_fatal (warnings | G_LOG_LEVEL_ERROR);

  cockpit_web_response_headers_full (response, 200, "OK", 0, NULL);
  cockpit_web_response_complete (response);

  return TRUE;
}

static gboolean
on_handle_mock (CockpitWebServer *server,
                CockpitWebRequest *request,
                const gchar *path,
                GHashTable *headers,
                CockpitWebResponse *response,
                gpointer data)
{
  g_assert (g_str_has_prefix (path, "/mock/"));
  path += 5;

  if (g_str_equal (path, "/info"))
    return mock_http_info (request, response);
  if (g_str_equal (path, "/qs"))
    return mock_http_qs (request, response);
  if (g_str_equal (path, "/stream"))
    return mock_http_stream (response, send_numbers);
  if (g_str_equal (path, "/split-utf8"))
    return mock_http_stream (response, send_split_utf8);
  if (g_str_equal (path, "/truncated-utf8"))
    return mock_http_stream (response, send_truncated_utf8);
  if (g_str_equal (path, "/binary-data"))
    return mock_http_stream (response, send_binary_data);
  if (g_str_equal (path, "/headers"))
    return mock_http_headers (response, headers);
  if (g_str_equal (path, "/host"))
    return mock_http_host (response, headers);
  if (g_str_equal (path, "/connection"))
    return mock_http_connection (response);
  if (g_str_equal (path, "/headonly"))
    return mock_http_headonly (request, response);
  if (g_str_equal (path, "/expect-warnings"))
    return mock_http_expect_warnings (response, 0);
  if (g_str_equal (path, "/dont-expect-warnings"))
    return mock_http_expect_warnings (response, G_LOG_LEVEL_WARNING | G_LOG_LEVEL_CRITICAL);
  else
    return FALSE;
}

/* ---------------------------------------------------------------------------------------------------- */

/* Called by @server when handling HTTP requests to /socket - runs in a separate
 * thread dedicated to the request so it may do blocking I/O
 */

static CockpitWebService *service;
static CockpitPipe *bridge;

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

static gboolean
on_handle_stream_socket (CockpitWebServer *server,
                         CockpitWebRequest *request,
                         gpointer user_data)
{
  const gchar *path = cockpit_web_request_get_path (request);

  CockpitTransport *transport;
  const gchar *query = NULL;
  CockpitCreds *creds;
  int session_stdin = -1;
  int session_stdout = -1;
  GError *error = NULL;
  gboolean ready = FALSE;
  gulong handler;
  GPid pid = 0;

  gchar *value;
  gchar **argv;

  if (!g_str_has_prefix (path, "/cockpit/socket"))
    return FALSE;

  if (path[15] == '?')
    {
      query = path + 16;
    }
  else if (path[15] != '\0')
    {
      return FALSE;
    }

  if (service)
    {
      g_object_ref (service);
    }
  else
    {
      g_clear_object (&bridge);

      value = g_strdup_printf ("%d", server_port);

      argv = g_strdupv (bridge_argv);
      if (query)
        argv[g_strv_length (argv) - 1] = g_strdup (query);

      g_spawn_async_with_pipes (NULL, argv, NULL,
                                G_SPAWN_SEARCH_PATH | G_SPAWN_DO_NOT_REAP_CHILD,
                                NULL, NULL, &pid, &session_stdin, &session_stdout, NULL, &error);

      g_free (argv);
      g_free (value);

      if (error)
        {
          g_critical ("couldn't run bridge %s: %s", bridge_argv[0], error->message);
          return FALSE;
        }

      bridge = g_object_new (COCKPIT_TYPE_PIPE,
                             "name", "test-server-bridge",
                             "in-fd", session_stdout,
                             "out-fd", session_stdin,
                             "pid", pid,
                             NULL);

      creds = cockpit_creds_new ("test",
                                 COCKPIT_CRED_CSRF_TOKEN, "myspecialtoken",
                                 NULL);

      transport = cockpit_pipe_transport_new (bridge);
      service = cockpit_web_service_new (creds, transport);

      /* Manually created services won't be init'd yet, wait for that before sending data */
      handler = g_signal_connect (transport, "control", G_CALLBACK (on_transport_control), &ready);

      while (!ready)
        g_main_context_iteration (NULL, TRUE);

      cockpit_creds_unref (creds);
      g_object_unref (transport);

      /* Clear the pointer automatically when service is done */
      g_object_add_weak_pointer (G_OBJECT (service), (gpointer *)&service);

      g_signal_handler_disconnect (transport, handler);
    }

  cockpit_web_service_socket (service, request);

  /* Keeps ref on itself until it closes */
  g_object_unref (service);

  return TRUE;
}

static void
on_echo_socket_message (WebSocketConnection *self,
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
on_echo_socket_close (WebSocketConnection *ws,
                      gpointer user_data)
{
  g_object_unref (ws);
}

static gboolean
on_handle_stream_external (CockpitWebServer *server,
                           CockpitWebRequest *request,
                           gpointer user_data)
{
  const gchar *path = cockpit_web_request_get_path (request);
  GIOStream *io_stream = cockpit_web_request_get_io_stream (request);
  GByteArray *input = cockpit_web_request_get_buffer (request);
  GHashTable *headers = cockpit_web_request_get_headers (request);

  gboolean handled = FALSE;
  const gchar *upgrade;
  CockpitCreds *creds;
  const gchar *expected;
  const gchar *segment;
  JsonObject *open = NULL;
  GBytes *bytes;
  guchar *decoded;
  gsize length;

  if (g_str_has_prefix (path, "/cockpit/echosocket"))
    {
      const gchar *protocols[] = { "cockpit1", NULL };
      const gchar *origins[2] = { NULL, NULL };
      WebSocketConnection *ws = NULL;
      gchar *url;

      url = g_strdup_printf ("ws://localhost:%u%s", server_port, path);
      origins[0] = g_strdup_printf ("http://localhost:%u", server_port);

      ws = web_socket_server_new_for_stream (url, (const gchar **)origins,
                                             protocols, io_stream, headers, input);

      g_signal_connect (ws, "message", G_CALLBACK (on_echo_socket_message), NULL);
      g_signal_connect (ws, "close", G_CALLBACK (on_echo_socket_close), NULL);
      return TRUE;
    }

  if (!g_str_has_prefix (path, "/cockpit/channel/"))
    return FALSE;

  /* Remove /cockpit/channel/ part */
  segment = path + 17;

  if (service)
    {
      creds = cockpit_web_service_get_creds (service);
      g_return_val_if_fail (creds != NULL, FALSE);

      expected = cockpit_creds_get_csrf_token (creds);
      g_return_val_if_fail (expected != NULL, FALSE);

      /* No such path is valid */
      if (g_str_equal (segment, expected))
        {
          decoded = g_base64_decode (cockpit_web_request_get_query (request), &length);
          if (decoded)
            {
              bytes = g_bytes_new_take (decoded, length);
              if (!cockpit_transport_parse_command (bytes, NULL, NULL, &open))
                {
                  open = NULL;
                  g_message ("invalid external channel query");
                }
              g_bytes_unref (bytes);
            }
        }

      if (open)
        {
          upgrade = g_hash_table_lookup (headers, "Upgrade");
          if (upgrade && g_ascii_strcasecmp (upgrade, "websocket") == 0)
            {
              cockpit_channel_socket_open (service, open, request);
              handled = TRUE;
            }
          else
            {
              cockpit_channel_response_open (service, request, open);
              handled = TRUE;
            }

          json_object_unref (open);
        }
    }

  return handled;
}

static void
inject_address (CockpitWebResponse *response,
                const gchar *name,
                const gchar *value)
{
  GBytes *inject = NULL;
  CockpitWebFilter *filter = NULL;
  gchar *line = NULL;

  if (value)
    {
      line = g_strconcat ("\n<script>\nvar ", name, " = '", value, "';\n</script>", NULL);

      inject = g_bytes_new (line, strlen (line));
      filter = cockpit_web_inject_new ("<head>", inject, 1);
      g_bytes_unref (inject);

      cockpit_web_response_add_filter (response, filter);
      g_object_unref (filter);
    }

  g_free (line);
}

static void
handle_raw_data (CockpitWebResponse *response,
                 const gchar *data)
{
  GBytes *block;

  /* For testing code that uses "manifests" return empty manifests for now */
  block = g_bytes_new_static (data, strlen (data));
  cockpit_web_response_content (response, NULL, block, NULL);
  g_bytes_unref (block);
}

static void
handle_manifests_js (CockpitWebResponse *response)
{
  /* For testing code that uses "manifests" return empty manifests for now */
  handle_raw_data (response, "define({ });");
}

static void
handle_manifests_json (CockpitWebResponse *response)
{
  /* For testing code that uses "/pkg/manifests.json" return empty manifests for now */
  handle_raw_data (response, "{ }");
}

static void
handle_package_file (CockpitWebServer *server,
                     CockpitWebResponse *response,
                     gchar **parts)
{
  gchar *rebuilt;

  /* TODO: This needs a better implementation later, when the tests aren't all broken */
  if (g_strcmp0 (parts[2], "system") == 0)
    {
      g_free (parts[2]);
      parts[2] = g_strdup ("systemd");
    }
  if (g_strcmp0 (parts[2], "base1") == 0)
    {
      g_free (parts[1]);
      parts[1] = g_strdup ("src");
    }
  else if (g_strcmp0 (parts[2], "lib") == 0)
    {
      g_free (parts[1]);
      parts[1] = g_strdup("lib");
      parts++;
    }

  rebuilt = g_strjoinv ("/", parts);
  cockpit_web_response_file (response, rebuilt, (const gchar **)server_roots);
  g_free (rebuilt);
}

static gboolean
on_handle_resource (CockpitWebServer *server,
                    CockpitWebRequest *request,
                    const gchar *path,
                    GHashTable *headers,
                    CockpitWebResponse *response,
                    gpointer user_data)
{
  gchar **parts;

  g_assert (g_str_has_prefix (path, "/pkg"));

  cockpit_web_response_set_cache_type (response, COCKPIT_WEB_RESPONSE_NO_CACHE);

  parts = g_strsplit (path, "/", -1);
  if (g_strcmp0 (parts[2], "manifests.js") == 0 && !parts[3])
    handle_manifests_js (response);
  else if (g_strcmp0 (parts[2], "manifests.json") == 0 && !parts[3])
    handle_manifests_json (response);
  else
    handle_package_file (server, response, parts);

  g_strfreev (parts);
  return TRUE;
}

static gboolean
on_handle_source (CockpitWebServer *server,
                  CockpitWebRequest *request,
                  const gchar *path,
                  GHashTable *headers,
                  CockpitWebResponse *response,
                  gpointer user_data)
{
  cockpit_web_response_set_cache_type (response, COCKPIT_WEB_RESPONSE_NO_CACHE);
  if (g_str_has_suffix (path, ".html"))
    {
      inject_address (response, "bus_address", bus_address);
      inject_address (response, "direct_address", direct_address);
    }
  cockpit_web_response_file_or_gz (response, TRUE, path, (const gchar **)server_roots);
  return TRUE;
}

static gboolean
on_handle_favicon (CockpitWebServer *server,
                   CockpitWebRequest *request,
                   const gchar *path,
                   GHashTable *headers,
                   CockpitWebResponse *response,
                   gpointer user_data)
{
  const char* roots[] = { SRCDIR "/src/branding/default", NULL };
  cockpit_web_response_file (response, NULL, roots);
  return TRUE;
}

static void
server_ready (void)
{
  const gchar *roots[] = { ".", SRCDIR, BUILDDIR, NULL };
  GError *error = NULL;
  CockpitWebServer *server;
  gchar *url;
  const gchar *address_fd_str = g_getenv("TEST_SERVER_ADDRESS_FD");

  if (!isatty (1))
    server_port = 0; /* select one automatically */
  else
    server_port = 8765;

  server_roots = cockpit_web_response_resolve_roots (roots);
  server = cockpit_web_server_new (NULL, /* TLS cert */
                                   COCKPIT_WEB_SERVER_NONE);
  server_port = cockpit_web_server_add_inet_listener (server, NULL, server_port, &error);
  g_assert_no_error (error);
  g_assert (server_port != 0);


  g_signal_connect (server, "handle-stream",
                    G_CALLBACK (on_handle_stream_socket), NULL);
  g_signal_connect (server, "handle-stream",
                    G_CALLBACK (on_handle_stream_external), NULL);
  g_signal_connect (server, "handle-resource::/pkg/",
                    G_CALLBACK (on_handle_resource), NULL);
  g_signal_connect (server, "handle-resource::/dist/",
                    G_CALLBACK (on_handle_source), NULL);
  g_signal_connect (server, "handle-resource::/qunit/",
                    G_CALLBACK (on_handle_source), NULL);
  g_signal_connect (server, "handle-resource::/favicon.ico",
                    G_CALLBACK (on_handle_favicon), NULL);
  g_signal_connect (server, "handle-resource::/mock/",
                    G_CALLBACK (on_handle_mock), NULL);

  url = g_strdup_printf("http://localhost:%d", server_port);

  cockpit_web_server_start (server);

  if (address_fd_str)
    {
      int fd = atoi (address_fd_str);
      int r = write (fd, url, strlen (url));
      close (fd);
      g_assert (r == strlen (url));
    }
  else if (!isatty (1))
    {
      g_print ("%s\n", url);
    }
  else
    {
      g_print ("**********************************************************************\n"
           "Please connect a supported web browser to\n"
           "\n"
           " %s/qunit/base1/test-dbus.html\n"
           "\n"
           "and check that the test suite passes. Press Ctrl+C to exit.\n"
           "**********************************************************************\n"
           "\n", url);
    }

  g_free (url);
}

static gboolean name_acquired = FALSE;
static gboolean second_acquired = FALSE;

static void
on_name_acquired (GDBusConnection *connection,
                  const gchar *name,
                  gpointer user_data)
{
    name_acquired = TRUE;
    if (name_acquired && second_acquired)
      server_ready ();
}

static void
on_second_acquired (GDBusConnection *connection,
                    const gchar *name,
                    gpointer user_data)
{
    second_acquired = TRUE;
    if (name_acquired && second_acquired)
      server_ready ();
}

static void
on_name_lost (GDBusConnection *connection,
              const gchar *name,
              gpointer user_data)
{

}

static gboolean
on_new_direct_connection (GDBusServer *server,
                          GDBusConnection *connection,
                          gpointer unused)
{
  direct = mock_service_create_and_export (connection, "/otree");
  direct_b = mock_service_create_and_export (connection, "/different");
  g_dbus_connection_add_filter (connection, on_filter_func, NULL, NULL);
  return TRUE;
}

/* ---------------------------------------------------------------------------------------------------- */

static void
setup_path (const char *argv0)
{
  const gchar *old = g_getenv ("PATH");
  gchar *dir = g_path_get_dirname (argv0);
  gchar *path;

  path = g_strdup_printf ("%s%s%s", dir,
                          old ? ":" : "",
                          old ? old : NULL);

  cockpit_setenv_check ("PATH", path, TRUE);

  g_free (path);
  g_free (dir);
}

static gint
exit_code_from_pipe_status (CockpitPipe *pipe)
{
  gint status;

  status = cockpit_pipe_exit_status (pipe);
  if (WIFEXITED (status))
    return WEXITSTATUS (status);
  else if (status != 0)
    return 1;
  else
    return 0;
}

static void
on_bridge_done (CockpitPipe *pipe,
                const gchar *problem,
                gpointer user_data)
{
  exit_code = exit_code_from_pipe_status (pipe);
  g_main_loop_quit (loop);
}

static gboolean
on_signal_done (gpointer data)
{
  gboolean first = !signalled;
  signalled = TRUE;

  if (first)
    {
      if (service)
        cockpit_web_service_disconnect (service);
      if (bridge)
        {
          if (!cockpit_pipe_is_closed (bridge))
            {
              g_signal_connect (bridge, "close", G_CALLBACK (on_bridge_done), NULL);
              return TRUE;
            }

          exit_code = exit_code_from_pipe_status (bridge);
        }
    }

  g_main_loop_quit (loop);
  return TRUE;
}

int
main (int argc,
      char *argv[])
{
  GError *error = NULL;
  guint sig_term;
  guint sig_int;
  int i;
  gchar *rm_rf_argv[] = {"rm", "-rfv", NULL, NULL};

  GOptionEntry entries[] = {
    { NULL }
  };

  signal (SIGPIPE, SIG_IGN);
  /* avoid gvfs (http://bugzilla.gnome.org/show_bug.cgi?id=526454) */
  cockpit_setenv_check ("GIO_USE_VFS", "local", TRUE);

  /* playground config directory */
  g_autofree gchar *config_dir = g_dir_make_tmp ("cockpit.config.XXXXXX", NULL);
  g_assert (config_dir);
  g_autofree gchar *machines_dir = g_build_filename (config_dir, "cockpit", "machines.d", NULL);
  g_assert (g_mkdir_with_parents (machines_dir, 0755) == 0);

  cockpit_setenv_check ("PYTHONPATH", SRCDIR "/src", TRUE);
  cockpit_setenv_check ("XDG_DATA_HOME", SRCDIR "/test/data/mock-resource/home", TRUE);
  cockpit_setenv_check ("XDG_DATA_DIRS", SRCDIR "/test/data/mock-resource/system", TRUE);
  cockpit_setenv_check ("XDG_CONFIG_DIRS", config_dir, TRUE);

  setup_path (argv[0]);

  g_log_set_always_fatal (G_LOG_LEVEL_WARNING | G_LOG_LEVEL_CRITICAL | G_LOG_LEVEL_ERROR);

  sig_term = g_unix_signal_add (SIGTERM, on_signal_done, NULL);
  sig_int = g_unix_signal_add (SIGINT, on_signal_done, NULL);

  // System cockpit configuration file should not be loaded
  cockpit_config_file = NULL;

  g_autoptr(GOptionContext) context = g_option_context_new ("- test dbus json server");
  g_option_context_add_main_entries (context, entries, NULL);
  g_option_context_set_ignore_unknown_options (context, TRUE);
  if (!g_option_context_parse (context, &argc, &argv, &error))
    {
      g_printerr ("test-server: %s\n", error->message);
      exit (2);
    }

  /* This isolates us from affecting other processes during tests */
  g_autoptr(GTestDBus) bus = g_test_dbus_new (G_TEST_DBUS_NONE);
  g_test_dbus_up (bus);
  bus_address = g_test_dbus_get_bus_address (bus);

  g_autofree gchar *guid = g_dbus_generate_guid ();
  g_autoptr(GDBusServer) direct_dbus_server = g_dbus_server_new_sync (
          "unix:tmpdir=/tmp",
          G_DBUS_SERVER_FLAGS_NONE,
          guid,
          NULL,
          NULL,
          &error);
  if (direct_dbus_server == NULL)
    {
      g_printerr ("test-server: %s\n", error->message);
      exit (3);
    }

  /* Skip the program name */
  argc--;
  argv++;

  /* Null terminate the bridge command line */
  bridge_argv = g_new0 (char *, argc + 4);
  for (i = 0; i < argc; i++)
    bridge_argv[i] = argv[i];

  /* Default case */
  if (i == 0) {
    bridge_argv[i++] = "python3";
    bridge_argv[i++] = "-m";
    bridge_argv[i++] = "cockpit.bridge";
  }

  loop = g_main_loop_new (NULL, FALSE);

  g_bus_own_name (G_BUS_TYPE_SESSION,
                       "com.redhat.Cockpit.DBusTests.Test",
                       G_BUS_NAME_OWNER_FLAGS_ALLOW_REPLACEMENT | G_BUS_NAME_OWNER_FLAGS_REPLACE,
                       on_bus_acquired,
                       on_name_acquired,
                       on_name_lost,
                       loop,
                       NULL);

  g_bus_own_name (G_BUS_TYPE_SESSION,
                         "com.redhat.Cockpit.DBusTests.Second",
                         G_BUS_NAME_OWNER_FLAGS_ALLOW_REPLACEMENT | G_BUS_NAME_OWNER_FLAGS_REPLACE,
                         NULL,
                         on_second_acquired,
                         on_name_lost,
                         loop,
                         NULL);

  g_signal_connect_object (direct_dbus_server,
                           "new-connection",
                           G_CALLBACK (on_new_direct_connection),
                           NULL, 0);
  g_dbus_server_start (direct_dbus_server);
  direct_address = g_dbus_server_get_client_address (direct_dbus_server);

  g_main_loop_run (loop);

  g_source_remove (sig_term);
  g_source_remove (sig_int);

  g_clear_object (&bridge);
  g_clear_object (&exported);
  g_clear_object (&exported_b);
  g_clear_object (&direct);
  g_clear_object (&direct_b);
  g_main_loop_unref (loop);

  g_strfreev (server_roots);
  g_test_dbus_down (bus);
  g_free (bridge_argv);

  /* clean up temporary config dir */
  rm_rf_argv[2] = config_dir;
  g_spawn_sync (NULL, rm_rf_argv, NULL, 0, NULL, NULL, NULL, NULL, NULL, NULL);

  return exit_code;
}
