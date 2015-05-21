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

#include "common/cockpitcertificate.h"
#include "common/cockpitconf.h"
#include "common/cockpitlog.h"
#include "common/cockpitmemory.h"

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

#ifndef BRAND
static void
parse_os_release (gchar **id,
                  gchar **variant_id)
{
  GError *error = NULL;
  gchar *contents = NULL;
  gsize len;
  gchar **lines = NULL;
  guint n;
  gchar *line, *val;

  *id = NULL;
  *variant_id = NULL;

  if (!g_file_get_contents ("/etc/os-release", &contents, &len, &error))
    {
      g_message ("error loading contents of /etc/os-release: %s", error->message);
      g_error_free (error);
      goto out;
    }

  lines = g_strsplit (contents, "\n", -1);
  for (n = 0; lines != NULL && lines[n] != NULL; n++)
    {
      line = lines[n];
      val = strchr (line, '=');

      if (val)
        {
          val += 1;
          if (g_str_has_prefix (line, "ID="))
            *id = g_strdup (val);
          else if (g_str_has_prefix (line, "VARIANT_ID="))
            *variant_id = g_strdup (val);
        }
    }

 out:
  g_strfreev (lines);
  g_free (contents);
}
#endif

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
  gchar *os_id = NULL, *os_variant_id = NULL;
  gchar *branding_dirs[3];
  int i;
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

#ifdef BRAND
  roots = cockpit_web_server_resolve_roots (DATADIR "/cockpit/static",
                                            DATADIR "/cockpit/branding/" BRAND,
                                            NULL);
#else
  parse_os_release (&os_id, &os_variant_id);
  branding_dirs[0] = branding_dirs[1] = branding_dirs[2] = NULL;
  i = 0;
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
#endif

  loop = g_main_loop_new (NULL, FALSE);

  data.auth = cockpit_auth_new (opt_local_ssh);
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
  g_signal_connect (server,
                    "handle-stream",
                    G_CALLBACK (cockpit_handler_socket),
                    &data);

  g_signal_connect (server,
                    "handle-resource::/login",
                    G_CALLBACK (cockpit_handler_login),
                    &data);

  /* Don't redirect to TLS for /ping */
  g_object_set (server, "ssl-exception-prefix", "/ping", NULL);
  g_signal_connect (server, "handle-resource::/ping",
                    G_CALLBACK (cockpit_handler_ping), &data);

  g_signal_connect (server, "handle-resource::/",
                    G_CALLBACK (cockpit_handler_resource), &data);
  g_signal_connect (server, "handle-resource::/cockpit/",
                    G_CALLBACK (cockpit_handler_resource), &data);

  /* Files that cannot be cache-forever, because of well known names */
  g_signal_connect (server, "handle-resource::/favicon.ico",
                    G_CALLBACK (cockpit_handler_root), &data);
  g_signal_connect (server, "handle-resource::/apple-touch-icon.png",
                    G_CALLBACK (cockpit_handler_root), &data);

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
  g_clear_object (&certificate);
  g_free (cert_path);
  g_strfreev (roots);
  g_free (os_id);
  g_free (os_variant_id);
  g_free (branding_dirs[0]);
  g_free (branding_dirs[1]);
  g_free (branding_dirs[2]);
  cockpit_conf_cleanup ();
  return ret;
}

/* ---------------------------------------------------------------------------------------------------- */
