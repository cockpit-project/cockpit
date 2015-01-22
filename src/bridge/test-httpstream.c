
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

#include "cockpithttpstream.h"
#include "cockpithttpstream.c"
#include "common/cockpittest.h"

#include "mock-transport.h"
#include <json-glib/json-glib.h>

/* -----------------------------------------------------------------------------
 * Test
 */

static void
test_parse_keep_alive (void)
{
  const gchar *version;
  GHashTable *headers;
  MockTransport *transport;
  CockpitHttpStream *stream;

  JsonObject *options;
  options = json_object_new ();
  transport = g_object_new (mock_transport_get_type (), NULL);
  stream = g_object_new (COCKPIT_TYPE_HTTP_STREAM,
                            "transport", transport,
                            "id", "1",
                            "options", options,
                            NULL);

  headers = g_hash_table_new (g_str_hash, g_str_equal);

  version = "HTTP/1.1";
  g_hash_table_insert (headers, "Connection", "keep-alive");

  parse_keep_alive (stream, version, headers);
  g_assert (stream->keep_alive == TRUE);

  version = "HTTP/1.0";
  parse_keep_alive (stream, version, headers);
  g_assert (stream->keep_alive == TRUE);


  g_hash_table_remove (headers, "Connection");

  parse_keep_alive (stream, version, headers);
  g_assert (stream->keep_alive == FALSE);

  version = "HTTP/1.1";
  parse_keep_alive (stream, version, headers);
  g_assert (stream->keep_alive == TRUE);

  g_hash_table_destroy (headers);
  g_object_unref (transport);
  g_object_unref (stream);
  json_object_unref (options);
}

int
main (int argc,
      char *argv[])
{
  cockpit_test_init (&argc, &argv);
  g_test_add_func  ("/http-stream/parse_keepalive", test_parse_keep_alive);

  return g_test_run ();
}
