/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
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

#include "cockpitdbusinternal.h"

#include "common/cockpittest.h"

#include <gio/gio.h>
#include <glib/gstdio.h>

typedef struct {
  GDBusConnection *connection;
} TestCase;

static void
setup (TestCase *tc,
       gconstpointer unused)
{
  cockpit_dbus_internal_startup (FALSE);

  cockpit_dbus_process_startup ();
  while (g_main_context_iteration (NULL, FALSE));

  tc->connection = cockpit_dbus_internal_client();
}

static void
teardown (TestCase *tc,
          gconstpointer unused)
{
  cockpit_assert_expected ();
  g_object_unref (tc->connection);
  cockpit_dbus_internal_cleanup ();
}

static void
on_complete_get_result (GObject *source,
                        GAsyncResult *result,
                        gpointer user_data)
{
  GAsyncResult **ret = user_data;
  g_assert (ret != NULL);
  g_assert (*ret == NULL);
  *ret = g_object_ref (result);
}

static GVariant *
dbus_call_with_main_loop (TestCase *tc,
                          const gchar *object_path,
                          const gchar *interface_name,
                          const gchar *method_name,
                          GVariant *parameters,
                          const GVariantType *reply_type,
                          GError **error)
{
  GAsyncResult *result = NULL;
  GVariant *retval;

  g_dbus_connection_call (tc->connection, NULL, object_path,
                          interface_name, method_name, parameters,
                          reply_type, G_DBUS_CALL_FLAGS_NONE, -1,
                          NULL, on_complete_get_result, &result);

  while (result == NULL)
    g_main_context_iteration (NULL, TRUE);

  retval = g_dbus_connection_call_finish (tc->connection, result, error);
  g_object_unref (result);

  return retval;
}

static void
test_get_properties (TestCase *tc,
                     gconstpointer unused)
{
  GVariant *retval;
  GVariant *inner = NULL;
  GVariant *variable = NULL;
  gchar **environ = g_listenv ();
  gint i;

  GError *error = NULL;

  retval = dbus_call_with_main_loop (tc, "/bridge", "org.freedesktop.DBus.Properties", "GetAll",
                                     g_variant_new ("(s)", "cockpit.Process"),
                                     G_VARIANT_TYPE ("(a{sv})"), &error);

  g_assert_no_error (error);

  inner = g_variant_get_child_value (retval, 0);
  variable = g_variant_lookup_value (inner, "Environment", G_VARIANT_TYPE ("a{ss}"));
  for (i = 0; environ[i] != NULL; i++)
    {
      gchar *value = NULL;
      g_assert_true (g_variant_lookup (variable, environ[i], "&s", &value));
      g_assert_cmpstr (g_getenv (environ[i]), ==, value);
    }
  g_variant_unref (variable);

  variable = g_variant_lookup_value (inner, "Pid", G_VARIANT_TYPE ("u"));
  g_assert (variable != NULL);
  g_assert_cmpuint (g_variant_get_uint32 (variable), ==, getpid ());
  g_variant_unref (variable);

  variable = g_variant_lookup_value (inner, "Uid", G_VARIANT_TYPE ("i"));
  g_assert (variable != NULL);
  g_assert_cmpuint (g_variant_get_int32 (variable), ==, getuid ());
  g_variant_unref (variable);

  variable = g_variant_lookup_value (inner, "SessionId", G_VARIANT_TYPE ("s"));
  g_assert (variable != NULL);
  /* Not always a valid string during testing */
  g_variant_unref (variable);

  variable = g_variant_lookup_value (inner, "StartTime", G_VARIANT_TYPE ("t"));
  g_assert (variable != NULL);
  g_assert_cmpuint (g_variant_get_uint64 (variable), !=, 0);
  g_variant_unref (variable);

  g_variant_unref (inner);
  g_variant_unref (retval);
  g_strfreev (environ);
}

int
main (int argc,
      char *argv[])
{
  cockpit_test_init (&argc, &argv);

  g_test_add ("/process/get-properties", TestCase, NULL,
              setup, test_get_properties, teardown);

  return g_test_run ();
}
