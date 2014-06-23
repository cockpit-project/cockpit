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

#include "cockpit/mock-service.h"
#include "lib/valgrind.h"

#include <gio/gio.h>
#include <glib-unix.h>
#include <glib/gstdio.h>
#include <string.h>

#include "cockpitws.h"
#include "cockpitwebserver.h"
#include "cockpitwebservice.h"

static gboolean tap_mode = FALSE;
static GMainLoop *loop = NULL;
static int exit_code = 0;

/* ---------------------------------------------------------------------------------------------------- */

static GObject *exported = NULL;
static GObject *exported_b = NULL;

static void
on_bus_acquired (GDBusConnection *connection,
                 const gchar *name,
                 gpointer user_data)
{
  exported = mock_service_create_and_export (connection, "/otree");
  exported_b = mock_service_create_and_export (connection, "/different");
}

/* ---------------------------------------------------------------------------------------------------- */

/* Called by @server when handling HTTP requests to /socket - runs in a separate
 * thread dedicated to the request so it may do blocking I/O
 */
static gboolean
on_handle_stream_socket (CockpitWebServer *server,
                         CockpitWebServerRequestType reqtype,
                         const gchar *resource,
                         GIOStream *io_stream,
                         GHashTable *headers,
                         GByteArray *input,
                         guint in_length,
                         gpointer user_data)
{
  CockpitWebService *service;
  CockpitCreds *creds;

  if (!g_str_equal (resource, "/socket"))
    return FALSE;

  creds = cockpit_creds_new (g_get_user_name (), NULL);

  service = cockpit_web_service_new (creds, NULL);

  cockpit_web_service_socket (service, io_stream, headers, input);

  /* Keeps ref on itself until it closes */
  g_object_unref (service);

  cockpit_creds_unref (creds);
  return TRUE;
}

static void
on_phantomjs_exited (GPid pid,
                     gint status,
                     gpointer user_data)
{
  GError *error = NULL;

  if (!g_spawn_check_exit_status (status, &error))
    {
      g_critical ("phantomjs: %s", error->message);
      g_error_free (error);
      exit_code = 1;
    }

  g_main_loop_quit (loop);
  g_spawn_close_pid (pid);
}

static void
server_ready (void)
{
  const gchar *roots[] = { ".", SRCDIR, NULL };
  GError *error = NULL;
  CockpitWebServer *server;
  gchar *args[5];
  gint port;
  gchar *url;
  GPid pid;

  if (tap_mode)
    port = 0; /* select one automatically */
  else
    port = 8765;

  server = cockpit_web_server_new (port, /* TCP port to listen to */
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

  g_object_get (server, "port", &port, NULL);
  url = g_strdup_printf("http://localhost:%d/modules/shell/dbus-test.html", port);

  if (tap_mode)
    {
      /* When TAP, we run phantomjs on the tests, with qunit-tap */
      args[0] = "phantomjs";
      args[1] = SRCDIR "/tools/tap-phantom";
      args[2] = url;
      args[3] = NULL;
      g_spawn_async (NULL, args, NULL, G_SPAWN_SEARCH_PATH | G_SPAWN_DO_NOT_REAP_CHILD,
                     NULL, NULL, &pid, &error);

      if (error == NULL)
        {
          g_child_watch_add (pid, on_phantomjs_exited, NULL);
        }
      else if (g_error_matches (error, G_SPAWN_ERROR, G_SPAWN_ERROR_NOENT))
        {
          /*
           * No phantomjs available? Tell TAP harness we're bailing out.
           *
           * Unfortunately we can't tell TAP harness how many tests would
           * have been run, because we don't know ... not even QUnit knows :S
           * So this'll say we skipped one test, when we actually skipped
           * many more.
           */
          g_print ("Bail out! - phantomjs is not available\n");
          g_main_loop_quit (loop);
          g_error_free (error);
        }
      else
        {
          g_warning ("Couldn't launch phantomjs: %s", error->message);
          g_error_free (error);
        }
    }
  else
    {
      g_print ("**********************************************************************\n"
           "Please connect a supported web browser to\n"
           "\n"
           " %s\n"
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
cd_binarydir (const char *argv0)
{
  gchar *dir = g_path_get_dirname (argv0);
  g_warn_if_fail (g_chdir (dir) == 0);
  g_free (dir);
}

int
main (int argc,
      char *argv[])
{
  GTestDBus *bus;
  GError *error = NULL;
  GOptionContext *context;
  guint id = -1;
  guint id_b = -1;

  GOptionEntry entries[] = {
    { "tap", 0, 0, G_OPTION_ARG_NONE, &tap_mode, "Automatically run tests in terminal", NULL },
    { NULL }
  };

  signal(SIGPIPE, SIG_IGN);

  /* avoid gvfs (http://bugzilla.gnome.org/show_bug.cgi?id=526454) */
  g_setenv ("GIO_USE_VFS", "local", TRUE);

  g_type_init ();

  g_log_set_always_fatal (G_LOG_LEVEL_WARNING | G_LOG_LEVEL_CRITICAL | G_LOG_LEVEL_ERROR);

  /* This is how tap-gtester runs us */
  if (g_getenv ("HARNESS_ACTIVE"))
    {
      /* We don't run phantomjs under valgrind */
      if (RUNNING_ON_VALGRIND)
        {
          g_print ("Bail out! - not running phantomjs under valgrind\n");
          return 0;
        }
      tap_mode = TRUE;
    }

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

  cd_binarydir (argv[0]);

  /* Just execute the agent, no session necessary */
  cockpit_ws_session_program = "./test-agent";

  loop = g_main_loop_new (NULL, FALSE);

  id = g_bus_own_name (G_BUS_TYPE_SESSION,
                       "com.redhat.Cockpit.DBusTests.Test",
                       G_BUS_NAME_OWNER_FLAGS_ALLOW_REPLACEMENT | G_BUS_NAME_OWNER_FLAGS_REPLACE,
                       on_bus_acquired,
                       on_name_acquired,
                       on_name_lost,
                       loop,
                       NULL);

  id_b = g_bus_own_name (G_BUS_TYPE_SESSION,
                         "com.redhat.Cockpit.DBusTests.Second",
                         G_BUS_NAME_OWNER_FLAGS_ALLOW_REPLACEMENT | G_BUS_NAME_OWNER_FLAGS_REPLACE,
                         NULL,
                         on_second_acquired,
                         on_name_lost,
                         loop,
                         NULL);

  g_main_loop_run (loop);

  g_clear_object (&exported);
  g_clear_object (&exported_b);
  g_bus_unown_name (id);
  g_bus_unown_name (id_b);
  g_main_loop_unref (loop);

  g_test_dbus_down (bus);
  g_object_unref (bus);

  return exit_code;
}
