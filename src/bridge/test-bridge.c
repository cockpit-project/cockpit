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

#include <string.h>

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
  JsonObject *packages;
  GError *error = NULL;
  GList *list;

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

  /* Make sure we've included /etc/os-release information */
  os_release = json_object_get_object_member (object, "os-release");
  g_assert (os_release != NULL);
  g_assert (json_object_has_member (os_release, "NAME"));

  /* Make sure we have right packages listed */
  packages = json_object_get_object_member (object, "packages");
  g_assert (packages != NULL);
  list = json_object_get_members (packages);
  list = g_list_sort (list, (GCompareFunc)strcmp);
  g_assert_cmpuint (g_list_length (list), ==, 3);
  g_assert_cmpstr (list->data, ==, "another");
  g_assert_cmpstr (list->next->data, ==, "second");
  g_assert_cmpstr (list->next->next->data, ==, "test");
  g_list_free (list);

  json_object_unref (object);
}

#if 0
static void
on_closed_get_problem (CockpitTransport *transport,
                       const gchar *problem,
                       gpointer user_data)
{
  gchar **result = (gchar **)user_data;
  g_assert (result != NULL);
  g_assert (*result == NULL);
  g_assert (problem != NULL);
  *result = g_strdup (problem);
}
#endif

static void
on_closed_set_flag (CockpitTransport *transport,
                    const gchar *problem,
                    gpointer user_data)
{
  gboolean *flag = (gboolean *)user_data;
  *flag = TRUE;
}

static gboolean
on_control_get_close (CockpitTransport *transport,
                      const gchar *command,
                      const gchar *channel,
                      JsonObject *options,
                      GBytes *payload,
                      gpointer user_data)
{
  JsonObject **result = (JsonObject **)user_data;
  g_assert (result != NULL);
  g_assert (*result == NULL);
  g_assert (command != NULL);
  if (g_str_equal (command, "close"))
    {
      *result = json_object_ref (options);
      return TRUE;
    }
  return FALSE;
}

typedef struct {
    const gchar *host;
    guint64 version;
} InitProblem;

static void
test_bridge_init_problem (gconstpointer user_data)
{
  const InitProblem *fixture = user_data;
  CockpitTransport *transport;
  CockpitPipe *pipe;
  GBytes *bytes;
  gboolean closed = FALSE;
  JsonObject *input;

  g_assert (fixture != NULL);

  const gchar *argv[] = {
    BUILDDIR "/cockpit-bridge",
    NULL
  };

  pipe = cockpit_pipe_spawn (argv, NULL, NULL, COCKPIT_PIPE_FLAGS_NONE);
  transport = cockpit_pipe_transport_new (pipe);
  g_object_unref (pipe);

  /* First send the actual init message */
  input = json_object_new ();
  json_object_set_string_member (input, "command", "init");
  if (fixture->version != 0)
    json_object_set_int_member (input, "version", fixture->version);
  if (fixture->host)
    json_object_set_string_member (input, "host", fixture->host);
  bytes = cockpit_json_write_bytes (input);
  cockpit_transport_send (transport, NULL, bytes);
  g_bytes_unref (bytes);
  json_object_unref (input);

  /* The bridge should terminate */
  g_signal_connect (transport, "closed", G_CALLBACK (on_closed_set_flag), &closed);

  while (!closed)
    g_main_context_iteration (NULL, TRUE);

  g_signal_handlers_disconnect_by_func (transport, on_closed_set_flag, &closed);

  g_object_unref (transport);

  /* Just checking that it closes by itself here */
}

typedef struct {
    const gchar *host;
    const gchar *open_host;
    const gchar *problem;
} OpenProblem;

static void
test_bridge_open_problem (gconstpointer user_data)
{
  const OpenProblem *fixture = user_data;
  CockpitTransport *transport;
  CockpitPipe *pipe;
  GBytes *bytes;
  JsonObject *object = NULL;
  JsonObject *input;

  g_assert (fixture != NULL);
  g_assert (fixture->problem != NULL);

  const gchar *argv[] = {
    BUILDDIR "/cockpit-bridge",
    NULL
  };

  pipe = cockpit_pipe_spawn (argv, NULL, NULL, COCKPIT_PIPE_FLAGS_NONE);
  transport = cockpit_pipe_transport_new (pipe);
  g_object_unref (pipe);

  /* First send the actual init message */
  input = json_object_new ();
  json_object_set_string_member (input, "command", "init");
  json_object_set_int_member (input, "version", 1);
  if (fixture->host)
    json_object_set_string_member (input, "host", fixture->host);
  bytes = cockpit_json_write_bytes (input);
  cockpit_transport_send (transport, NULL, bytes);
  g_bytes_unref (bytes);
  json_object_unref (input);

  /* Next maybe send an open message */
  input = json_object_new ();
  json_object_set_string_member (input, "command", "open");
  json_object_set_string_member (input, "channel", "444");
  json_object_set_string_member (input, "payload", "null");
  if (fixture->open_host)
    json_object_set_string_member (input, "host", fixture->open_host);
  bytes = cockpit_json_write_bytes (input);
  cockpit_transport_send (transport, NULL, bytes);
  g_bytes_unref (bytes);
  json_object_unref (input);

  /* Listen for a close message */
  g_signal_connect (transport, "control", G_CALLBACK (on_control_get_close), &object);

  while (object == NULL)
    g_main_context_iteration (NULL, TRUE);

  g_signal_handlers_disconnect_by_func (transport, on_control_get_close, &object);

  g_object_unref (transport);

  g_assert_cmpstr (json_object_get_string_member (object, "problem"), ==, fixture->problem);
  json_object_unref (object);
}

static InitProblem bad_version = {
    .version = 5,
};

static InitProblem missing_version = {
    .version = 0,
};

static InitProblem missing_host = {
    .version = 1,
};

static OpenProblem wrong_host = {
    .host = "marmalade",
    .open_host = "juggs",
    .problem = "not-supported",
};

int
main (int argc,
      char *argv[])
{
  g_setenv ("XDG_DATA_DIRS", SRCDIR "/src/bridge/mock-resource/system", TRUE);
  g_setenv ("XDG_DATA_HOME", SRCDIR "/src/bridge/mock-resource/home", TRUE);

  cockpit_test_init (&argc, &argv);

  g_test_add_func ("/bridge/init-message", test_bridge_init);
  g_test_add_data_func ("/bridge/bad-version", &bad_version, test_bridge_init_problem);
  g_test_add_data_func ("/bridge/missing-version", &missing_version, test_bridge_init_problem);
  g_test_add_data_func ("/bridge/missing-host", &missing_host, test_bridge_init_problem);
  g_test_add_data_func ("/bridge/wrong-host", &wrong_host, test_bridge_open_problem);

  return g_test_run ();
}
