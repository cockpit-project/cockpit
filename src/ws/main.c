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

#include <dirent.h>

#include <cockpit/cockpit.h>

#include <gsystem-local-alloc.h>

#include "cockpitws.h"
#include "cockpithandlers.h"

/* ---------------------------------------------------------------------------------------------------- */

static gint      opt_port         = 21064;
static gchar   **opt_http_roots   = NULL;
static gboolean  opt_no_tls       = FALSE;
static gboolean  opt_disable_auth = FALSE;
static gboolean  opt_debug = FALSE;
static gchar    *opt_agent_program;

static GOptionEntry cmd_entries[] = {
  {"port", 'p', 0, G_OPTION_ARG_INT, &opt_port, "Local port to bind to (21064 if unset)", NULL},
  {"http-root", 0, 0, G_OPTION_ARG_FILENAME_ARRAY, &opt_http_roots, "Path to serve HTTP GET requests from", NULL},
  {"no-tls", 0, 0, G_OPTION_ARG_NONE, &opt_no_tls, "Don't use TLS", NULL},
  {"debug", 'd', 0, G_OPTION_ARG_NONE, &opt_debug, "Debug mode: log messages to output", NULL},
#ifdef WITH_DEBUG
  {"no-auth", 0, 0, G_OPTION_ARG_NONE, &opt_disable_auth, "Don't require authentication", NULL},
  {"agent-path", 0, 0, G_OPTION_ARG_FILENAME, &opt_agent_program, "Change path to agent program", NULL},
#endif
  {NULL}
};

/* ---------------------------------------------------------------------------------------------------- */

static gchar *
generate_temp_cert (GError **error)
{
  const gchar *dir = PACKAGE_LOCALSTATE_DIR "/lib/cockpit";
  gchar *cert_path = NULL;
  gchar *stdout_str = NULL;
  gchar *stderr_str = NULL;
  gchar *command_line = NULL;
  gchar *ret = NULL;
  gint exit_status;

  cert_path = g_strdup_printf ("%s/temp-self-signed.cert", dir);

  /* Generate self-signed cert, if it does not exist */
  if (g_file_test (cert_path, G_FILE_TEST_EXISTS))
    {
      ret = cert_path;
      cert_path = NULL;
      goto out;
    }

  if (g_mkdir_with_parents (dir, 0700) != 0)
    {
      g_set_error (error,
                   G_IO_ERROR,
                   G_IO_ERROR_FAILED,
                   "Error creating directory `%s': %m",
                   dir);
      goto out;
    }

  command_line = g_strdup_printf ("/etc/pki/tls/certs/make-dummy-cert %s", cert_path);

  g_info ("Generating temporary certificate using (command_line: `%s')",
          command_line);

  if (!g_spawn_command_line_sync (command_line,
                                  &stdout_str, /* standard_output */
                                  &stderr_str, /* standard_error */
                                  &exit_status,
                                  error))
    {
      g_prefix_error (error,
                      "Error generating temporary self-signed dummy cert using command-line `%s': ",
                      command_line);
      goto out;
    }

  if (!(WIFEXITED (exit_status) && exit_status == 0))
    {
      g_set_error (error,
                   G_IO_ERROR,
                   G_IO_ERROR_FAILED,
                   "Error generating temporary self-signed dummy cert: command-line `%s' did exit as expected: stdout=`%s' stderr=`%s'",
                   command_line,
                   stdout_str,
                   stderr_str);
      goto out;
    }

  ret = cert_path;
  cert_path = NULL;

out:
  g_free (cert_path);
  g_free (command_line);
  g_free (stdout_str);
  g_free (stderr_str);
  return ret;
}

static gint
ptr_strcmp (const gchar **a,
            const gchar **b)
{
  return g_strcmp0 (*a, *b);
}

static gchar *
load_cert_from_dir (const gchar *dir_name,
                    GError **error)
{
  gchar *ret = NULL;
  GDir *dir;
  const gchar *name;
  GPtrArray *p;

  p = g_ptr_array_new ();

  dir = g_dir_open (dir_name, 0, error);
  if (dir == NULL)
    goto out;

  while ((name = g_dir_read_name (dir)) != NULL)
    {
      if (!g_str_has_suffix (name, ".cert"))
        continue;
      g_ptr_array_add (p, g_strdup_printf ("%s/%s", dir_name, name));
    }

  g_ptr_array_sort (p, (GCompareFunc)ptr_strcmp);

  if (p->len > 0)
    {
      ret = p->pdata[p->len - 1];
      p->pdata[p->len - 1] = NULL;
    }

out:
  if (dir != NULL)
    g_dir_close (dir);
  g_ptr_array_foreach (p, (GFunc)g_free, NULL);
  g_ptr_array_free (p, TRUE);
  return ret;
}

static gboolean
load_cert (GTlsCertificate **out_cert,
           GError **error)
{
  GTlsCertificate *cert = NULL;
  gboolean ret = FALSE;
  gchar *cert_path = NULL;
  const gchar *cert_dir = PACKAGE_SYSCONF_DIR "/cockpit/ws-certs.d";
  GError *local_error;

  local_error = NULL;
  cert_path = load_cert_from_dir (cert_dir, &local_error);
  if (local_error != NULL)
    {
      g_propagate_prefixed_error (error, local_error,
                                  "Error loading certificates from %s: ",
                                  cert_dir);
      goto out;
    }

  /* Could be there's no certicate at all, so cert_path can indeed be
   * NULL. If so, use (and possibly generate) a temporary self-signed
   * certificate
   */
  if (cert_path == NULL)
    {
      cert_path = generate_temp_cert (error);
      if (cert_path == NULL)
        goto out;
    }

  cert = g_tls_certificate_new_from_file (cert_path, error);
  if (cert == NULL)
    {
      g_prefix_error (error, "Error loading certificate at path `%s': ", cert_path);
      goto out;
    }

  g_info ("Using certificate %s", cert_path);

  if (out_cert != NULL)
    {
      *out_cert = cert;
      cert = NULL;
    }

  ret = TRUE;

out:
  g_clear_object (&cert);
  g_free (cert_path);
  return ret;
}

/* ---------------------------------------------------------------------------------------------------- */

int
main (int argc,
      char *argv[])
{
  const gchar *default_roots[] = { PACKAGE_DATA_DIR "/cockpit/content", NULL };
  gint ret = 1;
  CockpitWebServer *server = NULL;
  GOptionContext *context;
  CockpitHandlerData data;
  GError *local_error = NULL;
  GError **error = &local_error;
  GMainLoop *loop;

  g_setenv ("GSETTINGS_BACKEND", "memory", TRUE);
  g_setenv ("GIO_USE_PROXY_RESOLVER", "dummy", TRUE);
  g_setenv ("GIO_USE_VFS", "local", TRUE);

  g_type_init ();

  memset (&data, 0, sizeof (data));

  context = g_option_context_new (NULL);
  g_option_context_add_main_entries (context, cmd_entries, NULL);

  if (!g_option_context_parse (context, &argc, &argv, error))
    {
      goto out;
    }

  if (!opt_debug)
    cockpit_set_journal_logging ();

  if (opt_http_roots == NULL)
    opt_http_roots = g_strdupv ((gchar **)default_roots);

  if (opt_no_tls)
    {
      /* no certificate */
    }
  else
    {
      if (!load_cert (&data.certificate, error))
        goto out;
    }

  if (!opt_disable_auth)
    data.auth = cockpit_auth_new ();

  data.system_bus = g_bus_get_sync (G_BUS_TYPE_SYSTEM, NULL, error);
  if (data.system_bus == NULL)
    {
      g_prefix_error (error, "Error getting system bus: ");
      goto out;
    }
  data.agent_program = opt_agent_program;

  server = cockpit_web_server_new (opt_port,
                                   data.certificate,
                                   (const gchar **)opt_http_roots,
                                   NULL,
                                   error);
  if (server == NULL)
    {
      g_prefix_error (error, "Error starting web server: ");
      goto out;
    }

  /* Ignores stuff it shouldn't handle */
  g_signal_connect (server,
                    "handle-resource",
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
                    "handle-resource::/cockpitdyn.js",
                    G_CALLBACK (cockpit_handler_cockpitdyn),
                    &data);

  g_info ("HTTP Server listening on port %d", opt_port);

  loop = g_main_loop_new (NULL, FALSE);
  g_main_loop_run (loop);
  g_main_loop_unref (loop);

  ret = 0;

out:
  g_strfreev (opt_http_roots);
  g_free (opt_agent_program);
  if (local_error)
    {
      g_printerr ("%s (%s, %d)\n", local_error->message, g_quark_to_string (local_error->domain), local_error->code);
      g_error_free (local_error);
    }
  g_clear_object (&server);
  g_clear_object (&data.auth);
  g_clear_object (&data.system_bus);
  g_clear_object (&data.certificate);
  return ret;
}

/* ---------------------------------------------------------------------------------------------------- */
