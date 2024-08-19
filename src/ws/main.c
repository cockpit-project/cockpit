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

#include <gio/gio.h>
#include <glib-unix.h>
#include <glib/gstdio.h>

#include <dirent.h>
#include <string.h>

#include <systemd/sd-daemon.h>

#include "cockpitws.h"

#include "cockpithandlers.h"
#include "cockpitbranding.h"

#include "common/cockpitconf.h"
#include "common/cockpithacks-glib.h"
#include "common/cockpitmemory.h"
#include "common/cockpitsystem.h"
#include "common/cockpitwebcertificate.h"

/* ---------------------------------------------------------------------------------------------------- */

static gint      opt_port         = 9090;
static gchar     *opt_address     = NULL;
static gboolean  opt_no_tls       = FALSE;
static gboolean  opt_for_tls_proxy    = FALSE;
static gboolean  opt_local_ssh    = FALSE;
static gchar     *opt_local_session = NULL;
static gboolean  opt_version      = FALSE;

static GOptionEntry cmd_entries[] = {
  {"port", 'p', 0, G_OPTION_ARG_INT, &opt_port, "Local port to bind to (9090 if unset)", NULL},
  {"address", 'a', 0, G_OPTION_ARG_STRING, &opt_address, "Address to bind to (binds on all addresses if unset)", "ADDRESS"},
  {"no-tls", 0, 0, G_OPTION_ARG_NONE, &opt_no_tls, "Don't use TLS", NULL},
  {"for-tls-proxy", 0, 0, G_OPTION_ARG_NONE, &opt_for_tls_proxy,
      "Act behind a https-terminating proxy: accept only https:// origins by default",
      NULL},
  {"local-ssh", 0, 0, G_OPTION_ARG_NONE, &opt_local_ssh, "Log in locally via SSH", NULL },
  {"local-session", 0, 0, G_OPTION_ARG_STRING, &opt_local_session,
      "Launch a bridge in the local session (path to cockpit-bridge or '-' for stdin/out); implies --no-tls",
      "BRIDGE" },
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
setup_static_roots (GHashTable *os_release)
{
  gchar **roots;
  const gchar *os_variant_id;
  const gchar *os_id;
  const gchar *os_id_like;

  if (os_release)
    {
      os_id = g_hash_table_lookup (os_release, "ID");
      os_variant_id = g_hash_table_lookup (os_release, "VARIANT_ID");
      os_id_like = g_hash_table_lookup (os_release, "ID_LIKE");
    }
  else
    {
      os_id = NULL;
      os_variant_id = NULL;
      os_id_like = NULL;
    }

  roots = cockpit_branding_calculate_static_roots (os_id, os_variant_id, os_id_like, TRUE);

  return roots;
}

static void
on_local_ready (GObject *object,
                GAsyncResult *result,
                gpointer data)
{
  cockpit_web_server_start (COCKPIT_WEB_SERVER (data));
  g_object_unref (data);
}

int
main (int argc,
      char *argv[])
{
  gint ret = 1;
  g_autoptr(GOptionContext) context = NULL;
  g_autoptr(GTlsCertificate) certificate = NULL;
  g_autoptr(GError) error = NULL;
  g_auto(GStrv) roots = NULL;
  g_autoptr(GMainLoop) loop = NULL;
  g_autofree gchar *login_html = NULL;
  g_autofree gchar *login_po_js = NULL;
  g_autoptr(CockpitWebServer) server = NULL;
  CockpitWebServerFlags server_flags = COCKPIT_WEB_SERVER_NONE;
  CockpitHandlerData data;

  signal (SIGPIPE, SIG_IGN);
  cockpit_setenv_check ("GSETTINGS_BACKEND", "memory", TRUE);
  cockpit_setenv_check ("GIO_USE_PROXY_RESOLVER", "dummy", TRUE);
  cockpit_setenv_check ("GIO_USE_VFS", "local", TRUE);

  /* Any interaction with a krb5 ccache should be explicit */
  cockpit_setenv_check ("KRB5CCNAME", "FILE:/dev/null", TRUE);

  memset (&data, 0, sizeof (data));

  context = g_option_context_new (NULL);
  g_option_context_add_main_entries (context, cmd_entries, NULL);
  if (!g_option_context_parse (context, &argc, &argv, &error))
    goto out;

  /* check mutually exclusive options */
  if (opt_for_tls_proxy && opt_no_tls)
    {
      g_printerr ("--for-tls-proxy and --no-tls are mutually exclusive");
      goto out;
    }

  if (opt_version)
    {
      print_version ();
      ret = 0;
      goto out;
    }

  if (opt_for_tls_proxy || cockpit_conf_bool ("WebService", "X-For-CockpitClient", FALSE))
    opt_no_tls = TRUE;

  cockpit_hacks_redirect_gdebug_to_stderr ();

  if (opt_local_session || opt_no_tls)
    {
      /* no certificate */
    }
  else
    {
      g_autofree char *message = NULL;
      g_autofree gchar *cert_path = cockpit_certificate_locate (false, &message);
      if (cert_path == NULL)
        {
          g_set_error_literal (&error, G_IO_ERROR, G_IO_ERROR_NOT_FOUND, message);
          goto out;
        }

      g_autofree gchar *key_path = cockpit_certificate_key_path (cert_path);

      certificate = g_tls_certificate_new_from_files (cert_path, key_path, &error);
      if (certificate == NULL)
        goto out;
      g_info ("Using certificate: %s", cert_path);
    }

  loop = g_main_loop_new (NULL, FALSE);

  data.os_release = cockpit_system_load_os_release ();
  data.auth = cockpit_auth_new (opt_local_ssh, opt_for_tls_proxy ? COCKPIT_AUTH_FOR_TLS_PROXY : COCKPIT_AUTH_NONE);
  roots = setup_static_roots (data.os_release);

  data.branding_roots = (const gchar **)roots;
  login_html = g_strdup (DATADIR "/cockpit/static/login.html");
  data.login_html = (const gchar *)login_html;
  login_po_js = g_strdup (DATADIR "/cockpit/static/po.js");
  data.login_po_js = (const gchar *)login_po_js;

  if (opt_for_tls_proxy)
    server_flags |= COCKPIT_WEB_SERVER_FOR_TLS_PROXY;
  if (!cockpit_conf_bool ("WebService", "AllowUnencrypted", FALSE))
    {
      if (!opt_no_tls)
        server_flags |= COCKPIT_WEB_SERVER_REDIRECT_TLS;
    }

  server = cockpit_web_server_new (certificate, server_flags);

  const gint n_listen_fds = sd_listen_fds (true);
  if (n_listen_fds)
    {
      for (gint fd = SD_LISTEN_FDS_START; fd < SD_LISTEN_FDS_START + n_listen_fds; fd++)
        if (!cockpit_web_server_add_fd_listener (server, fd, &error))
          {
            g_prefix_error (&error, "Unable to acquire LISTEN_FDS: ");
            goto out;
          }

      g_signal_connect_swapped (data.auth, "idling", G_CALLBACK (g_main_loop_quit), loop);
    }
  else
    {
      if (!cockpit_web_server_add_inet_listener (server, opt_address, opt_port, &error))
        {
          g_prefix_error (&error, "Error starting web server: ");
          goto out;
        }
    }

  if (cockpit_conf_string ("WebService", "UrlRoot"))
    {
      g_object_set (server, "url-root",
                    cockpit_conf_string ("WebService", "UrlRoot"),
                    NULL);
    }

  cockpit_web_server_set_protocol_header (server, cockpit_conf_string ("WebService", "ProtocolHeader"));
  cockpit_web_server_set_forwarded_for_header (server, cockpit_conf_string ("WebService", "ForwardedForHeader"));

  /* Ignores stuff it shouldn't handle */
  g_signal_connect (server, "handle-stream",
                    G_CALLBACK (cockpit_handler_socket), &data);

  /* External channels, ignore stuff they shouldn't handle */
  g_signal_connect (server, "handle-stream",
                    G_CALLBACK (cockpit_handler_external), &data);

  /* Don't redirect to TLS for /ping */
  g_object_set (server, "ssl-exception-prefix", "/ping", NULL);
  g_signal_connect (server, "handle-resource::/ping",
                    G_CALLBACK (cockpit_handler_ping), &data);

  /* Files that cannot be cache-forever, because of well known names */
  g_signal_connect (server, "handle-resource::/favicon.ico",
                    G_CALLBACK (cockpit_handler_root), &data);
  g_signal_connect (server, "handle-resource::/apple-touch-icon.png",
                    G_CALLBACK (cockpit_handler_root), &data);
  g_signal_connect (server, "handle-resource::/ca.cer",
                    G_CALLBACK (cockpit_handler_ca_cert), &data);

  /* The fallback handler for everything else */
  g_signal_connect (server, "handle-resource",
                    G_CALLBACK (cockpit_handler_default), &data);

  if (opt_local_session)
    {
      g_autoptr(CockpitPipe) pipe = NULL;
      struct passwd *pwd;

      if (g_str_equal (opt_local_session, "-"))
        {
          pipe = cockpit_pipe_new (opt_local_session, 0, 1);
        }
      else
        {
          g_auto(GStrv) args = NULL;
          if (!g_shell_parse_argv (opt_local_session, NULL, &args, &error))
            {
              g_prefix_error (&error, "--local-session: ");
              goto out;
            }
          pipe = cockpit_pipe_spawn ((const gchar **) args, NULL, NULL, COCKPIT_PIPE_FLAGS_NONE);
        }

      /* Spawn a local session as a bridge */
      pwd = getpwuid (geteuid ());
      if (!pwd)
        {
          g_printerr ("Failed to resolve current user id %u\n", geteuid ());
          goto out;
        }
      cockpit_auth_local_async (data.auth, pwd->pw_name, pipe, on_local_ready, g_object_ref (server));
    }
  else
    {
      /* When no local bridge, start serving immediately */
      cockpit_web_server_start (server);
    }

  g_main_loop_run (loop);

  ret = 0;

out:
  if (error)
    g_printerr ("cockpit-ws: %s\n", error->message);
  g_clear_object (&data.auth);
  if (data.os_release)
    g_hash_table_unref (data.os_release);
  g_free (opt_address);
  g_free (opt_local_session);
  cockpit_conf_cleanup ();
  return ret;
}

/* ---------------------------------------------------------------------------------------------------- */
