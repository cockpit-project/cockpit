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

static void
test_compression (TestCase *tc,
                  gconstpointer unused)
{
  JsonArray *zero = json_array_new ();
  JsonArray *sample = json_array_new ();
  json_array_add_int_element (sample, 0);
  json_array_add_array_element (zero, sample);

  cockpit_metrics_send_data (tc->channel, zero);
  assert_sample (tc, "[[0]]");
  cockpit_metrics_send_data (tc->channel, zero);
  assert_sample (tc, "[[]]");
  cockpit_metrics_send_data (tc->channel, zero);
  assert_sample (tc, "[[]]");

  JsonArray *zero_one = json_array_new ();
  sample = json_array_new ();
  json_array_add_int_element (sample, 0);
  json_array_add_int_element (sample, 1);
  json_array_add_array_element (zero_one, sample);

  cockpit_metrics_send_data (tc->channel, zero_one);
  assert_sample (tc, "[[null, 1]]");
  cockpit_metrics_send_data (tc->channel, zero_one);
  assert_sample (tc, "[[]]");

  JsonArray *zero_two = json_array_new ();
  sample = json_array_new ();
  json_array_add_int_element (sample, 0);
  json_array_add_int_element (sample, 2);
  json_array_add_array_element (zero_two, sample);

  cockpit_metrics_send_data (tc->channel, zero_two);
  assert_sample (tc, "[[null, 2]]");
  cockpit_metrics_send_data (tc->channel, zero_two);
  assert_sample (tc, "[[]]");

  JsonArray *string = json_array_new ();
  sample = json_array_new ();
  json_array_add_string_element (sample, "blah");
  json_array_add_array_element (string, sample);

  cockpit_metrics_send_data (tc->channel, string);
  assert_sample (tc, "[[\"blah\"]]");
  cockpit_metrics_send_data (tc->channel, string);
  assert_sample (tc, "[[]]");

  cockpit_metrics_send_data (tc->channel, zero_one);
  assert_sample (tc, "[[0, 1]]");
  cockpit_metrics_send_data (tc->channel, zero_one);
  assert_sample (tc, "[[]]");

  cockpit_metrics_send_data (tc->channel, zero);
  assert_sample (tc, "[[null]]");
  cockpit_metrics_send_data (tc->channel, zero);
  assert_sample (tc, "[[]]");

  json_array_unref (zero);
  json_array_unref (zero_one);
  json_array_unref (zero_two);
  json_array_unref (string);
}

static void
test_compression_reset (TestCase *tc,
                        gconstpointer unused)
{
  JsonArray *zero = json_array_new ();
  JsonArray *sample = json_array_new ();
  json_array_add_int_element (sample, 0);
  json_array_add_array_element (zero, sample);

  cockpit_metrics_send_data (tc->channel, zero);
  assert_sample (tc, "[[0]]");
  cockpit_metrics_send_data (tc->channel, zero);
  assert_sample (tc, "[[]]");

  JsonObject *meta = json_object_new ();
  cockpit_metrics_send_meta (tc->channel, meta);
  json_object_unref (recv_object (tc));

  cockpit_metrics_send_data (tc->channel, zero);
  assert_sample (tc, "[[0]]");
  cockpit_metrics_send_data (tc->channel, zero);
  assert_sample (tc, "[[]]");

  json_array_unref (zero);
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

  return g_test_run ();
}
