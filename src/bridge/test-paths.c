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

#include "cockpitpaths.h"

#include "common/cockpittest.h"

#include <string.h>

typedef struct {
  const gchar *a;
  const gchar *b;
  gboolean expect;
  const gchar *name;
} CmpFixture;

static const CmpFixture fixtures_has_parent[] = {
  { "/c", "/c", FALSE, "equal" },
  { "/c", "/c/d", FALSE, "child" },
  { "/c", "/c/d/e", FALSE, "grand-child" },
  { "/c/d", "/c", TRUE, "parent" },
  { "/c/d/e", "/c", FALSE, "grand-parent" },
  { "/c", "/peer", FALSE, "peer-after" },
  { "/c", "/a", FALSE, "peer-before" },
  { "/d", "/door", FALSE, "peer-prefix" },
  { "/cat", "/c", FALSE, "peer-truncated" },
  { "/", "/c", FALSE, "root-child" },
  { "/", "/c/d", FALSE, "root-grand-child" },
  { "/c", "/", TRUE, "root-parent" },
  { "/c/d", "/", FALSE, "root-grand-parent" },
};

static void
test_path_has_parent (gconstpointer data)
{
  const CmpFixture *fixture = data;
  g_assert (cockpit_path_has_parent (fixture->a, fixture->b) == fixture->expect);
}

static const CmpFixture fixtures_has_ancestor[] = {
  { "/c", "/c", FALSE, "equal" },
  { "/c", "/c/d", FALSE, "child" },
  { "/c", "/c/d/e", FALSE, "grand-child" },
  { "/c/d", "/c", TRUE, "parent" },
  { "/c/d/e", "/c", TRUE, "grand-parent" },
  { "/c", "/peer", FALSE, "peer-after" },
  { "/c", "/a", FALSE, "peer-before" },
  { "/d", "/door", FALSE, "peer-prefix" },
  { "/cat", "/c", FALSE, "peer-truncated" },
  { "/", "/c", FALSE, "root-child" },
  { "/", "/c/d", FALSE, "root-grand-child" },
  { "/c", "/", TRUE, "root-parent" },
  { "/c/d", "/", TRUE, "root-grand-parent" },
};

static void
test_path_has_ancestor (gconstpointer data)
{
  const CmpFixture *fixture = data;
  g_assert (cockpit_path_has_ancestor (fixture->a, fixture->b) == fixture->expect);
}

static const CmpFixture fixtures_equal_or_ancestor[] = {
  { "/c", "/c", TRUE, "equal" },
  { "/c", "/c/d", FALSE, "child" },
  { "/c", "/c/d/e", FALSE, "grand-child" },
  { "/c/d", "/c", TRUE, "parent" },
  { "/c/d/e", "/c", TRUE, "grand-parent" },
  { "/c", "/peer", FALSE, "peer-after" },
  { "/c", "/a", FALSE, "peer-before" },
  { "/d", "/door", FALSE, "peer-prefix" },
  { "/cat", "/c", FALSE, "peer-truncated" },
  { "/", "/c", FALSE, "root-child" },
  { "/", "/c/d", FALSE, "root-grand-child" },
  { "/c", "/", TRUE, "root-parent" },
  { "/c/d", "/", TRUE, "root-grand-parent" },
};

static void
test_path_equal_or_ancestor (gconstpointer data)
{
  const CmpFixture *fixture = data;
  g_assert (cockpit_path_equal_or_ancestor (fixture->a, fixture->b) == fixture->expect);
}

static void
test_paths_add_remove (void)
{
  GTree *paths;
  const gchar *value;
  const gchar *check;

  paths = cockpit_paths_new ();

  g_assert_cmpstr (cockpit_paths_contain (paths, "/one"), ==, NULL);
  g_assert_cmpstr (cockpit_paths_contain (paths, "/two"), ==, NULL);
  g_assert_cmpstr (cockpit_paths_contain (paths, "/three/3"), ==, NULL);
  g_assert_cmpint (g_tree_nnodes (paths), ==, 0);

  /* Add first value */
  value = "/one";
  check = cockpit_paths_add (paths, value);
  g_assert (value != check); /* reallocated */

  g_assert_cmpstr (cockpit_paths_contain (paths, "/one"), ==, "/one");
  g_assert (cockpit_paths_contain (paths, "/one") == check);
  g_assert_cmpstr (cockpit_paths_contain (paths, "/two"), ==, NULL);
  g_assert_cmpstr (cockpit_paths_contain (paths, "/three/3"), ==, NULL);
  g_assert_cmpint (g_tree_nnodes (paths), ==, 1);

  /* Add another value */
  value = cockpit_paths_add (paths, "/two");
  g_assert (value != NULL);

  g_assert_cmpstr (cockpit_paths_contain (paths, "/one"), ==, "/one");
  g_assert_cmpstr (cockpit_paths_contain (paths, "/two"), ==, "/two");
  g_assert_cmpstr (cockpit_paths_contain (paths, "/three/3"), ==, NULL);
  g_assert_cmpint (g_tree_nnodes (paths), ==, 2);

  /* Add same one again */
  check = cockpit_paths_add (paths, "/two");
  g_assert (check == NULL); /* Already present */

  g_assert_cmpstr (cockpit_paths_contain (paths, "/one"), ==, "/one");
  g_assert_cmpstr (cockpit_paths_contain (paths, "/two"), ==, "/two");
  g_assert_cmpstr (cockpit_paths_contain (paths, "/three/3"), ==, NULL);
  g_assert_cmpint (g_tree_nnodes (paths), ==, 2);

  /* Remove first value */
  g_assert (cockpit_paths_remove (paths, "/one") == TRUE); /* actually removed */

  g_assert_cmpstr (cockpit_paths_contain (paths, "/one"), ==, NULL);
  g_assert_cmpstr (cockpit_paths_contain (paths, "/two"), ==, "/two");
  g_assert_cmpstr (cockpit_paths_contain (paths, "/three/3"), ==, NULL);
  g_assert_cmpint (g_tree_nnodes (paths), ==, 1);

  /* Remove reference to second value */
  g_assert (cockpit_paths_remove (paths, "/two") == TRUE); /* not actually */

  g_assert_cmpstr (cockpit_paths_contain (paths, "/one"), ==, NULL);
  g_assert_cmpstr (cockpit_paths_contain (paths, "/two"), ==, NULL);
  g_assert_cmpstr (cockpit_paths_contain (paths, "/three/3"), ==, NULL);
  g_assert_cmpint (g_tree_nnodes (paths), ==, 0);

  /* Add something before destroy, to check destructors */
  cockpit_paths_add (paths, "/three/3");

  g_tree_destroy (paths);
}

static void
test_paths_ancestor_descendant (void)
{
  GTree *paths;

  paths = cockpit_paths_new ();

  cockpit_paths_add (paths, "/a");
  cockpit_paths_add (paths, "/b");
  cockpit_paths_add (paths, "/c/3");

  g_assert (cockpit_paths_contain_or_descendant (paths, "/0") == FALSE);
  g_assert (cockpit_paths_contain_or_descendant (paths, "/z") == FALSE);
  g_assert (cockpit_paths_contain_or_descendant (paths, "/a") == TRUE);
  g_assert (cockpit_paths_contain_or_descendant (paths, "/a/1") == FALSE);
  g_assert (cockpit_paths_contain_or_descendant (paths, "/a1") == FALSE);
  g_assert (cockpit_paths_contain_or_descendant (paths, "/azzzzzz") == FALSE);
  g_assert (cockpit_paths_contain_or_descendant (paths, "/") == TRUE);

  g_assert_cmpstr (cockpit_paths_contain_or_ancestor (paths, "/b"), ==, "/b");
  g_assert_cmpstr (cockpit_paths_contain_or_ancestor (paths, "/b2"), ==, NULL);
  g_assert_cmpstr (cockpit_paths_contain_or_ancestor (paths, "/b/2"), ==, "/b");
  g_assert_cmpstr (cockpit_paths_contain_or_ancestor (paths, "/"), ==, NULL);

  g_assert(cockpit_paths_contain_or_descendant (paths, "/c/3/4") == FALSE);
  g_assert_cmpstr (cockpit_paths_contain_or_ancestor (paths, "/c"), ==, NULL);

  /* Everything */
  cockpit_paths_add (paths, "/");

  g_assert (cockpit_paths_contain_or_descendant (paths, "/a") == TRUE);
  g_assert (cockpit_paths_contain_or_descendant (paths, "/a/1") == FALSE);
  g_assert (cockpit_paths_contain_or_descendant (paths, "/a1") == FALSE);
  g_assert (cockpit_paths_contain_or_descendant (paths, "/") == TRUE);
  g_assert_cmpstr (cockpit_paths_contain_or_ancestor (paths, "/b"), ==, "/b");
  g_assert_cmpstr (cockpit_paths_contain_or_ancestor (paths, "/b2"), ==, "/");
  g_assert_cmpstr (cockpit_paths_contain_or_ancestor (paths, "/b/2"), ==, "/b");
  g_assert_cmpstr (cockpit_paths_contain_or_ancestor (paths, "/"), ==, "/");
  g_assert (cockpit_paths_contain_or_descendant (paths, "/c/3/4") == FALSE);
  g_assert_cmpstr (cockpit_paths_contain_or_ancestor (paths, "/c"), ==, "/");

  g_tree_destroy (paths);
}

int
main (int argc,
      char *argv[])
{
  gchar *path;
  guint i;

  cockpit_test_init (&argc, &argv);

  for (i = 0; i < G_N_ELEMENTS (fixtures_has_parent); i++)
    {
      path = g_strdup_printf ("/paths/has-parent/%s", fixtures_has_parent[i].name);
      g_test_add_data_func (path, fixtures_has_parent + i, test_path_has_parent);
      g_free (path);
    }

  for (i = 0; i < G_N_ELEMENTS (fixtures_has_parent); i++)
    {
      path = g_strdup_printf ("/paths/has-ancestor/%s", fixtures_has_ancestor[i].name);
      g_test_add_data_func (path, fixtures_has_ancestor + i, test_path_has_ancestor);
      g_free (path);
    }
  for (i = 0; i < G_N_ELEMENTS (fixtures_equal_or_ancestor); i++)
    {
      path = g_strdup_printf ("/paths/equal-or-ancestor/%s", fixtures_equal_or_ancestor[i].name);
      g_test_add_data_func (path, fixtures_equal_or_ancestor + i, test_path_equal_or_ancestor);
      g_free (path);
    }

  g_test_add_func ("/paths/add-remove", test_paths_add_remove);
  g_test_add_func ("/paths/ancestor-descendant", test_paths_ancestor_descendant);

  return g_test_run ();
}
