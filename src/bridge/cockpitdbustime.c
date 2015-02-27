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

#include "cockpitdbusinternal.h"

static void
time_method_call (GDBusConnection *connection,
                  const gchar *sender,
                  const gchar *object_path,
                  const gchar *interface_name,
                  const gchar *method_name,
                  GVariant *parameters,
                  GDBusMethodInvocation *invocation,
                  gpointer user_data)
{
  GVariant *result;
  if (g_str_equal (method_name, "GetWallTime"))
    {
      result = g_variant_new ("(t)", (guint64)(g_get_real_time () / 1000));
      g_dbus_method_invocation_return_value (invocation, result);
    }
  else
    {
      g_return_if_reached ();
    }
}

static GDBusArgInfo time_get_wall_time_result = {
  -1, "result", "t", NULL
};

static GDBusArgInfo *time_get_wall_time_out[] = {
  &time_get_wall_time_result,
  NULL
};

static GDBusMethodInfo time_get_wall_time = {
  -1, "GetWallTime", NULL, time_get_wall_time_out, NULL
};

static GDBusMethodInfo *time_methods[] = {
  &time_get_wall_time,
  NULL
};

static GDBusInterfaceInfo time_interface = {
  -1, "cockpit.Time", time_methods, NULL, NULL, NULL
};

static GDBusInterfaceVTable time_vtable = {
  .method_call = time_method_call
};

void
cockpit_dbus_time_startup (void)
{
  GDBusConnection *connection;
  GError *error = NULL;

  connection = cockpit_dbus_internal_server ();
  g_return_if_fail (connection != NULL);

  g_dbus_connection_register_object (connection, "/time", &time_interface,
                                     &time_vtable, NULL, NULL, &error);

  if (error != NULL)
    {
      g_critical ("couldn't register DBus time object: %s", error->message);
      g_error_free (error);
    }

  g_object_unref (connection);
}
