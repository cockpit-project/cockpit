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
                        guint number)
{
  CockpitChannel *channel;
  JsonObject *options;

  options = json_object_new ();
  channel = g_object_new (mock_echo_channel_get_type (),
                          "transport", transport,
                          "channel", number,
                          "options", options,
                          NULL);

  json_object_unref (options);
  return channel;
}

static GType mock_transport_get_type (void) G_GNUC_CONST;

typedef struct {
  GObject parent;
  gboolean closed;
  gchar *problem;
  guint channel_sent;
  GBytes *payload_sent;
  GBytes *control_sent;
}MockTransport;

typedef GObjectClass MockTransportClass;

static void mock_transport_iface (CockpitTransportIface *iface);

G_DEFINE_TYPE_WITH_CODE (MockTransport, mock_transport, G_TYPE_OBJECT,
                         G_IMPLEMENT_INTERFACE (COCKPIT_TYPE_TRANSPORT, mock_transport_iface);
);

static void
mock_transport_init (MockTransport *self)
{
  self->channel_sent = G_MAXUINT;
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

  G_OBJECT_CLASS (mock_transport_parent_class)->finalize (object);
}

static void
mock_transport_class_init (MockTransportClass *klass)
{
  GObjectClass *object_class = G_OBJECT_CLASS (klass);
  object_class->finalize = mock_transport_finalize;
  object_class->get_property = mock_transport_get_property;
  object_class->set_property = mock_transport_set_property;
  g_object_class_override_property (object_class, 1, "name");
}

static void
mock_transport_send (CockpitTransport *transport,
                     guint channel,
                     GBytes *data)
{
  MockTransport *self = (MockTransport *)transport;
  if (channel == 0)
    {
      g_assert (self->control_sent == NULL);
      self->control_sent = g_bytes_ref (data);
    }
  else
    {
      g_assert (self->channel_sent == G_MAXUINT);
      g_assert (self->payload_sent == NULL);
      self->channel_sent = channel;
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
mock_transport_iface (CockpitTransportIface *iface)
{
  iface->send = mock_transport_send;
  iface->close = mock_transport_close;
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
  tc->channel = mock_echo_channel_open (COCKPIT_TRANSPORT (tc->transport), 554);
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
  JsonParser *parser;
  JsonGenerator *generator;
  JsonNode *node;
  gchar *escaped;
  gconstpointer data;
  gsize length;
  gchar *msg;

  parser = json_parser_new ();
  data = g_bytes_get_data (bytes, &length);
  json_parser_load_from_data (parser, data, length, &error);
  if (error)
    g_assertion_message_error (domain, file, line, func, "error", error, 0, 0);
  node = json_node_copy (json_parser_get_root (parser));

  json_parser_load_from_data (parser, expect, -1, &error);
  if (error)
    g_assertion_message_error (domain, file, line, func, "error", error, 0, 0);

  if (!cockpit_json_equal (json_parser_get_root (parser), node))
    {
      generator = json_generator_new ();
      json_generator_set_root (generator, node);
      escaped = json_generator_to_data (generator, NULL);
      g_object_unref (generator);

      msg = g_strdup_printf ("%s != %s", escaped, expect);
      g_assertion_message (domain, file, line, func, msg);
      g_free (escaped);
      g_free (msg);
    }
  json_node_free (node);
  g_object_unref (parser);
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
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (tc->transport), 554, sent);

  g_assert_cmpuint (tc->transport->channel_sent, ==, 554);
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
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (tc->transport), 554, sent);

  /* Shouldn't have received it yet */
  g_assert (tc->transport->payload_sent == NULL);

  /* Ready to go */
  cockpit_channel_ready (tc->channel);

  g_assert_cmpuint (tc->transport->channel_sent, ==, 554);
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
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (tc->transport), 554, sent);
  g_bytes_unref (sent);

  /* Shouldn't have received it yet */
  g_assert (tc->transport->payload_sent == NULL);

  /* Now close without getting anything */
  cockpit_channel_close (tc->channel, "bad-boy");

  g_assert (tc->transport->payload_sent == NULL);
  g_assert (tc->transport->control_sent != NULL);

  assert_bytes_eq_json (tc->transport->control_sent,
                  "{ \"command\": \"close\", \"channel\": 554, \"reason\": \"bad-boy\"}");
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
                  "{ \"command\": \"close\", \"channel\": 554, \"reason\": \"bad-boy\", \"option\": \"four\" }");
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
                  "{ \"command\": \"close\", \"channel\": 554, \"reason\": \"bad-boy\", \"option\": 4 }");
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
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (tc->transport), 554, sent);
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
                          "channel", 55,
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
  guint number;

  options = json_object_new ();
  transport = g_object_new (mock_transport_get_type (), NULL);
  channel = g_object_new (mock_echo_channel_get_type (),
                          "transport", transport,
                          "channel", 55,
                          "options", options,
                          NULL);
  g_object_unref (transport);
  json_object_unref (options);

  g_object_get (channel, "transport", &check, "channel", &number, NULL);
  g_assert (check == transport);
  g_assert_cmpuint (number, ==, 55);

  g_object_unref (channel);
}

static void
test_generator (void)
{
  JsonGenerator *generator;
  JsonGenerator *same;
  JsonObject *options;
  CockpitTransport *transport;
  CockpitChannel *channel;

  options = json_object_new ();
  transport = g_object_new (mock_transport_get_type (), NULL);
  channel = g_object_new (mock_echo_channel_get_type (),
                          "transport", transport,
                          "channel", 55,
                          "options", options,
                          NULL);
  g_object_unref (transport);
  json_object_unref (options);

  generator = cockpit_channel_get_generator (channel);
  g_assert (JSON_IS_GENERATOR (generator));

  same = cockpit_channel_get_generator (channel);
  g_assert (generator == same);

  g_object_unref (channel);
}

int
main (int argc,
      char *argv[])
{
  cockpit_test_init (&argc, &argv);

  g_test_add_func ("/channel/get-option", test_get_option);
  g_test_add_func ("/channel/properties", test_properties);
  g_test_add_func ("/channel/generator", test_generator);

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
