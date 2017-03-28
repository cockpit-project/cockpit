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

#include "cockpitchannel.h"
#include "cockpitrouter.h"
#include "mock-channel.h"
#include "mock-transport.h"

#include "common/cockpitjson.h"
#include "common/cockpittest.h"

#include <json-glib/json-glib.h>

#include <gio/gio.h>

#include <string.h>

/* Mock override from cockpitrouter.c */
extern guint cockpit_router_bridge_timeout;

typedef struct {
  MockTransport *transport;
  JsonObject *mock_match;
  JsonObject *mock_config;
} TestCase;

typedef struct {
  const gchar *payload;
  gboolean with_env;
  const gchar *problem;
} TestFixture;

static void
setup (TestCase *tc,
       gconstpointer user_data)
{
  const TestFixture *fixture = user_data;
  JsonArray *argv;
  gchar *argument;
  const gchar *payload;

  tc->mock_config = json_object_new ();
  argv = json_array_new ();
  json_array_add_string_element (argv, BUILDDIR "/mock-bridge");
  payload = "upper";
  if (fixture && fixture->payload)
    payload = fixture->payload;
  argument = g_strdup_printf ("--%s", payload);
  json_array_add_string_element (argv, argument);
  g_free (argument);
  json_object_set_array_member (tc->mock_config, "spawn", argv);
  tc->mock_match = json_object_new ();
  json_object_set_string_member (tc->mock_match, "payload", payload);

  tc->transport = g_object_new (mock_transport_get_type (), NULL);
  while (g_main_context_iteration (NULL, FALSE));
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
  return g_test_run ();
}
