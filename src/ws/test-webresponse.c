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

#include "cockpitwebresponse.h"
#include "cockpitwebserver.h"

#include "mock-io-stream.h"

#include "cockpit/cockpittest.h"

#include "websocket/websocket.h"

#include <glib/gstdio.h>

#include <string.h>

typedef struct {
    CockpitWebResponse *response;
    GString *scratch;
    GOutputStream *output;
} TestCase;

typedef struct {
    const gchar *path;
} TestFixture;

static void
setup (TestCase *tc,
       gconstpointer data)
{
  const TestFixture *fixture = data;
  const gchar *path = NULL;
  GInputStream *input;
  GIOStream *io;

  if (fixture)
    path = fixture->path;

  tc->scratch = g_string_new ("");
  input = g_memory_input_stream_new ();
  tc->output = mock_output_stream_new (tc->scratch);
  io = mock_io_stream_new (input, tc->output);
  g_object_unref (input);

  tc->response = cockpit_web_response_new (io, path);
  g_object_unref (io);
}

static void
teardown (TestCase *tc,
          gconstpointer data)
{
  cockpit_assert_expected ();

  g_clear_object (&tc->output);
  g_clear_object (&tc->response);
}

static const gchar *
output_as_string (TestCase *tc)
{
  while (!g_output_stream_is_closed (tc->output))
    g_main_context_iteration (NULL, TRUE);
  return tc->scratch->str;
}

static void
test_get_stream (TestCase *tc,
                 gconstpointer data)
{
  g_assert (MOCK_IS_IO_STREAM (cockpit_web_response_get_stream (tc->response)));
  cockpit_web_response_complete (tc->response);
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
  g_assert_cmpstr (resp, ==, "HTTP/1.1 200 OK\r\nContent-Length: 11\r\nConnection: close\r\n\r\nthe content");
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
  g_assert_cmpstr (resp, ==, "HTTP/1.1 200 OK\r\nMy-header: my-value\r\nContent-Length: 11\r\nConnection: close\r\n\r\nthe content");
}

static void
test_return_error (TestCase *tc,
                   gconstpointer data)
{
  const gchar *resp;

  cockpit_web_response_error (tc->response, 500, NULL, "Reason here: %s", "booyah");

  resp = output_as_string (tc);
  g_assert_cmpstr (resp, ==,
    "HTTP/1.1 500 Reason here: booyah\r\nContent-Length: 96\r\nConnection: close\r\n\r\n<html><head><title>500 Reason here: booyah</title></head><body>Reason here: booyah</body></html>");
}

static void
test_return_error_auto (TestCase *tc,
                        gconstpointer data)
{
  const gchar *resp;

  cockpit_web_response_error (tc->response, 500, NULL, NULL);

  resp = output_as_string (tc);
  g_assert_cmpstr (resp, ==,
    "HTTP/1.1 500 Internal Server Error\r\nContent-Length: 100\r\nConnection: close\r\n\r\n<html><head><title>500 Internal Server Error</title></head><body>Internal Server Error</body></html>");
}

static void
test_return_error_unknown (TestCase *tc,
                           gconstpointer data)
{
  const gchar *resp;

  cockpit_web_response_error (tc->response, 501, NULL, NULL);

  resp = output_as_string (tc);
  g_assert_cmpstr (resp, ==,
    "HTTP/1.1 501 Failed\r\nContent-Length: 70\r\nConnection: close\r\n\r\n<html><head><title>501 Failed</title></head><body>Failed</body></html>");
}

static void
test_return_error_headers (TestCase *tc,
                           gconstpointer data)
{
  const gchar *resp;
  GHashTable *headers;

  headers = g_hash_table_new (g_str_hash, g_str_equal);
  g_hash_table_insert (headers, "Header1", "value1");

  cockpit_web_response_error (tc->response, 500, headers, "Reason here: %s", "booyah");

  g_hash_table_destroy (headers);

  resp = output_as_string (tc);
  g_assert_cmpstr (resp, ==,
    "HTTP/1.1 500 Reason here: booyah\r\nHeader1: value1\r\nContent-Length: 96\r\nConnection: close\r\n\r\n<html><head><title>500 Reason here: booyah</title></head><body>Reason here: booyah</body></html>");
}

static void
test_return_gerror_headers (TestCase *tc,
                            gconstpointer data)
{
  const gchar *resp;
  GHashTable *headers;
  GError *error;

  headers = g_hash_table_new (g_str_hash, g_str_equal);
  g_hash_table_insert (headers, "Header1", "value1");

  error = g_error_new (G_IO_ERROR, G_IO_ERROR_FAILED, "Reason here: %s", "booyah");
  cockpit_web_response_gerror (tc->response, headers, error);

  g_error_free (error);
  g_hash_table_destroy (headers);

  resp = output_as_string (tc);
  g_assert_cmpstr (resp, ==,
    "HTTP/1.1 500 Reason here: booyah\r\nHeader1: value1\r\nContent-Length: 96\r\nConnection: close\r\n\r\n<html><head><title>500 Reason here: booyah</title></head><body>Reason here: booyah</body></html>");
}

static void
test_file_not_found (TestCase *tc,
                     gconstpointer user_data)
{
  const gchar *roots[] = { BUILDDIR, NULL };
  cockpit_web_response_file (tc->response, "/non-existant", roots);
  cockpit_assert_strmatch (output_as_string (tc), "HTTP/1.1 404 Not Found*");
}

static void
test_file_directory_denied (TestCase *tc,
                            gconstpointer user_data)
{
  const gchar *roots[] = { BUILDDIR, NULL };
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
  const gchar *roots[] = { BUILDDIR "/src", NULL };
  const gchar *breakout = "/../dbus-test.html";
  gchar *check = g_build_filename (roots[0], breakout, NULL);
  g_assert (g_file_test (check, G_FILE_TEST_EXISTS));
  g_free (check);
  cockpit_web_response_file (tc->response, breakout, roots);
  cockpit_assert_strmatch (output_as_string (tc), "HTTP/1.1 404*");
}

static void
test_file_breakout_non_existant (TestCase *tc,
                                 gconstpointer user_data)
{
  const gchar *roots[] = { BUILDDIR "/src", NULL };
  const gchar *breakout = "/../non-existant";
  gchar *check = g_build_filename (roots[0], breakout, NULL);
  g_assert (!g_file_test (check, G_FILE_TEST_EXISTS));
  g_free (check);
  cockpit_web_response_file (tc->response, breakout, roots);
  cockpit_assert_strmatch (output_as_string (tc), "HTTP/1.1 404*");
}

static const TestFixture content_type_fixture = {
  .path = "/dbus-test.html"
};

static void
test_content_type (TestCase *tc,
                   gconstpointer user_data)
{
  GHashTable *headers;
  const gchar *resp;
  gsize length;
  guint status;
  gssize off;

  g_assert (user_data == &content_type_fixture);

  cockpit_web_response_headers (tc->response, 200, "OK", -1, NULL);
  cockpit_web_response_complete (tc->response);

  resp = output_as_string (tc);
  length = strlen (resp);

  off = web_socket_util_parse_status_line (resp, length, &status, NULL);
  g_assert_cmpuint (off, >, 0);
  g_assert_cmpint (status, ==, 200);

  off = web_socket_util_parse_headers (resp + off, length - off, &headers);
  g_assert_cmpuint (off, >, 0);

  g_assert_cmpstr (g_hash_table_lookup (headers, "Content-Type"), ==, "text/html");

  g_hash_table_unref (headers);
}

static void
test_content_type_override (TestCase *tc,
                            gconstpointer user_data)
{
  GHashTable *headers;
  const gchar *resp;
  gsize length;
  guint status;
  gssize off;

  g_assert (user_data == &content_type_fixture);

  cockpit_web_response_headers (tc->response, 200, "OK", -1,
                                "Content-Type", "test/type",
                                NULL);
  cockpit_web_response_complete (tc->response);

  resp = output_as_string (tc);
  length = strlen (resp);

  off = web_socket_util_parse_status_line (resp, length, &status, NULL);
  g_assert_cmpuint (off, >, 0);
  g_assert_cmpint (status, ==, 200);

  off = web_socket_util_parse_headers (resp + off, length - off, &headers);
  g_assert_cmpuint (off, >, 0);

  g_assert_cmpstr (g_hash_table_lookup (headers, "Content-Type"), ==, "test/type");

  g_hash_table_unref (headers);
}

static void
test_dispose_early (TestCase *tc,
                    gconstpointer data)
{
  GBytes *block;

  block = g_bytes_new_static ("blah", 4);
  cockpit_web_response_queue (tc->response, block);
  g_bytes_unref (block);

  cockpit_expect_critical ("*freed without being completed properly*");

  g_object_unref (tc->response);
  tc->response = NULL;
}

static void
test_write_fail (TestCase *tc,
                 gconstpointer data)
{
  GBytes *block;

  mock_output_stream_fail (MOCK_OUTPUT_STREAM (tc->output),
                           g_error_new (G_IO_ERROR, G_IO_ERROR_FAILED, "Oh marmalade"),
                           NULL, NULL);

  block = g_bytes_new_static ("blah", 4);

  /* Queing the first block should be okay */
  if (!cockpit_web_response_queue (tc->response, block))
    g_assert_not_reached ();

  cockpit_expect_warning ("*Oh marmalade");

  /* Wait for the error to happen */
  while (!g_output_stream_is_closed (tc->output))
    g_main_context_iteration (NULL, FALSE);

  cockpit_assert_expected ();

  /* Should return FALSE */
  if (cockpit_web_response_queue (tc->response, block))
    g_assert_not_reached ();

  cockpit_web_response_complete (tc->response);

  g_bytes_unref (block);
}

static void
test_write_disconnect (TestCase *tc,
                       gconstpointer data)
{
  GBytes *block;

  /* An error that should be ignored */
  mock_output_stream_fail (MOCK_OUTPUT_STREAM (tc->output),
                           g_error_new (G_IO_ERROR, G_IO_ERROR_BROKEN_PIPE, "Oh marmalade"),
                           NULL, NULL);

  block = g_bytes_new_static ("blah", 4);

  /* Queing the first block should be okay */
  if (!cockpit_web_response_queue (tc->response, block))
    g_assert_not_reached ();

  /* Wait for the error to happen */
  while (!g_output_stream_is_closed (tc->output))
    g_main_context_iteration (NULL, FALSE);

  /* Should return FALSE */
  if (cockpit_web_response_queue (tc->response, block))
    g_assert_not_reached ();

  g_bytes_unref (block);
}

static void
test_write_again (TestCase *tc,
                  gconstpointer data)
{
  GBytes *block;

  /* An error that should be ignored */
  mock_output_stream_fail (MOCK_OUTPUT_STREAM (tc->output),
                           g_error_new (G_IO_ERROR, G_IO_ERROR_WOULD_BLOCK, "Oh marmalade"),
                           NULL, NULL);

  block = g_bytes_new_static ("blah", 4);

  /* Queing the first block should be okay */
  if (!cockpit_web_response_queue (tc->response, block))
    g_assert_not_reached ();

  /* Lets just drain that */
  while (g_main_context_iteration (NULL, FALSE));

  /* Should not return FALSE */
  if (!cockpit_web_response_queue (tc->response, block))
    g_assert_not_reached ();

  cockpit_web_response_complete (tc->response);
  g_bytes_unref (block);

  g_assert_cmpstr (output_as_string (tc), ==, "blahblah");
}

static void
test_write_zero (TestCase *tc,
                  gconstpointer data)
{
  GBytes *block;
  GBytes *zero;

  /* An error that should be ignored */
  mock_output_stream_fail (MOCK_OUTPUT_STREAM (tc->output),
                           g_error_new (G_IO_ERROR, G_IO_ERROR_WOULD_BLOCK, "Oh marmalade"),
                           NULL, NULL);

  block = g_bytes_new_static ("blah", 4);
  zero = g_bytes_new_static ("", 0);

  /* Queing the first block should be okay */
  if (!cockpit_web_response_queue (tc->response, block))
    g_assert_not_reached ();

  /* Lets just drain that */
  while (g_main_context_iteration (NULL, FALSE));

  if (!cockpit_web_response_queue (tc->response, zero) ||
      !cockpit_web_response_queue (tc->response, block))
    g_assert_not_reached ();

  cockpit_web_response_complete (tc->response);
  g_bytes_unref (block);

  g_assert_cmpstr (output_as_string (tc), ==, "blahblah");
}

static void
test_flush_fail (TestCase *tc,
                 gconstpointer data)
{
  GBytes *block;

  mock_output_stream_fail (MOCK_OUTPUT_STREAM (tc->output), NULL,
                           g_error_new (G_IO_ERROR, G_IO_ERROR_FAILED, "Oh marmalade"),
                           NULL);

  block = g_bytes_new_static ("blah", 4);

  if (!cockpit_web_response_queue (tc->response, block))
    g_assert_not_reached ();

  g_bytes_unref (block);

  cockpit_web_response_complete (tc->response);

  cockpit_expect_warning ("*couldn't flush web output: Oh marmalade");

  /* Wait for the error to happen */
  while (!g_output_stream_is_closed (tc->output))
    g_main_context_iteration (NULL, FALSE);

  cockpit_assert_expected ();
}

static void
test_close_fail (TestCase *tc,
                 gconstpointer data)
{
  GBytes *block;

  mock_output_stream_fail (MOCK_OUTPUT_STREAM (tc->output), NULL, NULL,
                           g_error_new (G_IO_ERROR, G_IO_ERROR_FAILED, "Oh marmalade"));

  block = g_bytes_new_static ("blah", 4);

  if (!cockpit_web_response_queue (tc->response, block))
    g_assert_not_reached ();

  g_bytes_unref (block);

  cockpit_web_response_complete (tc->response);

  cockpit_expect_warning ("*couldn't close web output: Oh marmalade");

  /* Wait for the error to happen */
  while (!g_output_stream_is_closed (tc->output))
    g_main_context_iteration (NULL, FALSE);

  cockpit_assert_expected ();
}

int
main (int argc,
      char *argv[])
{
  cockpit_test_init (&argc, &argv);

  g_test_add ("/web-response/get-stream", TestCase, NULL,
              setup, test_get_stream, teardown);
  g_test_add ("/web-response/return-content", TestCase, NULL,
              setup, test_return_content, teardown);
  g_test_add ("/web-response/return-content-headers", TestCase, NULL,
              setup, test_return_content_headers, teardown);
  g_test_add ("/web-response/return-error", TestCase, NULL,
              setup, test_return_error, teardown);
  g_test_add ("/web-response/return-error/auto", TestCase, NULL,
              setup, test_return_error_auto, teardown);
  g_test_add ("/web-response/return-error/unknown", TestCase, NULL,
              setup, test_return_error_unknown, teardown);
  g_test_add ("/web-response/return-error-headers", TestCase, NULL,
              setup, test_return_error_headers, teardown);
  g_test_add ("/web-response/return-gerror-headers", TestCase, NULL,
              setup, test_return_gerror_headers, teardown);
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
  g_test_add ("/web-response/content-type/auto", TestCase, &content_type_fixture,
              setup, test_content_type, teardown);
  g_test_add ("/web-response/content-type/override", TestCase, &content_type_fixture,
              setup, test_content_type_override, teardown);
  g_test_add ("/web-response/dispose-early", TestCase, NULL,
              setup, test_dispose_early, teardown);
  g_test_add ("/web-response/write-zero", TestCase, NULL,
              setup, test_write_zero, teardown);
  g_test_add ("/web-response/write-again", TestCase, NULL,
              setup, test_write_again, teardown);
  g_test_add ("/web-response/write-fail", TestCase, NULL,
              setup, test_write_fail, teardown);
  g_test_add ("/web-response/write-disconnect", TestCase, NULL,
              setup, test_write_disconnect, teardown);
  g_test_add ("/web-response/flush-fail", TestCase, NULL,
              setup, test_flush_fail, teardown);
  g_test_add ("/web-response/close-fail", TestCase, NULL,
              setup, test_close_fail, teardown);

  return g_test_run ();
}
