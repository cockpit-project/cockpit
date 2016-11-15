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

#include "cockpitwebinject.h"
#include "cockpitwebresponse.h"
#include "cockpitwebserver.h"

#include "mock-io-stream.h"

#include "common/cockpittest.h"

#include "websocket/websocket.h"

#include <glib/gstdio.h>

#include <stdlib.h>
#include <string.h>

static gchar *srcdir;

typedef struct {
    CockpitWebResponse *response;
    GOutputStream *output;
    gchar *scratch;
    gboolean response_done;
    gulong sig_done;
} TestCase;

typedef struct {
    const gchar *path;
    const gchar *header;
    const gchar *value;
    CockpitCacheType cache;
} TestFixture;

static void
on_response_done (CockpitWebResponse *response,
                  gboolean reusable,
                  gpointer user_data)
{
  gboolean *response_done = user_data;
  g_assert (response_done != NULL);
  g_assert (*response_done == FALSE);
  *response_done = TRUE;
}

static void
setup (TestCase *tc,
       gconstpointer data)
{
  const TestFixture *fixture = data;
  const gchar *path = NULL;
  GHashTable *headers = NULL;
  GInputStream *input;
  GIOStream *io;

  if (fixture)
    path = fixture->path;

  input = g_memory_input_stream_new ();
  tc->output = g_memory_output_stream_new (NULL, 0, g_realloc, g_free);
  io = mock_io_stream_new (input, tc->output);
  g_object_unref (input);

  if (fixture && fixture->header)
    {
      headers = cockpit_web_server_new_table ();
      g_hash_table_insert (headers, g_strdup (fixture->header), g_strdup (fixture->value));
    }

  tc->response = cockpit_web_response_new (io, path, path, NULL, headers);

  if (headers)
    g_hash_table_unref (headers);
  g_object_unref (io);

  tc->sig_done = g_signal_connect (tc->response, "done",
                                   G_CALLBACK (on_response_done),
                                   &tc->response_done);
}

static void
teardown (TestCase *tc,
          gconstpointer data)
{
  while (g_main_context_iteration (NULL, FALSE));
  g_assert (tc->response_done);

  g_signal_handler_disconnect (tc->response, tc->sig_done);
  g_clear_object (&tc->output);
  g_clear_object (&tc->response);
  g_free (tc->scratch);
}

static const gchar *
output_as_string (TestCase *tc)
{
  while (!tc->response_done)
    g_main_context_iteration (NULL, TRUE);

  g_free (tc->scratch);
  tc->scratch = g_strndup (g_memory_output_stream_get_data (G_MEMORY_OUTPUT_STREAM (tc->output)),
                           g_memory_output_stream_get_data_size (G_MEMORY_OUTPUT_STREAM (tc->output)));
  return tc->scratch;
}

static void
test_return_content (TestCase *tc,
                     gconstpointer data)
{
  const gchar *resp;
  GBytes *content;

  content = g_bytes_new_static ("the content", 11);
  cockpit_web_response_content (tc->response, NULL, content, NULL);
  g_bytes_unref (content);

  resp = output_as_string (tc);
  g_assert_cmpstr (resp, ==, "HTTP/1.1 200 OK\r\nContent-Length: 11\r\n\r\nthe content");
}

static void
test_return_content_headers (TestCase *tc,
                             gconstpointer data)
{
  const gchar *resp;
  GHashTable *headers;
  GBytes *content;

  headers = cockpit_web_server_new_table ();
  g_hash_table_insert (headers, g_strdup ("My-header"), g_strdup ("my-value"));

  content = g_bytes_new_static ("the content", 11);
  cockpit_web_response_content (tc->response, headers, content, NULL);
  g_bytes_unref (content);
  g_hash_table_destroy (headers);

  resp = output_as_string (tc);
  g_assert_cmpstr (resp, ==, "HTTP/1.1 200 OK\r\nMy-header: my-value\r\nContent-Length: 11\r\n\r\nthe content");
}


static void
test_return_error (TestCase *tc,
                   gconstpointer data)
{
  const gchar *resp;

  cockpit_expect_message ("Returning error-response 500*");

  cockpit_web_response_error (tc->response, 500, NULL, "Reason here: %s", "booyah");

  resp = output_as_string (tc);
  g_assert_cmpstr (resp, ==,
    "HTTP/1.1 500 Reason here: booyah\r\n"
    "Content-Type: text/html; charset=utf8\r\n"
    "Transfer-Encoding: chunked\r\n"
    "\r\n"
    "13\r\n<html><head><title>\r\n"
    "13\r\nReason here: booyah\r\n"
    "15\r\n</title></head><body>\r\n"
    "13\r\nReason here: booyah\r\n"
    "f\r\n</body></html>\n\r\n"
    "0\r\n\r\n");
}

static void
test_return_error_headers (TestCase *tc,
                           gconstpointer data)
{
  const gchar *resp;
  GHashTable *headers;

  cockpit_expect_message ("Returning error-response 500*");

  headers = cockpit_web_server_new_table ();
  g_hash_table_insert (headers, g_strdup ("Header1"), g_strdup ("value1"));

  cockpit_web_response_error (tc->response, 500, headers, "Reason here: %s", "booyah");

  g_hash_table_destroy (headers);

  resp = output_as_string (tc);
  cockpit_assert_strmatch(resp,"HTTP/1.1 500 Reason here: booyah\r*\n"
    "Header1: value1\r*\n"
    "\r\n");
}

static void
test_return_gerror_headers (TestCase *tc,
                            gconstpointer data)
{
  const gchar *resp;
  GHashTable *headers;
  GError *error;

  cockpit_expect_message ("Returning error-response 500*");

  headers = cockpit_web_server_new_table ();
  g_hash_table_insert (headers, g_strdup ("Header1"), g_strdup ("value1"));

  error = g_error_new (G_IO_ERROR, G_IO_ERROR_FAILED, "Reason here: %s", "booyah");
  cockpit_web_response_gerror (tc->response, headers, error);

  g_error_free (error);
  g_hash_table_destroy (headers);

  resp = output_as_string (tc);
  cockpit_assert_strmatch(resp,"HTTP/1.1 500 Reason here: booyah\r*\n"
    "Header1: value1\r*\n"
    "\r\n");
}

static void
test_return_error_resource (TestCase *tc,
                            gconstpointer user_data)
{
  const gchar *roots[] = { srcdir, NULL };
  cockpit_web_failure_resource = "/org/cockpit-project/Cockpit/fail.html";
  cockpit_web_response_file (tc->response, "/non-existant", roots);
  cockpit_assert_strmatch (output_as_string (tc), "HTTP/1.1 404 Not Found*<img*Not Found*");
  cockpit_web_failure_resource = NULL;
}

static void
test_file_not_found (TestCase *tc,
                     gconstpointer user_data)
{
  const gchar *roots[] = { srcdir, NULL };
  cockpit_web_response_file (tc->response, "/non-existant", roots);
  cockpit_assert_strmatch (output_as_string (tc), "HTTP/1.1 404 Not Found*");
}

static void
test_file_directory_denied (TestCase *tc,
                            gconstpointer user_data)
{
  const gchar *roots[] = { srcdir, NULL };
  cockpit_web_response_file (tc->response, "/src", roots);
  cockpit_assert_strmatch (output_as_string (tc), "HTTP/1.1 403 Directory Listing Denied*");
}

static void
test_file_access_denied (TestCase *tc,
                         gconstpointer user_data)
{
  const gchar *roots[] = { "/tmp", NULL };
  gchar templ[] = "/tmp/test-temp.XXXXXX";

  if (!g_mkdtemp_full (templ, 0000))
    g_assert_not_reached ();

  cockpit_web_response_file (tc->response, templ + 4, roots);
  cockpit_assert_strmatch (output_as_string (tc), "HTTP/1.1 403*");

  g_unlink (templ);
}

static void
test_file_breakout_denied (TestCase *tc,
                           gconstpointer user_data)
{
  gchar *root = realpath ( SRCDIR "/src", NULL);
  const gchar *roots[] = { root, NULL };
  const gchar *breakout = "/../Makefile.am";
  gchar *check = g_build_filename (roots[0], breakout, NULL);
  g_assert (root);
  g_assert (g_file_test (check, G_FILE_TEST_EXISTS));
  g_free (check);
  cockpit_web_response_file (tc->response, breakout, roots);
  cockpit_assert_strmatch (output_as_string (tc), "HTTP/1.1 404*");
  free (root);
}

static void
test_file_breakout_non_existant (TestCase *tc,
                                 gconstpointer user_data)
{
  gchar *root = realpath ( SRCDIR "/src", NULL);
  const gchar *roots[] = { root, NULL };
  const gchar *breakout = "/../non-existant";
  gchar *check = g_build_filename (roots[0], breakout, NULL);
  g_assert (root);
  g_assert (!g_file_test (check, G_FILE_TEST_EXISTS));
  g_free (check);
  cockpit_web_response_file (tc->response, breakout, roots);
  cockpit_assert_strmatch (output_as_string (tc), "HTTP/1.1 404*");
  free (root);
}

static const TestFixture content_type_fixture = {
  .path = "/pkg/shell/index.html"
};

static void
test_content_type (TestCase *tc,
                   gconstpointer user_data)
{
  const gchar *roots[] = { srcdir, NULL };
  GHashTable *headers;
  const gchar *resp;
  gsize length;
  guint status;
  gssize off;

  g_assert (user_data == &content_type_fixture);

  cockpit_web_response_file (tc->response, NULL, roots);

  resp = output_as_string (tc);
  length = strlen (resp);

  off = web_socket_util_parse_status_line (resp, length, NULL, &status, NULL);
  g_assert_cmpuint (off, >, 0);
  g_assert_cmpint (status, ==, 200);

  off = web_socket_util_parse_headers (resp + off, length - off, &headers);
  g_assert_cmpuint (off, >, 0);

  g_assert_cmpstr (g_hash_table_lookup (headers, "Content-Type"), ==, "text/html");

  g_hash_table_unref (headers);
}

static const TestFixture template_fixture = {
  .path = "/test.css"
};

static void
test_template (TestCase *tc,
               gconstpointer user_data)
{
  const gchar *roots[] = { SRCDIR "/src/common/mock-content/", NULL };
  const gchar *resp;
  GHashTable *data = g_hash_table_new (g_str_hash, g_str_equal);

  g_hash_table_insert (data, "NAME", "test");
  g_hash_table_insert (data, "VARIANT", "VALUE");
  cockpit_web_response_template (tc->response, NULL, roots, data);

  resp = output_as_string (tc);
  g_assert_cmpstr (resp, ==, "HTTP/1.1 200 OK\r\nContent-Type: text/css\r\nTransfer-Encoding: chunked\r\n\r\n17\r\n#brand {\n    content: \"\r\n4\r\ntest\r\n4\r\n <b>\r\n5\r\nVALUE\r\n9\r\n</b>\";\n}\n\r\n0\r\n\r\n");
  g_hash_table_unref (data);
}

static const TestFixture cache_forever_fixture = {
  .path = "/pkg/shell/index.html",
  .cache = COCKPIT_WEB_RESPONSE_CACHE_FOREVER,
};

static const TestFixture cache_none_fixture = {
  .path = "/pkg/shell/index.html",
  .cache = COCKPIT_WEB_RESPONSE_NO_CACHE
};

static const TestFixture cache_private_fixture = {
  .path = "/pkg/shell/index.html",
  .cache = COCKPIT_WEB_RESPONSE_CACHE_PRIVATE
};

static const TestFixture cache_unset_fixture = {
  .path = "/pkg/shell/index.html",
  .cache = COCKPIT_WEB_RESPONSE_CACHE_UNSET
};

static void
test_cache (TestCase *tc,
            gconstpointer user_data)
{
  const TestFixture *fixture = user_data;
  const gchar *roots[] = { srcdir, NULL };
  GHashTable *headers;
  const gchar *resp;
  gsize length;
  guint status;
  gssize off;

  cockpit_web_response_set_cache_type (tc->response, fixture->cache);
  cockpit_web_response_file (tc->response, NULL, roots);

  resp = output_as_string (tc);
  length = strlen (resp);

  off = web_socket_util_parse_status_line (resp, length, NULL, &status, NULL);
  g_assert_cmpuint (off, >, 0);
  g_assert_cmpint (status, ==, 200);

  off = web_socket_util_parse_headers (resp + off, length - off, &headers);
  g_assert_cmpuint (off, >, 0);

  if (fixture->cache == COCKPIT_WEB_RESPONSE_CACHE_PRIVATE)
    g_assert_cmpstr (g_hash_table_lookup (headers, "Vary"), ==, "Cookie");
  else
    g_assert_null (g_hash_table_lookup (headers, "Vary"));

  if (fixture->cache == COCKPIT_WEB_RESPONSE_CACHE_FOREVER)
    g_assert_cmpstr (g_hash_table_lookup (headers, "Cache-Control"), ==, "max-age=31556926, public");
  else if (fixture->cache == COCKPIT_WEB_RESPONSE_NO_CACHE)
    g_assert_cmpstr (g_hash_table_lookup (headers, "Cache-Control"), ==, "no-cache, no-store");
  else if (fixture->cache == COCKPIT_WEB_RESPONSE_CACHE_PRIVATE)
    g_assert_cmpstr (g_hash_table_lookup (headers, "Cache-Control"), ==, "max-age=86400, private");
  else
    g_assert_null (g_hash_table_lookup (headers, "Cache-Control"));
  g_hash_table_unref (headers);
}

static void
test_content_encoding (TestCase *tc,
                       gconstpointer data)
{
  const gchar *resp;
  GBytes *content;

  g_assert_cmpint (cockpit_web_response_get_state (tc->response), ==, COCKPIT_WEB_RESPONSE_READY);

  cockpit_web_response_headers (tc->response, 200, "OK", 50,
                                "Content-Encoding", "blah",
                                NULL);

  g_assert_cmpint (cockpit_web_response_get_state (tc->response), ==, COCKPIT_WEB_RESPONSE_QUEUING);

  while (g_main_context_iteration (NULL, FALSE));

  content = g_bytes_new_static ("Cockpit is perfect for new sysadmins, ", 38);
  cockpit_web_response_queue (tc->response, content);
  g_bytes_unref (content);

  cockpit_web_response_complete (tc->response);

  g_assert_cmpint (cockpit_web_response_get_state (tc->response), ==, COCKPIT_WEB_RESPONSE_COMPLETE);

  resp = output_as_string (tc);
  g_assert_cmpint (cockpit_web_response_get_state (tc->response), ==, COCKPIT_WEB_RESPONSE_SENT);

  g_assert_cmpstr (resp, ==, "HTTP/1.1 200 OK\r\nContent-Encoding: blah\r\n"
                   "Content-Length: 50\r\nTransfer-Encoding: chunked\r\n\r\n"
                   "26\r\nCockpit is perfect for new sysadmins, \r\n0\r\n\r\n");
}

static void
test_stream (TestCase *tc,
             gconstpointer data)
{
  const gchar *resp;
  GBytes *content;

  g_assert_cmpint (cockpit_web_response_get_state (tc->response), ==, COCKPIT_WEB_RESPONSE_READY);

  cockpit_web_response_headers (tc->response, 200, "OK", 11, NULL);

  g_assert_cmpint (cockpit_web_response_get_state (tc->response), ==, COCKPIT_WEB_RESPONSE_QUEUING);

  while (g_main_context_iteration (NULL, FALSE));

  content = g_bytes_new_static ("the content", 11);
  cockpit_web_response_queue (tc->response, content);
  g_bytes_unref (content);

  g_assert_cmpint (cockpit_web_response_get_state (tc->response), ==, COCKPIT_WEB_RESPONSE_QUEUING);

  cockpit_web_response_complete (tc->response);

  g_assert_cmpint (cockpit_web_response_get_state (tc->response), ==, COCKPIT_WEB_RESPONSE_COMPLETE);

  resp = output_as_string (tc);
  g_assert_cmpint (cockpit_web_response_get_state (tc->response), ==, COCKPIT_WEB_RESPONSE_SENT);

  g_assert_cmpstr (resp, ==, "HTTP/1.1 200 OK\r\nContent-Length: 11\r\n\r\nthe content");
}

static void
test_chunked_transfer_encoding (TestCase *tc,
                                gconstpointer data)
{
  const gchar *resp;
  GBytes *content;

  g_assert_cmpint (cockpit_web_response_get_state (tc->response), ==, COCKPIT_WEB_RESPONSE_READY);

  cockpit_web_response_headers (tc->response, 200, "OK", -1, NULL);

  g_assert_cmpint (cockpit_web_response_get_state (tc->response), ==, COCKPIT_WEB_RESPONSE_QUEUING);

  while (g_main_context_iteration (NULL, FALSE));

  content = g_bytes_new_static ("Cockpit is perfect for new sysadmins, ", 38);
  cockpit_web_response_queue (tc->response, content);
  g_bytes_unref (content);

  content = g_bytes_new_static ("allowing them to easily perform simple tasks such as storage administration, ", 77);
  cockpit_web_response_queue (tc->response, content);
  g_bytes_unref (content);

  content = g_bytes_new_static ("inspecting journals and starting and stopping services.", 55);
  cockpit_web_response_queue (tc->response, content);
  g_bytes_unref (content);

  g_assert_cmpint (cockpit_web_response_get_state (tc->response), ==, COCKPIT_WEB_RESPONSE_QUEUING);

  cockpit_web_response_complete (tc->response);

  g_assert_cmpint (cockpit_web_response_get_state (tc->response), ==, COCKPIT_WEB_RESPONSE_COMPLETE);

  resp = output_as_string (tc);
  g_assert_cmpint (cockpit_web_response_get_state (tc->response), ==, COCKPIT_WEB_RESPONSE_SENT);

  g_assert_cmpstr (resp, ==, "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n"
                   "26\r\nCockpit is perfect for new sysadmins, \r\n"
                   "4d\r\nallowing them to easily perform simple tasks such as storage administration, \r\n"
                   "37\r\ninspecting journals and starting and stopping services.\r\n0\r\n\r\n");
}

static void
test_chunked_zero_length (TestCase *tc,
                          gconstpointer data)
{
  const gchar *resp;
  GBytes *content;

  g_assert_cmpint (cockpit_web_response_get_state (tc->response), ==, COCKPIT_WEB_RESPONSE_READY);

  cockpit_web_response_headers (tc->response, 200, "OK", -1, NULL);

  g_assert_cmpint (cockpit_web_response_get_state (tc->response), ==, COCKPIT_WEB_RESPONSE_QUEUING);

  while (g_main_context_iteration (NULL, FALSE));

  content = g_bytes_new_static ("Cockpit is perfect for new sysadmins, ", 38);
  cockpit_web_response_queue (tc->response, content);
  g_bytes_unref (content);

  content = g_bytes_new_static ("", 0);
  cockpit_web_response_queue (tc->response, content);
  g_bytes_unref (content);

  content = g_bytes_new_static ("inspecting journals and starting and stopping services.", 55);
  cockpit_web_response_queue (tc->response, content);
  g_bytes_unref (content);

  content = g_bytes_new_static ("", 0);
  cockpit_web_response_queue (tc->response, content);
  g_bytes_unref (content);

  g_assert_cmpint (cockpit_web_response_get_state (tc->response), ==, COCKPIT_WEB_RESPONSE_QUEUING);
  cockpit_web_response_complete (tc->response);

  g_assert_cmpint (cockpit_web_response_get_state (tc->response), ==, COCKPIT_WEB_RESPONSE_COMPLETE);

  resp = output_as_string (tc);
  g_assert_cmpint (cockpit_web_response_get_state (tc->response), ==, COCKPIT_WEB_RESPONSE_SENT);

  g_assert_cmpstr (resp, ==, "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n"
                   "26\r\nCockpit is perfect for new sysadmins, \r\n"
                   "37\r\ninspecting journals and starting and stopping services.\r\n0\r\n\r\n");
}

static GBytes *
bytes_static (const gchar *data)
{
  return g_bytes_new_static (data, strlen (data));
}

static void
test_web_filter_simple (TestCase *tc,
                        gconstpointer data)
{
  CockpitWebFilter *filter;
  const gchar *resp;
  GBytes *content;
  GBytes *inject;

  inject = bytes_static ("<meta inject>");
  filter = cockpit_web_inject_new ("<head>", inject, 1);
  cockpit_web_response_add_filter (tc->response, filter);
  g_object_unref (filter);
  g_bytes_unref (inject);

  content = bytes_static ("<html><head><title>The Title</title></head></html>");
  cockpit_web_response_content (tc->response, NULL, content, NULL);
  g_bytes_unref (content);

  while (cockpit_web_response_get_state (tc->response) != COCKPIT_WEB_RESPONSE_COMPLETE)
    g_main_context_iteration (NULL, TRUE);

  resp = output_as_string (tc);
  g_assert_cmpint (cockpit_web_response_get_state (tc->response), ==, COCKPIT_WEB_RESPONSE_SENT);

  g_assert_cmpstr (resp, ==, "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n"
                   "c\r\n<html><head>\r\n"
                   "d\r\n<meta inject>\r\n"
                   "26\r\n<title>The Title</title></head></html>\r\n"
                   "0\r\n\r\n");
}

static void
test_web_filter_multiple (TestCase *tc,
                          gconstpointer data)
{
  CockpitWebFilter *filter;
  const gchar *resp;
  GBytes *content;
  GBytes *inject;

  inject = bytes_static ("<meta inject>");
  filter = cockpit_web_inject_new ("<head>", inject, 1);
  cockpit_web_response_add_filter (tc->response, filter);
  g_object_unref (filter);
  g_bytes_unref (inject);

  inject = bytes_static ("<body>Body</body>");
  filter = cockpit_web_inject_new ("</head>", inject, 1);
  cockpit_web_response_add_filter (tc->response, filter);
  g_object_unref (filter);
  g_bytes_unref (inject);

  inject = bytes_static ("Prefix ");
  filter = cockpit_web_inject_new ("<title>", inject, 1);
  cockpit_web_response_add_filter (tc->response, filter);
  g_object_unref (filter);
  g_bytes_unref (inject);

  inject = bytes_static (" ");
  filter = cockpit_web_inject_new (">", inject, 3);
  cockpit_web_response_add_filter (tc->response, filter);
  g_object_unref (filter);
  g_bytes_unref (inject);

  content = bytes_static ("<html><head><title>The Title</title></head></html>");
  cockpit_web_response_content (tc->response, NULL, content, NULL);
  g_bytes_unref (content);

  while (cockpit_web_response_get_state (tc->response) != COCKPIT_WEB_RESPONSE_COMPLETE)
    g_main_context_iteration (NULL, TRUE);

  resp = output_as_string (tc);
  g_assert_cmpint (cockpit_web_response_get_state (tc->response), ==, COCKPIT_WEB_RESPONSE_SENT);

  g_assert_cmpstr (resp, ==, "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n"
                   "6\r\n<html>\r\n"
                   "1\r\n \r\n"
                   "6\r\n<head>\r\n"
                   "1\r\n \r\n"
                   "d\r\n<meta inject>\r\n"
                   "1\r\n \r\n"
                   "7\r\n<title>\r\n"
                   "7\r\nPrefix \r\n"
                   "18\r\nThe Title</title></head>\r\n"
                   "11\r\n<body>Body</body>\r\n"
                   "7\r\n</html>\r\n"
                   "0\r\n\r\n");
}

static void
test_web_filter_split (TestCase *tc,
                       gconstpointer data)
{
  CockpitWebFilter *filter;
  const gchar *string;
  const gchar *resp;
  GBytes *inject;
  GBytes *block;
  gsize i, x, len;

  inject = bytes_static ("<meta inject>");
  filter = cockpit_web_inject_new ("<head>", inject, 1);
  cockpit_web_response_add_filter (tc->response, filter);
  g_object_unref (filter);
  g_bytes_unref (inject);

  inject = bytes_static ("<body>Body</body>");
  filter = cockpit_web_inject_new ("</head>", inject, 1);
  cockpit_web_response_add_filter (tc->response, filter);
  g_object_unref (filter);
  g_bytes_unref (inject);

  inject = bytes_static ("Prefix ");
  filter = cockpit_web_inject_new ("<title>", inject, 1);
  cockpit_web_response_add_filter (tc->response, filter);
  g_object_unref (filter);
  g_bytes_unref (inject);

  cockpit_web_response_headers (tc->response, 200, "OK", -1, NULL);

  string = "<html><head><title>The Title</title></head></html>";
  len = strlen (string);

  for (i = 0, x = 1; i < len; i += x, x = 1 + (i % 4))
    {
      block = g_bytes_new_static (string + i, MIN (x, strlen (string + i)));
      g_assert (cockpit_web_response_queue (tc->response, block) == TRUE);
      g_bytes_unref (block);
    }

  cockpit_web_response_complete (tc->response);

  while (cockpit_web_response_get_state (tc->response) != COCKPIT_WEB_RESPONSE_COMPLETE)
    g_main_context_iteration (NULL, TRUE);

  resp = output_as_string (tc);
  g_assert_cmpint (cockpit_web_response_get_state (tc->response), ==, COCKPIT_WEB_RESPONSE_SENT);

  g_assert_cmpstr (resp, ==, "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n"
                   "1\r\n<\r\n"
                   "2\r\nht\r\n"
                   "4\r\nml><\r\n"
                   "4\r\nhead\r\n"
                   "1\r\n>\r\n"
                   "d\r\n<meta inject>\r\n"
                   "3\r\n<ti\r\n"
                   "4\r\ntle>\r\n"
                   "7\r\nPrefix \r\n"
                   "4\r\nThe \r\n"
                   "4\r\nTitl\r\n"
                   "4\r\ne</t\r\n"
                   "4\r\nitle\r\n"
                   "4\r\n></h\r\n"
                   "4\r\nead>\r\n"
                   "11\r\n<body>Body</body>\r\n"
                   "4\r\n</ht\r\n"
                   "3\r\nml>\r\n"
                   "0\r\n\r\n");
}

static void
test_web_filter_shift (TestCase *tc,
                       gconstpointer data)
{
  CockpitWebFilter *filter;
  const gchar *resp;
  GBytes *block;
  GBytes *inject;

  inject = bytes_static ("injected");
  filter = cockpit_web_inject_new ("foofn", inject, 1);
  cockpit_web_response_add_filter (tc->response, filter);
  g_object_unref (filter);
  g_bytes_unref (inject);

  cockpit_web_response_headers_full (tc->response, 200, "OK", -1, NULL);

  /* Total content is foofoofn and split after the first 4 characters */
  block = bytes_static ("foof");
  g_assert (cockpit_web_response_queue (tc->response, block) == TRUE);
  g_bytes_unref (block);
  block = bytes_static ("oofn");
  g_assert (cockpit_web_response_queue (tc->response, block) == TRUE);
  g_bytes_unref (block);
  cockpit_web_response_complete (tc->response);

  while (cockpit_web_response_get_state (tc->response) != COCKPIT_WEB_RESPONSE_COMPLETE)
    g_main_context_iteration (NULL, TRUE);

  resp = output_as_string (tc);
  g_assert_cmpint (cockpit_web_response_get_state (tc->response), ==, COCKPIT_WEB_RESPONSE_SENT);

  g_assert_cmpstr (resp, ==, "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n"
                   "4\r\nfoof\r\n"
                   "4\r\noofn\r\n"
                   "8\r\ninjected\r\n"
                   "0\r\n\r\n");
}

static void
test_web_filter_shift_three (TestCase *tc,
                             gconstpointer data)
{
  CockpitWebFilter *filter;
  const gchar *resp;
  GBytes *block;
  GBytes *inject;

  inject = bytes_static ("injected");
  filter = cockpit_web_inject_new ("foofn", inject, 1);
  cockpit_web_response_add_filter (tc->response, filter);
  g_object_unref (filter);
  g_bytes_unref (inject);

  cockpit_web_response_headers_full (tc->response, 200, "OK", -1, NULL);

  /* Total content is foofoofn and split across multiple packets after the first 4 characters */
  block = bytes_static ("foof");
  g_assert (cockpit_web_response_queue (tc->response, block) == TRUE);
  g_bytes_unref (block);
  block = bytes_static ("o");
  g_assert (cockpit_web_response_queue (tc->response, block) == TRUE);
  g_bytes_unref (block);
  block = bytes_static ("of");
  g_assert (cockpit_web_response_queue (tc->response, block) == TRUE);
  g_bytes_unref (block);
  block = bytes_static ("n");
  g_assert (cockpit_web_response_queue (tc->response, block) == TRUE);
  g_bytes_unref (block);
  cockpit_web_response_complete (tc->response);

  while (cockpit_web_response_get_state (tc->response) != COCKPIT_WEB_RESPONSE_COMPLETE)
    g_main_context_iteration (NULL, TRUE);

  resp = output_as_string (tc);
  g_assert_cmpint (cockpit_web_response_get_state (tc->response), ==, COCKPIT_WEB_RESPONSE_SENT);

  g_assert_cmpstr (resp, ==, "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n"
                   "4\r\nfoof\r\n"
                   "1\r\no\r\n"
                   "2\r\nof\r\n"
                   "1\r\nn\r\n"
                   "8\r\ninjected\r\n"
                   "0\r\n\r\n");
}

static void
test_web_filter_passthrough (TestCase *tc,
                             gconstpointer data)
{
  CockpitWebFilter *filter;
  const gchar *resp;
  GBytes *content;
  GBytes *inject;

  inject = bytes_static ("<meta inject>");
  filter = cockpit_web_inject_new ("<unknown>", inject, 1);
  cockpit_web_response_add_filter (tc->response, filter);
  g_object_unref (filter);
  g_bytes_unref (inject);

  content = bytes_static ("<html><head><title>The Title</title></head></html>");
  cockpit_web_response_content (tc->response, NULL, content, NULL);
  g_bytes_unref (content);

  while (cockpit_web_response_get_state (tc->response) != COCKPIT_WEB_RESPONSE_COMPLETE)
    g_main_context_iteration (NULL, TRUE);

  resp = output_as_string (tc);
  g_assert_cmpint (cockpit_web_response_get_state (tc->response), ==, COCKPIT_WEB_RESPONSE_SENT);

  g_assert_cmpstr (resp, ==, "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n"
                   "32\r\n<html><head><title>The Title</title></head></html>\r\n"
                   "0\r\n\r\n");
}

static void
on_response_done_not_resuable (CockpitWebResponse *response,
                               gboolean reusable,
                               gpointer user_data)
{
  g_assert (reusable == FALSE);
}

static void
test_abort (TestCase *tc,
            gconstpointer data)
{
  const gchar *resp;
  GBytes *content;

  cockpit_web_response_headers (tc->response, 200, "OK", 11, NULL);
  g_signal_connect (tc->response, "done", G_CALLBACK (on_response_done_not_resuable), NULL);

  while (g_main_context_iteration (NULL, FALSE));

  content = g_bytes_new_static ("the content", 11);
  cockpit_web_response_queue (tc->response, content);
  g_bytes_unref (content);

  cockpit_web_response_abort (tc->response);
  g_assert_cmpint (cockpit_web_response_get_state (tc->response), ==, COCKPIT_WEB_RESPONSE_SENT);

  resp = output_as_string (tc);

  g_assert_cmpstr (resp, ==, "HTTP/1.1 200 OK\r\nContent-Length: 11\r\n\r\n");
}

static const TestFixture fixture_connection_close = {
  .header = "Connection",
  .value = "close",
};

static void
test_connection_close (TestCase *tc,
                       gconstpointer data)
{
  const gchar *resp;
  GBytes *content;

  g_assert (data == &fixture_connection_close);

  g_signal_connect (tc->response, "done", G_CALLBACK (on_response_done_not_resuable), NULL);

  content = g_bytes_new_static ("the content", 11);
  cockpit_web_response_content (tc->response, NULL, content, NULL);
  g_bytes_unref (content);

  resp = output_as_string (tc);
  g_assert_cmpstr (resp, ==, "HTTP/1.1 200 OK\r\nContent-Length: 11\r\nConnection: close\r\n\r\nthe content");
}

typedef struct {
    GHashTable *headers;
    GIOStream *io;
} TestPlain;

static void
setup_plain (TestPlain *tc,
             gconstpointer unused)
{
  GInputStream *input;
  GOutputStream *output;

  input = g_memory_input_stream_new ();
  output = g_memory_output_stream_new (NULL, 0, g_realloc, g_free);

  tc->io = mock_io_stream_new (input, output);

  g_object_unref (input);
  g_object_unref (output);

  tc->headers = cockpit_web_server_new_table ();
}

static void
teardown_plain (TestPlain *tc,
                gconstpointer unused)
{
  g_object_unref (tc->io);
  g_hash_table_unref (tc->headers);
}

static void
test_pop_path (TestPlain *tc,
               gconstpointer unused)
{
  CockpitWebResponse *response;
  gchar *part;
  const gchar *start = "/cockpit/@localhost/another/test.html";

  response = cockpit_web_response_new (tc->io, start, start, NULL, tc->headers);
  g_assert_cmpstr (cockpit_web_response_get_path (response), ==, start);
  g_assert_cmpstr (cockpit_web_response_get_url_root (response), ==, NULL);

  part = cockpit_web_response_pop_path (response);
  g_assert_cmpstr (part, ==, "cockpit");
  g_assert_cmpstr (cockpit_web_response_get_path (response), ==, "/@localhost/another/test.html");
  g_free (part);

  part = cockpit_web_response_pop_path (response);
  g_assert_cmpstr (part, ==, "@localhost");
  g_assert_cmpstr (cockpit_web_response_get_path (response), ==, "/another/test.html");
  g_free (part);

  part = cockpit_web_response_pop_path (response);
  g_assert_cmpstr (part, ==, "another");
  g_assert_cmpstr (cockpit_web_response_get_path (response), ==, "/test.html");
  g_free (part);

  part = cockpit_web_response_pop_path (response);
  g_assert_cmpstr (part, ==, "test.html");
  g_assert_cmpstr (cockpit_web_response_get_path (response), ==, NULL);
  g_free (part);

  part = cockpit_web_response_pop_path (response);
  g_assert (part == NULL);
  g_assert (cockpit_web_response_get_path (response) == NULL);
  g_free (part);

  cockpit_web_response_abort (response);
  g_object_unref (response);
}

static void
test_pop_path_root (TestPlain *tc,
                    gconstpointer unused)
{
  CockpitWebResponse *response;
  gchar *part;

  response = cockpit_web_response_new (tc->io, "/", "/", NULL, tc->headers);
  g_assert_cmpstr (cockpit_web_response_get_path (response), ==, "/");

  part = cockpit_web_response_pop_path (response);
  g_assert_cmpstr (part, ==, NULL);
  g_assert_cmpstr (cockpit_web_response_get_path (response), ==, NULL);
  g_free (part);

  cockpit_web_response_abort (response);
  g_object_unref (response);
}

static void
test_skip_path (TestPlain *tc,
                gconstpointer unused)
{
  CockpitWebResponse *response;
  const gchar *start = "/cockpit/@localhost/another/test.html";

  response = cockpit_web_response_new (tc->io, start, start, NULL, tc->headers);
  g_assert_cmpstr (cockpit_web_response_get_path (response), ==, "/cockpit/@localhost/another/test.html");

  g_assert (cockpit_web_response_skip_path (response) == TRUE);
  g_assert_cmpstr (cockpit_web_response_get_path (response), ==, "/@localhost/another/test.html");

  g_assert (cockpit_web_response_skip_path (response) == TRUE);
  g_assert_cmpstr (cockpit_web_response_get_path (response), ==, "/another/test.html");

  g_assert (cockpit_web_response_skip_path (response) == TRUE);
  g_assert_cmpstr (cockpit_web_response_get_path (response), ==, "/test.html");

  g_assert (cockpit_web_response_skip_path (response) == TRUE);
  g_assert_cmpstr (cockpit_web_response_get_path (response), ==, NULL);

  g_assert (cockpit_web_response_skip_path (response) == FALSE);
  g_assert (cockpit_web_response_get_path (response) == NULL);

  cockpit_web_response_abort (response);
  g_object_unref (response);
}

static void
test_skip_path_root (TestPlain *tc,
                     gconstpointer unused)
{
  CockpitWebResponse *response;

  response = cockpit_web_response_new (tc->io, "/", "/", NULL, tc->headers);
  g_assert_cmpstr (cockpit_web_response_get_path (response), ==, "/");

  g_assert (cockpit_web_response_skip_path (response) == FALSE);
  g_assert_cmpstr (cockpit_web_response_get_path (response), ==, NULL);

  cockpit_web_response_abort (response);
  g_object_unref (response);
}

static void
test_removed_prefix (TestPlain *tc,
                     gconstpointer unused)
{
  CockpitWebResponse *response;

  response = cockpit_web_response_new (tc->io, "/", "/", NULL, tc->headers);
  g_assert_cmpstr (cockpit_web_response_get_path (response), ==, "/");
  g_assert_cmpstr (cockpit_web_response_get_url_root (response), ==, NULL);
  cockpit_web_response_abort (response);
  g_clear_object (&response);

  response = cockpit_web_response_new (tc->io, "/path/", "/path/", NULL, tc->headers);
  g_assert_cmpstr (cockpit_web_response_get_path (response), ==, "/path/");
  g_assert_cmpstr (cockpit_web_response_get_url_root (response), ==, NULL);
  cockpit_web_response_abort (response);
  g_clear_object (&response);

  response = cockpit_web_response_new (tc->io, "/path/path2/", "/path2/", NULL, tc->headers);
  g_assert_cmpstr (cockpit_web_response_get_path (response), ==, "/path2/");
  g_assert_cmpstr (cockpit_web_response_get_url_root (response), ==, "/path");
  cockpit_web_response_abort (response);
  g_clear_object (&response);

  response = cockpit_web_response_new (tc->io, "/mis/", "/match/", NULL, tc->headers);
  g_assert_cmpstr (cockpit_web_response_get_path (response), ==, "/match/");
  g_assert_cmpstr (cockpit_web_response_get_url_root (response), ==, NULL);
  cockpit_web_response_abort (response);
  g_clear_object (&response);

  response = cockpit_web_response_new (tc->io, NULL, NULL, NULL, tc->headers);
  g_assert_cmpstr (cockpit_web_response_get_path (response), ==, NULL);
  g_assert_cmpstr (cockpit_web_response_get_url_root (response), ==, NULL);
  cockpit_web_response_abort (response);
  g_clear_object (&response);
}

static void
test_gunzip_small (void)
{
  GError *error = NULL;
  GMappedFile *file;
  GBytes *compressed;
  GBytes *bytes;

  file = g_mapped_file_new (SRCDIR "/src/common/mock-content/test-file.txt.gz", FALSE, &error);
  g_assert_no_error (error);

  compressed = g_mapped_file_get_bytes (file);
  g_mapped_file_unref (file);

  bytes = cockpit_web_response_gunzip (compressed, &error);
  g_assert_no_error (error);
  g_bytes_unref (compressed);

  cockpit_assert_bytes_eq (bytes, "A small test file\n", -1);
  g_bytes_unref (bytes);
}

static void
test_gunzip_large (void)
{
  GError *error = NULL;
  GMappedFile *file;
  GBytes *compressed;
  GBytes *bytes;
  gchar *checksum;

  file = g_mapped_file_new (SRCDIR "/src/common/mock-content/large.min.js.gz", FALSE, &error);
  g_assert_no_error (error);

  compressed = g_mapped_file_get_bytes (file);
  g_mapped_file_unref (file);

  bytes = cockpit_web_response_gunzip (compressed, &error);
  g_assert_no_error (error);
  g_bytes_unref (compressed);

  checksum = g_compute_checksum_for_bytes (G_CHECKSUM_MD5, bytes);
  g_assert_cmpstr (checksum, ==, "5ca7582261c421482436dfdf3af9bffe");
  g_free (checksum);

  g_bytes_unref (bytes);
}

static void
test_gunzip_invalid (void)
{
  GError *error = NULL;
  GBytes *compressed;
  GBytes *bytes;

  compressed = g_bytes_new_static ("invalid", 7);

  bytes = cockpit_web_response_gunzip (compressed, &error);
  g_assert (bytes == NULL);
  g_assert_error (error, G_IO_ERROR, G_IO_ERROR_INVALID_DATA);
  g_error_free (error);

  g_bytes_unref (compressed);
}

static void
test_negotiation_first (void)
{
  gchar *chosen = NULL;
  GError *error = NULL;
  GBytes *bytes;

  bytes = cockpit_web_response_negotiation (SRCDIR "/src/common/mock-content/test-file.txt",
                                            NULL, NULL, &chosen, &error);

  cockpit_assert_bytes_eq (bytes, "A small test file\n", -1);
  g_assert_no_error (error);
  g_bytes_unref (bytes);

  g_assert_cmpstr (chosen, ==, SRCDIR "/src/common/mock-content/test-file.txt");
  g_free (chosen);
}

static void
test_negotiation_last (void)
{
  gchar *chosen = NULL;
  GError *error = NULL;
  gchar *checksum;
  GBytes *bytes;

  bytes = cockpit_web_response_negotiation (SRCDIR "/src/common/mock-content/large.js",
                                            NULL, NULL, &chosen, &error);

  g_assert_no_error (error);
  g_assert_cmpstr (chosen, ==, SRCDIR "/src/common/mock-content/large.min.js.gz");
  g_free (chosen);

  checksum = g_compute_checksum_for_bytes (G_CHECKSUM_MD5, bytes);
  g_assert_cmpstr (checksum, ==, "e5284b625b7665fc04e082827de3436c");
  g_free (checksum);

  g_bytes_unref (bytes);
}

static void
test_negotiation_prune (void)
{
  gchar *chosen = NULL;
  GError *error = NULL;
  GBytes *bytes;

  bytes = cockpit_web_response_negotiation (SRCDIR "/src/common/mock-content/test-file.extra.extension.txt",
                                            NULL, NULL, &chosen, &error);

  cockpit_assert_bytes_eq (bytes, "A small test file\n", -1);
  g_assert_no_error (error);
  g_bytes_unref (bytes);

  g_assert_cmpstr (chosen, ==, SRCDIR "/src/common/mock-content/test-file.txt");
  g_free (chosen);
}

static void
test_negotiation_with_listing (void)
{
  GHashTable *existing;
  GError *error = NULL;
  GBytes *bytes;

  /* Lie and say that only the .gz file exists */
  existing = g_hash_table_new (g_str_hash, g_str_equal);
  g_hash_table_add (existing, SRCDIR "/src/common/mock-content/test-file.txt.gz");

  bytes = cockpit_web_response_negotiation (SRCDIR "/src/common/mock-content/test-file.txt",
                                            existing, NULL, NULL, &error);

  cockpit_assert_bytes_eq (bytes, "\x1F\x8B\x08\x08N1\x03U\x00\x03test-file.txt\x00"
                           "sT(\xCEM\xCC\xC9Q(I-.QH\xCB\xCCI\xE5\x02\x00>PjG\x12\x00\x00\x00", 52);
  g_assert_no_error (error);
  g_bytes_unref (bytes);

  g_hash_table_unref (existing);
}

static void
test_negotiation_locale (void)
{
  gchar *chosen = NULL;
  GError *error = NULL;
  GBytes *bytes;

  bytes = cockpit_web_response_negotiation (SRCDIR "/src/common/mock-content/test-file.txt",
                                            NULL, "zh-cn", &chosen, &error);

  cockpit_assert_bytes_eq (bytes, "A translated test file\n", -1);
  g_assert_no_error (error);
  g_bytes_unref (bytes);

  g_assert_cmpstr (chosen, ==, SRCDIR "/src/common/mock-content/test-file.zh_CN.txt");
  g_free (chosen);
}

static void
test_negotiation_notfound (void)
{
  gchar *chosen = NULL;
  GError *error = NULL;
  GBytes *bytes;

  bytes = cockpit_web_response_negotiation (SRCDIR "/src/common/mock-content/non-existant",
                                            NULL, NULL, &chosen, &error);

  g_assert_no_error (error);
  g_assert (bytes == NULL);

  g_assert (chosen == NULL);
}

static void
test_negotiation_failure (void)
{
  gchar *chosen = NULL;
  GError *error = NULL;
  GBytes *bytes;

  bytes = cockpit_web_response_negotiation (SRCDIR "/src/common/mock-content/directory",
                                            NULL, NULL, &chosen, &error);

  g_assert (error != NULL);
  g_error_free (error);

  g_assert (bytes == NULL);

  g_assert (chosen == NULL);
}

int
main (int argc,
      char *argv[])
{
  gint ret;

  srcdir = realpath (SRCDIR, NULL);
  g_assert (srcdir != NULL);

  cockpit_test_init (&argc, &argv);

  g_test_add ("/web-response/return-content", TestCase, NULL,
              setup, test_return_content, teardown);
  g_test_add ("/web-response/return-content-headers", TestCase, NULL,
              setup, test_return_content_headers, teardown);
  g_test_add ("/web-response/return-error", TestCase, NULL,
              setup, test_return_error, teardown);
  g_test_add ("/web-response/return-error-headers", TestCase, NULL,
              setup, test_return_error_headers, teardown);
  g_test_add ("/web-response/return-gerror-headers", TestCase, NULL,
              setup, test_return_gerror_headers, teardown);
  g_test_add ("/web-response/return-error-resource", TestCase, NULL,
              setup, test_return_error_resource, teardown);
  g_test_add ("/web-response/file/not-found", TestCase, NULL,
              setup, test_file_not_found, teardown);
  g_test_add ("/web-response/file/directory-denied", TestCase, NULL,
              setup, test_file_directory_denied, teardown);
  g_test_add ("/web-response/file/access-denied", TestCase, NULL,
              setup, test_file_access_denied, teardown);
  g_test_add ("/web-response/file/breakout-denied", TestCase, NULL,
              setup, test_file_breakout_denied, teardown);
  g_test_add ("/web-response/file/breakout-non-existant", TestCase, NULL,
              setup, test_file_breakout_non_existant, teardown);
  g_test_add ("/web-reponse/file/template", TestCase, &template_fixture,
              setup, test_template, teardown);
  g_test_add ("/web-response/content-type", TestCase, &content_type_fixture,
              setup, test_content_type, teardown);
  g_test_add ("/web-response/content-encoding", TestCase, NULL,
              setup, test_content_encoding, teardown);
  g_test_add ("/web-response/stream", TestCase, NULL,
              setup, test_stream, teardown);
  g_test_add ("/web-response/chunked-transfer-encoding", TestCase, NULL,
              setup, test_chunked_transfer_encoding, teardown);
  g_test_add ("/web-response/chunked-zero-length", TestCase, NULL,
              setup, test_chunked_zero_length, teardown);
  g_test_add ("/web-response/abort", TestCase, NULL,
              setup, test_abort, teardown);
  g_test_add ("/web-response/connection-close", TestCase, &fixture_connection_close,
              setup, test_connection_close, teardown);

  g_test_add ("/web-response/cache-forever", TestCase, &cache_forever_fixture,
              setup, test_cache, teardown);
  g_test_add ("/web-response/cache-private", TestCase, &cache_private_fixture,
              setup, test_cache, teardown);
  g_test_add ("/web-response/cache-none", TestCase, &cache_none_fixture,
              setup, test_cache, teardown);
  g_test_add ("/web-response/cache-unset", TestCase, &cache_unset_fixture,
              setup, test_cache, teardown);

  g_test_add ("/web-response/filter/simple", TestCase, NULL,
              setup, test_web_filter_simple, teardown);
  g_test_add ("/web-response/filter/multiple", TestCase, NULL,
              setup, test_web_filter_multiple, teardown);
  g_test_add ("/web-response/filter/passthrough", TestCase, NULL,
              setup, test_web_filter_passthrough, teardown);
  g_test_add ("/web-response/filter/split", TestCase, NULL,
              setup, test_web_filter_split, teardown);
  g_test_add ("/web-response/filter/shift", TestCase, NULL,
              setup, test_web_filter_shift, teardown);
  g_test_add ("/web-response/filter/shift_three", TestCase, NULL,
              setup, test_web_filter_shift_three, teardown);

  g_test_add ("/web-response/path/pop", TestPlain, NULL,
              setup_plain, test_pop_path, teardown_plain);
  g_test_add ("/web-response/path/pop-root", TestPlain, NULL,
              setup_plain, test_pop_path_root, teardown_plain);
  g_test_add ("/web-response/path/skip", TestPlain, NULL,
              setup_plain, test_skip_path, teardown_plain);
  g_test_add ("/web-response/path/skip-root", TestPlain, NULL,
              setup_plain, test_skip_path_root, teardown_plain);
  g_test_add ("/web-response/path/removed-prefix", TestPlain, NULL,
              setup_plain, test_removed_prefix, teardown_plain);

  g_test_add_func ("/web-response/gunzip/small", test_gunzip_small);
  g_test_add_func ("/web-response/gunzip/large", test_gunzip_large);
  g_test_add_func ("/web-response/gunzip/invalid", test_gunzip_invalid);

  g_test_add_func ("/web-response/negotiation/first", test_negotiation_first);
  g_test_add_func ("/web-response/negotiation/last", test_negotiation_last);
  g_test_add_func ("/web-response/negotiation/locale", test_negotiation_locale);
  g_test_add_func ("/web-response/negotiation/prune", test_negotiation_prune);
  g_test_add_func ("/web-response/negotiation/with-listing", test_negotiation_with_listing);
  g_test_add_func ("/web-response/negotiation/notfound", test_negotiation_notfound);
  g_test_add_func ("/web-response/negotiation/failure", test_negotiation_failure);

  ret = g_test_run ();

  free (srcdir);

  return ret;
}
