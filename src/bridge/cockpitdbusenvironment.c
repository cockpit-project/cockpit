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

static GVariant *
environment_get_property (GDBusConnection *connection,
                          const gchar *sender,
                          const gchar *object_path,
                          const gchar *interface_name,
                          const gchar *property_name,
                          GError **error,
                          gpointer user_data)
{
  GVariant *variables = user_data;

  g_return_val_if_fail (g_strcmp0 (property_name, "Variables") == 0, NULL);
  g_return_val_if_fail (variables != NULL, NULL);
  return g_variant_ref (variables);
}

static GDBusInterfaceVTable environment_vtable = {
  .get_property = environment_get_property,
};

static GDBusPropertyInfo environment_variables_property = {
  -1, "Variables", "a{ss}", G_DBUS_PROPERTY_INFO_FLAGS_READABLE, NULL
};

static GDBusPropertyInfo *environment_properties[] = {
  &environment_variables_property,
  NULL
};

static GDBusInterfaceInfo environment_interface = {
  -1, "cockpit.Environment", NULL, NULL, environment_properties, NULL
};

static GVariant *
generate_environment_variant (void)
{
  GVariantBuilder builder;
  GVariant *variant;

  gchar **environ = g_listenv ();
  gint i;

  g_variant_builder_init (&builder, G_VARIANT_TYPE ("a{ss}"));
  for (i = 0; environ[i] != NULL; i++)
    {
      const gchar *value = g_getenv (environ[i]);
      if (value)
        g_variant_builder_add (&builder, "{ss}", environ[i], value);
    }

  g_strfreev (environ);
  variant = g_variant_builder_end (&builder);
  return g_variant_ref_sink (variant);
}

void
cockpit_dbus_environment_startup (void)
{
  GDBusConnection *connection;
  GError *error = NULL;
  GVariant *variables = generate_environment_variant();

  connection = cockpit_dbus_internal_server ();
  g_return_if_fail (connection != NULL);

  g_dbus_connection_register_object (connection, "/environment", &environment_interface,
                                     &environment_vtable, variables,
                                     (GDestroyNotify)g_variant_unref, &error);

  if (error != NULL)
    {
      g_critical ("couldn't register DBus environment object: %s", error->message);
      g_error_free (error);
    }

  g_object_unref (connection);
}
