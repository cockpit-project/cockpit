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

#include "cockpittemplate.h"
#include "cockpitjson.h"

#include "testlib/cockpittest.h"

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
  g_hash_table_insert (tc->variables, "oh-dash", "dash-marmalade");
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
  { "@@", "@@", "empty-string", "", { NULL } },
  { "@@", "@@", "no-vars", "Test no vars", { "Test no vars", NULL } },
  { "@@", "@@", "only-var", "@@oh@@", { "marmalade", NULL } },
  { "@@", "@@", "only-vars", "@@oh@@@@oh@@", { "marmalade", "marmalade", NULL } },
  { "@@", "@@", "simple", "Test @@oh@@ suffix", { "Test ", "marmalade", " suffix", NULL } },
  { "@@", "@@", "extra-at", "Te@st @@oh@@ suffix", { "Te@st ", "marmalade", " suffix", NULL } },
  { "@@", "@@", "no-ending", "Test @@oh@@ su@@ffix", { "Test ", "marmalade", " su@@ffix", NULL } },
  { "@@", "@@", "extra-at-after", "Test @@oh@@ su@@ff@ix", { "Test ", "marmalade", " su@@ff@ix", NULL } },
  { "@@", "@@", "unknown", "Test @@unknown@@ suffix", { "Test ", "@@unknown@@", " suffix", NULL } },
  { "@@", "@@", "escaped", "Test \\@@oh@@ @@oh@@ suffix", { "Test ", "@@oh@@", " ", "marmalade", " suffix", NULL } },
  { "@@", "@@", "dash", "Test @@oh-dash@@ suffix", { "Test ", "dash-marmalade", " suffix", NULL } },
  { "@@", "@@", "lots", "Oh @@oh@@ says Scruffy @@empty@@ the @@Scruffy@@",
      { "Oh ", "marmalade", " says Scruffy ", " the ", "janitor", NULL }
  },
  { "${", "}", "brackets-empty-string", "", { NULL } },
  { "${", "}", "brackets-no-vars", "Test no vars", { "Test no vars", NULL } },
  { "${", "}", "brackets-only-var", "${oh}", { "marmalade", NULL } },
  { "${", "}", "brackets-only-vars", "${oh}${oh}", { "marmalade", "marmalade", NULL } },
  { "${", "}", "brackets-simple", "Test ${oh} suffix", { "Test ", "marmalade", " suffix", NULL } },
  { "${", "}", "brackets-not-full", "Te$st ${oh} suffix", { "Te$st ", "marmalade", " suffix", NULL } },
  { "${", "}", "brackets-no-ending", "Test ${oh} su${ffix", { "Test ", "marmalade", " su${ffix", NULL } },
  { "${", "}", "brackets-unknown", "Test ${unknown} suffix", { "Test ", "${unknown}", " suffix", NULL } },
  { "${", "}", "brackets-escaped", "Test \\${oh} ${oh} suffix", { "Test ", "${oh}", " ", "marmalade", " suffix", NULL } },
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

  output = cockpit_template_expand (input, fixture->start, fixture->end, lookup_table, tc->variables);
  g_bytes_unref (input);

  for (i = 0, l = output; l && fixture->output[i] != NULL; i++, l = g_list_next (l))
    cockpit_assert_bytes_eq (l->data, fixture->output[i], -1);
  g_assert_cmpint (g_list_length (output), ==, i);

  g_list_free_full (output, (GDestroyNotify)g_bytes_unref);
}

static void
test_json (TestCase *tc,
           gconstpointer data)
{
  g_autoptr(JsonObject) input = json_object_new ();
  g_autoptr(JsonObject) expected_at = json_object_new ();
  g_autoptr(JsonObject) expected_brackets = json_object_new ();
  g_autoptr(JsonObject) expected_both = json_object_new ();

  for (int i = 0; i < G_N_ELEMENTS (expand_fixtures); i++)
    {
      const Fixture *fixture = &expand_fixtures[i];
      g_autofree gchar *output = g_strjoinv ("", (gchar **) fixture->output);

      json_object_set_string_member (input, fixture->name, fixture->input);

      if (g_str_equal (fixture->start, "@@"))
        {
          /* ${...} won't expand anything here */
          json_object_set_string_member (expected_brackets, fixture->name, fixture->input);

          /* the other cases will */
          json_object_set_string_member (expected_at, fixture->name, output);
          json_object_set_string_member (expected_both, fixture->name, output);
        }
      else
        {
          g_assert (g_str_equal (fixture->start, "${"));

          /* @@...@@ won't expand anything here */
          json_object_set_string_member (expected_at, fixture->name, fixture->input);

          /* the other cases will */
          json_object_set_string_member (expected_brackets, fixture->name, output);
          json_object_set_string_member (expected_both, fixture->name, output);
        }
    }

  json_object_seal (input);

  /* Let's try the cases now */
  g_autoptr(JsonObject) at_results = cockpit_template_expand_json (input, "@@", "@@",
                                                                   lookup_table, tc->variables);
  g_assert (json_object_equal (at_results, expected_at));

  g_autoptr(JsonObject) bracket_results = cockpit_template_expand_json (input, "${", "}",
                                                                        lookup_table, tc->variables);
  g_assert (json_object_equal (at_results, expected_at));

  g_autoptr(JsonObject) bracket_at_results = cockpit_template_expand_json (bracket_results, "@@", "@@",
                                                                           lookup_table, tc->variables);
  g_assert (json_object_equal (bracket_at_results, expected_both));

  g_autoptr(JsonObject) at_bracket_results = cockpit_template_expand_json (at_results, "${", "}",
                                                                           lookup_table, tc->variables);
  g_assert (json_object_equal (at_bracket_results, expected_both));
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

  g_test_add ("/template/expand/json", TestCase, NULL, setup, test_json, teardown);

  return g_test_run ();
}
