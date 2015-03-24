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

#include "common/cockpitpipe.h"
#include "common/cockpitconf.h"
#include "common/cockpitpipetransport.h"
#include "common/mock-service.h"
#include "common/cockpitwebserver.h"

#include <gio/gio.h>
#include <glib-unix.h>
#include <glib/gstdio.h>
#include <string.h>

#include "cockpitws.h"
#include "cockpitwebservice.h"

static GMainLoop *loop = NULL;
static int exit_code = 0;
static gint server_port = 0;

/* ---------------------------------------------------------------------------------------------------- */

static GObject *exported = NULL;
static GObject *exported_b = NULL;

static GDBusMessage *
on_filter_func (GDBusConnection *connection,
                GDBusMessage *message,
                gboolean incoming,
                gpointer user_data)
{
  GError *error = NULL;
  GDBusMessage *reply;

  if (incoming &&
      g_dbus_message_get_message_type (message) == G_DBUS_MESSAGE_TYPE_METHOD_CALL &&
      g_str_equal (g_dbus_message_get_path (message), "/bork") &&
      g_str_equal (g_dbus_message_get_interface (message), "borkety.Bork") &&
      g_str_equal (g_dbus_message_get_member (message), "Echo"))
    {
      reply = g_dbus_message_new_method_reply (message);
      g_dbus_message_set_body (reply, g_dbus_message_get_body (message));
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
mock_http_qs (CockpitWebResponse *response)
{
  const gchar *qs;
  GBytes *bytes;

  qs = cockpit_web_response_get_query (response);
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
on_timeout_send (gpointer data)
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

static gboolean
mock_http_stream (CockpitWebResponse *response)
{
  cockpit_web_response_headers (response, 200, "OK", -1, NULL);
  g_object_set_data_full (G_OBJECT (response), "at", g_new0 (gint, 1), g_free);
  g_timeout_add_full (G_PRIORITY_DEFAULT, 100, on_timeout_send,
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
on_handle_mock (CockpitWebServer *server,
                const gchar *path,
                GHashTable *headers,
                CockpitWebResponse *response,
                gpointer data)
{
  g_assert (g_str_has_prefix (path, "/mock/"));
  path += 5;

  if (g_str_equal (path, "/qs"))
    return mock_http_qs (response);
  if (g_str_equal (path, "/stream"))
    return mock_http_stream (response);
  if (g_str_equal (path, "/headers"))
    return mock_http_headers (response, headers);
  if (g_str_equal (path, "/connection"))
    return mock_http_connection (response);
  else
    return FALSE;
}

/* ---------------------------------------------------------------------------------------------------- */

/* Called by @server when handling HTTP requests to /socket - runs in a separate
 * thread dedicated to the request so it may do blocking I/O
 */

static CockpitWebService *service;

static gboolean
on_handle_stream_socket (CockpitWebServer *server,
                         const gchar *path,
                         GIOStream *io_stream,
                         GHashTable *headers,
                         GByteArray *input,
                         guint in_length,
                         gpointer user_data)
{
  CockpitTransport *transport;
  const gchar *query = NULL;
  CockpitCreds *creds;
  CockpitPipe *pipe;
  gchar *value;
  gchar **env;

  const gchar *argv[] = {
    "cockpit-bridge",
    NULL,
  };

  if (!g_str_has_prefix (path, "/socket"))
    return FALSE;

  if (path[7] == '?')
    query = path + 8;
  else if (path[7] != '\0')
    return FALSE;

  if (service)
    {
      g_object_ref (service);
    }
  else
    {
      value = g_strdup_printf ("%d", server_port);
      env = g_environ_setenv (g_get_environ (), "COCKPIT_TEST_SERVER_PORT", value, TRUE);

      creds = cockpit_creds_new (g_get_user_name (), NULL);
      pipe = cockpit_pipe_spawn (argv, (const gchar **)env, NULL, FALSE);
      transport = cockpit_pipe_transport_new (pipe);
      service = cockpit_web_service_new (creds, transport);
      cockpit_creds_unref (creds);
      g_object_unref (transport);
      g_object_unref (pipe);

      g_free (value);
      g_strfreev (env);

      /* Clear the pointer automatically when service is done */
      g_object_add_weak_pointer (G_OBJECT (service), (gpointer *)&service);
    }

  if (query)
    cockpit_web_service_sideband (service, query, io_stream, headers, input);
  else
    cockpit_web_service_socket (service, io_stream, headers, input);

  /* Keeps ref on itself until it closes */
  g_object_unref (service);

  return TRUE;
}

static gboolean
on_handle_resource (CockpitWebServer *server,
                    const gchar *path,
                    GHashTable *headers,
                    CockpitWebResponse *response,
                    gpointer user_data)
{
  g_assert (g_str_has_prefix (path, "/pkg"));

  cockpit_web_response_file (response, path, FALSE,
                             cockpit_web_server_get_document_roots (server));

  return TRUE;
}

static void
server_ready (void)
{
  const gchar *roots[] = { ".", SRCDIR, NULL };
  GError *error = NULL;
  CockpitWebServer *server;
  gchar *url;

  if (!isatty (1))
    server_port = 0; /* select one automatically */
  else
    server_port = 8765;

  server = cockpit_web_server_new (server_port, /* TCP port to listen to */
                                   NULL, /* TLS cert */
                                   roots,/* Where to serve files from */
                                   NULL, /* GCancellable* */
                                   &error);
  if (server == NULL)
    {
      g_critical ("Error setting up web server: %s (%s, %d)",
                  error->message, g_quark_to_string (error->domain), error->code);
    }

  g_signal_connect (server,
                    "handle-stream",
                    G_CALLBACK (on_handle_stream_socket), NULL);
  g_signal_connect (server,
                    "handle-resource::/pkg/",
                    G_CALLBACK (on_handle_resource), NULL);
  g_signal_connect (server, "handle-resource::/mock/",
                    G_CALLBACK (on_handle_mock), NULL);

  server_port = cockpit_web_server_get_port (server);
  url = g_strdup_printf("http://localhost:%d", server_port);

  if (!isatty (1))
    {
      g_print ("%s\n", url);
    }
  else
    {
      g_print ("**********************************************************************\n"
           "Please connect a supported web browser to\n"
           "\n"
           " %s/pkg/shell/test-dbusx.html\n"
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
  g_assert_not_reached ();
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

  g_setenv ("PATH", path, TRUE);

  g_free (path);
  g_free (dir);
}

static gboolean
on_signal_done (gpointer data)
{
  g_main_loop_quit (loop);
  return TRUE;
}

int
main (int argc,
      char *argv[])
{
  GTestDBus *bus;
  GError *error = NULL;
  GOptionContext *context;
  guint sig_term;
  guint sig_int;

  GOptionEntry entries[] = {
    { NULL }
  };

  signal (SIGPIPE, SIG_IGN);
  /* avoid gvfs (http://bugzilla.gnome.org/show_bug.cgi?id=526454) */
  g_setenv ("GIO_USE_VFS", "local", TRUE);

  g_setenv ("XDG_DATA_HOME", SRCDIR "/src/bridge/mock-resource/home", TRUE);
  g_setenv ("XDG_DATA_DIRS", SRCDIR "/src/bridge/mock-resource/system", TRUE);

  setup_path (argv[0]);

  g_type_init ();

  g_log_set_always_fatal (G_LOG_LEVEL_WARNING | G_LOG_LEVEL_CRITICAL | G_LOG_LEVEL_ERROR);

  sig_term = g_unix_signal_add (SIGTERM, on_signal_done, NULL);
  sig_int = g_unix_signal_add (SIGINT, on_signal_done, NULL);

  // System cockpit configuration file should not be loaded
  cockpit_config_file = NULL;

  /* This isolates us from affecting other processes during tests */
  bus = g_test_dbus_new (G_TEST_DBUS_NONE);
  g_test_dbus_up (bus);

  context = g_option_context_new ("- test dbus json server");
  g_option_context_add_main_entries (context, entries, NULL);
  g_option_context_set_ignore_unknown_options (context, TRUE);
  if (!g_option_context_parse (context, &argc, &argv, &error))
    {
      g_printerr ("test-server: %s\n", error->message);
      exit (2);
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

  g_main_loop_run (loop);

  g_source_remove (sig_term);
  g_source_remove (sig_int);

  g_clear_object (&exported);
  g_clear_object (&exported_b);
  g_main_loop_unref (loop);

  g_test_dbus_down (bus);
  g_object_unref (bus);

  return exit_code;
}
