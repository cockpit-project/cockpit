/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2019 Red Hat, Inc.
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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

#include "config.h"

#include "cockpitdbusinternal.h"
#include "common/cockpitconf.h"

static void
config_method_call (GDBusConnection *connection,
                    const gchar *sender,
                    const gchar *object_path,
                    const gchar *interface_name,
                    const gchar *method_name,
                    GVariant *parameters,
                    GDBusMethodInvocation *invocation,
                    gpointer user_data)
{
  if (g_str_equal (method_name, "Reload"))
    {
      cockpit_conf_cleanup ();
      g_dbus_method_invocation_return_value (invocation, NULL);
    }
  else if (g_str_equal (method_name, "GetString"))
    {
      const gchar *section, *key;
      const char *result;

      g_variant_get (parameters, "(&s&s)", &section, &key);

      result = cockpit_conf_string (section, key);
      if (result)
        g_dbus_method_invocation_return_value (invocation, g_variant_new ("(s)", result));
      else
        g_dbus_method_invocation_return_error (invocation, G_DBUS_ERROR, G_DBUS_ERROR_FAILED,
                                               "key '%s' in section '%s' does not exist",
                                               key, section);
    }
  else if (g_str_equal (method_name, "GetUInt"))
    {
      const gchar *section, *key;
      unsigned _default, max, min;
      unsigned result;

      g_variant_get (parameters, "(&s&suuu)", &section, &key, &_default, &max, &min);
      result = cockpit_conf_uint (section, key, _default, max, min);
      g_dbus_method_invocation_return_value (invocation, g_variant_new ("(u)", result));
    }
  else
    {
      g_return_if_reached ();
    }
}

static GDBusInterfaceVTable config_vtable = {
  .method_call = config_method_call,
};

static GDBusArgInfo config_section_arg = {
  -1, "section", "s", NULL
};

static GDBusArgInfo config_key_arg = {
  -1, "key", "s", NULL
};

static GDBusArgInfo config_default_uint_arg = {
  -1, "default", "u", NULL
};

static GDBusArgInfo config_max_uint_arg = {
  -1, "max", "u", NULL
};

static GDBusArgInfo config_min_uint_arg = {
  -1, "min", "u", NULL
};

static GDBusArgInfo *config_getstring_in_args[] = {
  &config_section_arg,
  &config_key_arg,
  NULL
};

static GDBusArgInfo config_string_value_arg = {
  -1, "value", "s", NULL
};

static GDBusArgInfo *config_string_value_out_args[] = {
  &config_string_value_arg,
  NULL
};

static GDBusArgInfo config_uint_value_arg = {
  -1, "value", "u", NULL
};

static GDBusArgInfo *config_uint_value_out_args[] = {
  &config_uint_value_arg,
  NULL
};

static GDBusArgInfo *config_getuint_in_args[] = {
  &config_section_arg,
  &config_key_arg,
  &config_default_uint_arg,
  &config_max_uint_arg,
  &config_min_uint_arg,
  NULL
};

static GDBusMethodInfo config_reload_method = {
  -1, "Reload", NULL, NULL, NULL
};

static GDBusMethodInfo config_getstring_method = {
  -1, "GetString", config_getstring_in_args, config_string_value_out_args, NULL
};

static GDBusMethodInfo config_getuint_method = {
  -1, "GetUInt", config_getuint_in_args, config_uint_value_out_args, NULL
};

static GDBusMethodInfo *config_methods[] = {
  &config_reload_method,
  &config_getstring_method,
  &config_getuint_method,
  NULL
};

static GDBusInterfaceInfo config_interface = {
  -1, "cockpit.Config", config_methods, NULL, NULL, NULL
};

void
cockpit_dbus_config_startup (void)
{
  GDBusConnection *connection;
  GError *error = NULL;

  connection = cockpit_dbus_internal_server ();
  g_return_if_fail (connection != NULL);

  g_dbus_connection_register_object (connection, "/config", &config_interface,
                                     &config_vtable, NULL, NULL, &error);

  if (error != NULL)
    {
      g_critical ("couldn't register DBus cockpit.Config object: %s", error->message);
      g_error_free (error);
      return;
    }

  g_object_unref (connection);
}
