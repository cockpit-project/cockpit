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

#include "ws/cockpitsshagent.h"

#include "common/cockpittransport.h"
#include "common/cockpitpipe.h"
#include "common/cockpitpipetransport.h"
#include "common/cockpittest.h"
#include "common/cockpitjson.h"

#include <sys/types.h>
#include <sys/socket.h>

#include "common/cockpittest.h"

typedef struct {
  CockpitTransport *ws_transport;

  CockpitTransport *bridge_transport;

  gboolean agent_closed;
  gboolean channel_closed;
  gboolean channel_opened;

} TestCase;


static gboolean
on_transport_recv (CockpitTransport *transport,
                   const gchar *channel,
                   GBytes *message,
                   gpointer user_data)
{
  GBytes **received = user_data;
  if (!channel)
    return FALSE;

  g_assert_cmpstr (channel, ==, "test-agent-channel");
  g_assert_null (*received);
  *received = g_bytes_ref (message);
  return TRUE;
}

static gboolean
on_ws_recv (CockpitTransport *transport,
            const gchar *channel,
            GBytes *message,
            gpointer user_data)
{
  GBytes **received = user_data;
  if (!channel)
    return FALSE;

  g_assert_null (*received);
  *received = g_bytes_ref (message);
  return TRUE;
}

static gboolean
on_bridge_control (CockpitTransport *transport,
                   const char *command,
                   const gchar *channel_id,
                   JsonObject *options,
                   GBytes *message,
                   gpointer user_data)
{
  TestCase *tc = user_data;
  if (g_strcmp0 (channel_id, "test-agent-channel") == 0)
    {
      if (g_strcmp0 (command, "open") == 0)
        tc->channel_opened = TRUE;
      else if (g_strcmp0 (command, "close") == 0)
        tc->channel_closed = TRUE;
    }
  return TRUE;
}

static void
on_transport_closed (CockpitTransport *transport,
                           const gchar *problem,
                           gpointer user_data)
{
  TestCase *tc = user_data;
  tc->channel_closed = TRUE;
}

static void
setup (TestCase *tc,
       gconstpointer data)
{
  int pair[2];

  CockpitPipe *ws_pipe = NULL;
  CockpitPipe *bridge_pipe = NULL;

  if (socketpair (AF_UNIX, SOCK_STREAM, 0, pair) < 0)
    g_assert_not_reached ();

  ws_pipe = cockpit_pipe_new ("mock-ws", pair[0], pair[0]);
  bridge_pipe = cockpit_pipe_new ("mock-bridge", pair[1], pair[1]);

  tc->ws_transport = cockpit_pipe_transport_new (ws_pipe);
  tc->bridge_transport = cockpit_pipe_transport_new (bridge_pipe);

  g_signal_connect (tc->bridge_transport, "control",
                    G_CALLBACK (on_bridge_control), tc);
  g_signal_connect (tc->ws_transport, "closed",
                    G_CALLBACK (on_transport_closed), tc);

  g_object_unref (ws_pipe);
  g_object_unref (bridge_pipe);
}

static void
teardown (TestCase *tc,
          gconstpointer data)
{
  cockpit_assert_expected ();

  g_assert_true (tc->channel_opened);
  g_assert_true (tc->channel_closed);
  g_assert_true (tc->agent_closed);

  g_object_add_weak_pointer (G_OBJECT (tc->ws_transport), (gpointer *)&tc->ws_transport);
  g_object_unref (tc->ws_transport);
  g_assert_null (tc->ws_transport);

  g_object_add_weak_pointer (G_OBJECT (tc->bridge_transport), (gpointer *)&tc->bridge_transport);
  g_object_unref (tc->bridge_transport);
  g_assert_null (tc->bridge_transport);
}

static void
on_pipe_read (CockpitPipe *pipe,
              GByteArray *data,
              gboolean end_of_data,
              gpointer user_data)
{
  GBytes **received = user_data;
  g_assert_null (*received);
  g_byte_array_ref (data);
  *received = g_byte_array_free_to_bytes (data);
}

static void
on_pipe_read_close_channel (CockpitPipe *pipe,
                            GByteArray *data,
                            gboolean end_of_data,
                            gpointer user_data)
{
  TestCase *tc = user_data;
  if (!tc->channel_closed)
    {
      JsonObject *options = NULL;
      GBytes *message = NULL;
      GBytes *out_data = NULL;

      tc->channel_closed = TRUE;

      options = json_object_new ();
      json_object_set_string_member (options, "channel", "test-agent-channel");
      json_object_set_string_member (options, "command", "close");
      message = cockpit_json_write_bytes (options);
      json_object_unref (options);
      cockpit_transport_send (tc->bridge_transport,
                              NULL,
                              message);

      out_data = g_bytes_new_static ("Channel closed", 14);
      cockpit_transport_send (tc->bridge_transport,
                              "test-agent-channel",
                              out_data);
      g_bytes_unref (message);
      g_bytes_unref (out_data);
    }
}

static void
on_pipe_close (CockpitPipe *pipe,
               const gchar *problem,
               gpointer user_data)
{
  TestCase *tc = user_data;
  tc->agent_closed = TRUE;
}

static CockpitPipe*
setup_pipe (CockpitSshAgent *agent,
            TestCase *tc)
{
  CockpitPipe *pipe = NULL;
  int fd = cockpit_ssh_agent_steal_fd (agent);
  g_assert (fd > 0);
  pipe = g_object_new (COCKPIT_TYPE_PIPE,
                       "in-fd", fd,
                       "out-fd", fd,
                       "name", "agent-proxy",
                       NULL);

  g_signal_connect (pipe, "close", G_CALLBACK (on_pipe_close), tc);
  return pipe;
}

static void
test_through (TestCase *tc,
              gconstpointer data)
{
  CockpitSshAgent *agent;
  CockpitPipe *pipe;

  GBytes *pipe_got = NULL;
  GBytes *bridge_got = NULL;
  GBytes *ws_got = NULL;
  GBytes *out_data = NULL;

  gint p_sig;
  gint b_sig;
  gint ws_sig;

  agent = cockpit_ssh_agent_new (tc->ws_transport,
                                 "test-agent",
                                 "test-agent-channel");
  pipe = setup_pipe (agent, tc);

  p_sig = g_signal_connect (pipe, "read",
                            G_CALLBACK (on_pipe_read),
                            &pipe_got);
  b_sig = g_signal_connect (tc->bridge_transport, "recv",
                           G_CALLBACK (on_transport_recv), &bridge_got);
  ws_sig = g_signal_connect (tc->ws_transport, "recv",
                             G_CALLBACK (on_ws_recv), &ws_got);

  out_data = g_bytes_new_static ("Agent says", 10);
  cockpit_pipe_write (pipe, out_data);
  g_bytes_unref (out_data);

  out_data = g_bytes_new_static ("Other says", 10);
  cockpit_transport_send (tc->bridge_transport,
                          "other-channel",
                          out_data);
  g_bytes_unref (out_data);

  out_data = g_bytes_new_static ("Bridge says", 11);
  cockpit_transport_send (tc->bridge_transport,
                          "test-agent-channel",
                          out_data);
  g_bytes_unref (out_data);
  out_data = NULL;

  while (pipe_got == NULL || bridge_got == NULL || ws_got == NULL)
    g_main_context_iteration (NULL, TRUE);

  cockpit_assert_bytes_eq (pipe_got, "Bridge says", -1);
  cockpit_assert_bytes_eq (bridge_got, "Agent says", -1);
  cockpit_assert_bytes_eq (ws_got, "Other says", -1);

  g_signal_handler_disconnect (tc->ws_transport, ws_sig);
  g_signal_handler_disconnect (tc->bridge_transport, b_sig);
  g_signal_handler_disconnect (pipe, p_sig);

  cockpit_ssh_agent_close (agent);

  while (!tc->channel_closed)
    g_main_context_iteration (NULL, TRUE);

  g_object_unref (agent);

  g_bytes_unref (pipe_got);
  g_bytes_unref (bridge_got);
  g_bytes_unref (ws_got);
  g_object_unref (pipe);
}

static void
test_close_pipe (TestCase *tc,
                 gconstpointer data)
{
  /* closing pipe closes everything down.
   * data comes through main ws again
   */

  CockpitSshAgent *agent;
  CockpitPipe *pipe;

  GBytes *ws_got = NULL;
  GBytes *pipe_got = NULL;
  GBytes *out_data = NULL;

  gint ws_sig;
  gint p_sig;

  agent = cockpit_ssh_agent_new (tc->ws_transport,
                                 "test-agent",
                                 "test-agent-channel");
  pipe = setup_pipe (agent, tc);

  while (!tc->channel_opened)
    g_main_context_iteration (NULL, TRUE);

  p_sig = g_signal_connect (pipe, "read",
                            G_CALLBACK (on_pipe_read),
                            &pipe_got);
  ws_sig = g_signal_connect (tc->ws_transport, "recv",
                             G_CALLBACK (on_ws_recv), &ws_got);

  cockpit_pipe_close (pipe, NULL);

  out_data = g_bytes_new_static ("Bridge says", 11);
  cockpit_transport_send (tc->bridge_transport,
                          "test-agent-channel",
                          out_data);

  while (!tc->channel_closed || ws_got == NULL)
    g_main_context_iteration (NULL, TRUE);

  g_signal_handler_disconnect (pipe, p_sig);
  g_signal_handler_disconnect (tc->ws_transport, ws_sig);

  cockpit_assert_bytes_eq (pipe_got, "", -1);
  cockpit_assert_bytes_eq (ws_got, "Bridge says", -1);

  g_object_unref (agent);
  g_bytes_unref (out_data);
  g_bytes_unref (ws_got);
  g_bytes_unref (pipe_got);
  g_object_unref (pipe);
}

static void
test_close_channel (TestCase *tc,
                      gconstpointer data)
{
  /* closing channel closes everything down.
   * results in pipe closing, new data not
   * passed through
   */

  CockpitSshAgent *agent;
  CockpitPipe *pipe;

  GBytes *ws_got = NULL;
  GBytes *pipe_got = NULL;
  GBytes *out_data = NULL;

  gint p_sig;
  gint ws_sig;

  agent = cockpit_ssh_agent_new (tc->ws_transport,
                                 "test-agent",
                                 "test-agent-channel");
  pipe = setup_pipe (agent, tc);

  while (tc->channel_opened == FALSE)
    g_main_context_iteration (NULL, TRUE);

  g_signal_connect (tc->ws_transport, "recv",
                    G_CALLBACK (on_ws_recv), &ws_got);

  p_sig = g_signal_connect (pipe, "read",
                            G_CALLBACK (on_pipe_read_close_channel),
                            tc);
  ws_sig = g_signal_connect (tc->ws_transport, "recv",
                             G_CALLBACK (on_ws_recv), &ws_got);

  out_data = g_bytes_new_static ("Bridge says", 11);
  cockpit_transport_send (tc->bridge_transport,
                          "test-agent-channel",
                          out_data);

  while (!tc->channel_closed || ws_got == NULL)
    g_main_context_iteration (NULL, TRUE);

  g_signal_handler_disconnect (pipe, p_sig);
  g_signal_handler_disconnect (tc->ws_transport, ws_sig);

  cockpit_assert_bytes_eq (ws_got, "Channel closed", -1);

  g_object_unref (agent);
  g_bytes_unref (out_data);
  g_bytes_unref (ws_got);
  g_bytes_unref (pipe_got);
  g_object_unref (pipe);
}

static void
test_close_transport (TestCase *tc,
                      gconstpointer data)
{
  /* closing transport closes everything down. */

  CockpitSshAgent *agent;
  CockpitPipe *pipe;

  agent = cockpit_ssh_agent_new (tc->ws_transport,
                                 "test-agent",
                                 "test-agent-channel");
  pipe = setup_pipe (agent, tc);

  while (tc->channel_opened == FALSE)
    g_main_context_iteration (NULL, TRUE);

  cockpit_transport_close (tc->bridge_transport, NULL);

  while (!tc->channel_closed)
    g_main_context_iteration (NULL, TRUE);

  g_object_unref (agent);
  g_object_unref (pipe);
}

int
main (int argc,
      char *argv[])
{
  cockpit_test_init (&argc, &argv);

  g_test_add ("/sshagent/through", TestCase, NULL,
              setup, test_through, teardown);
  g_test_add ("/sshagent/close_pipe", TestCase, NULL,
              setup, test_close_pipe, teardown);
  g_test_add ("/sshagent/close_channel", TestCase, NULL,
              setup, test_close_channel, teardown);
  g_test_add ("/sshagent/close_transport", TestCase, NULL,
              setup, test_close_transport, teardown);

  return g_test_run ();
}
