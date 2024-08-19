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

#include "cockpitdbusrules.h"

#include "testlib/cockpittest.h"

#include <string.h>

typedef struct {
  CockpitDBusRules *rules;
} TestCase;

typedef struct {
  const gchar *path;
  gboolean is_namespace;
  const gchar *interface;
  const gchar *member;
  const gchar *arg0;
} TestRule;

static const TestRule default_rules[] = {
  { "/otree", TRUE, NULL, NULL, NULL },
  { "/scruffy/the/janitor", FALSE, NULL, "Marmalade", NULL },
  { "/planetexpress", TRUE, "org.PlanetExpress.Interface", NULL, NULL },
  { "/arg", FALSE, NULL, NULL, "Durn" },
  { NULL, }
};

static const TestRule empty_rules[] = {
  { NULL, }
};

static const TestRule path_rules[] = {
  { "/otree", TRUE, NULL, NULL, NULL },
  { "/scruffy/the/janitor", FALSE, NULL, NULL, NULL },
  { "/planetexpress", TRUE, NULL, NULL, NULL },
  { "/arg", FALSE, NULL, NULL, NULL },
  { NULL, }
};

static void
setup (TestCase *test,
       gconstpointer data)
{
  const TestRule *rules = data;
  gint i;

  if (!rules)
    rules = default_rules;

  test->rules = cockpit_dbus_rules_new ();
  for (i = 0; rules[i].path != NULL; i++)
    {
      cockpit_dbus_rules_add (test->rules, rules[i].path, rules[i].is_namespace,
                              rules[i].interface, rules[i].member, rules[i].arg0);
    }
}

static void
teardown (TestCase *test,
          gconstpointer data)
{
  cockpit_assert_expected ();

  cockpit_dbus_rules_free (test->rules);
}

static void
test_basics (TestCase *test,
             gconstpointer fixture)
{
  /* Should all match, only based on path */
  g_assert (cockpit_dbus_rules_match (test->rules, "/otree/blah", NULL, NULL, NULL) == TRUE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/otree/blah", "org.Interface", NULL, NULL) == TRUE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/otree/blah", "org.Interface", "Signal", NULL) == TRUE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/otree/blah", "org.Interface", NULL, "arg") == TRUE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/otree/blah", NULL, "Signal", "arg") == TRUE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/otree/blah", "org.Interface", "Signal", "arg") == TRUE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/otree/bark", "org.Interface", "Signal", "arg") == TRUE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/otree", "org.Interface", "Signal", "arg") == TRUE);

  /* Mismatched path */
  g_assert (cockpit_dbus_rules_match (test->rules, "/not", NULL, NULL, NULL) == FALSE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/not", "org.Interface", NULL, NULL) == FALSE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/not", "org.Interface", "Signal", NULL) == FALSE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/not", "org.Interface", NULL, "arg") == FALSE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/not", NULL, "Signal", "arg") == FALSE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/not", "org.Interface", "Signal", "arg") == FALSE);

  /* Interfaces affect matching */
  g_assert (cockpit_dbus_rules_match (test->rules, "/planetexpress", NULL, NULL, NULL) == TRUE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/planetexpress", "org.PlanetExpress.Interface", NULL, NULL) == TRUE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/planetexpress", "other.Interface", NULL, NULL) == FALSE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/planetexpress/sub", "org.PlanetExpress.Interface", NULL, NULL) == TRUE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/planetexpress/sub", "other.Interface", NULL, NULL) == FALSE);

  /* Members affect matching */
  g_assert (cockpit_dbus_rules_match (test->rules, "/scruffy/the/janitor", NULL, NULL, NULL) == TRUE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/scruffy/the/janitor", NULL, "Marmalade", NULL) == TRUE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/scruffy/the/janitor", NULL, "Other", NULL) == FALSE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/scruffy/the/janitor/sub", NULL, "Marmalade", NULL) == FALSE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/scruffy/the/janitor/sub", NULL, "Other", NULL) == FALSE);

  /* Args affect matching */
  g_assert (cockpit_dbus_rules_match (test->rules, "/arg", NULL, NULL, NULL) == FALSE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/arg", NULL, NULL, "Durn") == TRUE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/arg", NULL, NULL, "other") == FALSE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/arg/sub", NULL, NULL, "Durn") == FALSE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/arg/sub", NULL, NULL, "other") == FALSE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/arg/sub", NULL, NULL, NULL) == FALSE);
}

static void
test_nothing (TestCase *test,
              gconstpointer fixture)
{
  /* No rules should never match anything */
  g_assert (cockpit_dbus_rules_match (test->rules, "/", NULL, NULL, NULL) == FALSE);

  g_assert (cockpit_dbus_rules_remove (test->rules, NULL, FALSE, NULL, NULL, NULL) == FALSE);
}

static void
test_path_only (TestCase *test,
                gconstpointer fixture)
{
  /* Should all match, only based on path */
  g_assert (cockpit_dbus_rules_match (test->rules, "/otree/blah", NULL, NULL, NULL) == TRUE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/otree/blah", "org.Interface", NULL, NULL) == TRUE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/otree/blah", "org.Interface", "Signal", NULL) == TRUE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/otree/blah", "org.Interface", NULL, "arg") == TRUE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/otree/blah", NULL, "Signal", "arg") == TRUE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/otree/blah", "org.Interface", "Signal", "arg") == TRUE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/otree/bark", "org.Interface", "Signal", "arg") == TRUE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/otree", "org.Interface", "Signal", "arg") == TRUE);

  /* Mismatched path */
  g_assert (cockpit_dbus_rules_match (test->rules, "/not", NULL, NULL, NULL) == FALSE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/not", "org.Interface", NULL, NULL) == FALSE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/not", "org.Interface", "Signal", NULL) == FALSE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/not", "org.Interface", NULL, "arg") == FALSE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/not", NULL, "Signal", "arg") == FALSE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/not", "org.Interface", "Signal", "arg") == FALSE);
}

static void
test_all_paths (TestCase *test,
                gconstpointer fixture)
{
  cockpit_dbus_rules_add (test->rules, "/", TRUE, NULL, NULL, NULL);

  /* Should all match, only based on path */
  g_assert (cockpit_dbus_rules_match (test->rules, "/otree/blah", NULL, NULL, NULL) == TRUE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/boring", NULL, NULL, NULL) == TRUE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/tettot", NULL, NULL, NULL) == TRUE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/aoenut", NULL, NULL, NULL) == TRUE);
}

static void
test_null_path (TestCase *test,
                gconstpointer fixture)
{
  /* Adds a global empty rule which should match everything */
  cockpit_dbus_rules_add (test->rules, NULL, FALSE, NULL, NULL, NULL);

  /* Should all match, only based on path */
  g_assert (cockpit_dbus_rules_match (test->rules, "/otree/blah", NULL, NULL, NULL) == TRUE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/boring", NULL, NULL, NULL) == TRUE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/tettot", NULL, NULL, NULL) == TRUE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/aoenut", NULL, NULL, NULL) == TRUE);

  cockpit_dbus_rules_remove (test->rules, NULL, FALSE, NULL, NULL, NULL);

  g_assert (cockpit_dbus_rules_match (test->rules, "/otree/blah", NULL, NULL, NULL) == FALSE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/boring", NULL, NULL, NULL) == FALSE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/tettot", NULL, NULL, NULL) == FALSE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/aoenut", NULL, NULL, NULL) == FALSE);
}

static void
test_root_only (TestCase *test,
                gconstpointer fixture)
{
  /* This should only match the root path */
  cockpit_dbus_rules_add (test->rules, "/", FALSE, NULL, NULL, NULL);

  /* Should all match, only based on path */
  g_assert (cockpit_dbus_rules_match (test->rules, "/", NULL, NULL, NULL) == TRUE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/boring", NULL, NULL, NULL) == FALSE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/tettot", NULL, NULL, NULL) == FALSE);
  g_assert (cockpit_dbus_rules_match (test->rules, "/aoenut", NULL, NULL, NULL) == FALSE);
}

static void
test_add_ref_remove (TestCase *test,
                     gconstpointer fixture)
{
  const TestRule *rules = default_rules;
  gint i;

  /* Add all the rules once */
  for (i = 0; rules[i].path != NULL; i++)
    {
      g_assert (cockpit_dbus_rules_add (test->rules, rules[i].path, rules[i].is_namespace,
                                        rules[i].interface, rules[i].member, rules[i].arg0) == TRUE);
    }

  /* Add them again, should always return FALSE here */
  for (i = 0; rules[i].path != NULL; i++)
    {
      g_assert (cockpit_dbus_rules_add (test->rules, rules[i].path, rules[i].is_namespace,
                                        rules[i].interface, rules[i].member, rules[i].arg0) == FALSE);
    }

  /* Add another rule */
  g_assert (cockpit_dbus_rules_remove (test->rules, "/booo", FALSE, NULL, NULL, NULL) == FALSE);
  g_assert (cockpit_dbus_rules_add (test->rules, "/booo", FALSE, NULL, NULL, NULL) == TRUE);

  /* Now remove them, the first time shouldn't actually remove */
  for (i = 0; rules[i].path != NULL; i++)
    {
      g_assert (cockpit_dbus_rules_remove (test->rules, rules[i].path, rules[i].is_namespace,
                                           rules[i].interface, rules[i].member, rules[i].arg0) == FALSE);
    }

  /* The second time actually removes */
  for (i = 0; rules[i].path != NULL; i++)
    {
      g_assert (cockpit_dbus_rules_remove (test->rules, rules[i].path, rules[i].is_namespace,
                                           rules[i].interface, rules[i].member, rules[i].arg0) == TRUE);
    }

  g_assert (cockpit_dbus_rules_remove (test->rules, "/booo", FALSE, NULL, NULL, NULL) == TRUE);
  g_assert (cockpit_dbus_rules_remove (test->rules, "/booo", FALSE, NULL, NULL, NULL) == FALSE);
}

int
main (int argc,
      char *argv[])
{
  cockpit_test_init (&argc, &argv);

  g_test_add ("/rules/basics", TestCase, NULL,
              setup, test_basics, teardown);
  g_test_add ("/rules/nothing", TestCase, empty_rules,
              setup, test_nothing, teardown);
  g_test_add ("/rules/path-only", TestCase, path_rules,
              setup, test_path_only, teardown);
  g_test_add ("/rules/all-paths", TestCase, empty_rules,
              setup, test_all_paths, teardown);
  g_test_add ("/rules/root-only", TestCase, empty_rules,
              setup, test_root_only, teardown);
  g_test_add ("/rules/null-path", TestCase, empty_rules,
              setup, test_null_path, teardown);
  g_test_add ("/rules/add-ref-remove", TestCase, empty_rules,
              setup, test_add_ref_remove, teardown);

  return g_test_run ();
}
