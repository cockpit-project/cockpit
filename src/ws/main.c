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

#include <gio/gio.h>
#include <glib-unix.h>
#include <glib/gstdio.h>

#include <dirent.h>
#include <string.h>

#include <gsystem-local-alloc.h>

#include "cockpitws.h"
#include "cockpithandlers.h"

#include "common/cockpitcertificate.h"
#include "common/cockpitlog.h"
#include "common/cockpitmemory.h"

#include <libssh/libssh.h>

/* ---------------------------------------------------------------------------------------------------- */

static gint      opt_port         = 1001;
static gboolean  opt_no_tls       = FALSE;
static gboolean  opt_uninstalled = FALSE;

static GOptionEntry cmd_entries[] = {
  {"port", 'p', 0, G_OPTION_ARG_INT, &opt_port, "Local port to bind to (1001 if unset)", NULL},
  {"no-tls", 0, 0, G_OPTION_ARG_NONE, &opt_no_tls, "Don't use TLS", NULL},
#ifdef WITH_DEBUG
  {"uninstalled", 0, 0, G_OPTION_ARG_NONE, &opt_uninstalled, "Run from cockpit-ws from build directory", NULL},
#endif
  {NULL}
};

/* ---------------------------------------------------------------------------------------------------- */

int
main (int argc,
      char *argv[])
{
  gint ret = 1;
  CockpitWebServer *server = NULL;
  GOptionContext *context;
  CockpitHandlerData data;
  GTlsCertificate *certificate = NULL;
  GError *local_error = NULL;
  GError **error = &local_error;
  gchar **roots = NULL;
  GMainLoop *loop;

  signal (SIGPIPE, SIG_IGN);
  g_setenv ("GSETTINGS_BACKEND", "memory", TRUE);
  g_setenv ("GIO_USE_PROXY_RESOLVER", "dummy", TRUE);
  g_setenv ("GIO_USE_VFS", "local", TRUE);

  g_type_init ();
  ssh_init ();

  memset (&data, 0, sizeof (data));

  context = g_option_context_new (NULL);
  g_option_context_add_main_entries (context, cmd_entries, NULL);

  if (!g_option_context_parse (context, &argc, &argv, error))
    {
      goto out;
    }

  cockpit_set_journal_logging (!isatty (2));

  if (opt_no_tls)
    {
      /* no certificate */
    }
  else
    {
      if (!cockpit_certificate_locate (&certificate, error))
        goto out;
    }

  if (opt_uninstalled)
    {
      roots = cockpit_web_server_resolve_roots (SRCDIR "/src/static", SRCDIR "/lib", NULL);
      cockpit_ws_agent_program = BUILDDIR "/cockpit-agent";
      cockpit_ws_session_program = BUILDDIR "/cockpit-session";
    }
  else
    {
      roots = cockpit_web_server_resolve_roots (PACKAGE_DATA_DIR "/static", NULL);
    }

  data.auth = cockpit_auth_new ();
  data.static_roots = (const gchar **)roots;

  server = cockpit_web_server_new (opt_port,
                                   certificate,
                                   NULL,
                                   NULL,
                                   error);
  if (server == NULL)
    {
      g_prefix_error (error, "Error starting web server: ");
      goto out;
    }

  /* Ignores stuff it shouldn't handle */
  g_signal_connect (server,
                    "handle-stream",
                    G_CALLBACK (cockpit_handler_socket),
                    &data);

  g_signal_connect (server,
                    "handle-resource::/login",
                    G_CALLBACK (cockpit_handler_login),
                    &data);
  g_signal_connect (server,
                    "handle-resource::/logout",
                    G_CALLBACK (cockpit_handler_logout),
                    &data);
  g_signal_connect (server,
                    "handle-resource::/deauthorize",
                    G_CALLBACK (cockpit_handler_deauthorize),
                    &data);

  /* Don't redirect to TLS for /ping */
  g_object_set (server, "ssl-exception-prefix", "/ping", NULL);
  g_signal_connect (server, "handle-resource::/ping",
                    G_CALLBACK (cockpit_handler_ping), &data);

  g_signal_connect (server,
                    "handle-resource::/",
                    G_CALLBACK (cockpit_handler_index),
                    &data);

  g_signal_connect (server, "handle-resource::/static/",
                    G_CALLBACK (cockpit_handler_static), &data);
  g_signal_connect (server, "handle-resource::/cache/",
                    G_CALLBACK (cockpit_handler_resource), &data);
  g_signal_connect (server, "handle-resource::/res/",
                    G_CALLBACK (cockpit_handler_resource), &data);

  /* Files that cannot be cache-forever, because of well known names */
  g_signal_connect (server, "handle-resource::/favicon.ico",
                    G_CALLBACK (cockpit_handler_root), &data);
  g_signal_connect (server, "handle-resource::/apple-touch-icon.png",
                    G_CALLBACK (cockpit_handler_root), &data);

  g_info ("HTTP Server listening on port %d", opt_port);

  loop = g_main_loop_new (NULL, FALSE);
  g_main_loop_run (loop);
  g_main_loop_unref (loop);

  ret = 0;

out:
  if (local_error)
    {
      g_printerr ("cockpit-ws: %s\n", local_error->message);
      g_error_free (local_error);
    }
  g_clear_object (&server);
  g_clear_object (&data.auth);
  g_clear_object (&certificate);
  g_strfreev (roots);
  return ret;
}

/* ---------------------------------------------------------------------------------------------------- */
