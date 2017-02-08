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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

#include "config.h"

#include <json-glib/json-glib.h>

#include "cockpitdbusinternal.h"
#include "common/cockpitsystem.h"

#define MACHINES_SIG "a{sa{sv}}"

/* counts the number of file change events that have not yet gotten a PropertiesChanged signal */
static guint pending_updates;

GFileMonitor *machines_monitor;

static const char *
machines_json_path (void)
{
  static gchar *path = NULL;
  if (path == NULL)
    path = g_strdup_printf ("%s/machines.json", g_getenv ("COCKPIT_DATA_DIR") ?: "/var/lib/cockpit");
  return path;
}

static JsonNode*
read_machines_json (void)
{
  gchar *contents;
  gboolean res;
  GError *error = NULL;
  JsonParser *parser = NULL;
  JsonNode *result = NULL;

  if (!g_file_get_contents (machines_json_path (), &contents, NULL, &error))
    {
      if (error->code == G_FILE_ERROR_NOENT)
        g_debug ("%s does not exist", machines_json_path ());
      else
        g_message ("couldn't read %s: %s", machines_json_path (), error->message);
      g_error_free (error);
      goto out;
    }

  parser = json_parser_new ();
  res = json_parser_load_from_data (parser, contents, -1, &error);
  g_free (contents);
  if (!res)
    {
      g_message("%s has invalid JSON: %s", machines_json_path (), error->message);
      g_error_free (error);
      goto out;
    }

  result = json_parser_get_root (parser);
  if (result != NULL)
    result = json_node_copy (result);

out:
  if (parser)
    g_object_unref (parser);

  /* default to an empty object */
  if (result == NULL)
    {
      result = json_node_new (JSON_NODE_OBJECT);
      json_node_take_object (result, json_object_new ());
    }

  return result;
}

/* returns a floating GVariant */
static GVariant *
get_machines (void)
{
  JsonNode *machines;
  GError *error = NULL;
  GVariant *variant;

  machines = read_machines_json ();
  variant = json_gvariant_deserialize (machines, MACHINES_SIG, &error);
  json_node_free (machines);
  if (!variant)
    {
      g_message ("%s is misformatted: %s", machines_json_path (), error->message);
      g_error_free (error);
      variant = g_variant_new (MACHINES_SIG, NULL);
    }
  return variant;
}

/* iterator function for update_machine() */
static void
update_machine_property (JsonObject *object,
                         const gchar *member_name,
                         JsonNode *member_node,
                         gpointer user_data)
{
  json_object_set_member ((JsonObject *) user_data, member_name, json_node_copy (member_node));
}

static gboolean
update_machine (const char *hostname,
                JsonNode *info,
                GError **error)
{
  JsonNode *machines;
  JsonGenerator *json_gen;
  JsonObject *machines_obj;
  JsonNode *cur_props;
  gboolean res;

  machines = read_machines_json ();
  g_assert (JSON_NODE_HOLDS_OBJECT (info));
  machines_obj = json_node_get_object (machines);
  cur_props = json_object_get_member (machines_obj, hostname);

  if (cur_props)
    {
      /* update settings for hostname */
      JsonObject *cur_props_obj = json_node_get_object (cur_props);
      g_assert (JSON_NODE_HOLDS_OBJECT (cur_props));
      json_object_foreach_member (json_node_get_object (info), update_machine_property, cur_props_obj);
    }
  else
    {
      /* create new entry for host name */
      json_object_set_member (machines_obj, hostname, json_node_copy (info));
    }

  /* update machines.json file */
  json_gen = json_generator_new ();
  json_generator_set_root (json_gen, machines);
  json_generator_set_pretty (json_gen, TRUE); /* bikeshed zone */
  res = json_generator_to_file (json_gen, machines_json_path (), error);
  g_object_unref (json_gen);
  json_node_free (machines);
  return res;
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
      const gchar *hostname;
      GVariant * info_v;
      JsonNode *info_json = NULL;
      GError *error = NULL;

      g_variant_get (parameters, "(&s@a{sv})", &hostname, &info_v);
      info_json = json_gvariant_serialize (info_v);
      /* g_debug ("Updating info for machine %s: %s", hostname, g_variant_print (info_v, TRUE)); */
      g_variant_unref (info_v);

      if (update_machine (hostname, info_json, &error))
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
  /* ignore uninteresting events; FIXME: adjust once we move to a directory;
   * https://developer.gnome.org/gio/stable/GFileMonitor.html#GFileMonitorEvent */
  /* g_debug ("on_machines_changed: event type %i on %s", event_type, g_file_get_path (file)); */
  if (event_type != G_FILE_MONITOR_EVENT_CHANGES_DONE_HINT)
    return;

  /* change events tend to come in batches, so slightly delay the re-reading of
   * files and sending PropertiesChanged; if we already have queued up an
   * update, don't queue it again */
  if (pending_updates++ == 0)
    g_timeout_add (100, notify_properties, user_data);
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

static GDBusArgInfo machines_update_hostname_arg = {
  -1, "hostname", "s", NULL
};

static GDBusArgInfo machines_update_info_arg = {
  -1, "info", "a{sv}", NULL
};

static GDBusArgInfo *machines_update_args[] = {
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
  machines_monitor_file = g_file_new_for_path (machines_json_path ());
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
