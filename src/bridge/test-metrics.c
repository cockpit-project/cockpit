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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

#include "config.h"
#include <math.h>

#include "cockpitmetrics.h"

#include "cockpitinternalmetrics.h"

#include "testlib/cockpittest.h"
#include "common/cockpitjson.h"
#include "testlib/mock-transport.h"

#include <unistd.h>

typedef struct {
  MockTransport *transport;
  CockpitMetrics *channel;
  gchar *problem;
  gboolean channel_closed;
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

typedef struct _CockpitMetrics MockMetrics;
typedef struct _CockpitMetricsClass MockMetricsClass;

GType mock_metrics_get_type (void);

G_DEFINE_TYPE (MockMetrics, mock_metrics, COCKPIT_TYPE_METRICS);

static void
mock_metrics_init (MockMetrics *self)
{
  /* nothing */
}

static void
mock_metrics_class_init (MockMetricsClass *self)
{
  /* nothing */
}

static void
setup (TestCase *tc,
       gconstpointer data)
{
  tc->transport = mock_transport_new ();
  g_signal_connect (tc->transport, "closed", G_CALLBACK (on_transport_closed), NULL);
  tc->channel = g_object_new (mock_metrics_get_type (),
                              "transport", tc->transport,
                              "id", "1234",
                              NULL);
  g_signal_connect (tc->channel, "closed", G_CALLBACK (on_channel_close), tc);

  /* Switch off compression by default.  Compression is done by
   * comparing two floating point values for exact equality, and we
   * can't guarantee that we get the same behavior everywhere.
   */
  cockpit_metrics_set_compress (tc->channel, FALSE);
}

static GBytes *
recv_bytes (MockTransport *transport)
{
  GBytes *msg;
  while ((msg = mock_transport_pop_channel (transport, "1234")) == NULL)
    g_main_context_iteration (NULL, TRUE);
  return msg;
}

static JsonObject *
recv_object (MockTransport *transport)
{
  GBytes *msg = recv_bytes (transport);
  JsonObject *res = cockpit_json_parse_bytes (msg, NULL);
  g_assert (res != NULL);
  return res;
}

static JsonArray *
recv_array (MockTransport *transport)
{
  GBytes *msg;
  GError *error = NULL;
  JsonArray *array;
  JsonNode *node;

  msg = recv_bytes (transport);
  node = cockpit_json_parse (g_bytes_get_data (msg, NULL), g_bytes_get_size (msg), &error);
  g_assert_no_error (error);
  g_assert_cmpint (json_node_get_node_type (node), ==, JSON_NODE_ARRAY);

  array = json_node_dup_array (node);
  json_node_free (node);
  return array;
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

  g_free (tc->problem);
}

static void
assert_sample_msg (const char *domain,
                   const char *file,
                   int line,
                   const char *func,
                   TestCase *tc,
                   const gchar *json_str)
{
  JsonArray *array = recv_array (tc->transport);
  _cockpit_assert_json_eq_msg (domain, file, line, func, array, json_str);
  json_array_unref (array);
}

#define assert_sample(tc, json) \
  (assert_sample_msg (G_LOG_DOMAIN, __FILE__, __LINE__, G_STRFUNC, (tc), (json)))

static JsonObject *
json_obj_msg (const char *domain,
              const char *file,
              int line,
              const char *func,
              const gchar *json_str)
{
  GError *error = NULL;
  JsonObject *res = cockpit_json_parse_object (json_str, -1, &error);
  if (error)
    g_assertion_message_error (domain, file, line, func, "error", error, 0, 0);
  return res;
}

#define json_obj(json_str) \
  (json_obj_msg (G_LOG_DOMAIN, __FILE__, __LINE__, G_STRFUNC, (json_str)))

static void
send_sample (TestCase *tc, gint64 timestamp, int n, ...)
{
  va_list ap;
  va_start (ap, n);

  double **buffer;
  buffer = cockpit_metrics_get_data_buffer (tc->channel);
  for (int i = 0; i < n; i++)
    buffer[i][0] = va_arg (ap, double);
  cockpit_metrics_send_data (tc->channel, timestamp);
  cockpit_metrics_flush_data (tc->channel);

  va_end (ap);
}

static void
send_instance_sample (TestCase *tc, gint64 timestamp, int n, ...)
{
  va_list ap;
  va_start (ap, n);

  double **buffer;
  buffer = cockpit_metrics_get_data_buffer (tc->channel);
  for (int i = 0; i < n; i++)
    buffer[0][i] = va_arg (ap, double);
  cockpit_metrics_send_data (tc->channel, timestamp);
  cockpit_metrics_flush_data (tc->channel);

  va_end (ap);
}

static void
test_compression (TestCase *tc,
                  gconstpointer unused)
{
  cockpit_metrics_set_compress (tc->channel, TRUE);

  JsonObject *meta = json_obj ("{ 'metrics': [ { 'name': 'foo' },"
                               "               { 'name': 'bar' }"
                               "             ],"
                               "  'interval': 1000"
                               "}");
  cockpit_metrics_send_meta (tc->channel, meta, FALSE);
  json_object_unref (recv_object (tc->transport));

  send_sample (tc,    0, 2, 0.0, 0.0);
  assert_sample (tc, "[[0,0]]");
  send_sample (tc, 1000, 2, 0.0, 0.0);
  assert_sample (tc, "[[]]");
  send_sample (tc, 2000, 2, 0.0, 0.0);
  assert_sample (tc, "[[]]");

  send_sample (tc, 3000, 2, 0.0, 1.0);
  assert_sample (tc, "[[null, 1]]");

  send_sample (tc, 4000, 2, 1.0, 1.0);
  assert_sample (tc, "[[1]]");

  json_object_unref (meta);
}

static void
test_compression_reset (TestCase *tc,
                        gconstpointer unused)
{
  cockpit_metrics_set_compress (tc->channel, TRUE);

  JsonObject *meta = json_obj ("{ 'metrics': [ { 'name': 'foo' },"
                               "               { 'name': 'bar' }"
                               "             ],"
                               "  'interval': 1000"
                               "}");
  cockpit_metrics_send_meta (tc->channel, meta, FALSE);
  json_object_unref (recv_object (tc->transport));

  send_sample (tc,    0, 2, 0.0, 0.0);
  assert_sample (tc, "[[0,0]]");
  send_sample (tc, 1000, 2, 0.0, 0.0);
  assert_sample (tc, "[[]]");

  cockpit_metrics_send_meta (tc->channel, meta, TRUE);
  json_object_unref (recv_object (tc->transport));

  send_sample (tc, 2000, 2, 0.0, 0.0);
  assert_sample (tc, "[[0,0]]");
  send_sample (tc, 3000, 2, 0.0, 0.0);
  assert_sample (tc, "[[]]");

  json_object_unref (meta);
}

static void
test_derive_delta (TestCase *tc,
                   gconstpointer unused)
{
  JsonObject *meta = json_obj ("{ 'metrics': [ { 'name': 'foo',"
                               "                 'derive': 'delta'"
                               "               }"
                               "             ],"
                               "  'interval': 100"
                               "}");
  cockpit_metrics_send_meta (tc->channel, meta, FALSE);
  json_object_unref (recv_object (tc->transport));

  send_sample (tc,    0, 1, 0.0);
  assert_sample (tc, "[[false]]");
  send_sample (tc,  100, 1, 10.0);
  assert_sample (tc, "[[10]]");
  send_sample (tc,  200, 1, 20.0);
  assert_sample (tc, "[[10]]");
  send_sample (tc,  300, 1, 40.0);
  assert_sample (tc, "[[20]]");
  send_sample (tc,  400, 1, 30.0);
  assert_sample (tc, "[[-10]]");
  send_sample (tc,  500, 1, 30.0);
  assert_sample (tc, "[[0]]");
  send_sample (tc,  600, 1, 30.0);
  assert_sample (tc, "[[0]]");
  send_sample (tc,  700, 1, 30.0);
  assert_sample (tc, "[[0]]");

  cockpit_metrics_send_meta (tc->channel, meta, TRUE);
  json_object_unref (recv_object (tc->transport));

  send_sample (tc,  800, 1, 30.0);
  assert_sample (tc, "[[false]]");
  send_sample (tc,  900, 1, 30.0);
  assert_sample (tc, "[[0]]");
  send_sample (tc, 1000, 1, 30.0);
  assert_sample (tc, "[[0]]");
  send_sample (tc, 1100, 1, 40.0);
  assert_sample (tc, "[[10]]");
  send_sample (tc, 1200, 1, 40.0);
  assert_sample (tc, "[[0]]");

  json_object_unref (meta);
}

static void
test_derive_rate_no_interpolate (TestCase *tc,
                                 gconstpointer unused)
{
  cockpit_metrics_set_interpolate (tc->channel, FALSE);

  JsonObject *meta = json_obj ("{ 'metrics': [ { 'name': 'foo',"
                               "                 'derive': 'rate'"
                               "               }"
                               "             ],"
                               "  'interval': 100"
                               "}");
  cockpit_metrics_send_meta (tc->channel, meta, FALSE);
  json_object_unref (recv_object (tc->transport));

  send_sample (tc,    0, 1, 0.0);
  assert_sample (tc, "[[false]]");
  send_sample (tc,  100, 1, 10.0);
  assert_sample (tc, "[[100]]");
  send_sample (tc,  200, 1, 20.0);
  assert_sample (tc, "[[100]]");
  send_sample (tc,  300, 1, 40.0);
  assert_sample (tc, "[[200]]");
  send_sample (tc,  400, 1, 30.0);
  assert_sample (tc, "[[-100]]");
  send_sample (tc,  500, 1, 30.0);
  assert_sample (tc, "[[0]]");
  send_sample (tc,  600, 1, 30.0);
  assert_sample (tc, "[[0]]");
  send_sample (tc,  700, 1, 30.0);
  assert_sample (tc, "[[0]]");

  cockpit_metrics_send_meta (tc->channel, meta, TRUE);
  json_object_unref (recv_object (tc->transport));

  send_sample (tc,  800, 1, 30.0);
  assert_sample (tc, "[[false]]");
  send_sample (tc,  900, 1, 30.0);
  assert_sample (tc, "[[0]]");
  send_sample (tc, 1000, 1, 30.0);
  assert_sample (tc, "[[0]]");
  send_sample (tc, 1200, 1, 40.0);  // double interval -> half rate
  assert_sample (tc, "[[50]]");
  send_sample (tc, 1200, 1, 40.0);
  assert_sample (tc, "[[false]]");  // divide by zero -> NaN -> false
  send_sample (tc, 1300, 1, 40.0);
  assert_sample (tc, "[[0]]");

  json_object_unref (meta);
}

/* Very specific functions to be used by test_interpolate for
   approximate sample assertions.  (The only reason why we don't do
   this for all tests is that it is not fun to generalize this...)
*/

static gboolean
approx_equal (double a, double b)
{
  return a == b || (fabs(a-b)/fmax(a, b) < 0.0001);
}

static void
assert_2_approx_samples_msg (const char *domain,
                             const char *file,
                             int line,
                             const char *func,
                             TestCase *tc,
                             double val1,
                             double val2)
{
  JsonArray *array = recv_array (tc->transport);
  JsonArray *sub_array;

  if (json_array_get_length (array) != 1)
    goto fail;
  sub_array = json_array_get_array_element (array, 0);
  if (json_array_get_length (sub_array) != 2)
    goto fail;
  if (!approx_equal (json_array_get_double_element (sub_array, 0), val1))
    goto fail;
  if (!approx_equal (json_array_get_double_element (sub_array, 1), val2))
    goto fail;

  goto out;

 fail:
  {
    JsonNode *node;
    gchar *escaped;
    gchar *msg;

    node = json_node_new (JSON_NODE_ARRAY);
    json_node_set_array (node, array);
    escaped = cockpit_json_write (node, NULL);
    msg = g_strdup_printf ("%s does not approximately match [[%g,%g]]", escaped, val1, val2);
    g_assertion_message (domain, file, line, func, msg);
    g_free (msg);
    g_free (escaped);
    json_node_free (node);
  }

 out:
  json_array_unref (array);
}

#define assert_2_approx_samples(tc, val1, val2)                              \
  (assert_2_approx_samples_msg (G_LOG_DOMAIN, __FILE__, __LINE__, G_STRFUNC, (tc), (val1), (val2)))

static void
test_interpolate (TestCase *tc,
                  gconstpointer unused)
{
  JsonObject *meta = json_obj ("{ 'metrics': [ { 'name': 'foo'"
                               "               },"
                               "               {"
                               "                 'name': 'bar',"
                               "                 'derive': 'rate'"
                               "               }"
                               "             ],"
                               "  'interval': 100"
                               "}");
  cockpit_metrics_send_meta (tc->channel, meta, FALSE);
  json_object_unref (recv_object (tc->transport));

  // rising by 10 for every 100 ms, with non-equally spaced samples

  send_sample (tc,    0, 2,  0.0,  0.0);
  assert_sample (tc, "[[0,false]]");
  send_sample (tc,  100, 2, 10.0, 10.0);
  assert_2_approx_samples (tc, 10, 100);
  send_sample (tc,  250, 2, 25.0, 25.0);
  assert_2_approx_samples (tc, 20, 100);
  send_sample (tc,  300, 2, 30.0, 30.0);
  assert_2_approx_samples (tc, 30, 100);
  send_sample (tc,  500, 2, 50.0, 50.0);
  assert_2_approx_samples (tc, 40, 100);
  send_sample (tc,  500, 2, 50.0, 50.0);
  assert_2_approx_samples (tc, 50, 100);

  json_object_unref (meta);
}

static void
test_instances (TestCase *tc,
                gconstpointer unused)
{
  JsonObject *meta = json_obj ("{ 'metrics': [ { 'name': 'foo',"
                               "                 'instances': [ 'a', 'b' ]"
                               "               }"
                               "             ],"
                               "  'interval': 1000"
                               "}");
  cockpit_metrics_send_meta (tc->channel, meta, FALSE);
  json_object_unref (recv_object (tc->transport));

  send_instance_sample (tc,    0, 2, 0.0, 0.0);
  assert_sample (tc, "[[[0,0]]]");
  send_instance_sample (tc, 1000, 2, 0.0, 0.0);
  assert_sample (tc, "[[[0,0]]]");
  send_instance_sample (tc, 2000, 2, 0.0, 0.0);
  assert_sample (tc, "[[[0,0]]]");

  send_instance_sample (tc, 3000, 2, 0.0, 1.0);
  assert_sample (tc, "[[[0, 1]]]");

  send_instance_sample (tc, 4000, 2, 1.0, 1.0);
  assert_sample (tc, "[[[1, 1]]]");

  json_object_unref (meta);
}

static void
test_dynamic_instances (TestCase *tc,
                        gconstpointer unused)
{
  JsonObject *meta = json_obj ("{ 'metrics': [ { 'name': 'foo',"
                               "                 'instances': [ 'a' ],"
                               "                 'derive': 'delta'"
                               "               }"
                               "             ],"
                               "  'interval': 100"
                               "}");
  cockpit_metrics_send_meta (tc->channel, meta, FALSE);
  json_object_unref (recv_object (tc->transport));

  send_instance_sample (tc,    0, 1, 0.0);
  assert_sample (tc, "[[[false]]]");
  send_instance_sample (tc,  100, 1, 10.0);
  assert_sample (tc, "[[[10]]]");
  send_instance_sample (tc,  200, 1, 20.0);
  assert_sample (tc, "[[[10]]]");

  json_object_unref (meta);
  meta = json_obj ("{ 'metrics': [ { 'name': 'foo',"
                   "                 'instances': [ 'b', 'a' ],"
                   "                 'derive': 'delta'"
                   "               }"
                   "             ],"
                   "  'interval': 100"
                   "}");
  cockpit_metrics_send_meta (tc->channel, meta, FALSE);
  json_object_unref (recv_object (tc->transport));

  /* Instance 'a' is now at a different index.  The 'delta' derivation
     should continue to work, but no compression should happen.
  */

  send_instance_sample (tc,  300, 2,  0.0, 30.0);
  assert_sample (tc, "[[[false,10]]]");
  send_instance_sample (tc,  400, 2, 10.0, 20.0);
  assert_sample (tc, "[[[10,-10]]]");
  send_instance_sample (tc,  500, 2, 10.0, 40.0);
  assert_sample (tc, "[[[0,20]]]");
  send_instance_sample (tc,  600, 2, 10.0, 50.0);
  assert_sample (tc, "[[[0,10]]]");
  send_instance_sample (tc,  700, 2, 10.0, 60.0);
  assert_sample (tc, "[[[0,10]]]");

  json_object_unref (meta);
}

static void
assert_not_root_mount (JsonArray *array,
                       guint index_,
                       JsonNode *element_node,
                       gpointer user_data)
{
  g_assert_cmpstr (json_node_get_string (element_node), !=, "/");
}

static void
test_omit_instances (void)
{
  MockTransport *transport = mock_transport_new ();
  CockpitChannel *channel;
  JsonObject *options = json_obj ("{ 'metrics': [ { 'name': 'mount.total' } ],"
                                  "  'omit-instances': [ '/' ],"
                                  "  'interval': 1000"
                                  "}");
  GBytes *msg;
  JsonObject *res, *mount_total;
  JsonArray *metrics;

  g_signal_connect (transport, "closed", G_CALLBACK (on_transport_closed), NULL);

  channel = g_object_new (cockpit_internal_metrics_get_type (),
                          "transport", transport,
                          "id", "1234",
                          "options", options,
                          NULL);

  cockpit_channel_prepare (channel);

  /* receive meta information */
  while ((msg = mock_transport_pop_channel (transport, "1234")) == NULL)
    g_main_context_iteration (NULL, TRUE);
  res = cockpit_json_parse_bytes (msg, NULL);
  g_assert (res != NULL);
  g_assert (json_object_has_member (res, "metrics"));

  /* metrics should have the form [{"name":"mount.total","instances":["/boot",...]}] */
  metrics = json_object_get_array_member (res, "metrics");
  g_assert_cmpint (json_array_get_length (metrics), ==, 1);
  mount_total = json_array_get_object_element (metrics, 0);
  g_assert (mount_total);
  g_assert_cmpstr (json_object_get_string_member (mount_total, "name"), ==, "mount.total");

  /* instances should not contain the omitted "/" */
  json_array_foreach_element (json_object_get_array_member (mount_total, "instances"),
                              assert_not_root_mount,
                              NULL);

  json_object_unref (res);
  g_object_unref (channel);
  json_object_unref (options);
  g_object_unref (transport);
}

static void
on_close_get_problem (CockpitChannel *channel,
                      const gchar *problem,
                      gpointer user_data)
{
  gchar **result = user_data;
  g_assert (result != NULL);
  g_assert (*result == NULL);
  *result = g_strdup (problem ? problem : "");
}

static void
test_not_supported (void)
{
  MockTransport *transport;
  CockpitMetrics *channel;
  gchar *problem = NULL;
  JsonObject *options;

  cockpit_expect_message ("*unknown internal metric*");

  transport = mock_transport_new ();
  g_signal_connect (transport, "closed", G_CALLBACK (on_transport_closed), NULL);
  options = json_obj ("{ 'metrics': [ { 'name': 'invalid.metrics',"
                   "                 'instances': [ 'b', 'a' ],"
                   "                 'derive': 'delta'"
                   "               }"
                   "             ],"
                   "  'interval': 100"
                   "}");
  channel = g_object_new (cockpit_internal_metrics_get_type (),
                          "transport", transport,
                          "id", "1234",
                          "options", options,
                          NULL);
  json_object_unref (options);
  g_signal_connect (channel, "closed", G_CALLBACK (on_close_get_problem), &problem);

  while (problem == NULL)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpstr (problem, ==, "not-supported");

  g_object_add_weak_pointer (G_OBJECT (channel), (gpointer *)&channel);
  g_object_unref (channel);
  g_assert (channel == NULL);

  g_object_unref (transport);
  g_free (problem);
}

static void
test_deprecated_net_all (void)
{
  MockTransport *transport = mock_transport_new ();
  CockpitChannel *channel;
  /* network.all.* is not being used any more in current cockpit, but in older
   * Dashboards; ensure it keeps working */
  JsonObject *options = json_obj ("{ 'metrics': [ { 'name': 'network.all.tx' }, { 'name': 'network.all.rx' } ],"
                                  "  'interval': 100"
                                  "}");
  GBytes *msg;
  JsonObject *res, *metric;
  JsonNode *node;
  JsonArray *metrics, *values;

  g_signal_connect (transport, "closed", G_CALLBACK (on_transport_closed), NULL);

  channel = g_object_new (cockpit_internal_metrics_get_type (),
                          "transport", transport,
                          "id", "1234",
                          "options", options,
                          NULL);

  cockpit_metrics_set_compress (COCKPIT_METRICS (channel), FALSE);
  cockpit_channel_prepare (channel);

  /* receive meta information */
  while ((msg = mock_transport_pop_channel (transport, "1234")) == NULL)
    g_main_context_iteration (NULL, TRUE);
  res = cockpit_json_parse_bytes (msg, NULL);
  g_assert (res != NULL);
  g_assert (json_object_has_member (res, "metrics"));

  /* metrics should have the form [{"name":"network.all.tx","units":"bytes","semantics":"counter"}, ...] */
  metrics = json_object_get_array_member (res, "metrics");
  g_assert_cmpint (json_array_get_length (metrics), ==, 2);

  metric = json_array_get_object_element (metrics, 0);
  g_assert (metric);
  g_assert_cmpstr (json_object_get_string_member (metric, "name"), ==, "network.all.tx");
  g_assert_cmpstr (json_object_get_string_member (metric, "units"), ==, "bytes");
  g_assert (!json_object_has_member (metric, "instances"));

  metric = json_array_get_object_element (metrics, 1);
  g_assert (metric);
  g_assert_cmpstr (json_object_get_string_member (metric, "name"), ==, "network.all.rx");
  g_assert_cmpstr (json_object_get_string_member (metric, "units"), ==, "bytes");
  g_assert (!json_object_has_member (metric, "instances"));

  json_object_unref (res);

  /* receive data; should have the form [[123,456]] */
  while ((msg = mock_transport_pop_channel (transport, "1234")) == NULL)
    g_main_context_iteration (NULL, TRUE);
  node = cockpit_json_parse (g_bytes_get_data (msg, NULL), g_bytes_get_size (msg), NULL);
  g_assert (node);
  metrics = json_node_get_array (node);
  g_assert (metrics != NULL);
  g_assert_cmpint (json_array_get_length (metrics), ==, 1);
  values = json_array_get_array_element (metrics, 0);
  g_assert_cmpint (json_array_get_length (values), ==, 2);
  g_assert_cmpint (json_array_get_int_element (values, 0), >=, 0);
  g_assert_cmpint (json_array_get_int_element (values, 1), >=, 0);

  json_node_free (node);

  g_object_unref (channel);
  json_object_unref (options);
  g_object_unref (transport);
}

static void
test_cgroup (void)
{
  MockTransport *transport = mock_transport_new ();
  CockpitChannel *channel;
  JsonObject *options = json_obj ("{ 'metrics': [ { 'name': 'cgroup.memory.usage' }, "
                                  "               { 'name': 'cgroup.memory.limit' }, "
                                  "               { 'name': 'cgroup.memory.sw-usage' }, "
                                  "               { 'name': 'cgroup.memory.sw-limit' }, "
                                  "               { 'name': 'cgroup.cpu.usage' }, "
                                  "               { 'name': 'cgroup.cpu.shares' } ], "
                                  "  'interval': 1000"
                                  "}");
  GBytes *msg;
  JsonObject *res, *description;
  JsonArray *metrics, *instances;
  JsonArray *samples;
  GError *error = NULL;

  g_signal_connect (transport, "closed", G_CALLBACK (on_transport_closed), NULL);

  channel = g_object_new (cockpit_internal_metrics_get_type (),
                          "transport", transport,
                          "id", "1234",
                          "options", options,
                          NULL);

  cockpit_channel_prepare (channel);

  /* receive meta information */
  while ((msg = mock_transport_pop_channel (transport, "1234")) == NULL)
    g_main_context_iteration (NULL, TRUE);
  res = cockpit_json_parse_bytes (msg, &error);
  g_assert_no_error (error);
  g_assert (res != NULL);
  g_assert (json_object_has_member (res, "metrics"));

  /* metrics should have the form [{"name":"...","instances":["name1", ...]}] */
  metrics = json_object_get_array_member (res, "metrics");
  g_assert_cmpint (json_array_get_length (metrics), ==, 6);
  description = json_array_get_object_element (metrics, 0);
  g_assert (description);
  g_assert_cmpstr (json_object_get_string_member (description, "name"), ==, "cgroup.memory.usage");
  g_assert_cmpstr (json_object_get_string_member (description, "units"), ==, "bytes");

  /* we can't assert any contents about instances and samples, as build environments may not even have
   * any cgroup controller; just make sure that the data structure is as expected */
  instances = json_object_get_array_member (description, "instances");
  g_assert_cmpint (json_array_get_length (instances), >=, 0);

  /* next message should have some actual values; looks like [[...],[...],...]]] */
  samples = recv_array (transport);
  g_assert_cmpint (json_array_get_length (samples), ==, 1);
  g_assert_cmpint (json_array_get_length (json_array_get_array_element (samples, 0)), ==, 6);

  json_array_unref (samples);

  json_object_unref (res);
  g_object_unref (channel);
  json_object_unref (options);
  g_object_unref (transport);
}

static void
test_cpu_cores (void)
{
  MockTransport *transport = mock_transport_new ();
  CockpitChannel *channel;

  JsonObject *options = json_obj ("{ 'metrics': [ { 'name': 'cpu.core.nice', 'derive': 'rate' }, "
                                  "               { 'name': 'cpu.core.user', 'derive': 'rate' }, "
                                  "               { 'name': 'cpu.core.system', 'derive': 'rate' }, "
                                  "               { 'name': 'cpu.core.iowait', 'derive': 'rate' } ], "
                                  "  'interval': 1000"
                                  "}");
  GBytes *msg;
  JsonObject *res, *description;
  JsonArray *metrics, *instances, *all, *nice;
  JsonArray *samples;
  GError *error = NULL;

  g_signal_connect (transport, "closed", G_CALLBACK (on_transport_closed), NULL);

  channel = g_object_new (cockpit_internal_metrics_get_type (),
                          "transport", transport,
                          "id", "1234",
                          "options", options,
                          NULL);

  cockpit_channel_prepare (channel);

  /* receive meta information */
  while ((msg = mock_transport_pop_channel (transport, "1234")) == NULL)
    g_main_context_iteration (NULL, TRUE);
  res = cockpit_json_parse_bytes (msg, &error);
  g_assert_no_error (error);
  g_assert (res != NULL);
  g_assert (json_object_has_member (res, "metrics"));

  /* metrics should have the form [{"name":"...","instances":[[1, 0, ...], ...]}] */
  metrics = json_object_get_array_member (res, "metrics");
  g_assert_cmpint (json_array_get_length (metrics), ==, 4);
  description = json_array_get_object_element (metrics, 0);
  g_assert (description);
  g_assert_cmpstr (json_object_get_string_member (description, "name"), ==, "cpu.core.nice");
  g_assert_cmpstr (json_object_get_string_member (description, "units"), ==, "millisec");

  /* Array contains value for each core */
  instances = json_object_get_array_member (description, "instances");
  g_assert_cmpint (json_array_get_length (instances), ==, sysconf(_SC_NPROCESSORS_ONLN));

  /* Value of each core is somewhere between 0 and 1000 */
  samples = recv_array (transport);
  g_assert_cmpint (json_array_get_length (samples), ==, 1);
  all = json_array_get_array_element (samples, 0);
  g_assert_cmpint (json_array_get_length (all), ==, 4);
  nice = json_array_get_array_element (all, 0);
  g_assert_cmpint (json_array_get_length (nice), ==, sysconf(_SC_NPROCESSORS_ONLN));
  g_assert_cmpint (json_array_get_int_element (nice, 0), >=, 0);
  g_assert_cmpint (json_array_get_int_element (nice, 0), <=, 1000);

  json_array_unref (samples);

  json_object_unref (res);
  g_object_unref (channel);
  json_object_unref (options);
  g_object_unref (transport);
}

static void
test_cpu_temperature (void)
{
  MockTransport *transport = mock_transport_new ();

  g_signal_connect (transport, "closed", G_CALLBACK (on_transport_closed), NULL);

  g_autoptr(JsonObject) options = json_obj ("{ 'metrics': [ { 'name': 'cpu.temperature' } ],"
                                  "  'interval': 1000"
                                  "}");

  CockpitChannel *channel = g_object_new (cockpit_internal_metrics_get_type (),
                          "transport", transport,
                          "id", "1234",
                          "options", options,
                          NULL);

  cockpit_channel_prepare (channel);

  g_autoptr(GBytes) msg = NULL;
  /* receive meta information */
  while ((msg = mock_transport_pop_channel (transport, "1234")) == NULL)
    g_main_context_iteration (NULL, TRUE);

  g_autoptr(GError) error = NULL;
  g_autoptr(JsonObject) res = cockpit_json_parse_bytes (msg, &error);
  g_assert_no_error (error);
  g_assert (res != NULL);
  g_assert (json_object_has_member (res, "metrics"));

  JsonArray *metrics = json_object_get_array_member (res, "metrics");
  g_assert_cmpint (json_array_get_length (metrics), ==, 1);

  JsonObject *description = json_array_get_object_element (metrics, 0);
  g_assert (description);
  g_assert_cmpstr (json_object_get_string_member (description, "name"), ==, "cpu.temperature");
  g_assert_cmpstr (json_object_get_string_member (description, "units"), ==, "celsius");

  g_autoptr(JsonArray) samples = recv_array (transport);
  g_assert_cmpint (json_array_get_length (samples), ==, 1);
  JsonArray *core = json_array_get_array_element (samples, 0);
  g_assert_cmpint (json_array_get_length (core), ==, 1);
  JsonArray *temperature = json_array_get_array_element (core, 0);

  // file does not exist in virtual machines, skip value check
  if (json_array_get_length (temperature) >= 1)
    {
      g_assert_cmpint (json_array_get_int_element (temperature, 0), >, 0);
      g_assert_cmpint (json_array_get_int_element (temperature, 0), <, 150);
    }
}

static void
test_cgroup_disk_io (void)
{
  MockTransport *transport = mock_transport_new ();

  g_signal_connect (transport, "closed", G_CALLBACK (on_transport_closed), NULL);

  g_autoptr(JsonObject) options = json_obj ("{ 'metrics': [ { 'name': 'disk.cgroup.read' }, { 'name': 'disk.cgroup.written' } ],"
                                  "  'interval': 1000"
                                  "}");

  CockpitChannel *channel = g_object_new (cockpit_internal_metrics_get_type (),
                          "transport", transport,
                          "id", "1234",
                          "options", options,
                          NULL);

  cockpit_channel_prepare (channel);

  g_autoptr(GBytes) msg = NULL;
  /* receive meta information */
  while ((msg = mock_transport_pop_channel (transport, "1234")) == NULL)
    g_main_context_iteration (NULL, TRUE);

  g_autoptr(GError) error = NULL;
  g_autoptr(JsonObject) res = cockpit_json_parse_bytes (msg, &error);
  g_assert_no_error (error);
  g_assert (res != NULL);
  g_assert (json_object_has_member (res, "metrics"));

  JsonArray *metrics = json_object_get_array_member (res, "metrics");
  g_assert_cmpint (json_array_get_length (metrics), ==, 2);

  JsonObject *description = json_array_get_object_element (metrics, 0);
  g_assert (description);
  g_assert_cmpstr (json_object_get_string_member (description, "name"), ==, "disk.cgroup.read");
  g_assert_cmpstr (json_object_get_string_member (description, "units"), ==, "bytes");

  description = json_array_get_object_element (metrics, 1);
  g_assert (description);
  g_assert_cmpstr (json_object_get_string_member (description, "name"), ==, "disk.cgroup.written");
  g_assert_cmpstr (json_object_get_string_member (description, "units"), ==, "bytes");

  g_autoptr(JsonArray) samples = recv_array (transport);
  g_assert_cmpint (json_array_get_length (samples), ==, 1);
  JsonArray *core = json_array_get_array_element (samples, 0);
  g_assert_cmpint (json_array_get_length (core), ==, 2);
  JsonArray *read = json_array_get_array_element (core, 0);
  JsonArray *write = json_array_get_array_element (core, 1);
  guint length = json_array_get_length (read);
  g_assert_cmpint (length, ==, json_array_get_length (write));
  g_assert_cmpint (length, >, 0);
  for (guint i = 0; i < length; i++)
    {
      g_assert_cmpint (json_array_get_int_element (read, i), >=, 0);
      g_assert_cmpint (json_array_get_int_element (write, i), >=, 0);
    }
}

int
main (int argc,
      char *argv[])
{
  cockpit_test_init (&argc, &argv);

  g_test_add ("/metrics/compression", TestCase, NULL,
              setup, test_compression, teardown);
  g_test_add ("/metrics/compression-reset", TestCase, NULL,
              setup, test_compression_reset, teardown);
  g_test_add ("/metrics/derive-delta", TestCase, NULL,
              setup, test_derive_delta, teardown);
  g_test_add ("/metrics/derive-rate", TestCase, NULL,
              setup, test_derive_rate_no_interpolate, teardown);
  g_test_add ("/metrics/interpolate", TestCase, NULL,
              setup, test_interpolate, teardown);

  g_test_add ("/metrics/instances", TestCase, NULL,
              setup, test_instances, teardown);
  g_test_add ("/metrics/dynamic-instances", TestCase, NULL,
              setup, test_dynamic_instances, teardown);
  g_test_add_func ("/metrics/omit-instances", test_omit_instances);

  g_test_add_func ("/metrics/not-supported", test_not_supported);

  g_test_add_func ("/metrics/deprecated-net-all", test_deprecated_net_all);
  g_test_add_func ("/metrics/cgroup-memory", test_cgroup);

  g_test_add_func ("/metrics/cpu-cores", test_cpu_cores);
  g_test_add_func ("/metrics/cpu-temperature", test_cpu_temperature);

  g_test_add_func ("/metrics/cgroup-disk-io", test_cgroup_disk_io);

  return g_test_run ();
}
