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

#include "common/cockpitjson.h"
#include "common/cockpitpipe.h"
#include "common/cockpitpipetransport.h"
#include "common/cockpittest.h"

#include <json-glib/json-glib.h>

#include <gio/gio.h>

static gboolean
on_recv_get_bytes (CockpitTransport *transport,
                   const gchar *channel,
                   GBytes *data,
                   gpointer user_data)
{
  GBytes **result = (GBytes **)user_data;
  g_assert_cmpstr (channel, ==, NULL);
  g_assert (result != NULL);
  g_assert (*result == NULL);
  *result = g_bytes_ref (data);
  return TRUE;
}

static void
on_closed_not_reached (CockpitTransport *transport,
                       const gchar *problem)
{
  g_assert_cmpstr (problem, ==, NULL);
  g_assert_not_reached ();
}

static void
test_bridge_init (void)
{
  CockpitTransport *transport;
  CockpitPipe *pipe;
  GBytes *bytes = NULL;
  JsonObject *object;
  JsonObject *os_release;
  GError *error = NULL;

  const gchar *argv[] = {
    BUILDDIR "/cockpit-bridge",
    NULL
  };

  pipe = cockpit_pipe_spawn (argv, NULL, NULL, COCKPIT_PIPE_FLAGS_NONE);
  transport = cockpit_pipe_transport_new (pipe);
  g_object_unref (pipe);

  g_signal_connect (transport, "recv", G_CALLBACK (on_recv_get_bytes), &bytes);
  g_signal_connect (transport, "closed", G_CALLBACK (on_closed_not_reached), NULL);

  while (bytes == NULL)
    g_main_context_iteration (NULL, TRUE);

  g_signal_handlers_disconnect_by_func (transport, on_recv_get_bytes, &bytes);
  g_signal_handlers_disconnect_by_func (transport, on_closed_not_reached, NULL);

  g_object_unref (transport);

  object = cockpit_json_parse_bytes (bytes, &error);
  g_assert_no_error (error);
  g_bytes_unref (bytes);

  g_assert_cmpstr (json_object_get_string_member (object, "command"), ==, "init");

  os_release = json_object_get_object_member (object, "os-release");
  g_assert (os_release != NULL);
  g_assert (json_object_has_member (os_release, "NAME"));

  json_object_unref (object);
}

int
main (int argc,
      char *argv[])
{
  g_setenv ("XDG_DATA_DIRS", SRCDIR "/src/bridge/mock-resource/system", TRUE);
  g_setenv ("XDG_DATA_HOME", SRCDIR "/src/bridge/mock-resource/home", TRUE);

  cockpit_test_init (&argc, &argv);

  g_test_add_func ("/bridge/init-message", test_bridge_init);

  return g_test_run ();
}
