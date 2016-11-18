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
#include "mock-dbus-tests.h"

#include <gio/gio.h>
#include <glib-unix.h>
#include <string.h>

typedef struct {
  GDBusConnection *connection;
  GDBusObjectManagerServer *object_manager;
  GHashTable *other_names;
} MockData;

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
on_handle_request_property_mods (TestFrobber *object,
                                 GDBusMethodInvocation *invocation,
                                 gpointer user_data)
{
  test_frobber_set_y (object, test_frobber_get_y (object) + 1);
  test_frobber_set_i (object, test_frobber_get_i (object) + 1);
  g_dbus_interface_skeleton_flush (G_DBUS_INTERFACE_SKELETON (object));
  test_frobber_complete_request_multi_property_mods (object, invocation);
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
  MockData *data = user_data;
  GDBusObject *previous;

  previous = g_dbus_object_manager_get_object (G_DBUS_OBJECT_MANAGER (data->object_manager), at_path);
  if (previous != NULL)
    {
      g_dbus_method_invocation_return_error (invocation,
                                             G_IO_ERROR, G_IO_ERROR_FAILED,
                                             "Sorry, object already exists at %s",
                                             at_path);
      g_object_unref (previous);
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

      g_signal_connect (frobber,
                        "handle-request-property-mods",
                        G_CALLBACK (on_handle_request_property_mods),
                        NULL);
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
  MockData *data = user_data;
  GDBusObject *previous;

  previous = g_dbus_object_manager_get_object (G_DBUS_OBJECT_MANAGER (data->object_manager), path);
  if (previous != NULL)
    {
      g_warn_if_fail (g_dbus_object_manager_server_unexport (data->object_manager, path));
      test_frobber_complete_delete_object (object, invocation);
      g_object_unref (previous);
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
  MockData *data = user_data;
  const gchar *path;
  GList *objects;
  GList *l;

  objects = g_dbus_object_manager_get_objects (G_DBUS_OBJECT_MANAGER (data->object_manager));
  for (l = objects; l != NULL; l = g_list_next (l))
    {
      path = g_dbus_object_get_object_path (l->data);
      if (!g_str_has_suffix (path, "/frobber"))
        g_warn_if_fail (g_dbus_object_manager_server_unexport (data->object_manager, path));
    }

  test_frobber_complete_delete_all_objects (object, invocation);
  g_list_free_full (objects, g_object_unref);
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

typedef struct {
  GDBusMethodInvocation *invocation;
} ClaimNameData;

static void
claim_name_data_free (gpointer data)
{
  ClaimNameData *claim_data = data;
  if (claim_data->invocation)
    g_object_unref (claim_data->invocation);
  g_free (claim_data);
}

static void
on_other_name_acquired (GDBusConnection *connection,
                        const gchar *name,
                        gpointer user_data)
{
  ClaimNameData *claim_data = user_data;
  if (claim_data->invocation)
    {
      g_dbus_method_invocation_return_value (claim_data->invocation, NULL);
      g_clear_object (&claim_data->invocation);
    }
}

static void
on_other_name_lost (GDBusConnection *connection,
                    const gchar *name,
                    gpointer user_data)
{
  ClaimNameData *claim_data = user_data;
  if (claim_data->invocation)
    {
      g_dbus_method_invocation_return_error (claim_data->invocation,
                                             G_IO_ERROR, G_IO_ERROR_FAILED,
                                             "Couldn't claim name: %s", name);
      g_message ("couldn't claim name: %s", name);
      g_clear_object (&claim_data->invocation);
    }
}

static gboolean
on_claim_other_name (TestFrobber *frobber,
                     GDBusMethodInvocation *invocation,
                     const gchar *name,
                     gpointer user_data)
{
  ClaimNameData *claim_data;
  MockData *mock_data = user_data;
  guint id;

  g_return_val_if_fail (g_hash_table_lookup (mock_data->other_names, name) == NULL, FALSE);

  claim_data = g_new0 (ClaimNameData, 1);
  claim_data->invocation = g_object_ref (invocation);
  id = g_bus_own_name_on_connection (mock_data->connection, name,
                                     G_BUS_NAME_OWNER_FLAGS_ALLOW_REPLACEMENT | G_BUS_NAME_OWNER_FLAGS_NONE,
                                     on_other_name_acquired,
                                     on_other_name_lost,
                                     claim_data, claim_name_data_free);

  g_hash_table_replace (mock_data->other_names, g_strdup (name), GUINT_TO_POINTER (id));
  return TRUE;
}

static gboolean
on_release_other_name (TestFrobber *frobber,
                       GDBusMethodInvocation *invocation,
                       const gchar *name,
                       gpointer user_data)
{
  MockData *mock_data = user_data;
  guint id;

  g_return_val_if_fail (g_hash_table_lookup (mock_data->other_names, name) != NULL, FALSE);

  id = GPOINTER_TO_UINT (g_hash_table_lookup (mock_data->other_names, name));
  g_hash_table_remove (mock_data->other_names, name);
  g_bus_unown_name (id);

  g_dbus_method_invocation_return_value (invocation, NULL);
  return TRUE;

}

static gboolean
on_tell_me_your_name (TestFrobber *frobber,
                      GDBusMethodInvocation *invocation,
                      gpointer user_data)
{
  GDBusMessage *message = g_dbus_method_invocation_get_message (invocation);
  GVariant *name = g_variant_new_string (g_dbus_message_get_destination (message));
  g_dbus_method_invocation_return_value (invocation, g_variant_new_tuple (&name, 1));
  return TRUE;

}

/* ------------------------------------------------------------------------
 * Non object manager stuff
 */

static GVariant *
clique_get_property (GDBusConnection *connection,
                     const gchar *sender,
                     const gchar *object_path,
                     const gchar *interface_name,
                     const gchar *property_name,
                     GError **error,
                     gpointer user_data)
{
  /* The only property is Friend */
  gchar *friend = user_data;
  return g_variant_new_object_path (friend);
}

static gboolean
on_create_clique (TestFrobber *frobber,
                  GDBusMethodInvocation *invocation,
                  const gchar *name,
                  gpointer user_data)
{
  GDBusConnection *connection = g_dbus_method_invocation_get_connection (invocation);
  GError *error = NULL;
  gchar *path = NULL;
  gchar *friend;
  gint i;

  static const GDBusInterfaceVTable vtable = {
    .method_call = NULL,
    .get_property = clique_get_property,
    .set_property = NULL,
  };

  for (i = 0; i < 3; i++)
    {
      g_free (path);
      path = g_strdup_printf ("/cliques/%s/%d", name, i);

      friend = g_strdup_printf ("/cliques/%s/%d", name, (i + 1) % 3);

      g_dbus_connection_register_object (connection, path,
                                         test_clique_interface_info (),
                                         &vtable, friend, g_free, &error);
      if (error)
        {
          g_critical ("Couldn't register new clique: %s", error->message);
          g_clear_error (&error);
        }
    }

  test_frobber_complete_create_clique (frobber, invocation, path);
  g_free (path);
  return TRUE;
}

static GVariant *
hidden_get_property (GDBusConnection *connection,
                     const gchar *sender,
                     const gchar *object_path,
                     const gchar *interface_name,
                     const gchar *property_name,
                     GError **error,
                     gpointer user_data)
{
  /* The only property is Name */
  gchar *name = user_data;
  return g_variant_new_string (name);
}

static gboolean
on_emit_hidden (TestFrobber *frobber,
                GDBusMethodInvocation *invocation,
                const gchar *name,
                gpointer user_data)
{
  GDBusConnection *connection = g_dbus_method_invocation_get_connection (invocation);
  GError *error = NULL;
  gchar *path = NULL;

  static const GDBusInterfaceVTable vtable = {
    .method_call = NULL,
    .get_property = hidden_get_property,
    .set_property = NULL,
  };

  path = g_strdup_printf ("/hidden/%s", name);

  g_dbus_connection_register_object (connection, path,
                                     test_hidden_interface_info (),
                                     &vtable, g_strdup (name), g_free, &error);
  if (error)
    {
      g_critical ("Couldn't register new hidden: %s", error->message);
      g_clear_error (&error);
    }

  g_dbus_connection_emit_signal (connection, NULL, path,
                                 "com.redhat.Cockpit.DBusTests.Hidden", "Yooohooo",
                                 g_variant_new ("()"), &error);

  if (error)
    {
      g_critical ("Couldn't emit signal on hidden: %s", error->message);
      g_clear_error (&error);
    }

  /* Now emit a signal from it */
  test_frobber_complete_emit_hidden (frobber, invocation);
  g_free (path);
  return TRUE;
}

/* ----------------------------------------------------------------------------------------------------
 * An Introspect() that actually fails
 */

static void
introspect_fail_method_call (GDBusConnection *connection,
                             const gchar *sender,
                             const gchar *object_path,
                             const gchar *interface_name,
                             const gchar *method_name,
                             GVariant *parameters,
                             GDBusMethodInvocation *invocation,
                             gpointer user_data)
{
  const gchar *dbus_error = user_data;
  g_dbus_method_invocation_return_dbus_error (invocation, dbus_error, dbus_error);
}

static void
mock_service_create_introspect_fail (GDBusConnection *connection)
{
  static const gchar introspectable_xml[] =
    "<node>"
    "  <interface name=\"org.freedesktop.DBus.Introspectable\">"
    "    <method name=\"Introspect\">"
    "      <arg type=\"s\" name=\"xml_data\" direction=\"out\"/>"
    "    </method>"
    "  </interface>"
    "</node>";

  const GDBusInterfaceVTable introspect_vtable = {
      .method_call = introspect_fail_method_call,
  };

  GDBusNodeInfo *node_info;
  GDBusInterfaceInfo *interface_info;
  GError *error = NULL;

  node_info = g_dbus_node_info_new_for_xml (introspectable_xml, &error);
  g_assert_no_error (error);

  interface_info = g_dbus_node_info_lookup_interface (node_info, "org.freedesktop.DBus.Introspectable");
  g_assert (interface_info != NULL);

  /* Return a failure when introspecting this object path */
  g_dbus_connection_register_object (connection, "/introspect/unknown", interface_info, &introspect_vtable,
                                     "org.freedesktop.DBus.Error.UnknownObject", NULL, &error);
  if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_EXISTS))
    g_error_free (error);
  else
    g_assert_no_error (error);

  g_dbus_node_info_unref (node_info);
}

/* ---------------------------------------------------------------------------------------------------- */

static void
mock_data_free (gpointer data)
{
  MockData *mock_data = data;
  g_object_unref (mock_data->connection);
  g_hash_table_destroy (mock_data->other_names);
  g_free (mock_data);
}

GObject *
mock_service_create_and_export (GDBusConnection *connection,
                                const gchar *object_manager_path)
{
  GError *error;
  TestFrobber *exported_frobber;
  TestObjectSkeleton *exported_object;
  GDBusObjectManagerServer *object_manager;
  MockData *mock_data;
  gchar *path;

  mock_data = g_new0 (MockData, 1);
  mock_data->connection = g_object_ref (connection);
  mock_data->other_names = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, NULL);

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

  object_manager = g_dbus_object_manager_server_new (object_manager_path);
  mock_data->object_manager = object_manager;
  g_object_set_data_full (G_OBJECT (object_manager), "mock-data", mock_data, mock_data_free);

  path = g_strdup_printf ("%s/frobber", object_manager_path);
  exported_object = test_object_skeleton_new (path);
  g_free (path);

  test_object_skeleton_set_frobber (exported_object, exported_frobber);
  g_dbus_object_manager_server_export (object_manager, G_DBUS_OBJECT_SKELETON (exported_object));
  g_object_unref (exported_object);

  g_dbus_object_manager_server_set_connection (object_manager, connection);

  g_assert_no_error (error);
  g_signal_connect (exported_frobber, "handle-hello-world",
                    G_CALLBACK (on_handle_hello_world), NULL);
  g_signal_connect (exported_frobber,
                    "handle-test-primitive-types",
                    G_CALLBACK (on_handle_test_primitive_types), NULL);
  g_signal_connect (exported_frobber,
                    "handle-test-non-primitive-types",
                    G_CALLBACK (on_handle_test_non_primitive_types), NULL);
  g_signal_connect (exported_frobber,
                    "handle-request-signal-emission",
                    G_CALLBACK (on_handle_request_signal_emission), NULL);
  g_signal_connect (exported_frobber,
                    "handle-request-property-mods",
                    G_CALLBACK (on_handle_request_property_mods), NULL);
  g_signal_connect (exported_frobber,
                    "handle-request-multi-property-mods",
                    G_CALLBACK (on_handle_request_multi_property_mods), NULL);
  g_signal_connect (exported_frobber,
                    "handle-property-cancellation",
                    G_CALLBACK (on_handle_property_cancellation), NULL);
  g_signal_connect (exported_frobber,
                    "handle-delete-all-objects",
                    G_CALLBACK (on_handle_delete_all_objects), mock_data);
  g_signal_connect (exported_frobber,
                    "handle-create-object",
                    G_CALLBACK (on_handle_create_object), mock_data);
  g_signal_connect (exported_frobber,
                    "handle-delete-object",
                    G_CALLBACK (on_handle_delete_object), mock_data);
  g_signal_connect (exported_frobber,
                    "handle-test-asv",
                    G_CALLBACK (on_handle_test_asv), NULL);
  g_signal_connect (exported_frobber,
                    "handle-add-alpha",
                    G_CALLBACK (on_handle_add_alpha), NULL);
  g_signal_connect (exported_frobber,
                    "handle-remove-alpha",
                    G_CALLBACK (on_handle_remove_alpha), NULL);
  g_signal_connect (exported_frobber, "handle-create-clique",
                    G_CALLBACK (on_create_clique), NULL);
  g_signal_connect (exported_frobber, "handle-emit-hidden",
                    G_CALLBACK (on_emit_hidden), NULL);

  g_signal_connect (exported_frobber, "handle-claim-other-name",
                    G_CALLBACK (on_claim_other_name), mock_data);
  g_signal_connect (exported_frobber, "handle-release-other-name",
                    G_CALLBACK (on_release_other_name), mock_data);
  g_signal_connect (exported_frobber, "handle-tell-me-your-name",
                    G_CALLBACK (on_tell_me_your_name), mock_data);

  g_object_unref (exported_frobber);
  mock_service_create_introspect_fail (connection);
  return G_OBJECT (object_manager);
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

typedef struct {
    GMainContext *context;
    gpointer *clear;
} GoneContext;

static void
on_object_gone (gpointer data,
                GObject *where_the_object_was)
{
  GoneContext *ctx = data;
  g_atomic_pointer_set (ctx->clear, NULL);
  g_main_context_wakeup (ctx->context);
}

static void
wait_until_object_gone (GMainContext *context,
                        gpointer object)
{
  GoneContext ctx = { context, &object };
  g_object_weak_ref (object, on_object_gone, &ctx);
  g_object_unref (object);
  while (g_atomic_pointer_get (&object))
    g_main_context_iteration (context, TRUE);
}

static gpointer
mock_service_thread (gpointer unused)
{
  GDBusConnection *conn;
  GObject *exported;
  GMainContext *main_ctx;
  gboolean owned = FALSE;
  GError *error = NULL;
  gchar *address;

  main_ctx = g_main_context_new ();
  g_main_context_push_thread_default (main_ctx);

  address = g_dbus_address_get_for_bus_sync (G_BUS_TYPE_SESSION, NULL, &error);
  g_assert_no_error (error);

  conn = g_dbus_connection_new_for_address_sync (address,
                                                 G_DBUS_CONNECTION_FLAGS_AUTHENTICATION_CLIENT |
                                                 G_DBUS_CONNECTION_FLAGS_MESSAGE_BUS_CONNECTION,
                                                 NULL, NULL, &error);
  g_assert_no_error (error);
  g_free (address);

  exported = mock_service_create_and_export (conn, "/otree");
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

  wait_until_object_gone (main_ctx, conn);

  while (g_main_context_iteration (main_ctx, FALSE));
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
  mock_thread = NULL;
}
