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
#include "cockpitpcpmetrics.h"

#include "testlib/cockpittest.h"
#include "common/cockpitjson.h"
#include "testlib/mock-transport.h"

#include <string.h>
#include <stdio.h>
#include <errno.h>
#include <time.h>
#include <sys/stat.h>

#include <pcp/pmapi.h>
#include <pcp/impl.h>
#include <pcp/import.h>

static void
init_mock_archives (void)
{
  g_assert (system ("rm -rf mock-archives && mkdir mock-archives") == 0);

  g_assert (pmiStart ("mock-archives/0", 0) >= 0);
  g_assert (pmiAddMetric ("mock.value", PM_ID_NULL,
                          PM_TYPE_U32, PM_INDOM_NULL, PM_SEM_INSTANT,
                          pmiUnits (0, 0, 0, 0, 0, 0)) >= 0);
  g_assert (pmiPutValue ("mock.value", NULL, "10") >= 0);
  g_assert (pmiWrite (0, 0) >= 0);
  g_assert (pmiPutValue ("mock.value", NULL, "11") >= 0);
  g_assert (pmiWrite (1, 0) >= 0);
  g_assert (pmiPutValue ("mock.value", NULL, "12") >= 0);
  g_assert (pmiWrite (2, 0) >= 0);
  g_assert (pmiEnd () >= 0);

  g_assert (pmiStart ("mock-archives/1", 0) >= 0);
  g_assert (pmiAddMetric ("mock.value", PM_ID_NULL,
                          PM_TYPE_U32, PM_INDOM_NULL, PM_SEM_INSTANT,
                          pmiUnits (0, 0, 0, 0, 0, 0)) >= 0);
  g_assert (pmiAddMetric ("mock.late", PM_ID_NULL,
                          PM_TYPE_U32, PM_INDOM_NULL, PM_SEM_INSTANT,
                          pmiUnits (0, 0, 0, 0, 0, 0)) >= 0);
  g_assert (pmiPutValue ("mock.value", NULL, "13") >= 0);
  g_assert (pmiPutValue ("mock.late", NULL, "30") >= 0);
  g_assert (pmiWrite (3, 0) >= 0);
  g_assert (pmiPutValue ("mock.value", NULL, "14") >= 0);
  g_assert (pmiPutValue ("mock.late", NULL, "31") >= 0);
  g_assert (pmiWrite (4, 0) >= 0);
  g_assert (pmiPutValue ("mock.value", NULL, "15") >= 0);
  g_assert (pmiPutValue ("mock.late", NULL, "32") >= 0);
  g_assert (pmiWrite (5, 0) >= 0);
  g_assert (pmiEnd () >= 0);

  // Broken archives should be skipped with a warning
  g_assert (g_file_set_contents ("mock-archives/2.index", "not a pcp index file", -1, NULL));
  g_assert (g_file_set_contents ("mock-archives/2.meta", "not a pcp meta file", -1, NULL));
  g_assert (g_file_set_contents ("mock-archives/2.0", "not a pcp sample file", -1, NULL));
}

static void
expect_broken_archive_warning (void)
{
  cockpit_expect_warning("*couldn't create pcp archive context for /*/mock-archives/2*");
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
  tc->channel = g_object_new (COCKPIT_TYPE_PCP_METRICS,
                              "transport", tc->transport,
                              "id", "1234",
                              "options", options,
                              NULL);
  tc->channel_closed = FALSE;
  g_signal_connect (tc->channel, "closed", G_CALLBACK (on_channel_close), tc);
  cockpit_channel_prepare (tc->channel);

  /* Switch off compression by default.  Compression is done by
   * comparing two floating point values for exact equality, and we
   * can't guarantee that we get the same behavior everywhere.
   */
  cockpit_metrics_set_compress (COCKPIT_METRICS (tc->channel), FALSE);
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
  GError *error = NULL;
  JsonObject *res = cockpit_json_parse_object (str, -1, &error);
  g_assert_no_error (error);
  return res;
}

static void
assert_sample_msg (const char *domain,
                   const char *file,
                   int line,
                   const char *func,
                   TestCase *tc,
                   const gchar *json_str)
{
  JsonNode *node = recv_json (tc);
  g_assert_cmpint (json_node_get_node_type (node), ==, JSON_NODE_ARRAY);
  _cockpit_assert_json_eq_msg (domain, file, line, func, json_node_get_array (node), json_str);
}

#define assert_sample(tc, json) \
  (assert_sample_msg (G_LOG_DOMAIN, __FILE__, __LINE__, G_STRFUNC, (tc), (json)))

static void
test_metrics_single_archive (TestCase *tc,
                             gconstpointer unused)
{
  JsonObject *options = json_obj("{ \"source\": \"" BUILDDIR "/mock-archives/0\","
                                 "  \"metrics\": [ { \"name\": \"mock.value\" } ],"
                                 "  \"interval\": 1000"
                                 "}");

  setup_metrics_channel_json (tc, options);

  JsonObject *meta = recv_json_object (tc);
  cockpit_assert_json_eq (json_object_get_array_member (meta, "metrics"),
                          "[ { \"name\": \"mock.value\", \"units\": \"\", \"semantics\": \"instant\" } ]");

  assert_sample (tc, "[[10],[11],[12]]");

  json_object_unref (options);
}

static void
test_metrics_archive_limit (TestCase *tc,
                            gconstpointer unused)
{
  JsonObject *options = json_obj("{ \"source\": \"" BUILDDIR "/mock-archives/0\","
                                 "  \"metrics\": [ { \"name\": \"mock.value\" } ],"
                                 "  \"interval\": 1000,"
                                 "  \"limit\": 2"
                                 "}");

  setup_metrics_channel_json (tc, options);

  JsonObject *meta = recv_json_object (tc);
  cockpit_assert_json_eq (json_object_get_array_member (meta, "metrics"),
                          "[ { \"name\": \"mock.value\", \"units\": \"\", \"semantics\": \"instant\" } ]");

  assert_sample (tc, "[[10],[11]]");

  json_object_unref (options);
}

static void
test_metrics_archive_timestamp (TestCase *tc,
                                gconstpointer unused)
{
  JsonObject *options = json_obj("{ \"source\": \"" BUILDDIR "/mock-archives/0\","
                                 "  \"metrics\": [ { \"name\": \"mock.value\" } ],"
                                 "  \"interval\": 1000,"
                                 "  \"timestamp\": 1000"
                                 "}");

  setup_metrics_channel_json (tc, options);

  JsonObject *meta = recv_json_object (tc);
  cockpit_assert_json_eq (json_object_get_array_member (meta, "metrics"),
                          "[ { \"name\": \"mock.value\", \"units\": \"\", \"semantics\": \"instant\" } ]");

  assert_sample (tc, "[[11],[12]]");

  json_object_unref (options);
}

static void
test_metrics_archive_timestamp_now (TestCase *tc,
                                gconstpointer unused)
{
  time_t now = time (NULL);

  g_assert (pmiStart ("mock-archives/3", 0) >= 0);
  g_assert (pmiAddMetric ("mock.now", PM_ID_NULL,
                          PM_TYPE_U32, PM_INDOM_NULL, PM_SEM_INSTANT,
                          pmiUnits (0, 0, 0, 0, 0, 0)) >= 0);
  /* one second in the past to one second in the future */
  g_assert (pmiPutValue ("mock.now", NULL, "41") >= 0);
  g_assert (pmiWrite (now - 1, 0) >= 0);
  g_assert (pmiPutValue ("mock.now", NULL, "42") >= 0);
  g_assert (pmiWrite (now, 0) >= 0);
  g_assert (pmiPutValue ("mock.now", NULL, "43") >= 0);
  g_assert (pmiWrite (now + 1, 0) >= 0);

  g_autofree gchar* json = g_strdup_printf("{ \"source\": \"" BUILDDIR "/mock-archives/3\","
                                           "  \"metrics\": [ { \"name\": \"mock.now\" } ],"
                                           "  \"interval\": 1000,"
                                           "  \"timestamp\": %lli000"
                                           "}", (long long) now);
  JsonObject *options = json_obj(json);

  setup_metrics_channel_json (tc, options);

  JsonObject *meta = recv_json_object (tc);
  cockpit_assert_json_eq (json_object_get_array_member (meta, "metrics"),
                          "[ { \"name\": \"mock.now\", \"units\": \"\", \"semantics\": \"instant\" } ]");

  assert_sample (tc, "[[42],[43]]");

  json_object_unref (options);
}


static void
test_metrics_archive_directory (TestCase *tc,
                                gconstpointer unused)
{
  expect_broken_archive_warning();

  JsonObject *meta;
  JsonObject *options = json_obj("{ \"source\": \"" BUILDDIR "/mock-archives\","
                                 "  \"metrics\": [ { \"name\": \"mock.value\" } ],"
                                 "  \"interval\": 1000"
                                 "}");
  setup_metrics_channel_json (tc, options);

  meta = recv_json_object (tc);
  cockpit_assert_json_eq (json_object_get_array_member (meta, "metrics"),
                          "[ { \"name\": \"mock.value\", \"units\": \"\", \"semantics\": \"instant\" } ]");
  assert_sample (tc, "[[10],[11],[12]]");

  meta = recv_json_object (tc);
  cockpit_assert_json_eq (json_object_get_array_member (meta, "metrics"),
                          "[ { \"name\": \"mock.value\", \"units\": \"\", \"semantics\": \"instant\" } ]");
  assert_sample (tc, "[[13],[14],[15]]");

  json_object_unref (options);
}

static void
test_metrics_archive_directory_timestamp (TestCase *tc,
                                          gconstpointer unused)
{
  expect_broken_archive_warning();

  JsonObject *meta;
  JsonObject *options = json_obj("{ \"source\": \"" BUILDDIR "/mock-archives\","
                                 "  \"metrics\": [ { \"name\": \"mock.value\" } ],"
                                 "  \"interval\": 1000,"
                                 "  \"timestamp\": 4000"
                                 "}");

  setup_metrics_channel_json (tc, options);

  meta = recv_json_object (tc);
  cockpit_assert_json_eq (json_object_get_array_member (meta, "metrics"),
                          "[ { \"name\": \"mock.value\", \"units\": \"\", \"semantics\": \"instant\" } ]");
  assert_sample (tc, "[[14],[15]]");

  json_object_unref (options);
}

static void
test_metrics_archive_directory_late_metric (TestCase *tc,
                                            gconstpointer unused)
{
  expect_broken_archive_warning();
  cockpit_expect_message ("*no such metric: mock.late: Unknown metric name*");

  JsonObject *meta;
  JsonObject *options = json_obj("{ \"source\": \"" BUILDDIR "/mock-archives\","
                                 "  \"metrics\": [ { \"name\": \"mock.late\" } ],"
                                 "  \"interval\": 1000"
                                 "}");

  setup_metrics_channel_json (tc, options);

  meta = recv_json_object (tc);
  cockpit_assert_json_eq (json_object_get_array_member (meta, "metrics"),
                          "[ { \"name\": \"mock.late\", \"units\": \"\", \"semantics\": \"instant\" } ]");
  assert_sample (tc, "[[30],[31],[32]]");

  json_object_unref (options);
}

int
main (int argc,
      char *argv[])
{
  cockpit_test_init (&argc, &argv);

  if (chdir (BUILDDIR) < 0)
    g_assert_not_reached ();

  init_mock_archives ();

  g_test_add ("/metrics/single-archive", TestCase, NULL,
              setup, test_metrics_single_archive, teardown);
  g_test_add ("/metrics/archive-limit", TestCase, NULL,
              setup, test_metrics_archive_limit, teardown);
  g_test_add ("/metrics/archive-timestamp", TestCase, NULL,
              setup, test_metrics_archive_timestamp, teardown);
  g_test_add ("/metrics/archive-timestamp-now", TestCase, NULL,
              setup, test_metrics_archive_timestamp_now, teardown);
  g_test_add ("/metrics/archive-directory", TestCase, NULL,
              setup, test_metrics_archive_directory, teardown);
  g_test_add ("/metrics/archive-directory-timestamp", TestCase, NULL,
              setup, test_metrics_archive_directory_timestamp, teardown);
  g_test_add ("/metrics/archive-directory-late-metric", TestCase, NULL,
              setup, test_metrics_archive_directory_late_metric, teardown);

  return g_test_run ();
}
