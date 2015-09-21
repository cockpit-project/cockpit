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

#include "cockpitws.h"
#include "cockpithandlers.h"

#include "common/cockpitassets.h"
#include "common/cockpitcertificate.h"
#include "common/cockpitconf.h"
#include "common/cockpitlog.h"
#include "common/cockpitmemory.h"
#include "common/cockpitsystem.h"

#include <libssh/libssh.h>
#include <libssh/callbacks.h>

/* ---------------------------------------------------------------------------------------------------- */

static gint      opt_port         = 9090;
static gboolean  opt_no_tls       = FALSE;
static gboolean  opt_local_ssh    = FALSE;
static gboolean  opt_version      = FALSE;

static GOptionEntry cmd_entries[] = {
  {"port", 'p', 0, G_OPTION_ARG_INT, &opt_port, "Local port to bind to (9090 if unset)", NULL},
  {"no-tls", 0, 0, G_OPTION_ARG_NONE, &opt_no_tls, "Don't use TLS", NULL},
  {"local-ssh", 0, 0, G_OPTION_ARG_NONE, &opt_local_ssh, "Log in locally via SSH", NULL },
  {"version", 0, 0, G_OPTION_ARG_NONE, &opt_version, "Print version information", NULL },
  {NULL}
};

/* ---------------------------------------------------------------------------------------------------- */

static void
print_version (void)
{
  g_print ("Version: %s\n", PACKAGE_VERSION);
  g_print ("Protocol: 1\n");
  g_print ("Authorization: crypt1\n");
}

static gchar **
calculate_static_roots (GHashTable *os_release)
{
  const gchar *os_id = NULL;
  const gchar *os_variant_id = NULL;
  gchar *branding_dirs[3] = { NULL, };
  gchar **roots;
  gint i = 0;

#ifdef PACKAGE_BRAND
  os_id = PACKAGE_BRAND;
#else
  if (os_release)
    {
      os_id = g_hash_table_lookup (os_release, "ID");
      os_variant_id = g_hash_table_lookup (os_release, "VARIANT_ID");
    }
#endif

  if (os_id)
    {
      if (os_variant_id)
          branding_dirs[i++] = g_strdup_printf (DATADIR "/cockpit/branding/%s-%s", os_id, os_variant_id);
      branding_dirs[i++] = g_strdup_printf (DATADIR "/cockpit/branding/%s", os_id);
    }
  branding_dirs[i++] = g_strdup (DATADIR "/cockpit/branding/default");
  g_assert (i <= 3);

  roots = cockpit_web_server_resolve_roots (DATADIR "/cockpit/static",
                                            branding_dirs[0],
                                            branding_dirs[1],
                                            branding_dirs[2],
                                            NULL);

  g_free (branding_dirs[0]);
  g_free (branding_dirs[1]);
  g_free (branding_dirs[2]);

  /* Allow branding symlinks to escape these roots into /usr/share/pixmaps */
  cockpit_web_exception_escape_root = "/usr/share/pixmaps";

  /* Load the fail template */
  g_resources_register (cockpitassets_get_resource ());
  cockpit_web_failure_resource = "/org/cockpit-project/Cockpit/fail.html";

  return roots;
}

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
  gchar *cert_path = NULL;
  GMainLoop *loop = NULL;

  signal (SIGPIPE, SIG_IGN);
  g_setenv ("GSETTINGS_BACKEND", "memory", TRUE);
  g_setenv ("GIO_USE_PROXY_RESOLVER", "dummy", TRUE);
  g_setenv ("GIO_USE_VFS", "local", TRUE);

  /* Any interaction with a krb5 ccache should be explicit */
  g_setenv ("KRB5CCNAME", "FILE:/dev/null", TRUE);

  g_setenv ("G_TLS_GNUTLS_PRIORITY", "SECURE128:%LATEST_RECORD_VERSION:-VERS-SSL3.0:-VERS-TLS1.0", FALSE);

  g_type_init ();

  ssh_threads_set_callbacks (ssh_threads_get_pthread());
  ssh_init ();

  memset (&data, 0, sizeof (data));

  context = g_option_context_new (NULL);
  g_option_context_add_main_entries (context, cmd_entries, NULL);

  if (!g_option_context_parse (context, &argc, &argv, error))
    {
      goto out;
    }

  if (opt_version)
    {
      print_version ();
      ret = 0;
      goto out;
    }

  cockpit_set_journal_logging (NULL, !isatty (2));

  if (opt_no_tls)
    {
      /* no certificate */
    }
  else
    {
      cert_path = cockpit_certificate_locate (FALSE, error);
      if (cert_path != NULL)
        certificate = cockpit_certificate_load (cert_path, error);
      if (certificate == NULL)
        goto out;
      g_info ("Using certificate: %s", cert_path);
    }

  loop = g_main_loop_new (NULL, FALSE);

  data.os_release = cockpit_system_load_os_release ();
  data.auth = cockpit_auth_new (opt_local_ssh);
  roots = calculate_static_roots (data.os_release);
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

  if (cockpit_web_server_get_socket_activated (server))
    g_signal_connect_swapped (data.auth, "idling", G_CALLBACK (g_main_loop_quit), loop);

  /* Ignores stuff it shouldn't handle */
  g_signal_connect (server, "handle-stream",
                    G_CALLBACK (cockpit_handler_socket), &data);

  /* Don't redirect to TLS for /ping */
  g_object_set (server, "ssl-exception-prefix", "/ping", NULL);
  g_signal_connect (server, "handle-resource::/ping",
                    G_CALLBACK (cockpit_handler_ping), &data);

  /* Files that cannot be cache-forever, because of well known names */
  g_signal_connect (server, "handle-resource::/favicon.ico",
                    G_CALLBACK (cockpit_handler_root), &data);
  g_signal_connect (server, "handle-resource::/apple-touch-icon.png",
                    G_CALLBACK (cockpit_handler_root), &data);

  /* The fallback handler for everything else */
  g_signal_connect (server, "handle-resource",
                    G_CALLBACK (cockpit_handler_default), &data);

  g_main_loop_run (loop);

  ret = 0;

out:
  if (loop)
    g_main_loop_unref (loop);
  if (local_error)
    {
      g_printerr ("cockpit-ws: %s\n", local_error->message);
      g_error_free (local_error);
    }
  g_clear_object (&server);
  g_clear_object (&data.auth);
  if (data.os_release)
    g_hash_table_unref (data.os_release);
  g_clear_object (&certificate);
  g_free (cert_path);
  g_strfreev (roots);
  cockpit_conf_cleanup ();
  return ret;
}

/* ---------------------------------------------------------------------------------------------------- */
