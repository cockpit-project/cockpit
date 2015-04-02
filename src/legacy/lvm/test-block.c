/* -*- mode: C; c-file-style: "gnu"; indent-tabs-mode: nil; -*-
 *
 * Copyright (C) 2007-2010 David Zeuthen <zeuthen@gmail.com>
 * Copyright (C) 2013-2014 Red Hat, Inc.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin St, Fifth Floor, Boston, MA  02110-1301  USA
 *
 */

#include "config.h"

#include "testing.h"

typedef struct {
  GDBusConnection *bus;
  gpointer daemon;
  GDBusObjectManager *objman;
} Test;

static void
setup_target (Test *test,
              gconstpointer data)
{
  testing_target_setup (&test->bus, &test->objman, &test->daemon);
}

static void
teardown_target (Test *test,
                 gconstpointer data)
{
  testing_target_teardown (&test->bus, &test->objman, &test->daemon);
}

static void
test_objects (Test *test,
              gconstpointer data)
{
  GList *objects, *l;
  const gchar *path;

  objects = g_dbus_object_manager_get_objects (test->objman);

  if (g_test_verbose ())
    {
      for (l = objects; l != NULL; l = g_list_next (l))
        {
          path = g_dbus_object_get_object_path (l->data);
          g_printerr ("%s\n", path);
        }
    }

  /* Some block devices should show up */
  g_assert (objects != NULL);
  g_assert (objects->data != NULL);

  g_list_free_full (objects, g_object_unref);
}

static void
on_block_path_copy (GDBusObjectManager *manager,
                    GDBusObject *object,
                    gpointer user_data)
{
  gchar **block = user_data;
  const gchar *path;

  g_assert (block != NULL);
  g_assert (*block == NULL);

  path = g_dbus_object_get_object_path (object);
  if (g_str_has_prefix (path, "/org/freedesktop/UDisks2/block_devices/"))
    {
      g_assert (*block == NULL);
      *block = g_strdup (path);
    }
}

static void
on_block_clear_if_match (GDBusObjectManager *manager,
                         GDBusObject *object,
                         gpointer user_data)
{
  gchar **block = user_data;

  g_assert (block != NULL);

  if (*block == NULL)
    return;

  if (g_strcmp0 (*block, g_dbus_object_get_object_path (object)) == 0)
    {
      g_free (*block);
      *block = NULL;
    }
}

static void
test_add_remove (Test *test,
                 gconstpointer data)
{
  gchar *block_path = NULL;
  gchar *losetup_out;
  gchar *device;
  gchar *name;
  gchar *vgname;
  gint i;

  vgname = testing_target_vgname ();

  g_signal_connect (test->objman, "object-added",
                    G_CALLBACK (on_block_path_copy), &block_path);

  /* Find one that isn't in use */
  for (i = 0; i < 512; i++)
    {
      device = g_strdup_printf ("/dev/loop%d", i);
      if (!g_file_test (device, G_FILE_TEST_EXISTS))
        break;
      g_free (device);
      device = NULL;
    }

  if (device == NULL)
    {
      g_critical ("couldn't find free loop device while testing");
      g_test_fail ();
      return;
    }

  /* Create a new loop device */
  testing_target_execute (NULL, "dd", "if=/dev/zero", "of=test-udisk-lvm-1", "bs=10M", "count=1", "status=none", NULL);
  testing_target_execute (NULL, "losetup", device, "test-udisk-lvm-1", NULL);

  /* Use it as a physical volume */
  testing_target_execute (NULL, "vgcreate", vgname, device, NULL);

  /* Wait for the device to appear */
  testing_wait_until (block_path != NULL);

  /* Path name should match the /dev/xxx name */
  name = g_path_get_basename (device);
  g_assert_str_contains (block_path, name);
  g_free (name);

  g_signal_connect (test->objman, "object-removed",
                    G_CALLBACK (on_block_clear_if_match), &block_path);

  /*
   * Actually make the devices go away, something that "losetup -d" doesn't
   * do ... You're using a test machine as the target, aren't you?
   */
  testing_target_execute (NULL, "vgremove", vgname, NULL);
  testing_target_execute (&losetup_out, "losetup", "-D", NULL);
  testing_target_execute (&losetup_out, "rmmod", "loop", NULL);

  /* Wait for the block to disappear */
  testing_wait_until (block_path == NULL);

  g_free (device);
  g_free (vgname);
}

GError *error = NULL;
GVariant *retval;
gchar *s;

int
main (int argc,
      char **argv)
{
#if !GLIB_CHECK_VERSION(2,36,0)
  g_type_init ();
#endif

  g_test_init (&argc, &argv, NULL);

  if (testing_target_init ())
    {
      g_test_add ("/storaged/lvm/block-list", Test, NULL,
                  setup_target, test_objects, teardown_target);
      g_test_add ("/storaged/lvm/block-add-remove", Test, NULL,
                  setup_target, test_add_remove, teardown_target);
    }

  return g_test_run ();
}
