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

#include "cockpitchannel.h"
#include "cockpithttpstream.h"
#include "cockpitpackages.h"

#include "mock-transport.h"

#include "common/cockpitjson.h"
#include "common/cockpittest.h"

#include <string.h>

extern const gchar **cockpit_bridge_data_dirs;
extern const gchar *cockpit_bridge_local_address;
extern gint cockpit_bridge_packages_port;

typedef struct {
  CockpitPackages *packages;
  MockTransport *transport;
  CockpitChannel *channel;
  gchar *problem;
  gboolean closed;
} TestCase;

typedef struct {
  const gchar *datadirs[8];
  const gchar *path;
  const gchar *accept[8];
  const gchar *expect;
  gboolean cacheable;
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
  JsonObject *options;
  JsonObject *headers;
  const gchar *control;
  gchar *accept;
  GBytes *bytes;

  g_assert (fixture != NULL);

  if (fixture->expect)
    cockpit_expect_warning (fixture->expect);

  if (fixture->datadirs[0])
    cockpit_bridge_data_dirs = (const gchar **)fixture->datadirs;

  tc->packages = cockpit_packages_new ();

  tc->transport = mock_transport_new ();
  g_signal_connect (tc->transport, "closed", G_CALLBACK (on_transport_closed), NULL);

  options = json_object_new ();
  json_object_set_int_member (options, "port", cockpit_bridge_packages_port);
  json_object_set_string_member (options, "payload", "http-stream1");
  json_object_set_string_member (options, "method", "GET");
  json_object_set_string_member (options, "path", fixture->path);

  headers = json_object_new ();
  if (fixture->accept[0])
    {
      accept = g_strjoinv (", ", (gchar **)fixture->accept);
      json_object_set_string_member (headers, "Accept-Language", accept);
      g_free (accept);
    }
  if (!fixture->cacheable)
    json_object_set_string_member (headers, "Pragma", "no-cache");
  json_object_set_object_member (options, "headers", headers);

  tc->channel = g_object_new (COCKPIT_TYPE_HTTP_STREAM,
                              "transport", tc->transport,
                              "id", "444",
                              "options", options,
                              NULL);

  json_object_unref (options);

  /* Tell HTTP we have no more data to send */
  control = "{\"command\": \"done\", \"channel\": \"444\"}";
  bytes = g_bytes_new_static (control, strlen (control));
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (tc->transport), NULL, bytes);
  g_bytes_unref (bytes);

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

  cockpit_packages_free (tc->packages);

  cockpit_bridge_data_dirs = NULL;
}

static const Fixture fixture_simple = {
  .path = "/test/sub/file.ext",
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

  data = mock_transport_combine_output (tc->transport, "444", &count);
  cockpit_assert_bytes_eq (data, "{\"status\":200,\"reason\":\"OK\",\"headers\":{}}"
                           "These are the contents of file.ext\nOh marmalaaade\n", -1);
  g_assert_cmpuint (count, ==, 2);
  g_bytes_unref (data);
}

static const Fixture fixture_large = {
  .path = "/test/sub/COPYING",
};

static void
test_large (TestCase *tc,
            gconstpointer fixture)
{
  GError *error = NULL;
  const gchar *prefix;
  gchar *contents;
  gsize length;
  GBytes *data;
  GBytes *sub;
  guint count;

  g_assert (fixture == &fixture_large);

  while (tc->closed == FALSE)
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpstr (tc->problem, ==, NULL);

  g_file_get_contents (SRCDIR "/src/bridge/mock-resource/system/cockpit/test/sub/COPYING",
                       &contents, &length, &error);
  g_assert_no_error (error);

  data = mock_transport_combine_output (tc->transport, "444", &count);

  /* Should not have been sent as one block */
  g_assert_cmpuint (count, ==, 8);
  prefix = "{\"status\":200,\"reason\":\"OK\",\"headers\":{}}";
  g_assert_cmpuint (g_bytes_get_size (data), >, strlen (prefix));
  g_assert (strncmp (g_bytes_get_data (data, NULL), prefix, strlen (prefix)) == 0);
  sub = g_bytes_new_from_bytes (data, strlen (prefix), g_bytes_get_size (data) - strlen (prefix));
  cockpit_assert_bytes_eq (sub, contents, length);
  g_bytes_unref (sub);
  g_bytes_unref (data);
  g_free (contents);
}

static const Fixture fixture_listing = {
  .path = "/manifests.json",
};

static void
test_listing (TestCase *tc,
              gconstpointer fixture)
{
  JsonObject *object;
  GError *error = NULL;
  GBytes *message;
  JsonNode *node;

  g_assert (fixture == &fixture_listing);

  while (tc->closed == FALSE)
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpstr (tc->problem, ==, NULL);

  message = mock_transport_pop_channel (tc->transport, "444");
  object = cockpit_json_parse_bytes (message, &error);
  g_assert_no_error (error);
  cockpit_assert_json_eq (object,
                          "{\"status\":200,\"reason\":\"OK\",\"headers\":{\"Content-Type\":\"application/json\"}}");
  json_object_unref (object);

  message = mock_transport_pop_channel (tc->transport, "444");
  node = cockpit_json_parse (g_bytes_get_data (message, NULL), g_bytes_get_size (message), &error);
  g_assert_no_error (error);
  cockpit_assert_json_eq (json_node_get_object (node),
                          "{"
                          " \"another\": {"
                          "  \"name\" : \"another\","
                          "  \"description\" : \"another\""
                          " },"
                          " \"second\": {"
                          "  \"description\": \"second dummy description\""
                          " },"
                          " \"test\": {"
                          "   \"description\" : \"dummy\""
                          " }"
                          "}");
  json_node_free (node);
}

static const Fixture fixture_not_found = {
  .path = "/test/sub/not-found",
};

static void
test_not_found (TestCase *tc,
                gconstpointer fixture)
{
  GBytes *data;

  g_assert (fixture == &fixture_not_found);

  while (tc->closed == FALSE)
    g_main_context_iteration (NULL, TRUE);

  data = mock_transport_pop_channel (tc->transport, "444");
  cockpit_assert_bytes_eq (data, "{\"status\":404,\"reason\":\"Not Found\",\"headers\":{\"Content-Type\":\"text/html; charset=utf8\"}}", -1);
}

static const Fixture fixture_unknown_package = {
  .path = "/unknownpackage/sub/not-found",
};

static void
test_unknown_package (TestCase *tc,
                      gconstpointer fixture)
{
  GBytes *data;

  g_assert (fixture == &fixture_unknown_package);

  while (tc->closed == FALSE)
    g_main_context_iteration (NULL, TRUE);

  data = mock_transport_pop_channel (tc->transport, "444");
  cockpit_assert_bytes_eq (data, "{\"status\":404,\"reason\":\"Not Found\",\"headers\":{\"Content-Type\":\"text/html; charset=utf8\"}}", -1);
}

static const Fixture fixture_no_path = {
  .path = "/test"
};

static void
test_no_path (TestCase *tc,
              gconstpointer fixture)
{
  GBytes *data;

  g_assert (fixture == &fixture_no_path);

  while (tc->closed == FALSE)
    g_main_context_iteration (NULL, TRUE);

  data = mock_transport_pop_channel (tc->transport, "444");
  cockpit_assert_bytes_eq (data, "{\"status\":404,\"reason\":\"Not Found\",\"headers\":{\"Content-Type\":\"text/html; charset=utf8\"}}", -1);
}

static const Fixture fixture_bad_path = {
  .path = "../test/sub/file.ext"
};

static void
test_bad_path (TestCase *tc,
               gconstpointer fixture)
{
  GBytes *data;

  g_assert (fixture == &fixture_bad_path);

  while (tc->closed == FALSE)
    g_main_context_iteration (NULL, TRUE);

  data = mock_transport_pop_channel (tc->transport, "444");
  cockpit_assert_bytes_eq (data, "{\"status\":404,\"reason\":\"Not Found\",\"headers\":{\"Content-Type\":\"text/html; charset=utf8\"}}", -1);
}

static const Fixture fixture_no_package = {
  .path = "test"
};

static void
test_no_package (TestCase *tc,
                 gconstpointer fixture)
{
  GBytes *data;

  g_assert (fixture == &fixture_no_package);

  while (tc->closed == FALSE)
    g_main_context_iteration (NULL, TRUE);

  data = mock_transport_pop_channel (tc->transport, "444");
  cockpit_assert_bytes_eq (data, "{\"status\":404,\"reason\":\"Not Found\",\"headers\":{\"Content-Type\":\"text/html; charset=utf8\"}}", -1);
}

static const Fixture fixture_bad_package = {
  .path = "/%%package/test"
};

static void
test_bad_package (TestCase *tc,
                  gconstpointer fixture)
{
  GBytes *data;

  g_assert (fixture == &fixture_bad_package);

  cockpit_expect_message ("invalid 'package' name: %%package");

  while (tc->closed == FALSE)
    g_main_context_iteration (NULL, TRUE);

  data = mock_transport_pop_channel (tc->transport, "444");
  cockpit_assert_bytes_eq (data, "{\"status\":404,\"reason\":\"Not Found\",\"headers\":{\"Content-Type\":\"text/html; charset=utf8\"}}", -1);
}

static void
test_bad_receive (TestCase *tc,
                  gconstpointer fixture)
{
  GBytes *bad;

  cockpit_expect_warning ("444: channel received message after done");

  /* A resource2 channel should never have payload sent to it */
  bad = g_bytes_new_static ("bad", 3);
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (tc->transport), "444", bad);
  g_bytes_unref (bad);

  while (tc->closed == FALSE)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpstr (tc->problem, ==, "protocol-error");
}

static const Fixture fixture_list_bad_name = {
    .datadirs = { SRCDIR "/src/bridge/mock-resource/bad-package", NULL },
    .expect = "package * invalid *name*",
    .path = "/manifests.json"
};

static void
test_list_bad_name (TestCase *tc,
                    gconstpointer fixture)
{
  GBytes *data;
  guint count;

  while (tc->closed == FALSE)
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpstr (tc->problem, ==, NULL);

  data = mock_transport_combine_output (tc->transport, "444", &count);
  cockpit_assert_bytes_eq (data, "{\"status\":200,\"reason\":\"OK\",\"headers\":"
                                     "{\"Content-Type\":\"application/json\"}}"
                                 "{\"ok\":{}}", -1);
  g_assert_cmpuint (count, ==, 2);
  g_bytes_unref (data);
}

static void
setup_basic (TestCase *tc,
             gconstpointer data)
{
  tc->packages = cockpit_packages_new ();
}

static void
teardown_basic (TestCase *tc,
                gconstpointer data)
{
  cockpit_assert_expected ();

  cockpit_packages_free (tc->packages);
}

static void
test_resolve (TestCase *tc,
              gconstpointer fixture)
{
  gchar *path;

  path = cockpit_packages_resolve (tc->packages, "test", "/sub/file.ext", NULL);
  g_assert_cmpstr (SRCDIR "/src/bridge/mock-resource/system/cockpit/test/sub/file.ext", ==, path);
  g_free (path);
}

static void
test_resolve_bad_dots (TestCase *tc,
                       gconstpointer fixture)
{
  gchar *path;

  cockpit_expect_message ("invalid 'path' used as a resource: *");

  path = cockpit_packages_resolve (tc->packages, "test", "../test/sub/file.ext", NULL);
  g_assert (path == NULL);
}

static void
test_resolve_bad_path (TestCase *tc,
                       gconstpointer fixture)
{
  gchar *path;

  cockpit_expect_message ("invalid 'path' used as a resource: *");

  path = cockpit_packages_resolve (tc->packages, "test", "/sub/#file.ext", NULL);
  g_assert (path == NULL);
}

static void
test_resolve_bad_package (TestCase *tc,
                          gconstpointer fixture)
{
  gchar *path;

  cockpit_expect_message ("invalid 'package' name: *");

  path = cockpit_packages_resolve (tc->packages, "#test", "/sub/file.ext", NULL);
  g_assert (path == NULL);
}

static void
test_resolve_not_found (TestCase *tc,
                        gconstpointer fixture)
{
  gchar *path;

  path = cockpit_packages_resolve (tc->packages, "unknown", "/sub/file.ext", NULL);
  g_assert (path == NULL);
}

int
main (int argc,
      char *argv[])
{
  g_setenv ("XDG_DATA_DIRS", SRCDIR "/src/bridge/mock-resource/system", TRUE);
  g_setenv ("XDG_DATA_HOME", SRCDIR "/src/bridge/mock-resource/home", TRUE);

  cockpit_bridge_local_address = "127.0.0.1";

  cockpit_test_init (&argc, &argv);

  g_test_add ("/packages/simple", TestCase, &fixture_simple,
              setup, test_simple, teardown);
  g_test_add ("/packages/large", TestCase, &fixture_large,
              setup, test_large, teardown);
  g_test_add ("/packages/listing", TestCase, &fixture_listing,
              setup, test_listing, teardown);
  g_test_add ("/packages/not-found", TestCase, &fixture_not_found,
              setup, test_not_found, teardown);
  g_test_add ("/packages/unknown-package", TestCase, &fixture_unknown_package,
              setup, test_unknown_package, teardown);
  g_test_add ("/packages/bad-receive", TestCase, &fixture_large,
              setup, test_bad_receive, teardown);
  g_test_add ("/packages/no-path", TestCase, &fixture_no_path,
              setup, test_no_path, teardown);
  g_test_add ("/packages/bad-path", TestCase, &fixture_bad_path,
              setup, test_bad_path, teardown);
  g_test_add ("/packages/no-package", TestCase, &fixture_no_package,
              setup, test_no_package, teardown);
  g_test_add ("/packages/bad-package", TestCase, &fixture_bad_package,
              setup, test_bad_package, teardown);

  g_test_add ("/packages/listing-bad-name", TestCase, &fixture_list_bad_name,
              setup, test_list_bad_name, teardown);


  g_test_add ("/packages/resolve/simple", TestCase, NULL,
              setup_basic, test_resolve, teardown_basic);
  g_test_add ("/packages/resolve/bad-dots", TestCase, NULL,
              setup_basic, test_resolve_bad_dots, teardown_basic);
  g_test_add ("/packages/resolve/bad-path", TestCase, NULL,
              setup_basic, test_resolve_bad_path, teardown_basic);
  g_test_add ("/packages/resolve/bad-package", TestCase, NULL,
              setup_basic, test_resolve_bad_package, teardown_basic);
  g_test_add ("/packages/resolve/not-found", TestCase, NULL,
              setup_basic, test_resolve_not_found, teardown_basic);

  return g_test_run ();
}
