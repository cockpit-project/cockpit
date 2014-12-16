/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2014 Red Hat, Inc.
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

#include "cockpitmetrics.h"
#include "mock-transport.h"

#include "common/cockpittest.h"
#include "common/cockpitjson.h"

#include <string.h>
#include <stdio.h>
#include <errno.h>
#include <sys/stat.h>
#include <dlfcn.h>

#include <pcp/pmapi.h>
#include <pcp/impl.h>

void (*mock_pmda_control) (const char *cmd, ...);

static void
init_mock_pmda (void)
{
  g_assert (pmLoadNameSpace (SRCDIR "/src/bridge/mock-pmns") >= 0);

  g_assert (__pmLocalPMDA (PM_LOCAL_CLEAR, 0, NULL, NULL) >= 0);
  g_assert (__pmLocalPMDA (PM_LOCAL_ADD, 333, "./mock-pmda.so", "mock_init") >= 0);

  void *handle = dlopen ("./mock-pmda.so", RTLD_NOW);
  g_assert (handle != NULL);

  mock_pmda_control = dlsym (handle, "mock_control");
  g_assert (mock_pmda_control != NULL);
}

typedef struct AtTeardown {
  struct AtTeardown *link;
  void (*func) (void *);
  void *data;
} AtTeardown;

typedef struct {
  MockTransport *transport;
  CockpitChannel *channel;
  gchar *problem;
  gboolean channel_closed;

  AtTeardown *at_teardown;
} TestCase;

static void
on_channel_close (CockpitChannel *channel,
                  const gchar *problem,
                  gpointer user_data)
{
  TestCase *tc = user_data;
  g_assert (tc->channel_closed == FALSE);
  tc->problem = g_strdup (problem);
  tc->channel_closed = TRUE;
}

static void
on_transport_closed (CockpitTransport *transport,
                     const gchar *problem,
                     gpointer user_data)
{
  g_assert_not_reached ();
}

static void
setup (TestCase *tc,
       gconstpointer data)
{
  tc->transport = mock_transport_new ();
  g_signal_connect (tc->transport, "closed", G_CALLBACK (on_transport_closed), NULL);
  tc->channel = NULL;
  tc->at_teardown = NULL;

  mock_pmda_control ("reset");
}

static void
at_teardown (TestCase *tc, void *func, void *data)
{
  AtTeardown *item = g_new0 (AtTeardown, 1);

  item->func = func;
  item->data = data;
  item->link = tc->at_teardown;
  tc->at_teardown = item;
}

static void
setup_metrics_channel_json (TestCase *tc, JsonObject *options)
{
  tc->channel = cockpit_metrics_open (COCKPIT_TRANSPORT (tc->transport), "1234", options);
  tc->channel_closed = FALSE;
  g_signal_connect (tc->channel, "closed", G_CALLBACK (on_channel_close), tc);
  cockpit_channel_prepare (tc->channel);
}

static GBytes *
recv_bytes (TestCase *tc)
{
  GBytes *msg;
  while ((msg = mock_transport_pop_channel (tc->transport, "1234")) == NULL)
    g_main_context_iteration (NULL, TRUE);
  return msg;
}

static JsonObject *
recv_json_object (TestCase *tc)
{
  GBytes *msg = recv_bytes (tc);
  JsonObject *res = cockpit_json_parse_bytes (msg, NULL);
  g_assert (res != NULL);
  at_teardown (tc, json_object_unref, res);
  return res;
}

static JsonNode *
recv_json (TestCase *tc)
{
  GBytes *msg = recv_bytes (tc);
  gsize length = g_bytes_get_size (msg);
  JsonNode *res = cockpit_json_parse (g_bytes_get_data (msg, NULL), length, NULL);
  g_assert (res != NULL);
  at_teardown (tc, json_node_free, res);
  return res;
}

static void
wait_channel_closed (TestCase *tc)
{
  while (tc->channel_closed == FALSE)
    g_main_context_iteration (NULL, TRUE);
}

static void
teardown (TestCase *tc,
          gconstpointer data)
{
  cockpit_assert_expected ();

  g_object_unref (tc->transport);

  if (tc->channel)
    {
      g_object_add_weak_pointer (G_OBJECT (tc->channel), (gpointer *)&tc->channel);
      g_object_unref (tc->channel);
      g_assert (tc->channel == NULL);
    }

  while (tc->at_teardown)
    {
      AtTeardown *item = tc->at_teardown;
      tc->at_teardown = item->link;
      item->func (item->data);
      g_free (item);
    }

  g_free (tc->problem);
}

static JsonObject *
json_obj (const gchar *str)
{
  JsonObject *res = cockpit_json_parse_object(str, -1, NULL);
  g_assert (res != NULL);
  return res;
}

static JsonNode *
json (const gchar *str)
{
  JsonNode *res = cockpit_json_parse(str, -1, NULL);
  g_assert (res != NULL);
  return res;
}

static gboolean
json_equal (JsonNode *node, const gchar *str)
{
  JsonNode *node2 = json (str);
  gboolean res = cockpit_json_equal (node, node2);
  json_node_free (node2);
  return res;
}

static void
assert_sample (TestCase *tc, const gchar *json_str)
{
  g_assert (json_equal (recv_json (tc), json_str));
}

static void
test_metrics_compression (TestCase *tc,
                          gconstpointer unused)
{
  JsonObject *options = json_obj("{ 'source': 'direct',"
                                 "  'metrics': [ { 'name': 'mock.value' } ],"
                                 "  'interval': 1"
                                 "}");

  setup_metrics_channel_json (tc, options);

  JsonObject *meta = recv_json_object (tc);
  g_assert (json_equal (json_object_get_member (meta, "metrics"),
                        "[ { 'name': 'mock.value', 'type': 'number', 'units': '', 'semantics': 'instant' } ]"));

  assert_sample (tc, "[[0]]");
  assert_sample (tc, "[[]]");
  assert_sample (tc, "[[]]");
  mock_pmda_control ("set-value", 0, 1);
  assert_sample (tc, "[[1]]");
  assert_sample (tc, "[[]]");

  json_object_unref (options);
}

static void
test_metrics_units (TestCase *tc,
                    gconstpointer unused)
{
  JsonObject *options = json_obj("{ 'source': 'direct',"
                                 "  'metrics': [ { 'name': 'mock.seconds' } ],"
                                 "  'interval': 1"
                                 "}");

  setup_metrics_channel_json (tc, options);

  JsonObject *meta = recv_json_object (tc);
  g_assert (json_equal (json_object_get_member (meta, "metrics"),
                        "[ { 'name': 'mock.seconds', 'type': 'number', 'units': 'sec', 'semantics': 'instant' } ]"));

  assert_sample (tc, "[[60]]");

  json_object_unref (options);
}

static void
test_metrics_units_conv (TestCase *tc,
                         gconstpointer unused)
{
  JsonObject *options = json_obj("{ 'source': 'direct',"
                                 "  'metrics': [ { 'name': 'mock.seconds', 'units': 'min' } ],"
                                 "  'interval': 1"
                                 "}");
  setup_metrics_channel_json (tc, options);

  JsonObject *meta = recv_json_object (tc);
  g_assert (json_equal (json_object_get_member (meta, "metrics"),
                        "[ { 'name': 'mock.seconds', 'type': 'number', 'units': 'min', 'semantics': 'instant' } ]"));

  assert_sample (tc, "[[1]]");

  json_object_unref (options);
}

static void
test_metrics_units_noconv (TestCase *tc,
                           gconstpointer unused)
{
  cockpit_expect_warning ("direct: can't convert metric mock.seconds to units byte");

  JsonObject *options = json_obj("{ 'source': 'direct',"
                                 "  'metrics': [ { 'name': 'mock.seconds', 'units': 'byte' } ],"
                                 "  'interval': 1"
                                 "}");
  setup_metrics_channel_json (tc, options);

  wait_channel_closed (tc);
  g_assert_cmpstr (tc->problem, ==, "protocol-error");

  json_object_unref (options);
}

static void
test_metrics_units_funny_conv (TestCase *tc,
                               gconstpointer unused)
{
  JsonObject *options = json_obj("{ 'source': 'direct',"
                                 "  'metrics': [ { 'name': 'mock.seconds', 'units': '2 min' } ],"
                                 "  'interval': 1"
                                 "}");
  setup_metrics_channel_json (tc, options);

  JsonObject *meta = recv_json_object (tc);
  g_assert (json_equal (json_object_get_member (meta, "metrics"),
                        "[ { 'name': 'mock.seconds', 'type': 'number', 'units': 'min*2', 'semantics': 'instant' } ]"));

  assert_sample (tc, "[[0.5]]");

  json_object_unref (options);
}

static void
test_metrics_strings (TestCase *tc,
                      gconstpointer unused)
{
  JsonObject *options = json_obj("{ 'source': 'direct',"
                                 "  'metrics': [ { 'name': 'mock.string' } ],"
                                 "  'interval': 1"
                                 "}");
  setup_metrics_channel_json (tc, options);

  JsonObject *meta = recv_json_object (tc);
  g_assert (json_equal (json_object_get_member (meta, "metrics"),
                        "[ { 'name': 'mock.string', 'type': 'string', 'units': '', 'semantics': 'instant' } ]"));

  assert_sample (tc, "[['foobar']]");
  assert_sample (tc, "[[]]");

  mock_pmda_control ("set-string", "barfoo");

  assert_sample (tc, "[['barfoo']]");

  json_object_unref (options);
}

static void
test_metrics_wrong_type (TestCase *tc,
                         gconstpointer unused)
{
  cockpit_expect_warning ("direct: metric mock.string is not a number");

  JsonObject *options = json_obj("{ 'source': 'direct',"
                                 "  'metrics': [ { 'name': 'mock.string', 'type': 'number' } ],"
                                 "  'interval': 1"
                                 "}");
  setup_metrics_channel_json (tc, options);

  wait_channel_closed (tc);
  g_assert_cmpstr (tc->problem, ==, "protocol-error");

  json_object_unref (options);
}

static void
test_metrics_wrong_semantics (TestCase *tc,
                              gconstpointer unused)
{
  cockpit_expect_warning ("direct: metric mock.value is not a counter");

  JsonObject *options = json_obj("{ 'source': 'direct',"
                                 "  'metrics': [ { 'name': 'mock.value', 'semantics': 'counter' } ],"
                                 "  'interval': 1"
                                 "}");
  setup_metrics_channel_json (tc, options);

  wait_channel_closed (tc);
  g_assert_cmpstr (tc->problem, ==, "protocol-error");

  json_object_unref (options);
}

static void
test_metrics_simple_instances (TestCase *tc,
                               gconstpointer unused)
{
  JsonObject *options = json_obj("{ 'source': 'direct',"
                                 "  'metrics': [ { 'name': 'mock.values' } ],"
                                 "  'interval': 1"
                                 "}");

  setup_metrics_channel_json (tc, options);

  JsonObject *meta = recv_json_object (tc);
  g_assert (json_equal (json_object_get_member (meta, "metrics"),
                        "[ { 'name': 'mock.values', 'type': 'number', 'units': '', 'semantics': 'instant', "
                        "    'instances': ['red', 'green', 'blue'] "
                        "  } ]"));

  assert_sample (tc, "[[[0, 0, 0]]]");
  mock_pmda_control ("set-value", 1, 1);
  assert_sample (tc, "[[[1]]]");
  mock_pmda_control ("set-value", 2, 1);
  assert_sample (tc, "[[[null, 1]]]");
  mock_pmda_control ("set-value", 3, 1);
  assert_sample (tc, "[[[null, null, 1]]]");
  assert_sample (tc, "[[[]]]");

  json_object_unref (options);
}

static void
test_metrics_instance_filter_include (TestCase *tc,
                                      gconstpointer unused)
{
  JsonObject *options = json_obj("{ 'source': 'direct',"
                                 "  'metrics': [ { 'name': 'mock.values' } ],"
                                 "  'instances': [ 'red', 'blue' ],"
                                 "  'interval': 1"
                                 "}");

  setup_metrics_channel_json (tc, options);

  JsonObject *meta = recv_json_object (tc);
  g_assert (json_equal (json_object_get_member (meta, "metrics"),
                        "[ { 'name': 'mock.values', 'type': 'number', 'units': '', 'semantics': 'instant', "
                        "    'instances': ['red', 'blue'] "
                        "  } ]"));

  assert_sample (tc, "[[[0, 0]]]");
  mock_pmda_control ("set-value", 3, 1);
  assert_sample (tc, "[[[null, 1]]]");

  json_object_unref (options);
}

static void
test_metrics_instance_filter_omit (TestCase *tc,
                                   gconstpointer unused)
{
  JsonObject *options = json_obj("{ 'source': 'direct',"
                                 "  'metrics': [ { 'name': 'mock.values' } ],"
                                 "  'omit-instances': [ 'green' ],"
                                 "  'interval': 1"
                                 "}");

  setup_metrics_channel_json (tc, options);

  JsonObject *meta = recv_json_object (tc);
  g_assert (json_equal (json_object_get_member (meta, "metrics"),
                        "[ { 'name': 'mock.values', 'type': 'number', 'units': '', 'semantics': 'instant', "
                        "    'instances': ['red', 'blue'] "
                        "  } ]"));

  assert_sample (tc, "[[[0, 0]]]");
  mock_pmda_control ("set-value", 3, 1);
  assert_sample (tc, "[[[null, 1]]]");

  json_object_unref (options);
}

static void
test_metrics_instance_dynamic (TestCase *tc,
                               gconstpointer unused)
{
  JsonObject *meta;
  JsonObject *options = json_obj("{ 'source': 'direct',"
                                 "  'metrics': [ { 'name': 'mock.instances' } ],"
                                 "  'interval': 1"
                                 "}");

  setup_metrics_channel_json (tc, options);

  meta = recv_json_object (tc);
  g_assert (json_equal (json_object_get_member (meta, "metrics"),
                        "[ { 'name': 'mock.instances', 'type': 'number', 'units': '', 'semantics': 'instant', "
                        "    'instances': [] "
                        "  } ]"));

  assert_sample (tc, "[[[]]]");

  mock_pmda_control ("add-instance", "bananas", 5);
  mock_pmda_control ("add-instance", "milk", 3);

  meta = recv_json_object (tc);
  g_assert (json_equal (json_object_get_member (meta, "metrics"),
                        "[ { 'name': 'mock.instances', 'type': 'number', 'units': '', 'semantics': 'instant', "
                        "    'instances': [ 'bananas', 'milk' ] "
                        "  } ]"));
  assert_sample (tc, "[[[ 5, 3 ]]]");
  assert_sample (tc, "[[[]]]");

  mock_pmda_control ("del-instance", "bananas");

  meta = recv_json_object (tc);
  g_assert (json_equal (json_object_get_member (meta, "metrics"),
                        "[ { 'name': 'mock.instances', 'type': 'number', 'units': '', 'semantics': 'instant', "
                        "    'instances': [ 'milk' ] "
                        "  } ]"));
  assert_sample (tc, "[[[ 3 ]]]");

  mock_pmda_control ("add-instance", "milk", 2);

  assert_sample (tc, "[[[ 2 ]]]");

  json_object_unref (options);
}

static void
test_metrics_counter (TestCase *tc,
                      gconstpointer unused)
{
  JsonObject *options = json_obj("{ 'source': 'direct',"
                                 "  'metrics': [ { 'name': 'mock.counter' } ],"
                                 "  'interval': 1"
                                 "}");

  setup_metrics_channel_json (tc, options);

  JsonObject *meta = recv_json_object (tc);
  g_assert (json_equal (json_object_get_member (meta, "metrics"),
                        "[ { 'name': 'mock.counter', 'type': 'number', 'units': '', 'semantics': 'counter' } ]"));

  assert_sample (tc, "[[]]");
  assert_sample (tc, "[[0]]");
  assert_sample (tc, "[[0]]");
  mock_pmda_control ("inc-counter", 5);
  assert_sample (tc, "[[5]]");
  assert_sample (tc, "[[0]]");

  json_object_unref (options);
}

static void
test_metrics_counter64 (TestCase *tc,
                        gconstpointer unused)
{
  JsonObject *options = json_obj("{ 'source': 'direct',"
                                 "  'metrics': [ { 'name': 'mock.counter64' } ],"
                                 "  'interval': 1"
                                 "}");

  setup_metrics_channel_json (tc, options);

  JsonObject *meta = recv_json_object (tc);
  g_assert (json_equal (json_object_get_member (meta, "metrics"),
                        "[ { 'name': 'mock.counter64', 'type': 'number', 'units': '', 'semantics': 'counter' } ]"));

  assert_sample (tc, "[[]]");
  assert_sample (tc, "[[0]]");
  assert_sample (tc, "[[0]]");
  mock_pmda_control ("inc-counter64", 5);
  assert_sample (tc, "[[5]]");
  assert_sample (tc, "[[0]]");

  json_object_unref (options);
}

int
main (int argc,
      char *argv[])
{
  cockpit_test_init (&argc, &argv);

  init_mock_pmda ();

  g_test_add ("/metrics/compression", TestCase, NULL,
              setup, test_metrics_compression, teardown);

  g_test_add ("/metrics/units", TestCase, NULL,
              setup, test_metrics_units, teardown);
  g_test_add ("/metrics/units-conv", TestCase, NULL,
              setup, test_metrics_units_conv, teardown);
  g_test_add ("/metrics/units-noconv", TestCase, NULL,
              setup, test_metrics_units_noconv, teardown);
  g_test_add ("/metrics/units-funny-conv", TestCase, NULL,
              setup, test_metrics_units_funny_conv, teardown);

  g_test_add ("/metrics/strings", TestCase, NULL,
              setup, test_metrics_strings, teardown);
  g_test_add ("/metrics/wrong-type", TestCase, NULL,
              setup, test_metrics_wrong_type, teardown);

  g_test_add ("/metrics/wrong-semantics", TestCase, NULL,
              setup, test_metrics_wrong_semantics, teardown);

  g_test_add ("/metrics/simple-instances", TestCase, NULL,
              setup, test_metrics_simple_instances, teardown);
  g_test_add ("/metrics/instance-filter-include", TestCase, NULL,
              setup, test_metrics_instance_filter_include, teardown);
  g_test_add ("/metrics/instance-filter-omit", TestCase, NULL,
              setup, test_metrics_instance_filter_omit, teardown);
  g_test_add ("/metrics/instance-dynamic", TestCase, NULL,
              setup, test_metrics_instance_dynamic, teardown);

  g_test_add ("/metrics/counter", TestCase, NULL,
              setup, test_metrics_counter, teardown);
  g_test_add ("/metrics/counter64", TestCase, NULL,
              setup, test_metrics_counter64, teardown);

  return g_test_run ();
}
