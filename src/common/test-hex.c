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

#include "cockpithex.h"

#include "cockpittest.h"

#include <glib.h>

static void
test_decode_success (void)
{
  gpointer decoded;
  gsize length;

  decoded = cockpit_hex_decode ("6d61726d616c616465", &length);
  g_assert_cmpstr (decoded, ==, "marmalade");
  g_assert_cmpuint (length, ==, 9);
  g_free (decoded);
}

static void
test_decode_no_length (void)
{
  gpointer decoded;

  decoded = cockpit_hex_decode ("6d61726d616c616465", NULL);
  g_assert_cmpstr (decoded, ==, "marmalade");
  g_free (decoded);
}

static void
test_decode_fail (void)
{
  gpointer decoded;
  gsize length;

  decoded = cockpit_hex_decode ("abcdefghijklmn", &length);
  g_assert (decoded == NULL);
}

int
main (int argc,
      char *argv[])
{
  cockpit_test_init (&argc, &argv);

  g_test_add_func ("/hex/decode-success", test_decode_success);
  g_test_add_func ("/hex/decode-no-length", test_decode_no_length);
  g_test_add_func ("/hex/decode-fail", test_decode_fail);

  return g_test_run ();
}
