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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

#include "config.h"

#include "cockpitchannel.h"
#include "cockpitjson.h"
#include "cockpitpipe.h"
#include "cockpitpipetransport.h"

#include "testlib/cockpittest.h"
#include "testlib/mock-pressure.h"
#include "testlib/mock-transport.h"

#include <json-glib/json-glib.h>

#include <gio/gio.h>

#include <sys/types.h>
#include <sys/socket.h>
#include <string.h>

/* ----------------------------------------------------------------------------
 * Mock
 */

static GType mock_echo_channel_get_type (void) G_GNUC_CONST;

typedef struct {
    CockpitChannel parent;
    gboolean close_called;
} MockEchoChannel;

typedef CockpitChannelClass MockEchoChannelClass;

G_DEFINE_TYPE (MockEchoChannel, mock_echo_channel, COCKPIT_TYPE_CHANNEL);

static void
mock_echo_channel_recv (CockpitChannel *channel,
                        GBytes *message)
{
  cockpit_channel_send (channel, message, FALSE);
}

static gboolean
mock_echo_channel_control (CockpitChannel *channel,
                           const gchar *command,
                           JsonObject *options)
{
  cockpit_channel_control (channel, command, options);
  return TRUE;
}

static void
mock_echo_channel_close (CockpitChannel *channel,
                         const gchar *problem)
{
  MockEchoChannel *self = (MockEchoChannel *)channel;
  self->close_called = TRUE;
  COCKPIT_CHANNEL_CLASS (mock_echo_channel_parent_class)->close (channel, problem);
}

static void
mock_echo_channel_init (MockEchoChannel *self)
{

}

static void
mock_echo_channel_class_init (MockEchoChannelClass *klass)
{
  CockpitChannelClass *channel_class = COCKPIT_CHANNEL_CLASS (klass);
  channel_class->recv = mock_echo_channel_recv;
  channel_class->control = mock_echo_channel_control;
  channel_class->close = mock_echo_channel_close;
}

static CockpitChannel *
mock_echo_channel_open (CockpitTransport *transport,
                        const gchar *channel_id)
{
  CockpitChannel *channel;
  JsonObject *options;

  g_assert (channel_id != NULL);

  options = json_object_new ();
  channel = g_object_new (mock_echo_channel_get_type (),
                          "transport", transport,
                          "id", channel_id,
                          "options", options,
                          NULL);

  json_object_unref (options);
  return channel;
}

static GType mock_null_channel_get_type (void) G_GNUC_CONST;

typedef CockpitChannel MockNullChannel;
typedef CockpitChannelClass MockNullChannelClass;

G_DEFINE_TYPE (MockNullChannel, mock_null_channel, COCKPIT_TYPE_CHANNEL);

static void
mock_null_channel_init (MockNullChannel *self)
{

}

static void
mock_null_channel_class_init (MockNullChannelClass *klass)
{

}

/* ----------------------------------------------------------------------------
 * Testing
 */

typedef struct {
  MockTransport *transport;
  CockpitChannel *channel;
} TestCase;

static void
setup (TestCase *tc,
       gconstpointer unused)
{
  tc->transport = g_object_new (mock_transport_get_type (), NULL);
  tc->channel = mock_echo_channel_open (COCKPIT_TRANSPORT (tc->transport), "554");
  while (g_main_context_iteration (NULL, FALSE));
}

static void
teardown (TestCase *tc,
          gconstpointer unused)
{
  g_object_add_weak_pointer (G_OBJECT (tc->channel), (gpointer *)&tc->channel);
  g_object_add_weak_pointer (G_OBJECT (tc->transport), (gpointer *)&tc->transport);
  g_object_unref (tc->channel);
  g_object_unref (tc->transport);
  g_assert (tc->channel == NULL);
  g_assert (tc->transport == NULL);
}

static void
test_recv_and_send (TestCase *tc,
                    gconstpointer unused)
{
  GBytes *sent;
  GBytes *payload;

  /* Ready to go */
  cockpit_channel_ready (tc->channel, NULL);

  payload = g_bytes_new ("Yeehaw!", 7);
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (tc->transport), "554", payload);

  sent = mock_transport_pop_channel (tc->transport, "554");
  g_assert (sent != NULL);

  g_assert (g_bytes_equal (payload, sent));
  g_bytes_unref (payload);
}

static void
test_recv_and_queue (TestCase *tc,
                     gconstpointer unused)
{
  GBytes *payload;
  GBytes *control;
  const gchar *data;
  GBytes *sent;
  JsonObject *object;

  payload = g_bytes_new ("Yeehaw!", 7);
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (tc->transport), "554", payload);

  data = "{ \"command\": \"blah\", \"channel\": \"554\" }";
  control = g_bytes_new_static (data, strlen (data));
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (tc->transport), NULL, control);

  /* Shouldn't have received it yet */
  g_assert_cmpuint (mock_transport_count_sent (tc->transport), ==, 0);

  /* Ready to go */
  cockpit_channel_ready (tc->channel, NULL);

  /* The control message */
  object = mock_transport_pop_control (tc->transport);
  g_assert (object != NULL);
  cockpit_assert_json_eq (object, data);
  g_bytes_unref (control);

  sent = mock_transport_pop_channel (tc->transport, "554");
  g_assert (sent != NULL);
  g_assert (g_bytes_equal (payload, sent));
  g_bytes_unref (payload);
}

static void
test_ready_message (TestCase *tc,
                    gconstpointer unused)
{
  JsonObject *message;
  JsonObject *sent;

  message = json_object_new ();
  json_object_set_string_member (message, "mop", "bucket");

  /* Ready to go */
  cockpit_channel_ready (tc->channel, message);
  json_object_unref (message);

  sent = mock_transport_pop_control (tc->transport);
  cockpit_assert_json_eq (sent,
                  "{ \"command\": \"ready\", \"channel\": \"554\", \"mop\": \"bucket\" }");
}

static void
test_close_immediately (TestCase *tc,
                        gconstpointer unused)
{
  GBytes *payload;
  JsonObject *sent;

  payload = g_bytes_new ("Yeehaw!", 7);
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (tc->transport), "554", payload);
  g_bytes_unref (payload);

  /* Shouldn't have received it yet */
  g_assert_cmpuint (mock_transport_count_sent (tc->transport), ==, 0);

  /* Now close without getting anything */
  cockpit_channel_close (tc->channel, "bad-boy");

  g_assert (mock_transport_pop_channel (tc->transport, "554") == NULL);
  g_assert_cmpuint (mock_transport_count_sent (tc->transport), ==, 1);

  sent = mock_transport_pop_control (tc->transport);
  g_assert (sent != NULL);

  cockpit_assert_json_eq (sent,
                  "{ \"command\": \"close\", \"channel\": \"554\", \"problem\": \"bad-boy\"}");
}

static void
test_close_option (TestCase *tc,
                   gconstpointer unused)
{
  JsonObject *sent;
  JsonObject *options;

  options = cockpit_channel_close_options (tc->channel);
  json_object_set_string_member (options, "option", "four");
  cockpit_channel_close (tc->channel, "bad-boy");

  g_assert_cmpuint (mock_transport_count_sent (tc->transport), ==, 1);

  sent = mock_transport_pop_control (tc->transport);
  g_assert (sent != NULL);

  cockpit_assert_json_eq (sent,
                  "{ \"command\": \"close\", \"channel\": \"554\", \"problem\": \"bad-boy\", \"option\": \"four\" }");
}

static void
test_close_json_option (TestCase *tc,
                        gconstpointer unused)
{
  JsonObject *sent;
  JsonObject *obj;
  JsonObject *options;

  obj = json_object_new ();
  json_object_set_string_member (obj, "test", "value");
  options = cockpit_channel_close_options (tc->channel);
  json_object_set_object_member (options, "option", obj);

  cockpit_channel_close (tc->channel, "bad-boy");

  g_assert_cmpuint (mock_transport_count_sent (tc->transport), ==, 1);

  sent = mock_transport_pop_control (tc->transport);
  g_assert (sent != NULL);

  cockpit_assert_json_eq (sent,
                  "{ \"command\": \"close\", \"channel\": \"554\", \"problem\": \"bad-boy\", \"option\": { \"test\": \"value\" } }");
}

static void
on_closed_get_problem (CockpitChannel *channel,
                       const gchar *problem,
                       gpointer user_data)
{
  gchar **retval = user_data;
  g_assert (*retval == NULL);
  *retval = g_strdup (problem);
}

static void
test_close_transport (TestCase *tc,
                      gconstpointer unused)
{
  MockEchoChannel *chan;
  JsonObject *control;
  GBytes *sent;
  gchar *problem = NULL;

  chan = (MockEchoChannel *)tc->channel;
  cockpit_channel_ready (tc->channel, NULL);

  sent = g_bytes_new ("Yeehaw!", 7);
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (tc->transport), "554", sent);
  g_bytes_unref (sent);

  g_assert (chan->close_called == FALSE);

  g_signal_connect (tc->channel, "closed", G_CALLBACK (on_closed_get_problem), &problem);
  cockpit_transport_close (COCKPIT_TRANSPORT (tc->transport), "boooo");

  g_assert (chan->close_called == TRUE);

  g_assert_cmpstr (problem, ==, "boooo");
  control = mock_transport_pop_control (tc->transport);
  g_assert_cmpstr (json_object_get_string_member (control, "command"), ==, "ready");
  g_assert (mock_transport_pop_control (tc->transport) == NULL);

  g_free (problem);
}

static void
test_get_option (void)
{
  JsonObject *options;
  CockpitTransport *transport;
  CockpitChannel *channel;

  options = json_object_new ();
  json_object_set_string_member (options, "scruffy", "janitor");
  json_object_set_int_member (options, "age", 5);

  transport = g_object_new (mock_transport_get_type (), NULL);
  channel = g_object_new (mock_echo_channel_get_type (),
                          "transport", transport,
                          "id", "55",
                          "options", options,
                          NULL);
  g_object_unref (transport);
  json_object_unref (options);

  options = cockpit_channel_get_options (channel);
  g_assert_cmpstr (json_object_get_string_member (options, "scruffy"), ==, "janitor");
  g_assert_cmpint (json_object_get_int_member (options, "age"), ==, 5);
  g_assert (json_object_get_member (options, "marmalade") == NULL);

  g_object_unref (channel);
}

static void
test_properties (void)
{
  JsonObject *options;
  CockpitTransport *transport;
  CockpitTransport *check;
  CockpitChannel *channel;
  gchar *channel_id;

  options = json_object_new ();
  transport = g_object_new (mock_transport_get_type (), NULL);
  channel = g_object_new (mock_echo_channel_get_type (),
                          "transport", transport,
                          "id", "55",
                          "options", options,
                          NULL);
  g_object_unref (transport);
  json_object_unref (options);

  g_object_get (channel, "transport", &check, "id", &channel_id, NULL);
  g_assert (check == transport);
  g_assert_cmpstr (cockpit_channel_get_id (channel), ==, "55");
  g_assert_cmpstr (channel_id, ==, "55");
  g_free (channel_id);

  g_object_unref (channel);
}

static void
test_close_not_capable (void)
{
  JsonObject *options;
  JsonObject *sent;
  JsonArray *capabilities;
  MockTransport *transport;
  CockpitChannel *channel;
  CockpitChannel *channel2;
  const gchar *cap[] = { "supported", NULL };

  cockpit_expect_message ("55: unsupported capability required: unsupported1");
  cockpit_expect_message ("55: unsupported capability required: unsupported2");
  cockpit_expect_message ("55: unsupported capability required: unsupported1");
  cockpit_expect_message ("55: unsupported capability required: unsupported2");

  options = json_object_new ();
  capabilities = json_array_new ();
  json_array_add_string_element (capabilities, "unsupported1");
  json_array_add_string_element (capabilities, "unsupported2");
  json_object_set_array_member (options, "capabilities", capabilities);
  transport = g_object_new (mock_transport_get_type (), NULL);

  channel = g_object_new (mock_echo_channel_get_type (),
                          "transport", transport,
                          "id", "55",
                          "options", options,
                          NULL);

  while (g_main_context_iteration (NULL, FALSE));

  sent = mock_transport_pop_control (transport);
  g_assert (sent != NULL);

  cockpit_assert_json_eq (sent,
                  "{ \"command\": \"close\", \"channel\": \"55\", \"problem\": \"not-supported\", \"capabilities\":[]}");
  g_object_unref (channel);

  channel2 = g_object_new (mock_echo_channel_get_type (),
                           "transport", transport,
                           "id", "55",
                           "options", options,
                           "capabilities", cap,
                           NULL);
  json_object_unref (options);

  while (g_main_context_iteration (NULL, FALSE));

  sent = mock_transport_pop_control (transport);
  g_assert (sent != NULL);

  cockpit_assert_json_eq (sent,
                  "{ \"command\": \"close\", \"channel\": \"55\", \"problem\": \"not-supported\", \"capabilities\":[\"supported\"]}");

  g_object_unref (channel2);
  g_object_unref (transport);
}

static void
test_capable (void)
{
  JsonObject *options;
  JsonObject *sent;
  JsonArray *capabilities;
  MockTransport *transport;
  CockpitChannel *channel;
  const gchar *cap[] = { "supported", NULL };

  options = json_object_new ();
  capabilities = json_array_new ();
  json_array_add_string_element (capabilities, "supported");
  json_object_set_array_member (options, "capabilities", capabilities);
  transport = g_object_new (mock_transport_get_type (), NULL);

  channel = g_object_new (mock_echo_channel_get_type (),
                          "transport", transport,
                          "id", "55",
                          "options", options,
                          "capabilities", cap,
                          NULL);
  json_object_unref (options);

  while (g_main_context_iteration (NULL, FALSE));

  sent = mock_transport_pop_control (transport);
  g_assert (sent == NULL);

  g_object_unref (channel);
  g_object_unref (transport);
}

static void
test_null_close_control (void)
{
  MockTransport *transport;
  CockpitChannel *channel;

  transport = g_object_new (mock_transport_get_type (), NULL);

  channel = g_object_new (mock_echo_channel_get_type (),
                          "transport", transport,
                          "id", "55",
                          NULL);

  /* Make sure the NULL here works */
  cockpit_channel_control (channel, "close", NULL);

  g_object_unref (channel);
  g_object_unref (transport);
}

static void
test_ping_channel (void)
{
  JsonObject *reply = NULL;
  JsonObject *options;
  MockTransport *mock;
  CockpitTransport *transport;
  CockpitChannel *channel;
  GBytes *sent;

  mock = mock_transport_new ();
  transport = COCKPIT_TRANSPORT (mock);

  options = json_object_new ();
  channel = g_object_new (mock_echo_channel_get_type (),
                          "transport", transport,
                          "id", "55",
                          "options", options,
                          NULL);
  cockpit_channel_ready (channel, NULL);
  json_object_unref (options);

  sent = cockpit_transport_build_control ("command", "ping", "channel", "55", "other", "marmalade", NULL);
  cockpit_transport_emit_recv (transport, NULL, sent);
  g_bytes_unref (sent);

  reply = mock_transport_pop_control (mock);
  g_assert (reply != NULL);
  cockpit_assert_json_eq (reply, "{ \"command\": \"ready\", \"channel\": \"55\" }");

  reply = mock_transport_pop_control (mock);
  g_assert (reply != NULL);
  cockpit_assert_json_eq (reply, "{ \"command\": \"pong\", \"channel\": \"55\", \"other\": \"marmalade\" }");

  g_object_unref (channel);
  g_object_unref (mock);
}

static void
test_ping_no_channel (void)
{
  JsonObject *reply = NULL;
  JsonObject *options;
  MockTransport *mock;
  CockpitTransport *transport;
  CockpitChannel *channel;
  GBytes *sent;

  cockpit_expect_message ("received unknown control command: ping");

  mock = mock_transport_new ();
  transport = COCKPIT_TRANSPORT (mock);

  options = json_object_new ();
  channel = g_object_new (mock_echo_channel_get_type (),
                          "transport", transport,
                          "id", "55",
                          "options", options,
                          NULL);
  json_object_unref (options);

  /*
   * Sending a "ping" on an unknown channel. There should be nothing that
   * responds to this and returns a "pong" message.
   */
  sent = cockpit_transport_build_control ("command", "ping", "channel", "unknown", "other", "marmalade", NULL);
  cockpit_transport_emit_recv (transport, NULL, sent);
  g_bytes_unref (sent);

  cockpit_channel_ready (channel, NULL);

  /* Should just get a ready message back */
  reply = mock_transport_pop_control (mock);
  g_assert (reply != NULL);
  cockpit_assert_json_eq (reply, "{ \"command\": \"ready\", \"channel\": \"55\" }");

  reply = mock_transport_pop_control (mock);
  g_assert (reply == NULL);

  g_object_unref (channel);
  g_object_unref (mock);
}

typedef struct {
  CockpitTransport *transport_a;
  CockpitChannel *channel_a;
  CockpitTransport *transport_b;
  CockpitChannel *channel_b;
} TestPairCase;

static void
setup_pair (TestPairCase *tc,
            gconstpointer data)
{
  CockpitPipe *pipe;
  JsonObject *options;
  int sv[2];

  if (socketpair (PF_LOCAL, SOCK_STREAM, 0, sv) < 0)
    g_assert_not_reached ();

  pipe = cockpit_pipe_new ("a", sv[0], sv[0]);
  tc->transport_a = cockpit_pipe_transport_new (pipe);
  g_object_unref (pipe);

  options = json_object_new ();
  json_object_set_string_member (options, "command", "open");
  json_object_set_string_member (options, "channel", "999");
  json_object_set_boolean_member (options, "flow-control", TRUE);
  tc->channel_a = g_object_new (mock_null_channel_get_type (),
                                "id", "999",
                                "options", options,
                                "transport", tc->transport_a,
                                NULL);
  cockpit_channel_prepare (tc->channel_a);
  json_object_unref (options);

  pipe = cockpit_pipe_new ("b", sv[1], sv[1]);
  tc->transport_b = cockpit_pipe_transport_new (pipe);
  g_object_unref (pipe);

  options = json_object_new ();
  json_object_set_string_member (options, "channel", "999");
  json_object_set_boolean_member (options, "flow-control", TRUE);
  tc->channel_b = g_object_new (mock_null_channel_get_type (),
                                "id", "999",
                                "options", options,
                                "transport", tc->transport_b,
                                NULL);
  cockpit_channel_prepare (tc->channel_b);
  json_object_unref (options);
}

static void
teardown_pair (TestPairCase *tc,
               gconstpointer data)
{
  g_object_add_weak_pointer (G_OBJECT (tc->channel_a), (gpointer *)&tc->channel_a);
  g_object_add_weak_pointer (G_OBJECT (tc->transport_a), (gpointer *)&tc->transport_a);
  g_object_add_weak_pointer (G_OBJECT (tc->channel_b), (gpointer *)&tc->channel_b);
  g_object_add_weak_pointer (G_OBJECT (tc->transport_b), (gpointer *)&tc->transport_b);
  g_object_unref (tc->channel_a);
  g_object_unref (tc->channel_b);
  g_object_unref (tc->transport_a);
  g_object_unref (tc->transport_b);
  g_assert (tc->channel_a == NULL);
  g_assert (tc->transport_a == NULL);
  g_assert (tc->channel_b == NULL);
  g_assert (tc->transport_b == NULL);
}

static gboolean
on_timeout_set_flag (gpointer user_data)
{
  gboolean *data = user_data;
  g_assert (user_data);
  g_assert (*data == FALSE);
  *data = TRUE;
  return FALSE;
}

static void
on_pressure_set_throttle (CockpitChannel *channel,
                          gboolean throttle,
                          gpointer user_data)
{
  gint *data = user_data;
  g_assert (user_data != NULL);
  *data = throttle ? 1 : 0;
}

static void
test_pressure_window (TestPairCase *tc,
                      gconstpointer data)
{
  gint throttle = -1;
  GBytes *sent;
  gint i;

  /* Ready to go */
  cockpit_channel_ready (tc->channel_a, NULL);
  cockpit_channel_ready (tc->channel_b, NULL);
  g_signal_connect (tc->channel_a, "pressure", G_CALLBACK (on_pressure_set_throttle), &throttle);

  /* Sent this a thousand times */
  sent = g_bytes_new_take (g_strnfill (1000 * 1000, '?'), 1000 * 1000);
  for (i = 0; i < 10; i++)
    cockpit_channel_send (tc->channel_a, sent, TRUE);
  g_bytes_unref (sent);

  /*
   * This should have put way too much in the queue, and thus
   * emitted the back-pressure signal. This signal would normally
   * be used by others to slow down their queueing, but in this
   * case we just check that it was fired.
   */
  g_assert_cmpint (throttle, ==, 1);

  /*
   * Now the queue is getting drained. At some point, it will be
   * signaled that back pressure has been turned off
   */
  while (throttle != 0)
    g_main_context_iteration (NULL, TRUE);
}

static void
test_pressure_throttle (TestPairCase *tc,
                        gconstpointer data)
{
  CockpitFlow *pressure = mock_pressure_new ();
  gboolean timeout = FALSE;
  gboolean throttle = 0;
  GBytes *sent;

  cockpit_channel_ready (tc->channel_a, NULL);
  cockpit_channel_ready (tc->channel_b, NULL);

  g_signal_connect (tc->channel_a, "pressure", G_CALLBACK (on_pressure_set_throttle), &throttle);

  /* Send this a thousand times over the echo pipe */
  sent = g_bytes_new_take (g_strnfill (400 * 1000, '?'), 400 * 1000);

  /* Turn on pressure on the remote side */
  cockpit_flow_throttle (COCKPIT_FLOW (tc->channel_b), pressure);
  cockpit_flow_emit_pressure (pressure, TRUE);

  /* In spite of us running the main loop, no we should have pressure */
  g_timeout_add_seconds (2, on_timeout_set_flag, &timeout);
  while (timeout == FALSE)
    {
      if (throttle != 1)
        cockpit_channel_send (tc->channel_a, sent, TRUE);
      g_main_context_iteration (NULL, throttle == 1);
    }

  g_assert_cmpint (throttle, ==, 1);

  /* Now lets turn off the pressure on the remote side */
  cockpit_flow_emit_pressure (pressure, FALSE);

  /* And we should see the pressure here go down too */
  while (throttle == 1)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpint (throttle, ==, 0);

  cockpit_flow_throttle (COCKPIT_FLOW (tc->channel_b), NULL);
  g_object_unref (pressure);
  g_bytes_unref (sent);
}


int
main (int argc,
      char *argv[])
{
  cockpit_test_init (&argc, &argv);

  g_test_add_func ("/channel/get-option", test_get_option);
  g_test_add_func ("/channel/properties", test_properties);
  g_test_add_func ("/channel/test-null-close-control", test_null_close_control);
  g_test_add_func ("/channel/test_close_not_capable",
                   test_close_not_capable);
  g_test_add_func ("/channel/test_capable",
                   test_capable);
  g_test_add ("/channel/recv-send", TestCase, NULL,
              setup, test_recv_and_send, teardown);
  g_test_add ("/channel/recv-queue", TestCase, NULL,
              setup, test_recv_and_queue, teardown);
  g_test_add ("/channel/ready-message", TestCase, NULL,
              setup, test_ready_message, teardown);
  g_test_add ("/channel/close-immediately", TestCase, NULL,
              setup, test_close_immediately, teardown);
  g_test_add ("/channel/close-option", TestCase, NULL,
              setup, test_close_option, teardown);
  g_test_add ("/channel/close-json-option", TestCase, NULL,
              setup, test_close_json_option, teardown);
  g_test_add ("/channel/close-transport", TestCase, NULL,
              setup, test_close_transport, teardown);

  g_test_add ("/channel/pressure/window", TestPairCase, NULL,
              setup_pair, test_pressure_window, teardown_pair);
  g_test_add ("/channel/pressure/throttle", TestPairCase, NULL,
              setup_pair, test_pressure_throttle, teardown_pair);

  g_test_add_func ("/channel/ping/normal", test_ping_channel);
  g_test_add_func ("/channel/ping/no-channel", test_ping_no_channel);

  return g_test_run ();
}
