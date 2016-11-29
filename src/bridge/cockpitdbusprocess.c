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

#include "common/cockpitsystem.h"

#include <systemd/sd-login.h>

#include <errno.h>
#include <stdlib.h>

static GVariant *
build_environment (void)
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
  return variant;
}

static GVariant *
lookup_session_id (void)
{
  GVariant *variant;
  char *session_id;
  pid_t pid;
  int res;

  pid = getppid ();
  res = sd_pid_get_session (pid, &session_id);
  if (res == 0)
    {
      variant = g_variant_new_string (session_id);
      free (session_id);
      return variant;
    }
  else
    {
      if (res != -ENODATA && res != -ENXIO)
        g_message ("could not look up session id for bridge process: %u: %s", pid, g_strerror (-res));
      return g_variant_new_string ("");
    }
}

static GVariant *
process_get_property (GDBusConnection *connection,
                      const gchar *sender,
                      const gchar *object_path,
                      const gchar *interface_name,
                      const gchar *property_name,
                      GError **error,
                      gpointer user_data)
{
  g_return_val_if_fail (property_name != NULL, NULL);

  if (g_str_equal (property_name, "Pid"))
    return g_variant_new_uint32 (getpid ());
  else if (g_str_equal (property_name, "Uid"))
    return g_variant_new_int32 (getuid ());
  else if (g_str_equal (property_name, "SessionId"))
    return lookup_session_id ();
  else if (g_str_equal (property_name, "StartTime"))
    return g_variant_new_uint64 (cockpit_system_process_start_time ());
  else if (g_str_equal (property_name, "Environment") || g_str_equal (property_name, "Variables"))
    return build_environment ();
  else
    g_return_val_if_reached (NULL);
}

static GDBusInterfaceVTable process_vtable = {
  .get_property = process_get_property,
};

static GDBusPropertyInfo pid_property = {
  -1, "Pid", "u", G_DBUS_PROPERTY_INFO_FLAGS_READABLE, NULL
};

static GDBusPropertyInfo uid_property = {
  -1, "Uid", "i", G_DBUS_PROPERTY_INFO_FLAGS_READABLE, NULL
};

static GDBusPropertyInfo start_time_property = {
  -1, "StartTime", "t", G_DBUS_PROPERTY_INFO_FLAGS_READABLE, NULL
};

static GDBusPropertyInfo session_id_property = {
  -1, "SessionId", "s", G_DBUS_PROPERTY_INFO_FLAGS_READABLE, NULL,
};

static GDBusPropertyInfo environment_property = {
  -1, "Environment", "a{ss}", G_DBUS_PROPERTY_INFO_FLAGS_READABLE, NULL
};

static GDBusPropertyInfo *process_properties[] = {
  &pid_property,
  &uid_property,
  &start_time_property,
  &session_id_property,
  &environment_property,
  NULL
};

static GDBusInterfaceInfo process_interface = {
  -1, "cockpit.Process", NULL, NULL, process_properties, NULL
};

static GDBusPropertyInfo variables_property = {
  -1, "Variables", "a{ss}", G_DBUS_PROPERTY_INFO_FLAGS_READABLE, NULL
};

static GDBusPropertyInfo *environment_properties[] = {
  &variables_property,
  NULL
};

static GDBusInterfaceInfo environment_interface = {
  -1, "cockpit.Environment", NULL, NULL, environment_properties, NULL
};

void
cockpit_dbus_process_startup (void)
{
  GDBusConnection *connection;
  GError *error = NULL;

  connection = cockpit_dbus_internal_server ();
  g_return_if_fail (connection != NULL);

  g_dbus_connection_register_object (connection, "/environment", &environment_interface,
                                     &process_vtable, NULL, NULL, &error);

  if (error != NULL)
    {
      g_critical ("couldn't register DBus cockpit.Environment object: %s", error->message);
      g_error_free (error);
    }

  g_dbus_connection_register_object (connection, "/bridge", &process_interface,
                                     &process_vtable, NULL, NULL, &error);

  if (error != NULL)
    {
      g_critical ("couldn't register DBus cockpit.Process object: %s", error->message);
      g_error_free (error);
    }

  g_object_unref (connection);
}
