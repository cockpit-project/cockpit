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

#include "cockpitdbusjson2.h"

#include "common/cockpitjson.h"
#include "common/cockpitpipetransport.h"
#include "common/cockpittest.h"
#include "common/mock-service.h"

#include <json-glib/json-glib.h>

#include <sys/socket.h>
#include <errno.h>
#include <string.h>
#include <unistd.h>

static void
test_dispose_invalid (void)
{
  CockpitTransport *transport;
  CockpitChannel *channel;
  int fd = GPOINTER_TO_INT (NULL);

  cockpit_expect_warning ("bridge got invalid dbus service");
  transport = cockpit_pipe_transport_new_fds ("mock", fd, fd);
  channel = cockpit_dbus_json2_open (transport, "444", "", "/otree");

  g_object_unref (transport);
  g_object_unref (channel);
}

int
main (int argc,
      char *argv[])
{
  GTestDBus *bus;
  gint ret;

  cockpit_test_init (&argc, &argv);

  g_test_add_func ("/dbus-server/dispose-invalid", test_dispose_invalid);

  /* This isolates us from affecting other processes during tests */
  bus = g_test_dbus_new (G_TEST_DBUS_NONE);
  g_test_dbus_up (bus);

  mock_service_start ();

  ret = g_test_run ();

  mock_service_stop ();
  g_test_dbus_down (bus);
  g_object_unref (bus);

  return ret;
}
