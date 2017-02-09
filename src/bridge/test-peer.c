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

#include "cockpitchannel.h"
#include "cockpitpeer.h"
#include "mock-transport.h"

#include "common/cockpitjson.h"
#include "common/cockpittest.h"

#include <json-glib/json-glib.h>

#include <gio/gio.h>

#include <string.h>

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
mock_echo_channel_constructed (GObject *obj)
{
  G_OBJECT_CLASS (mock_echo_channel_parent_class)->constructed (obj);
  cockpit_channel_ready (COCKPIT_CHANNEL (obj), NULL);
}

static void
mock_echo_channel_class_init (MockEchoChannelClass *klass)
{
  CockpitChannelClass *channel_class = COCKPIT_CHANNEL_CLASS (klass);
  GObjectClass *object_class = G_OBJECT_CLASS (klass);
  object_class->constructed = mock_echo_channel_constructed;
  channel_class->recv = mock_echo_channel_recv;
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

typedef struct {
  MockTransport *transport;
  CockpitChannel *channel;
  CockpitPeer *peer;
} TestCase;

static gboolean
on_transport_control (CockpitTransport *transport,
                      const char *command,
                      const gchar *channel,
                      JsonObject *options,
                      GBytes *message,
                      gpointer user_data)
{
  TestCase *tc = user_data;
  const gchar *payload;
  JsonObject *object;
  GBytes *data;

  g_assert (tc != NULL);

  if (channel && g_str_equal (command, "open"))
    {
      if (tc->peer && cockpit_peer_handle (tc->peer, channel, options, message))
        {
          return TRUE;
        }

      /* Fallback to echo implementation */
      else if (!tc->channel && cockpit_json_get_string (options, "payload", NULL, &payload) &&
          payload && g_str_equal (payload, "upper"))
        {
          tc->channel = mock_echo_channel_open (transport, channel);
          return TRUE;
        }

      else
        {
          object = json_object_new ();
          json_object_set_string_member (object, "command", "close");
          json_object_set_string_member (object, "channel", channel);
          json_object_set_string_member (object, "problem", "not-supported");
          data = cockpit_json_write_bytes (object);
          cockpit_transport_send (transport, NULL, data);
          json_object_unref (object);
          g_bytes_unref (data);
          return TRUE;
        }
    }

  return FALSE;
}

static void
setup (TestCase *tc,
       gconstpointer unused)
{
  tc->transport = g_object_new (mock_transport_get_type (), NULL);
  while (g_main_context_iteration (NULL, FALSE));

  /* Connect to fallback implementation */
  g_signal_connect (tc->transport, "control", G_CALLBACK (on_transport_control), tc);
}

static void
teardown (TestCase *tc,
          gconstpointer unused)
{
  cockpit_assert_expected ();

  g_clear_object (&tc->channel);

  if (tc->peer)
    {
      g_object_add_weak_pointer (G_OBJECT (tc->peer), (gpointer *)&tc->peer);
      g_object_unref (tc->peer);
      g_assert (tc->peer == NULL);
    }

  g_object_add_weak_pointer (G_OBJECT (tc->transport), (gpointer *)&tc->transport);
  g_object_unref (tc->transport);
  g_assert (tc->transport == NULL);
}

static CockpitPeer *
peer_new (MockTransport *transport,
          const gchar *bridge)
{
  CockpitPeer *peer;
  JsonObject *object;
  GError *error = NULL;

  object = cockpit_json_parse_object (bridge, -1, &error);
  g_assert_no_error (error);

  peer = cockpit_peer_new (COCKPIT_TRANSPORT (transport), object);
  json_object_unref (object);

  return peer;
}

static CockpitPeer *
mock_peer_simple_new (MockTransport *transport,
                      const gchar *payload)
{
  CockpitPeer *peer;
  gchar *bridge;

  bridge = g_strdup_printf ("{ \"match\": { \"payload\": \"%s\" }, \"spawn\": [ \"%s\", \"--%s\" ] }",
                            payload, BUILDDIR "/mock-bridge", payload);

  peer = peer_new (transport, bridge);
  g_free (bridge);

  return peer;
}

static CockpitPeer *
mock_peer_fail_new (MockTransport *transport,
                    const gchar *payload,
                    const gchar *problem)
{
  CockpitPeer *peer;
  gchar *bridge;

  if (problem)
    {
      bridge = g_strdup_printf ("{ \"match\": { \"payload\": \"%s\" }, \"spawn\": [ \"/non-existant\" ], \"problem\": \"%s\" }", payload, problem);
    }
  else
    {
      bridge = g_strdup_printf ("{ \"match\": { \"payload\": \"%s\" }, \"spawn\": [ \"/non-existant\" ] }", payload);
    }

  peer = peer_new (transport, bridge);
  g_free (bridge);

  return peer;
}

static void
emit_string (TestCase *tc,
             const gchar *channel,
             const gchar *string)
{
  GBytes *bytes = g_bytes_new (string, strlen (string));
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (tc->transport), channel, bytes);
  g_bytes_unref (bytes);
}

static void
test_simple (TestCase *tc,
             gconstpointer unused)
{
  GBytes *sent;

  tc->peer = mock_peer_simple_new (tc->transport, "upper");

  /* The filter should ignore this */
  emit_string (tc, NULL, "{\"command\": \"hello\"}");

  emit_string (tc, NULL, "{\"command\": \"open\", \"channel\": \"a\", \"payload\": \"upper\"}");
  emit_string (tc, "a", "oh marmalade");

  while ((sent = mock_transport_pop_channel (tc->transport, "a")) == NULL)
    g_main_context_iteration (NULL, TRUE);

  cockpit_assert_bytes_eq (sent, "OH MARMALADE", -1);

  /* The fallback channel was not created */
  g_assert (tc->channel == NULL);
}

static void
test_serial (TestCase *tc,
             gconstpointer unused)
{
  GBytes *sent;

  tc->peer = mock_peer_simple_new (tc->transport, "upper");

  /* The filter should ignore this */
  emit_string (tc, NULL, "{\"command\": \"hello\"}");

  emit_string (tc, NULL, "{\"command\": \"open\", \"channel\": \"a\", \"payload\": \"upper\"}");
  emit_string (tc, "a", "oh marmalade");

  while ((sent = mock_transport_pop_channel (tc->transport, "a")) == NULL)
    g_main_context_iteration (NULL, TRUE);

  cockpit_assert_bytes_eq (sent, "OH MARMALADE", -1);

  /* The fallback channel was not created */
  g_assert (tc->channel == NULL);

  /* Open a second channel */
  emit_string (tc, NULL, "{\"command\": \"open\", \"channel\": \"b\", \"payload\": \"upper\"}");
  emit_string (tc, "b", "zero g");

  while ((sent = mock_transport_pop_channel (tc->transport, "b")) == NULL)
    g_main_context_iteration (NULL, TRUE);

  cockpit_assert_bytes_eq (sent, "ZERO G", -1);

  /* The fallback channel was not created */
  g_assert (tc->channel == NULL);
}

static void
test_parallel (TestCase *tc,
               gconstpointer unused)
{
  GBytes *sent;

  tc->peer = mock_peer_simple_new (tc->transport, "upper");

  /* The filter should ignore this */
  emit_string (tc, NULL, "{\"command\": \"hello\"}");

  /* Open two channels at the same time both bound for the peer */
  emit_string (tc, NULL, "{\"command\": \"open\", \"channel\": \"a\", \"payload\": \"upper\"}");
  emit_string (tc, NULL, "{\"command\": \"open\", \"channel\": \"b\", \"payload\": \"upper\"}");
  emit_string (tc, "b", "zero g");
  emit_string (tc, "a", "oh marmalade");

  while ((sent = mock_transport_pop_channel (tc->transport, "a")) == NULL)
    g_main_context_iteration (NULL, TRUE);

  cockpit_assert_bytes_eq (sent, "OH MARMALADE", -1);

  while ((sent = mock_transport_pop_channel (tc->transport, "b")) == NULL)
    g_main_context_iteration (NULL, TRUE);

  cockpit_assert_bytes_eq (sent, "ZERO G", -1);

  /* The fallback channel was not created */
  g_assert (tc->channel == NULL);
}

static void
test_not_supported (TestCase *tc,
                    gconstpointer unused)
{
  JsonObject *sent;

  /* The "lower" channel has no local implementation to fall back to */
  tc->peer = mock_peer_fail_new (tc->transport, "lower", NULL);

  emit_string (tc, NULL, "{\"command\": \"open\", \"channel\": \"a\", \"payload\": \"lower\"}");
  emit_string (tc, "a", "Oh Marmalade");

  while ((sent = mock_transport_pop_control (tc->transport)) == NULL)
    g_main_context_iteration (NULL, TRUE);

  cockpit_assert_json_eq (sent, "{\"command\":\"close\",\"channel\":\"a\",\"problem\":\"not-supported\"}");

  /* The fallback channel was not created */
  g_assert (tc->channel == NULL);
}

static void
test_fail_problem (TestCase *tc,
                   gconstpointer unused)
{
  JsonObject *sent;

  tc->peer = mock_peer_fail_new (tc->transport, "lower", "access-denied");

  emit_string (tc, NULL, "{\"command\": \"open\", \"channel\": \"a\", \"payload\": \"lower\"}");
  emit_string (tc, "a", "Oh Marmalade");

  while ((sent = mock_transport_pop_control (tc->transport)) == NULL)
    g_main_context_iteration (NULL, TRUE);

  cockpit_assert_json_eq (sent, "{\"command\":\"close\",\"channel\":\"a\",\"problem\":\"access-denied\"}");

  /* The fallback channel was not created */
  g_assert (tc->channel == NULL);
}

static void
test_fallback (TestCase *tc,
               gconstpointer unused)
{
  GBytes *sent;

  /* The "upper" channel has a local implementaiton to fallback to */
  tc->peer = mock_peer_fail_new (tc->transport, "upper", NULL);

  emit_string (tc, NULL, "{\"command\": \"open\", \"channel\": \"a\", \"payload\": \"upper\"}");
  emit_string (tc, "a", "Oh MarmaLade");

  while ((sent = mock_transport_pop_channel (tc->transport, "a")) == NULL)
    g_main_context_iteration (NULL, TRUE);

  /* The fallback just echos */
  cockpit_assert_bytes_eq (sent, "Oh MarmaLade", -1);

  /* The fallback channel was created */
  g_assert (tc->channel != NULL);
}

int
main (int argc,
      char *argv[])
{
  cockpit_test_init (&argc, &argv);

  g_test_add ("/peer/simple", TestCase, NULL,
              setup, test_simple, teardown);
  g_test_add ("/peer/serial", TestCase, NULL,
              setup, test_serial, teardown);
  g_test_add ("/peer/parallel", TestCase, NULL,
              setup, test_parallel, teardown);
  g_test_add ("/peer/not-supported", TestCase, NULL,
              setup, test_not_supported, teardown);
  g_test_add ("/peer/fail-problem", TestCase, NULL,
              setup, test_fail_problem, teardown);
  g_test_add ("/peer/fallback", TestCase, NULL,
              setup, test_fallback, teardown);

  return g_test_run ();
}
