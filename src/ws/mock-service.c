/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013 Red Hat, Inc.
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

#include "mock-service.h"
#include "test-server-generated.h"

#include <gio/gio.h>
#include <glib-unix.h>
#include <string.h>

typedef struct {
  GHashTable *extra_objects;
  GDBusObjectManagerServer *object_manager;
} TestData;

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
on_handle_hello_world (TestFrobber *object,
                       GDBusMethodInvocation *invocation,
                       const gchar *greeting,
                       gpointer user_data)
{
  gchar *response;
  response = g_strdup_printf ("Word! You said `%s'. I'm Skeleton, btw!", greeting);
  test_frobber_complete_hello_world (object, invocation, response);
  g_free (response);
  return TRUE;
}

static gboolean
on_handle_test_primitive_types (TestFrobber *object,
                                GDBusMethodInvocation *invocation,
                                guchar val_byte,
                                gboolean val_boolean,
                                gint16 val_int16,
                                guint16 val_uint16,
                                gint val_int32,
                                guint val_uint32,
                                gint64 val_int64,
                                guint64 val_uint64,
                                gdouble val_double,
                                const gchar *val_string,
                                const gchar *val_objpath,
                                const gchar *val_signature,
                                const gchar *val_bytestring,
                                gpointer user_data)
{
  gchar *s1;
  gchar *s2;
  gchar *s3;
  s1 = g_strdup_printf ("Word! You said `%s'. Rock'n'roll!", val_string);
  s2 = g_strdup_printf ("/modified%s", val_objpath);
  s3 = g_strdup_printf ("assgit%s", val_signature);
  test_frobber_complete_test_primitive_types (object,
                                              invocation,
                                              10 + val_byte,
                                              !val_boolean,
                                              100 + val_int16,
                                              1000 + val_uint16,
                                              10000 + val_int32,
                                              100000 + val_uint32,
                                              1000000 + val_int64,
                                              10000000 + val_uint64,
                                              val_double / G_PI,
                                              s1,
                                              s2,
                                              s3,
                                              "bytestring!\xff");
  g_free (s1);
  g_free (s2);
  g_free (s3);
  return TRUE;
}

static gboolean
on_handle_test_non_primitive_types (TestFrobber *object,
                                    GDBusMethodInvocation *invocation,
                                    GVariant *dict_s_to_s,
                                    GVariant *dict_s_to_pairs,
                                    GVariant *a_struct,
                                    const gchar* const *array_of_strings,
                                    const gchar* const *array_of_objpaths,
                                    GVariant *array_of_signatures,
                                    const gchar* const *array_of_bytestrings,
                                    gpointer user_data)
{
  gchar *s;
  GString *str;
  str = g_string_new (NULL);
  s = g_variant_print (dict_s_to_s, TRUE);
  g_string_append (str, s);
  g_free (s);
  s = g_variant_print (dict_s_to_pairs, TRUE);
  g_string_append (str, s);
  g_free (s);
  s = g_variant_print (a_struct, TRUE);
  g_string_append (str, s);
  g_free (s);
  s = g_strjoinv (", ", (gchar **)array_of_strings);
  g_string_append_printf (str, "array_of_strings: [%s] ", s);
  g_free (s);
  s = g_strjoinv (", ", (gchar **)array_of_objpaths);
  g_string_append_printf (str, "array_of_objpaths: [%s] ", s);
  g_free (s);
  s = g_variant_print (array_of_signatures, TRUE);
  g_string_append_printf (str, "array_of_signatures: %s ", s);
  g_free (s);
  s = g_strjoinv (", ", (gchar **)array_of_bytestrings);
  g_string_append_printf (str, "array_of_bytestrings: [%s] ", s);
  g_free (s);
  test_frobber_complete_test_non_primitive_types (object, invocation, str->str);
  g_string_free (str, TRUE);
  return TRUE;
}

static gboolean
on_handle_request_signal_emission (TestFrobber *object,
                                   GDBusMethodInvocation *invocation,
                                   gint which_one,
                                   gpointer user_data)
{
  if (which_one == 0)
    {
      const gchar *a_strv[] = {"foo", "frobber", NULL};
      const gchar *a_objpath_array[] = {"/foo", "/foo/bar", NULL};
      GVariant *a_variant = g_variant_new_parsed ("{'first': (42, 42), 'second': (43, 43)}");
      test_frobber_emit_test_signal (object, 43, a_strv, a_objpath_array, a_variant); /* consumes a_variant */
      test_frobber_complete_request_signal_emission (object, invocation);
    }
  return TRUE;
}

static gboolean
on_handle_request_multi_property_mods (TestFrobber *object,
                                       GDBusMethodInvocation *invocation,
                                       gpointer user_data)
{
  test_frobber_set_y (object, test_frobber_get_y (object) + 1);
  test_frobber_set_i (object, test_frobber_get_i (object) + 1);
  test_frobber_set_y (object, test_frobber_get_y (object) + 1);
  test_frobber_set_i (object, test_frobber_get_i (object) + 1);
  g_dbus_interface_skeleton_flush (G_DBUS_INTERFACE_SKELETON (object));
  test_frobber_set_y (object, test_frobber_get_y (object) + 1);
  test_frobber_set_i (object, test_frobber_get_i (object) + 1);
  test_frobber_complete_request_multi_property_mods (object, invocation);
  return TRUE;
}

static gboolean
on_handle_property_cancellation (TestFrobber *object,
                                 GDBusMethodInvocation *invocation,
                                 gpointer user_data)
{
  guint n;
  n = test_frobber_get_n (object);
  /* This queues up a PropertiesChange event */
  test_frobber_set_n (object, n + 1);
  /* this modifies the queued up event */
  test_frobber_set_n (object, n);
  /* this flushes all PropertiesChanges event (sends the D-Bus message right
   * away, if any - there should not be any)
   */
  g_dbus_interface_skeleton_flush (G_DBUS_INTERFACE_SKELETON (object));
  /* this makes us return the reply D-Bus method */
  test_frobber_complete_property_cancellation (object, invocation);
  return TRUE;
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
on_handle_create_object (TestFrobber *object,
                         GDBusMethodInvocation *invocation,
                         const gchar *at_path,
                         gpointer user_data)
{
  TestData *data = user_data;

  if (g_hash_table_lookup (data->extra_objects, at_path) != NULL)
    {
      g_dbus_method_invocation_return_error (invocation,
                                             G_IO_ERROR, G_IO_ERROR_FAILED,
                                             "Sorry, object already exists at %s",
                                             at_path);
    }
  else
    {
      TestObjectSkeleton *new_object;
      TestFrobber *frobber;

      new_object = test_object_skeleton_new (at_path);
      frobber = test_frobber_skeleton_new ();
      test_object_skeleton_set_frobber (new_object, frobber);
      g_dbus_object_manager_server_export (data->object_manager, G_DBUS_OBJECT_SKELETON (new_object));
      g_object_unref (frobber);
      g_object_unref (new_object);

      g_hash_table_insert (data->extra_objects,
                           (gpointer) g_dbus_object_get_object_path (G_DBUS_OBJECT (new_object)),
                           new_object);

      test_frobber_complete_create_object (object, invocation);
    }
  return TRUE;
}

static gboolean
on_handle_delete_object (TestFrobber *object,
                         GDBusMethodInvocation *invocation,
                         const gchar *path,
                         gpointer user_data)
{
  TestData *data = user_data;
  if (g_hash_table_lookup (data->extra_objects, path) != NULL)
    {
      g_hash_table_remove (data->extra_objects, path);
      g_warn_if_fail (g_dbus_object_manager_server_unexport (data->object_manager, path));
      test_frobber_complete_delete_object (object, invocation);
    }
  else
    {
      g_dbus_method_invocation_return_error (invocation,
                                             G_IO_ERROR, G_IO_ERROR_FAILED,
                                             "Sorry, there is no object at %s",
                                             path);
    }
  return TRUE;
}

static gboolean
on_handle_delete_all_objects (TestFrobber *object,
                              GDBusMethodInvocation *invocation,
                              gpointer user_data)
{
  TestData *data = user_data;
  GHashTableIter iter;
  const gchar *path;

  g_hash_table_iter_init (&iter, data->extra_objects);
  while (g_hash_table_iter_next (&iter, (gpointer *)&path, NULL))
    {
      g_hash_table_iter_remove (&iter);
      g_warn_if_fail (g_dbus_object_manager_server_unexport (data->object_manager, path));
    }

  test_frobber_complete_delete_all_objects (object, invocation);
  return TRUE;
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
on_handle_test_asv (TestFrobber *object,
                    GDBusMethodInvocation *invocation,
                    GVariant *asv,
                    gpointer user_data)
{
  gchar *s;
  s = g_variant_print (asv, TRUE);
  test_frobber_complete_test_asv (object, invocation, s);
  g_free (s);
  return TRUE;
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
on_handle_add_alpha (TestFrobber *frobber,
                     GDBusMethodInvocation *invocation,
                     gpointer user_data)
{
  TestObjectSkeleton *enclosing;
  enclosing = TEST_OBJECT_SKELETON (g_dbus_interface_get_object (G_DBUS_INTERFACE (frobber)));
  if (test_object_peek_alpha (TEST_OBJECT (enclosing)) == NULL)
    {
      TestAlpha *iface = test_alpha_skeleton_new ();
      test_object_skeleton_set_alpha (enclosing, iface);
      g_object_unref (iface);
    }
  test_frobber_complete_add_alpha (frobber, invocation);
  return TRUE;
}

static gboolean
on_handle_remove_alpha (TestFrobber *frobber,
                        GDBusMethodInvocation *invocation,
                        gpointer user_data)
{
  TestObjectSkeleton *enclosing;
  enclosing = TEST_OBJECT_SKELETON (g_dbus_interface_get_object (G_DBUS_INTERFACE (frobber)));
  if (test_object_peek_alpha (TEST_OBJECT (enclosing)) != NULL)
    test_object_skeleton_set_alpha (enclosing, NULL);
  test_frobber_complete_add_alpha (frobber, invocation);
  return TRUE;
}

/* ---------------------------------------------------------------------------------------------------- */

static void
test_data_free (void *user_data)
{
  TestData *data = user_data;
  g_hash_table_unref (data->extra_objects);
  g_free (data);
}

GObject *
mock_service_create_and_export (GDBusConnection *connection)
{
  GError *error;
  TestFrobber *exported_frobber;
  TestObjectSkeleton *exported_object;
  TestData *data;

  /* Test that we can export an object using the generated
   * TestFrobberSkeleton subclass. Notes:
   *
   * 1. We handle methods by simply connecting to the appropriate
   * GObject signal.
   *
   * 2. Property storage is taken care of by the class; we can
   *    use g_object_get()/g_object_set() (and the generated
   *    C bindings at will)
   */
  error = NULL;
  exported_frobber = test_frobber_skeleton_new ();
  test_frobber_set_ay (exported_frobber, "ABCabc");
  test_frobber_set_y (exported_frobber, 42);
  test_frobber_set_d (exported_frobber, 43.0);
  test_frobber_set_finally_normal_name (exported_frobber, "There aint no place like home");
  test_frobber_set_writeonly_property (exported_frobber, "Mr. Burns");
  test_frobber_set_readonly_property (exported_frobber, "blah");

  data = g_new0 (TestData, 1);
  g_object_set_data_full (G_OBJECT (exported_frobber), "frobber-data", data, test_data_free);

  data->extra_objects = g_hash_table_new (g_str_hash, g_str_equal);
  data->object_manager = g_dbus_object_manager_server_new ("/otree");

  exported_object = test_object_skeleton_new ("/otree/frobber");
  test_object_skeleton_set_frobber (exported_object, exported_frobber);
  g_dbus_object_manager_server_export (data->object_manager, G_DBUS_OBJECT_SKELETON (exported_object));
  g_object_unref (exported_object);

  g_dbus_object_manager_server_set_connection (data->object_manager, connection);

  g_assert_no_error (error);
  g_signal_connect (exported_frobber,
                    "handle-hello-world",
                    G_CALLBACK (on_handle_hello_world),
                    data);
  g_signal_connect (exported_frobber,
                    "handle-test-primitive-types",
                    G_CALLBACK (on_handle_test_primitive_types),
                    data);
  g_signal_connect (exported_frobber,
                    "handle-test-non-primitive-types",
                    G_CALLBACK (on_handle_test_non_primitive_types),
                    data);
  g_signal_connect (exported_frobber,
                    "handle-request-signal-emission",
                    G_CALLBACK (on_handle_request_signal_emission),
                    data);
  g_signal_connect (exported_frobber,
                    "handle-request-multi-property-mods",
                    G_CALLBACK (on_handle_request_multi_property_mods),
                    data);
  g_signal_connect (exported_frobber,
                    "handle-property-cancellation",
                    G_CALLBACK (on_handle_property_cancellation),
                    data);
  g_signal_connect (exported_frobber,
                    "handle-delete-all-objects",
                    G_CALLBACK (on_handle_delete_all_objects),
                    data);
  g_signal_connect (exported_frobber,
                    "handle-create-object",
                    G_CALLBACK (on_handle_create_object),
                    data);
  g_signal_connect (exported_frobber,
                    "handle-delete-object",
                    G_CALLBACK (on_handle_delete_object),
                    data);
  g_signal_connect (exported_frobber,
                    "handle-test-asv",
                    G_CALLBACK (on_handle_test_asv),
                    data);
  g_signal_connect (exported_frobber,
                    "handle-add-alpha",
                    G_CALLBACK (on_handle_add_alpha),
                    data);
  g_signal_connect (exported_frobber,
                    "handle-remove-alpha",
                    G_CALLBACK (on_handle_remove_alpha),
                    data);

  return G_OBJECT (data->object_manager);
}

static GThread *mock_thread = NULL;
static GDBusConnection *mock_conn = NULL;
static GCond mock_cond;
static GMutex mock_mutex;

static void
on_name_acquired (GDBusConnection *connection,
                  const gchar *name,
                  gpointer user_data)
{
  gboolean *owned = user_data;
  *owned = TRUE;
}

static void
on_name_lost (GDBusConnection *connection,
              const gchar *name,
              gpointer user_data)
{
  gboolean *owned = user_data;
  *owned = FALSE;
}

static gpointer
mock_service_thread (gpointer unused)
{
  GDBusConnection *conn;
  GObject *exported;
  GMainContext *main_ctx;
  gboolean owned = FALSE;
  GError *error = NULL;

  main_ctx = g_main_context_new ();
  g_main_context_push_thread_default (main_ctx);

  conn = g_bus_get_sync (G_BUS_TYPE_SESSION, NULL, &error);
  g_assert_no_error (error);

  exported = mock_service_create_and_export (conn);
  g_assert (exported != NULL);

  g_bus_own_name_on_connection (conn, "com.redhat.Cockpit.DBusTests.Test",
                                G_BUS_NAME_OWNER_FLAGS_NONE,
                                on_name_acquired, on_name_lost, &owned, NULL);

  g_mutex_lock (&mock_mutex);

  while (!owned)
    g_main_context_iteration (main_ctx, TRUE);

  mock_conn = conn;
  g_cond_signal (&mock_cond);
  g_mutex_unlock (&mock_mutex);

  while (!g_dbus_connection_is_closed (conn))
    g_main_context_iteration (main_ctx, TRUE);

  g_mutex_lock (&mock_mutex);
  mock_conn = NULL;
  g_mutex_unlock (&mock_mutex);

  g_object_unref (exported);
  g_object_unref (conn);

  g_main_context_pop_thread_default (main_ctx);
  g_main_context_unref (main_ctx);

  return NULL;
}

void
mock_service_start (void)
{
  g_assert (mock_thread == NULL);
  mock_thread = g_thread_new ("mock-service", mock_service_thread, NULL);

  g_mutex_lock (&mock_mutex);
  while (!mock_conn)
    g_cond_wait (&mock_cond, &mock_mutex);
  g_mutex_unlock (&mock_mutex);
}

void
mock_service_stop (void)
{
  GError *error = NULL;

  g_assert (mock_thread != NULL);
  g_dbus_connection_close_sync (mock_conn, NULL, &error);
  g_assert_no_error (error);
  g_thread_join (mock_thread);
}
