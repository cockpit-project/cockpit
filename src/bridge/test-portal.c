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
#include "cockpitportal.h"
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

  g_assert (tc != NULL);

  if (!tc->channel && channel && g_str_equal (command, "open") &&
      cockpit_json_get_string (options, "payload", NULL, &payload) &&
      g_strcmp0 (payload, "upper") == 0)
    {
      /* Fallback to echo implementation */
      tc->channel = mock_echo_channel_open (transport, channel);
      return TRUE;
    }

  return FALSE;
}

static void
setup (TestCase *tc,
       gconstpointer unused)
{
  tc->transport = g_object_new (mock_transport_get_type (), NULL);
  while (g_main_context_iteration (NULL, FALSE));
}

static void
teardown (TestCase *tc,
          gconstpointer unused)
{
  cockpit_assert_expected ();

  g_clear_object (&tc->channel);

  g_object_add_weak_pointer (G_OBJECT (tc->transport), (gpointer *)&tc->transport);
  g_object_unref (tc->transport);
  g_assert (tc->transport == NULL);
}

static gboolean
mock_filter_upper (CockpitPortal *portal,
                   const gchar *command,
                   const gchar *channel,
                   JsonObject *options)
{
  const gchar *payload = NULL;

  if (channel && g_str_equal (command, "open") &&
      cockpit_json_get_string (options, "payload", NULL, &payload) &&
      g_strcmp0 (payload, "upper") == 0)
    {
      cockpit_portal_add_channel (portal, channel, COCKPIT_PORTAL_NORMAL);
      return TRUE;
    }

  return FALSE;
}

static gboolean
mock_filter_upper_fallback (CockpitPortal *portal,
                            const gchar *command,
                            const gchar *channel,
                            JsonObject *options)
{
  const gchar *payload = NULL;

  if (channel && g_str_equal (command, "open") &&
      cockpit_json_get_string (options, "payload", NULL, &payload) &&
      g_strcmp0 (payload, "upper") == 0)
    {
      cockpit_portal_add_channel (portal, channel, COCKPIT_PORTAL_FALLBACK);
      return TRUE;
    }

  return FALSE;
}

static gboolean
mock_filter_lower (CockpitPortal *portal,
                   const gchar *command,
                   const gchar *channel,
                   JsonObject *options)
{
  const gchar *payload = NULL;

  if (channel && g_str_equal (command, "open") &&
      cockpit_json_get_string (options, "payload", NULL, &payload) &&
      g_strcmp0 (payload, "lower") == 0)
    {
      cockpit_portal_add_channel (portal, channel, COCKPIT_PORTAL_NORMAL);
      return TRUE;
    }

  return FALSE;
}

static CockpitPortal *
mock_portal_simple_new (MockTransport *transport,
                        CockpitPortalFilter filter,
                        const gchar *arg)
{
  static const char *mock_argv[] = {
    BUILDDIR "/mock-bridge", NULL, NULL
  };

  static const gchar **good[] = { mock_argv, NULL };

  mock_argv[1] = arg;

  return g_object_new (COCKPIT_TYPE_PORTAL,
                       "transport", transport,
                       "filter", filter,
                       "argvs", good,
                       NULL);
}

static CockpitPortal *
mock_portal_failover_new (MockTransport *transport,
                          CockpitPortalFilter filter,
                          const gchar *arg)
{
  static const char *fail_argv[] = {
    "/non-existant", NULL
  };

  static const char *mock_argv[] = {
    BUILDDIR "/mock-bridge", NULL, NULL
  };

  static const gchar **fail[] = { fail_argv, mock_argv, NULL };

  mock_argv[1] = arg;
  return g_object_new (COCKPIT_TYPE_PORTAL,
                       "transport", transport,
                       "filter", filter,
                       "argvs", fail,
                       NULL);
}

static CockpitPortal *
mock_portal_fail_new (MockTransport *transport,
                      CockpitPortalFilter filter)
{
  static const char *fail_argv[] = {
    "/non-existant", NULL
  };

  static const gchar **fail[] = { fail_argv, NULL };

  return g_object_new (COCKPIT_TYPE_PORTAL,
                       "transport", transport,
                       "filter", filter,
                       "argvs", fail,
                       NULL);
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
  CockpitPortal *portal;
  GBytes *sent;

  portal = mock_portal_simple_new (tc->transport, mock_filter_upper, "--upper");

  /* Connect to fallback implementation */
  g_signal_connect (tc->transport, "control", G_CALLBACK (on_transport_control), tc);

  /* The filter should ignore this */
  emit_string (tc, NULL, "{\"command\": \"hello\"}");

  emit_string (tc, NULL, "{\"command\": \"open\", \"channel\": \"a\", \"payload\": \"upper\"}");
  emit_string (tc, "a", "oh marmalade");

  while ((sent = mock_transport_pop_channel (tc->transport, "a")) == NULL)
    g_main_context_iteration (NULL, TRUE);

  cockpit_assert_bytes_eq (sent, "OH MARMALADE", -1);

  /* The fallback channel was not created */
  g_assert (tc->channel == NULL);

  g_object_unref (portal);
}

static void
test_failover (TestCase *tc,
               gconstpointer unused)
{
  CockpitPortal *portal;
  GBytes *sent;

  portal = mock_portal_failover_new (tc->transport, mock_filter_lower, "--lower");

  /* The filter should ignore this */
  emit_string (tc, NULL, "{\"command\": \"hello\"}");

  emit_string (tc, NULL, "{\"command\": \"open\", \"channel\": \"a\", \"payload\": \"lower\"}");
  emit_string (tc, "a", "Oh Marmalade");

  while ((sent = mock_transport_pop_channel (tc->transport, "a")) == NULL)
    g_main_context_iteration (NULL, TRUE);

  cockpit_assert_bytes_eq (sent, "oh marmalade", -1);

  /* The fallback channel was not created */
  g_assert (tc->channel == NULL);

  g_object_unref (portal);
}

static void
test_fail (TestCase *tc,
           gconstpointer unused)
{
  CockpitPortal *portal;
  JsonObject *sent;

  portal = mock_portal_fail_new (tc->transport, mock_filter_lower);

  emit_string (tc, NULL, "{\"command\": \"open\", \"channel\": \"a\", \"payload\": \"lower\"}");
  emit_string (tc, "a", "Oh Marmalade");

  while ((sent = mock_transport_pop_control (tc->transport)) == NULL)
    g_main_context_iteration (NULL, TRUE);

  cockpit_assert_json_eq (sent, "{\"command\":\"close\",\"channel\":\"a\",\"problem\":\"not-supported\"}");

  /* The fallback channel was not created */
  g_assert (tc->channel == NULL);

  g_object_unref (portal);
}

static void
test_fallback (TestCase *tc,
               gconstpointer unused)
{
  CockpitPortal *portal;
  GBytes *sent;

  portal = mock_portal_fail_new (tc->transport, mock_filter_upper_fallback);

  /* Connect to fallback implementation */
  g_signal_connect (tc->transport, "control", G_CALLBACK (on_transport_control), tc);

  emit_string (tc, NULL, "{\"command\": \"open\", \"channel\": \"a\", \"payload\": \"upper\"}");
  emit_string (tc, "a", "Oh MarmaLade");

  while ((sent = mock_transport_pop_channel (tc->transport, "a")) == NULL)
    g_main_context_iteration (NULL, TRUE);

  /* The fallback just echos */
  cockpit_assert_bytes_eq (sent, "Oh MarmaLade", -1);

  /* The fallback channel was created */
  g_assert (tc->channel != NULL);

  g_object_unref (portal);
}

int
main (int argc,
      char *argv[])
{
  cockpit_test_init (&argc, &argv);

  g_test_add ("/portal/simple", TestCase, NULL,
              setup, test_simple, teardown);
  g_test_add ("/portal/failover", TestCase, NULL,
              setup, test_failover, teardown);
  g_test_add ("/portal/fail", TestCase, NULL,
              setup, test_fail, teardown);
  g_test_add ("/portal/fallback", TestCase, NULL,
              setup, test_fallback, teardown);

  return g_test_run ();
}
