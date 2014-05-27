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

#include "cockpitdbusjson.h"

#include "cockpitchannel.h"
#include "cockpitfakemanager.h"

#include "cockpit/cockpitjson.h"

#include <unistd.h>
#include <stdint.h>
#include <stdio.h>
#include <pwd.h>

#include <gio/gio.h>
#include <gio/gunixinputstream.h>
#include <gio/gunixoutputstream.h>
#include <json-glib/json-glib.h>

#include <gsystem-local-alloc.h>

#include <string.h>

/**
 * CockpitDBusJson:
 *
 * A #CockpitChannel that sends DBus messages with the dbus-json2 payload
 * type.
 */

#define COCKPIT_DBUS_JSON(o)    (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_DBUS_JSON, CockpitDBusJson))

typedef struct {
  CockpitChannel parent;
  GDBusObjectManager       *object_manager;
  GCancellable             *cancellable;
  GList                    *active_calls;
  GHashTable               *introspect_cache;
} CockpitDBusJson;

typedef struct {
  CockpitChannelClass parent_class;
} CockpitDBusJsonClass;


G_DEFINE_TYPE (CockpitDBusJson, cockpit_dbus_json, COCKPIT_TYPE_CHANNEL);

static gboolean
check_type (JsonNode *node,
            JsonNodeType type,
            GType sub_type,
            GError **error)
{
  if (JSON_NODE_TYPE (node) != type ||
      (type == JSON_NODE_VALUE && (json_node_get_value_type (node) != sub_type)))
    {
      g_set_error (error, G_IO_ERROR, G_IO_ERROR_INVALID_DATA,
                   "Unexpected type '%s' in JSON node",
                   g_type_name (json_node_get_value_type (node)));
      return FALSE;
    }
  return TRUE;
}

static GVariant *
parse_json (JsonNode *node,
            const GVariantType *type,
            GError **error);

static GVariant *
parse_json_tuple (JsonNode *node,
                  const GVariantType *child_type,
                  GError **error)
{
  GVariant *result = NULL;
  GPtrArray *children;
  GVariant *value;
  JsonArray *array;
  guint length;
  guint i;

  children = g_ptr_array_new ();

  if (!check_type (node, JSON_NODE_ARRAY, 0, error))
    goto out;

  array = json_node_get_array (node);
  length = json_array_get_length (array);

  for (i = 0; i < length; i++)
    {
      value = NULL;
      if (child_type == NULL)
        {
          g_set_error (error, G_IO_ERROR, G_IO_ERROR_INVALID_DATA,
                       "Too many values in tuple/struct");
        }
      else
        {
          value = parse_json (json_array_get_element (array, i),
                              child_type, error);
        }

      if (!value)
        goto out;

      g_ptr_array_add (children, value);
      child_type = g_variant_type_next (child_type);
    }

  if (child_type)
    {
      g_set_error (error, G_IO_ERROR, G_IO_ERROR_INVALID_DATA,
                   "Too few values in tuple/struct");
      goto out;
    }

  result = g_variant_new_tuple ((GVariant *const *)children->pdata,
                                children->len);
  children->len = 0;

out:
  g_ptr_array_foreach (children, (GFunc)g_variant_unref, NULL);
  g_ptr_array_free (children, TRUE);
  return result;
}

static GVariant *
parse_json_array (JsonNode *node,
                  const GVariantType *child_type,
                  GError **error)
{
  GVariant *result = NULL;
  GPtrArray *children;
  GVariant *child;
  JsonArray *array;
  guint length;
  guint i;

  children = g_ptr_array_new ();

  if (!check_type (node, JSON_NODE_ARRAY, 0, error))
    goto out;

  array = json_node_get_array (node);
  length = json_array_get_length (array);

  for (i = 0; i < length; i++)
    {
      child = parse_json (json_array_get_element (array, i),
                          child_type,
                          error);
      if (!child)
        goto out;

      g_ptr_array_add (children, child);
    }

  result = g_variant_new_array (child_type,
                                (GVariant *const *)children->pdata,
                                children->len);
  children->len = 0;

out:
  g_ptr_array_foreach (children, (GFunc)g_variant_unref, NULL);
  g_ptr_array_free (children, TRUE);
  return result;
}

static GVariant *
parse_json_with_sig (JsonObject *object,
                     GError **error)
{
  GVariantType *inner_type;
  GVariant *inner;
  JsonNode *val;
  const gchar *sig;

  val = json_object_get_member (object, "val");
  if (val == NULL)
    {
      g_set_error (error, G_IO_ERROR, G_IO_ERROR_INVALID_DATA,
                   "JSON did not contain a 'val' field");
      return NULL;
    }
  if (!cockpit_json_get_string (object, "sig", NULL, &sig) || !sig)
    {
      g_set_error (error, G_IO_ERROR, G_IO_ERROR_INVALID_DATA,
                   "JSON did not contain valid 'sig' fields");
      return NULL;
    }
  if (!g_variant_type_string_is_valid (sig))
    {
      g_set_error (error, G_IO_ERROR, G_IO_ERROR_INVALID_DATA,
                   "JSON 'sig' field '%s' is invalid", sig);
      return NULL;
    }

  inner_type = g_variant_type_new (sig);
  inner = parse_json (val, inner_type, error);
  g_variant_type_free (inner_type);

  if (!inner)
    return NULL;

  return g_variant_new_variant (inner);
}

static GVariant *
parse_json_variant (JsonNode *node,
                    GError **error)
{
  if (check_type (node, JSON_NODE_OBJECT, 0, error))
    return parse_json_with_sig (json_node_get_object (node), error);
  return NULL;
}

static GVariant *
parse_json_dictionary (JsonNode *node,
                       const GVariantType *entry_type,
                       GError **error)
{
  const GVariantType *key_type;
  const GVariantType *value_type;
  GVariant *result = NULL;
  GPtrArray *children;
  JsonObject *object;
  JsonNode *key_node;
  GList *members = NULL;
  gboolean is_string;
  GVariant *value;
  GVariant *key;
  GVariant *child;
  GList *l;

  children = g_ptr_array_new ();

  if (!check_type (node, JSON_NODE_OBJECT, 0, error))
    goto out;

  object = json_node_get_object (node);
  key_type = g_variant_type_key (entry_type);
  value_type = g_variant_type_value (entry_type);

  is_string = (g_variant_type_equal (key_type, G_VARIANT_TYPE_STRING) ||
               g_variant_type_equal (key_type, G_VARIANT_TYPE_OBJECT_PATH) ||
               g_variant_type_equal (key_type, G_VARIANT_TYPE_SIGNATURE));

  members = json_object_get_members (object);
  for (l = members; l != NULL; l = g_list_next (l))
    {
      if (is_string)
        {
          key_node = json_node_init_string (json_node_alloc (), l->data);
        }
      else
        {
          key_node = cockpit_json_parse (l->data, -1, NULL);
          if (key_node == NULL)
            {
              g_set_error (error, G_IO_ERROR, G_IO_ERROR_INVALID_DATA,
                           "Unexpected key '%s' in JSON object", (gchar *)l->data);
              goto out;
            }
        }

      key = parse_json (key_node, key_type, error);
      json_node_free (key_node);

      if (!key)
        goto out;

      value = parse_json (json_object_get_member (object, l->data),
                          value_type, error);
      if (!value)
        {
          g_variant_unref (key);
          goto out;
        }

      child = g_variant_new_dict_entry (key, value);
      g_ptr_array_add (children, child);
    }

  result = g_variant_new_array (entry_type,
                                (GVariant *const *)children->pdata,
                                children->len);
  children->len = 0;

out:
  g_list_free (members);
  g_ptr_array_foreach (children, (GFunc)g_variant_unref, NULL);
  g_ptr_array_free (children, TRUE);
  return result;
}

static void
parse_not_supported (const GVariantType *type,
                     GError **error)
{
  g_set_error (error, G_IO_ERROR, G_IO_ERROR_INVALID_DATA,
               "DBus type '%.*s' is unknown or not supported",
               (int)g_variant_type_get_string_length (type),
               g_variant_type_peek_string (type));
}

static GVariant *
parse_json (JsonNode *node,
            const GVariantType *type,
            GError **error)
{
  const GVariantType *element_type;
  const gchar *str;

  if (!g_variant_type_is_definite (type))
    {
      g_set_error (error, G_IO_ERROR, G_IO_ERROR_INVALID_DATA,
                   "Indefinite type '%.*s' is not supported",
                   (int)g_variant_type_get_string_length (type),
                   g_variant_type_peek_string (type));
      return NULL;
    }

  if (g_variant_type_is_basic (type))
    {
      if (g_variant_type_equal (type, G_VARIANT_TYPE_BOOLEAN))
        {
          if (check_type (node, JSON_NODE_VALUE, G_TYPE_BOOLEAN, error))
            return g_variant_new_boolean (json_node_get_boolean (node));
        }
      else if (g_variant_type_equal (type, G_VARIANT_TYPE_BYTE))
        {
          if (check_type (node, JSON_NODE_VALUE, G_TYPE_INT64, error))
            return g_variant_new_byte (json_node_get_int (node));
        }
      else if (g_variant_type_equal (type, G_VARIANT_TYPE_INT16))
        {
          if (check_type (node, JSON_NODE_VALUE, G_TYPE_INT64, error))
            return g_variant_new_int16 (json_node_get_int (node));
        }
      else if (g_variant_type_equal (type, G_VARIANT_TYPE_UINT16))
        {
          if (check_type (node, JSON_NODE_VALUE, G_TYPE_INT64, error))
            return g_variant_new_uint16 (json_node_get_int (node));
        }
      else if (g_variant_type_equal (type, G_VARIANT_TYPE_INT32))
        {
          if (check_type (node, JSON_NODE_VALUE, G_TYPE_INT64, error))
            return g_variant_new_int32 (json_node_get_int (node));
        }
      else if (g_variant_type_equal (type, G_VARIANT_TYPE_UINT32))
        {
          if (check_type (node, JSON_NODE_VALUE, G_TYPE_INT64, error))
            return g_variant_new_uint32 (json_node_get_int (node));
        }
      else if (g_variant_type_equal (type, G_VARIANT_TYPE_INT64))
        {
          if (check_type (node, JSON_NODE_VALUE, G_TYPE_INT64, error))
            return g_variant_new_int64 (json_node_get_int (node));
        }
      else if (g_variant_type_equal (type, G_VARIANT_TYPE_UINT64))
        {
          if (check_type (node, JSON_NODE_VALUE, G_TYPE_INT64, error))
            return g_variant_new_uint64 (json_node_get_int (node));
        }
      else if (g_variant_type_equal (type, G_VARIANT_TYPE_DOUBLE))
        {
          if (check_type (node, JSON_NODE_VALUE, G_TYPE_INT64, NULL))
            return g_variant_new_double (json_node_get_int (node));
          else if (check_type (node, JSON_NODE_VALUE, G_TYPE_DOUBLE, error))
            return g_variant_new_double (json_node_get_double (node));
        }
      else if (g_variant_type_equal (type, G_VARIANT_TYPE_STRING))
        {
          if (check_type (node, JSON_NODE_VALUE, G_TYPE_STRING, error))
            return g_variant_new_string (json_node_get_string (node));
        }
      else if (g_variant_type_equal (type, G_VARIANT_TYPE_OBJECT_PATH))
        {
          if (check_type (node, JSON_NODE_VALUE, G_TYPE_STRING, error))
            {
              str = json_node_get_string (node);
              if (g_variant_is_object_path (str))
                return g_variant_new_object_path (str);
              else
                {
                  g_set_error (error, G_IO_ERROR, G_IO_ERROR_INVALID_DATA,
                               "Invalid object path '%s'", str);
                  return NULL;
                }
            }
        }
      else if (g_variant_type_equal (type, G_VARIANT_TYPE_SIGNATURE))
        {
          if (check_type (node, JSON_NODE_VALUE, G_TYPE_STRING, error))
            {
              str = json_node_get_string (node);
              if (g_variant_is_signature (str))
                return g_variant_new_signature (str);
              else
                {
                  g_set_error (error, G_IO_ERROR, G_IO_ERROR_INVALID_DATA,
                               "Invalid signature '%s'", str);
                  return NULL;
                }
            }
        }
      else
        {
          parse_not_supported (type, error);
        }
    }
  else if (g_variant_type_is_variant (type))
    {
      return parse_json_variant (node, error);
    }
  else if (g_variant_type_is_array (type))
    {
      element_type = g_variant_type_element (type);
      if (g_variant_type_is_dict_entry (element_type))
        return parse_json_dictionary (node, element_type, error);
      else
        return parse_json_array (node, element_type, error);
    }
  else if (g_variant_type_is_tuple (type))
    {
      return parse_json_tuple (node, g_variant_type_first (type), error);
    }
  else
    {
      parse_not_supported (type, error);
    }

  return NULL;
}

static void
build_json (JsonBuilder *builder,
            GVariant *value);

static void
build_json_with_sig (JsonBuilder *builder,
                     GVariant *value)
{
  json_builder_set_member_name (builder, "sig");
  json_builder_add_string_value (builder, g_variant_get_type_string (value));
  json_builder_set_member_name (builder, "val");
  build_json (builder, value);
}

static void
build_json_array_or_tuple (JsonBuilder *builder,
                           GVariant *value)
{
  GVariantIter iter;
  GVariant *child;

  json_builder_begin_array (builder);

  g_variant_iter_init (&iter, value);
  while ((child = g_variant_iter_next_value (&iter)) != NULL)
    {
      build_json (builder, child);
      g_variant_unref (child);
    }

  json_builder_end_array (builder);
}

static void
build_json_variant (JsonBuilder *builder,
                    GVariant *value)
{
  GVariant *child;

  child = g_variant_get_variant (value);
  json_builder_begin_object (builder);

  build_json_with_sig (builder, child);

  json_builder_end_object (builder);
  g_variant_unref (child);
}

static void
build_json_dictionary (JsonBuilder *builder,
                       const GVariantType *entry_type,
                       GVariant *dict)
{
  const GVariantType *key_type;
  GVariantIter iter;
  GVariant *child;
  GVariant *key;
  GVariant *value;
  gboolean is_string;
  gchar *key_string;

  json_builder_begin_object (builder);
  key_type = g_variant_type_key (entry_type);

  is_string = (g_variant_type_equal (key_type, G_VARIANT_TYPE_STRING) ||
               g_variant_type_equal (key_type, G_VARIANT_TYPE_OBJECT_PATH) ||
               g_variant_type_equal (key_type, G_VARIANT_TYPE_SIGNATURE));

  g_variant_iter_init (&iter, dict);
  while ((child = g_variant_iter_next_value (&iter)) != NULL)
    {
      key = g_variant_get_child_value (child, 0);
      value = g_variant_get_child_value (child, 1);

      if (is_string)
        {
          json_builder_set_member_name (builder, g_variant_get_string (key, NULL));
        }
      else
        {
          key_string = g_variant_print (key, FALSE);
          json_builder_set_member_name (builder, key_string);
          g_free (key_string);
        }

      build_json (builder, value);

      g_variant_unref (key);
      g_variant_unref (value);
    }

  json_builder_end_object (builder);
}

static void
build_json (JsonBuilder *builder,
            GVariant *value)
{
  const GVariantType *type;
  const GVariantType *element_type;

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
      {
        /* HACK: We can't use json_builder_add_string_value here since
           it turns empty strings into 'null' values inside arrays.

           https://bugzilla.gnome.org/show_bug.cgi?id=730803
        */
        JsonNode *string_element = json_node_alloc ();
        json_node_init_string (string_element, g_variant_get_string (value, NULL));
        json_builder_add_value (builder, string_element);
      }
      break;

    case G_VARIANT_CLASS_VARIANT:
      build_json_variant (builder, value);
      break;

    case G_VARIANT_CLASS_ARRAY:
      type = g_variant_get_type (value);
      element_type = g_variant_type_element (type);
      if (g_variant_type_is_dict_entry (element_type))
        build_json_dictionary (builder, element_type, value);
      else
        build_json_array_or_tuple (builder, value);
      break;

    case G_VARIANT_CLASS_TUPLE:
      build_json_array_or_tuple (builder, value);
      break;

    case G_VARIANT_CLASS_DICT_ENTRY:
    case G_VARIANT_CLASS_MAYBE:
    default:
      g_return_if_reached ();
      break;
    }

  g_variant_unref (value);
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
write_builder (CockpitDBusJson *self,
               JsonBuilder *builder)
{
  GBytes *bytes;
  JsonNode *root;
  gsize length;
  gchar *ret;

  json_builder_end_object (builder);

  root = json_builder_get_root (builder);
  ret = cockpit_json_write (root, &length);
  json_node_free (root);

  bytes = g_bytes_new_take (ret, length);
  cockpit_channel_send (COCKPIT_CHANNEL (self), bytes);
  g_bytes_unref (bytes);
}

/* ---------------------------------------------------------------------------------------------------- */

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
              build_json (builder, value);
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
          build_json (builder, value);
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
send_seed (CockpitDBusJson *self)
{
  gs_unref_object JsonBuilder *builder = json_builder_new ();

  json_builder_begin_object (builder);
  json_builder_set_member_name (builder, "command");
  json_builder_add_string_value (builder, "seed");

  json_builder_set_member_name (builder, "options");
  json_builder_begin_object (builder);
  json_builder_set_member_name (builder, "byteorder");
  if (G_BYTE_ORDER == G_LITTLE_ENDIAN)
    json_builder_add_string_value (builder, "le");
  else if (G_BYTE_ORDER == G_BIG_ENDIAN)
    json_builder_add_string_value (builder, "be");
  else
    json_builder_add_string_value (builder, "");
  json_builder_end_object (builder);

  json_builder_set_member_name (builder, "data");
  json_builder_begin_object (builder);

  GList *objects = g_dbus_object_manager_get_objects (self->object_manager);
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

  write_builder (self, builder);
}

/* ---------------------------------------------------------------------------------------------------- */

static void
on_object_added (GDBusObjectManager *manager,
                 GDBusObject *object,
                 gpointer user_data)
{
  CockpitDBusJson *self = user_data;
  gs_unref_object JsonBuilder *builder = prepare_builder ("object-added");

  json_builder_begin_object (builder);
  json_builder_set_member_name (builder, "object");
  json_builder_begin_object (builder);
  add_object (builder, object);
  json_builder_end_object (builder);
  json_builder_end_object (builder);

  write_builder (self, builder);
}

static void
on_object_removed (GDBusObjectManager *manager,
                   GDBusObject *object,
                   gpointer user_data)
{
  CockpitDBusJson *self = user_data;
  gs_unref_object JsonBuilder *builder = prepare_builder ("object-removed");

  json_builder_begin_array (builder);
  json_builder_add_string_value (builder, g_dbus_object_get_object_path (object));
  json_builder_end_array (builder);

  write_builder (self, builder);
}

/* ---------------------------------------------------------------------------------------------------- */

static void
on_interface_added (GDBusObjectManager *manager,
                    GDBusObject *object,
                    GDBusInterface *interface,
                    gpointer user_data)
{
  CockpitDBusJson *self = user_data;
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

  write_builder (self, builder);
}

static void
on_interface_removed (GDBusObjectManager *manager,
                      GDBusObject *object,
                      GDBusInterface *interface,
                      gpointer user_data)
{
  CockpitDBusJson *self = user_data;
  gs_unref_object JsonBuilder *builder = prepare_builder ("interface-removed");

  json_builder_begin_object (builder);
  json_builder_set_member_name (builder, "objpath");
  json_builder_add_string_value (builder, g_dbus_object_get_object_path (object));
  json_builder_set_member_name (builder, "iface_name");
  json_builder_add_string_value (builder, g_dbus_proxy_get_interface_name (G_DBUS_PROXY (interface)));
  json_builder_end_object (builder);

  write_builder (self, builder);
}

static void
on_interface_proxy_properties_changed (GDBusObjectManager *manager,
                                       GDBusObjectProxy *object_proxy,
                                       GDBusProxy *interface_proxy,
                                       GVariant *changed_properties,
                                       const gchar * const *invalidated_properties,
                                       gpointer user_data)
{
  CockpitDBusJson *self = user_data;
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

  write_builder (self, builder);
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
  CockpitDBusJson *self = user_data;
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
      build_json (builder, child);
      g_variant_unref (child);
    }
  json_builder_end_array (builder);

  json_builder_end_object (builder);

  write_builder (self, builder);
}

/* ---------------------------------------------------------------------------------------------------- */

static void
send_dbus_reply (CockpitDBusJson *self, const gchar *cookie, GVariant *result, GError *error)
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
      build_json (builder, result);
    }
  json_builder_end_object (builder);

  write_builder (self, builder);
}

static GVariantType *
compute_complete_signature (GDBusArgInfo **args)
{
  const GVariantType *arg_types[256];
  guint n;

  if (args)
    {
      for (n = 0; args[n] != NULL; n++)
        {
          /* DBus places a hard limit of 255 on signature length.
           * therefore number of args must be less than 256.
           */
          if (n >= G_N_ELEMENTS (arg_types))
            return NULL;

          arg_types[n] = G_VARIANT_TYPE (args[n]->signature);

          if G_UNLIKELY (arg_types[n] == NULL)
            return NULL;
        }
    }
  else
    {
      n = 0;
    }
  return g_variant_type_new_tuple (arg_types, n);
}

typedef struct
{
  /* Cleared by dispose */
  GList *link;
  CockpitDBusJson *dbus_json;

  /* Request data */
  GDBusConnection *connection;
  JsonObject *request;

  /* Owned by proxy or cache */
  GDBusInterfaceInfo *iface_info;

  /* Owned by request */
  const gchar *cookie;
  const gchar *iface_name;
  const gchar *method_name;
  const gchar *objpath;
  JsonNode *args;
} CallData;

static void
call_data_free (CallData *data)
{
  if (data->dbus_json)
    data->dbus_json->active_calls = g_list_delete_link (data->dbus_json->active_calls, data->link);

  g_object_unref (data->connection);
  json_object_unref (data->request);
  g_free (data);
}

static void
dbus_call_cb (GDBusConnection *connection,
              GAsyncResult *res,
              gpointer user_data)
{
  CallData *data = user_data;
  GVariant *result;
  GError *error;

  error = NULL;
  result = g_dbus_connection_call_finish (connection, res, &error);

  if (data->dbus_json)
    send_dbus_reply (data->dbus_json, data->cookie, result, error);

  if (result)
    g_variant_unref (result);
  g_clear_error (&error);
  call_data_free (data);
}


static void
handle_dbus_call_on_interface (CockpitDBusJson *self,
                               CallData *call_data)
{
  GDBusMethodInfo *method_info = NULL;
  GVariantType *param_type;
  GVariantType *reply_type;
  GVariant *parameters = NULL;
  GError *error = NULL;
  gchar *owner;

  if (call_data->iface_info)
    method_info = g_dbus_interface_info_lookup_method (call_data->iface_info, call_data->method_name);
  if (method_info == NULL)
    {
      g_set_error (&error, G_IO_ERROR, G_IO_ERROR_FAILED,
                   "Introspection data for method %s on D-Bus interface %s not in cache",
                   call_data->iface_name, call_data->method_name);
      goto out;
    }
  param_type = compute_complete_signature (method_info->in_args);
  parameters = parse_json (call_data->args, param_type, &error);
  g_variant_type_free (param_type);

  if (!parameters)
    {
      g_prefix_error (&error, "Failed to convert parameters for '%s': ", call_data->method_name);
      goto out;
    }

  g_debug ("invoking %s %s.%s", call_data->objpath, call_data->iface_name, call_data->method_name);

  g_object_get (self->object_manager, "name-owner", &owner, NULL);

  reply_type = compute_complete_signature (method_info->out_args);

  /* and now, issue the call */
  g_dbus_connection_call (call_data->connection, owner, call_data->objpath,
                          call_data->iface_name, call_data->method_name,
                          parameters,
                          reply_type,
                          G_DBUS_CALL_FLAGS_NO_AUTO_START,
                          G_MAXINT, /* timeout */
                          self->cancellable,
                          (GAsyncReadyCallback)dbus_call_cb,
                          call_data); /* user_data*/

  g_variant_type_free (reply_type);

  g_free (owner);

out:
  if (error)
    {
      send_dbus_reply (self, call_data->cookie, NULL, error);
      g_error_free (error);
      call_data_free (call_data);
    }
}

static void
on_introspect_ready (GObject *source,
                     GAsyncResult *result,
                     gpointer user_data)
{
  CallData *call_data = (CallData *)user_data;
  CockpitDBusJson *self;
  GVariant *val = NULL;
  GDBusNodeInfo *node = NULL;
  GDBusInterfaceInfo *iface = NULL;
  const gchar *xml = NULL;
  GError *error = NULL;
  gboolean not_found;
  gboolean expected;
  gchar *remote;
  gint i;

  /* Cancelled? */
  if (!call_data->dbus_json)
    {
      call_data_free (call_data);
      return;
    }

  not_found = FALSE;

  self = COCKPIT_DBUS_JSON (call_data->dbus_json);
  val = g_dbus_connection_call_finish (G_DBUS_CONNECTION (source), result, &error);
  if (error)
    {
      /*
       * Note that many DBus implementations don't return errors when
       * an unknown object path is introspected. They just return empty
       * introspect data. GDBus is one of these.
       */

      expected = FALSE;
      remote = g_dbus_error_get_remote_error (error);
      if (remote)
        {
          /*
           * DBus used to only have the UnknownMethod error. It didn't have
           * specific errors for UnknownObject and UnknownInterface. So we're
           * pretty liberal on what we treat as an expected error here.
           *
           * HACK: GDBus also doesn't understand the newer error codes :S
           *
           * https://bugzilla.gnome.org/show_bug.cgi?id=727900
           */
          expected = (g_str_equal (remote, "org.freedesktop.DBus.Error.UnknownMethod") ||
                      g_str_equal (remote, "org.freedesktop.DBus.Error.UnknownObject") ||
                      g_str_equal (remote, "org.freedesktop.DBus.Error.UnknownInterface"));
          not_found = TRUE;
          g_free (remote);
        }

      if (expected)
        {
          g_debug ("no introspect data found for object %s", call_data->objpath);
        }
      else
        {
          g_message ("Couldn't look up introspection for object %s: %s",
                     call_data->objpath, error->message);
        }
      g_clear_error (&error);
    }

  if (val)
    {
      g_debug ("got introspect data for %s", call_data->objpath);

      g_variant_get (val, "(&s)", &xml);
      node = g_dbus_node_info_new_for_xml (xml, &error);
      if (error)
        {
          g_message ("Invalid DBus introspect data received for object %s: %s",
                     call_data->objpath, error->message);
          g_clear_error (&error);
        }
      else if (node)
        {
          not_found = TRUE;
          for (i = 0; node->interfaces && node->interfaces[i] != NULL; i++)
            {
              iface = node->interfaces[i];
              if (iface->name)
                {
                  g_hash_table_replace (self->introspect_cache, iface->name,
                                        g_dbus_interface_info_ref (iface));
                  if (g_str_equal (iface->name, call_data->iface_name))
                    not_found = FALSE;
                }
            }
          g_dbus_node_info_unref (node);
        }
      g_variant_unref (val);
    }

  /*
   * If we got introspect data *but* the service didn't know about the object, then
   * we know there's no such object. We cannot simply perform the call and have the
   * service reply with the real error message. We have no way to make the call with
   * the right arguments.
   *
   * So return an intelligent error message here.
   */
  if (not_found)
    {
      g_set_error (&error, G_IO_ERROR, G_IO_ERROR_FAILED,
                   "No iface for objpath %s and iface %s calling %s",
                   call_data->objpath, call_data->iface_name, call_data->method_name);
      send_dbus_reply (self, call_data->cookie, NULL, error);
      g_error_free (error);
      call_data_free (call_data);
      return;
    }

  call_data->iface_info = g_hash_table_lookup (self->introspect_cache, call_data->iface_name);
  handle_dbus_call_on_interface (self, call_data);
}

static gboolean
handle_dbus_call (CockpitDBusJson *self,
                  JsonObject *root)
{
  GDBusInterface *iface_proxy;
  gchar *owner = NULL;
  CallData *call_data;

  call_data = g_new0 (CallData, 1);
  call_data->objpath = json_object_get_string_member (root, "objpath");
  call_data->iface_name = json_object_get_string_member (root, "iface");
  call_data->method_name = json_object_get_string_member (root, "method");
  call_data->cookie = json_object_get_string_member (root, "cookie");
  call_data->args = json_object_get_member (root, "args");

  if (!(g_variant_is_object_path (call_data->objpath) &&
        g_dbus_is_interface_name (call_data->iface_name) &&
        g_dbus_is_member_name (call_data->method_name) &&
        call_data->cookie != NULL &&
        call_data->args != NULL))
    {
      g_warning ("Invalid data in call message");
      g_free (call_data);
      return FALSE;
    }

  call_data->dbus_json = self;
  call_data->request = json_object_ref (root);
  self->active_calls = g_list_prepend (self->active_calls, call_data);
  call_data->link = g_list_find (self->active_calls, call_data);
  g_object_get (self->object_manager, "connection", &call_data->connection, NULL);

  call_data->iface_info = g_hash_table_lookup (self->introspect_cache,
                                               call_data->iface_name);
  if (call_data->iface_info)
    {
      g_debug ("found introspect data for %s in cache", call_data->iface_name);
    }
  else
    {
      iface_proxy = g_dbus_object_manager_get_interface (self->object_manager,
                                                         call_data->objpath,
                                                         call_data->iface_name);
      if (iface_proxy)
        {
          call_data->iface_info = g_dbus_interface_get_info (iface_proxy);
          g_object_unref (iface_proxy);
        }
    }

  if (call_data->iface_info != NULL)
    {
      /* Frees call data when done */
      handle_dbus_call_on_interface (self, call_data);
    }
  else
    {
      g_debug ("no introspect data for %s %s", call_data->objpath, call_data->iface_name);

      g_object_get (self->object_manager,
                    "name-owner", &owner,
                    NULL);

      g_dbus_connection_call (call_data->connection, owner, call_data->objpath,
                              "org.freedesktop.DBus.Introspectable", "Introspect",
                              NULL, G_VARIANT_TYPE ("(s)"),
                              G_DBUS_CALL_FLAGS_NO_AUTO_START,
                              -1, /* timeout */
                              NULL, /* GCancellable */
                              on_introspect_ready, call_data);

      g_free (owner);
    }

  return TRUE;
}

static void
cockpit_dbus_json_recv (CockpitChannel *channel,
                          GBytes *message)
{
  CockpitDBusJson *self = COCKPIT_DBUS_JSON (channel);
  GError *error = NULL;
  gs_free gchar *buf = NULL;
  JsonObject *root = NULL;

  root = cockpit_json_parse_bytes (message, &error);
  if (!root)
    {
      g_prefix_error (&error, "Error parsing `%s' as JSON: ", buf);
      goto close;
    }

  if (g_strcmp0 (json_object_get_string_member (root, "command"), "call") == 0)
    {
      if (!handle_dbus_call (self, root))
        goto close;
    }
  else
    {
      g_set_error (&error, G_IO_ERROR, G_IO_ERROR_FAILED, "Unknown command in JSON");
      goto close;
    }

  return;

close:
  if (root)
    json_object_unref (root);
  if (error)
    {
      g_warning ("%s", error->message);
      g_error_free (error);
    }
  cockpit_channel_close (channel, "protocol-error");
}

static void
on_object_manager_ready (GObject *source,
                         GAsyncResult *result,
                         gpointer user_data)
{
  CockpitDBusJson *self = user_data;
  CockpitChannel *channel = COCKPIT_CHANNEL (self);
  GAsyncInitable *initable;
  GError *error = NULL;

  initable = G_ASYNC_INITABLE (source);
  self->object_manager = G_DBUS_OBJECT_MANAGER (g_async_initable_new_finish (initable, result, &error));

  if (self->object_manager == NULL)
    {
      g_warning ("%s", error->message);
      cockpit_channel_close (channel, "internal-error");
    }
  else
    {
      g_signal_connect (self->object_manager,
                        "object-added",
                        G_CALLBACK (on_object_added),
                        self);
      g_signal_connect (self->object_manager,
                        "object-removed",
                        G_CALLBACK (on_object_removed),
                        self);
      g_signal_connect (self->object_manager,
                        "interface-added",
                        G_CALLBACK (on_interface_added),
                        self);
      g_signal_connect (self->object_manager,
                        "interface-removed",
                        G_CALLBACK (on_interface_removed),
                        self);
      g_signal_connect (self->object_manager,
                        "interface-proxy-properties-changed",
                        G_CALLBACK (on_interface_proxy_properties_changed),
                        self);
      g_signal_connect (self->object_manager,
                        "interface-proxy-signal",
                        G_CALLBACK (on_interface_proxy_signal),
                        self);

      send_seed (self);
      cockpit_channel_ready (channel);
    }

  g_object_unref (self);
}

static void
cockpit_dbus_json_init (CockpitDBusJson *self)
{
  self->cancellable = g_cancellable_new ();
  self->introspect_cache = g_hash_table_new_full (g_str_hash, g_str_equal, NULL,
                                                  (GDestroyNotify)g_dbus_interface_info_unref);
}

static gboolean
on_idle_protocol_error (gpointer user_data)
{
  cockpit_channel_close (user_data, "protocol-error");
  return FALSE;
}

static void
cockpit_dbus_json_constructed (GObject *object)
{
  CockpitDBusJson *self = COCKPIT_DBUS_JSON (object);
  CockpitChannel *channel = COCKPIT_CHANNEL (self);
  const gchar *dbus_service;
  const gchar *dbus_path;
  const gchar *bus;
  const gchar *new_prop_name;
  GType object_manager_type;
  gconstpointer new_prop_value;
  GBusType bus_type;

  G_OBJECT_CLASS (cockpit_dbus_json_parent_class)->constructed (object);

  /*
   * Guarantee: Remember that we cannot close the channel until we've
   * hit the main loop. This is to make it easier and predictable on
   * callers. See teh similar GLib async guarantee.
   */

  dbus_service = cockpit_channel_get_option (channel, "service");
  if (dbus_service == NULL || !g_dbus_is_name (dbus_service))
    {
      g_warning ("agent got invalid dbus service");
      g_idle_add (on_idle_protocol_error, channel);
      return;
    }

  dbus_path = cockpit_channel_get_option (channel, "object-manager");
  if (dbus_path == NULL)
    {
      new_prop_value = cockpit_channel_get_strv_option (channel, "paths");
      new_prop_name = "object-paths";
      object_manager_type = COCKPIT_TYPE_FAKE_MANAGER;
    }
  else if (!g_variant_is_object_path (dbus_path))
    {
      g_warning ("agent got invalid object-manager path");
      g_idle_add (on_idle_protocol_error, channel);
      return;
    }
  else
    {
      new_prop_value = dbus_path;
      new_prop_name = "object-path";
      object_manager_type = G_TYPE_DBUS_OBJECT_MANAGER_CLIENT;
    }

  /*
   * The default bus is the "user" bus which doesn't exist in many
   * places yet, so use the session bus for now.
   */
  bus_type = G_BUS_TYPE_SESSION;
  bus = cockpit_channel_get_option (channel, "bus");
  if (bus == NULL || g_str_equal (bus, "session") ||
      g_str_equal (bus, "user"))
    {
      bus_type = G_BUS_TYPE_SESSION;
    }
  else if (g_str_equal (bus, "system"))
    {
      bus_type = G_BUS_TYPE_SYSTEM;
    }
  else
    {
      g_warning ("agent got an invalid bus type");
      g_idle_add (on_idle_protocol_error, channel);
      return;
    }

  /* Both GDBusObjectManager and CockpitFakeManager have similar props */
  g_async_initable_new_async (object_manager_type,
                              G_PRIORITY_DEFAULT, NULL,
                              on_object_manager_ready,
                              g_object_ref (self),
                              "bus-type", bus_type,
                              "flags", G_DBUS_OBJECT_MANAGER_CLIENT_FLAGS_NONE,
                              "name", dbus_service,
                              new_prop_name, new_prop_value,
                              NULL);
}

static void
cockpit_dbus_json_dispose (GObject *object)
{
  CockpitDBusJson *self = COCKPIT_DBUS_JSON (object);
  GList *l;

  g_signal_handlers_disconnect_by_func (self->object_manager,
                                        G_CALLBACK (on_object_added),
                                        self);
  g_signal_handlers_disconnect_by_func (self->object_manager,
                                        G_CALLBACK (on_object_removed),
                                        self);
  g_signal_handlers_disconnect_by_func (self->object_manager,
                                        G_CALLBACK (on_interface_added),
                                        self);
  g_signal_handlers_disconnect_by_func (self->object_manager,
                                        G_CALLBACK (on_interface_removed),
                                        self);
  g_signal_handlers_disconnect_by_func (self->object_manager,
                                        G_CALLBACK (on_interface_proxy_properties_changed),
                                        self);
  g_signal_handlers_disconnect_by_func (self->object_manager,
                                        G_CALLBACK (on_interface_proxy_signal),
                                        self);

  /* Divorce ourselves the outstanding calls */
  for (l = self->active_calls; l != NULL; l = g_list_next (l))
    ((CallData *)l->data)->dbus_json = NULL;
  g_list_free (self->active_calls);
  self->active_calls = NULL;

  /* And cancel them all, which should free them */
  g_cancellable_cancel (self->cancellable);

  G_OBJECT_CLASS (cockpit_dbus_json_parent_class)->dispose (object);
}

static void
cockpit_dbus_json_finalize (GObject *object)
{
  CockpitDBusJson *self = COCKPIT_DBUS_JSON (object);

  if (self->object_manager)
    g_object_unref (self->object_manager);
  g_object_unref (self->cancellable);
  g_hash_table_destroy (self->introspect_cache);

  G_OBJECT_CLASS (cockpit_dbus_json_parent_class)->finalize (object);
}

static void
cockpit_dbus_json_class_init (CockpitDBusJsonClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);
  CockpitChannelClass *channel_class = COCKPIT_CHANNEL_CLASS (klass);

  gobject_class->constructed = cockpit_dbus_json_constructed;
  gobject_class->dispose = cockpit_dbus_json_dispose;
  gobject_class->finalize = cockpit_dbus_json_finalize;

  channel_class->recv = cockpit_dbus_json_recv;
}

/**
 * cockpit_dbus_json_open:
 * @transport: transport to send messages on
 * @channel_id: the channel id
 * @dbus_service: the DBus service name to talk to
 * @dbus_path: the o.f.D.ObjectManager path
 *
 * This function is mainly used by tests. The normal way to open
 * channels is cockpit_channel_open().
 *
 * Guarantee: channel will not close immediately, even on invalid input.
 *
 * Returns: (transfer full): a new channel
 */
CockpitChannel *
cockpit_dbus_json_open (CockpitTransport *transport,
                        const gchar *channel_id,
                        const gchar *dbus_service,
                        const gchar *dbus_path)
{
  CockpitChannel *channel;
  JsonObject *options;

  g_return_val_if_fail (channel_id != NULL, NULL);

  options = json_object_new ();
  json_object_set_string_member (options, "bus", "session");
  json_object_set_string_member (options, "service", dbus_service);
  json_object_set_string_member (options, "object-manager", dbus_path);
  json_object_set_string_member (options, "payload", "dbus-json2");

  channel = g_object_new (COCKPIT_TYPE_DBUS_JSON,
                          "transport", transport,
                          "id", channel_id,
                          "options", options,
                          NULL);

  json_object_unref (options);
  return channel;
}
