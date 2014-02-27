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

#include <unistd.h>
#include <stdint.h>
#include <stdio.h>
#include <pwd.h>

#include <gio/gio.h>
#include <gio/gunixinputstream.h>
#include <gio/gunixoutputstream.h>
#include <json-glib/json-glib.h>

#include "gsystem-local-alloc.h"
#include "dbus-server.h"

#include <string.h>

typedef struct {
  GDBusObjectManagerClient *object_manager;
  GCancellable             *cancellable;
  GList                    *active_calls;

  GMainLoop                *loop;
  CockpitTransport         *transport;
} DBusServerData;

/* Returns a new floating variant (essentially a fixed-up copy of @value) */
static GVariant *
_my_replace (GVariant *value)
{
  GVariant *ret;
  const gchar *dbus_type;

  if (g_variant_is_of_type (value, G_VARIANT_TYPE_VARDICT) &&
      g_variant_lookup (value, "_dbus_type", "&s", &dbus_type))
    {
      GVariant *passed_value;
      passed_value = g_variant_lookup_value (value, "value", NULL);
      if (passed_value != NULL)
        {
          JsonNode *serialized;
          GError *error;

          serialized = json_gvariant_serialize (passed_value);
          error = NULL;
          ret = json_gvariant_deserialize (serialized,
                                           dbus_type,
                                           &error);
          json_node_free (serialized);
          if (ret == NULL)
            {
              /*
               * HACK: Work around bug in JSON-glib, see:
               * https://bugzilla.gnome.org/show_bug.cgi?id=724319
               */
              if (error->domain == G_IO_ERROR && error->code == G_IO_ERROR_INVALID_DATA &&
                  g_variant_is_of_type (passed_value, G_VARIANT_TYPE_INT64) &&
                  g_strcmp0 (dbus_type, "d") == 0)
                {
                  ret = g_variant_new_double (g_variant_get_int64 (passed_value));
                  g_clear_error (&error);
                }
              else
                {
                  g_warning ("Error converting JSON to requested type %s: %s (%s, %d)",
                             dbus_type,
                             error->message, g_quark_to_string (error->domain), error->code);
                  g_error_free (error);
                  ret = g_variant_ref (value);
                }
            }
        }
      else
        {
          g_warning ("Malformed _dbus_type vardict");
          ret = g_variant_ref (value);
        }
    }
  else if (g_variant_is_container (value))
    {
      GVariantBuilder builder;
      GVariantIter iter;
      GVariant *child;

      g_variant_builder_init (&builder, g_variant_get_type (value));

      g_variant_iter_init (&iter, value);
      while ((child = g_variant_iter_next_value (&iter)) != NULL)
        {
          g_variant_builder_add_value (&builder, _my_replace (child));
          g_variant_unref (child);
        }
      ret = g_variant_builder_end (&builder);
    }
  else
    {
      ret = g_variant_ref (value);
    }
  return ret;
}

static JsonBuilder *
_json_builder_add_gvariant (JsonBuilder *builder,
                            GVariant *value)
{
  g_return_val_if_fail (JSON_IS_BUILDER (builder), builder);

  g_variant_ref_sink (value);

  switch (g_variant_classify (value))
    {
    case G_VARIANT_CLASS_BOOLEAN:
      json_builder_add_boolean_value (builder, g_variant_get_boolean (value));
      break;

    case G_VARIANT_CLASS_BYTE:
      json_builder_add_int_value (builder, g_variant_get_byte (value));
      break;

    case G_VARIANT_CLASS_INT16:
      json_builder_add_int_value (builder, g_variant_get_int16 (value));
      break;

    case G_VARIANT_CLASS_UINT16:
      json_builder_add_int_value (builder, g_variant_get_uint16 (value));
      break;

    case G_VARIANT_CLASS_INT32:
      json_builder_add_int_value (builder, g_variant_get_int32 (value));
      break;

    case G_VARIANT_CLASS_UINT32:
      json_builder_add_int_value (builder, g_variant_get_uint32 (value));
      break;

    case G_VARIANT_CLASS_INT64:
      json_builder_add_int_value (builder, g_variant_get_int64 (value));
      break;

    case G_VARIANT_CLASS_UINT64:
      json_builder_add_int_value (builder, g_variant_get_uint64 (value));
      break;

    case G_VARIANT_CLASS_HANDLE:
      json_builder_add_int_value (builder, g_variant_get_handle (value));
      break;

    case G_VARIANT_CLASS_DOUBLE:
      json_builder_add_double_value (builder, g_variant_get_double (value));
      break;

    case G_VARIANT_CLASS_STRING:      /* explicit fall-through */
    case G_VARIANT_CLASS_OBJECT_PATH: /* explicit fall-through */
    case G_VARIANT_CLASS_SIGNATURE:
      json_builder_add_string_value (builder, g_variant_get_string (value, NULL));
      break;

     /* TODO: */
    case G_VARIANT_CLASS_VARIANT:
      {
        GVariant *child;
        child = g_variant_get_variant (value);
        _json_builder_add_gvariant (builder, child);
        g_variant_unref (child);
      }
      break;

    case G_VARIANT_CLASS_MAYBE:
      g_assert_not_reached ();
      break;

    case G_VARIANT_CLASS_ARRAY:
      {
        const GVariantType *type;
        const GVariantType *element_type;

        type = g_variant_get_type (value);
        element_type = g_variant_type_element (type);
        if (g_variant_type_is_dict_entry (element_type))
          {
            GVariantIter iter;
            GVariant *child;

            json_builder_begin_object (builder);

            g_variant_iter_init (&iter, value);
            while ((child = g_variant_iter_next_value (&iter)) != NULL)
              {
                _json_builder_add_gvariant (builder, child);
                g_variant_unref (child);
              }

            json_builder_end_object (builder);
          }
        else
          {
            GVariantIter iter;
            GVariant *child;

            json_builder_begin_array (builder);

            g_variant_iter_init (&iter, value);
            while ((child = g_variant_iter_next_value (&iter)) != NULL)
              {
                _json_builder_add_gvariant (builder, child);
                g_variant_unref (child);
              }

            json_builder_end_array (builder);
          }
      }
      break;

    case G_VARIANT_CLASS_TUPLE:
      {
        GVariantIter iter;
        GVariant *child;

        json_builder_begin_array (builder);

        g_variant_iter_init (&iter, value);
        while ((child = g_variant_iter_next_value (&iter)) != NULL)
          {
            _json_builder_add_gvariant (builder, child);
            g_variant_unref (child);
          }

        json_builder_end_array (builder);
      }
      break;

    case G_VARIANT_CLASS_DICT_ENTRY:
      {
        GVariant *dict_key;
        GVariant *dict_value;
        gchar *dict_key_string;

        dict_key = g_variant_get_child_value (value, 0);
        dict_value = g_variant_get_child_value (value, 1);

        if (g_variant_is_of_type (dict_key, G_VARIANT_TYPE("s")))
          dict_key_string = g_variant_dup_string (dict_key, NULL);
        else
          dict_key_string = g_variant_print (dict_key, FALSE);

        json_builder_set_member_name (builder, dict_key_string);
        _json_builder_add_gvariant (builder, dict_value);
        g_free (dict_key_string);

        g_variant_unref (dict_key);
        g_variant_unref (dict_value);
      }
      break;
    }

  g_variant_unref (value);

  return builder;
}

static GBytes *
_json_builder_to_bytes (JsonBuilder *builder)
{
  JsonGenerator *generator;
  JsonNode *root;
  gchar *ret;

  generator = json_generator_new ();
  root = json_builder_get_root (builder);
  json_generator_set_root (generator, root);
  ret = json_generator_to_data (generator, NULL);
  json_node_free (root);
  g_object_unref (generator);

  return g_bytes_new_take (ret, strlen (ret));
}

static JsonBuilder *
prepare_builder (const gchar *command)
{
  JsonBuilder *builder;
  builder = json_builder_new ();
  json_builder_begin_object (builder);
  json_builder_set_member_name (builder, "command");
  json_builder_add_string_value (builder, command);
  json_builder_set_member_name (builder, "data");
  return builder;
}

static void
write_builder (DBusServerData *data,
               JsonBuilder *builder)
{
  GBytes *bytes;

  json_builder_end_object (builder);
  bytes = _json_builder_to_bytes (builder);
  /* TODO: Zero channel number until later */
  cockpit_transport_send (data->transport, 0, bytes);
  g_bytes_unref (bytes);
}

/* ---------------------------------------------------------------------------------------------------- */

static GDBusInterfaceInfo *
get_introspection_data (DBusServerData *data,
                        const gchar *interface_name,
                        const gchar *owner,
                        const gchar *object_path,
                        GError **error)
{
  static GHashTable *cache = NULL;
  GDBusNodeInfo *node = NULL;
  GDBusInterfaceInfo *ret = NULL;
  GVariant *val = NULL;
  const gchar *xml;

  g_return_val_if_fail (g_dbus_is_interface_name (interface_name), NULL);
  g_return_val_if_fail (g_dbus_is_name (owner), NULL);
  g_return_val_if_fail (g_variant_is_object_path (object_path), NULL);
  g_return_val_if_fail (error == NULL || *error == NULL, NULL);

  if (cache == NULL)
    cache = g_hash_table_new (g_str_hash, g_str_equal);

  ret = g_hash_table_lookup (cache, interface_name);
  if (ret != NULL)
    goto out;

  val = g_dbus_connection_call_sync (g_dbus_object_manager_client_get_connection (G_DBUS_OBJECT_MANAGER_CLIENT (data->object_manager)),
                                     owner,
                                     object_path,
                                     "org.freedesktop.DBus.Introspectable",
                                     "Introspect",
                                     NULL,
                                     G_VARIANT_TYPE ("(s)"),
                                     G_DBUS_CALL_FLAGS_NO_AUTO_START,
                                     -1, /* timeout */
                                     NULL, /* GCancellable */
                                     error);
  if (val == NULL)
    goto out;

  g_variant_get (val, "(&s)", &xml);

  node = g_dbus_node_info_new_for_xml (xml, error);
  if (node == NULL)
    goto out;

  ret = g_dbus_node_info_lookup_interface (node, interface_name);
  if (ret == NULL)
    {
      g_set_error (error,
                   G_IO_ERROR,
                   G_IO_ERROR_FAILED,
                   "No info about interface %s in introspection data object at path %s owned by %s",
                   interface_name, object_path, owner);
      goto out;
    }

  g_hash_table_insert (cache,
                       g_strdup (interface_name),
                       g_dbus_interface_info_ref (ret));

out:
  if (node != NULL)
    g_dbus_node_info_unref (node);
  if (val != NULL)
    g_variant_unref (val);
  return ret;
}

static void
add_interface (JsonBuilder *builder,
               GDBusInterface *interface,
               GVariant *changed_properties)
{
  gchar *s;

  json_builder_set_member_name (builder, g_dbus_proxy_get_interface_name (G_DBUS_PROXY (interface)));
  json_builder_begin_object (builder);

  if (changed_properties == NULL)
    {
      gchar **properties;
      guint n;

      properties = g_dbus_proxy_get_cached_property_names (G_DBUS_PROXY (interface));
      for (n = 0; properties != NULL && properties[n] != NULL; n++)
        {
          const gchar *property_name = properties[n];
          GVariant *value;
          value = g_dbus_proxy_get_cached_property (G_DBUS_PROXY (interface), property_name);
          if (value != NULL)
            {
              s = g_strconcat ("dbus_prop_", property_name, NULL);
              json_builder_set_member_name (builder, s);
              g_free (s);
              _json_builder_add_gvariant (builder, value);
              g_variant_unref (value);
            }
        }
      g_strfreev (properties);

      if (properties == NULL)
        {
          json_builder_set_member_name (builder, "HackEmpty");
          json_builder_add_string_value (builder, "HackEmpty");
        }
    }
  else
    {
      GVariantIter iter;
      const gchar *property_name;
      GVariant *value;
      g_variant_iter_init (&iter, changed_properties);
      while (g_variant_iter_next (&iter, "{&sv}", &property_name, &value))
        {
          s = g_strconcat ("dbus_prop_", property_name, NULL);
          json_builder_set_member_name (builder, property_name);
          g_free (s);
          _json_builder_add_gvariant (builder, value);
          g_variant_unref (value);
        }
    }

  json_builder_end_object (builder);
}

static void
add_object (JsonBuilder *builder,
            GDBusObject *object)
{
  GList *interfaces;
  GList *l;

  json_builder_set_member_name (builder, "objpath");
  json_builder_add_string_value (builder, g_dbus_object_get_object_path (G_DBUS_OBJECT (object)));

  json_builder_set_member_name (builder, "ifaces");
  json_builder_begin_object (builder);

  interfaces = g_dbus_object_get_interfaces (object);
  for (l = interfaces; l != NULL; l = l->next)
    {
      GDBusInterface *interface = G_DBUS_INTERFACE (l->data);
      add_interface (builder, interface, NULL);
    }
  g_list_foreach (interfaces, (GFunc)g_object_unref, NULL);
  g_list_free (interfaces);

  json_builder_end_object (builder);
}

static void
send_seed (DBusServerData *data)
{
  gs_unref_object JsonBuilder *builder = json_builder_new ();

  json_builder_begin_object (builder);
  json_builder_set_member_name (builder, "command");
  json_builder_add_string_value (builder, "seed");

  json_builder_set_member_name (builder, "data");
  json_builder_begin_object (builder);

  GList *objects = g_dbus_object_manager_get_objects (G_DBUS_OBJECT_MANAGER (data->object_manager));
  for (GList *l = objects; l != NULL; l = l->next)
    {
      GDBusObject *object = G_DBUS_OBJECT (l->data);
      json_builder_set_member_name (builder, g_dbus_object_get_object_path (object));
      json_builder_begin_object (builder);
      add_object (builder, object);
      json_builder_end_object (builder);
    }
  g_list_foreach (objects, (GFunc)g_object_unref, NULL);
  g_list_free (objects);
  json_builder_end_object (builder);

  write_builder (data, builder);
}

/* ---------------------------------------------------------------------------------------------------- */

static void
on_object_added (GDBusObjectManager *manager,
                 GDBusObject *object,
                 gpointer user_data)
{
  DBusServerData *data = user_data;
  gs_unref_object JsonBuilder *builder = prepare_builder ("object-added");

  json_builder_begin_object (builder);
  json_builder_set_member_name (builder, "object");
  json_builder_begin_object (builder);
  add_object (builder, object);
  json_builder_end_object (builder);
  json_builder_end_object (builder);

  write_builder (data, builder);
}

static void
on_object_removed (GDBusObjectManager *manager,
                   GDBusObject *object,
                   gpointer user_data)
{
  DBusServerData *data = user_data;
  gs_unref_object JsonBuilder *builder = prepare_builder ("object-removed");

  json_builder_begin_array (builder);
  json_builder_add_string_value (builder, g_dbus_object_get_object_path (object));
  json_builder_end_array (builder);

  write_builder (data, builder);
}

/* ---------------------------------------------------------------------------------------------------- */

static void
on_interface_added (GDBusObjectManager *manager,
                    GDBusObject *object,
                    GDBusInterface *interface,
                    gpointer user_data)
{
  DBusServerData *data = user_data;
  gs_unref_object JsonBuilder *builder = prepare_builder ("interface-added");

  json_builder_begin_object (builder);
  json_builder_set_member_name (builder, "objpath");
  json_builder_add_string_value (builder, g_dbus_object_get_object_path (object));
  json_builder_set_member_name (builder, "iface_name");
  json_builder_add_string_value (builder, g_dbus_proxy_get_interface_name (G_DBUS_PROXY (interface)));
  json_builder_set_member_name (builder, "iface");
  json_builder_begin_object (builder);
  add_interface (builder, interface, NULL);
  json_builder_end_object (builder);
  json_builder_end_object (builder);

  write_builder (data, builder);
}

static void
on_interface_removed (GDBusObjectManager *manager,
                      GDBusObject *object,
                      GDBusInterface *interface,
                      gpointer user_data)
{
  DBusServerData *data = user_data;
  gs_unref_object JsonBuilder *builder = prepare_builder ("interface-removed");

  json_builder_begin_object (builder);
  json_builder_set_member_name (builder, "objpath");
  json_builder_add_string_value (builder, g_dbus_object_get_object_path (object));
  json_builder_set_member_name (builder, "iface_name");
  json_builder_add_string_value (builder, g_dbus_proxy_get_interface_name (G_DBUS_PROXY (interface)));
  json_builder_end_object (builder);

  write_builder (data, builder);
}

static void
on_interface_proxy_properties_changed (GDBusObjectManager *manager,
                                       GDBusObjectProxy *object_proxy,
                                       GDBusProxy *interface_proxy,
                                       GVariant *changed_properties,
                                       const gchar * const *invalidated_properties,
                                       gpointer user_data)
{
  DBusServerData *data = user_data;
  gs_unref_object JsonBuilder *builder = prepare_builder ("interface-properties-changed");

  json_builder_begin_object (builder);
  json_builder_set_member_name (builder, "objpath");
  json_builder_add_string_value (builder, g_dbus_object_get_object_path (G_DBUS_OBJECT (object_proxy)));
  json_builder_set_member_name (builder, "iface_name");
  json_builder_add_string_value (builder, g_dbus_proxy_get_interface_name (interface_proxy));
  /* It's a bit of a waste to send all properties - would be cheaper to just
   * send @changed_properties and @invalidated_properties. But this is simpler.
   */
  json_builder_set_member_name (builder, "iface");
  json_builder_begin_object (builder);
  add_interface (builder, G_DBUS_INTERFACE (interface_proxy), changed_properties);
  json_builder_end_object (builder);
  json_builder_end_object (builder);

  write_builder (data, builder);
}

static void
on_interface_proxy_signal (GDBusObjectManager *manager,
                           GDBusObjectProxy *object_proxy,
                           GDBusProxy *interface_proxy,
                           gchar *sender_name,
                           gchar *signal_name,
                           GVariant *parameters,
                           gpointer user_data)
{
  DBusServerData *data = user_data;
  gs_unref_object JsonBuilder *builder = prepare_builder ("interface-signal");

  GVariantIter iter;
  GVariant *child;

  json_builder_begin_object (builder);
  json_builder_set_member_name (builder, "objpath");
  json_builder_add_string_value (builder, g_dbus_object_get_object_path (G_DBUS_OBJECT (object_proxy)));
  json_builder_set_member_name (builder, "iface_name");
  json_builder_add_string_value (builder, g_dbus_proxy_get_interface_name (interface_proxy));
  json_builder_set_member_name (builder, "signal_name");
  json_builder_add_string_value (builder, signal_name);

  json_builder_set_member_name (builder, "args");
  json_builder_begin_array (builder);
  g_variant_iter_init (&iter, parameters);
  while ((child = g_variant_iter_next_value (&iter)) != NULL)
    {
      _json_builder_add_gvariant (builder, child);
      g_variant_unref (child);
    }
  json_builder_end_array (builder);

  json_builder_end_object (builder);

  write_builder (data, builder);
}

/* ---------------------------------------------------------------------------------------------------- */

static void
send_dbus_reply (DBusServerData *data, const gchar *cookie, GVariant *result, GError *error)
{
  gs_unref_object JsonBuilder *builder = NULL;
  builder = prepare_builder ("call-reply");

  json_builder_begin_object (builder);
  json_builder_set_member_name (builder, "cookie");
  json_builder_add_string_value (builder, cookie);

  if (result == NULL)
    {
      gchar *error_name;
      error_name = g_dbus_error_get_remote_error (error);
      g_dbus_error_strip_remote_error (error);

      json_builder_set_member_name (builder, "error_name");
      json_builder_add_string_value (builder, error_name != NULL ? error_name : "");

      json_builder_set_member_name (builder, "error_message");
      json_builder_add_string_value (builder, error->message);

      g_free (error_name);
    }
  else
    {
      json_builder_set_member_name (builder, "result");
      _json_builder_add_gvariant (builder, result);
    }
  json_builder_end_object (builder);

  write_builder (data, builder);
}

typedef struct
{
  GList *link;
  DBusServerData *data;
  gchar *cookie;
} CallData;

static void
call_data_free (CallData *data)
{
  g_free (data->cookie);
  g_free (data);
}

static void
dbus_call_cb (GDBusProxy *proxy,
              GAsyncResult *res,
              gpointer user_data)
{
  CallData *data = user_data;
  GVariant *result;
  GError *error;

  error = NULL;
  result = g_dbus_proxy_call_finish (proxy, res, &error);

  if (data->data)
    {
      send_dbus_reply (data->data, data->cookie, result, error);
      data->data->active_calls = g_list_delete_link (data->data->active_calls, data->link);
    }

  if (result)
    g_variant_unref (result);
  g_clear_error (&error);
  call_data_free (data);
}

static gboolean
handle_dbus_call (DBusServerData *data,
                  JsonObject *root)
{
  gboolean ret = FALSE;
  const gchar *objpath;
  const gchar *iface_name;
  const gchar *method_name;
  const gchar *cookie;
  GDBusInterface *iface_proxy = NULL;
  JsonArray *args;
  GDBusInterfaceInfo *iface_info;
  GDBusMethodInfo *method_info;
  GVariantBuilder arg_builder;
  guint n;
  GError *local_error = NULL;
  GError **error = &local_error;
  CallData *call_data;

  objpath = json_object_get_string_member (root, "objpath");
  iface_name = json_object_get_string_member (root, "iface");
  method_name = json_object_get_string_member (root, "method");
  cookie = json_object_get_string_member (root, "cookie");
  args = json_object_get_array_member (root, "args");

  if (!(g_variant_is_object_path (objpath) &&
        g_dbus_is_interface_name (iface_name) &&
        g_dbus_is_member_name (method_name) &&
        cookie != NULL &&
        args != NULL))
    {
      g_set_error (error, G_IO_ERROR, G_IO_ERROR_FAILED, "Invalid data in call message");
      goto out;
    }

  iface_proxy = g_dbus_object_manager_get_interface (G_DBUS_OBJECT_MANAGER (data->object_manager),
                                                     objpath,
                                                     iface_name);
  if (iface_proxy == NULL)
    {
      GError *dbus_error = NULL;
      g_set_error (&dbus_error, G_IO_ERROR, G_IO_ERROR_FAILED,
                   "No iface for objpath %s and iface %s calling %s",
                   objpath, iface_name, method_name);
      send_dbus_reply (data, cookie, NULL, dbus_error);
      g_clear_error (&dbus_error);
      ret = TRUE;
      goto out;
    }

  iface_info = get_introspection_data (data,
                                       iface_name,
                                       g_dbus_object_manager_client_get_name (G_DBUS_OBJECT_MANAGER_CLIENT (data->object_manager)),
                                       objpath, /* object_path */
                                       error);
  if (iface_info == NULL)
    {
      g_prefix_error (error, "Introspection data for D-Bus interface %s not in cache: ", iface_name);
      goto out;
    }
  method_info = g_dbus_interface_info_lookup_method (iface_info, method_name);
  if (method_info == NULL)
    {
      g_set_error (error, G_IO_ERROR, G_IO_ERROR_FAILED,
                   "Introspection data for method %s on D-Bus interface %s not in cache",
                   iface_name, method_name);
      goto out;
    }

  g_variant_builder_init (&arg_builder, G_VARIANT_TYPE_TUPLE);
  for (n = 0; n < json_array_get_length (args); n++)
    {
      GVariant *arg_gvariant;
      JsonNode *arg_node;
      GDBusArgInfo *arg_info;
      GVariant *old;

      arg_node = json_array_get_element (args, n);

      arg_info = method_info->in_args != NULL ? method_info->in_args[n] : NULL;
      if (arg_info == NULL)
        {
          g_set_error (error, G_IO_ERROR, G_IO_ERROR_FAILED, "No GDBusArgInfo for arg %d", n);
          g_variant_builder_clear (&arg_builder);
          goto out;
        }

      arg_gvariant = json_gvariant_deserialize (arg_node,
                                                arg_info->signature,
                                                error);
      if (arg_gvariant == NULL)
        {
          /*
           * HACK: Work around bug in JSON-glib, see:
           * https://bugzilla.gnome.org/show_bug.cgi?id=724319
           */
          if (local_error &&
              g_error_matches (local_error, G_IO_ERROR, G_IO_ERROR_INVALID_DATA) &&
              json_node_get_node_type (arg_node) == JSON_NODE_VALUE &&
              g_strcmp0 (arg_info->signature, "d") == 0)
            {
              arg_gvariant = g_variant_new_double (json_node_get_int (arg_node));
              g_clear_error (error);
            }
          else
            {
              g_assert (error);
              g_prefix_error (error,
                              "Error converting arg %d to GVariant of type %s for method %s on interface %s: ",
                              n,
                              arg_info->signature,
                              method_name,
                              iface_name);
              g_variant_builder_clear (&arg_builder);
              goto out;
            }
        }
      /* replace DBusValue(type, value) entries */
      old = arg_gvariant;
      arg_gvariant = _my_replace (arg_gvariant);
      g_variant_unref (old);
      g_variant_builder_add_value (&arg_builder, arg_gvariant);
    }

  call_data = g_new0 (CallData, 1);
  call_data->data = data;
  call_data->cookie = g_strdup (cookie);

  data->active_calls = g_list_prepend (data->active_calls, call_data);
  call_data->link = g_list_find (data->active_calls, call_data);

  /* and now, issue the call */
  g_dbus_proxy_call (G_DBUS_PROXY (iface_proxy),
                     method_name,
                     g_variant_builder_end (&arg_builder),
                     G_DBUS_CALL_FLAGS_NO_AUTO_START,
                     G_MAXINT, /* timeout */
                     data->cancellable,
                     (GAsyncReadyCallback)dbus_call_cb,
                     call_data); /* user_data*/

  ret = TRUE;

out:
  if (local_error)
    {
      g_warning ("%s (%s %d)",
                 local_error->message, g_quark_to_string (local_error->domain), local_error->code);
      g_clear_error (&local_error);
    }
  g_clear_object (&iface_proxy);
  return ret;
}

static gboolean
handle_message (CockpitTransport *transport,
                gint channel,
                GBytes *message,
                gpointer user_data)
{
  GError *error = NULL;
  DBusServerData *data = user_data;
  gs_free gchar *buf = NULL;
  gs_unref_object JsonParser *parser = NULL;
  gsize size;

  parser = json_parser_new ();

  size = g_bytes_get_size (message);
  if (!json_parser_load_from_data (parser, g_bytes_get_data (message, NULL), size, &error))
    {
      g_prefix_error (&error, "Error parsing `%s' as JSON: ", buf);
      goto close;
    }

  JsonNode *root_node = json_parser_get_root (parser);

  if (JSON_NODE_TYPE (root_node) != JSON_NODE_OBJECT)
    goto close;

  JsonObject *root = json_node_get_object (root_node);

  if (g_strcmp0 (json_object_get_string_member (root, "command"), "call") == 0)
    {
      if (!handle_dbus_call (data, root))
        goto close;
    }
  else
    {
      g_set_error (&error, G_IO_ERROR, G_IO_ERROR_FAILED, "Unknown command in JSON");
      goto close;
    }

  return TRUE;

close:
  if (error)
    {
      g_warning ("%s", error->message);
      g_error_free (error);
    }
  cockpit_transport_close (transport, "protocol-error");
  return TRUE;
}

static void
handle_closed (CockpitTransport *transport,
               const gchar *problem,
               gpointer user_data)
{
  DBusServerData *data = user_data;
  g_main_loop_quit (data->loop);
}

void
dbus_server_serve_dbus (GBusType bus_type,
                        const char *dbus_service,
                        const char *dbus_path,
                        CockpitTransport *transport)
{
  GError *error = NULL;
  guint recv_sig;
  guint close_sig;

  g_type_init ();

  gs_unref_object GDBusObjectManager *object_manager =
    g_dbus_object_manager_client_new_for_bus_sync (bus_type,
                                                   G_DBUS_OBJECT_MANAGER_CLIENT_FLAGS_NONE,
                                                   dbus_service,
                                                   dbus_path,
                                                   NULL, /* GDBusProxyTypeFunc */
                                                   NULL, /* user_data for GDBusProxyTypeFunc */
                                                   NULL, /* GDestroyNotify for GDBusProxyTypeFunc */
                                                   NULL, /* GCancellable */
                                                   &error);
  if (object_manager == NULL)
    {
      g_warning ("%s", error->message);
      return;
    }

  DBusServerData data;
  data.object_manager = G_DBUS_OBJECT_MANAGER_CLIENT (object_manager);
  data.cancellable = g_cancellable_new ();
  data.active_calls = NULL;
  data.transport = transport;

  g_signal_connect (data.object_manager,
                    "object-added",
                    G_CALLBACK (on_object_added),
                    &data);
  g_signal_connect (data.object_manager,
                    "object-removed",
                    G_CALLBACK (on_object_removed),
                    &data);
  g_signal_connect (data.object_manager,
                    "interface-added",
                    G_CALLBACK (on_interface_added),
                    &data);
  g_signal_connect (data.object_manager,
                    "interface-removed",
                    G_CALLBACK (on_interface_removed),
                    &data);
  g_signal_connect (data.object_manager,
                    "interface-proxy-properties-changed",
                    G_CALLBACK (on_interface_proxy_properties_changed),
                    &data);
  g_signal_connect (data.object_manager,
                    "interface-proxy-signal",
                    G_CALLBACK (on_interface_proxy_signal),
                    &data);

  recv_sig = g_signal_connect (data.transport, "recv", G_CALLBACK (handle_message), &data);
  close_sig = g_signal_connect (data.transport, "closed", G_CALLBACK (handle_closed), &data);

  send_seed (&data);

  data.loop = g_main_loop_new (NULL, FALSE);
  g_main_loop_run (data.loop);

  g_signal_handler_disconnect (data.transport, recv_sig);
  g_signal_handler_disconnect (data.transport, close_sig);

  g_signal_handlers_disconnect_by_func (data.object_manager,
                                        G_CALLBACK (on_object_added),
                                        &data);
  g_signal_handlers_disconnect_by_func (data.object_manager,
                                        G_CALLBACK (on_object_removed),
                                        &data);
  g_signal_handlers_disconnect_by_func (data.object_manager,
                                        G_CALLBACK (on_interface_added),
                                        &data);
  g_signal_handlers_disconnect_by_func (data.object_manager,
                                        G_CALLBACK (on_interface_removed),
                                        &data);
  g_signal_handlers_disconnect_by_func (data.object_manager,
                                        G_CALLBACK (on_interface_proxy_properties_changed),
                                        &data);
  g_signal_handlers_disconnect_by_func (data.object_manager,
                                        G_CALLBACK (on_interface_proxy_signal),
                                        &data);

  for (GList *c = data.active_calls; c; c = c->next)
    {
      CallData *cd = c->data;
      cd->data = NULL;
    }

  g_cancellable_cancel (data.cancellable);
  g_main_loop_unref (data.loop);
}
