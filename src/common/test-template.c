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

#include "cockpittemplate.h"

#include "common/cockpittest.h"

#include <string.h>

typedef struct {
    GHashTable *variables;
} TestCase;

static void
setup (TestCase *tc,
       gconstpointer data)
{
  tc->variables = g_hash_table_new (g_str_hash, g_str_equal);
  g_hash_table_insert (tc->variables, "Scruffy", "janitor");
  g_hash_table_insert (tc->variables, "oh", "marmalade");
  g_hash_table_insert (tc->variables, "empty", "");
}

static void
teardown (TestCase *tc,
          gconstpointer data)
{
  g_hash_table_destroy (tc->variables);
}

static GBytes *
lookup_table (const char *name,
              gpointer user_data)
{
  GHashTable *variables = user_data;
  const gchar *value;

  value = g_hash_table_lookup (variables, name);
  if (!value)
    return NULL;
  return g_bytes_new (value, strlen (value));
}

typedef struct {
  const char *start;
  const char *end;
  const char *name;
  const char *input;
  const char *output[8];
} Fixture;

static const Fixture expand_fixtures[] = {
  { "@@", "@@", "simple", "Test @@oh@@ suffix", { "Test ", "marmalade", " suffix", NULL } },
  { "@@", "@@", "extra-at", "Te@st @@oh@@ suffix", { "Te@st ", "marmalade", " suffix", NULL } },
  { "@@", "@@", "no-ending", "Test @@oh@@ su@@ffix", { "Test ", "marmalade", " su@@ffix", NULL } },
  { "@@", "@@", "extra-at-after", "Test @@oh@@ su@@ff@ix", { "Test ", "marmalade", " su@@ff@ix", NULL } },
  { "@@", "@@", "unknown", "Test @@unknown@@ suffix", { "Test ", "@@unknown@@", " suffix", NULL } },
  { "@@", "@@", "lots", "Oh @@oh@@ says Scruffy @@empty@@ the @@Scruffy@@",
      { "Oh ", "marmalade", " says Scruffy ", " the ", "janitor", NULL }
  },
  { "${", "}", "brackets-simple", "Test ${oh} suffix", { "Test ", "marmalade", " suffix", NULL } },
  { "${", "}", "brackets-not-full", "Te$st ${oh} suffix", { "Te$st ", "marmalade", " suffix", NULL } },
  { "${", "}", "brackets-no-ending", "Test ${oh} su${ffix", { "Test ", "marmalade", " su${ffix", NULL } },
  { "${", "}", "brackets-unknown", "Test ${unknown} suffix", { "Test ", "${unknown}", " suffix", NULL } },
  { "${", "}", "brackets-lots", "Oh ${oh} says Scruffy ${empty} the ${Scruffy}",
      { "Oh ", "marmalade", " says Scruffy ", " the ", "janitor", NULL }
  },
};

static void
test_expand (TestCase *tc,
             gconstpointer data)
{
  const Fixture *fixture = data;
  GBytes *input;
  GList *output;
  GList *l;
  int i;

  input = g_bytes_new_static (fixture->input, strlen (fixture->input));

  output = cockpit_template_expand (input, lookup_table, fixture->start, fixture->end, tc->variables);
  g_bytes_unref (input);

  for (i = 0, l = output; fixture->output[i] != NULL; i++, l = g_list_next (l))
    cockpit_assert_bytes_eq (l->data, fixture->output[i], -1);
  g_assert_cmpint (g_list_length (output), ==, i);

  g_list_free_full (output, (GDestroyNotify)g_bytes_unref);
}

int
main (int argc,
      char *argv[])
{
  gchar *name;
  int i;

  cockpit_test_init (&argc, &argv);

  for (i = 0; i < G_N_ELEMENTS (expand_fixtures); i++)
    {
      name = g_strdup_printf ("/template/expand/%s", expand_fixtures[i].name);
      g_test_add (name, TestCase, expand_fixtures + i, setup, test_expand, teardown);
      g_free (name);
    }

  return g_test_run ();
}
