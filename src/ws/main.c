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

#include "cockpitcertificate.h"
#include "cockpithandlers.h"
#include "cockpitbranding.h"

#include "common/cockpitassets.h"
#include "common/cockpitconf.h"
#include "common/cockpitlog.h"
#include "common/cockpitmemory.h"
#include "common/cockpitsystem.h"
#include "common/cockpittest.h"

/* ---------------------------------------------------------------------------------------------------- */

static gint      opt_port         = 9090;
static gchar     *opt_address     = NULL;
static gboolean  opt_no_tls       = FALSE;
static gboolean  opt_for_tls_proxy    = FALSE;
static gboolean  opt_proxy_tls_redirect = FALSE;
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
  {"proxy-tls-redirect", 0, 0, G_OPTION_ARG_NONE, &opt_proxy_tls_redirect,
      "Redirect http requests to https even with --no-tls (useful for running behind a http reverse proxy)",
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

  /* Load the fail template */
  g_resources_register (cockpitassets_get_resource ());
  cockpit_web_failure_resource = "/org/cockpit-project/Cockpit/fail.html";

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
  g_autofree gchar *cert_path = NULL;
  g_autoptr(GMainLoop) loop = NULL;
  g_autofree gchar *login_html = NULL;
  g_autofree gchar *login_po_html = NULL;
  g_autoptr(CockpitWebServer) server = NULL;
  CockpitWebServerFlags server_flags = COCKPIT_WEB_SERVER_NONE;
  CockpitHandlerData data;
  int outfd = -1;

  signal (SIGPIPE, SIG_IGN);
  g_setenv ("GSETTINGS_BACKEND", "memory", TRUE);
  g_setenv ("GIO_USE_PROXY_RESOLVER", "dummy", TRUE);
  g_setenv ("GIO_USE_VFS", "local", TRUE);

  /* Any interaction with a krb5 ccache should be explicit */
  g_setenv ("KRB5CCNAME", "FILE:/dev/null", TRUE);

  g_setenv ("G_TLS_GNUTLS_PRIORITY", "SECURE128:%LATEST_RECORD_VERSION:-VERS-SSL3.0:-VERS-TLS1.0", FALSE);

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
  if (opt_for_tls_proxy && opt_proxy_tls_redirect)
    {
      g_printerr ("--for-tls-proxy (running behind a https proxy) and --proxy-tls-redirect (running behind a http proxy) are mutually exclusive");
      goto out;
    }

  if (opt_version)
    {
      print_version ();
      ret = 0;
      goto out;
    }

  if (opt_for_tls_proxy)
    opt_no_tls = TRUE;

  /*
   * This process talks on stdin/stdout. However lots of stuff wants to write
   * to stdout, such as g_debug, and uses fd 1 to do that. Reroute fd 1 so that
   * it goes to stderr, and use another fd for stdout.
   */
  outfd = dup (1);
  if (outfd < 0 || dup2 (2, 1) < 1)
    {
      g_printerr ("ws couldn't redirect stdout to stderr");
      goto out;
    }

  cockpit_set_journal_logging (NULL, !isatty (2));

  if (opt_local_session || opt_no_tls)
    {
      /* no certificate */
    }
  else
    {
      cert_path = cockpit_certificate_locate_gerror (&error);
      if (cert_path != NULL)
        certificate = cockpit_certificate_load (cert_path, &error);
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
  login_po_html = g_strdup (DATADIR "/cockpit/static/login.po.html");
  data.login_po_html = (const gchar *)login_po_html;

  if (opt_for_tls_proxy)
    server_flags |= COCKPIT_WEB_SERVER_FOR_TLS_PROXY;
  if (!cockpit_conf_bool ("WebService", "AllowUnencrypted", FALSE))
    {
      if (!opt_no_tls)
        server_flags |= COCKPIT_WEB_SERVER_REDIRECT_TLS;
      if (opt_proxy_tls_redirect)
        server_flags |= COCKPIT_WEB_SERVER_REDIRECT_TLS | COCKPIT_WEB_SERVER_REDIRECT_TLS_PROXY;
    }

  server = cockpit_web_server_new (opt_address,
                                   opt_port,
                                   certificate,
                                   server_flags,
                                   NULL,
                                   &error);
  if (server == NULL)
    {
      g_prefix_error (&error, "Error starting web server: ");
      goto out;
    }

  if (cockpit_conf_string ("WebService", "UrlRoot"))
    {
      g_object_set (server, "url-root",
                    cockpit_conf_string ("WebService", "UrlRoot"),
                    NULL);
    }
  if (cockpit_web_server_get_socket_activated (server))
    g_signal_connect_swapped (data.auth, "idling", G_CALLBACK (g_main_loop_quit), loop);

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
          pipe = cockpit_pipe_new (opt_local_session, 0, outfd);
          outfd = -1;
        }
      else
        {
          const gchar *args[] = { opt_local_session, NULL };
          pipe = cockpit_pipe_spawn (args, NULL, NULL, COCKPIT_PIPE_FLAGS_NONE);
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

  /* Debugging issues during testing */
#if WITH_DEBUG
  signal (SIGABRT, cockpit_test_signal_backtrace);
  signal (SIGSEGV, cockpit_test_signal_backtrace);
#endif

  g_main_loop_run (loop);

  ret = 0;

out:
  if (outfd >= 0)
    close (outfd);
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
