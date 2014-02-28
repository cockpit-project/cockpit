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

int
main (int argc,
      char **argv)
{
  CockpitTransport *transport;
  const gchar *dbus_service;
  const gchar *dbus_path;

  transport = cockpit_fd_transport_new ("stdio", 0, 1);

  dbus_service = g_getenv ("COCKPIT_AGENT_DBUS_SERVICE");
  if (!dbus_service)
    dbus_service = "com.redhat.Cockpit";
  dbus_path = g_getenv ("COCKPIT_AGENT_DBUS_PATH");
  if (!dbus_path)
    dbus_path = "/com/redhat/Cockpit";

  dbus_server_serve_dbus (G_BUS_TYPE_SYSTEM,
                          dbus_service,
                          dbus_path,
                          transport);

  g_object_unref (transport);
  exit (0);
}
