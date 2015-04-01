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

#include "cgroupmonitor.h"

#include "common/cockpittest.h"

#include <glib/gstdio.h>

/* -----------------------------------------------------------------------------
 * Mock
 */

static GType mock_ticker_get_type (void) G_GNUC_CONST;

typedef struct {
  GObject parent;
  guint tick_id;
  guint64 last_tick;
} MockTicker;

typedef GObjectClass MockTickerClass;

G_DEFINE_TYPE (MockTicker, mock_ticker, G_TYPE_OBJECT);

static guint signal_tick;

static void
mock_ticker_init (MockTicker *self)
{

}

static void
mock_ticker_finalize (GObject *object)
{
  MockTicker *self = (MockTicker *)object;
  g_source_remove (self->tick_id);
  G_OBJECT_CLASS (mock_ticker_parent_class)->finalize (object);
}

static void
mock_ticker_class_init (MockTickerClass *klass)
{
  GObjectClass *object_class = G_OBJECT_CLASS (klass);
  object_class->finalize = mock_ticker_finalize;
  signal_tick = g_signal_new ("tick",
                              G_OBJECT_CLASS_TYPE (klass),
                              G_SIGNAL_RUN_LAST, 0, NULL, NULL,
                              g_cclosure_marshal_generic,
                              G_TYPE_NONE, 1, G_TYPE_UINT64);
}

static gboolean
on_timeout_emit_tick (gpointer user_data)
{
  MockTicker *self = user_data;
  guint64 delta_usec = 0;
  gint64 now = g_get_monotonic_time ();
  if (self->last_tick != 0)
    delta_usec = now - self->last_tick;
  self->last_tick = now;
  g_signal_emit (self, signal_tick, 0, delta_usec);
  return TRUE; /* keep source around */
}

static MockTicker *
mock_ticker_new (gint frequency_ms)
{
  MockTicker *ticker = g_object_new (mock_ticker_get_type (), NULL);
  ticker->tick_id = g_timeout_add (frequency_ms, on_timeout_emit_tick, ticker);
  return ticker;
}

/* -----------------------------------------------------------------------------
 * Test
 */

typedef struct {
  MockTicker *ticker;
  GDBusConnection *connection;
  GDBusObjectManagerServer *object_manager;
  CockpitMultiResourceMonitor *impl;
  CockpitMultiResourceMonitor *proxy;
  GTestDBus *bus;
  gchar *testdir;
  gchar *cpudir;
  gchar *memdir;

  gint64 timestamp_received;
  GQueue *samples_received;
} TestCase;

typedef struct {
  struct {
    const gchar *filename;
    double value;
  } data[16];
} TestFixture;

static void
on_ready_get_result (GObject *source_object,
                     GAsyncResult *result,
                     gpointer user_data)
{
  GAsyncResult **ret = user_data;
  g_assert (ret && !*ret);
  *ret = g_object_ref (result);
}

static void
set_file_contents (const gchar *directory,
                   const gchar *file,
                   const gchar *contents)
{
  GError *error = NULL;
  gchar *path = g_build_filename (directory, file, NULL);
  g_file_set_contents (path, contents, -1, &error);
  g_assert_no_error (error);
  g_free (path);
}

static void
write_cgroup_file (const gchar *directory,
                   const gchar *filename,
                   double value)
{
  gchar *contents;
  contents = g_strdup_printf ("%lf", value);
  set_file_contents (directory, filename, contents);
  g_free (contents);
}

static void
on_new_sample_stash (CockpitMultiResourceMonitor *monitor,
                     gint64 timestamp,
                     GVariant *data,
                     gpointer user_data)
{
  TestCase *tc = user_data;
  tc->timestamp_received = timestamp;
  g_queue_push_tail (tc->samples_received, g_variant_ref (data));
}

static void
setup (TestCase *tc,
       gconstpointer data)
{
  CockpitObjectSkeleton *object = NULL;
  const TestFixture *fixture = data;
  GDBusConnection *connection;
  GError *error = NULL;
  GAsyncResult *result = NULL;
  gint i;

  tc->bus = g_test_dbus_new (G_TEST_DBUS_NONE);
  g_test_dbus_up (tc->bus);

  tc->object_manager = g_dbus_object_manager_server_new ("/test");

  tc->testdir = g_strdup ("/tmp/cockpit-test-XXXXXX");
  g_assert (g_mkdtemp (tc->testdir) != NULL);

  tc->memdir = g_build_filename (tc->testdir, "memory", NULL);
  g_assert_cmpint (g_mkdir (tc->memdir, 0700), ==, 0);
  tc->cpudir = g_build_filename (tc->testdir, "cpuacct", NULL);
  g_assert_cmpint (g_mkdir (tc->cpudir, 0700), ==, 0);

  for (i = 0; fixture && i < G_N_ELEMENTS (fixture->data); i++)
    {
      const gchar *filename = fixture->data[i].filename;
      if (filename == NULL)
        break;
      if (g_str_has_prefix (filename, "memory"))
        write_cgroup_file (tc->memdir, filename, fixture->data[i].value);
      else if (g_str_has_prefix (filename, "cpu"))
        write_cgroup_file (tc->cpudir, filename, fixture->data[i].value);
      else
        g_assert_not_reached ();
    }

  tc->ticker = mock_ticker_new (10);
  tc->impl = g_object_new (TYPE_CGROUP_MONITOR,
                           "base-directory", tc->testdir,
                           "tick-source", tc->ticker,
                           NULL);
  object = cockpit_object_skeleton_new ("/test/monitor");
  cockpit_object_skeleton_set_multi_resource_monitor (object, tc->impl);
  g_dbus_object_manager_server_export (tc->object_manager, G_DBUS_OBJECT_SKELETON (object));
  g_object_unref (object);

  connection = g_bus_get_sync (G_BUS_TYPE_SESSION, NULL, &error);
  g_assert_no_error (error);
  g_dbus_object_manager_server_set_connection (tc->object_manager, connection);

  cockpit_multi_resource_monitor_proxy_new (connection, G_DBUS_PROXY_FLAGS_DO_NOT_AUTO_START,
                                            g_dbus_connection_get_unique_name (connection),
                                            "/test/monitor", NULL, on_ready_get_result, &result);
  while (result == NULL)
    g_main_context_iteration (NULL, TRUE);
  tc->proxy = cockpit_multi_resource_monitor_proxy_new_finish (result, &error);
  g_assert_no_error (error);
  g_object_unref (result);

  g_assert_no_error (error);
  g_object_unref (connection);

  g_signal_connect (tc->proxy, "new-sample", G_CALLBACK (on_new_sample_stash), tc);
  tc->samples_received = g_queue_new ();

  /* Update the CPU usage again since we're looking for a difference */
  write_cgroup_file (tc->cpudir, "cpuacct.usage", 10000000.0);

  /* Wait for all updates to arrive asynchronously */
  while (g_main_context_iteration (NULL, FALSE));
}

static void
teardown (TestCase *tc,
          gconstpointer data)
{
  gchar *cmd;


  /* Aha, acheivement unlocked: I finally found a use for system() */
  g_assert_cmpstr (strstr (tc->testdir, "/tmp"), ==, tc->testdir);
  g_assert_cmpint (system (cmd = g_strdup_printf ("rm -r '%s'", tc->testdir)), ==, 0);
  g_free (tc->testdir);
  g_free (tc->memdir);
  g_free (tc->cpudir);
  g_free (cmd);

  g_object_unref (tc->ticker);
  g_object_unref (tc->object_manager);
  g_object_unref (tc->proxy);

  g_object_add_weak_pointer (G_OBJECT (tc->impl), (gpointer *)&tc->impl);
  g_object_unref (tc->impl);
  g_assert (tc->impl == NULL);

  g_test_dbus_down (tc->bus);
  g_object_add_weak_pointer (G_OBJECT (tc->bus), (gpointer *)&tc->bus);
  g_object_unref (tc->bus);
  g_assert (tc->bus == NULL);

  g_queue_free_full (tc->samples_received, (GDestroyNotify)g_variant_unref);

  /* Wait for all updates to arrive asynchronously */
  while (g_main_context_iteration (NULL, FALSE));
}

static void
test_new (void)
{
  CockpitMultiResourceMonitor *monitor;
  MockTicker *ticker = mock_ticker_new (10);
  monitor = cgroup_monitor_new (G_OBJECT (ticker));
  g_object_unref (ticker);
  g_assert (COCKPIT_IS_MULTI_RESOURCE_MONITOR (monitor));

  g_object_add_weak_pointer (G_OBJECT (monitor), (gpointer *)&monitor);
  g_object_unref (monitor);
  g_assert (monitor == NULL);
}

static const TestFixture fixture_samples = {
  .data = {
    { "memory.usage_in_bytes", 4042923.0 },
    { "memory.limit_in_bytes", 104042923.0 },
    { "cpuacct.usage", 1000.0 },
    { "cpu.shares", 999 },
  }
};

static void
test_get_samples (TestCase *tc,
              gconstpointer unused)
{
  GAsyncResult *result = NULL;
  GError *error = NULL;
  GVariant *samples;
  GVariant *values;
  GVariant *child;
  double value;
  gint64 timestamp;
  GVariant *options;
  gchar *str;

  while (tc->timestamp_received == 0)
    g_main_context_iteration (NULL, TRUE);

  options = g_variant_new_array (G_VARIANT_TYPE ("{sv}"), NULL, 0);
  cockpit_multi_resource_monitor_call_get_samples (tc->proxy, options, NULL, on_ready_get_result, &result);
  while (result == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_multi_resource_monitor_call_get_samples_finish (tc->proxy, &samples, result, &error);
  g_object_unref (result);
  g_assert_no_error (error);

  str = g_variant_print (samples, TRUE);
  g_info ("GetSamples(): %s\n", str);
  g_free (str);

  /* Parse timestamp and child out */
  g_variant_get_child (samples, 0, "(x@a{sad})", &timestamp, &child);
  g_assert (timestamp != 0);

  values = g_variant_lookup_value (child, "", G_VARIANT_TYPE ("ad"));

  /* Memory usage */
  g_variant_get_child (values, 0, "d", &value);
  g_assert_cmpfloat (value, ==, 4042923.0);
  g_variant_get_child (values, 1, "d", &value);
  g_assert_cmpfloat (value, ==, 104042923.0);
  g_variant_get_child (values, 2, "d", &value);
  g_assert_cmpfloat (value, ==, -1.0);
  g_variant_get_child (values, 3, "d", &value);
  g_assert_cmpfloat (value, ==, -1.0);
  g_variant_get_child (values, 4, "d", &value);
  /* TODO: Cannot reliably predict the CPU value */

  /* number of shares */
  g_variant_get_child (values, 5, "d", &value);
  g_assert_cmpfloat (value, ==, 999.0);

  g_variant_unref (values);

  g_variant_unref (child);
  g_variant_unref (samples);
}

static void
test_new_samples (TestCase *tc,
                  gconstpointer unused)
{
  GVariant *sample;
  GVariant *values;
  double value;
  gchar *str;

  while (tc->timestamp_received == 0)
    g_main_context_iteration (NULL, TRUE);

  sample = g_queue_pop_head (tc->samples_received);

  str = g_variant_print (sample, TRUE);
  g_info ("NewSample(): %s\n", str);
  g_free (str);

  /* Variant for the first consumer: "" */
  values = g_variant_lookup_value (sample, "", G_VARIANT_TYPE ("ad"));
  g_assert (values != NULL);

  /* Memory usage */
  g_variant_get_child (values, 0, "d", &value);
  g_assert_cmpfloat (value, ==, 4042923.0);
  g_variant_get_child (values, 1, "d", &value);
  g_assert_cmpfloat (value, ==, 104042923.0);
  g_variant_get_child (values, 2, "d", &value);
  g_assert_cmpfloat (value, ==, -1.0);
  g_variant_get_child (values, 3, "d", &value);
  g_assert_cmpfloat (value, ==, -1.0);
  g_variant_get_child (values, 4, "d", &value);
  /* Cannot reliably predict the CPU value */

  /* number of shares */
  g_variant_get_child (values, 5, "d", &value);
  g_assert_cmpfloat (value, ==, 999.0);

  g_variant_unref (values);

  g_variant_unref (sample);
}

static const TestFixture fixture_unlimited = {
  .data = {
    { "memory.limit_in_bytes", G_MAXSIZE },
    { "memory.memsw.limit_in_bytes", G_MAXSSIZE },
  }
};

static void
test_zero_limits (TestCase *tc,
                  gconstpointer unused)
{
  GAsyncResult *result = NULL;
  GError *error = NULL;
  GVariant *samples;
  GVariant *values;
  GVariant *child;
  double value;
  gint64 timestamp;
  GVariant *options;
  gchar *str;

  while (tc->timestamp_received == 0)
    g_main_context_iteration (NULL, TRUE);

  options = g_variant_new_array (G_VARIANT_TYPE ("{sv}"), NULL, 0);
  cockpit_multi_resource_monitor_call_get_samples (tc->proxy, options, NULL, on_ready_get_result, &result);
  while (result == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_multi_resource_monitor_call_get_samples_finish (tc->proxy, &samples, result, &error);
  g_object_unref (result);
  g_assert_no_error (error);

  str = g_variant_print (samples, TRUE);
  g_info ("GetSamples(): %s\n", str);
  g_free (str);

  /* Parse timestamp and child out */
  g_variant_get_child (samples, 0, "(x@a{sad})", &timestamp, &child);
  g_assert (timestamp != 0);

  values = g_variant_lookup_value (child, "", G_VARIANT_TYPE ("ad"));

  /* Memory usage */
  g_variant_get_child (values, 1, "d", &value);
  g_assert_cmpfloat (value, ==, 0);
  g_variant_get_child (values, 3, "d", &value);
  g_assert_cmpfloat (value, ==, 0);
  g_variant_unref (values);

  g_variant_unref (child);
  g_variant_unref (samples);
}

int
main (int argc,
      char *argv[])
{
  gint ret;

  cockpit_test_init (&argc, &argv);

  g_test_add_func ("/cgroup-monitor/new", test_new);
  g_test_add ("/cgroup-monitor/get-samples", TestCase, &fixture_samples,
              setup, test_get_samples, teardown);
  g_test_add ("/cgroup-monitor/new-sample", TestCase, &fixture_samples,
              setup, test_new_samples, teardown);
  g_test_add ("/cgroup-monitor/zero-limits", TestCase, &fixture_unlimited,
              setup, test_zero_limits, teardown);

  ret = g_test_run ();

  return ret;
}
