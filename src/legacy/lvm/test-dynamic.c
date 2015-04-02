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
test_vgcreate_remove (Test *test,
                      gconstpointer data)
{
  GDBusProxy *volume_group = NULL;
  GDBusProxy *block;

  testing_want_added (test->objman, "com.redhat.lvm2.VolumeGroup",
                      test->vgname, &volume_group);

  testing_target_execute (NULL, "vgcreate", test->vgname,
                          test->blocks[0].device, test->blocks[1].device, NULL);

  testing_wait_until (volume_group != NULL);

  /* Found a new VolumeGroup exposed */
  g_assert_str_matches (g_dbus_proxy_get_object_path (volume_group), "/org/freedesktop/UDisks2/lvm/*");
  g_assert_cmpstr (testing_proxy_string (volume_group, "Name"), ==, test->vgname);

  /* At this point these two guys should each be a PhysicalVolumeBlock */
  testing_wait_until ((block = lookup_interface (test, test->blocks[0].object_path, "com.redhat.lvm2.PhysicalVolumeBlock")) != NULL);
  g_assert_cmpstr (testing_proxy_string (block, "VolumeGroup"), ==, g_dbus_proxy_get_object_path (volume_group));
  g_object_unref (block);

  testing_wait_until ((block = lookup_interface (test, test->blocks[1].object_path, "com.redhat.lvm2.PhysicalVolumeBlock")) != NULL);
  g_assert_cmpstr (testing_proxy_string (block, "VolumeGroup"), ==, g_dbus_proxy_get_object_path (volume_group));
  g_object_unref (block);

  testing_want_removed (test->objman, &volume_group);

  testing_target_execute (NULL, "vgremove", "-f", test->vgname, NULL);

  /* The object should disappear */
  testing_wait_until (volume_group == NULL);
}

static void
test_lvcreate_change_remove (Test *test,
                             gconstpointer data)
{
  GDBusProxy *logical_volume1 = NULL;
  GDBusProxy *logical_volume2 = NULL;
  const gchar *volume_group_path;
  GDBusProxy *block = NULL;
  gchar *full_name;

  testing_want_added (test->objman, "com.redhat.lvm2.LogicalVolume",
                      "one", &logical_volume1);
  testing_want_added (test->objman, "com.redhat.lvm2.LogicalVolume",
                      "two", &logical_volume2);

  testing_target_execute (NULL, "lvcreate", test->vgname, "--name", "one",
                          "--size", "20m", "--activate", "n", "--zero", "n", NULL);

  /*
   * TODO: We get the following here. Does LVM not support enumerating (by storaged)
   * simultaneous to creation of a new logical volume?
   *
   * lvcreate test-udisk-lvm -n two -L 20m
   * device-mapper: create ioctl on test--udisk--lvm-two failed: Device or resource busy
   * Failed to activate new LV.
   *
   * TODO: Fix this for real, because it'll come up IRL.
   */
  g_usleep (G_USEC_PER_SEC / 2);

  testing_target_execute (NULL, "lvcreate", test->vgname, "--name", "two",
                          "--size", "20m", "--activate", "n", "--zero", "n", NULL);

  testing_wait_until (logical_volume1 != NULL && logical_volume2 != NULL);

  /* Check that they're in the volume group, ... both by path */
  volume_group_path = g_dbus_proxy_get_object_path (test->volume_group);
  g_assert_str_prefix (g_dbus_proxy_get_object_path (logical_volume1), volume_group_path);
  g_assert_str_prefix (g_dbus_proxy_get_object_path (logical_volume2), volume_group_path);

  /* ... and explicitly */
  g_assert_cmpstr (testing_proxy_string (logical_volume1, "VolumeGroup"), ==, volume_group_path);
  g_assert_cmpstr (testing_proxy_string (logical_volume2, "VolumeGroup"), ==, volume_group_path);

  /* Both have the right names */
  g_assert_cmpstr (testing_proxy_string (logical_volume1, "Name"), ==, "one");
  g_assert_cmpstr (testing_proxy_string (logical_volume2, "Name"), ==, "two");

  /* Activate one of them, and a new block should appear */
  testing_want_added (test->objman, "com.redhat.lvm2.LogicalVolumeBlock", NULL, &block);

  full_name = g_strdup_printf ("%s/one", test->vgname);
  testing_target_execute (NULL, "lvchange", full_name, "--activate", "y", NULL);
  g_free (full_name);
  testing_wait_until (block != NULL);

  /* The new block should have the right property pointing back to lv */
  g_assert_cmpstr (testing_proxy_string (block, "LogicalVolume"), ==, g_dbus_proxy_get_object_path (logical_volume1));

  /* Remove the other logical volume, and it should disappear */
  testing_want_removed (test->objman, &logical_volume2);

  full_name = g_strdup_printf ("%s/two", test->vgname);
  testing_target_execute (NULL, "lvremove", full_name, NULL);
  g_free (full_name);
  testing_wait_until (logical_volume2 == NULL);

  g_object_unref (logical_volume1);
  g_object_unref (block);
}

static void
test_vgreduce (Test *test,
               gconstpointer data)
{
  const gchar *volume_group_path;
  GDBusProxy *block = NULL;

  block = lookup_interface (test, test->blocks[0].object_path, "com.redhat.lvm2.PhysicalVolumeBlock");
  volume_group_path = g_dbus_proxy_get_object_path (test->volume_group);
  g_assert_cmpstr (testing_proxy_string (block, "VolumeGroup"), ==, volume_group_path);

  testing_want_removed (test->objman, &block);

  testing_target_execute (NULL, "vgreduce", test->vgname, test->blocks[0].device, NULL);

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
      g_test_add ("/storaged/lvm/vgcreate-remove", Test, NULL,
                  setup_target, test_vgcreate_remove, teardown_target);
      g_test_add ("/storaged/lvm/lvcreate-change-remove", Test, NULL,
                  setup_vgcreate, test_lvcreate_change_remove, teardown_vgremove);
      g_test_add ("/storaged/lvm/vgreduce", Test, NULL,
                  setup_vgcreate, test_vgreduce, teardown_vgremove);
    }

  return g_test_run ();
}
