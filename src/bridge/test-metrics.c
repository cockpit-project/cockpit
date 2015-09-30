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
#include <math.h>

#include "cockpitmetrics.h"
#include "mock-transport.h"

#include "common/cockpittest.h"
#include "common/cockpitjson.h"

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
recv_bytes (TestCase *tc)
{
  GBytes *msg;
  while ((msg = mock_transport_pop_channel (tc->transport, "1234")) == NULL)
    g_main_context_iteration (NULL, TRUE);
  return msg;
}

static JsonObject *
recv_object (TestCase *tc)
{
  GBytes *msg = recv_bytes (tc);
  JsonObject *res = cockpit_json_parse_bytes (msg, NULL);
  g_assert (res != NULL);
  return res;
}

static JsonArray *
recv_array (TestCase *tc)
{
  GBytes *msg;
  GError *error = NULL;
  JsonArray *array;
  JsonNode *node;

  msg = recv_bytes (tc);
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
  JsonArray *array = recv_array (tc);
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
  json_object_unref (recv_object (tc));

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
  json_object_unref (recv_object (tc));

  send_sample (tc,    0, 2, 0.0, 0.0);
  assert_sample (tc, "[[0,0]]");
  send_sample (tc, 1000, 2, 0.0, 0.0);
  assert_sample (tc, "[[]]");

  cockpit_metrics_send_meta (tc->channel, meta, TRUE);
  json_object_unref (recv_object (tc));

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
  json_object_unref (recv_object (tc));

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
  json_object_unref (recv_object (tc));

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
  json_object_unref (recv_object (tc));

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
  json_object_unref (recv_object (tc));

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
  JsonArray *array = recv_array (tc);
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
  json_object_unref (recv_object (tc));

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
  json_object_unref (recv_object (tc));

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
  json_object_unref (recv_object (tc));

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
  json_object_unref (recv_object (tc));

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

  return g_test_run ();
}
