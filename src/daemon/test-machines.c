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

#include "machine.h"
#include "machines.h"

#include <glib/gstdio.h>

/* -----------------------------------------------------------------------------
 * Test
 */

typedef struct {
  GTestDBus *bus;
  GDBusConnection *connection;
  GDBusObjectManagerServer *object_manager;
  gchar *machines_file;
  gchar *known_hosts;
  Machines *machines;
  CockpitMachines *proxy;
} TestCase;

static void
on_ready_get_result (GObject *source_object,
                     GAsyncResult *result,
                     gpointer user_data)
{
  GAsyncResult **ret = user_data;
  g_assert (ret && !*ret);
  *ret = g_object_ref (result);
}

static void
setup (TestCase *tc,
       gconstpointer data)
{
  GAsyncResult *result = NULL;
  GError *error = NULL;
  GDBusObjectSkeleton *object;
  gint fd;

  tc->bus = g_test_dbus_new (G_TEST_DBUS_NONE);
  g_test_dbus_up (tc->bus);

  tc->object_manager = g_dbus_object_manager_server_new ("/com/redhat/Cockpit");
  tc->connection = g_bus_get_sync (G_BUS_TYPE_SESSION, NULL, &error);
  g_assert_no_error (error);
  g_dbus_object_manager_server_set_connection (tc->object_manager, tc->connection);

  tc->machines_file = g_strdup ("/tmp/cockpit-test-machines-XXXXXX");
  fd = g_mkstemp (tc->machines_file);
  g_assert (fd >= 0);
  g_assert_cmpint (close (fd), ==, 0);

  tc->known_hosts = g_strdup ("/tmp/cockpit-test-knownhosts-XXXXXX");
  fd = g_mkstemp (tc->known_hosts);
  g_assert (fd >= 0);
  g_assert_cmpint (close (fd), ==, 0);

  tc->machines = g_object_new (COCKPIT_TYPE_DAEMON_MACHINES,
                               "object-manager", tc->object_manager,
                               "machines-file", tc->machines_file,
                               "known-hosts", tc->known_hosts,
                               NULL);
  object = g_dbus_object_skeleton_new ("/com/redhat/Cockpit/Machines");
  g_dbus_object_skeleton_add_interface (object, G_DBUS_INTERFACE_SKELETON (tc->machines));
  g_dbus_object_manager_server_export (tc->object_manager, object);
  g_object_unref (object);

  cockpit_machines_proxy_new (tc->connection, G_DBUS_PROXY_FLAGS_DO_NOT_AUTO_START,
                              g_dbus_connection_get_unique_name (tc->connection),
                              "/com/redhat/Cockpit/Machines", NULL, on_ready_get_result, &result);
  while (result == NULL)
    g_main_context_iteration (NULL, TRUE);
  tc->proxy = cockpit_machines_proxy_new_finish (result, &error);
  g_assert_no_error (error);
  g_object_unref (result);
}

static void
teardown (TestCase *tc,
          gconstpointer data)
{
  GError *error = NULL;

  g_dbus_connection_flush_sync (tc->connection, NULL, &error);
  g_assert_no_error (error);
  g_object_unref (tc->connection);

  g_object_unref (tc->proxy);

  while (g_main_context_iteration (NULL, FALSE));

  g_object_add_weak_pointer (G_OBJECT (tc->object_manager), (gpointer *)&tc->object_manager);
  g_object_unref (tc->object_manager);
  g_assert (tc->object_manager == NULL);

  g_object_add_weak_pointer (G_OBJECT (tc->machines), (gpointer *)&tc->machines);
  g_object_unref (tc->machines);

  g_test_dbus_down (tc->bus);
  g_object_unref (tc->bus);

  while (g_main_context_iteration (NULL, FALSE));
  g_assert (tc->machines == NULL);

  g_assert_cmpint (g_unlink (tc->machines_file), ==, 0);
}

static void
test_add (TestCase *tc,
          gconstpointer data)
{
  GAsyncResult *result = NULL;
  GError *error = NULL;
  gchar *contents;
  gchar *path;

  cockpit_machines_call_add (tc->proxy, "blah", "", NULL, on_ready_get_result, &result);
  while (result == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_machines_call_add_finish (tc->proxy, &path, result, &error);
  g_object_unref (result);
  g_assert_no_error (error);

  g_assert_cmpstr (path, !=, "/");
  g_free (path);

  g_file_get_contents (tc->machines_file, &contents, NULL, &error);
  g_assert_no_error (error);
  g_assert_cmpstr (contents, ==, "[0]\naddress=blah\ntags=\n");
  g_free (contents);
}

static void
test_new_known_hosts (TestCase *tc,
                      gconstpointer data)
{
  GAsyncResult *result = NULL;
  GError *error = NULL;
  gchar *contents;
  gchar *path;

  g_assert (g_unlink (tc->known_hosts) == 0);

  cockpit_machines_call_add (tc->proxy, "blah", "blah:22 ssh-rsa xxxxyyyyzzzz", NULL, on_ready_get_result, &result);
  while (result == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_machines_call_add_finish (tc->proxy, &path, result, &error);
  g_object_unref (result);
  g_assert_no_error (error);

  g_assert_cmpstr (path, !=, "/");
  g_free (path);

  g_file_get_contents (tc->known_hosts, &contents, NULL, &error);
  g_assert_no_error (error);
  g_assert_cmpstr (contents, ==, "blah:22 ssh-rsa xxxxyyyyzzzz\n");
  g_free (contents);
}

static void
test_append_known_hosts (TestCase *tc,
                         gconstpointer data)
{
  GAsyncResult *result = NULL;
  GError *error = NULL;
  gchar *contents;
  gchar *path;

  g_file_set_contents (tc->known_hosts, "# comment", -1, &error);
  g_assert_no_error (error);

  cockpit_machines_call_add (tc->proxy, "blah", "blah:22 ssh-rsa xxxxyyyyzzzz", NULL, on_ready_get_result, &result);
  while (result == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_machines_call_add_finish (tc->proxy, &path, result, &error);
  g_object_unref (result);
  g_assert_no_error (error);

  g_assert_cmpstr (path, !=, "/");
  g_free (path);

  g_file_get_contents (tc->known_hosts, &contents, NULL, &error);
  g_assert_no_error (error);
  g_assert_cmpstr (contents, ==, "# comment\nblah:22 ssh-rsa xxxxyyyyzzzz\n");
  g_free (contents);
}

int
main (int argc,
      char *argv[])
{
  signal (SIGPIPE, SIG_IGN);
  g_type_init ();

  g_set_prgname ("test-machines");
  g_test_init (&argc, &argv, NULL);

  g_test_add ("/machines/add", TestCase, NULL,
              setup, test_add, teardown);
  g_test_add ("/machines/new-known-hosts", TestCase, NULL,
              setup, test_new_known_hosts, teardown);
  g_test_add ("/machines/append-known-hosts", TestCase, NULL,
              setup, test_append_known_hosts, teardown);

  return g_test_run ();
}
