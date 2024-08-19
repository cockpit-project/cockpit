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

#include "cockpithex.h"

#include "testlib/retest.h"

#include <stdlib.h>

static void
test_decode_success (void)
{
  void * decoded;
  size_t length;

  decoded = cockpit_hex_decode ("6d61726d616c616465", -1, &length);
  assert_str_cmp (decoded, ==, "marmalade");
  assert_num_cmp (length, ==, 9);
  free (decoded);
}

static void
test_decode_part (void)
{
  void * decoded;
  size_t length;

  decoded = cockpit_hex_decode ("6d61726d616c616465", 8, &length);
  assert_str_cmp (decoded, ==, "marm");
  assert_num_cmp (length, ==, 4);
  free (decoded);
}

static void
test_decode_no_length (void)
{
  void *decoded;

  decoded = cockpit_hex_decode ("6d61726d616c616465", -1, NULL);
  assert_str_cmp (decoded, ==, "marmalade");
  free (decoded);
}

static void
test_decode_fail (void)
{
  void *decoded;
  size_t length;

  decoded = cockpit_hex_decode ("abcdefghijklmn", -1, &length);
  assert (decoded == NULL);
}

int
main (int argc,
      char *argv[])
{
  re_test (test_decode_success, "/hex/decode-success");
  re_test (test_decode_part, "/hex/decode-part");
  re_test (test_decode_no_length, "/hex/decode-no-length");
  re_test (test_decode_fail, "/hex/decode-fail");

  return re_test_run (argc, argv);
}
