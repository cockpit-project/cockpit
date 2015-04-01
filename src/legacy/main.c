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

#include "types.h"
#include "daemon.h"

/* ---------------------------------------------------------------------------------------------------- */

static GMainLoop *loop = NULL;

static gboolean  name_acquired;
static gboolean  opt_replace = FALSE;
static gboolean  opt_no_sigint = FALSE;

static GOptionEntry opt_entries[] =
{
  {"replace", 'r', 0, G_OPTION_ARG_NONE, &opt_replace, "Replace existing daemon", NULL},
  {"no-sigint", 's', 0, G_OPTION_ARG_NONE, &opt_no_sigint, "Do not handle SIGINT for controlled shutdown", NULL},
  {NULL }
};

static Daemon *the_daemon = NULL;

static void
on_bus_acquired (GDBusConnection *connection,
                 const gchar *name,
                 gpointer user_data)
{
  g_debug ("acquired message bus");
  the_daemon = daemon_new (connection);
}

static void
on_name_lost (GDBusConnection *connection,
              const gchar *name,
              gpointer user_data)
{
  if (the_daemon == NULL)
    {
      g_warning ("Failed to connect to the message bus");
    }
  else if (name_acquired)
    {
      g_message ("Lost the name %s on the session message bus", name);
    }
  else
    {
      g_message ("Failed to acquire the name %s on the session message bus", name);
    }
  g_main_loop_quit (loop);
}

static void
on_name_acquired (GDBusConnection *connection,
                  const gchar *name,
                  gpointer user_data)
{
  name_acquired = TRUE;
  g_debug ("Acquired the name %s on the session message bus", name);
}

static gboolean
on_sigint (gpointer user_data)
{
  g_message ("Caught SIGINT. Initiating shutdown");
  g_main_loop_quit (loop);
  return TRUE;
}

int
main (int argc,
      char **argv)
{
  GError *error;
  GOptionContext *opt_context;
  gint ret;
  guint name_owner_id;
  guint sigint_id;

  ret = 1;
  loop = NULL;
  opt_context = NULL;
  name_owner_id = 0;
  sigint_id = 0;

  /* Ignore SIGPIPE, it's not useful in daemons */
  signal (SIGPIPE, SIG_IGN);

  g_type_init ();

  g_setenv ("GIO_USE_PROXY_RESOLVER", "dummy", TRUE);
  g_setenv ("GSETTINGS_BACKEND", "memory", TRUE);

  /* avoid gvfs (http://bugzilla.gnome.org/show_bug.cgi?id=526454) */
  if (!g_setenv ("GIO_USE_VFS", "local", TRUE))
    {
      g_printerr ("Error setting GIO_USE_GVFS\n");
      goto out;
    }

  opt_context = g_option_context_new ("cockpit storage daemon");
  g_option_context_add_main_entries (opt_context, opt_entries, NULL);
  error = NULL;
  if (!g_option_context_parse (opt_context, &argc, &argv, &error))
    {
      g_printerr ("Error parsing options: %s\n", error->message);
      g_error_free (error);
      goto out;
    }

  if (g_getenv ("PATH") == NULL)
    g_setenv ("PATH", "/usr/bin:/bin:/usr/sbin:/sbin", TRUE);

  cockpit_set_journal_logging (G_LOG_DOMAIN, !isatty (2));

  g_debug ("cockpit daemon version %s starting", PACKAGE_VERSION);

  loop = g_main_loop_new (NULL, FALSE);

  sigint_id = 0;
  if (!opt_no_sigint)
    {
      sigint_id = g_unix_signal_add_full (G_PRIORITY_DEFAULT,
                                          SIGINT,
                                          on_sigint,
                                          NULL,  /* user_data */
                                          NULL); /* GDestroyNotify */
    }

  name_owner_id = g_bus_own_name (G_BUS_TYPE_SESSION,
                                  "com.redhat.Cockpit",
                                  G_BUS_NAME_OWNER_FLAGS_ALLOW_REPLACEMENT |
                                    (opt_replace ? G_BUS_NAME_OWNER_FLAGS_REPLACE : 0),
                                  on_bus_acquired,
                                  on_name_acquired,
                                  on_name_lost,
                                  NULL,
                                  NULL);

  g_main_loop_run (loop);

  ret = 0;

out:
  if (sigint_id > 0)
    g_source_remove (sigint_id);
  if (the_daemon != NULL)
    g_object_unref (the_daemon);
  if (name_owner_id != 0)
    g_bus_unown_name (name_owner_id);
  if (loop != NULL)
    g_main_loop_unref (loop);
  if (opt_context != NULL)
    g_option_context_free (opt_context);

  g_debug ("cockpit daemon version %s exiting", PACKAGE_VERSION);

  return ret;
}
