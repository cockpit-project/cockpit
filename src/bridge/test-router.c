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

#include "cockpitrouter.h"
#include "cockpitdbusinternal.h"

#include "common/cockpitchannel.h"
#include "common/cockpitjson.h"
#include "testlib/cockpittest.h"
#include "testlib/mock-channel.h"
#include "testlib/mock-transport.h"

#include <json-glib/json-glib.h>

#include <gio/gio.h>

#include <string.h>

/* Mock override from cockpitrouter.c */
extern guint cockpit_router_bridge_timeout;

typedef struct {
  MockTransport *transport;
  JsonObject *mock_match;
  JsonObject *mock_config;
  GDBusConnection *connection;
} TestCase;

typedef struct {
  const gchar *payload;
  gboolean with_env;
  gboolean privileged;
  const gchar *problem;
  const gchar *bridge;
} TestFixture;

static void
setup (TestCase *tc,
       gconstpointer user_data)
{
  const TestFixture *fixture = user_data;
  JsonArray *argv;
  gchar *argument;
  const gchar *payload;
  const gchar *bridge;

  tc->mock_config = json_object_new ();
  argv = json_array_new ();

  bridge = BUILDDIR "/mock-bridge";
  if (fixture && fixture->bridge)
    bridge = fixture->bridge;
  json_array_add_string_element (argv, bridge);

  payload = "upper";
  if (fixture && fixture->payload)
    payload = fixture->payload;
  argument = g_strdup_printf ("--%s", payload);
  json_array_add_string_element (argv, argument);
  g_free (argument);
  json_object_set_array_member (tc->mock_config, "spawn", argv);
  if (fixture && fixture->privileged)
    {
      json_object_set_boolean_member (tc->mock_config, "privileged", TRUE);
    }
  json_object_seal (tc->mock_config);

  tc->mock_match = json_object_new ();
  json_object_set_string_member (tc->mock_match, "payload", payload);

  tc->transport = g_object_new (mock_transport_get_type (), NULL);
  while (g_main_context_iteration (NULL, FALSE));

  cockpit_dbus_internal_startup (FALSE);
  tc->connection = cockpit_dbus_internal_client();
}

static void
setup_dynamic (TestCase *tc,
               gconstpointer user_data)
{
  const TestFixture *fixture = user_data;
  JsonArray *argv;
  JsonArray *env;
  JsonObject *match;

  tc->mock_config = json_object_new ();
  argv = json_array_new ();
  match = json_object_new ();

  json_array_add_string_element (argv, BUILDDIR "/mock-bridge");
  json_array_add_string_element (argv, "--${payload}");
  json_array_add_string_element (argv, "--count");

  json_object_set_array_member (tc->mock_config, "spawn", argv);

  if (fixture && fixture->problem)
    json_object_set_string_member (tc->mock_config, "problem", fixture->problem);

  if (fixture && fixture->with_env)
    {
      env = json_array_new ();
      json_array_add_string_element (env, "COCKPIT_TEST_PARAM_ENV=${payload}");
      json_object_set_array_member (tc->mock_config, "environ", env);
    }
  json_object_seal (tc->mock_config);

  json_object_set_null_member (match, "payload");
  json_object_set_object_member (tc->mock_config, "match", match);

  tc->transport = g_object_new (mock_transport_get_type (), NULL);
  while (g_main_context_iteration (NULL, FALSE));
}

static void
teardown (TestCase *tc,
          gconstpointer unused)
{
  cockpit_assert_expected ();

  g_object_add_weak_pointer (G_OBJECT (tc->transport), (gpointer *)&tc->transport);
  g_object_unref (tc->transport);
  g_assert (tc->transport == NULL);

  json_object_unref (tc->mock_config);
  if (tc->mock_match)
    json_object_unref (tc->mock_match);
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
on_transport_closed (CockpitTransport *transport,
                     const gchar *problem,
                     gpointer user_data)
{
  gchar **retval = user_data;
  g_assert (*retval == NULL);
  *retval = g_strdup (problem);
}

static void
test_local_channel (TestCase *tc,
                    gconstpointer unused)
{
  CockpitRouter *router;
  GBytes *sent;

  static CockpitPayloadType payload_types[] = {
    { "echo", mock_echo_channel_get_type },
    { NULL },
  };

  router = cockpit_router_new (COCKPIT_TRANSPORT (tc->transport), payload_types, NULL);

  emit_string (tc, NULL, "{\"command\": \"init\", \"version\": 1, \"host\": \"localhost\" }");
  emit_string (tc, NULL, "{\"command\": \"open\", \"channel\": \"a\", \"payload\": \"echo\"}");
  emit_string (tc, "a", "oh marmalade");

  while ((sent = mock_transport_pop_channel (tc->transport, "a")) == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_bytes_eq (sent, "oh marmalade", -1);

  g_object_unref (router);
}

static void
test_external_bridge (TestCase *tc,
                      gconstpointer unused)
{
  CockpitRouter *router;
  GBytes *sent;
  JsonObject *control;
  CockpitTransport *shim_transport = NULL;
  gchar *problem = NULL;
  CockpitPeer *peer;

  /* Same argv as used by mock_shim */
  router = cockpit_router_new (COCKPIT_TRANSPORT (tc->transport), NULL, NULL);
  peer = cockpit_peer_new (COCKPIT_TRANSPORT (tc->transport), tc->mock_config);
  cockpit_router_add_peer (router, tc->mock_match, peer);

  emit_string (tc, NULL, "{\"command\": \"init\", \"version\": 1, \"host\": \"localhost\" }");
  emit_string (tc, NULL, "{\"command\": \"open\", \"channel\": \"a\", \"payload\": \"upper\"}");
  emit_string (tc, NULL, "{\"command\": \"open\", \"channel\": \"b\", \"payload\": \"upper\"}");
  emit_string (tc, NULL, "{\"command\": \"open\", \"channel\": \"c\", \"payload\": \"upper\"}");

  while ((control = mock_transport_pop_control (tc->transport)) == NULL)
    g_main_context_iteration (NULL, TRUE);

  cockpit_assert_json_eq (control, "{\"command\":\"ready\",\"channel\":\"a\"}");
  control = NULL;

  while ((control = mock_transport_pop_control (tc->transport)) == NULL)
    g_main_context_iteration (NULL, TRUE);

  cockpit_assert_json_eq (control, "{\"command\":\"ready\",\"channel\":\"b\"}");
  control = NULL;

  while ((control = mock_transport_pop_control (tc->transport)) == NULL)
    g_main_context_iteration (NULL, TRUE);

  cockpit_assert_json_eq (control, "{\"command\":\"ready\",\"channel\":\"c\"}");
  control = NULL;

  emit_string (tc, "a", "oh marmalade a");
  while ((sent = mock_transport_pop_channel (tc->transport, "a")) == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_bytes_eq (sent, "OH MARMALADE A", -1);
  sent = NULL;

  /* Get a ref of the shim transport */
  shim_transport = cockpit_peer_ensure (peer);
  g_object_ref (shim_transport);
  g_signal_connect (shim_transport, "closed", G_CALLBACK (on_transport_closed), &problem);

  emit_string (tc, NULL, "{\"command\": \"close\", \"channel\": \"a\" }");
  emit_string (tc, "b", "oh marmalade b");

  while ((control = mock_transport_pop_control (tc->transport)) == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_json_eq (control, "{\"command\":\"close\",\"channel\":\"a\"}");
  control = NULL;

  while ((sent = mock_transport_pop_channel (tc->transport, "b")) == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_bytes_eq (sent, "OH MARMALADE B", -1);
  g_assert_null (problem);
  sent = NULL;

  emit_string (tc, NULL, "{\"command\": \"close-later\", \"channel\": \"b\" }");

  while ((control = mock_transport_pop_control (tc->transport)) == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_json_eq (control, "{\"command\":\"close\",\"channel\":\"b\",\"problem\":\"closed\"}");
  control = NULL;

  g_object_unref (peer);
  g_object_unref (router);
  g_object_unref (shim_transport);
}

static const TestFixture fixture_fail = {
  .payload = "bad"
};

static void
test_external_fail (TestCase *tc,
                    gconstpointer user_data)
{
  CockpitRouter *router;
  JsonObject *received;
  CockpitPeer *peer;

  g_assert (user_data == &fixture_fail);

  router = cockpit_router_new (COCKPIT_TRANSPORT (tc->transport), NULL, NULL);
  peer = cockpit_peer_new (COCKPIT_TRANSPORT (tc->transport), tc->mock_config);
  cockpit_router_add_peer (router, tc->mock_match, peer);
  g_object_unref (peer);

  emit_string (tc, NULL, "{\"command\": \"init\", \"version\": 1, \"host\": \"localhost\" }");
  emit_string (tc, NULL, "{\"command\": \"open\", \"channel\": \"a\", \"payload\": \"bad\"}");
  emit_string (tc, "a", "oh marmalade");

  while ((received = mock_transport_pop_control (tc->transport)) == NULL)
    g_main_context_iteration (NULL, TRUE);

  cockpit_assert_json_eq (received, "{\"command\": \"close\", \"channel\": \"a\", \"problem\": \"not-supported\"}");

  g_object_unref (router);
}

static const TestFixture fixture_dyn_fail = {
  .problem = "bad"
};

static void
test_dynamic_fail (TestCase *tc,
                   gconstpointer user_data)
{
  CockpitRouter *router;
  JsonObject *received;

  g_assert (user_data == &fixture_dyn_fail);

  router = cockpit_router_new (COCKPIT_TRANSPORT (tc->transport), NULL, NULL);
  cockpit_router_add_bridge (router, tc->mock_config);

  emit_string (tc, NULL, "{\"command\": \"init\", \"version\": 1, \"host\": \"localhost\" }");
  emit_string (tc, NULL, "{\"command\": \"open\", \"channel\": \"a\", \"payload\": \"bad\"}");
  emit_string (tc, "a", "oh marmalade");

  while ((received = mock_transport_pop_control (tc->transport)) == NULL)
    g_main_context_iteration (NULL, TRUE);

  cockpit_assert_json_eq (received, "{\"command\": \"close\", \"channel\": \"a\", \"problem\": \"bad\"}");

  g_object_unref (router);
}


static const TestFixture fixture_env = {
  .with_env = TRUE
};

static void
check_ready (JsonObject *control,
             const gchar *channel,
             const gchar *payload,
             gint count,
             gboolean with_env)
{
  g_assert_cmpstr (json_object_get_string_member (control, "channel"), ==, channel);
  g_assert_cmpstr (json_object_get_string_member (control, "command"), ==, "ready");
  g_assert_cmpint (json_object_get_int_member (control, "count"), ==, count);
  if (with_env)
    g_assert_cmpstr (json_object_get_string_member (control, "test-env"), ==, payload);
}

static void
test_dynamic_bridge (TestCase *tc,
                     gconstpointer user_data)
{
  const TestFixture *fixture = user_data;
  CockpitRouter *router;
  GBytes *sent;
  JsonObject *control;

  router = cockpit_router_new (COCKPIT_TRANSPORT (tc->transport), NULL, NULL);
  cockpit_router_add_bridge (router, tc->mock_config);

  emit_string (tc, NULL, "{\"command\": \"init\", \"version\": 1, \"host\": \"localhost\" }");
  emit_string (tc, NULL, "{\"command\": \"open\", \"channel\": \"a\", \"payload\": \"upper\"}");
  emit_string (tc, NULL, "{\"command\": \"open\", \"channel\": \"b\", \"payload\": \"upper\"}");

  while ((control = mock_transport_pop_control (tc->transport)) == NULL)
    g_main_context_iteration (NULL, TRUE);
  check_ready (control, "a", "upper", 0, fixture ? fixture->with_env : FALSE);
  control = NULL;

  while ((control = mock_transport_pop_control (tc->transport)) == NULL)
    g_main_context_iteration (NULL, TRUE);

  check_ready (control, "b", "upper", 1, fixture ? fixture->with_env : FALSE);
  control = NULL;

  emit_string (tc, NULL, "{\"command\": \"open\", \"channel\": \"c\", \"payload\": \"lower\"}");

  while ((control = mock_transport_pop_control (tc->transport)) == NULL)
    g_main_context_iteration (NULL, TRUE);

  check_ready (control, "c", "lower", 0, fixture ? fixture->with_env : FALSE);
  control = NULL;

  emit_string (tc, "a", "oh marmalade a");

  while ((sent = mock_transport_pop_channel (tc->transport, "a")) == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_bytes_eq (sent, "OH MARMALADE A", -1);
  sent = NULL;

  emit_string (tc, NULL, "{\"command\": \"close\", \"channel\": \"a\" }");
  emit_string (tc, "b", "oh marmalade b");

  while ((control = mock_transport_pop_control (tc->transport)) == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_json_eq (control, "{\"command\":\"close\",\"channel\":\"a\"}");
  control = NULL;

  while ((sent = mock_transport_pop_channel (tc->transport, "b")) == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_bytes_eq (sent, "OH MARMALADE B", -1);
  sent = NULL;

  emit_string (tc, NULL, "{\"command\": \"close\", \"channel\": \"b\" }");
  emit_string (tc, "c", "OH MARMALADE C");

  while ((control = mock_transport_pop_control (tc->transport)) == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_json_eq (control, "{\"command\":\"close\",\"channel\":\"b\"}");
  control = NULL;

  while ((sent = mock_transport_pop_channel (tc->transport, "c")) == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_bytes_eq (sent, "oh marmalade c", -1);
  sent = NULL;

  emit_string (tc, NULL, "{\"command\": \"close-later\", \"channel\": \"c\" }");
  while ((control = mock_transport_pop_control (tc->transport)) == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_json_eq (control, "{\"command\":\"close\",\"channel\":\"c\",\"problem\":\"closed\"}");
  control = NULL;

  g_object_unref (router);
}

static const TestFixture fixture_host = {
  .payload = "host",
  .bridge = BUILDDIR "/mock-echo"
};

static void
check_unchanged_host (TestCase *tc,
                      const gchar *host)
{
  JsonObject *control;
  gchar *msg = g_strdup_printf ("{\"command\": \"open\", \"channel\": \"a%s\", \"payload\": \"host\", \"host\": \"%s\"}", host, host);

  emit_string (tc, NULL, msg);
  while ((control = mock_transport_pop_control (tc->transport)) == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_json_eq (control, msg);
  control = NULL;
  g_free (msg);
}

static void
test_host_processing (TestCase *tc,
                      gconstpointer user_data)
{
  JsonObject *control;
  CockpitRouter *router;
  CockpitPeer *peer;

  g_assert (user_data == &fixture_host);

  router = cockpit_router_new (COCKPIT_TRANSPORT (tc->transport), NULL, NULL);
  peer = cockpit_peer_new (COCKPIT_TRANSPORT (tc->transport), tc->mock_config);
  cockpit_router_add_peer (router, tc->mock_match, peer);
  g_object_unref (peer);

  emit_string (tc, NULL, "{\"command\": \"init\", \"version\": 1, \"host\": \"localhost\" }");
  check_unchanged_host (tc, "host");
  check_unchanged_host (tc, "host+");
  check_unchanged_host (tc, "host+key");
  check_unchanged_host (tc, "host+key+");

  /* Test localhost is removed */
  emit_string (tc, NULL, "{\"command\": \"open\", \"channel\": \"a\", \"payload\": \"host\", \"host\":\"localhost\"}");
  while ((control = mock_transport_pop_control (tc->transport)) == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_json_eq (control, "{\"command\": \"open\", \"channel\": \"a\", \"payload\": \"host\"}");
  control = NULL;

  /* Test host-key1 is set to value */
  emit_string (tc, NULL, "{\"command\": \"open\", \"channel\": \"a\", \"payload\": \"host\", \"host\":\"host+key1+value\"}");
  while ((control = mock_transport_pop_control (tc->transport)) == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_json_eq (control, "{\"command\":\"open\",\"channel\":\"a\",\"payload\":\"host\",\"host\":\"host\",\"host-key1\":\"value\"}");
  control = NULL;

  /* Test with + in value */
  emit_string (tc, NULL, "{\"command\": \"open\", \"channel\": \"a\", \"payload\": \"host\", \"host\":\"host+key1+value+value\"}");
  while ((control = mock_transport_pop_control (tc->transport)) == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_json_eq (control, "{\"command\":\"open\",\"channel\":\"a\",\"payload\":\"host\",\"host\":\"host\",\"host-key1\":\"value+value\"}");
  control = NULL;

  /* Test localhost is removed but host-key1 present */
  emit_string (tc, NULL, "{\"command\": \"open\", \"channel\": \"a\", \"payload\": \"host\", \"host\":\"localhost+key1+value\"}");
  while ((control = mock_transport_pop_control (tc->transport)) == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_json_eq (control, "{\"command\":\"open\",\"channel\":\"a\",\"payload\":\"host\",\"host-key1\":\"value\"}");
  control = NULL;

  /* Test doesn't replace host-key1 */
  emit_string (tc, NULL, "{\"command\": \"open\", \"channel\": \"a\", \"payload\": \"host\", \"host\":\"localhost+key1+value\",\"host-key1\":\"extra\"}");
  while ((control = mock_transport_pop_control (tc->transport)) == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_json_eq (control, "{\"command\":\"open\",\"channel\":\"a\",\"payload\":\"host\",\"host\":\"localhost+key1+value\",\"host-key1\":\"extra\"}");
  control = NULL;

  g_object_unref (router);
}

static void
test_sharable_processing (TestCase *tc,
                          gconstpointer user_data)
{
  JsonObject *control;
  CockpitRouter *router;
  CockpitPeer *peer;

  g_assert (user_data == &fixture_host);

  router = cockpit_router_new (COCKPIT_TRANSPORT (tc->transport), NULL, NULL);
  peer = cockpit_peer_new (COCKPIT_TRANSPORT (tc->transport), tc->mock_config);
  cockpit_router_add_peer (router, tc->mock_match, peer);
  g_object_unref (peer);

  emit_string (tc, NULL, "{\"command\": \"init\", \"version\": 1, \"host\": \"localhost\" }");

  /* Test host-key is private */
  emit_string (tc, NULL, "{\"command\": \"open\", \"channel\": \"a\", \"payload\": \"host\", \"host\":\"localhost\", \"host-key\": \"host-key\"}");
  while ((control = mock_transport_pop_control (tc->transport)) == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_json_eq (control, "{\"command\": \"open\", \"channel\": \"a\", \"payload\": \"host\", \"host-key\": \"host-key\", \"session\": \"private\"}");
  control = NULL;

  /* Test user is private */
  emit_string (tc, NULL, "{\"command\": \"open\", \"channel\": \"a\", \"payload\": \"host\", \"host\":\"localhost\", \"user\": \"the.user\"}");
  while ((control = mock_transport_pop_control (tc->transport)) == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_json_eq (control, "{\"command\": \"open\", \"channel\": \"a\", \"payload\": \"host\", \"user\": \"the.user\", \"session\": \"private\"}");
  control = NULL;

  /* Test user with temp-session false is not private */
  emit_string (tc, NULL, "{\"command\": \"open\", \"channel\": \"a\", \"payload\": \"host\", \"host\":\"localhost\", \"user\": \"the.user\", \"temp-session\": false}");
  while ((control = mock_transport_pop_control (tc->transport)) == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_json_eq (control, "{\"command\": \"open\", \"channel\": \"a\", \"payload\": \"host\", \"user\": \"the.user\"}");
  control = NULL;

  /* Test user with shareable is not touched */
  emit_string (tc, NULL, "{\"command\": \"open\", \"channel\": \"a\", \"payload\": \"host\", \"host\":\"localhost\", \"user\": \"the.user\", \"session\": \"other\"}");
  while ((control = mock_transport_pop_control (tc->transport)) == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_json_eq (control, "{\"command\": \"open\", \"channel\": \"a\", \"payload\": \"host\", \"user\": \"the.user\", \"session\": \"other\"}");
  control = NULL;

  g_object_unref (router);
}

static GList *
make_bridge_configs (const gchar *payload, ...)
{
  GList *configs = NULL;
  va_list ap;
  va_start (ap, payload);

  while (payload)
    {
      const gchar *arg = va_arg (ap, const gchar *);

      JsonObject *match = json_object_new ();
      json_object_set_string_member (match, "payload", payload);
      JsonArray *spawn = json_array_new ();
      json_array_add_string_element (spawn, BUILDDIR "/mock-bridge");
      while (arg)
        {
          json_array_add_string_element (spawn, arg);
          arg = va_arg (ap, const gchar *);
        }

      JsonObject *config = json_object_new ();
      json_object_set_object_member (config, "match", match);
      json_object_set_array_member (config, "spawn", spawn);
      json_object_seal (config);

      configs = g_list_prepend (configs, config);

      payload = va_arg (ap, const gchar *);
    }

  va_end (ap);
  return g_list_reverse (configs);
}

static void
free_bridge_configs (GList *configs)
{
  g_list_free_full (configs, (GDestroyNotify)json_object_unref);
}

static void
test_reload_add (TestCase *tc,
                 gconstpointer user_data)
{
  CockpitRouter *router;
  GList *configs;
  JsonObject *control;
  GBytes *sent;

  router = cockpit_router_new (COCKPIT_TRANSPORT (tc->transport), NULL, NULL);
  emit_string (tc, NULL, "{\"command\": \"init\", \"version\": 1, \"host\": \"localhost\" }");

  // Configure only the "upper" payload
  configs = make_bridge_configs ("upper", "--upper", NULL,
                                 NULL);
  cockpit_router_set_bridges (router, configs);
  free_bridge_configs (configs);

  // Open a "upper" channel
  emit_string (tc, NULL, "{\"command\": \"open\", \"channel\": \"a\", \"payload\": \"upper\"}");
  while ((control = mock_transport_pop_control (tc->transport)) == NULL)
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpstr (json_object_get_string_member (control, "channel"), ==, "a");
  g_assert_cmpstr (json_object_get_string_member (control, "command"), ==, "ready");
  control = NULL;

  // And check that it works
  emit_string (tc, "a", "before reload");
  while ((sent = mock_transport_pop_channel (tc->transport, "a")) == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_bytes_eq (sent, "BEFORE RELOAD", -1);
  sent = NULL;

  // Try to open a "lower" channel and check that this is rejected
  emit_string (tc, NULL, "{\"command\": \"open\", \"channel\": \"b\", \"payload\": \"lower\"}");
  while ((control = mock_transport_pop_control (tc->transport)) == NULL)
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpstr (json_object_get_string_member (control, "channel"), ==, "b");
  g_assert_cmpstr (json_object_get_string_member (control, "command"), ==, "close");
  g_assert_cmpstr (json_object_get_string_member (control, "problem"), ==, "not-supported");
  control = NULL;

  // Reconfigure and add the "lower" payload
  configs = make_bridge_configs ("upper", "--upper", NULL,
                                 "lower", "--lower", NULL,
                                 NULL);
  cockpit_router_set_bridges (router, configs);
  free_bridge_configs (configs);

  // Check that the "upper" channel still works
  emit_string (tc, "a", "after reload");
  while ((sent = mock_transport_pop_channel (tc->transport, "a")) == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_bytes_eq (sent, "AFTER RELOAD", -1);
  sent = NULL;

  // Open a "lower" channel
  emit_string (tc, NULL, "{\"command\": \"open\", \"channel\": \"c\", \"payload\": \"lower\"}");
  while ((control = mock_transport_pop_control (tc->transport)) == NULL)
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpstr (json_object_get_string_member (control, "channel"), ==, "c");
  g_assert_cmpstr (json_object_get_string_member (control, "command"), ==, "ready");
  control = NULL;

  // And check that it now works
  emit_string (tc, "c", "NEW PAYLOAD");
  while ((sent = mock_transport_pop_channel (tc->transport, "c")) == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_bytes_eq (sent, "new payload", -1);
  sent = NULL;

  g_object_unref (router);
}

static void
test_reload_remove (TestCase *tc,
                    gconstpointer user_data)
{
  CockpitRouter *router;
  GList *configs;
  JsonObject *control;
  GBytes *sent;

  router = cockpit_router_new (COCKPIT_TRANSPORT (tc->transport), NULL, NULL);
  emit_string (tc, NULL, "{\"command\": \"init\", \"version\": 1, \"host\": \"localhost\" }");

  // Configure the "upper" payload
  configs = make_bridge_configs ("upper", "--upper", NULL,
                                 NULL);
  cockpit_router_set_bridges (router, configs);
  free_bridge_configs (configs);

  // Open a "upper" channel
  emit_string (tc, NULL, "{\"command\": \"open\", \"channel\": \"a\", \"payload\": \"upper\"}");
  while ((control = mock_transport_pop_control (tc->transport)) == NULL)
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpstr (json_object_get_string_member (control, "channel"), ==, "a");
  g_assert_cmpstr (json_object_get_string_member (control, "command"), ==, "ready");
  control = NULL;

  // And check that it works
  emit_string (tc, "a", "before reload");
  while ((sent = mock_transport_pop_channel (tc->transport, "a")) == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_bytes_eq (sent, "BEFORE RELOAD", -1);
  sent = NULL;

  // Reconfigure and remove the "upper" payload
  configs = make_bridge_configs (NULL);
  cockpit_router_set_bridges (router, configs);
  free_bridge_configs (configs);

  // Check that the "upper" channel has been closed
  while ((control = mock_transport_pop_control (tc->transport)) == NULL)
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpstr (json_object_get_string_member (control, "channel"), ==, "a");
  g_assert_cmpstr (json_object_get_string_member (control, "command"), ==, "close");
  g_assert_cmpstr (json_object_get_string_member (control, "problem"), ==, "terminated");
  control = NULL;

  g_object_unref (router);
}

static void
on_complete_get_result (GObject *source,
                        GAsyncResult *result,
                        gpointer user_data)
{
  GAsyncResult **ret = user_data;
  g_assert (ret != NULL);
  g_assert (*ret == NULL);
  *ret = g_object_ref (result);
}

static GVariant *
dbus_call_with_main_loop (TestCase *tc,
                          const gchar *object_path,
                          const gchar *interface_name,
                          const gchar *method_name,
                          GVariant *parameters,
                          const GVariantType *reply_type,
                          GError **error)
{
  GAsyncResult *result = NULL;
  GVariant *retval;

  g_dbus_connection_call (tc->connection, NULL, object_path,
                          interface_name, method_name, parameters,
                          reply_type, G_DBUS_CALL_FLAGS_NONE, -1,
                          NULL, on_complete_get_result, &result);

  while (result == NULL)
    g_main_context_iteration (NULL, TRUE);

  retval = g_dbus_connection_call_finish (tc->connection, result, error);
  g_object_unref (result);

  return retval;
}

static const TestFixture fixture_superuser = {
  .privileged = TRUE
};

static void
test_superuser_none (TestCase *tc,
                     gconstpointer user_data)
{
  CockpitRouter *router;
  JsonObject *control;

  router = cockpit_router_new (COCKPIT_TRANSPORT (tc->transport), NULL, NULL);
  cockpit_router_dbus_startup (router);

  cockpit_router_add_bridge (router, tc->mock_config);
  emit_string (tc, NULL, "{'command': 'init', 'version': 1, 'host': 'localhost', 'superuser': false }");

  // Superuser channels should be rejected
  //
  emit_string (tc, NULL, "{'command': 'open', 'channel': 'a', 'payload': 'upper', 'superuser': true}");
  while ((control = mock_transport_pop_control (tc->transport)) == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_json_eq (control, "{'command':'close','channel':'a', 'problem':'access-denied'}");
  control = NULL;

  g_object_unref (router);
}

static void
test_superuser_get_all (TestCase *tc,
                        gconstpointer user_data)
{
  CockpitRouter *router;
  GError *error = NULL;
  GVariant *retval;

  router = cockpit_router_new (COCKPIT_TRANSPORT (tc->transport), NULL, NULL);
  cockpit_router_dbus_startup (router);

  cockpit_router_add_bridge (router, tc->mock_config);
  emit_string (tc, NULL, "{'command': 'init', 'version': 1, 'host': 'localhost', 'superuser': false }");

  retval = dbus_call_with_main_loop (tc, "/superuser", "org.freedesktop.DBus.Properties", "GetAll",
                                     g_variant_new ("(s)", "cockpit.Superuser"),
                                     G_VARIANT_TYPE ("(a{sv})"), &error);

  g_assert_no_error (error);
  cockpit_assert_gvariant_eq (retval, "({'Bridges': <['mock-bridge']>, 'Current': <'none'>},)");

  g_variant_unref (retval);
  g_object_unref (router);
}

static void
assert_superuser_current (TestCase *tc,
                          const gchar *expected)
{
  GVariant *retval;
  GError *error = NULL;
  gchar *expected_variant;

  retval = dbus_call_with_main_loop (tc, "/superuser", "org.freedesktop.DBus.Properties", "Get",
                                     g_variant_new ("(ss)", "cockpit.Superuser", "Current"),
                                     G_VARIANT_TYPE ("(v)"), &error);
  g_assert_no_error (error);
  expected_variant = g_strdup_printf ("(<'%s'>,)", expected);
  cockpit_assert_gvariant_eq (retval, expected_variant);
  g_free (expected_variant);
  g_variant_unref (retval);
}

static void
test_superuser_start (TestCase *tc,
                      gconstpointer user_data)
{
  CockpitRouter *router;
  GError *error = NULL;
  JsonObject *control;
  GVariant *retval;

  router = cockpit_router_new (COCKPIT_TRANSPORT (tc->transport), NULL, NULL);
  cockpit_router_dbus_startup (router);

  cockpit_router_add_bridge (router, tc->mock_config);
  emit_string (tc, NULL, "{'command': 'init', 'version': 1, 'host': 'localhost', 'superuser': false }");

  assert_superuser_current (tc, "none");

  retval = dbus_call_with_main_loop (tc, "/superuser", "cockpit.Superuser", "Start",
                                     g_variant_new ("(s)", "mock-bridge"),
                                     G_VARIANT_TYPE ("()"), &error);
  g_assert_no_error (error);

  assert_superuser_current (tc, "mock-bridge");

  // Superuser channels should now work
  //
  emit_string (tc, NULL, "{'command': 'open', 'channel': 'a', 'payload': 'upper', 'superuser': true}");
  while ((control = mock_transport_pop_control (tc->transport)) == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_json_eq (control, "{'command':'ready','channel':'a'}");
  control = NULL;

  g_variant_unref (retval);
  g_object_unref (router);
}

int
main (int argc,
      char *argv[])
{
  cockpit_test_init (&argc, &argv);

  g_test_add ("/router/local-channel", TestCase, NULL,
              setup, test_local_channel, teardown);
  g_test_add ("/router/external-bridge", TestCase, NULL,
              setup, test_external_bridge, teardown);
  g_test_add ("/router/external-fail", TestCase, &fixture_fail,
              setup, test_external_fail, teardown);
  g_test_add ("/router/dynamic-bridge-fail", TestCase, &fixture_dyn_fail,
              setup_dynamic, test_dynamic_fail, teardown);
  g_test_add ("/router/dynamic-bridge", TestCase, NULL,
              setup_dynamic, test_dynamic_bridge, teardown);
  g_test_add ("/router/dynamic-bridge-env", TestCase, &fixture_env,
              setup_dynamic, test_dynamic_bridge, teardown);
  g_test_add ("/router/host-processing", TestCase, &fixture_host,
              setup, test_host_processing, teardown);
  g_test_add ("/router/sharable-processing", TestCase, &fixture_host,
              setup, test_sharable_processing, teardown);

  g_test_add ("/router/reload/add", TestCase, NULL,
              setup, test_reload_add, teardown);
  g_test_add ("/router/reload/remove", TestCase, NULL,
              setup, test_reload_remove, teardown);

  g_test_add ("/router/superuser/none", TestCase, &fixture_superuser,
              setup, test_superuser_none, teardown);
  g_test_add ("/router/superuser/get-all", TestCase, &fixture_superuser,
              setup, test_superuser_get_all, teardown);
  g_test_add ("/router/superuser/start", TestCase, &fixture_superuser,
              setup, test_superuser_start, teardown);

  return g_test_run ();
}
