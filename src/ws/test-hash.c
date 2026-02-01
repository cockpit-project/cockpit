/*
 * Copyright (C) 2015 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
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
