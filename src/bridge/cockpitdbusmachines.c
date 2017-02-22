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

#include <glob.h>
#include <string.h>
#include <errno.h>
#include <glib/gstdio.h>
#include <json-glib/json-glib.h>

#include "cockpitdbusinternal.h"
#include "common/cockpitsystem.h"

#define MACHINES_SIG "a{sa{sv}}"

/* counts the number of file change events that have not yet gotten a PropertiesChanged signal */
static guint pending_updates;

GFileMonitor *machines_monitor;

static const char *
machines_json_dir (void)
{
  static gchar *path = NULL;
  if (path == NULL)
    path = g_strdup_printf ("%s/machines.d", g_getenv ("COCKPIT_TEST_CONFIG_DIR") ?: "/etc/cockpit");
  return path;
}

static int
glob_err_func (const char *epath,
               int eerrno)
{
  /* Should Not Happen™ -- log the error for debugging */
  if (eerrno != ENOENT)
    g_warning ("%s: cannot read: %s", epath, g_strerror (eerrno));
  return 0;
}

static JsonNode *
new_object_node (void)
{
  JsonNode *n = json_node_new (JSON_NODE_OBJECT);
  json_node_take_object (n, json_object_new ());
  return n;
}

static JsonNode *
parse_json_file (const char *path)
{
  JsonParser *parser = NULL;
  GError *error = NULL;
  gboolean success;
  JsonNode *result = NULL;

  parser = json_parser_new ();
  success = json_parser_load_from_file (parser, path, &error);
  if (success)
    {
      result = json_parser_get_root (parser);
      /* root is NULL if the file is empty */
      if (result != NULL)
        {
          if (JSON_NODE_HOLDS_OBJECT (result))
            {
              result = json_node_copy (result);
            }
          else
            {
              g_message ("%s: does not contain a JSON object, ignoring", path);
              result = NULL;
            }
        }
    }
  else
    {
      if (error->code != G_FILE_ERROR_NOENT)
        g_message ("%s: invalid JSON: %s", path, error->message);
      g_error_free (error);
    }

  g_object_unref (parser);
  return result;
}

static gboolean
write_json_file (JsonNode *config, const char *path, GError **error)
{
  JsonGenerator *json_gen;
  gboolean res;

  json_gen = json_generator_new ();
  json_generator_set_root (json_gen, config);
  json_generator_set_pretty (json_gen, TRUE); /* bikeshed zone */
  res = json_generator_to_file (json_gen, path, error);
  g_object_unref (json_gen);
  return res;
}

static void
merge_config (JsonObject *machines,
              JsonObject *delta,
              const char *path)
{
  GList *hosts = json_object_get_members (delta);
  for (GList *i = g_list_first (hosts); i; i = g_list_next (i))
    {
      const char *hostname = i->data;
      JsonNode *delta_props = json_object_get_member (delta, hostname);

      if (!JSON_NODE_HOLDS_OBJECT (delta_props))
        {
          g_message ("%s: host name definition %s does not contain a JSON object, ignoring", path, hostname);
          continue;
        }

      /* merge delta properties info existing machines host */
      if (!json_object_has_member (machines, hostname))
        json_object_set_member (machines, hostname, new_object_node ());
      JsonObject *machine_props = json_object_get_object_member (machines, hostname);

      g_debug ("%s: merging updates to host name %s", path, hostname);
      GList *proplist = json_object_get_members (json_node_get_object (delta_props));
      for (GList *p = g_list_first (proplist); p; p = g_list_next (p))
        {
          const char *propname = p->data;
          JsonNode *prop_node = json_object_get_member (json_node_get_object (delta_props), propname);

          if (!JSON_NODE_HOLDS_VALUE (prop_node))
            {
              g_message ("%s: host name definition %s: property %s does not contain a simple value, ignoring", path, hostname, propname);
              continue;
            }

          g_debug ("%s:  host name %s: merging property %s", path, hostname, propname);
          json_object_set_member (machine_props, propname, json_node_copy (prop_node));
        }

      g_list_free (proplist);
    }

  g_list_free (hosts);
}

static JsonNode *
read_machines_json (void)
{
  gchar *glob_str;
  glob_t conf_glob = { .gl_offs = 1 };
  int res;
  JsonNode *machines = NULL;

  /* find json config files */
  glob_str = g_build_filename (machines_json_dir (), "*.json", NULL);
  res = glob (glob_str, GLOB_DOOFFS, glob_err_func, &conf_glob);
  if (G_UNLIKELY (res != 0 && res != GLOB_NOMATCH))
    {
      g_critical ("glob %s failed with return code %i", glob_str, res);
      globfree (&conf_glob);
      g_free (glob_str);
      return NULL;
    }

  /* also read /var/lib/cockpit/machines.json for backwards compat; except when
   * running unit tests, then disable this (this is covered by an integration test) */
  conf_glob.gl_pathv[0] = g_getenv ("COCKPIT_TEST_CONFIG_DIR") ? "/dev/null" : "/var/lib/cockpit/machines.json";

  /* start with an empty object */
  machines = new_object_node ();

  for (size_t i = 0; i < conf_glob.gl_pathc + 1; ++i)
    {
      JsonNode *j = parse_json_file (conf_glob.gl_pathv[i]);
      if (j)
        {
          merge_config (json_node_get_object (machines), json_node_get_object (j), conf_glob.gl_pathv[i]);
          json_node_free (j);
        }
    }

  globfree (&conf_glob);
  g_free (glob_str);

  return machines;
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
  /* if the signature does not match, we screwed up in the parser already */
  g_assert (variant != NULL);
  json_node_free (machines);
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
update_machine (const char *filename,
                const char *hostname,
                JsonNode *info,
                GError **error)
{
  gchar *path;
  JsonNode *cur_config;
  JsonObject *cur_config_obj;
  JsonNode *cur_props;
  gboolean res;

  g_assert (JSON_NODE_HOLDS_OBJECT (info));

  path = g_build_filename (machines_json_dir (), filename, NULL);
  cur_config = parse_json_file (path);
  if (cur_config == NULL)
    cur_config = new_object_node ();
  cur_config_obj = json_node_get_object (cur_config);
  cur_props = json_object_get_member (cur_config_obj, hostname);

  if (cur_props)
    {
      /* update settings for hostname */
      g_assert (JSON_NODE_HOLDS_OBJECT (cur_props));
      json_object_foreach_member (json_node_get_object (info), update_machine_property, json_node_get_object (cur_props));
    }
  else
    {
      /* create new entry for host name */
      json_object_set_member (cur_config_obj, hostname, json_node_copy (info));
    }

  res = write_json_file (cur_config, path, error);
  g_free (path);
  json_node_free (cur_config);
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
      const gchar *filename, *hostname;
      GVariant * info_v;
      JsonNode *info_json = NULL;
      GError *error = NULL;

      g_variant_get (parameters, "(&s&s@a{sv})", &filename, &hostname, &info_v);
      info_json = json_gvariant_serialize (info_v);
      g_debug ("Updating %s for machine %s", filename, hostname);
      g_variant_unref (info_v);

      if (update_machine (filename, hostname, info_json, &error))
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

static void
migrate_var_config (void)
{
  const gchar *var_path = "/var/lib/cockpit/machines.json";
  GError *error = NULL;

  /* TOCTOU, but if we really miss this, we'll migrate it the next time */
  if (!g_file_test (var_path, G_FILE_TEST_IS_REGULAR))
    {
      g_debug ("%s does not exist, nothing to migrate", var_path);
      return;
    }

  /* the directory should already exist (shipped by the package), but let's make sure */
  if (g_mkdir_with_parents (machines_json_dir (), 0755) < 0)
    {
      g_message ("failed to create %s, Cockpit will not work properly: %m", machines_json_dir ());
      return;
    }

  /* common case is to move it to 99-webui.json */
  gchar *etc_path = g_build_filename (machines_json_dir (), "99-webui.json", NULL);
  GFile *var_file = g_file_new_for_path (var_path);
  GFile *etc_file = g_file_new_for_path (etc_path);
  if (g_file_move (var_file, etc_file, G_FILE_COPY_NONE, NULL, NULL, NULL, &error))
    {
      g_info ("migrated %s to %s", var_path, etc_path);
    }
  else
    {
      if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_EXISTS))
        {
          GError *error2 = NULL;

          /* most likely an interrupted/failed previous transition attempt;
           * don't clobber the existing file but move it to 98-migrated.json
           * instead */
          g_free (etc_path);
          g_object_unref (etc_file);
          etc_path = g_build_filename (machines_json_dir (), "98-migrated.json", NULL);
          etc_file = g_file_new_for_path (etc_path);
          if (g_file_move (var_file, etc_file, G_FILE_COPY_NONE, NULL, NULL, NULL, &error2))
            {
              g_info ("migrated %s to %s (99-webui.json already exists)", var_path, etc_path);
            }
          else
            {
              g_message ("moving of %s to %s failed: %s", var_path, etc_path, error2->message);
              g_error_free (error2);
            }
        }
      else /* different g_file_move() error than EXISTS */
        {
          g_message ("migration of %s to %s failed: %s", var_path, etc_path, error->message);
        }
      g_error_free (error);
    }

  g_object_unref (etc_file);
  g_object_unref (var_file);
  g_free (etc_path);
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

  /* only attempt this in a privileged bridge, otherwise we get confusing failure messages */
  if (g_access ("/etc/cockpit", W_OK) >= 0)
    migrate_var_config ();

  /* watch for file changes and send D-Bus signal for it */
  machines_monitor_file = g_file_new_for_path (machines_json_dir ());
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
