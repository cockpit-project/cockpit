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

#include "cockpitchannel.h"

#include "cockpit/cockpitjson.h"
#include "cockpit/cockpittest.h"

#include <json-glib/json-glib.h>

#include <gio/gio.h>

/* ----------------------------------------------------------------------------
 * Mock
 */

static GType mock_echo_channel_get_type (void) G_GNUC_CONST;

typedef CockpitChannel MockEchoChannel;
typedef CockpitChannelClass MockEchoChannelClass;

G_DEFINE_TYPE (MockEchoChannel, mock_echo_channel, COCKPIT_TYPE_CHANNEL);

static void
mock_echo_channel_recv (CockpitChannel *channel,
                        GBytes *message)
{
  cockpit_channel_send (channel, message);
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

static GType mock_transport_get_type (void) G_GNUC_CONST;

typedef struct {
  CockpitTransport parent;
  gboolean closed;
  gchar *problem;
  gchar *channel_sent;
  GBytes *payload_sent;
  GBytes *control_sent;
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
    g_bytes_unref (self->control_sent);
  g_free (self->channel_sent);

  G_OBJECT_CLASS (mock_transport_parent_class)->finalize (object);
}

static void
mock_transport_send (CockpitTransport *transport,
                     const gchar *channel_id,
                     GBytes *data)
{
  MockTransport *self = (MockTransport *)transport;
  if (!channel_id)
    {
      g_assert (self->control_sent == NULL);
      self->control_sent = g_bytes_ref (data);
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
assert_bytes_eq_json_msg (const char *domain,
                          const char *file,
                          int line,
                          const char *func,
                          GBytes *bytes,
                          const gchar *expect)
{
  GError *error = NULL;
  JsonNode *node;
  JsonNode *exnode;
  gchar *escaped;
  gchar *msg;

  node = cockpit_json_parse (g_bytes_get_data (bytes, NULL),
                             g_bytes_get_size (bytes), &error);
  if (error)
    g_assertion_message_error (domain, file, line, func, "error", error, 0, 0);
  g_assert (node);

  exnode = cockpit_json_parse (expect, -1, &error);
  if (error)
    g_assertion_message_error (domain, file, line, func, "error", error, 0, 0);
  g_assert (exnode);

  if (!cockpit_json_equal (exnode, node))
    {
      escaped = cockpit_json_write (node, NULL);

      msg = g_strdup_printf ("%s != %s", escaped, expect);
      g_assertion_message (domain, file, line, func, msg);
      g_free (escaped);
      g_free (msg);
    }
  json_node_free (node);
  json_node_free (exnode);
}

#define assert_bytes_eq_json(node, expect) \
  assert_bytes_eq_json_msg (G_LOG_DOMAIN, __FILE__, __LINE__, G_STRFUNC, (node), (expect))

static void
test_recv_and_send (TestCase *tc,
                    gconstpointer unused)
{
  GBytes *sent;

  /* Ready to go */
  cockpit_channel_ready (tc->channel);

  sent = g_bytes_new ("Yeehaw!", 7);
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (tc->transport), "554", sent);

  g_assert_cmpstr (tc->transport->channel_sent, ==, "554");
  g_assert (tc->transport->payload_sent != NULL);

  g_assert (g_bytes_equal (tc->transport->payload_sent, sent));
  g_bytes_unref (sent);
}

static void
test_recv_and_queue (TestCase *tc,
                     gconstpointer unused)
{
  GBytes *sent;

  sent = g_bytes_new ("Yeehaw!", 7);
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (tc->transport), "554", sent);

  /* Shouldn't have received it yet */
  g_assert (tc->transport->payload_sent == NULL);

  /* Ready to go */
  cockpit_channel_ready (tc->channel);

  g_assert_cmpstr (tc->transport->channel_sent, ==, "554");
  g_assert (tc->transport->payload_sent != NULL);

  g_assert (g_bytes_equal (tc->transport->payload_sent, sent));
  g_bytes_unref (sent);
}

static void
test_close_immediately (TestCase *tc,
                        gconstpointer unused)
{
  GBytes *sent;

  sent = g_bytes_new ("Yeehaw!", 7);
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (tc->transport), "554", sent);
  g_bytes_unref (sent);

  /* Shouldn't have received it yet */
  g_assert (tc->transport->payload_sent == NULL);

  /* Now close without getting anything */
  cockpit_channel_close (tc->channel, "bad-boy");

  g_assert (tc->transport->payload_sent == NULL);
  g_assert (tc->transport->control_sent != NULL);

  assert_bytes_eq_json (tc->transport->control_sent,
                  "{ \"command\": \"close\", \"channel\": \"554\", \"reason\": \"bad-boy\"}");
}

static void
test_close_option (TestCase *tc,
                   gconstpointer unused)
{
  cockpit_channel_close_option (tc->channel, "option", "four");
  cockpit_channel_close (tc->channel, "bad-boy");

  g_assert (tc->transport->payload_sent == NULL);
  g_assert (tc->transport->control_sent != NULL);

  assert_bytes_eq_json (tc->transport->control_sent,
                  "{ \"command\": \"close\", \"channel\": \"554\", \"reason\": \"bad-boy\", \"option\": \"four\" }");
}

static void
test_close_int_option (TestCase *tc,
                       gconstpointer unused)
{
  cockpit_channel_close_int_option (tc->channel, "option", 4);
  cockpit_channel_close (tc->channel, "bad-boy");

  g_assert (tc->transport->payload_sent == NULL);
  g_assert (tc->transport->control_sent != NULL);

  assert_bytes_eq_json (tc->transport->control_sent,
                  "{ \"command\": \"close\", \"channel\": \"554\", \"reason\": \"bad-boy\", \"option\": 4 }");
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
  GBytes *sent;
  gchar *problem = NULL;

  cockpit_channel_ready (tc->channel);

  sent = g_bytes_new ("Yeehaw!", 7);
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (tc->transport), "554", sent);
  g_bytes_unref (sent);

  g_signal_connect (tc->channel, "closed", G_CALLBACK (on_closed_get_problem), &problem);
  cockpit_transport_close (COCKPIT_TRANSPORT (tc->transport), "boooo");

  g_assert_cmpstr (problem, ==, "boooo");
  g_assert (tc->transport->control_sent == NULL);
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

  g_assert_cmpstr (cockpit_channel_get_option (channel, "scruffy"), ==, "janitor");
  g_assert_cmpstr (cockpit_channel_get_option (channel, "age"), ==, NULL);
  g_assert_cmpstr (cockpit_channel_get_option (channel, "marmalade"), ==, NULL);

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

int
main (int argc,
      char *argv[])
{
  cockpit_test_init (&argc, &argv);

  g_test_add_func ("/channel/get-option", test_get_option);
  g_test_add_func ("/channel/properties", test_properties);

  g_test_add ("/channel/recv-send", TestCase, NULL,
              setup, test_recv_and_send, teardown);
  g_test_add ("/channel/recv-queue", TestCase, NULL,
              setup, test_recv_and_queue, teardown);
  g_test_add ("/channel/close-immediately", TestCase, NULL,
              setup, test_close_immediately, teardown);
  g_test_add ("/channel/close-option", TestCase, NULL,
              setup, test_close_option, teardown);
  g_test_add ("/channel/close-int-option", TestCase, NULL,
              setup, test_close_int_option, teardown);
  g_test_add ("/channel/close-transport", TestCase, NULL,
              setup, test_close_transport, teardown);

  return g_test_run ();
}
