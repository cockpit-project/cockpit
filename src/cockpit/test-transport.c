/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2014 Red Hat, Inc.
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

#include "cockpittransport.h"
#include "cockpitpipe.h"
#include "cockpitpipetransport.h"

#include "cockpit/cockpittest.h"

#include "websocket/websocket.h"

#include <glib.h>

#include <string.h>

#include <sys/types.h>
#include <sys/socket.h>

#define WAIT_UNTIL(cond) \
  G_STMT_START \
    while (!(cond)) g_main_context_iteration (NULL, TRUE); \
  G_STMT_END

typedef struct {
  CockpitTransport *transport;
  CockpitPipe *pipe;
} TestCase;

static void
setup_with_child (TestCase *tc,
                  gconstpointer data)
{
  gchar *argv[] = { (gchar *)data, NULL };
  GError *error = NULL;
  GPid pid;
  int in;
  int out;

  g_spawn_async_with_pipes (NULL, argv, NULL, G_SPAWN_SEARCH_PATH | G_SPAWN_DO_NOT_REAP_CHILD,
                            NULL, NULL, &pid, &in, &out, NULL, &error);
  g_assert_no_error (error);

  tc->pipe = g_object_new (COCKPIT_TYPE_PIPE,
                           "name", "mock",
                           "in-fd", out,
                           "out-fd", in,
                           "pid", pid);
  tc->transport = cockpit_pipe_transport_new (tc->pipe);
}

static void
setup_no_child (TestCase *tc,
                gconstpointer data)
{
  int sv[2];

  if (socketpair (PF_LOCAL, SOCK_STREAM, 0, sv) < 0)
    g_assert_not_reached ();

  tc->pipe = cockpit_pipe_new ("mock", sv[0], sv[1]);
  tc->transport = cockpit_pipe_transport_new (tc->pipe);
}

static void
teardown_transport (TestCase *tc,
                    gconstpointer data)
{
  cockpit_assert_expected ();

  g_object_add_weak_pointer (G_OBJECT (tc->transport),
                             (gpointer *)&tc->transport);
  g_object_unref (tc->transport);

  /* If this asserts, outstanding references to transport */
  g_assert (tc->transport == NULL);

  g_object_add_weak_pointer (G_OBJECT (tc->pipe),
                             (gpointer *)&tc->pipe);
  g_object_unref (tc->pipe);

  /* If this asserts, outstanding references to transport */
  g_assert (tc->pipe == NULL);
}

static gboolean
on_recv_get_payload (CockpitTransport *transport,
                     guint channel,
                     GBytes *message,
                     gpointer user_data)
{
  GBytes **received = user_data;
  g_assert_cmpuint (channel, ==, 546);
  g_assert (*received == NULL);
  *received = g_bytes_ref (message);
  return TRUE;
}


static gboolean
on_recv_multiple (CockpitTransport *transport,
                  guint channel,
                  GBytes *message,
                  gpointer user_data)
{
  gint *state = user_data;
  GBytes *check;

  g_assert_cmpuint (channel, ==, 9);

  if (*state == 0)
    check = g_bytes_new_static ("one", 3);
  else if (*state == 1)
    check = g_bytes_new_static ("two", 3);
  else
    g_assert_not_reached ();

  (*state)++;
  g_assert (g_bytes_equal (message, check));
  return TRUE;
}

static void
on_closed_set_flag (CockpitTransport *transport,
                    const gchar *problem,
                    gpointer user_data)
{
  gboolean *flag = user_data;
  g_assert (problem == NULL);
  g_assert (*flag == FALSE);
  *flag = TRUE;
}

static void
test_echo_and_close (TestCase *tc,
                     gconstpointer data)
{

  GBytes *received = NULL;
  GBytes *sent;
  gboolean closed = FALSE;

  sent = g_bytes_new_static ("the message", 11);
  g_signal_connect (tc->transport, "recv", G_CALLBACK (on_recv_get_payload), &received);
  cockpit_transport_send (tc->transport, 546, sent);

  WAIT_UNTIL (received != NULL);

  g_assert (g_bytes_equal (received, sent));
  g_bytes_unref (sent);
  g_bytes_unref (received);
  received = NULL;

  g_signal_connect (tc->transport, "closed", G_CALLBACK (on_closed_set_flag), &closed);
  cockpit_transport_close (tc->transport, NULL);

  WAIT_UNTIL (closed == TRUE);
}

static void
test_echo_queue (TestCase *tc,
                 gconstpointer data)
{
  GBytes *sent;
  gint state = 0;
  gboolean closed = FALSE;

  g_signal_connect (tc->transport, "recv", G_CALLBACK (on_recv_multiple), &state);
  g_signal_connect (tc->transport, "closed", G_CALLBACK (on_closed_set_flag), &closed);

  sent = g_bytes_new_static ("one", 3);
  cockpit_transport_send (tc->transport, 9, sent);
  g_bytes_unref (sent);
  sent = g_bytes_new_static ("two", 3);
  cockpit_transport_send (tc->transport, 9, sent);
  g_bytes_unref (sent);

  /* Only closes after above are sent */
  cockpit_transport_close (tc->transport, NULL);

  WAIT_UNTIL (state == 2 && closed == TRUE);
}

static void
test_echo_large (TestCase *tc,
                 gconstpointer data)
{
  GBytes *received = NULL;
  GBytes *sent;

  g_signal_connect (tc->transport, "recv", G_CALLBACK (on_recv_get_payload), &received);

  /* Medium length */
  sent = g_bytes_new_take (g_strnfill (1020, '!'), 1020);
  cockpit_transport_send (tc->transport, 546, sent);
  WAIT_UNTIL (received != NULL);
  g_assert (g_bytes_equal (received, sent));
  g_bytes_unref (sent);
  g_bytes_unref (received);
  received = NULL;

  /* Extra large */
  sent = g_bytes_new_take (g_strnfill (10 * 1000 * 1000, '?'), 10 * 1000 * 1000);
  cockpit_transport_send (tc->transport, 546, sent);
  WAIT_UNTIL (received != NULL);
  g_assert (g_bytes_equal (received, sent));
  g_bytes_unref (sent);
  g_bytes_unref (received);
  received = NULL;

  /* Double check that didn't csrew things up */
  sent = g_bytes_new_static ("yello", 5);
  cockpit_transport_send (tc->transport, 546, sent);
  WAIT_UNTIL (received != NULL);
  g_assert (g_bytes_equal (received, sent));
  g_bytes_unref (sent);
  g_bytes_unref (received);
  received = NULL;

}

static void
on_closed_get_problem (CockpitTransport *transport,
                       const gchar *problem,
                       gpointer user_data)
{
  const gchar **ret = user_data;
  g_assert (problem != NULL);
  g_assert (*ret == NULL);
  *ret = g_strdup (problem);
}

static void
test_close_problem (TestCase *tc,
                    gconstpointer data)
{
  gchar *problem = NULL;

  g_signal_connect (tc->transport, "closed", G_CALLBACK (on_closed_get_problem), &problem);
  cockpit_transport_close (tc->transport, "right now");

  WAIT_UNTIL (problem != NULL);

  g_assert_cmpstr (problem, ==, "right now");
  g_free (problem);
}

static void
test_terminate_problem (TestCase *tc,
                        gconstpointer data)
{
  gchar *problem = NULL;
  GPid pid;

  g_signal_connect (tc->transport, "closed", G_CALLBACK (on_closed_get_problem), &problem);

  g_assert (cockpit_pipe_get_pid (tc->pipe, &pid));
  g_assert (pid != 0);
  kill (pid, SIGTERM);

  WAIT_UNTIL (problem != NULL);

  g_assert_cmpstr (problem, ==, "terminated");
  g_free (problem);
}

static void
test_read_error (void)
{
  CockpitTransport *transport;
  gchar *problem = NULL;
  gint fds[2];

  /* Assuming FD 1000 is not taken */
  g_assert (write (1000, "1", 1) < 0);

  g_assert_cmpint (pipe (fds), ==, 0);

  cockpit_expect_warning ("*Bad file descriptor");
  cockpit_expect_warning ("*Bad file descriptor");

  /* Pass in a bad read descriptor */
  transport = cockpit_pipe_transport_new_fds ("test", 1000, fds[0]);

  g_signal_connect (transport, "closed", G_CALLBACK (on_closed_get_problem), &problem);

  WAIT_UNTIL (problem != NULL);
  g_assert_cmpstr (problem, ==, "internal-error");
  g_free (problem);

  cockpit_assert_expected ();

  g_object_unref (transport);
  close (fds[1]);
}

static void
test_write_error (void)
{
  CockpitTransport *transport;
  gchar *problem = NULL;
  GBytes *sent;
  int fds[2];

  /* Just used so we have a valid fd */
  if (pipe(fds) < 0)
    g_assert_not_reached ();

  /* Assuming FD 1000 is not taken */
  g_assert (write (1000, "1", 1) < 0);

  cockpit_expect_warning ("*Bad file descriptor");
  cockpit_expect_warning ("*Bad file descriptor");

  /* Pass in a bad write descriptor */
  transport = cockpit_pipe_transport_new_fds ("test", fds[0], 1000);

  sent = g_bytes_new ("test", 4);
  cockpit_transport_send (transport, 3333, sent);
  g_bytes_unref (sent);

  g_signal_connect (transport, "closed", G_CALLBACK (on_closed_get_problem), &problem);

  WAIT_UNTIL (problem != NULL);
  g_assert_cmpstr (problem, ==, "internal-error");
  g_free (problem);

  close (fds[0]);
  close (fds[1]);

  g_object_unref (transport);

  cockpit_assert_expected ();
}

static void
test_read_combined (void)
{
  CockpitTransport *transport;
  struct iovec iov[4];
  gint state = 0;
  gint fds[2];
  guint32 size;
  gint out;

  if (pipe(fds) < 0)
    g_assert_not_reached ();

  out = dup (2);
  g_assert (out >= 0);

  /* Pass in a read end of the pipe */
  transport = cockpit_pipe_transport_new_fds ("test", fds[0], out);
  g_signal_connect (transport, "recv", G_CALLBACK (on_recv_multiple), &state);

  /* Write two messages to the pipe at once */
  size = GUINT32_TO_BE (5);
  iov[0].iov_base = &size;
  iov[0].iov_len = sizeof (size);
  iov[1].iov_base = "9\none";
  iov[1].iov_len = 5;
  iov[2].iov_base = &size;
  iov[2].iov_len = sizeof (size);
  iov[3].iov_base = "9\ntwo";
  iov[3].iov_len = 5;
  g_assert_cmpint (writev (fds[1], iov, 4), ==, 18);

  WAIT_UNTIL (state == 2);

  close (fds[1]);
  g_object_unref (transport);
}

static void
test_read_truncated (void)
{
  CockpitTransport *transport;
  gchar *problem = NULL;
  gint fds[2];
  gint out;

  if (pipe(fds) < 0)
    g_assert_not_reached ();

  out = dup (2);
  g_assert (out >= 0);

  cockpit_expect_warning ("*received truncated 1 byte frame");

  /* Pass in a read end of the pipe */
  transport = cockpit_pipe_transport_new_fds ("test", fds[0], out);
  g_signal_connect (transport, "closed", G_CALLBACK (on_closed_get_problem), &problem);

  /* Not a full 4 byte length (ie: truncated) */
  g_assert_cmpint (write (fds[1], "X", 1), ==, 1);
  g_assert_cmpint (close (fds[1]), ==, 0);

  WAIT_UNTIL (problem != NULL);

  g_assert_cmpstr (problem, ==, "internal-error");
  g_free (problem);

  g_object_unref (transport);

  cockpit_assert_expected ();
}

static void
test_parse_frame (void)
{
  GBytes *message;
  GBytes *payload;
  guint channel;

  message = g_bytes_new_static ("134\ntest", 8);

  payload = cockpit_transport_parse_frame (message, &channel);
  g_assert (payload != NULL);
  g_assert_cmpstr (g_bytes_get_data (payload, NULL), ==, "test");
  g_assert_cmpuint (channel, ==, 134);

  g_bytes_unref (payload);
  g_bytes_unref (message);
}

static void
test_parse_frame_bad (void)
{
  GBytes *message;
  GBytes *payload;
  guint channel;

  cockpit_expect_warning ("*invalid message prefix");

  message = g_bytes_new_static ("bad\ntest", 8);
  payload = cockpit_transport_parse_frame (message, &channel);
  g_assert (payload == NULL);
  g_bytes_unref (message);

  cockpit_assert_expected ();

  cockpit_expect_warning ("*invalid message without channel prefix");

  message = g_bytes_new_static ("test", 4);
  payload = cockpit_transport_parse_frame (message, &channel);
  g_assert (payload == NULL);
  g_bytes_unref (message);

  cockpit_assert_expected ();

  cockpit_expect_warning ("*invalid message prefix");

  message = g_bytes_new_static ("111111111111111\ntest", 20);
  payload = cockpit_transport_parse_frame (message, &channel);
  g_assert (payload == NULL);
  g_bytes_unref (message);

  cockpit_assert_expected ();
}

static void
test_parse_command (void)
{
  const gchar *input = "{ 'command': 'test', \"channel\": 66, \"opt\": \"one\" }";
  JsonParser *parser;
  GBytes *message;
  guint channel;
  const gchar *command;
  JsonObject *options;
  gboolean ret;

  parser = json_parser_new ();
  message = g_bytes_new_static (input, strlen (input));

  ret = cockpit_transport_parse_command (parser, message, &command, &channel, &options);
  g_bytes_unref (message);

  g_assert (ret == TRUE);
  g_assert_cmpstr (command, ==, "test");
  g_assert_cmpuint (channel, ==, 66);
  g_assert_cmpstr (json_object_get_string_member (options, "opt"), ==, "one");

  g_object_unref (parser);
}

static void
test_parse_command_no_channel (void)
{
  const gchar *input = "{ 'command': 'test', \"opt\": \"one\" }";
  JsonParser *parser;
  GBytes *message;
  guint channel;
  const gchar *command;
  JsonObject *options;
  gboolean ret;

  parser = json_parser_new ();
  message = g_bytes_new_static (input, strlen (input));

  ret = cockpit_transport_parse_command (parser, message, &command, &channel, &options);
  g_bytes_unref (message);

  g_assert (ret == TRUE);
  g_assert_cmpstr (command, ==, "test");
  g_assert_cmpuint (channel, ==, 0);
  g_assert_cmpstr (json_object_get_string_member (options, "opt"), ==, "one");

  g_object_unref (parser);
}

struct {
  const char *name;
  const char *json;
} bad_command_payloads[] = {
    { "no-command", "{ 'no-command': 'test' }", },
    { "empty-command", "{ 'command': '' }", },
    { "channel-bad", "{ 'command': 'test', 'channel', 'not-a-number' }", },
    { "invalid-json", "{ xxxxxxxxxxxxxxxxxxxxx", },
    { "not-an-object", "55", },
    { "negative-channel", "{ 'command': 'test', 'channel', -1 }", },
    { "zero-channel", "{ 'command': 'test', 'channel': 0 }", },
    { "large-channel", "{ 'command': 'test', 'channel': 5555555555 }", },
    { "string-channel", "{ 'command': 'test', 'channel': '5' }", },
};

static void
test_parse_command_bad (gconstpointer input)
{
  JsonParser *parser;
  GBytes *message;
  guint channel;
  const gchar *command;
  JsonObject *options;
  gboolean ret;

  cockpit_expect_warning ("*");

  parser = json_parser_new ();
  message = g_bytes_new_static (input, strlen (input));

  ret = cockpit_transport_parse_command (parser, message, &command, &channel, &options);
  g_bytes_unref (message);

  g_assert (ret == FALSE);

  g_object_unref (parser);

  cockpit_assert_expected ();
}

int
main (int argc,
      char *argv[])
{
  gint i;

  cockpit_test_init (&argc, &argv);

  g_test_add_func ("/transport/parse-frame", test_parse_frame);
  g_test_add_func ("/transport/parse-frame-bad", test_parse_frame_bad);

  g_test_add_func ("/transport/parse-command/normal", test_parse_command);
  g_test_add_func ("/transport/parse-command/no-channel", test_parse_command_no_channel);

  for (i = 0; i < G_N_ELEMENTS (bad_command_payloads); i++)
    {
      gchar *name = g_strdup_printf ("/transport/parse-command/%s", bad_command_payloads[i].name);
      g_test_add_data_func (name, bad_command_payloads[i].json, test_parse_command_bad);
      g_free (name);
    }

  g_test_add ("/transport/echo-message/child", TestCase,
              BUILDDIR "/mock-echo", setup_with_child,
              test_echo_and_close, teardown_transport);
  g_test_add ("/transport/echo-message/no-child", TestCase,
              NULL, setup_no_child,
              test_echo_and_close, teardown_transport);
  g_test_add ("/transport/echo-queue/child", TestCase,
              BUILDDIR "/mock-echo", setup_with_child,
              test_echo_queue, teardown_transport);
  g_test_add ("/transport/echo-queue/no-child", TestCase,
              NULL, setup_no_child,
              test_echo_queue, teardown_transport);
  g_test_add ("/transport/echo-large/child", TestCase,
              "cat", setup_with_child,
              test_echo_large, teardown_transport);
  g_test_add ("/transport/echo-large/no-child", TestCase,
              NULL, setup_no_child,
              test_echo_large, teardown_transport);

  g_test_add ("/transport/close-problem/child", TestCase,
              BUILDDIR "/mock-echo", setup_with_child,
              test_close_problem, teardown_transport);
  g_test_add ("/transport/close-problem/no-child", TestCase,
              NULL, setup_no_child,
              test_close_problem, teardown_transport);

  g_test_add ("/transport/terminate-problem", TestCase,
              BUILDDIR "/mock-echo", setup_with_child,
              test_terminate_problem, teardown_transport);

  g_test_add_func ("/transport/read-error", test_read_error);
  g_test_add_func ("/transport/write-error", test_write_error);
  g_test_add_func ("/transport/read-combined", test_read_combined);
  g_test_add_func ("/transport/read-truncated", test_read_truncated);

  return g_test_run ();
}
