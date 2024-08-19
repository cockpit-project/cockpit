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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

#include "config.h"

#include <fcntl.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "cockpithttpstream.h"
#include "cockpitpackages.h"

#include "common/cockpitchannel.h"
#include "common/cockpitjson.h"
#include "common/cockpitsystem.h"
#include "testlib/cockpittest.h"
#include "testlib/mock-transport.h"

/*
 * To recalculate the checksums found in this file, do something like:
 * $ XDG_DATA_DIRS=$PWD/src/bridge/mock-resource/glob/ XDG_DATA_HOME=/nonexistent ./cockpit-bridge --packages
 */
#define CHECKSUM_GLOB           "f73c058e343588a7ceaf12c4f129d324f10cc8eeb674dd098d888b619fa69cf1"
#define CHECKSUM_GZIP           "7f6449ce7a873614f4160cbcf03ee93346fd56ee7b82efe9c62193fefebe274d"
#define CHECKSUM_BADPACKAGE     "7171c55fbd2489334cda314546c670cc3d39d3a0827b212d522f39a32bf3d5de"
#define CHECKSUM_RELOAD_OLD     "16797c6330fb83dc2762d172fdf89d43e7f903841343bdf9a98e5a58f678f381"
#define CHECKSUM_RELOAD_NEW     "a90c11c111566ac87bca994acad2782b749d909738e2970f46e531d172ecbfb9"
#define CHECKSUM_RELOAD_UPDATED "5ce8c2db35591659026e3dbb7e95c6dd0a06342138fabdb07ca90ddc2d00c338"
#define CHECKSUM_CSP            "f7fe957d0ec6457f2f5fe0a343f6422547188a867c1c3e1b10ef0e3eacfc1b06"

/* JSON dict snippet for headers that are present in every request */
#define STATIC_HEADERS "\"X-DNS-Prefetch-Control\":\"off\",\"Referrer-Policy\":\"no-referrer\",\"X-Content-Type-Options\":\"nosniff\",\"Cross-Origin-Resource-Policy\": \"same-origin\",\"X-Frame-Options\": \"sameorigin\""
#define STATIC_HEADERS_CACHECONTROL STATIC_HEADERS ",\"Cache-Control\":\"no-cache, no-store\""

extern const gchar **cockpit_bridge_data_dirs;
extern const gchar *cockpit_bridge_local_address;

const gchar *config_home;

typedef struct {
  CockpitPackages *packages;
  MockTransport *transport;
  CockpitChannel *channel;
  gchar *problem;
  gboolean closed;
} TestCase;

typedef struct {
  const gchar *datadirs[8];
  const gchar *cockpit_config;
  const gchar *path;
  const gchar *accept[8];
  const gchar *expect;
  const gchar *headers[8];
  gboolean cacheable;
  gboolean binary;
  gboolean no_packages_init;
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
  guint i;

  g_assert (fixture != NULL);

  if (fixture->expect)
    cockpit_expect_warning (fixture->expect);

  if (fixture->datadirs[0])
    {
      cockpit_bridge_data_dirs = (const gchar **)fixture->datadirs;
    }
  else
    {
      cockpit_expect_message ("incompatible: package requires a later version of cockpit: 999.5*");
      cockpit_expect_message ("requires: package has an unknown requirement: unknown");
    }

  if (fixture->cockpit_config)
   {
     int fd = open (config_home, O_PATH|O_DIRECTORY);
     g_assert (fd >= 0);
     g_assert (symlinkat (fixture->cockpit_config, fd, "cockpit") == 0);
     close (fd);
   }

  tc->packages = cockpit_packages_new ();

  tc->transport = mock_transport_new ();
  g_signal_connect (tc->transport, "closed", G_CALLBACK (on_transport_closed), NULL);

  options = json_object_new ();
  json_object_set_string_member (options, "internal", "packages");
  json_object_set_string_member (options, "payload", "http-stream1");
  json_object_set_string_member (options, "method", "GET");
  json_object_set_string_member (options, "path", fixture->path);

  if (fixture->binary)
    json_object_set_string_member (options, "binary", "raw");

  headers = json_object_new ();
  if (fixture->accept[0])
    {
      accept = g_strjoinv (", ", (gchar **)fixture->accept);
      json_object_set_string_member (headers, "Accept-Language", accept);
      g_free (accept);
    }
  if (!fixture->cacheable)
    json_object_set_string_member (headers, "Pragma", "no-cache");
  for (i = 0; i < G_N_ELEMENTS (fixture->headers); i += 2)
    {
      if (fixture->headers[i])
        json_object_set_string_member (headers, fixture->headers[i], fixture->headers[i + 1]);
    }
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
  const Fixture *fixture = data;

  cockpit_assert_expected ();

  if (fixture && fixture->cockpit_config)
   {
     int fd = open (config_home, O_PATH|O_DIRECTORY);
     g_assert (fd >= 0);
     g_assert (unlinkat (fd, "cockpit", 0) == 0);
     close (fd);
   }

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
  JsonObject *object;
  GError *error = NULL;
  guint count;

  g_assert (fixture == &fixture_simple);

  while (tc->closed == FALSE)
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpstr (tc->problem, ==, NULL);

  data = mock_transport_pop_channel (tc->transport, "444");
  object = cockpit_json_parse_bytes (data, &error);
  g_assert_no_error (error);
  cockpit_assert_json_eq (object, "{\"status\":200,\"reason\":\"OK\",\"headers\":{" STATIC_HEADERS_CACHECONTROL "}}");
  json_object_unref (object);

  data = mock_transport_combine_output (tc->transport, "444", &count);
  g_assert_cmpint (count, ==, 1);
  cockpit_assert_bytes_eq (data, "These are the contents of file.ext\nOh marmalaaade\n", -1);
  g_bytes_unref (data);
}

static const Fixture fixture_forwarded = {
  .path = "/another/test.html",
  .headers = { "X-Forwarded-Proto", "https", "X-Forwarded-Host", "blah:9090" },
};

static void
test_forwarded (TestCase *tc,
             gconstpointer fixture)
{
  GBytes *data;
  JsonObject *object;
  GError *error = NULL;
  guint count;

  g_assert (fixture == &fixture_forwarded);

  while (tc->closed == FALSE)
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpstr (tc->problem, ==, NULL);

  data = mock_transport_pop_channel (tc->transport, "444");
  object = cockpit_json_parse_bytes (data, &error);
  g_assert_no_error (error);
  cockpit_assert_json_eq (object, "{\"status\":200,\"reason\":\"OK\",\"headers\":{" STATIC_HEADERS_CACHECONTROL ",\"Content-Security-Policy\":\"default-src 'self' https://blah:9090; connect-src 'self' https://blah:9090 wss://blah:9090; form-action 'self' https://blah:9090; base-uri 'self' https://blah:9090; object-src 'none'; font-src 'self' https://blah:9090 data:; img-src 'self' https://blah:9090 data:; block-all-mixed-content\",\"Content-Type\":\"text/html\",\"Access-Control-Allow-Origin\":\"https://blah:9090\"}}");
  json_object_unref (object);

  data = mock_transport_combine_output (tc->transport, "444", &count);
  g_assert_cmpint (count, ==, 1);
  cockpit_assert_bytes_eq (data, "<html>\n<head>\n<title>In home dir</title>\n</head>\n<body>In home dir</body>\n</html>\n", -1);
  g_bytes_unref (data);
}

static const Fixture fixture_pig = {
  .path = "/another/test.html",
  .accept = { "pig" },
  .headers = { "Host", "blah:9090" },
};

static void
test_localized_translated (TestCase *tc,
                           gconstpointer fixture)
{
  GBytes *data;
  JsonObject *object;
  GError *error = NULL;
  guint count;

  g_assert (fixture == &fixture_pig);

  while (tc->closed == FALSE)
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpstr (tc->problem, ==, NULL);

  data = mock_transport_pop_channel (tc->transport, "444");
  object = cockpit_json_parse_bytes (data, &error);
  g_assert_no_error (error);
  cockpit_assert_json_eq (object, "{\"status\":200,\"reason\":\"OK\",\"headers\":{" STATIC_HEADERS_CACHECONTROL ",\"Content-Security-Policy\":\"default-src 'self' http://blah:9090; connect-src 'self' http://blah:9090 ws://blah:9090; form-action 'self' http://blah:9090; base-uri 'self' http://blah:9090; object-src 'none'; font-src 'self' http://blah:9090 data:; img-src 'self' http://blah:9090 data:; block-all-mixed-content\",\"Content-Type\":\"text/html\"}}");
  json_object_unref (object);

  data = mock_transport_combine_output (tc->transport, "444", &count);
  g_assert_cmpint (count, ==, 1);
  cockpit_assert_bytes_eq (data, "<html>\n<head>\n<title>Inlay omehay irday</title>\n</head>\n<body>Inlay omehay irday</body>\n</html>\n", -1);
  g_bytes_unref (data);
}

static const Fixture fixture_unknown = {
  .path = "/another/test.html",
  .accept = { "unknown" },
  .headers = { "Host", "blah:9090" },
};

static void
test_localized_unknown (TestCase *tc,
                        gconstpointer fixture)
{
  GBytes *data;
  JsonObject *object;
  GError *error = NULL;
  guint count;

  g_assert (fixture == &fixture_unknown);

  while (tc->closed == FALSE)
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpstr (tc->problem, ==, NULL);

  data = mock_transport_pop_channel (tc->transport, "444");
  object = cockpit_json_parse_bytes (data, &error);
  g_assert_no_error (error);
  cockpit_assert_json_eq (object, "{\"status\":200,\"reason\":\"OK\",\"headers\":{" STATIC_HEADERS_CACHECONTROL ",\"Content-Security-Policy\":\"default-src 'self' http://blah:9090; connect-src 'self' http://blah:9090 ws://blah:9090; form-action 'self' http://blah:9090; base-uri 'self' http://blah:9090; object-src 'none'; font-src 'self' http://blah:9090 data:; img-src 'self' http://blah:9090 data:; block-all-mixed-content\",\"Content-Type\":\"text/html\"}}");
  json_object_unref (object);

  data = mock_transport_combine_output (tc->transport, "444", &count);
  g_assert_cmpint (count, ==, 1);
  cockpit_assert_bytes_eq (data, "<html>\n<head>\n<title>In home dir</title>\n</head>\n<body>In home dir</body>\n</html>\n", -1);
  g_bytes_unref (data);
}

static const Fixture fixture_prefer_region = {
  .path = "/another/test.html",
  .accept = { "pig-pen" },
  .headers = { "Host", "blah:9090" },
};

static void
test_localized_prefer_region (TestCase *tc,
                              gconstpointer fixture)
{
  GBytes *data;
  JsonObject *object;
  GError *error = NULL;
  guint count;

  g_assert (fixture == &fixture_prefer_region);

  while (tc->closed == FALSE)
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpstr (tc->problem, ==, NULL);


  data = mock_transport_pop_channel (tc->transport, "444");
  object = cockpit_json_parse_bytes (data, &error);
  g_assert_no_error (error);
  cockpit_assert_json_eq (object, "{\"status\":200,\"reason\":\"OK\",\"headers\":{" STATIC_HEADERS_CACHECONTROL ",\"Content-Security-Policy\":\"default-src 'self' http://blah:9090; connect-src 'self' http://blah:9090 ws://blah:9090; form-action 'self' http://blah:9090; base-uri 'self' http://blah:9090; object-src 'none'; font-src 'self' http://blah:9090 data:; img-src 'self' http://blah:9090 data:; block-all-mixed-content\",\"Content-Type\":\"text/html\"}}");
  json_object_unref (object);

  data = mock_transport_combine_output (tc->transport, "444", &count);
  g_assert_cmpint (count, ==, 1);
  cockpit_assert_bytes_eq (data, "<html>\n<head>\n<title>Inway omeha irda</title>\n</head>\n<body>Inway omeha irda</body>\n</html>\n", -1);
  g_bytes_unref (data);
}

static const Fixture fixture_fallback = {
  .path = "/another/test.html",
  .accept = { "pig-barn" },
  .headers = { "Host", "blah:9090" },
};

static void
test_localized_fallback (TestCase *tc,
                         gconstpointer fixture)
{
  GBytes *data;
  JsonObject *object;
  GError *error = NULL;
  guint count;

  g_assert (fixture == &fixture_fallback);

  while (tc->closed == FALSE)
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpstr (tc->problem, ==, NULL);


  data = mock_transport_pop_channel (tc->transport, "444");
  object = cockpit_json_parse_bytes (data, &error);
  g_assert_no_error (error);
  cockpit_assert_json_eq (object, "{\"status\":200,\"reason\":\"OK\",\"headers\":{" STATIC_HEADERS_CACHECONTROL ",\"Content-Security-Policy\":\"default-src 'self' http://blah:9090; connect-src 'self' http://blah:9090 ws://blah:9090; form-action 'self' http://blah:9090; base-uri 'self' http://blah:9090; object-src 'none'; font-src 'self' http://blah:9090 data:; img-src 'self' http://blah:9090 data:; block-all-mixed-content\",\"Content-Type\":\"text/html\"}}");
  json_object_unref (object);

  data = mock_transport_combine_output (tc->transport, "444", &count);
  g_assert_cmpint (count, ==, 1);
  cockpit_assert_bytes_eq (data, "<html>\n<head>\n<title>Inlay omehay irday</title>\n</head>\n<body>Inlay omehay irday</body>\n</html>\n", -1);
  g_bytes_unref (data);
}

static const Fixture fixture_version = {
  .path = "/incompatible/test.html",
};

static void
test_incompatible_version (TestCase *tc,
                           gconstpointer fixture)
{
  GBytes *data;
  JsonObject *object;
  GError *error = NULL;
  guint count;

  g_assert (fixture == &fixture_version);

  while (tc->closed == FALSE)
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpstr (tc->problem, ==, NULL);

  data = mock_transport_pop_channel (tc->transport, "444");
  object = cockpit_json_parse_bytes (data, &error);
  g_assert_no_error (error);
  cockpit_assert_json_eq (object, "{\"status\":503,\"reason\":\"This package requires Cockpit version 999.5 or later\",\"headers\":{" STATIC_HEADERS ",\"Content-Type\":\"text/html; charset=utf8\"}}");
  json_object_unref (object);

  data = mock_transport_combine_output (tc->transport, "444", &count);
  cockpit_assert_bytes_eq (data, "<html><head><title>This package requires Cockpit version 999.5 or later</title></head><body>This package requires Cockpit version 999.5 or later</body></html>\n", -1);
  g_bytes_unref (data);
}

static const Fixture fixture_requires = {
  .path = "/requires/test.html",
};

static void
test_incompatible_requires (TestCase *tc,
                            gconstpointer fixture)
{
  GBytes *data;
  JsonObject *object;
  GError *error = NULL;
  guint count;

  g_assert (fixture == &fixture_requires);

  while (tc->closed == FALSE)
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpstr (tc->problem, ==, NULL);

  data = mock_transport_pop_channel (tc->transport, "444");
  object = cockpit_json_parse_bytes (data, &error);
  g_assert_no_error (error);
  cockpit_assert_json_eq (object, "{\"status\":503,\"reason\":\"This package is not compatible with this version of Cockpit\",\"headers\":{" STATIC_HEADERS ",\"Content-Type\":\"text/html; charset=utf8\"}}");
  json_object_unref (object);

  data = mock_transport_combine_output (tc->transport, "444", &count);
  cockpit_assert_bytes_eq (data, "<html><head><title>This package is not compatible with this version of Cockpit</title></head><body>This package is not compatible with this version of Cockpit</body></html>\n", -1);
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
  gchar *contents;
  gsize length;
  gsize prefixlength;
  GBytes *data;
  GBytes *sub;
  guint count;
  JsonObject *object;

  g_assert (fixture == &fixture_large);

  while (tc->closed == FALSE)
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpstr (tc->problem, ==, NULL);

  g_assert (g_file_get_contents (SRCDIR "/src/bridge/mock-resource/system/cockpit/test/sub/COPYING",
                                 &contents, &length, &error));
  g_assert_no_error (error);

  data = mock_transport_combine_output (tc->transport, "444", &count);

  /* Should not have been sent as one block */
  g_assert_cmpuint (count, ==, 8);
  prefixlength = strcspn (g_bytes_get_data (data, NULL), "}}") + 2;
  g_assert_cmpuint (g_bytes_get_size (data), >, prefixlength);
  object = cockpit_json_parse_object (g_bytes_get_data (data, NULL), prefixlength, &error);
  cockpit_assert_json_eq (object, "{\"status\":200,\"reason\":\"OK\",\"headers\":{" STATIC_HEADERS_CACHECONTROL "}}");
  sub = g_bytes_new_from_bytes (data, prefixlength, g_bytes_get_size (data) - prefixlength);
  cockpit_assert_bytes_eq (sub, contents, length);

  json_object_unref (object);
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
  guint count;

  g_assert (fixture == &fixture_listing);

  while (tc->closed == FALSE)
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpstr (tc->problem, ==, NULL);

  message = mock_transport_pop_channel (tc->transport, "444");
  object = cockpit_json_parse_bytes (message, &error);
  g_assert_no_error (error);
  cockpit_assert_json_eq (object, "{\"status\":200,\"reason\":\"OK\",\"headers\":{" STATIC_HEADERS_CACHECONTROL ",\"Content-Type\":\"application/json\"}}");
  json_object_unref (object);

  message = mock_transport_combine_output (tc->transport, "444", &count);
  g_assert_cmpint (count, ==, 1);
  node = cockpit_json_parse (g_bytes_get_data (message, NULL), g_bytes_get_size (message), &error);
  g_assert_no_error (error);
  cockpit_assert_json_eq (json_node_get_object (node),
                          "{"
                          " \"another\": {"
                          "  \"name\" : \"another\","
                          "  \"description\" : \"another\","
                          "  \"bridges\": [{ \"match\": {\"host\": null },"
                          "                   \"problem\": \"not-supported\"}]"
                          " },"
                          " \"second\": {"
                          "  \"description\": \"second dummy description\","
                          "  \"priority\": 2,"
                          "  \"bridges\": [{ \"match\": { \"second\": null }, \"problem\": \"never-a-second\"}]"
                          " },"
                          " \"test\": {"
                          "   \"name\": \"test\","
                          "   \"priority\": 15,"
                          "   \"description\" : \"dummy\","
                          "   \"bridges\": [{ \"match\": { \"blah\": \"test*\" },"
                          "                  \"spawn\": [\"/usr/bin/cat\"],"
                          "                  \"environ\": [\"TEST_ENV=test\"]},"
                          "                { \"match\": { \"blah\": \"marmalade*\"},"
                          "                  \"problem\": \"bogus-channel\"}]"
                          " },"
                          " \"incompatible\": {"
                          "   \"description\" : \"incompatible package\","
                          "   \"requires\" : { \"cockpit\" : \"999.5\" }"
                          " },"
                          " \"requires\": {"
                          "   \"description\" : \"requires package\","
                          "   \"requires\" : { \"unknown\" : \"requirement\" }"
                          " }"
                          "}");
  json_node_free (node);
  g_bytes_unref (message);
}

static const Fixture fixture_override_config = {
  .cockpit_config = SRCDIR "/src/bridge/mock-resource/config-override",
  .path = "/manifests.json",
};

static void
test_override_config (TestCase *tc,
                      gconstpointer fixture)
{
  GError *error = NULL;
  GBytes *message;
  guint count;

  while (tc->closed == FALSE)
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpstr (tc->problem, ==, NULL);

  message = mock_transport_pop_channel (tc->transport, "444");
  g_autoptr(JsonObject) object = cockpit_json_parse_bytes (message, &error);
  g_assert_no_error (error);
  g_assert_cmpint (json_object_get_int_member (object, "status"), ==, 200);

  message = mock_transport_combine_output (tc->transport, "444", &count);
  g_assert_cmpint (count, ==, 1);
  g_autoptr(JsonNode) node = cockpit_json_parse (g_bytes_get_data (message, NULL), g_bytes_get_size (message), &error);
  g_assert_no_error (error);
  JsonObject *second = json_object_get_object_member (json_node_get_object (node), "second");
  g_assert (second != NULL);
  /* original priority from src/bridge/mock-resource/system/cockpit/second/manifest.json */
  g_assert_cmpint (json_object_get_int_member (second, "priority"), ==, 2);
  /* overridden description and added field from src/bridge/mock-resource/config-override/cockpit/second.override.json */
  g_assert_cmpstr (json_object_get_string_member (second, "description"), ==, "overridden second description");
  g_assert_cmpstr (json_object_get_string_member (second, "note"), ==, "an extra field");

  g_bytes_unref (message);
}

static const Fixture fixture_not_found = {
  .path = "/test/sub/not-found",
};

static void
test_not_found (TestCase *tc,
                gconstpointer fixture)
{
  GBytes *data;
  JsonObject *object;
  GError *error = NULL;


  g_assert (fixture == &fixture_not_found);

  while (tc->closed == FALSE)
    g_main_context_iteration (NULL, TRUE);

  data = mock_transport_pop_channel (tc->transport, "444");
  object = cockpit_json_parse_bytes (data, &error);
  g_assert_no_error (error);
  cockpit_assert_json_eq (object, "{\"status\":404,\"reason\":\"Not Found\",\"headers\":{" STATIC_HEADERS ",\"Content-Type\":\"text/html; charset=utf8\"}}");
  json_object_unref (object);
}

static const Fixture fixture_unknown_package = {
  .path = "/unknownpackage/sub/not-found",
};

static void
test_unknown_package (TestCase *tc,
                      gconstpointer fixture)
{
  GBytes *data;
  JsonObject *object;
  GError *error = NULL;

  g_assert (fixture == &fixture_unknown_package);

  while (tc->closed == FALSE)
    g_main_context_iteration (NULL, TRUE);

  data = mock_transport_pop_channel (tc->transport, "444");
  object = cockpit_json_parse_bytes (data, &error);
  g_assert_no_error (error);
  cockpit_assert_json_eq (object, "{\"status\":404,\"reason\":\"Not Found\",\"headers\":{" STATIC_HEADERS ",\"Content-Type\":\"text/html; charset=utf8\"}}");
  json_object_unref (object);
}

static const Fixture fixture_no_path = {
  .path = "/test"
};

static void
test_no_path (TestCase *tc,
              gconstpointer fixture)
{
  GBytes *data;
  JsonObject *object;
  GError *error = NULL;

  g_assert (fixture == &fixture_no_path);

  while (tc->closed == FALSE)
    g_main_context_iteration (NULL, TRUE);

  data = mock_transport_pop_channel (tc->transport, "444");
  object = cockpit_json_parse_bytes (data, &error);
  g_assert_no_error (error);
  cockpit_assert_json_eq (object, "{\"status\":404,\"reason\":\"Not Found\",\"headers\":{" STATIC_HEADERS ",\"Content-Type\":\"text/html; charset=utf8\"}}");
  json_object_unref (object);
}

static const Fixture fixture_bad_path = {
  .path = "/../test/sub/file.ext"
};

static void
test_bad_path (TestCase *tc,
               gconstpointer fixture)
{
  GBytes *data;
  JsonObject *object;
  GError *error = NULL;

  g_assert (fixture == &fixture_bad_path);

  while (tc->closed == FALSE)
    g_main_context_iteration (NULL, TRUE);

  data = mock_transport_pop_channel (tc->transport, "444");
  object = cockpit_json_parse_bytes (data, &error);
  g_assert_no_error (error);
  cockpit_assert_json_eq (object, "{\"status\":404,\"reason\":\"Not Found\",\"headers\":{" STATIC_HEADERS ",\"Content-Type\":\"text/html; charset=utf8\"}}");
  json_object_unref (object);
}

static const Fixture fixture_no_package = {
  .path = "/test"
};

static void
test_no_package (TestCase *tc,
                 gconstpointer fixture)
{
  GBytes *data;
  JsonObject *object;
  GError *error = NULL;

  g_assert (fixture == &fixture_no_package);

  while (tc->closed == FALSE)
    g_main_context_iteration (NULL, TRUE);

  data = mock_transport_pop_channel (tc->transport, "444");
  object = cockpit_json_parse_bytes (data, &error);
  g_assert_no_error (error);
  cockpit_assert_json_eq (object, "{\"status\":404,\"reason\":\"Not Found\",\"headers\":{" STATIC_HEADERS ",\"Content-Type\":\"text/html; charset=utf8\"}}");
  json_object_unref (object);
}

static const Fixture fixture_bad_package = {
  .path = "/%%package/test"
};

static void
test_bad_package (TestCase *tc,
                  gconstpointer fixture)
{
  GBytes *data;
  JsonObject *object;
  GError *error = NULL;

  g_assert (fixture == &fixture_bad_package);

  cockpit_expect_message ("invalid 'package' name: %%package");

  while (tc->closed == FALSE)
    g_main_context_iteration (NULL, TRUE);

  data = mock_transport_pop_channel (tc->transport, "444");
  object = cockpit_json_parse_bytes (data, &error);
  g_assert_no_error (error);
  cockpit_assert_json_eq (object, "{\"status\":404,\"reason\":\"Not Found\",\"headers\":{" STATIC_HEADERS ",\"Content-Type\":\"text/html; charset=utf8\"}}");
  json_object_unref (object);
}

static void
test_bad_receive (TestCase *tc,
                  gconstpointer fixture)
{
  GBytes *bad;

  cockpit_expect_log ("cockpit-protocol", G_LOG_LEVEL_MESSAGE, "444: channel received message after done");

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
    .expect = "*package*invalid*name*",
    .path = "/manifests.json"
};

static void
test_list_bad_name (TestCase *tc,
                    gconstpointer fixture)
{
  GBytes *data;
  JsonObject *object;
  GError *error = NULL;
  guint count;

  while (tc->closed == FALSE)
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpstr (tc->problem, ==, NULL);

  data = mock_transport_pop_channel (tc->transport, "444");
  object = cockpit_json_parse_bytes (data, &error);
  g_assert_no_error (error);
  cockpit_assert_json_eq (object, "{\"status\":200,\"reason\":\"OK\",\"headers\":{" STATIC_HEADERS ",\"Content-Type\":\"application/json\",\"X-Cockpit-Pkg-Checksum\":\"" CHECKSUM_BADPACKAGE "\",\"ETag\":\"\\\"$" CHECKSUM_BADPACKAGE "\\\"\"}}");
  json_object_unref (object);

  data = mock_transport_combine_output (tc->transport, "444", &count);
  g_assert_cmpint (count, ==, 1);
  cockpit_assert_bytes_eq (data, "{\".checksum\":\"" CHECKSUM_BADPACKAGE "\",\"ok\":{\".checksum\":\"" CHECKSUM_BADPACKAGE "\"}}", -1);
  g_bytes_unref (data);
}

static const Fixture fixture_glob = {
    .datadirs = { SRCDIR "/src/bridge/mock-resource/glob", NULL },
    .path = "/*/file.txt"
};

static void
test_glob (TestCase *tc,
           gconstpointer fixture)
{
  GError *error = NULL;
  GBytes *message;
  JsonObject *object;

  while (tc->closed == FALSE)
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpstr (tc->problem, ==, NULL);

  message = mock_transport_pop_channel (tc->transport, "444");
  object = cockpit_json_parse_bytes (message, &error);
  g_assert_no_error (error);
  cockpit_assert_json_eq (object, "{\"status\":200,\"reason\":\"OK\",\"headers\":{" STATIC_HEADERS_CACHECONTROL ",\"X-Cockpit-Pkg-Checksum\":\"" CHECKSUM_GLOB "\",\"Content-Type\":\"text/plain\"}}");
  json_object_unref (object);

  message = mock_transport_pop_channel (tc->transport, "444");
  cockpit_assert_bytes_eq (message, "a\n", 2);

  message = mock_transport_pop_channel (tc->transport, "444");
  cockpit_assert_bytes_eq (message, "b\n", 2);
}

static const Fixture fixture_with_gzip = {
    .datadirs = { SRCDIR "/src/bridge/mock-resource/gzip", NULL },
    .path = "/package/file.txt",
    .binary = TRUE,
    .headers = { "Accept-Encoding", "*" },
};

static void
test_with_gzip (TestCase *tc,
                gconstpointer fixture)
{
  GError *error = NULL;
  GBytes *message;
  JsonObject *object;
  GBytes *data;

  while (tc->closed == FALSE)
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpstr (tc->problem, ==, NULL);

  message = mock_transport_pop_channel (tc->transport, "444");
  object = cockpit_json_parse_bytes (message, &error);
  g_assert_no_error (error);
  cockpit_assert_json_eq (object, "{\"status\":200,\"reason\":\"OK\",\"headers\":{" STATIC_HEADERS ",\"X-Cockpit-Pkg-Checksum\":\"" CHECKSUM_GZIP "\",\"Content-Encoding\":\"gzip\",\"Content-Type\":\"text/plain\"}}");
  json_object_unref (object);

  data = mock_transport_combine_output (tc->transport, "444", NULL);
  g_assert_cmpint (g_bytes_get_size (data), ==, 9377);
  g_bytes_unref (data);
}

static const Fixture fixture_no_gzip = {
    .datadirs = { SRCDIR "/src/bridge/mock-resource/gzip", NULL },
    .path = "/package/file.txt",
    .binary = TRUE,
    .headers = { "Accept-Encoding", "identity" },
};

static void
test_no_gzip (TestCase *tc,
              gconstpointer fixture)
{
  GError *error = NULL;
  GBytes *message;
  JsonObject *object;
  GBytes *data;

  while (tc->closed == FALSE)
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpstr (tc->problem, ==, NULL);

  message = mock_transport_pop_channel (tc->transport, "444");
  object = cockpit_json_parse_bytes (message, &error);
  g_assert_no_error (error);
  cockpit_assert_json_eq (object, "{\"status\":200,\"reason\":\"OK\",\"headers\":{" STATIC_HEADERS ",\"X-Cockpit-Pkg-Checksum\":\"" CHECKSUM_GZIP "\",\"Content-Type\":\"text/plain\"}}");
  json_object_unref (object);

  data = mock_transport_combine_output (tc->transport, "444", NULL);
  g_assert_cmpint (g_bytes_get_size (data), ==, 26530);
  g_bytes_unref (data);
}

static void
setup_basic (TestCase *tc,
             gconstpointer data)
{
  const Fixture *fixture = data;

  if (fixture && fixture->datadirs[0])
    {
      cockpit_bridge_data_dirs = (const gchar **)fixture->datadirs;
    }
  else
    {
      cockpit_expect_message ("incompatible: package requires a later version of cockpit: 999.5*");
      cockpit_expect_message ("requires: package has an unknown requirement: unknown");
    }

  if (!fixture || !fixture->no_packages_init)
    tc->packages = cockpit_packages_new ();
}

static void
teardown_basic (TestCase *tc,
                gconstpointer data)
{
  cockpit_assert_expected ();

  cockpit_packages_free (tc->packages);

  cockpit_bridge_data_dirs = NULL;
}

static void
test_resolve (TestCase *tc,
              gconstpointer fixture)
{
  gchar *path;

  path = cockpit_packages_resolve (tc->packages, "test", "/sub/file.ext", NULL);
  g_assert_cmpstr (SRCDIR "/src/bridge/mock-resource/system/cockpit/test-priority/sub/file.ext", ==, path);
  g_free (path);

  path = cockpit_packages_resolve (tc->packages, "test", "/_modules/@testorg/toolkit.js", NULL);
  g_assert_cmpstr (SRCDIR "/src/bridge/mock-resource/system/cockpit/test-priority/_modules/@testorg/toolkit.js", ==, path);
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

static int
compar_str (const void *pa,
            const void *pb)
{
  return strcmp (*(const char**)pa, *(const char**)pb);
}

static void
test_get_names (TestCase *tc,
                gconstpointer fixture)
{
  gchar **names;
  gchar *result;

  names = cockpit_packages_get_names (tc->packages);
  g_assert (names != NULL);

  qsort (names, g_strv_length (names), sizeof (gchar *), compar_str);
  result = g_strjoinv (", ", names);

  /* Note that unavailable packages are not included */
  g_assert_cmpstr (result, ==, "another, second, test");

  g_free (result);
  g_free (names);
}

static void
test_get_bridges (TestCase *tc,
                  gconstpointer fixture)
{
  GList *bridges, *l;
  JsonObject *bridge;
  guint i;

  bridges = cockpit_packages_get_bridges (tc->packages);
  g_assert (bridges != NULL);

  for (i = 0, l = bridges; l != NULL; l = g_list_next (l), i++)
    {
      bridge = l->data;
      switch (i)
        {
        case 0:
          cockpit_assert_json_eq (json_object_get_object_member (bridge, "match"),
                                  "{ \"blah\": \"test*\" }");
          cockpit_assert_json_eq (json_object_get_array_member (bridge, "environ"),
                                  "[\"TEST_ENV=test\"]");
          cockpit_assert_json_eq (json_object_get_array_member (bridge, "spawn"),
                                  "[\"/usr/bin/cat\"]");
          break;
        case 1:
          cockpit_assert_json_eq (json_object_get_object_member (bridge, "match"),
                                  "{ \"blah\": \"marmalade*\" }");
          g_assert_cmpstr (json_object_get_string_member (bridge, "problem"), ==, "bogus-channel");
          break;
        case 2:
          cockpit_assert_json_eq (json_object_get_object_member (bridge, "match"),
                                  "{ \"second\": null }");
          g_assert_cmpstr (json_object_get_string_member (bridge, "problem"), ==, "never-a-second");
          break;
        case 3:
          cockpit_assert_json_eq (json_object_get_object_member (bridge, "match"),
                                  "{ \"host\": null }");
          g_assert_cmpstr (json_object_get_string_member (bridge, "problem"), ==, "not-supported");
          break;
        default:
          g_assert_not_reached ();
        }
    }

  g_assert_cmpint (i, ==, 4);
  g_list_free (bridges);
}

static const Fixture fixture_bad_bridges = {
    .datadirs = { SRCDIR "/src/bridge/mock-resource/bad-bridges", NULL },
};

static void
test_get_bridges_broken (TestCase *tc,
                         gconstpointer fixture)
{
  GList *bridges;

  g_assert (fixture == &fixture_bad_bridges);

  cockpit_expect_message ("missing-match: Exactly one of \"match\" or \"privileged\" required");
  cockpit_expect_message ("broken-problem: invalid \"problem\" field in package manifest");
  cockpit_expect_message ("broken-environ: invalid \"environ\" field in package manifest");
  cockpit_expect_message ("broken-spawn: invalid \"spawn\" field in package manifest");
  cockpit_expect_message ("broken-match: invalid \"match\" field in package manifest");
  cockpit_expect_message ("broken-bridges: invalid \"bridges\" field in package manifest");
  cockpit_expect_message ("broken-bridge: invalid bridge in \"bridges\" field in package manifest");

  bridges = cockpit_packages_get_bridges (tc->packages);
  g_assert (bridges == NULL);
}

static const Fixture fixture_reload = {
  .no_packages_init = TRUE,
  .datadirs = { BUILDDIR "/src/bridge/mock-resource/reload", NULL },
};

__attribute__((format(printf, 1, 2)))
static void
systemf (const gchar *fmt, ...)
{
  gchar *cmd;

  va_list ap;
  va_start (ap, fmt);
  cmd = g_strdup_vprintf (fmt, ap);
  va_end (ap);

  g_assert (system (cmd) == 0);

  g_free (cmd);
}

static void
setup_reload_packages (const gchar *datadir,
                       const gchar *variant)
{
  const gchar *srcdir = SRCDIR "/src/bridge/mock-resource/reload";
  systemf ("mkdir -p $(dirname '%s') && rm -rf '%s' && ln -sf '%s.%s' '%s'",
           datadir, datadir, srcdir, variant, datadir);
}

static void
teardown_reload_packages (const gchar *datadir)
{
  systemf ("rm -f '%s'", datadir);
}

static void
assert_manifest_checksum (TestCase *tc,
                          const gchar *name,
                          const gchar *expected)
{
  JsonObject *json;
  const gchar *checksum;

  json = cockpit_packages_peek_json (tc->packages);
  if (name)
    g_assert (cockpit_json_get_object (json, name, NULL, &json));
  if (expected)
    {
      g_assert (cockpit_json_get_string (json, ".checksum", NULL, &checksum));
      g_assert_cmpstr (checksum, ==, expected);
    }
  else
    g_assert (json == NULL);
}

static void
test_reload_added (TestCase *tc,
                   gconstpointer data)
{
  const Fixture *fixture = data;
  const gchar *datadir;

  cockpit_bridge_data_dirs = (const gchar **)fixture->datadirs;
  datadir = cockpit_bridge_data_dirs[0];

  setup_reload_packages (datadir, "old");
  tc->packages = cockpit_packages_new ();

  assert_manifest_checksum (tc, NULL,  CHECKSUM_RELOAD_OLD);
  assert_manifest_checksum (tc, "old", CHECKSUM_RELOAD_OLD);

  setup_reload_packages (datadir, "new");
  cockpit_packages_reload (tc->packages);

  assert_manifest_checksum (tc, NULL,  CHECKSUM_RELOAD_OLD);
  assert_manifest_checksum (tc, "old", CHECKSUM_RELOAD_OLD);
  assert_manifest_checksum (tc, "new", CHECKSUM_RELOAD_NEW);

  teardown_reload_packages (datadir);
}

static void
test_reload_removed (TestCase *tc,
                     gconstpointer data)
{
  const Fixture *fixture = data;
  const gchar *datadir;

  cockpit_bridge_data_dirs = (const gchar **)fixture->datadirs;
  datadir = cockpit_bridge_data_dirs[0];

  setup_reload_packages (datadir, "new");
  tc->packages = cockpit_packages_new ();

  assert_manifest_checksum (tc, NULL,  CHECKSUM_RELOAD_NEW);
  assert_manifest_checksum (tc, "old", CHECKSUM_RELOAD_NEW);
  assert_manifest_checksum (tc, "new", CHECKSUM_RELOAD_NEW);

  setup_reload_packages (datadir, "old");
  cockpit_packages_reload (tc->packages);

  assert_manifest_checksum (tc, NULL,  CHECKSUM_RELOAD_NEW);
  assert_manifest_checksum (tc, "old", CHECKSUM_RELOAD_NEW);
  assert_manifest_checksum (tc, "new", NULL);

  teardown_reload_packages (datadir);
}

static void
test_reload_updated (TestCase *tc,
                     gconstpointer data)
{
  const Fixture *fixture = data;
  const gchar *datadir;

  cockpit_bridge_data_dirs = (const gchar **)fixture->datadirs;
  datadir = cockpit_bridge_data_dirs[0];

  setup_reload_packages (datadir, "old");
  tc->packages = cockpit_packages_new ();

  assert_manifest_checksum (tc, NULL,  CHECKSUM_RELOAD_OLD);
  assert_manifest_checksum (tc, "old", CHECKSUM_RELOAD_OLD);

  setup_reload_packages (datadir, "updated");
  cockpit_packages_reload (tc->packages);

  assert_manifest_checksum (tc, NULL,  CHECKSUM_RELOAD_OLD);
  assert_manifest_checksum (tc, "old", CHECKSUM_RELOAD_UPDATED);

  teardown_reload_packages (datadir);
}

static const Fixture fixture_csp_strip = {
  .path = "/strip/test.html",
  .datadirs = { SRCDIR "/src/bridge/mock-resource/csp", NULL },
  .headers = { "Host", "blah:9090" },
};

static void
test_csp_strip (TestCase *tc,
                gconstpointer fixture)
{
  GBytes *data;
  JsonObject *object;
  GError *error = NULL;
  guint count;

  g_assert (fixture == &fixture_csp_strip);

  while (tc->closed == FALSE)
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpstr (tc->problem, ==, NULL);

  data = mock_transport_pop_channel (tc->transport, "444");
  object = cockpit_json_parse_bytes (data, &error);
  g_assert_no_error (error);
  cockpit_assert_json_eq (object, "{\"status\":200,\"reason\":\"OK\",\"headers\":{" STATIC_HEADERS ",\"Content-Security-Policy\":\"connect-src 'self' http://blah:9090 ws://blah:9090; form-action 'self' http://blah:9090; base-uri 'self' http://blah:9090; object-src 'none'; font-src 'self' http://blah:9090 data:; block-all-mixed-content; img-src 'self' http://blah:9090; default-src 'self' http://blah:9090\",\"Content-Type\":\"text/html\",\"X-Cockpit-Pkg-Checksum\":\"" CHECKSUM_CSP "\"}}");
  json_object_unref (object);

  data = mock_transport_combine_output (tc->transport, "444", &count);
  g_assert_cmpint (count, ==, 1);
  cockpit_assert_bytes_eq (data, "<html>\n<head>\n<title>Test</title>\n</head>\n<body>Test</body>\n</html>\n", -1);
  g_bytes_unref (data);
}

int
main (int argc,
      char *argv[])
{
  cockpit_setenv_check ("XDG_DATA_DIRS", SRCDIR "/src/bridge/mock-resource/system", TRUE);
  cockpit_setenv_check ("XDG_DATA_HOME", SRCDIR "/src/bridge/mock-resource/home", TRUE);

  /* avoid looking at the real ~/.config and allow tests to add their own config */
  config_home = g_dir_make_tmp ("config-home.XXXXXX", NULL);
  g_assert (config_home != NULL);
  cockpit_setenv_check ("XDG_CONFIG_HOME", config_home, TRUE);

  cockpit_bridge_local_address = "127.0.0.1";

  cockpit_test_init (&argc, &argv);

  extern const gchar *cockpit_webresponse_fail_html_text;
  cockpit_webresponse_fail_html_text =
    "<html><head><title>@@message@@</title></head><body>@@message@@</body></html>\n";

  g_test_add ("/packages/simple", TestCase, &fixture_simple,
              setup, test_simple, teardown);
  g_test_add ("/packages/forwarded", TestCase, &fixture_forwarded,
              setup, test_forwarded, teardown);
  g_test_add ("/packages/localized-translated", TestCase, &fixture_pig,
              setup, test_localized_translated, teardown);
  g_test_add ("/packages/localized-unknown", TestCase, &fixture_unknown,
              setup, test_localized_unknown, teardown);
  g_test_add ("/packages/localized-prefer-region", TestCase, &fixture_prefer_region,
              setup, test_localized_prefer_region, teardown);
  g_test_add ("/packages/localized-fallback", TestCase, &fixture_fallback,
              setup, test_localized_fallback, teardown);
  g_test_add ("/packages/incompatible/version", TestCase, &fixture_version,
              setup, test_incompatible_version, teardown);
  g_test_add ("/packages/incompatible/requires", TestCase, &fixture_requires,
              setup, test_incompatible_requires, teardown);
  g_test_add ("/packages/large", TestCase, &fixture_large,
              setup, test_large, teardown);
  g_test_add ("/packages/listing", TestCase, &fixture_listing,
              setup, test_listing, teardown);
  g_test_add ("/packages/override-config", TestCase, &fixture_override_config,
              setup, test_override_config, teardown);
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

  g_test_add ("/packages/glob", TestCase, &fixture_glob,
              setup, test_glob, teardown);
  g_test_add ("/packages/with-gzip", TestCase, &fixture_with_gzip,
              setup, test_with_gzip, teardown);
  g_test_add ("/packages/no-gzip", TestCase, &fixture_no_gzip,
              setup, test_no_gzip, teardown);

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

  g_test_add ("/packages/get-names", TestCase, NULL,
              setup_basic, test_get_names, teardown_basic);

  g_test_add ("/packages/get-bridges/normal", TestCase, NULL,
              setup_basic, test_get_bridges, teardown_basic);
  g_test_add ("/packages/get-bridges/broken", TestCase, &fixture_bad_bridges,
              setup_basic, test_get_bridges_broken, teardown_basic);

  g_test_add ("/packages/reload/added", TestCase, &fixture_reload,
              setup_basic, test_reload_added, teardown_basic);
  g_test_add ("/packages/reload/removed", TestCase, &fixture_reload,
              setup_basic, test_reload_removed, teardown_basic);
  g_test_add ("/packages/reload/updated", TestCase, &fixture_reload,
              setup_basic, test_reload_updated, teardown_basic);

  g_test_add ("/packages/csp/strip", TestCase, &fixture_csp_strip,
              setup, test_csp_strip, teardown);

  int result = g_test_run ();

  rmdir (config_home);

  return result;
}
