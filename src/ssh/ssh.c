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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

#include "config.h"

#include <gio/gio.h>

#include "common/cockpitpipetransport.h"
#include "common/cockpitlog.h"
#include "common/cockpittest.h"

#include "cockpitsshrelay.h"


int
main (int argc,
      char *argv[])
{
  gint ret = 1;
  gint outfd;
  CockpitSshRelay *relay;
  GOptionContext *context;
  GError *error = NULL;
  GMainLoop *loop = NULL;

  signal (SIGALRM, SIG_DFL);
  signal (SIGQUIT, SIG_DFL);
  signal (SIGTSTP, SIG_IGN);
  signal (SIGHUP, SIG_IGN);
  signal (SIGPIPE, SIG_IGN);

  /* Debugging issues during testing */
#if WITH_DEBUG
  signal (SIGABRT, cockpit_test_signal_backtrace);
  signal (SIGSEGV, cockpit_test_signal_backtrace);
#endif

  g_setenv ("GSETTINGS_BACKEND", "memory", TRUE);
  g_setenv ("GIO_USE_PROXY_RESOLVER", "dummy", TRUE);
  g_setenv ("GIO_USE_VFS", "local", TRUE);

  g_type_init ();

  context = g_option_context_new ("- cockpit-ssh [user@]host[:port]");

  if (!g_option_context_parse (context, &argc, &argv, &error))
    {
      ret = INTERNAL_ERROR;
      goto out;
    }

  if (argc > 2)
    {
      g_printerr ("cockpit-ssh: unexpected additional arguments, see --help\n");
      ret = INTERNAL_ERROR;
      goto out;
    }

  cockpit_set_journal_logging (NULL, FALSE);

  /*
   * This process talks on stdin/stdout. However lots of stuff wants to write
   * to stdout, such as g_debug, and uses fd 1 to do that. Reroute fd 1 so that
   * it goes to stderr, and use another fd for stdout.
   */
  outfd = dup (1);
  if (outfd < 0 || dup2 (2, 1) < 1)
    {
      g_warning ("bridge couldn't redirect stdout to stderr");
      if (outfd > -1)
        close (outfd);
      outfd = 1;
    }

  loop = g_main_loop_new (NULL, FALSE);

  relay = cockpit_ssh_relay_new (argv[1], outfd);
  g_signal_connect_swapped (relay, "disconnect", G_CALLBACK (g_main_loop_quit), loop);

  g_main_loop_run (loop);

  ret = cockpit_ssh_relay_result (relay);
  g_object_unref (relay);

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
