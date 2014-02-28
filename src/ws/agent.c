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

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "dbus-server.h"
#include "cockpitfdtransport.h"

/* This program is run on each managed server, with the credentials
   of the user that is logged into the Server Console.
*/

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
  const gchar *dbus_service;
  const gchar *dbus_path;
  gboolean closed = FALSE;
  DBusServerData *ds;
  int outfd;

  /*
   * This process talks on stdin/stdout. However lots of stuff wants to write
   * to stdout, such as g_debug, and uses fd 1 to do that. Reroute fd 1 so that
   * it goes to stderr, and use another fd for stdout.
   */

  outfd = dup (1);
  if (outfd < 0 || dup2 (2, 1) < 1)
    {
      g_warning ("agent couldn't redirect stdout to stderr");
      outfd = 1;
    }

  transport = cockpit_fd_transport_new ("stdio", 0, outfd);
  g_signal_connect (transport, "closed", G_CALLBACK (on_closed_set_flag), &closed);

  dbus_service = g_getenv ("COCKPIT_AGENT_DBUS_SERVICE");
  if (!dbus_service)
    dbus_service = "com.redhat.Cockpit";
  dbus_path = g_getenv ("COCKPIT_AGENT_DBUS_PATH");
  if (!dbus_path)
    dbus_path = "/com/redhat/Cockpit";

  ds = dbus_server_serve_dbus (G_BUS_TYPE_SYSTEM,
                               dbus_service,
                               dbus_path,
                               transport);

  while (!closed)
    g_main_context_iteration (NULL, TRUE);

  dbus_server_stop_dbus (ds);
  g_object_unref (transport);
  exit (0);
}
