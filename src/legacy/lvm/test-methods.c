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

  struct {
    gchar *device;
    gchar *object_path;
  } blocks[2];

  gchar *vgname;
  GDBusProxy *volume_group;
  GDBusProxy *logical_volume;
} Test;

static void
setup_target (Test *test,
              gconstpointer data)
{
  gchar *base;
  gchar *arg;
  guint i;

  testing_target_setup (&test->bus, &test->objman, &test->daemon);
  test->vgname = testing_target_vgname ();

  /* Create three raw disk files which we'll use */
  for (i = 0; i < G_N_ELEMENTS (test->blocks); i++)
    {
      base = g_strdup_printf ("test-udisk-lvm-%d", i);
      arg = g_strdup_printf ("of=%s", base);
      testing_target_execute (NULL, "dd", "if=/dev/zero", arg, "bs=1M", "count=50", "status=none", NULL);
      testing_target_execute (&test->blocks[i].device, "losetup", "-f", "--show", base, NULL);
      g_free (base);
      g_free (arg);

      g_strstrip (test->blocks[i].device);
      base = g_path_get_basename (test->blocks[i].device);

      /* Intelligent guess */
      test->blocks[i].object_path = g_strdup_printf ("/org/freedesktop/UDisks2/block_devices/%s", base);
    }
}

static void
teardown_target (Test *test,
                 gconstpointer data)
{
  guint i;

  testing_target_teardown (&test->bus, &test->objman, &test->daemon);
  g_free (test->vgname);

  for (i = 0; i < G_N_ELEMENTS (test->blocks); i++)
    {
      g_free (test->blocks[i].device);
      g_free (test->blocks[i].object_path);
    }
}

static GDBusProxy *
lookup_interface (Test *test,
                  const gchar *path,
                  const gchar *interface)
{
  gpointer proxy;

  proxy = g_dbus_object_manager_get_interface (test->objman, path, interface);

  return proxy;
}

static void
setup_vgcreate (Test *test,
                gconstpointer data)
{
  setup_target (test, data);

  testing_want_added (test->objman, "com.redhat.lvm2.VolumeGroup",
                      test->vgname, &test->volume_group);

  testing_target_execute (NULL, "vgcreate", test->vgname,
                          test->blocks[0].device, test->blocks[1].device, NULL);

  testing_wait_until (test->volume_group != NULL);
}

static void
teardown_vgremove (Test *test,
                   gconstpointer data)
{
  g_clear_object (&test->volume_group);
  testing_target_execute (NULL, "vgremove", "-f", test->vgname, NULL);
  teardown_target (test, data);
}

static void
setup_vgcreate_lvcreate (Test *test,
                         gconstpointer data)
{
  const gchar *lvname = data;

  setup_vgcreate (test, data);

  testing_want_added (test->objman, "com.redhat.lvm2.LogicalVolume",
                      lvname, &test->logical_volume);

  testing_target_execute (NULL, "lvcreate", test->vgname, "--name", lvname,
                          "--size", "20m", "--activate", "n", "--zero", "n", NULL);

  testing_wait_until (test->logical_volume != NULL);
}

static void
teardown_lvremove_vgremove (Test *test,
                            gconstpointer data)
{
  const gchar *lvname = data;
  gchar *full_name;

  g_clear_object (&test->logical_volume);

  full_name = g_strdup_printf ("%s/%s", test->vgname, lvname);
  testing_target_execute (NULL, "lvremove", "-f", full_name, NULL);
  g_free (full_name);

  teardown_vgremove (test, data);
}

static void
test_volume_group_create (Test *test,
                          gconstpointer data)
{
  GDBusProxy *volume_group = NULL;
  const gchar *volume_group_path;
  GDBusProxy *manager;
  GVariant *blocks[2];
  GVariant *retval;
  GError *error = NULL;

  manager = lookup_interface (test, "/org/freedesktop/UDisks2/Manager", "com.redhat.lvm2.Manager");
  g_assert (manager != NULL);

  blocks[0] = g_variant_new_object_path (test->blocks[0].object_path);
  blocks[1] = g_variant_new_object_path (test->blocks[1].object_path);
  retval = g_dbus_proxy_call_sync (manager, "VolumeGroupCreate",
                                   g_variant_new ("(s@ao@a{sv})",
                                                  test->vgname,
                                                  g_variant_new_array (G_VARIANT_TYPE_OBJECT_PATH, blocks, 2),
                                                  g_variant_new_array (G_VARIANT_TYPE ("{sv}"), NULL, 0)),
                                   G_DBUS_CALL_FLAGS_NO_AUTO_START,
                                   -1, NULL, &error);
  g_assert_no_error (error);

  while (g_main_context_iteration (NULL, FALSE));

  g_variant_get (retval, "(&o)", &volume_group_path);
  volume_group = lookup_interface (test, volume_group_path, "com.redhat.lvm2.VolumeGroup");
  g_assert (volume_group != NULL);

  g_assert_cmpstr (testing_proxy_string (volume_group, "Name"), ==, test->vgname);

  testing_target_execute (NULL, "vgremove", "-f", testing_proxy_string (volume_group, "Name"), NULL);
  g_object_unref (volume_group);

  g_variant_unref (retval);
}

static void
test_volume_group_delete (Test *test,
                          gconstpointer data)
{
  GVariant *retval;
  GError *error = NULL;

  /* Now delete it, and it should dissappear */
  testing_want_removed (test->objman, &test->volume_group);

  retval = g_dbus_proxy_call_sync (test->volume_group, "Delete",
                                   g_variant_new ("(b@a{sv})",
                                                  FALSE,
                                                  g_variant_new_array (G_VARIANT_TYPE ("{sv}"), NULL, 0)),
                                   G_DBUS_CALL_FLAGS_NO_AUTO_START,
                                   -1, NULL, &error);

  g_assert_no_error (error);

  /* The object should disappear */
  testing_wait_until (test->volume_group == NULL);

  g_variant_unref (retval);
}

static void
test_logical_volume_create (Test *test,
                            gconstpointer data)
{
  const gchar *name = data;
  GVariant *retval;
  GError *error = NULL;
  const gchar *path;
  GDBusProxy *logical_volume;
  const gchar *volume_group_path;

  retval = g_dbus_proxy_call_sync (test->volume_group, "CreatePlainVolume",
                                   g_variant_new ("(st@a{sv})",
                                                  name,
                                                  (guint64)20 * 1024 * 1024,
                                                  g_variant_new_array (G_VARIANT_TYPE ("{sv}"), NULL, 0)),
                                   G_DBUS_CALL_FLAGS_NO_AUTO_START,
                                   -1, NULL, &error);
  g_assert_no_error (error);

  /* Pull out the logical volume from path */
  g_variant_get (retval, "(&o)", &path);
  testing_wait_idle ();
  logical_volume = lookup_interface (test, path, "com.redhat.lvm2.LogicalVolume");
  g_assert (logical_volume != NULL);

  volume_group_path = g_dbus_proxy_get_object_path (test->volume_group);
  g_assert_cmpstr (testing_proxy_string (logical_volume, "VolumeGroup"), ==, volume_group_path);
  g_assert_str_prefix (path, volume_group_path);
  g_assert_cmpstr (testing_proxy_string (logical_volume, "Name"), ==, name);

  g_variant_unref (retval);
}

static void
test_logical_volume_delete (Test *test,
                            gconstpointer data)
{
  GVariant *retval;
  GError *error = NULL;

  /* Now delete it, and it should dissappear */
  testing_want_removed (test->objman, &test->logical_volume);

  retval = g_dbus_proxy_call_sync (test->logical_volume, "Delete",
                                   g_variant_new ("(@a{sv})",
                                                  g_variant_new_array (G_VARIANT_TYPE ("{sv}"), NULL, 0)),
                                   G_DBUS_CALL_FLAGS_NO_AUTO_START,
                                   -1, NULL, &error);

  g_assert_no_error (error);

  /* The object should disappear */
  testing_wait_until (test->logical_volume == NULL);

  g_variant_unref (retval);
}

static void
test_logical_volume_activate (Test *test,
                              gconstpointer data)
{
  GVariant *retval;
  GError *error = NULL;
  const gchar *logical_volume_path;
  const gchar *block_path;
  GDBusProxy *block;

  /* Activating the logical volume should turn into a block */
  retval = g_dbus_proxy_call_sync (test->logical_volume, "Activate",
                                   g_variant_new ("(@a{sv})",
                                                  g_variant_new_array (G_VARIANT_TYPE ("{sv}"), NULL, 0)),
                                   G_DBUS_CALL_FLAGS_NO_AUTO_START,
                                   -1, NULL, &error);
  g_assert_no_error (error);

  /* Pull out the logical volume from path */
  g_variant_get (retval, "(&o)", &block_path);
  testing_wait_idle ();
  block = lookup_interface (test, block_path, "com.redhat.lvm2.LogicalVolumeBlock");
  g_assert (block != NULL);

  logical_volume_path = g_dbus_proxy_get_object_path (test->logical_volume);
  g_assert_cmpstr (testing_proxy_string (block, "LogicalVolume"), ==, logical_volume_path);
  g_variant_unref (retval);

  /* Deactivating the logical volume should make block go away */
  testing_want_removed (test->objman, &block);

  retval = g_dbus_proxy_call_sync (test->logical_volume, "Deactivate",
                                   g_variant_new ("(@a{sv})",
                                                  g_variant_new_array (G_VARIANT_TYPE ("{sv}"), NULL, 0)),
                                   G_DBUS_CALL_FLAGS_NO_AUTO_START,
                                   -1, NULL, &error);
  g_assert_no_error (error);
  g_variant_unref (retval);

  /* The object should disappear */
  testing_wait_until (block == NULL);
}

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
      g_test_add ("/storaged/lvm/volume-group/create", Test, NULL,
                  setup_target, test_volume_group_create, teardown_target);
      g_test_add ("/storaged/lvm/volume-group/delete", Test, NULL,
                  setup_vgcreate, test_volume_group_delete, teardown_target);

      g_test_add ("/storaged/lvm/logical-volume/create", Test, "volone",
                  setup_vgcreate, test_logical_volume_create, teardown_lvremove_vgremove);
      g_test_add ("/storaged/lvm/logical-volume/delete", Test, "volone",
                  setup_vgcreate_lvcreate, test_logical_volume_delete, teardown_vgremove);
      g_test_add ("/storaged/lvm/logical-volume/activate", Test, "volone",
                  setup_vgcreate_lvcreate, test_logical_volume_activate, teardown_lvremove_vgremove);
    }

  return g_test_run ();
}
