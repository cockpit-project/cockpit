/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
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

#include "cockpitchannel.h"
#include "cockpitpcpmetrics.h"
#include "cockpitbridge.h"

#include "common/cockpitjson.h"
#include "common/cockpitlog.h"
#include "common/cockpitpipetransport.h"
#include "common/cockpitunixfd.h"

#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <pwd.h>

#include <glib-unix.h>

static CockpitPayloadType payload_types[] = {
  { "metrics1", cockpit_pcp_metrics_get_type },
  { NULL },
};

/* This program is run on each managed server, with the credentials
   of the user that is logged into the Server Console.
*/

static void
send_init_command (CockpitTransport *transport)
{
  const gchar *response = "{ \"command\": \"init\", \"version\": 1 }";
  GBytes *bytes = g_bytes_new_static (response, strlen (response));
  cockpit_transport_send (transport, NULL, bytes);
  g_bytes_unref (bytes);
}

static gboolean
on_signal_done (gpointer data)
{
  gboolean *closed = data;
  *closed = TRUE;
  return TRUE;
}

static void
on_closed_set_flag (CockpitTransport *transport,
                    const gchar *problem,
                    gpointer user_data)
{
  gboolean *flag = user_data;
  *flag = TRUE;
}

int
main (int argc,
      char **argv)
{
  CockpitTransport *transport;
  CockpitBridge *bridge;
  gboolean terminated = FALSE;
  gboolean closed = FALSE;
  GOptionContext *context;
  GError *error = NULL;
  guint sig_term;
  int outfd;

  static GOptionEntry entries[] = {
    { NULL }
  };

  signal (SIGPIPE, SIG_IGN);

  g_setenv ("GSETTINGS_BACKEND", "memory", TRUE);
  g_setenv ("GIO_USE_PROXY_RESOLVER", "dummy", TRUE);
  g_setenv ("GIO_USE_VFS", "local", TRUE);

  context = g_option_context_new (NULL);
  g_option_context_add_main_entries (context, entries, NULL);
  g_option_context_set_description (context, "cockpit-pcp is run automatically inside of a Cockpit session.\n");

  g_option_context_parse (context, &argc, &argv, &error);
  g_option_context_free (context);

  if (error)
    {
      g_printerr ("cockpit-pcp: %s\n", error->message);
      g_error_free (error);
      return 1;
    }

  if (isatty (1))
    {
      g_printerr ("cockpit-pcp: only run from cockpit-bridge\n");
      return 2;
    }

  cockpit_set_journal_logging (G_LOG_DOMAIN, !isatty (2));

  /*
   * This process talks on stdin/stdout. However lots of stuff wants to write
   * to stdout, such as g_debug, and uses fd 1 to do that. Reroute fd 1 so that
   * it goes to stderr, and use another fd for stdout.
   */

  outfd = dup (1);
  if (outfd < 0 || dup2 (2, 1) < 1)
    {
      g_warning ("bridge couldn't redirect stdout to stderr");
      outfd = 1;
    }

  sig_term = g_unix_signal_add (SIGTERM, on_signal_done, &terminated);

  g_type_init ();

  transport = cockpit_pipe_transport_new_fds ("stdio", 0, outfd);

  bridge = cockpit_bridge_new (transport, payload_types, NULL);
  g_signal_connect (transport, "closed", G_CALLBACK (on_closed_set_flag), &closed);
  send_init_command (transport);

  while (!closed && !terminated)
    g_main_context_iteration (NULL, TRUE);

  g_object_unref (bridge);
  g_object_unref (transport);

  g_source_remove (sig_term);

  return 0;
}
