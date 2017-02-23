
/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
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

#include "cockpittty.h"

#include "mock-transport.h"

#include "common/cockpitjson.h"
#include "common/cockpittest.h"
#include "common/cockpitunixfd.h"

#include <json-glib/json-glib.h>

#include <sys/socket.h>
#include <sys/wait.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

typedef struct {
  gint tty;
  MockTransport *transport;
  CockpitChannel *channel;
  gchar *channel_problem;
  JsonObject *options;
} TestCase;

static void
setup (TestCase *tc,
       gconstpointer data)
{
  const gchar *tty_name;

  tty_name = ctermid (NULL);
  g_assert_cmpstr (tty_name, !=, NULL);

  tc->tty = open (tty_name, O_RDWR | O_NONBLOCK);
  g_assert (tc->tty >= 0);

  tc->transport = g_object_new (mock_transport_get_type (), NULL);
  tc->options = json_object_new ();
}

static void
teardown (TestCase *tc,
          gconstpointer data)
{
  json_object_unref (tc->options);
  g_object_unref (tc->transport);
  close (tc->tty);
  g_free (tc->channel_problem);

  cockpit_assert_expected ();
}

#if 0
static void
on_closed_get_problem (CockpitChannel *channel,
                       const gchar *problem,
                       gpointer user_data)
{
  gchar **retval = user_data;
  g_assert (retval != NULL && *retval == NULL);
  *retval = g_strdup (problem ? problem : "");
}

g_signal_connect (tc->channel, "closed", G_CALLBACK (on_closed_get_problem), &tc->channel_problem);

static void
expect_control_message (JsonObject *options,
                        const gchar *command,
                        const gchar *expected_channel,
                        ...) G_GNUC_NULL_TERMINATED;

static void
expect_control_message (JsonObject *options,
                        const gchar *expected_command,
                        const gchar *expected_channel,
                        ...)
{
  const gchar *expect_option;
  const gchar *expect_value;
  const gchar *value;
  JsonNode *node;
  va_list va;

  g_assert (options != NULL);
  g_assert_cmpstr (json_object_get_string_member (options, "command"), ==, expected_command);
  g_assert_cmpstr (json_object_get_string_member (options, "channel"), ==, expected_channel);

  va_start (va, expected_channel);
  for (;;) {
      expect_option = va_arg (va, const gchar *);
      if (!expect_option)
        break;
      expect_value = va_arg (va, const gchar *);

      value = NULL;
      node = json_object_get_member (options, expect_option);
      if (node && JSON_NODE_HOLDS_VALUE (node) && json_node_get_value_type (node) == G_TYPE_STRING)
        value = json_node_get_string (node);

      g_assert_cmpstr (value, ==, expect_value);
  }
  va_end (va);
}
#endif

static gboolean
read_string (gint fd,
             GIOCondition cond,
             gpointer user_data)
{
  GString *string = user_data;
  ssize_t res;
  gchar ch;

  res = read (fd, &ch, 1);
  if (res < 0)
    {
      g_assert (errno == EINTR || errno == EAGAIN);
    }
  else
    {
      g_assert (res == 1);
      g_string_append_c (string, ch);
    }
  return TRUE;
}

static gboolean
write_string (gint fd,
              GIOCondition cond,
              gpointer user_data)
{
  GString *string = user_data;
  ssize_t res = 0;

  if (string->len > 0)
    res = write (fd, string->str, string->len);
  if (res < 0)
    {
      g_assert (errno == EINTR || errno == EAGAIN);
    }
  else
    {
      g_string_erase (string, 0, res);
    }
  return string->len > 0;
}

static void
test_read (TestCase *tc,
           gconstpointer unused)
{
  CockpitChannel *channel1;
  CockpitChannel *channel2;
  GString *string;
  GBytes *sent;

  channel1 = g_object_new (COCKPIT_TYPE_TTY_CHANNEL,
                           "transport", tc->transport,
                           "id", "1",
                           "options", tc->options,
                           NULL);

  channel2 = g_object_new (COCKPIT_TYPE_TTY_CHANNEL,
                           "transport", tc->transport,
                           "id", "2",
                           "options", tc->options,
                           NULL);

  string = g_string_new ("hello");
  cockpit_unix_fd_add (tc->tty, G_IO_OUT, write_string, string);

  while (mock_transport_count_sent (tc->transport) < 4)
    g_main_context_iteration (NULL, TRUE);

  sent = mock_transport_pop_channel (tc->transport, "1");
  g_assert (sent != NULL);
  cockpit_assert_bytes_eq (sent, "hello", 5);

  sent = mock_transport_pop_channel (tc->transport, "2");
  g_assert (sent != NULL);
  cockpit_assert_bytes_eq (sent, "hello", 5);

  g_object_unref (channel1);
  g_object_unref (channel2);
  g_string_free (string, TRUE);
}

static void
test_write (TestCase *tc,
            gconstpointer unused)
{
  GBytes *payload;
  CockpitChannel *channel1;
  CockpitChannel *channel2;
  JsonObject *options;
  GString *string;

  channel1 = g_object_new (COCKPIT_TYPE_TTY_CHANNEL,
                           "transport", tc->transport,
                           "id", "1",
                           "options", tc->options,
                           NULL);
  cockpit_channel_prepare (channel1);

  options = json_object_new ();
  json_object_set_boolean_member (options, "claim", TRUE);
  channel2 = g_object_new (COCKPIT_TYPE_TTY_CHANNEL,
                           "transport", tc->transport,
                           "id", "2",
                           "options", options,
                           NULL);
  cockpit_channel_prepare (channel2);
  json_object_unref (options);

  payload = g_bytes_new ("Zero", 4);
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (tc->transport), "1", payload);
  g_bytes_unref (payload);

  payload = g_bytes_new ("ZeroG2\n", 7);
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (tc->transport), "2", payload);
  g_bytes_unref (payload);

  payload = g_bytes_new ("G1\n", 3);
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (tc->transport), "1", payload);
  g_bytes_unref (payload);

  string = g_string_new ("");
  cockpit_unix_fd_add (tc->tty, G_IO_IN, read_string, string);

  while (string->len != 7)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpstr (string->str, ==, "ZeroG2\n");

  g_object_unref (channel1);
  g_object_unref (channel2);
  g_string_free (string, TRUE);
}

#if 0

static void
test_shutdown (TestCase *tc,
               gconstpointer unused)
{
  GError *error = NULL;
  JsonObject *sent;

  /* Wait until the socket has opened */
  while (tc->conn_sock == NULL)
    g_main_context_iteration (NULL, TRUE);

  /*
   * Close down the write end of the socket (what
   * CockpitTextStream is reading from)
   */
  g_socket_shutdown (tc->conn_sock, FALSE, TRUE, &error);
  g_assert_no_error (error);

  while (tc->channel_problem == NULL)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpstr (tc->channel_problem, ==, "");
  sent = mock_transport_pop_control (tc->transport);
  expect_control_message (sent, "ready", "548", NULL);
  sent = mock_transport_pop_control (tc->transport);
  expect_control_message (sent, "done", "548", NULL);

  sent = mock_transport_pop_control (tc->transport);
  expect_control_message (sent, "close", "548", "problem", NULL, NULL);
}

static void
test_close_normal (TestCase *tc,
                   gconstpointer unused)
{
  GBytes *payload;
  GBytes *sent;
  JsonObject *control;

  /* Wait until the socket has opened */
  while (tc->conn_sock == NULL)
    g_main_context_iteration (NULL, TRUE);

  payload = g_bytes_new ("Marmalaade!", 11);
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (tc->transport), "548", payload);
  cockpit_channel_close (tc->channel, NULL);

  /* Wait until channel closes */
  while (tc->channel_problem == NULL)
    g_main_context_iteration (NULL, TRUE);

  /* Should have sent payload and control */
  g_assert_cmpstr (tc->channel_problem, ==, "");
  sent = mock_transport_pop_channel (tc->transport, "548");
  g_assert (sent != NULL);
  g_assert (g_bytes_equal (sent, payload));
  g_bytes_unref (payload);

  control = mock_transport_pop_control (tc->transport);
  expect_control_message (control, "ready", "548", NULL);
  control = mock_transport_pop_control (tc->transport);
  expect_control_message (control, "done", "548", NULL);

  control = mock_transport_pop_control (tc->transport);
  expect_control_message (control, "close", "548", "problem", NULL, NULL);
}

static void
test_close_problem (TestCase *tc,
                    gconstpointer unused)
{
  GBytes *sent;

  /* Wait until the socket has opened */
  while (tc->conn_sock == NULL)
    g_main_context_iteration (NULL, TRUE);

  sent = g_bytes_new ("Marmalaade!", 11);
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (tc->transport), "548", sent);
  g_bytes_unref (sent);
  cockpit_channel_close (tc->channel, "boooyah");

  /* Wait until channel closes */
  while (tc->channel_problem == NULL)
    g_main_context_iteration (NULL, TRUE);

  /* Should have sent no payload and control */
  g_assert_cmpstr (tc->channel_problem, ==, "boooyah");
  g_assert (mock_transport_pop_channel (tc->transport, "548") == NULL);
  expect_control_message (mock_transport_pop_control (tc->transport), "ready", "548", NULL);
  expect_control_message (mock_transport_pop_control (tc->transport),
                          "close", "548", "problem", "boooyah", NULL);
}

static void
test_send_invalid (TestCase *tc,
                   gconstpointer unused)
{
  GBytes *converted;
  GBytes *sent;

  sent = g_bytes_new ("Oh \x00Marma\x00laade!", 16);
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (tc->transport), "548", sent);
  g_bytes_unref (sent);

  while (mock_transport_count_sent (tc->transport) < 2)
    g_main_context_iteration (NULL, TRUE);

  converted = g_bytes_new ("Oh \xef\xbf\xbd""Marma""\xef\xbf\xbd""laade!", 20);
  g_assert (g_bytes_equal (converted, mock_transport_pop_channel (tc->transport, "548")));
  g_bytes_unref (converted);
}
#endif

int
main (int argc,
      char *argv[])
{
  int status;
  pid_t pid;
  gint ret;

  cockpit_test_init (&argc, &argv);

  g_test_add ("/tty/read", TestCase, NULL,
              setup, test_read, teardown);
  g_test_add ("/tty/write", TestCase, NULL,
              setup, test_write, teardown);

  pid = fork ();
  if (pid == 0)
    {
      setsid ();
      cockpit_tty_startup ();
      ret = g_test_run ();
      cockpit_tty_cleanup ();
      exit (ret);
    }

  waitpid (pid, &status, 0);
  return status;
}
