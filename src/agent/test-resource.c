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

#include "cockpitresource.h"
#include "mock-transport.h"

#include "common/cockpittest.h"

extern const gchar **cockpit_agent_data_dirs;

typedef struct {
  MockTransport *transport;
  CockpitChannel *channel;
  gchar *problem;
  gboolean closed;
} TestCase;

typedef struct {
  const gchar *datadirs[8];
  const gchar *package;
  const gchar *path;
} Fixture;

static void
on_channel_close (CockpitChannel *channel,
                  const gchar *problem,
                  gpointer user_data)
{
  TestCase *tc = user_data;
  g_assert (tc->closed == FALSE);
  tc->closed = TRUE;
  tc->problem = g_strdup (problem);
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
  const Fixture *fixture = data;

  g_assert (fixture != NULL);

  if (fixture->datadirs[0])
    cockpit_agent_data_dirs = (const gchar **)fixture->datadirs;

  tc->transport = mock_transport_new ();
  g_signal_connect (tc->transport, "closed", G_CALLBACK (on_transport_closed), NULL);

  tc->channel = cockpit_resource_open (COCKPIT_TRANSPORT (tc->transport), "444",
                                       fixture->package,
                                       fixture->path);
  g_signal_connect (tc->channel, "closed", G_CALLBACK (on_channel_close), tc);
}

static void
teardown (TestCase *tc,
          gconstpointer data)
{
  cockpit_assert_expected ();

  g_object_unref (tc->transport);

  g_object_add_weak_pointer (G_OBJECT (tc->channel), (gpointer *)&tc->channel);
  g_object_unref (tc->channel);
  g_assert (tc->channel == NULL);

  g_free (tc->problem);

  cockpit_agent_data_dirs = NULL;
}

static GBytes *
combine_output (TestCase *tc,
                guint *count)
{
  GByteArray *combined;
  GBytes *block;

  if (count)
    *count = 0;

  combined = g_byte_array_new ();
  for (;;)
    {
      block = mock_transport_pop_channel (tc->transport, "444");
      if (!block)
        break;

      g_byte_array_append (combined, g_bytes_get_data (block, NULL), g_bytes_get_size (block));
      if (count)
        (*count)++;
    }
  return g_byte_array_free_to_bytes (combined);
}

static const Fixture fixture_simple = {
  .package = "test",
  .path = "/sub/file.ext",
};

static void
test_simple (TestCase *tc,
             gconstpointer fixture)
{
  GBytes *data;
  guint count;

  g_assert (fixture == &fixture_simple);

  while (tc->closed == FALSE)
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpstr (tc->problem, ==, NULL);

  data = combine_output (tc, &count);
  cockpit_assert_bytes_eq (data, "These are the contents of file.ext\nOh marmalaaade\n", -1);
  g_assert_cmpuint (count, ==, 1);
  g_bytes_unref (data);
}

static const Fixture fixture_large = {
  .package = "test",
  .path = "/sub/COPYING",
};

static void
test_large (TestCase *tc,
            gconstpointer fixture)
{
  GError *error = NULL;
  gchar *contents;
  gsize length;
  GBytes *data;
  guint count;

  g_assert (fixture == &fixture_large);

  while (tc->closed == FALSE)
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpstr (tc->problem, ==, NULL);

  g_file_get_contents (SRCDIR "/src/agent/mock-resource/system/cockpit/test/sub/COPYING",
                       &contents, &length, &error);
  g_assert_no_error (error);

  data = combine_output (tc, &count);

  /* Should not have been sent as one block */
  g_assert_cmpuint (count, ==, 7);
  cockpit_assert_bytes_eq (data, contents, length);
  g_bytes_unref (data);
  g_free (contents);
}

static const Fixture fixture_listing = {
  .package = NULL,
  .path = NULL,
};

static void
test_listing (TestCase *tc,
              gconstpointer fixture)
{
  JsonObject *control;
  GBytes *data;
  guint count;

  g_assert (fixture == &fixture_listing);

  while (tc->closed == FALSE)
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpstr (tc->problem, ==, NULL);

  data = combine_output (tc, &count);
  cockpit_assert_bytes_eq (data, "", 0);
  g_assert_cmpuint (count, ==, 0);
  g_bytes_unref (data);

  control = mock_transport_pop_control (tc->transport);
  cockpit_assert_json_eq (control,
                          "{ \"command\": \"close\", \"channel\": \"444\", \"reason\": \"\", \"packages\": ["
                          " {"
                          "  \"id\": [\"$279d9f5b572e7f59b8c9117b1f8ebfa079611c17\",\"one\",\"second\",\"two\"],"
                          "  \"manifest\": { \"description\": \"second dummy description\"}"
                          " },{"
                          "  \"id\": [ \"$4784b8b983691a87886ce8325bda5f0ed748f058\", \"test\" ],"
                          "  \"manifest\" : { \"description\" : \"dummy\"}"
                          " },{"
                          "  \"id\": [ \"another\", \"marmalade\" ],"
                          "  \"manifest\" : { \"description\" : \"another\"}"
                          " }"
                          "] }");
}

static const Fixture fixture_not_found = {
  .package = "test",
  .path = "/sub/not-found",
};

static void
test_not_found (TestCase *tc,
                gconstpointer fixture)
{
  g_assert (fixture == &fixture_not_found);

  while (tc->closed == FALSE)
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpstr (tc->problem, ==, "not-found");
}

static const Fixture fixture_unknown_package = {
  .package = "unknownpackage",
  .path = "/sub/not-found",
};

static void
test_unknown_package (TestCase *tc,
                      gconstpointer fixture)
{
  g_assert (fixture == &fixture_unknown_package);

  while (tc->closed == FALSE)
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpstr (tc->problem, ==, "not-found");
}

static const Fixture fixture_no_path = {
  .package = "test"
};

static void
test_no_path (TestCase *tc,
              gconstpointer fixture)
{
  g_assert (fixture == &fixture_no_path);

  cockpit_expect_message ("no 'path' specified for resource channel");

  while (tc->closed == FALSE)
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpstr (tc->problem, ==, "protocol-error");
}

static const Fixture fixture_bad_path = {
  .package = "test",
  .path = "../test/sub/file.ext"
};

static void
test_bad_path (TestCase *tc,
               gconstpointer fixture)
{
  g_assert (fixture == &fixture_bad_path);

  cockpit_expect_message ("invalid 'path' used as a resource:*");

  while (tc->closed == FALSE)
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpstr (tc->problem, ==, "not-found");
}

static const Fixture fixture_no_package = {
  .path = "test"
};

static void
test_no_package (TestCase *tc,
                 gconstpointer fixture)
{
  g_assert (fixture == &fixture_no_package);

  cockpit_expect_message ("no 'package' specified for resource channel");

  while (tc->closed == FALSE)
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpstr (tc->problem, ==, "protocol-error");
}

static const Fixture fixture_bad_package = {
  .package = "%%package",
  .path = "test"
};

static void
test_bad_package (TestCase *tc,
                  gconstpointer fixture)
{
  g_assert (fixture == &fixture_bad_package);

  cockpit_expect_message ("invalid 'package' name: %%package");

  while (tc->closed == FALSE)
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpstr (tc->problem, ==, "not-found");
}

static void
test_bad_receive (TestCase *tc,
                  gconstpointer fixture)
{
  GBytes *bad;

  cockpit_expect_message ("received unexpected message in resource channel");

  /* A resource1 channel should never have payload sent to it */
  bad = g_bytes_new_static ("bad", 3);
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (tc->transport), "444", bad);
  g_bytes_unref (bad);

  while (tc->closed == FALSE)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpstr (tc->problem, ==, "protocol-error");
}

static const Fixture fixture_list_bad_directory = {
    .datadirs = { SRCDIR "/src/agent/mock-resource/bad-directory", NULL }
};

static const Fixture fixture_list_bad_file = {
    .datadirs = { SRCDIR "/src/agent/mock-resource/bad-file", NULL }
};

static const Fixture fixture_list_bad_name = {
    .datadirs = { SRCDIR "/src/agent/mock-resource/bad-package", NULL }
};

static void
test_list_bad_name (TestCase *tc,
                    gconstpointer fixture)
{
  JsonObject *control;
  GBytes *data;
  guint count;

  cockpit_expect_warning ("package * invalid *name*");

  while (tc->closed == FALSE)
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpstr (tc->problem, ==, NULL);

  data = combine_output (tc, &count);
  cockpit_assert_bytes_eq (data, "", 0);
  g_assert_cmpuint (count, ==, 0);
  g_bytes_unref (data);

  control = mock_transport_pop_control (tc->transport);
  cockpit_assert_json_eq (control,
                          "{ \"command\": \"close\", \"channel\": \"444\", \"reason\": \"\", \"packages\": ["
                          " {"
                          "  \"id\": [ \"$248b261c112455057b51827f3f63380159e27338\", \"ok\" ],"
                          "  \"manifest\": { }"
                          " }"
                          "] }");
}

int
main (int argc,
      char *argv[])
{
  g_setenv ("XDG_DATA_DIRS", SRCDIR "/src/agent/mock-resource/system", TRUE);
  g_setenv ("XDG_DATA_HOME", SRCDIR "/src/agent/mock-resource/home", TRUE);

  cockpit_test_init (&argc, &argv);

  g_test_add ("/resource/simple", TestCase, &fixture_simple,
              setup, test_simple, teardown);
  g_test_add ("/resource/large", TestCase, &fixture_large,
              setup, test_large, teardown);
  g_test_add ("/resource/listing", TestCase, &fixture_listing,
              setup, test_listing, teardown);
  g_test_add ("/resource/not-found", TestCase, &fixture_not_found,
              setup, test_not_found, teardown);
  g_test_add ("/resource/unknown-package", TestCase, &fixture_unknown_package,
              setup, test_unknown_package, teardown);
  g_test_add ("/resource/bad-receive", TestCase, &fixture_large,
              setup, test_bad_receive, teardown);
  g_test_add ("/resource/no-path", TestCase, &fixture_no_path,
              setup, test_no_path, teardown);
  g_test_add ("/resource/bad-path", TestCase, &fixture_bad_path,
              setup, test_bad_path, teardown);
  g_test_add ("/resource/no-package", TestCase, &fixture_no_package,
              setup, test_no_package, teardown);
  g_test_add ("/resource/bad-package", TestCase, &fixture_bad_package,
              setup, test_bad_package, teardown);

  g_test_add ("/resource/listing-bad-directory", TestCase, &fixture_list_bad_directory,
              setup, test_list_bad_name, teardown);
  g_test_add ("/resource/listing-bad-file", TestCase, &fixture_list_bad_file,
              setup, test_list_bad_name, teardown);
  g_test_add ("/resource/listing-bad-name", TestCase, &fixture_list_bad_name,
              setup, test_list_bad_name, teardown);

  return g_test_run ();
}
