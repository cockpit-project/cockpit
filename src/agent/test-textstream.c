
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

#include "cockpittextstream.h"

#include "cockpit/cockpitjson.h"
#include "cockpit/cockpittest.h"

#include <json-glib/json-glib.h>

#include <glib/gstdio.h>
#include <gio/gunixsocketaddress.h>

#include <sys/socket.h>
#include <errno.h>
#include <string.h>
#include <unistd.h>

/* -----------------------------------------------------------------------------
 * Mock
 */

static GType mock_transport_get_type (void) G_GNUC_CONST;

typedef struct {
  CockpitTransport parent;
  gboolean closed;
  gchar *problem;
  gchar *channel_sent;
  GBytes *payload_sent;
  JsonObject *control_sent;
}MockTransport;

typedef CockpitTransportClass MockTransportClass;

G_DEFINE_TYPE (MockTransport, mock_transport, COCKPIT_TYPE_TRANSPORT);

static void
mock_transport_init (MockTransport *self)
{
  self->channel_sent = NULL;
}

static void
mock_transport_get_property (GObject *object,
                             guint prop_id,
                             GValue *value,
                             GParamSpec *pspec)
{
  switch (prop_id)
    {
    case 1:
      g_value_set_string (value, "mock-name");
      break;
    default:
      g_assert_not_reached ();
      break;
    }
}

static void
mock_transport_set_property (GObject *object,
                             guint prop_id,
                             const GValue *value,
                             GParamSpec *pspec)
{
  switch (prop_id)
    {
    case 1:
      break;
    default:
      g_assert_not_reached ();
      break;
    }
}

static void
mock_transport_finalize (GObject *object)
{
  MockTransport *self = (MockTransport *)object;

  g_free (self->problem);
  if (self->payload_sent)
    g_bytes_unref (self->payload_sent);
  if (self->control_sent)
    json_object_unref (self->control_sent);

  G_OBJECT_CLASS (mock_transport_parent_class)->finalize (object);
}

static void
mock_transport_send (CockpitTransport *transport,
                     const gchar *channel_id,
                     GBytes *data)
{
  MockTransport *self = (MockTransport *)transport;
  GError *error = NULL;

  if (!channel_id)
    {
      g_assert (self->control_sent == NULL);
      self->control_sent = cockpit_json_parse_bytes (data, &error);
      g_assert_no_error (error);
    }
  else
    {
      g_assert (self->channel_sent == NULL);
      g_assert (self->payload_sent == NULL);
      self->channel_sent = g_strdup (channel_id);
      self->payload_sent = g_bytes_ref (data);
    }
}

static void
mock_transport_close (CockpitTransport *transport,
                      const gchar *problem)
{
  MockTransport *self = (MockTransport *)transport;
  g_assert (!self->closed);
  self->problem = g_strdup (problem);
  self->closed = TRUE;
  cockpit_transport_emit_closed (transport, problem);
}

static void
mock_transport_class_init (MockTransportClass *klass)
{
  GObjectClass *object_class = G_OBJECT_CLASS (klass);
  CockpitTransportClass *transport_class = COCKPIT_TRANSPORT_CLASS (klass);
  object_class->finalize = mock_transport_finalize;
  object_class->get_property = mock_transport_get_property;
  object_class->set_property = mock_transport_set_property;
  g_object_class_override_property (object_class, 1, "name");
  transport_class->send = mock_transport_send;
  transport_class->close = mock_transport_close;
}

/* -----------------------------------------------------------------------------
 * Test
 */

typedef struct {
  GSocket *listen_sock;
  GSource *listen_source;
  GSocket *conn_sock;
  GSource *conn_source;
  MockTransport *transport;
  CockpitChannel *channel;
  gchar *channel_problem;
  const gchar *unix_path;
  gchar *temp_file;
} TestCase;

static gboolean
on_socket_input (GSocket *socket,
                 GIOCondition cond,
                 gpointer user_data)
{
  gchar buffer[1024];
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
  GSocketAddress *address;
  GError *error = NULL;

  tc->unix_path = data;
  if (tc->unix_path == NULL)
    {
      tc->unix_path = tc->temp_file = g_strdup ("/tmp/cockpit-test-XXXXXX.sock");
      g_assert (close (g_mkstemp (tc->temp_file)) == 0);
      g_assert (g_unlink (tc->temp_file) == 0);
    }

  address = g_unix_socket_address_new (tc->unix_path);

  tc->listen_sock = g_socket_new (G_SOCKET_FAMILY_UNIX, G_SOCKET_TYPE_STREAM,
                                  G_SOCKET_PROTOCOL_DEFAULT, &error);
  g_assert_no_error (error);

  g_socket_bind (tc->listen_sock, address, TRUE, &error);
  g_assert_no_error (error);

  g_socket_listen (tc->listen_sock, &error);
  g_assert_no_error (error);

  tc->listen_source = g_socket_create_source (tc->listen_sock, G_IO_IN, NULL);
  g_source_set_callback (tc->listen_source, (GSourceFunc)on_socket_connection, tc, NULL);
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
  tc->channel = cockpit_text_stream_open (COCKPIT_TRANSPORT (tc->transport), "548", tc->unix_path);
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
  g_free (tc->temp_file);

  g_object_unref (tc->transport);

  if (tc->channel)
    {
      g_object_add_weak_pointer (G_OBJECT (tc->channel), (gpointer *)&tc->channel);
      g_object_unref (tc->channel);
      g_assert (tc->channel == NULL);
    }

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
      g_assert (expect_value != NULL);
      g_assert_cmpstr (json_object_get_string_member (options, expect_option), ==, expect_value);
  }
  va_end (va);
}


static void
test_echo (TestCase *tc,
           gconstpointer unused)
{
  GBytes *sent;

  sent = g_bytes_new ("Marmalaade!", 11);
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (tc->transport), "548", sent);

  while (!tc->transport->payload_sent)
    g_main_context_iteration (NULL, TRUE);

  g_assert (g_bytes_equal (sent, tc->transport->payload_sent));
  g_bytes_unref (sent);
}

static void
test_shutdown (TestCase *tc,
               gconstpointer unused)
{
  GError *error = NULL;

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
  expect_control_message (tc->transport->control_sent, "close", "548", "reason", "", NULL);
}

static void
test_close_normal (TestCase *tc,
                   gconstpointer unused)
{
  GBytes *sent;

  /* Wait until the socket has opened */
  while (tc->conn_sock == NULL)
    g_main_context_iteration (NULL, TRUE);

  sent = g_bytes_new ("Marmalaade!", 11);
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (tc->transport), "548", sent);
  cockpit_channel_close (tc->channel, NULL);

  /* Wait until channel closes */
  while (tc->channel_problem == NULL)
    g_main_context_iteration (NULL, TRUE);

  /* Should have sent payload and control */
  g_assert_cmpstr (tc->channel_problem, ==, "");
  g_assert (tc->transport->payload_sent != NULL);
  g_assert (g_bytes_equal (sent, tc->transport->payload_sent));
  g_bytes_unref (sent);
  expect_control_message (tc->transport->control_sent, "close", "548", "reason", "", NULL);
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
  g_assert (tc->transport->payload_sent == 0);
  expect_control_message (tc->transport->control_sent, "close", "548", "reason", "boooyah", NULL);
}

static void
test_spawn_simple (void)
{
  MockTransport *transport;
  CockpitChannel *channel;
  gchar *problem = NULL;
  JsonObject *options;
  JsonArray *array;
  GBytes *sent;

  transport = g_object_new (mock_transport_get_type (), NULL);

  options = json_object_new ();
  array = json_array_new ();
  json_array_add_string_element (array, "/bin/cat");
  json_object_set_array_member (options, "spawn", array);
  json_object_set_string_member (options, "payload", "text-stream");

  channel = g_object_new (COCKPIT_TYPE_TEXT_STREAM,
                          "options", options,
                          "id", "548",
                          "transport", transport,
                          NULL);
  g_signal_connect (channel, "closed", G_CALLBACK (on_closed_get_problem), &problem);
  json_object_unref (options);

  sent = g_bytes_new ("Marmalaade!", 11);
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (transport), "548", sent);
  cockpit_channel_close (channel, NULL);

  while (!transport->payload_sent)
    g_main_context_iteration (NULL, TRUE);
  g_assert (g_bytes_equal (sent, transport->payload_sent));
  g_bytes_unref (sent);

  while (!problem)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpstr (problem, ==, "");
  g_object_unref (channel);

  g_object_unref (transport);
}
static void
test_spawn_environ (void)
{
  MockTransport *transport;
  CockpitChannel *channel;
  gchar *problem = NULL;
  JsonObject *options;
  JsonArray *array;
  GString *string;
  gconstpointer data;
  gsize len;

  transport = g_object_new (mock_transport_get_type (), NULL);

  options = json_object_new ();

  array = json_array_new ();
  json_array_add_string_element (array, "/bin/sh");
  json_array_add_string_element (array, "-c");
  json_array_add_string_element (array, "set");
  json_object_set_array_member (options, "spawn", array);

  array = json_array_new ();
  json_array_add_string_element (array, "ENVIRON=Marmalaade");
  json_object_set_array_member (options, "environ", array);

  json_object_set_string_member (options, "payload", "text-stream");

  channel = g_object_new (COCKPIT_TYPE_TEXT_STREAM,
                          "options", options,
                          "id", "548",
                          "transport", transport,
                          NULL);
  g_signal_connect (channel, "closed", G_CALLBACK (on_closed_get_problem), &problem);
  cockpit_channel_close (channel, NULL);
  json_object_unref (options);

  string = g_string_new ("");
  while (!problem)
    {
      g_main_context_iteration (NULL, TRUE);
      if (transport->payload_sent)
        {
          data = g_bytes_get_data (transport->payload_sent, &len);
          g_string_append_len (string, data, len);
          g_bytes_unref (transport->payload_sent);
          transport->channel_sent = NULL;
          transport->payload_sent = NULL;
        }
    }

  g_assert_cmpstr (problem, ==, "");
  g_free (problem);

  cockpit_assert_strmatch (string->str, "*ENVIRON=*Marmalaade*");
  g_string_free (string, TRUE);

  g_object_unref (channel);
  g_object_unref (transport);
}

static void
test_spawn_status (void)
{
  MockTransport *transport;
  CockpitChannel *channel;
  gchar *problem = NULL;
  JsonObject *options;
  JsonArray *array;

  transport = g_object_new (mock_transport_get_type (), NULL);

  options = json_object_new ();

  array = json_array_new ();
  json_array_add_string_element (array, "/bin/sh");
  json_array_add_string_element (array, "-c");
  json_array_add_string_element (array, "exit 5");
  json_object_set_array_member (options, "spawn", array);

  json_object_set_string_member (options, "payload", "text-stream");

  channel = g_object_new (COCKPIT_TYPE_TEXT_STREAM,
                          "options", options,
                          "id", "548",
                          "transport", transport,
                          NULL);
  g_signal_connect (channel, "closed", G_CALLBACK (on_closed_get_problem), &problem);
  cockpit_channel_close (channel, NULL);
  json_object_unref (options);

  while (!problem)
    g_main_context_iteration (NULL, TRUE);

  g_assert (transport->control_sent);
  expect_control_message (transport->control_sent, "close", "548", "reason", "", NULL);
  g_assert_cmpint (json_object_get_int_member (transport->control_sent, "exit-status"), ==, 5);

  g_free (problem);

  g_object_unref (channel);
  g_object_unref (transport);
}

static void
test_spawn_pty (void)
{
  MockTransport *transport;
  CockpitChannel *channel;
  gchar *problem = NULL;
  JsonObject *options;
  JsonArray *array;
  GBytes *sent;
  GString *received;
  gconstpointer data;
  gsize len;

  transport = g_object_new (mock_transport_get_type (), NULL);

  options = json_object_new ();
  array = json_array_new ();
  json_array_add_string_element (array, "/bin/bash");
  json_array_add_string_element (array, "-i");
  json_object_set_array_member (options, "spawn", array);
  json_object_set_string_member (options, "payload", "text-stream");
  json_object_set_boolean_member (options, "pty", TRUE);

  channel = g_object_new (COCKPIT_TYPE_TEXT_STREAM,
                          "options", options,
                          "id", "548",
                          "transport", transport,
                          NULL);
  g_signal_connect (channel, "closed", G_CALLBACK (on_closed_get_problem), &problem);
  json_object_unref (options);

  sent = g_bytes_new ("echo booyah\nexit\n", 17);
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (transport), "548", sent);
  g_bytes_unref (sent);

  received = g_string_new ("");
  while (!problem)
    {
      g_main_context_iteration (NULL, TRUE);
      if (transport->payload_sent)
        {
          data = g_bytes_get_data (transport->payload_sent, &len);
          g_string_append_len (received, data, len);
          g_bytes_unref (transport->payload_sent);
          transport->channel_sent = NULL;
          transport->payload_sent = NULL;
        }
    }

  cockpit_assert_strmatch (received->str, "*booyah*");
  g_string_free (received, TRUE);

  g_assert_cmpstr (problem, ==, "");
  g_object_unref (channel);

  g_object_unref (transport);
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

  while (!tc->transport->payload_sent)
    g_main_context_iteration (NULL, TRUE);

  converted = g_bytes_new ("Oh \xef\xbf\xbd""Marma""\xef\xbf\xbd""laade!", 20);
  g_assert (g_bytes_equal (converted, tc->transport->payload_sent));
  g_bytes_unref (converted);
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

  while (!tc->transport->payload_sent)
    g_main_context_iteration (NULL, TRUE);

  converted = g_bytes_new ("\xef\xbf\xbd""Marmalaade!""\xef\xbf\xbd", 17);
  g_assert (g_bytes_equal (converted, tc->transport->payload_sent));
  g_bytes_unref (converted);
}

static void
test_fail_not_found (void)
{
  CockpitTransport *transport;
  CockpitChannel *channel;
  gchar *problem = NULL;

  cockpit_expect_log ("libcockpit", G_LOG_LEVEL_MESSAGE, "*couldn't connect*");

  transport = g_object_new (mock_transport_get_type (), NULL);
  channel = cockpit_text_stream_open (transport, "1", "/non-existent");
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
test_fail_not_authorized (void)
{
  CockpitTransport *transport;
  CockpitChannel *channel;
  gchar *unix_path;
  gchar *problem = NULL;
  gint fd;

  if (geteuid () == 0)
    {
      cockpit_test_skip ("running as root");
      return;
    }

  cockpit_expect_log ("libcockpit", G_LOG_LEVEL_MESSAGE, "*couldn't connect*");

  unix_path = g_strdup ("/tmp/cockpit-test-XXXXXX.sock");
  fd = g_mkstemp (unix_path);
  g_assert_cmpint (fd, >=, 0);

  /* Take away all permissions from the file */
  g_assert_cmpint (fchmod (fd, 0000), ==, 0);

  transport = g_object_new (mock_transport_get_type (), NULL);
  channel = cockpit_text_stream_open (transport, "1", unix_path);
  g_assert (channel != NULL);

  /* Even through failure is on open, should not have closed yet */
  g_signal_connect (channel, "closed", G_CALLBACK (on_closed_get_problem), &problem);

  while (problem == NULL)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpstr (problem, ==, "not-authorized");
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

  g_test_add ("/text-stream/echo", TestCase, NULL,
              setup_channel, test_echo, teardown);
  g_test_add ("/text-stream/shutdown", TestCase, NULL,
              setup_channel, test_shutdown, teardown);
  g_test_add ("/text-stream/close-normal", TestCase, NULL,
              setup_channel, test_close_normal, teardown);
  g_test_add ("/text-stream/close-problem", TestCase, NULL,
              setup_channel, test_close_problem, teardown);
  g_test_add ("/text-stream/invalid-send", TestCase, NULL,
              setup_channel, test_send_invalid, teardown);
  g_test_add ("/text-stream/invalid-recv", TestCase, NULL,
              setup_channel, test_recv_invalid, teardown);

  g_test_add_func ("/text-stream/spawn/simple", test_spawn_simple);
  g_test_add_func ("/text-stream/spawn/status", test_spawn_status);
  g_test_add_func ("/text-stream/spawn/environ", test_spawn_environ);
  g_test_add_func ("/text-stream/spawn/pty", test_spawn_pty);

  g_test_add_func ("/test-stream/fail/not-found", test_fail_not_found);
  g_test_add_func ("/test-stream/fail/not-authorized", test_fail_not_authorized);

  return g_test_run ();
}
