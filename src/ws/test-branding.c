/*
 * Copyright (C) 2025 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#include "config.h"

#include <errno.h>
#include <string.h>
#include <unistd.h>

#include <glib.h>
#include <glib/gstdio.h>

#include "cockpitbranding.h"
#include "testlib/cockpittest.h"


static void
setup_branding_dir (const gchar *data_dir)
{
  /* Create the cockpit directory structure in temp dir */
  g_autofree gchar *cockpit_dir = g_build_filename (data_dir, "cockpit", NULL);
  g_autofree gchar *static_dir = g_build_filename (cockpit_dir, "static", NULL);

  g_mkdir_with_parents (static_dir, 0755);

  /* Create a dummy file in static to make it a valid document root */
  g_autofree gchar *dummy_file = g_build_filename (static_dir, "test.txt", NULL);
  g_file_set_contents (dummy_file, "test", -1, NULL);

  /* Mirror the branding directory structure from source tree
   * calculate_static_roots() doesn't accept symlink and we also want to modify the structure */
  g_autofree gchar *branding_dir = g_build_filename (cockpit_dir, "branding", NULL);
  g_mkdir_with_parents (branding_dir, 0755);

  g_autofree gchar *source_branding = g_build_filename (SRCDIR, "src", "branding", NULL);
  GDir *source_dir = g_dir_open (source_branding, 0, NULL);
  g_assert_nonnull (source_dir);

  const gchar *brand_name;
  while ((brand_name = g_dir_read_name (source_dir)) != NULL)
    {
      g_autofree gchar *brand_subdir = g_build_filename (branding_dir, brand_name, NULL);
      g_mkdir_with_parents (brand_subdir, 0755);

      /* Create a branding.css file to make it a valid branding directory */
      g_autofree gchar *brand_css = g_build_filename (brand_subdir, "branding.css", NULL);
      g_file_set_contents (brand_css, "/* test branding */", -1, NULL);
    }

  g_dir_close (source_dir);
}

static void
assert_roots_contains (GStrv roots, const gchar *data_dir, const gchar *suffix_path)
{
  g_autofree gchar *expected_path = g_build_filename (data_dir, suffix_path, NULL);
  for (int i = 0; roots[i]; i++)
    {
      if (g_strcmp0 (roots[i], expected_path) == 0)
        return;
    }
  g_autofree gchar *msg = g_strdup_printf ("Expected to find path '%s' in roots array", expected_path);
  g_test_fail ();
  g_test_message ("%s", msg);
}

/**
 * Tests
 */

static void
test_roots_local (gconstpointer _unused)
{
  g_auto(GStrv) roots_local = cockpit_branding_calculate_static_roots ("fedora", NULL, NULL, TRUE);
  /* Can't assert much here, as this tests the actual system branding;
   * just that it doesn't crash and delivers some list */
  g_assert_cmpint (g_strv_length (roots_local), >=, 0);
}


static void
test_roots_basic (gconstpointer data)
{
  const gchar *data_dir = (const gchar *)data;

  setup_branding_dir (data_dir);

  /* No IDs at all */
  g_auto(GStrv) roots_none = cockpit_branding_calculate_static_roots (NULL, NULL, NULL, FALSE);
  g_assert_cmpint (g_strv_length (roots_none), ==, 2);
  assert_roots_contains (roots_none, data_dir, "cockpit/branding/default");
  assert_roots_contains (roots_none, data_dir, "cockpit/static");

  /* ID */
  g_auto(GStrv) roots_id = cockpit_branding_calculate_static_roots ("rhel", NULL, NULL, FALSE);
  g_assert_cmpint (g_strv_length (roots_id), ==, 3);
  assert_roots_contains (roots_id, data_dir, "cockpit/branding/rhel");
  assert_roots_contains (roots_id, data_dir, "cockpit/branding/default");
  assert_roots_contains (roots_id, data_dir, "cockpit/static");

  /* ID + VARIANT; We don't actually have rhel-server nor any other variant branding, so it
   * should not appear; see test_roots_variant() below */
  g_auto(GStrv) roots_variant = cockpit_branding_calculate_static_roots ("rhel", "server", NULL, FALSE);
  g_assert_cmpint (g_strv_length (roots_variant), ==, 3);
  assert_roots_contains (roots_variant, data_dir, "cockpit/branding/rhel");
  assert_roots_contains (roots_variant, data_dir, "cockpit/branding/default");
  assert_roots_contains (roots_variant, data_dir, "cockpit/static");

  /* ID_LIKE */
  g_auto(GStrv) roots_like = cockpit_branding_calculate_static_roots ("centos", NULL, "rhel fedora", FALSE);
  g_assert_cmpint (g_strv_length (roots_like), ==, 5);
  assert_roots_contains (roots_like, data_dir, "cockpit/branding/centos");
  assert_roots_contains (roots_like, data_dir, "cockpit/branding/rhel");
  assert_roots_contains (roots_like, data_dir, "cockpit/branding/fedora");
  assert_roots_contains (roots_like, data_dir, "cockpit/branding/default");
  assert_roots_contains (roots_like, data_dir, "cockpit/static");
}

static void
test_roots_variant (gconstpointer data)
{
  const gchar *data_dir = (const gchar *)data;

  /* Create a test variant branding directory (rhel-server) */
  g_autofree gchar *variant_dir = g_build_filename (data_dir, "cockpit", "branding", "rhel-server", NULL);
  g_mkdir_with_parents (variant_dir, 0755);
  g_autofree gchar *variant_css = g_build_filename (variant_dir, "branding.css", NULL);
  g_file_set_contents (variant_css, "/* test variant branding */", -1, NULL);

  /* That is found */
  g_auto(GStrv) roots_variant = cockpit_branding_calculate_static_roots ("rhel", "server", NULL, FALSE);
  g_assert_cmpint (g_strv_length (roots_variant), ==, 4);
  assert_roots_contains (roots_variant, data_dir, "cockpit/branding/rhel-server");

  /* Non-existing variant */
  g_auto(GStrv) roots_missing = cockpit_branding_calculate_static_roots ("rhel", "workstation", NULL, FALSE);
  g_assert_cmpint (g_strv_length (roots_missing), ==, 3);
  assert_roots_contains (roots_variant, data_dir, "cockpit/branding/rhel");
  assert_roots_contains (roots_variant, data_dir, "cockpit/branding/default");
  assert_roots_contains (roots_variant, data_dir, "cockpit/static");
}

static void
test_roots_config (gconstpointer data)
{
  const gchar *tmp_dir = (const gchar *)data;
  g_autofree gchar *data_dir = g_build_filename (tmp_dir, "data", NULL);
  g_autofree gchar *config_dir = g_build_filename (tmp_dir, "config", NULL);

  /* Create config branding directory */
  g_autofree gchar *config_branding_dir = g_build_filename (config_dir, "cockpit", "branding", NULL);
  g_assert_cmpint (g_mkdir_with_parents (config_branding_dir, 0755), ==, 0);

  g_auto(GStrv) roots = cockpit_branding_calculate_static_roots ("fedora", NULL, NULL, FALSE);

  g_assert_cmpint (g_strv_length (roots), ==, 4);
  assert_roots_contains (roots, config_dir, "cockpit/branding");
  assert_roots_contains (roots, data_dir, "cockpit/branding/fedora");
  assert_roots_contains (roots, data_dir, "cockpit/branding/default");
  assert_roots_contains (roots, data_dir, "cockpit/static");
}

int
main (int argc, char *argv[])
{
  int result;

  cockpit_test_init (&argc, &argv);

  /* Create a global temp directory shared by all tests, as
   * g_get_system_data_dirs() reads XDG_DATA_DIRS just once and caches the result.
   * So the tests below are sorted by incrementally populating that dir. */
  g_autofree gchar* global_temp_dir = g_dir_make_tmp ("cockpit-branding-test-XXXXXX", NULL);
  g_assert_nonnull (global_temp_dir);

  g_autofree gchar *data_dir = g_build_filename (global_temp_dir, "data", NULL);
  g_mkdir(data_dir, 0755);
  g_setenv ("XDG_DATA_DIRS", data_dir, TRUE);

  g_autofree gchar *config_dir = g_build_filename (global_temp_dir, "config", NULL);
  g_mkdir(config_dir, 0755);
  g_setenv ("XDG_CONFIG_DIRS", config_dir, TRUE);

  g_test_add_data_func ("/branding/roots/local", data_dir,
                        test_roots_local);

  g_test_add_data_func ("/branding/roots/basic", data_dir,
                        test_roots_basic);

  g_test_add_data_func ("/branding/roots/variant", data_dir,
                        test_roots_variant);

  g_test_add_data_func ("/branding/roots/config", global_temp_dir,
                        test_roots_config);

  result = g_test_run ();

  /* Clean up global temp directory */
  const gchar *argv_rm[] = { "rm", "-rf", global_temp_dir, NULL };
  g_spawn_sync (NULL, (gchar **)argv_rm, NULL, G_SPAWN_SEARCH_PATH,
                NULL, NULL, NULL, NULL, NULL, NULL);

  return result;
}
