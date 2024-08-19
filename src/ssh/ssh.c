/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
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

#include "common/cockpithacks-glib.h"
#include "common/cockpitsystem.h"

#include "cockpitsshrelay.h"

static gboolean
on_exit_signal (gpointer data)
{
  GMainLoop *loop = data;
  g_debug ("Received exit signal, shutting down");
  g_main_loop_quit (loop);
  return TRUE;
}

int
main (int argc,
      char *argv[])
{
  gint ret = 1;
  CockpitSshRelay *relay;
  GOptionContext *context;
  GError *error = NULL;
  GMainLoop *loop = NULL;

  cockpit_hacks_redirect_gdebug_to_stderr ();

  signal (SIGALRM, SIG_DFL);
  signal (SIGQUIT, SIG_DFL);
  signal (SIGTSTP, SIG_IGN);
  signal (SIGHUP, SIG_IGN);
  signal (SIGPIPE, SIG_IGN);

  cockpit_setenv_check ("GSETTINGS_BACKEND", "memory", TRUE);
  cockpit_setenv_check ("GIO_USE_PROXY_RESOLVER", "dummy", TRUE);
  cockpit_setenv_check ("GIO_USE_VFS", "local", TRUE);

  context = g_option_context_new ("- cockpit-ssh [user@]host[:port]");

  if (!g_option_context_parse (context, &argc, &argv, &error))
    {
      ret = INTERNAL_ERROR;
      goto out;
    }

  if (argc != 2)
    {
      g_printerr ("cockpit-ssh: unexpected additional arguments, see --help\n");
      ret = INTERNAL_ERROR;
      goto out;
    }

  loop = g_main_loop_new (NULL, FALSE);

  relay = cockpit_ssh_relay_new (argv[1]);
  g_signal_connect_swapped (relay, "disconnect", G_CALLBACK (g_main_loop_quit), loop);

  guint sig_term = g_unix_signal_add (SIGTERM, on_exit_signal, loop);
  guint sig_int = g_unix_signal_add (SIGINT, on_exit_signal, loop);

  g_main_loop_run (loop);

  ret = cockpit_ssh_relay_result (relay);
  g_object_unref (relay);

  g_source_remove (sig_term);
  g_source_remove (sig_int);

out:
  g_option_context_free (context);

  if (error)
    {
      g_printerr ("cockpit-ssh: %s\n", error->message);
      g_error_free (error);
    }

  if (loop)
    g_main_loop_unref (loop);

  return ret;
}
