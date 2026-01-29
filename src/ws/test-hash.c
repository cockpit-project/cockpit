/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
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

#include "cockpithash.h"

#include "testlib/cockpittest.h"

static void
test_case_hash (void)
{
  GHashTable *table;

  table = g_hash_table_new_full (cockpit_str_case_hash, cockpit_str_case_equal, g_free, g_free);

  /* Case insensitive keys */
  g_hash_table_insert (table, g_strdup ("Blah"), g_strdup ("value"));
  g_hash_table_insert (table, g_strdup ("blah"), g_strdup ("another"));
  g_hash_table_insert (table, g_strdup ("Different"), g_strdup ("One"));

  g_assert_cmpstr (g_hash_table_lookup (table, "BLAH"), ==, "another");
  g_assert_cmpstr (g_hash_table_lookup (table, "differeNT"), ==, "One");

  g_hash_table_destroy (table);
}

int
main (int argc,
      char *argv[])
{
  cockpit_test_init (&argc, &argv);

  g_test_add_func ("/hash/case-hash", test_case_hash);

  return g_test_run ();
}
