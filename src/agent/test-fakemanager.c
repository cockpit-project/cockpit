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

#include "cockpitfakemanager.h"

#include "cockpit/cockpittest.h"
#include "cockpit/mock-service.h"

#include <sys/socket.h>
#include <errno.h>
#include <string.h>
#include <unistd.h>

typedef struct {
  gboolean mock_running;
  guint timeout;
} TestCase;

static gboolean
on_timeout_abort (gpointer unused)
{
  g_error ("timed out");
  return FALSE;
}

static void
setup_mock (TestCase *tc,
            gconstpointer unused)
{
  mock_service_start ();
  tc->timeout = g_timeout_add_seconds (10, on_timeout_abort, tc);
  tc->mock_running = TRUE;
}

static void
teardown_mock (TestCase *tc,
               gconstpointer unused)
{
  while (g_main_context_iteration (NULL, FALSE));
  if (tc->mock_running)
    mock_service_stop ();
  g_source_remove (tc->timeout);
}

static void
on_ready_get_result (GObject *source,
                     GAsyncResult *result,
                     gpointer user_data)
{
  GAsyncResult **retval = user_data;
  g_assert (retval != NULL && *retval == NULL);
  *retval = g_object_ref (result);
}

static void
on_interface_count (GDBusObjectManager *manager,
                    GDBusObject *object,
                    GDBusInterface *interface,
                    gpointer user_data)
{
  gint *count = user_data;
  (*count)++;
}

static void
on_interface_get (GDBusObjectManager *manager,
                  GDBusObject *object,
                  GDBusInterface *interface,
                  gpointer user_data)
{
  GDBusInterface **retval = user_data;
  g_assert (retval != NULL && *retval == NULL);
  *retval = g_object_ref (interface);
}

static void
on_object_get (GDBusObjectManager *manager,
               GDBusObject *object,
               gpointer user_data)
{
  GDBusObject **retval = user_data;
  g_assert (retval != NULL && *retval == NULL);
  *retval = g_object_ref (object);
}

static void
on_object_count (GDBusObjectManager *manager,
                 GDBusObject *object,
                 gpointer user_data)
{
  gint *count = user_data;
  (*count)++;
}

static gboolean
on_timeout_set_flag (gpointer data)
{
  gint *flag = data;
  *flag = 1;
  return FALSE;
}

static GDBusObjectManager *
fake_manager_new_sync (const gchar *bus_name,
                       const gchar **object_paths,
                       GError **error)
{
  GAsyncResult *result = NULL;
  GDBusObjectManager *manager;

  cockpit_fake_manager_new_for_bus (G_BUS_TYPE_SESSION,
                                    G_DBUS_OBJECT_MANAGER_CLIENT_FLAGS_DO_NOT_AUTO_START,
                                    bus_name, object_paths,
                                    NULL, on_ready_get_result, &result);

  while (result == NULL)
    g_main_context_iteration (NULL, TRUE);

  manager =  cockpit_fake_manager_new_finish (result, error);
  g_object_unref (result);

  return manager;
}

static void
test_empty (TestCase *tc,
            gconstpointer unused)
{
  const gchar *object_paths[] = { NULL };
  GDBusObjectManager *manager;
  GError *error = NULL;
  GDBusObject *object;
  GDBusInterface *interface;
  GList *objects;

  manager = fake_manager_new_sync ("com.redhat.Cockpit.DBusTests.Test",
                                   object_paths, &error);
  g_assert_no_error (error);

  objects = g_dbus_object_manager_get_objects (manager);
  g_assert (objects == NULL);

  object = g_dbus_object_manager_get_object (manager, "/otree");
  g_assert (object == NULL);

  interface = g_dbus_object_manager_get_interface (manager, "/otree", "org.freedesktop.DBus.ObjectManager");
  g_assert (interface == NULL);

  g_object_unref (manager);
}

static void
test_properties (TestCase *tc,
                 gconstpointer unused)
{
  const gchar *object_paths[] = { NULL };
  GDBusObjectManager *manager;
  GDBusConnection *connection;
  GError *error = NULL;
  gchar *name;
  gchar *name_owner;
  gint flags;

  manager = fake_manager_new_sync ("com.redhat.Cockpit.DBusTests.Test",
                                   object_paths, &error);
  g_assert_no_error (error);

  g_object_get (manager,
                "flags", &flags,
                "name", &name,
                "name-owner", &name_owner,
                "connection", &connection,
                NULL);

  g_assert_cmpint (flags, ==, G_DBUS_OBJECT_MANAGER_CLIENT_FLAGS_DO_NOT_AUTO_START);

  g_assert_cmpstr (name, ==, "com.redhat.Cockpit.DBusTests.Test");
  g_free (name);

  g_assert (g_dbus_is_unique_name (name_owner));
  g_free (name_owner);

  g_assert (G_IS_DBUS_CONNECTION (connection));
  g_object_unref (connection);
  g_object_unref (manager);
}

static void
test_async_init_race (TestCase *tc,
                      gconstpointer unused)
{
  GAsyncResult *result = NULL;
  GAsyncInitable *async;
  gboolean ret;
  GError *error = NULL;
  gint flag = 0;

  async = g_object_new (COCKPIT_TYPE_FAKE_MANAGER,
                        "bus-type", G_BUS_TYPE_SESSION,
                        "flags", G_DBUS_OBJECT_MANAGER_CLIENT_FLAGS_DO_NOT_AUTO_START,
                        "name",  "xxx.yyy",
                        NULL);

  /* Let object settle down and ask bus about the above name */
  g_timeout_add (100, on_timeout_set_flag, &flag);
  while (flag == 0)
    g_main_context_iteration (NULL, TRUE);

  /* Async init should have nothing to do */
  g_async_initable_init_async (async, G_PRIORITY_DEFAULT,
                               NULL, on_ready_get_result, &result);

  /* And yet it *still* shouldn't complete immediately */
  g_assert (result == NULL);

  while (result == NULL)
    g_main_context_iteration (NULL, TRUE);

  ret = g_async_initable_init_finish (async, result, &error);
  g_assert_no_error (error);
  g_assert (ret == TRUE);
  g_object_unref (result);

  g_object_add_weak_pointer (G_OBJECT (async), (gpointer *)&async);
  g_object_unref (async);
  g_assert (async == NULL);
}

static void
test_async_init_cancelled (TestCase *tc,
                           gconstpointer unused)
{
  GError *error = NULL;
  GAsyncResult *result = NULL;
  GDBusObjectManager *manager;
  GCancellable *cancellable;

  cancellable = g_cancellable_new ();
  g_cancellable_cancel (cancellable);
  cockpit_fake_manager_new_for_bus (G_BUS_TYPE_SESSION,
                                    G_DBUS_OBJECT_MANAGER_CLIENT_FLAGS_DO_NOT_AUTO_START,
                                    "com.redhat.Cockpit.DBusTests.Test", NULL,
                                    cancellable, on_ready_get_result, &result);
  g_object_unref (cancellable);

  while (result == NULL)
    g_main_context_iteration (NULL, TRUE);

  manager =  cockpit_fake_manager_new_finish (result, &error);
  g_assert_error (error, G_IO_ERROR, G_IO_ERROR_CANCELLED);
  g_assert (manager == NULL);

  g_object_add_weak_pointer (G_OBJECT (result), (gpointer *)&result);
  g_object_unref (result);
  g_assert (result == NULL);
}

static void
test_async_cancelled_after (TestCase *tc,
                            gconstpointer unused)
{
  GError *error = NULL;
  GAsyncResult *result = NULL;
  GDBusObjectManager *manager;
  GCancellable *cancellable;

  cancellable = g_cancellable_new ();
  cockpit_fake_manager_new_for_bus (G_BUS_TYPE_SESSION,
                                    G_DBUS_OBJECT_MANAGER_CLIENT_FLAGS_DO_NOT_AUTO_START,
                                    "com.redhat.Cockpit.DBusTests.Test", NULL,
                                    cancellable, on_ready_get_result, &result);
  while (result == NULL)
    {
      g_main_context_iteration (NULL, TRUE);
      g_cancellable_cancel (cancellable);
    }

  g_object_unref (cancellable);

  manager =  cockpit_fake_manager_new_finish (result, &error);
  g_assert_error (error, G_IO_ERROR, G_IO_ERROR_CANCELLED);
  g_assert (manager == NULL);

  g_object_add_weak_pointer (G_OBJECT (result), (gpointer *)&result);
  g_object_unref (result);
  g_assert (result == NULL);
}

static void
test_invalid_paths (TestCase *tc,
                    gconstpointer unused)
{
  const gchar *object_paths[] = { "/invalid/path1", "/invalid/path2", NULL };
  GDBusObjectManager *manager;
  GError *error = NULL;
  GList *objects;

  manager = fake_manager_new_sync ("com.redhat.Cockpit.DBusTests.Test",
                                   object_paths, &error);
  g_assert_no_error (error);

  objects = g_dbus_object_manager_get_objects (manager);
  g_assert (objects == NULL);

  g_object_unref (manager);
}

static void
test_introspect_unknown (TestCase *tc,
                         gconstpointer unused)
{
  const gchar *object_paths[] = { "/introspect/unknown", NULL };
  GDBusObjectManager *manager;
  GError *error = NULL;
  GList *objects;

  manager = fake_manager_new_sync ("com.redhat.Cockpit.DBusTests.Test",
                                   object_paths, &error);
  g_assert_no_error (error);

  objects = g_dbus_object_manager_get_objects (manager);
  g_assert (objects == NULL);

  g_object_unref (manager);
}

static void
test_valid_path (TestCase *tc,
                 gconstpointer unused)
{
  const gchar *object_paths[] = { "/otree", NULL };
  GDBusObjectManager *manager;
  GError *error = NULL;
  GList *objects;
  GDBusProxy *proxy;
  GDBusInterface *interface;
  GDBusObject *object;
  GVariant *prop;

  manager = fake_manager_new_sync ("com.redhat.Cockpit.DBusTests.Test",
                                   object_paths, &error);
  g_assert_no_error (error);

  objects = g_dbus_object_manager_get_objects (manager);
  g_assert_cmpint (g_list_length (objects), ==, 2);
  g_list_free_full (objects, g_object_unref);

  interface = g_dbus_object_manager_get_interface (manager, "/otree", "org.freedesktop.DBus.ObjectManager");
  g_assert (G_IS_DBUS_INTERFACE (interface));
  g_assert (G_IS_DBUS_PROXY (interface));
  proxy = G_DBUS_PROXY (interface);
  g_assert_cmpstr (g_dbus_proxy_get_object_path (proxy), ==, "/otree");
  g_assert_cmpstr (g_dbus_proxy_get_interface_name (proxy), ==, "org.freedesktop.DBus.ObjectManager");
  g_assert (g_dbus_proxy_get_interface_info (proxy) != NULL);
  g_assert_cmpstr (g_dbus_proxy_get_interface_info (proxy)->name, ==, "org.freedesktop.DBus.ObjectManager");
  g_assert (g_dbus_interface_info_lookup_method (g_dbus_proxy_get_interface_info (proxy), "GetManagedObjects") != NULL);
  g_object_unref (interface);

  object = g_dbus_object_manager_get_object (manager, "/otree");
  g_assert (G_IS_DBUS_OBJECT (object));
  interface = g_dbus_object_get_interface (object, "org.freedesktop.DBus.ObjectManager");
  g_assert (G_DBUS_PROXY (interface) == proxy);
  g_object_unref (interface);
  g_object_unref (object);

  interface = g_dbus_object_manager_get_interface (manager, "/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber");
  g_assert (G_IS_DBUS_INTERFACE (interface));
  g_assert (G_IS_DBUS_PROXY (interface));
  proxy = G_DBUS_PROXY (interface);
  g_assert_cmpstr (g_dbus_proxy_get_object_path (proxy), ==, "/otree/frobber");
  g_assert_cmpstr (g_dbus_proxy_get_interface_name (proxy), ==, "com.redhat.Cockpit.DBusTests.Frobber");
  g_assert (g_dbus_proxy_get_interface_info (proxy) != NULL);
  g_assert_cmpstr (g_dbus_proxy_get_interface_info (proxy)->name, ==, "com.redhat.Cockpit.DBusTests.Frobber");
  g_assert (g_dbus_interface_info_lookup_property (g_dbus_proxy_get_interface_info (proxy), "FinallyNormalName") != NULL);

  prop = g_dbus_proxy_get_cached_property (proxy, "FinallyNormalName");
  g_assert (prop != NULL);
  g_assert_cmpstr (g_variant_get_type_string (prop), ==, "s");
  g_assert_cmpstr (g_variant_get_string (prop, NULL), ==, "There aint no place like home");
  g_variant_unref (prop);

  g_object_unref (interface);

  g_object_unref (manager);
}

static void
test_default_path (TestCase *tc,
                   gconstpointer unused)
{
  GDBusObjectManager *manager;
  GError *error = NULL;
  GList *objects;

  /* Null paths should get everything */
  manager = fake_manager_new_sync ("com.redhat.Cockpit.DBusTests.Test",
                                   NULL, &error);
  g_assert_no_error (error);

  objects = g_dbus_object_manager_get_objects (manager);
  g_assert_cmpint (g_list_length (objects), ==, 2);
  g_list_free_full (objects, g_object_unref);

  g_object_unref (manager);
}

static void
test_poke_path (TestCase *tc,
                 gconstpointer unused)
{
  const gchar *object_paths[] = { NULL };
  GDBusObjectManager *manager;
  GError *error = NULL;
  GList *objects;
  GDBusInterface *interface;
  gint count = 0;

  manager = fake_manager_new_sync ("com.redhat.Cockpit.DBusTests.Test",
                                   object_paths, &error);
  g_assert_no_error (error);

  /* No objects at first */
  objects = g_dbus_object_manager_get_objects (manager);
  g_assert_cmpint (g_list_length (objects), ==, 0);

  cockpit_fake_manager_poke (COCKPIT_FAKE_MANAGER (manager), "/otree");
  cockpit_fake_manager_poke (COCKPIT_FAKE_MANAGER (manager), "/otree");
  cockpit_fake_manager_poke (COCKPIT_FAKE_MANAGER (manager), "/");

  /* Yessir, the above should never complete immediately */
  g_signal_connect (manager, "interface-added", G_CALLBACK (on_interface_count), &count);

  while (count < 2)
    g_main_context_iteration (NULL, TRUE);

  /* Now we should have two objects and two interfaces */
  objects = g_dbus_object_manager_get_objects (manager);
  g_assert_cmpint (g_list_length (objects), ==, 2);
  g_list_free_full (objects, g_object_unref);

  interface = g_dbus_object_manager_get_interface (manager, "/otree", "org.freedesktop.DBus.ObjectManager");
  g_assert (G_IS_DBUS_INTERFACE (interface));
  g_object_unref (interface);

  interface = g_dbus_object_manager_get_interface (manager, "/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber");
  g_object_unref (interface);

  g_object_unref (manager);
}

static void
test_add_object (TestCase *tc,
                 gconstpointer unused)
{
  const gchar *object_paths[] = { "/otree", NULL };
  GDBusObjectManager *manager;
  GError *error = NULL;
  GList *objects;
  GDBusProxy *proxy;
  GDBusInterface *interface = NULL;
  GDBusObject *object = NULL;
  GVariant *retval;

  manager = fake_manager_new_sync ("com.redhat.Cockpit.DBusTests.Test",
                                   object_paths, &error);
  g_assert_no_error (error);

  /* Start off with two objects */
  objects = g_dbus_object_manager_get_objects (manager);
  g_assert_cmpint (g_list_length (objects), ==, 2);
  g_list_free_full (objects, g_object_unref);

  g_signal_connect (manager, "object-added", G_CALLBACK (on_object_get), &object);
  g_signal_connect (manager, "interface-added", G_CALLBACK (on_interface_get), &interface);

  /* Now we call one to add an object */
  proxy = G_DBUS_PROXY (g_dbus_object_manager_get_interface (manager, "/otree/frobber",
                                                             "com.redhat.Cockpit.DBusTests.Frobber"));

  /* This is a subpath of /otree because GDbusObjectManagerServer is artificially limited to that */
  retval = g_dbus_proxy_call_sync (proxy, "CreateObject", g_variant_new ("(o)", "/otree/my/object/path"),
                                   G_DBUS_CALL_FLAGS_NO_AUTO_START, -1, NULL, &error);
  g_assert_no_error (error);
  g_variant_unref (retval);

  g_object_unref (proxy);

  while (object == NULL)
    g_main_context_iteration (NULL, TRUE);
  while (interface == NULL)
    g_main_context_iteration (NULL, TRUE);

  g_assert (G_IS_DBUS_INTERFACE (interface));
  g_assert (G_IS_DBUS_PROXY (interface));
  proxy = G_DBUS_PROXY (interface);
  g_assert_cmpstr (g_dbus_proxy_get_object_path (proxy), ==, "/otree/my/object/path");
  g_assert_cmpstr (g_dbus_proxy_get_interface_name (proxy), ==, "com.redhat.Cockpit.DBusTests.Frobber");
  g_assert (g_dbus_proxy_get_interface_info (proxy) != NULL);
  g_assert_cmpstr (g_dbus_proxy_get_interface_info (proxy)->name, ==, "com.redhat.Cockpit.DBusTests.Frobber");

  g_assert (G_IS_DBUS_OBJECT (object));
  g_assert_cmpstr (g_dbus_object_get_object_path (object), ==, "/otree/my/object/path");
  interface = g_dbus_object_get_interface (object, "com.redhat.Cockpit.DBusTests.Frobber");
  g_assert (G_DBUS_PROXY (interface) == proxy);
  g_object_unref (interface);

  g_object_unref (proxy);
  g_object_unref (object);

  g_object_unref (manager);
}

static void
test_remove_object (TestCase *tc,
                    gconstpointer unused)
{
  const gchar *object_paths[] = { "/otree", NULL };
  GDBusObjectManager *manager;
  GError *error = NULL;
  GDBusProxy *proxy;
  GDBusInterface *interface = NULL;
  GDBusObject *object = NULL;
  GVariant *retval;

  manager = fake_manager_new_sync ("com.redhat.Cockpit.DBusTests.Test",
                                   object_paths, &error);
  g_assert_no_error (error);

  g_signal_connect (manager, "object-removed", G_CALLBACK (on_object_get), &object);
  g_signal_connect (manager, "interface-removed", G_CALLBACK (on_interface_get), &interface);

  /* Now we call one to add an object */
  proxy = G_DBUS_PROXY (g_dbus_object_manager_get_interface (manager, "/otree/frobber",
                                                             "com.redhat.Cockpit.DBusTests.Frobber"));

  retval = g_dbus_proxy_call_sync (proxy, "DeleteObject", g_variant_new ("(o)", "/otree/frobber"),
                                   G_DBUS_CALL_FLAGS_NO_AUTO_START, -1, NULL, &error);
  g_assert_no_error (error);
  g_variant_unref (retval);

  g_object_unref (proxy);

  while (interface == NULL)
    g_main_context_iteration (NULL, TRUE);
  while (object == NULL)
    g_main_context_iteration (NULL, TRUE);

  g_assert (G_IS_DBUS_INTERFACE (interface));
  g_assert (G_IS_DBUS_PROXY (interface));
  proxy = G_DBUS_PROXY (interface);
  g_assert_cmpstr (g_dbus_proxy_get_object_path (proxy), ==, "/otree/frobber");
  g_assert_cmpstr (g_dbus_proxy_get_interface_name (proxy), ==, "com.redhat.Cockpit.DBusTests.Frobber");
  g_assert (g_dbus_proxy_get_interface_info (proxy) != NULL);
  g_assert_cmpstr (g_dbus_proxy_get_interface_info (proxy)->name, ==, "com.redhat.Cockpit.DBusTests.Frobber");

  g_assert (G_IS_DBUS_OBJECT (object));
  g_assert_cmpstr (g_dbus_object_get_object_path (object), ==, "/otree/frobber");
  interface = g_dbus_object_get_interface (object, "com.redhat.Cockpit.DBusTests.Frobber");
  g_assert (interface == NULL);

  g_object_unref (proxy);
  g_object_unref (object);

  g_object_unref (manager);
}

static void
test_name_vanished (TestCase *tc,
                    gconstpointer unused)
{
  const gchar *object_paths[] = { "/otree", NULL };
  GDBusObjectManager *manager;
  GError *error = NULL;
  gint removed = 0;
  GList *objects;

  manager = fake_manager_new_sync ("com.redhat.Cockpit.DBusTests.Test",
                                   object_paths, &error);
  g_assert_no_error (error);

  /* Start off with two objects */
  objects = g_dbus_object_manager_get_objects (manager);
  g_assert_cmpint (g_list_length (objects), ==, 2);
  g_list_free_full (objects, g_object_unref);

  g_signal_connect (manager, "object-removed", G_CALLBACK (on_object_count), &removed);

  mock_service_stop ();
  tc->mock_running = FALSE;

  while (removed < 2)
    g_main_context_iteration (NULL, TRUE);

  /* No more objects present */
  objects = g_dbus_object_manager_get_objects (manager);
  g_assert_cmpint (g_list_length (objects), ==, 0);

  g_object_unref (manager);
}

static void
test_connection_closed (TestCase *tc,
                        gconstpointer unused)
{
  const gchar *object_paths[] = { "/otree", NULL };
  GDBusObjectManager *manager;
  GDBusConnection *connection;
  GError *error = NULL;
  gint removed = 0;
  GList *objects;

  manager = fake_manager_new_sync ("com.redhat.Cockpit.DBusTests.Test",
                                   object_paths, &error);
  g_assert_no_error (error);

  /* Start off with two objects */
  objects = g_dbus_object_manager_get_objects (manager);
  g_assert_cmpint (g_list_length (objects), ==, 2);
  g_list_free_full (objects, g_object_unref);

  g_signal_connect (manager, "object-removed", G_CALLBACK (on_object_count), &removed);

  connection = cockpit_fake_manager_get_connection (COCKPIT_FAKE_MANAGER (manager));
  g_dbus_connection_close (connection, NULL, NULL, NULL);

  while (removed < 2)
    g_main_context_iteration (NULL, TRUE);

  /* No more objects present */
  objects = g_dbus_object_manager_get_objects (manager);
  g_assert_cmpint (g_list_length (objects), ==, 0);

  g_object_unref (manager);
}

static void
on_interface_signal (GDBusObjectManager *manager,
                     GDBusObjectProxy *object_proxy,
                     GDBusProxy *proxy,
                     gchar *sender_name,
                     gchar *signal_name,
                     GVariant *parameters,
                     gpointer user_data)
{
  gboolean *flag = user_data;
  gchar *str;

  g_assert_cmpstr ("/otree/frobber", ==, g_dbus_object_get_object_path (G_DBUS_OBJECT (object_proxy)));

  g_assert_cmpstr ("/otree/frobber", ==, g_dbus_proxy_get_object_path (proxy));
  g_assert_cmpstr ("com.redhat.Cockpit.DBusTests.Frobber", ==, g_dbus_proxy_get_interface_name (proxy));

  g_assert (g_dbus_is_unique_name (sender_name));
  g_assert_cmpstr (signal_name, ==, "TestSignal");

  str = g_variant_print (parameters, FALSE);
  g_assert_cmpstr (str, ==, "(43, ['foo', 'frobber'], ['/foo', '/foo/bar'], {'first': (42, 42), 'second': (43, 43)})");
  g_free (str);

  *flag = TRUE;
}

static void
on_proxy_signal (GDBusProxy *proxy,
                 gchar *sender_name,
                 gchar *signal_name,
                 GVariant *parameters,
                 gpointer user_data)
{
  gboolean *flag = user_data;
  gchar *str;

  g_assert_cmpstr ("/otree/frobber", ==, g_dbus_proxy_get_object_path (proxy));
  g_assert_cmpstr ("com.redhat.Cockpit.DBusTests.Frobber", ==, g_dbus_proxy_get_interface_name (proxy));

  g_assert (g_dbus_is_unique_name (sender_name));
  g_assert_cmpstr (signal_name, ==, "TestSignal");

  str = g_variant_print (parameters, FALSE);
  g_assert_cmpstr (str, ==, "(43, ['foo', 'frobber'], ['/foo', '/foo/bar'], {'first': (42, 42), 'second': (43, 43)})");
  g_free (str);

  *flag = TRUE;
}

static void
test_signal_emission (TestCase *tc,
                      gconstpointer unused)
{
  const gchar *object_paths[] = { "/otree/frobber", NULL };
  GDBusObjectManager *manager;
  GError *error = NULL;
  gboolean manager_fired = FALSE;
  gboolean proxy_fired = FALSE;
  GDBusProxy *proxy;
  GVariant *retval;

  manager = fake_manager_new_sync ("com.redhat.Cockpit.DBusTests.Test",
                                   object_paths, &error);
  g_assert_no_error (error);

  g_signal_connect (manager, "interface-proxy-signal",
                    G_CALLBACK (on_interface_signal), &manager_fired);

  /* Now we call one to add an object */
  proxy = G_DBUS_PROXY (g_dbus_object_manager_get_interface (manager, "/otree/frobber",
                                                             "com.redhat.Cockpit.DBusTests.Frobber"));

  g_signal_connect (proxy, "g-signal",
                    G_CALLBACK (on_proxy_signal), &proxy_fired);

  /* This is a subpath of /otree because GDbusObjectManagerServer is artificially limited to that */
  retval = g_dbus_proxy_call_sync (proxy, "RequestSignalEmission", g_variant_new ("(i)", 0),
                                   G_DBUS_CALL_FLAGS_NO_AUTO_START, -1, NULL, &error);
  g_assert_no_error (error);
  g_variant_unref (retval);

  while (g_main_context_iteration (NULL, FALSE));

  g_object_unref (proxy);

  /* We should have seen signal fire through both manager and proxy */
  g_assert (manager_fired == TRUE);
  g_assert (proxy_fired == TRUE);

  g_object_unref (manager);
}

static void
on_interface_properties_changed (GDBusObjectManager *manager,
                                 GDBusObjectProxy *object_proxy,
                                 GDBusProxy *proxy,
                                 GVariant *changed_properties,
                                 GStrv invalidated_properties,
                                 gpointer user_data)
{
  gboolean *flag = user_data;
  gchar *str;

  g_assert_cmpstr ("/otree/frobber", ==, g_dbus_object_get_object_path (G_DBUS_OBJECT (object_proxy)));

  g_assert_cmpstr ("/otree/frobber", ==, g_dbus_proxy_get_object_path (proxy));
  g_assert_cmpstr ("com.redhat.Cockpit.DBusTests.Frobber", ==, g_dbus_proxy_get_interface_name (proxy));

  str = g_variant_print (changed_properties, FALSE);
  g_assert_cmpstr (str, ==, "{'i': <1>, 'y': <byte 0x2b>}");
  g_free (str);

  *flag = TRUE;
}

static void
on_proxy_properties_changed (GDBusProxy *proxy,
                             GVariant *changed_properties,
                             GStrv invalidated_properties,
                             gpointer user_data)
{
  gboolean *flag = user_data;
  gchar *str;

  g_assert_cmpstr ("/otree/frobber", ==, g_dbus_proxy_get_object_path (proxy));
  g_assert_cmpstr ("com.redhat.Cockpit.DBusTests.Frobber", ==, g_dbus_proxy_get_interface_name (proxy));

  str = g_variant_print (changed_properties, FALSE);
  g_assert_cmpstr (str, ==, "{'i': <1>, 'y': <byte 0x2b>}");
  g_free (str);

  *flag = TRUE;
}

static void
test_properties_changed (TestCase *tc,
                         gconstpointer unused)
{
  const gchar *object_paths[] = { "/otree/frobber", NULL };
  GDBusObjectManager *manager;
  GError *error = NULL;
  gboolean manager_fired = FALSE;
  gboolean proxy_fired = FALSE;
  GDBusProxy *proxy;
  GVariant *retval;

  manager = fake_manager_new_sync ("com.redhat.Cockpit.DBusTests.Test",
                                   object_paths, &error);
  g_assert_no_error (error);

  g_signal_connect (manager, "interface-proxy-properties-changed",
                    G_CALLBACK (on_interface_properties_changed), &manager_fired);

  /* Now we call one to add an object */
  proxy = G_DBUS_PROXY (g_dbus_object_manager_get_interface (manager, "/otree/frobber",
                                                             "com.redhat.Cockpit.DBusTests.Frobber"));

  g_signal_connect (proxy, "g-properties-changed",
                    G_CALLBACK (on_proxy_properties_changed), &proxy_fired);

  /* This is a subpath of /otree because GDbusObjectManagerServer is artificially limited to that */
  retval = g_dbus_proxy_call_sync (proxy, "RequestPropertyMods", g_variant_new ("()"),
                                   G_DBUS_CALL_FLAGS_NO_AUTO_START, -1, NULL, &error);
  g_assert_no_error (error);
  g_variant_unref (retval);

  while (g_main_context_iteration (NULL, FALSE));

  g_object_unref (proxy);

  /* We should have seen signal fire through both manager and proxy */
  g_assert (manager_fired == TRUE);
  g_assert (proxy_fired == TRUE);

  g_object_unref (manager);
}

int
main (int argc,
      char *argv[])
{
  GTestDBus *bus;
  gint ret;

  cockpit_test_init (&argc, &argv);

  g_test_add ("/fake-manager/empty", TestCase, NULL,
              setup_mock, test_empty, teardown_mock);
  g_test_add ("/fake-manager/properties", TestCase, NULL,
              setup_mock, test_properties, teardown_mock);
  g_test_add ("/fake-manager/async-init-race", TestCase, NULL,
              setup_mock, test_async_init_race, teardown_mock);
  g_test_add ("/fake-manager/async-init-cancelled", TestCase, NULL,
              setup_mock, test_async_init_cancelled, teardown_mock);
  g_test_add ("/fake-manager/async-cancelled-after", TestCase, NULL,
              setup_mock, test_async_cancelled_after, teardown_mock);
  g_test_add ("/fake-manager/invalid-paths", TestCase, NULL,
              setup_mock, test_invalid_paths, teardown_mock);
  g_test_add ("/fake-manager/introspect-unknown", TestCase, NULL,
              setup_mock, test_introspect_unknown, teardown_mock);
  g_test_add ("/fake-manager/valid-path", TestCase, NULL,
              setup_mock, test_valid_path, teardown_mock);
  g_test_add ("/fake-manager/default-path", TestCase, NULL,
              setup_mock, test_default_path, teardown_mock);
  g_test_add ("/fake-manager/poke-path", TestCase, NULL,
              setup_mock, test_poke_path, teardown_mock);
  g_test_add ("/fake-manager/add-object", TestCase, NULL,
              setup_mock, test_add_object, teardown_mock);
  g_test_add ("/fake-manager/remove-object", TestCase, NULL,
              setup_mock, test_remove_object, teardown_mock);
  g_test_add ("/fake-manager/signal-emission", TestCase, NULL,
              setup_mock, test_signal_emission, teardown_mock);
  g_test_add ("/fake-manager/properties-changed", TestCase, NULL,
              setup_mock, test_properties_changed, teardown_mock);

  g_test_add ("/fake-manager/name-vanished", TestCase, NULL,
              setup_mock, test_name_vanished, teardown_mock);
  g_test_add ("/fake-manager/connection-closed", TestCase, NULL,
              setup_mock, test_connection_closed, teardown_mock);

  /* This isolates us from affecting other processes during tests */
  bus = g_test_dbus_new (G_TEST_DBUS_NONE);
  g_test_dbus_up (bus);

  ret = g_test_run ();

  g_test_dbus_down (bus);

  return ret;
}
