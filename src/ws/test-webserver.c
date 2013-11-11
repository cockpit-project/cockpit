/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013 Red Hat, Inc.
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

#include "cockpitwebserver.h"

#include <string.h>

static void
test_table (void)
{
  GHashTable *table;

  table = cockpit_web_server_new_table ();

  /* Case insensitive keys */
  g_hash_table_insert (table, g_strdup ("Blah"), g_strdup ("value"));
  g_hash_table_insert (table, g_strdup ("blah"), g_strdup ("another"));
  g_hash_table_insert (table, g_strdup ("Different"), g_strdup ("One"));

  g_assert_cmpstr (g_hash_table_lookup (table, "BLAH"), ==, "another");
  g_assert_cmpstr (g_hash_table_lookup (table, "differeNT"), ==, "One");

  g_hash_table_destroy (table);
}

static void
test_return_content (void)
{
  GOutputStream *out;
  const gchar *data;

  out = g_memory_output_stream_new (NULL, 0, g_realloc, g_free);

  cockpit_web_server_return_content (out, NULL, "the content", 11);

  /* Null terminate because g_assert_cmpstr() */
  g_assert (g_output_stream_write (out, "\0", 1, NULL, NULL) == 1);

  data = g_memory_output_stream_get_data (G_MEMORY_OUTPUT_STREAM (out));
  g_assert_cmpstr (data, ==, "HTTP/1.1 200 OK\r\nContent-Length: 11\r\nConnection: close\r\n\r\nthe content");

  g_object_unref (out);
}

static void
test_return_content_headers (void)
{
  GOutputStream *out;
  const gchar *data;
  GHashTable *headers;

  headers = cockpit_web_server_new_table ();
  g_hash_table_insert (headers, g_strdup ("My-header"), g_strdup ("my-value"));

  out = g_memory_output_stream_new (NULL, 0, g_realloc, g_free);

  cockpit_web_server_return_content (out, headers, "the content", 11);
  g_hash_table_destroy (headers);

  /* Null terminate because g_assert_cmpstr() */
  g_assert (g_output_stream_write (out, "\0", 1, NULL, NULL) == 1);

  data = g_memory_output_stream_get_data (G_MEMORY_OUTPUT_STREAM (out));
  g_assert_cmpstr (data, ==, "HTTP/1.1 200 OK\r\nContent-Length: 11\r\nConnection: close\r\nMy-header: my-value\r\n\r\nthe content");

  g_object_unref (out);
}


static void
test_return_error (void)
{
  GOutputStream *out;
  const gchar *data;

  out = g_memory_output_stream_new (NULL, 0, g_realloc, g_free);

  cockpit_web_server_return_error (out, 500, NULL, "Reason here: %s", "booyah");

  /* Null terminate it for fun */
  g_assert (g_output_stream_write (out, "\0", 1, NULL, NULL) == 1);

  data = g_memory_output_stream_get_data (G_MEMORY_OUTPUT_STREAM (out));
  g_assert_cmpstr (data, ==,
    "HTTP/1.1 500 Reason here: booyah\r\nContent-Length: 96\r\nConnection: close\r\n\r\n<html><head><title>500 Reason here: booyah</title></head><body>Reason here: booyah</body></html>");

  g_object_unref (out);
}

static void
test_return_error_headers (void)
{
  GOutputStream *out;
  const gchar *data;
  GHashTable *headers;

  out = g_memory_output_stream_new (NULL, 0, g_realloc, g_free);

  headers = g_hash_table_new (g_str_hash, g_str_equal);
  g_hash_table_insert (headers, "Header1", "value1");

  cockpit_web_server_return_error (out, 500, headers, "Reason here: %s", "booyah");

  g_hash_table_destroy (headers);

  /* Null terminate it for fun */
  g_assert (g_output_stream_write (out, "\0", 1, NULL, NULL) == 1);

  data = g_memory_output_stream_get_data (G_MEMORY_OUTPUT_STREAM (out));
  g_assert_cmpstr (data, ==,
    "HTTP/1.1 500 Reason here: booyah\r\nContent-Length: 96\r\nConnection: close\r\nHeader1: value1\r\n\r\n<html><head><title>500 Reason here: booyah</title></head><body>Reason here: booyah</body></html>");

  g_object_unref (out);
}

static void
test_return_gerror_headers (void)
{
  GOutputStream *out;
  const gchar *data;
  GHashTable *headers;
  GError *error;

  out = g_memory_output_stream_new (NULL, 0, g_realloc, g_free);

  headers = g_hash_table_new (g_str_hash, g_str_equal);
  g_hash_table_insert (headers, "Header1", "value1");

  error = g_error_new (G_IO_ERROR, G_IO_ERROR_FAILED, "Reason here: %s", "booyah");
  cockpit_web_server_return_gerror (out, headers, error);

  g_error_free (error);
  g_hash_table_destroy (headers);

  /* Null terminate it for fun */
  g_assert (g_output_stream_write (out, "\0", 1, NULL, NULL) == 1);

  data = g_memory_output_stream_get_data (G_MEMORY_OUTPUT_STREAM (out));
  g_assert_cmpstr (data, ==,
    "HTTP/1.1 500 Reason here: booyah\r\nContent-Length: 96\r\nConnection: close\r\nHeader1: value1\r\n\r\n<html><head><title>500 Reason here: booyah</title></head><body>Reason here: booyah</body></html>");

  g_object_unref (out);
}

int
main (int argc,
      char *argv[])
{
#if !GLIB_CHECK_VERSION(2,36,0)
  g_type_init ();
#endif

  g_set_prgname ("test-webserver");
  g_test_init (&argc, &argv, NULL);

  g_test_add_func ("/web-server/table", test_table);
  g_test_add_func ("/web-server/return-content", test_return_content);
  g_test_add_func ("/web-server/return-content-headers", test_return_content_headers);
  g_test_add_func ("/web-server/return-error", test_return_error);
  g_test_add_func ("/web-server/return-error-headers", test_return_error_headers);
  g_test_add_func ("/web-server/return-gerror-headers", test_return_gerror_headers);

  return g_test_run ();
}
