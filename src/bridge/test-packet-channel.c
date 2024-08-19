
/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2019 Red Hat, Inc.
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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

#include "config.h"

#include "cockpitpacketchannel.h"

#include "common/cockpitjson.h"
#include "testlib/cockpittest.h"
#include "testlib/mock-transport.h"

#include <json-glib/json-glib.h>

#include <glib/gstdio.h>
#include <gio/gunixsocketaddress.h>

#include <sys/socket.h>
#include <errno.h>
#include <string.h>
#include <unistd.h>

/* -----------------------------------------------------------------------------
 * Test
 */

typedef struct {
  GSocket *listen_sock;
  GSource *listen_source;
  guint listen_tag;
  GSocket *conn_sock;
  GSource *conn_source;
  MockTransport *transport;
  CockpitChannel *channel;
  gchar *channel_problem;
  gchar *unix_path;
  gchar *temp_file;
} TestCase;

typedef struct {
  const gchar *payload;
  gboolean delay_listen;
} Fixture;

static gboolean
on_socket_input (GSocket *socket,
                 GIOCondition cond,
                 gpointer user_data)
{
  gchar buffer[128 * 1024];
  GError *error = NULL;
  gssize ret, wret;

  ret = g_socket_receive (socket, buffer, sizeof (buffer), NULL, &error);
  g_assert_no_error (error);

  if (ret == 0)
    {
      g_socket_shutdown (socket, FALSE, TRUE, &error);
      g_assert_no_error (error);
      return FALSE;
    }

  g_assert (ret > 0);
  wret = g_socket_send (socket, buffer, ret, NULL, &error);
  g_assert_no_error (error);
  g_assert (wret == ret);
  return TRUE;
}

static gboolean
on_socket_connection (GSocket *socket,
                      GIOCondition cond,
                      gpointer user_data)
{
  TestCase *tc = user_data;
  GError *error = NULL;

  g_assert (tc->conn_source == NULL);
  tc->conn_sock = g_socket_accept (tc->listen_sock, NULL, &error);
  g_assert_no_error (error);

  tc->conn_source = g_socket_create_source (tc->conn_sock, G_IO_IN, NULL);
  g_source_set_callback (tc->conn_source, (GSourceFunc)on_socket_input, tc, NULL);
  g_source_attach (tc->conn_source, NULL);

  /* Only one connection */
  return FALSE;
}

static void
setup (TestCase *tc,
       gconstpointer data)
{
  const Fixture *fixture = data;
  GSocketAddress *address;
  GError *error = NULL;

  tc->temp_file = g_strdup ("/tmp/cockpit-test-XXXXXX");
  g_assert (close (g_mkstemp (tc->temp_file)) == 0);
  tc->unix_path = g_strconcat (tc->temp_file, ".sock", NULL);

  address = g_unix_socket_address_new (tc->unix_path);

  tc->listen_sock = g_socket_new (G_SOCKET_FAMILY_UNIX, G_SOCKET_TYPE_SEQPACKET,
                                  G_SOCKET_PROTOCOL_DEFAULT, &error);
  g_assert_no_error (error);

  g_socket_bind (tc->listen_sock, address, TRUE, &error);
  g_assert_no_error (error);

  g_socket_listen (tc->listen_sock, &error);
  g_assert_no_error (error);

  tc->listen_source = g_socket_create_source (tc->listen_sock, G_IO_IN, NULL);
  g_source_set_callback (tc->listen_source, (GSourceFunc)on_socket_connection, tc, NULL);

  if (!fixture || !fixture->delay_listen)
    g_source_attach (tc->listen_source, NULL);

  g_object_unref (address);

  tc->transport = g_object_new (mock_transport_get_type (), NULL);
}

static void
on_closed_get_problem (CockpitChannel *channel,
                       const gchar *problem,
                       gpointer user_data)
{
  gchar **retval = user_data;
  g_assert (retval != NULL && *retval == NULL);
  *retval = g_strdup (problem ? problem : "");
}

static void
setup_channel (TestCase *tc,
               gconstpointer data)
{
  setup (tc, data);

  tc->channel = cockpit_packet_channel_open (COCKPIT_TRANSPORT (tc->transport), "548", tc->unix_path);
  g_signal_connect (tc->channel, "closed", G_CALLBACK (on_closed_get_problem), &tc->channel_problem);
}

static void
teardown (TestCase *tc,
          gconstpointer data)
{
  if (tc->conn_source)
    {
      g_source_destroy (tc->conn_source);
      g_source_unref (tc->conn_source);
    }
  if (tc->listen_source)
    {
      g_source_destroy (tc->listen_source);
      g_source_unref (tc->listen_source);
    }
  g_clear_object (&tc->listen_sock);
  g_clear_object (&tc->conn_sock);

  g_unlink (tc->unix_path);
  g_free (tc->unix_path);
  g_unlink (tc->temp_file);
  g_free (tc->temp_file);

  g_object_unref (tc->transport);

  if (tc->channel)
    {
      g_object_add_weak_pointer (G_OBJECT (tc->channel), (gpointer *)&tc->channel);
      g_object_unref (tc->channel);
      g_assert (tc->channel == NULL);
    }

  g_free (tc->channel_problem);

  cockpit_assert_expected ();
}

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


static void
test_echo (TestCase *tc,
           gconstpointer unused)
{
  GBytes *payload;
  GBytes *sent;

  payload = g_bytes_new ("Marmalaade!", 11);
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (tc->transport), "548", payload);
  g_bytes_unref (payload);

  while (mock_transport_count_sent (tc->transport) < 2)
    g_main_context_iteration (NULL, TRUE);

  sent = mock_transport_pop_channel (tc->transport, "548");
  cockpit_assert_bytes_eq (sent, "Marmalaade!", 11);
}

static void
test_large (TestCase *tc,
           gconstpointer unused)
{
  JsonObject *object;
  GBytes *sent;
  GBytes *options;
  GBytes *a, *b, *c;
  gchar *big;
  gchar *too_big;
  gchar *maximum;

  /* Send something big: Should make it through */
  big = g_strnfill (32 * 1024, 'a');
  a = g_bytes_new_take (big, strlen (big));
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (tc->transport), "548", a);

  /* Send something too big: Should be truncated */
  too_big = g_strnfill (80 * 1024, 'b');
  b = g_bytes_new_take (too_big, strlen (too_big));
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (tc->transport), "548", b);

  while (mock_transport_count_sent (tc->transport) < 3)
    g_main_context_iteration (NULL, TRUE);

  /* Set the max-size to massive */
  object = cockpit_transport_build_json ("channel", "548", "command", "options", NULL);
  json_object_set_int_member (object, "max-size", 128 * 1024);
  options = cockpit_json_write_bytes (object);
  json_object_unref (object);
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (tc->transport), NULL, options);

  /* Send something too big again: This time not truncated */
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (tc->transport), "548", b);

  /* Lastly send the full maximum */
  maximum = g_strnfill (128 * 1024, 'c');
  c = g_bytes_new_take (maximum, strlen (maximum));
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (tc->transport), "548", c);

  while (mock_transport_count_sent (tc->transport) < 5)
    g_main_context_iteration (NULL, TRUE);

  sent = mock_transport_pop_channel (tc->transport, "548");
  cockpit_assert_bytes_eq (sent, big, strlen (big));

  sent = mock_transport_pop_channel (tc->transport, "548");
  cockpit_assert_bytes_eq (sent, too_big, 64 * 1024); /* Truncated */

  sent = mock_transport_pop_channel (tc->transport, "548");
  cockpit_assert_bytes_eq (sent, too_big, strlen (too_big));

  sent = mock_transport_pop_channel (tc->transport, "548");
  cockpit_assert_bytes_eq (sent, maximum, strlen (maximum));

  g_bytes_unref (a);
  g_bytes_unref (b);
  g_bytes_unref (c);
  g_bytes_unref (options);
}

static const Fixture fixture_connect_in_progress = { .delay_listen = TRUE };

static gboolean
on_idle_listen (gpointer data)
{
  TestCase *tc = data;
  g_source_attach (tc->listen_source, NULL);
  return FALSE;
}

static void
test_connect_in_progress (TestCase *tc,
                          gconstpointer unused)
{
  GBytes *payload;
  GBytes *sent;

  payload = g_bytes_new ("Marmalaade!", 11);
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (tc->transport), "548", payload);
  g_bytes_unref (payload);

  /* Attach listen source when idle */
  g_idle_add (on_idle_listen, tc);

  while (mock_transport_count_sent (tc->transport) < 2)
    g_main_context_iteration (NULL, TRUE);

  sent = mock_transport_pop_channel (tc->transport, "548");
  cockpit_assert_bytes_eq (sent, "Marmalaade!", 11);
}


static void
test_shutdown (TestCase *tc,
               gconstpointer unused)
{
  GBytes *payload;
  GError *error = NULL;
  JsonObject *sent;

  payload = cockpit_transport_build_control ("channel", "548", "command", "done", NULL);
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (tc->transport), NULL, payload);
  g_bytes_unref (payload);

  /* Wait until the socket has opened */
  while (tc->conn_sock == NULL)
    g_main_context_iteration (NULL, TRUE);

  /*
   * Close down the write end of the socket (what
   * CockpitPacketChannel is reading from)
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
  g_bytes_unref (payload);

  /* Wait until channel closes */
  while (tc->channel_problem == NULL)
    g_main_context_iteration (NULL, TRUE);

  /* Shouldn't have had a chance to send message */
  g_assert_cmpstr (tc->channel_problem, ==, "");
  sent = mock_transport_pop_channel (tc->transport, "548");
  g_assert (sent == NULL);

  control = mock_transport_pop_control (tc->transport);
  expect_control_message (control, "ready", "548", NULL);

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
test_recv_invalid (TestCase *tc,
                   gconstpointer unused)
{
  GError *error = NULL;
  GBytes *converted;

  /* Wait until the socket has opened */
  while (tc->conn_sock == NULL)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpint (g_socket_send (tc->conn_sock, "\x00Marmalaade!\x00", 13, NULL, &error), ==, 13);
  g_assert_no_error (error);

  while (mock_transport_count_sent (tc->transport) < 2)
    g_main_context_iteration (NULL, TRUE);

  converted = g_bytes_new ("\xef\xbf\xbd""Marmalaade!""\xef\xbf\xbd", 17);
  g_assert (g_bytes_equal (converted, mock_transport_pop_channel (tc->transport, "548")));
  g_bytes_unref (converted);
}


static gboolean
add_remainder (gpointer user_data)
{
  GSocket *socket = user_data;
  GError *error = NULL;
  g_assert_cmpint (g_socket_send (socket, "\x94\x80", 2, NULL, &error), ==, 2);
  g_assert_no_error (error);
  return FALSE;
}

static void
print_gbytes (GBytes *bytes)
{
    gsize i, len;
    const char* data;

    data = g_bytes_get_data (bytes, &len);
    g_assert (data);
    for (i = 0; i < len; ++i)
      g_printf ("%X", data[i]);
    puts("");
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

static void
test_recv_valid_batched (TestCase *tc,
                         gconstpointer unused)
{
  GError *error = NULL;
  GBytes *converted;
  GBytes *received;

  /* Wait until the socket has opened */
  while (tc->conn_sock == NULL)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpint (g_socket_send (tc->conn_sock, "Marmalaade!\xe2", 12, NULL, &error), ==, 12);
  g_assert_no_error (error);

  g_timeout_add (100, add_remainder, tc->conn_sock);

  while (mock_transport_count_sent (tc->transport) < 2)
    g_main_context_iteration (NULL, TRUE);

  converted = g_bytes_new ("Marmalaade!\xe2\x94\x80", 14);
  received = mock_transport_combine_output (tc->transport, "548", NULL);
  if (!g_bytes_equal (converted, received))
    {
      g_test_fail ();
      puts ("ERROR: unexpected output\nconverted:");
      print_gbytes (converted);
      puts ("received:");
      print_gbytes (received);
    }
  g_bytes_unref (converted);
  g_bytes_unref (received);
}

static void
test_fail_not_found (void)
{
  CockpitTransport *transport;
  CockpitChannel *channel;
  gchar *problem = NULL;

  cockpit_expect_message ("*couldn't connect*");

  transport = g_object_new (mock_transport_get_type (), NULL);
  channel = cockpit_packet_channel_open (transport, "1", "/non-existent");
  g_assert (channel != NULL);

  /* Even through failure is on open, should not have closed yet */
  g_signal_connect (channel, "closed", G_CALLBACK (on_closed_get_problem), &problem);

  while (problem == NULL)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpstr (problem, ==, "not-found");
  g_free (problem);
  g_object_unref (channel);
  g_object_unref (transport);

  cockpit_assert_expected ();
}

static void
test_fail_access_denied (void)
{
  CockpitTransport *transport;
  CockpitChannel *channel;
  gchar *unix_path;
  gchar *problem = NULL;
  gint fd;

  if (geteuid () == 0)
    {
      g_test_skip ("running as root");
      return;
    }

  cockpit_expect_message ("*couldn't connect*");

  unix_path = g_strdup ("/tmp/cockpit-test-XXXXXX.sock");
  fd = g_mkstemp (unix_path);
  g_assert_cmpint (fd, >=, 0);

  /* Take away all permissions from the file */
  g_assert_cmpint (fchmod (fd, 0000), ==, 0);

  transport = g_object_new (mock_transport_get_type (), NULL);
  channel = cockpit_packet_channel_open (transport, "1", unix_path);
  g_assert (channel != NULL);

  /* Even through failure is on open, should not have closed yet */
  g_signal_connect (channel, "closed", G_CALLBACK (on_closed_get_problem), &problem);

  while (problem == NULL)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpstr (problem, ==, "access-denied");
  g_free (problem);
  g_free (unix_path);
  close (fd);
  g_object_unref (channel);
  g_object_unref (transport);

  cockpit_assert_expected ();
}

int
main (int argc,
      char *argv[])
{
  cockpit_test_init (&argc, &argv);

  g_test_add ("/packet-channel/echo", TestCase, NULL,
              setup_channel, test_echo, teardown);
  g_test_add ("/packet-channel/large", TestCase, NULL,
              setup_channel, test_large, teardown);
  g_test_add ("/packet-channel/connect-in-progress",
              TestCase, &fixture_connect_in_progress,
              setup_channel, test_connect_in_progress, teardown);
  g_test_add ("/packet-channel/shutdown", TestCase, NULL,
              setup_channel, test_shutdown, teardown);
  g_test_add ("/packet-channel/close-normal", TestCase, NULL,
              setup_channel, test_close_normal, teardown);
  g_test_add ("/packet-channel/close-problem", TestCase, NULL,
              setup_channel, test_close_problem, teardown);
  g_test_add ("/packet-channel/invalid-send", TestCase, NULL,
              setup_channel, test_send_invalid, teardown);
  g_test_add ("/packet-channel/invalid-recv", TestCase, NULL,
              setup_channel, test_recv_invalid, teardown);
  g_test_add ("/packet-channel/valid-recv-batched", TestCase, NULL,
              setup_channel, test_recv_valid_batched, teardown);

  g_test_add_func ("/packet-channel/fail/not-found", test_fail_not_found);
  g_test_add_func ("/packet-channel/fail/access-denied", test_fail_access_denied);

  return g_test_run ();
}
