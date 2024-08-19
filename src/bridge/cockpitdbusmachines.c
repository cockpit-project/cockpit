/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
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
#include "common/cockpitmachinesjson.h"
#include "common/cockpitsystem.h"

#define MACHINES_SIG "a{sa{sv}}"

/* counts the number of file change events that have not yet gotten a PropertiesChanged signal */
static guint pending_updates;

GFileMonitor *machines_monitor;

/* returns a floating GVariant */
static GVariant *
get_machines (void)
{
  JsonNode *machines;
  GError *error = NULL;
  GVariant *variant;

  machines = read_machines_json ();
  variant = json_gvariant_deserialize (machines, MACHINES_SIG, &error);
  /* if the signature does not match, we screwed up in the parser already */
  g_assert (variant != NULL);
  json_node_free (machines);
  return variant;
}

static GVariant *
machines_get_property (GDBusConnection *connection,
                       const gchar *sender,
                       const gchar *object_path,
                       const gchar *interface_name,
                       const gchar *property_name,
                       GError **error,
                       gpointer user_data)
{
  g_return_val_if_fail (property_name != NULL, NULL);

  if (g_str_equal (property_name, "Machines"))
    return get_machines ();
  else
    g_return_val_if_reached (NULL);
}

static void
machines_method_call (GDBusConnection *connection,
                      const gchar *sender,
                      const gchar *object_path,
                      const gchar *interface_name,
                      const gchar *method_name,
                      GVariant *parameters,
                      GDBusMethodInvocation *invocation,
                      gpointer user_data)
{
  if (g_str_equal (method_name, "Update"))
    {
      const gchar *filename, *hostname;
      GVariant * info_v;
      JsonNode *info_json = NULL;
      GError *error = NULL;

      g_variant_get (parameters, "(&s&s@a{sv})", &filename, &hostname, &info_v);
      info_json = json_gvariant_serialize (info_v);
      g_debug ("Updating %s for machine %s", filename, hostname);
      g_variant_unref (info_v);

      if (update_machines_json (filename, hostname, info_json, &error))
        g_dbus_method_invocation_return_value (invocation, NULL);
      else
        g_dbus_method_invocation_take_error (invocation, error);
      json_node_free (info_json);
    }
  else
    g_return_if_reached ();
}

/**
 * notify_properties:
 * @user_data: GDBusConnection to which updates get sent
 *
 * Send a PropertiesChanged signal for invalidating the Machines property. This
 * avoids parsing files and constructing the property when nobody is listening.
 * This gets called in reaction to changed *.json configuration files.
 */
static gboolean
notify_properties (gpointer user_data)
{
  GDBusConnection *connection = user_data;
  GVariant *signal_value;
  GVariantBuilder builder;
  GError *error = NULL;

  /* reset pending counter before we do any actual work, to avoid races */
  pending_updates = 0;
  g_variant_builder_init (&builder, G_VARIANT_TYPE ("as"));
  g_variant_builder_add (&builder, "s", "Machines");
  signal_value = g_variant_ref_sink (g_variant_new ("(sa{sv}as)", "cockpit.Machines", NULL, &builder));

  g_dbus_connection_emit_signal (connection,
                                 NULL,
                                 "/machines",
                                 "org.freedesktop.DBus.Properties",
                                 "PropertiesChanged",
                                 signal_value,
                                 &error);
  if (error != NULL)
    {
      if (!g_error_matches (error, G_IO_ERROR, G_IO_ERROR_CLOSED))
        g_critical ("failed to send PropertiesChanged signal: %s", error->message);
      g_error_free (error);
    }
  g_variant_unref (signal_value);
  return G_SOURCE_REMOVE;
}


static void
on_machines_changed (GFileMonitor *monitor,
                     GFile *file,
                     GFile *other_file,
                     GFileMonitorEvent event_type,
                     gpointer user_data)
{
  gchar *path;

  /* ignore uninteresting events; note that DELETED does not get a followup CHANGES_DONE_HINT */
  if (event_type != G_FILE_MONITOR_EVENT_CHANGES_DONE_HINT && event_type != G_FILE_MONITOR_EVENT_DELETED)
    return;

  path = g_file_get_path (file);
  if (g_str_has_suffix (path, ".json"))
    {
      g_debug ("on_machines_changed: event type %i on %s", event_type, path);
      /* change events tend to come in batches, so slightly delay the re-reading of
       * files and sending PropertiesChanged; if we already have queued up an
       * update, don't queue it again */
      if (pending_updates++ == 0)
        g_timeout_add (100, notify_properties, user_data);
    }
  else
    {
      g_debug ("on_machines_changed: ignoring event type %i on non-.json file %s", event_type, path);
    }
  g_free (path);
}

static GDBusInterfaceVTable machines_vtable = {
  .method_call = machines_method_call,
  .get_property = machines_get_property,
};

static GDBusPropertyInfo machines_property = {
  -1, "Machines", MACHINES_SIG, G_DBUS_PROPERTY_INFO_FLAGS_READABLE, NULL
};

static GDBusPropertyInfo *machines_properties[] = {
  &machines_property,
  NULL
};

static GDBusArgInfo machines_update_filename_arg = {
  -1, "filename", "s", NULL
};

static GDBusArgInfo machines_update_hostname_arg = {
  -1, "hostname", "s", NULL
};

static GDBusArgInfo machines_update_info_arg = {
  -1, "info", "a{sv}", NULL
};

static GDBusArgInfo *machines_update_args[] = {
  &machines_update_filename_arg,
  &machines_update_hostname_arg,
  &machines_update_info_arg,
  NULL
};

static GDBusMethodInfo machines_update_method = {
  -1, "Update", machines_update_args, NULL, NULL
};

static GDBusMethodInfo *machines_methods[] = {
  &machines_update_method,
  NULL
};

static GDBusInterfaceInfo machines_interface = {
  -1, "cockpit.Machines", machines_methods, NULL, machines_properties, NULL
};

void
cockpit_dbus_machines_startup (void)
{
  GDBusConnection *connection;
  GFile *machines_monitor_file;
  GError *error = NULL;

  connection = cockpit_dbus_internal_server ();
  g_return_if_fail (connection != NULL);

  g_dbus_connection_register_object (connection, "/machines", &machines_interface,
                                     &machines_vtable, NULL, NULL, &error);

  if (error != NULL)
    {
      g_critical ("couldn't register DBus cockpit.Machines object: %s", error->message);
      g_error_free (error);
      return;
    }

  /* watch for file changes and send D-Bus signal for it */
  machines_monitor_file = g_file_new_for_path (get_machines_json_dir ());
  machines_monitor = g_file_monitor (machines_monitor_file, G_FILE_MONITOR_NONE, NULL, &error);
  g_object_unref (machines_monitor_file);
  if (machines_monitor == NULL)
    {
      g_critical ("couldn't set up file watch: %s", error->message);
      g_error_free (error);
      return;
    }
  g_signal_connect (machines_monitor, "changed", G_CALLBACK (on_machines_changed), connection);

  g_object_unref (connection);
}

void
cockpit_dbus_machines_cleanup (void)
{
  g_object_unref (machines_monitor);
}
