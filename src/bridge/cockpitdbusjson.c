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
#include "cockpitdbuscache.h"
#include "cockpitdbusinternal.h"
#include "cockpitdbusmeta.h"
#include "cockpitdbusrules.h"

#include "common/cockpitjson.h"

#include <json-glib/json-glib.h>

#include <string.h>

/**
 * CockpitDBusJson:
 *
 * A #CockpitChannel that sends DBus messages with the dbus-json payload
 * type.
 */

gboolean cockpit_dbus_json_allow_external = TRUE;

#define COCKPIT_DBUS_JSON(o)    (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_DBUS_JSON, CockpitDBusJson))

typedef struct {
  CockpitChannel parent;
  GDBusConnection *connection;
  GBusType bus_type;

  /* Talking to */
  const gchar *logname;
  const gchar *default_name;
  guint default_watch;
  gboolean default_watched;
  gboolean default_appeared;

  /* Call related */
  GCancellable *cancellable;
  GList *active_calls;
  GHashTable *interface_info;

  /* Per name information */
  GHashTable *peers;
} CockpitDBusJson;

typedef struct {
  gchar *name;
  CockpitDBusJson *dbus_json;

  guint subscribe_id;
  gboolean subscribed;

  /* Signal related */
  CockpitDBusRules *rules;

  /* Watch and introspection */
  CockpitDBusCache *cache;
  gulong meta_sig;
  gulong update_sig;
} CockpitDBusPeer;

typedef struct {
  CockpitChannelClass parent_class;
} CockpitDBusJsonClass;

G_DEFINE_TYPE (CockpitDBusJson, cockpit_dbus_json, COCKPIT_TYPE_CHANNEL);

static const gchar *
value_type_name (JsonNode *node)
{
  GType type = json_node_get_value_type (node);
  if (type == G_TYPE_STRING)
    return "string";
  else if (type == G_TYPE_INT64)
    return "int";
  else if (type == G_TYPE_DOUBLE)
    return "double";
  else
    return g_type_name (type);
}

static gboolean
check_type (JsonNode *node,
            JsonNodeType type,
            GType sub_type,
            GError **error)
{
  if (JSON_NODE_TYPE (node) != type ||
      (type == JSON_NODE_VALUE && (json_node_get_value_type (node) != sub_type)))
    {
      g_set_error (error, G_DBUS_ERROR, G_DBUS_ERROR_INVALID_ARGS,
                   "Unexpected type '%s' in argument", value_type_name (node));
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
          g_set_error (error, G_DBUS_ERROR, G_DBUS_ERROR_INVALID_ARGS,
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
      g_set_error (error, G_DBUS_ERROR, G_DBUS_ERROR_INVALID_ARGS,
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
parse_json_byte_array (JsonNode *node,
                       GError **error)
{
  static const char valid[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  GVariant *result = NULL;
  const gchar *value;
  gpointer data = NULL;
  gsize length;
  gsize pos;

  if (!check_type (node, JSON_NODE_VALUE, G_TYPE_STRING, error))
    goto out;

  value = json_node_get_string (node);

  pos = strspn (value, valid);
  while (value[pos] == '=')
    pos++;

  if (pos == 0)
    {
      data = NULL;
      length = 0;
    }
  else
    {
      /* base64 strings are always multiple of 3 */
      if (pos % 3 == 0 || value[pos] == '\0')
        data = g_base64_decode (value, &length);

      if (!data)
        {
          g_set_error (error, G_DBUS_ERROR, G_DBUS_ERROR_INVALID_ARGS,
                       "Invalid base64 in argument");
          goto out;
        }
    }

  result = g_variant_new_from_data (G_VARIANT_TYPE_BYTESTRING,
                                    data, length, TRUE,
                                    g_free, data);

out:
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
                          child_type, error);
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
parse_json_variant (JsonNode *node,
                    GError **error)
{
  GVariantType *inner_type;
  JsonObject *object;
  GVariant *inner;
  JsonNode *val;
  const gchar *sig;

  if (!check_type (node, JSON_NODE_OBJECT, 0, error))
    return NULL;

  object = json_node_get_object (node);
  val = json_object_get_member (object, "v");
  if (val == NULL)
    {
      g_set_error (error, G_DBUS_ERROR, G_DBUS_ERROR_INVALID_ARGS,
                   "Variant object did not contain a 'v' field");
      return NULL;
    }
  if (!cockpit_json_get_string (object, "t", NULL, &sig) || !sig)
    {
      g_set_error (error, G_DBUS_ERROR, G_DBUS_ERROR_INVALID_ARGS,
                   "Variant object did not contain valid 't' field");
      return NULL;
    }
  if (!g_variant_type_string_is_valid (sig))
    {
      g_set_error (error, G_DBUS_ERROR, G_DBUS_ERROR_INVALID_ARGS,
                   "Variant 't' field '%s' is invalid", sig);
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
          key_node = json_node_new (JSON_NODE_VALUE);
          json_node_set_string (key_node, l->data);
        }
      else
        {
          key_node = cockpit_json_parse (l->data, -1, NULL);
          if (key_node == NULL)
            {
              g_set_error (error, G_DBUS_ERROR, G_DBUS_ERROR_INVALID_ARGS,
                           "Unexpected key '%s' in dict entry", (gchar *)l->data);
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

static GVariant *
parse_json_object_path (JsonNode *node,
                        GError **error)
{
  GVariant *result = NULL;
  const gchar *str;

  if (!check_type (node, JSON_NODE_VALUE, G_TYPE_STRING, error))
    return NULL;

  str = json_node_get_string (node);
  if (g_variant_is_object_path (str))
    {
      result = g_variant_new_object_path (str);
    }
  else
    {
      g_set_error (error, G_DBUS_ERROR, G_DBUS_ERROR_INVALID_ARGS,
                   "Invalid object path '%s'", str);
    }

  return result;
}

static GVariant *
parse_json_signature (JsonNode *node,
                      GError **error)
{
  const gchar *str;

  if (!check_type (node, JSON_NODE_VALUE, G_TYPE_STRING, error))
    return NULL;

  str = json_node_get_string (node);
  if (g_variant_is_signature (str))
    return g_variant_new_signature (str);
  else
    {
      g_set_error (error, G_DBUS_ERROR, G_DBUS_ERROR_INVALID_ARGS,
                   "Invalid signature '%s'", str);
      return NULL;
    }
}

static void
parse_not_supported (const GVariantType *type,
                     GError **error)
{
  g_set_error (error, G_DBUS_ERROR, G_DBUS_ERROR_INVALID_ARGS,
               "Type '%.*s' is unknown or not supported",
               (int)g_variant_type_get_string_length (type),
               g_variant_type_peek_string (type));
}

static GVariant *
parse_json (JsonNode *node,
            const GVariantType *type,
            GError **error)
{
  const GVariantType *element_type;

  if (!g_variant_type_is_definite (type))
    {
      g_set_error (error, G_DBUS_ERROR, G_DBUS_ERROR_INVALID_ARGS,
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
          return parse_json_object_path (node, error);
        }
      else if (g_variant_type_equal (type, G_VARIANT_TYPE_SIGNATURE))
        {
          return parse_json_signature (node, error);
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
      if (g_variant_type_equal (element_type, G_VARIANT_TYPE_BYTE))
        return parse_json_byte_array (node, error);
      else if (g_variant_type_is_dict_entry (element_type))
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

static JsonNode *
build_json (GVariant *value);

static JsonObject *
build_json_variant (GVariant *value)
{
  GVariant *child;
  JsonObject *object;

  child = g_variant_get_variant (value);
  object = json_object_new ();
  json_object_set_string_member (object, "t", g_variant_get_type_string (child));
  json_object_set_member (object, "v", build_json (child));

  g_variant_unref (child);

  return object;
}

static JsonNode *
build_json_byte_array (GVariant *value)
{
  JsonNode *node;
  gconstpointer data;
  gsize length = 0;
  gchar *string;

  data = g_variant_get_fixed_array (value, &length, 1);
  if (length > 0)
    string = g_base64_encode (data, length);
  else
    string = NULL;
  node = json_node_new (JSON_NODE_VALUE);
  json_node_set_string (node, string ? string : "");
  g_free (string); /* unfortunately :S */

  return node;
}

static JsonArray *
build_json_array_or_tuple (GVariant *value)
{
  GVariantIter iter;
  GVariant *child;
  JsonArray *array;

  array = json_array_new ();

  g_variant_iter_init (&iter, value);
  while ((child = g_variant_iter_next_value (&iter)) != NULL)
    {
      json_array_add_element (array, build_json (child));
      g_variant_unref (child);
    }

  return array;
}

static JsonObject *
build_json_dictionary (const GVariantType *entry_type,
                       GVariant *dict)
{
  const GVariantType *key_type;
  GVariantIter iter;
  GVariant *child;
  GVariant *key;
  GVariant *value;
  gboolean is_string;
  gchar *key_string;
  JsonObject *object;

  object = json_object_new ();
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
          json_object_set_member (object, g_variant_get_string (key, NULL), build_json (value));
        }
      else
        {
          key_string = g_variant_print (key, FALSE);
          json_object_set_member (object, key_string, build_json (value));
          g_free (key_string);
        }

      g_variant_unref (key);
      g_variant_unref (value);
    }

  return object;
}

static JsonNode *
build_json (GVariant *value)
{
  const GVariantType *type;
  const GVariantType *element_type;
  JsonObject *object;
  JsonArray *array;
  JsonNode *node;

  switch (g_variant_classify (value))
    {
    case G_VARIANT_CLASS_BOOLEAN:
      node = json_node_new (JSON_NODE_VALUE);
      json_node_set_boolean (node, g_variant_get_boolean (value));
      return node;

    case G_VARIANT_CLASS_BYTE:
      node = json_node_new (JSON_NODE_VALUE);
      json_node_set_int (node, g_variant_get_byte (value));
      return node;

    case G_VARIANT_CLASS_INT16:
      node = json_node_new (JSON_NODE_VALUE);
      json_node_set_int (node, g_variant_get_int16 (value));
      return node;

    case G_VARIANT_CLASS_UINT16:
      node = json_node_new (JSON_NODE_VALUE);
      json_node_set_int (node, g_variant_get_uint16 (value));
      return node;

    case G_VARIANT_CLASS_INT32:
      node = json_node_new (JSON_NODE_VALUE);
      json_node_set_int (node, g_variant_get_int32 (value));
      return node;

    case G_VARIANT_CLASS_UINT32:
      node = json_node_new (JSON_NODE_VALUE);
      json_node_set_int (node, g_variant_get_uint32 (value));
      return node;

    case G_VARIANT_CLASS_INT64:
      node = json_node_new (JSON_NODE_VALUE);
      json_node_set_int (node, g_variant_get_int64 (value));
      return node;

    case G_VARIANT_CLASS_UINT64:
      node = json_node_new (JSON_NODE_VALUE);
      json_node_set_int (node, g_variant_get_uint64 (value));
      return node;

    case G_VARIANT_CLASS_HANDLE:
      node = json_node_new (JSON_NODE_VALUE);
      json_node_set_int (node, g_variant_get_handle (value));
      return node;

    case G_VARIANT_CLASS_DOUBLE:
      node = json_node_new (JSON_NODE_VALUE);
      json_node_set_double (node, g_variant_get_double (value));
      return node;

    case G_VARIANT_CLASS_STRING:      /* explicit fall-through */
    case G_VARIANT_CLASS_OBJECT_PATH: /* explicit fall-through */
    case G_VARIANT_CLASS_SIGNATURE:
      node = json_node_new (JSON_NODE_VALUE);
      json_node_set_string (node, g_variant_get_string (value, NULL));
      return node;

    case G_VARIANT_CLASS_VARIANT:
      object = build_json_variant (value);
      node = json_node_new (JSON_NODE_OBJECT);
      json_node_take_object (node, object);
      return node;

    case G_VARIANT_CLASS_ARRAY:
      type = g_variant_get_type (value);
      element_type = g_variant_type_element (type);
      if (g_variant_type_is_dict_entry (element_type))
        {
          object = build_json_dictionary (element_type, value);
          node = json_node_new (JSON_NODE_OBJECT);
          json_node_take_object (node, object);
        }
      else if (g_variant_type_equal (element_type, G_VARIANT_TYPE_BYTE))
        {
          node = build_json_byte_array (value);
        }
      else
        {
          array = build_json_array_or_tuple (value);
          node = json_node_new (JSON_NODE_ARRAY);
          json_node_set_array (node, array);
          json_array_unref (array);
        }
      return node;

    case G_VARIANT_CLASS_TUPLE:
      array = build_json_array_or_tuple (value);
      node = json_node_new (JSON_NODE_ARRAY);
      json_node_set_array (node, array);
      json_array_unref (array);
      return node;

    case G_VARIANT_CLASS_DICT_ENTRY:
    case G_VARIANT_CLASS_MAYBE:
    default:
      g_return_val_if_reached (NULL);
      break;
    }
}

static void
send_json_object (CockpitDBusJson *self,
                  JsonObject *object)
{
  GBytes *bytes;

  bytes = cockpit_json_write_bytes (object);
  cockpit_channel_send (COCKPIT_CHANNEL (self), bytes, TRUE);
  g_bytes_unref (bytes);
}

static JsonObject *
build_json_error (GError *error)
{
  JsonObject *object;
  JsonArray *reply;
  JsonArray *args;
  gchar *error_name;

  object = json_object_new ();
  reply = json_array_new ();
  args = json_array_new ();

  error_name = g_dbus_error_get_remote_error (error);
  g_dbus_error_strip_remote_error (error);

  json_array_add_string_element (reply, error_name != NULL ? error_name : "");
  g_free (error_name);

  if (error->message)
    json_array_add_string_element (args, error->message);
  json_array_add_array_element (reply, args);

  json_object_set_array_member (object, "error", reply);

  return object;
}

static gchar *
build_signature (GVariant *variant)
{
  const GVariantType *type;
  GString *sig;

  sig = g_string_new ("");
  type = g_variant_get_type (variant);
  for (type = g_variant_type_first (type);
       type != NULL;
       type = g_variant_type_next (type))
    {
      g_string_append_len (sig, g_variant_type_peek_string (type),
                           g_variant_type_get_string_length (type));
    }
  return g_string_free (sig, FALSE);
}

static JsonNode *
build_json_body (GVariant *body,
                 gchar **type)
{
  if (body)
    {
      if (type)
        *type = build_signature (body);
      return build_json (body);
    }
  else
    {
      if (type)
        *type = NULL;
      return json_node_new (JSON_NODE_NULL);
    }
}

static JsonObject *
build_json_signal (const gchar *path,
                   const gchar *interface,
                   const gchar *member,
                   GVariant *body)
{
  JsonObject *object;
  JsonArray *signal;

  object = json_object_new ();
  signal = json_array_new ();
  json_array_add_string_element (signal, path);
  json_array_add_string_element (signal, interface);
  json_array_add_string_element (signal, member);
  json_array_add_element (signal, build_json_body (body, NULL));
  json_object_set_array_member (object, "signal", signal);

  return object;
}

/* ---------------------------------------------------------------------------------------------------- */

typedef struct {
  /* Cleared by dispose */
  GList *link;
  CockpitDBusJson *dbus_json;

  /* Request data */
  JsonObject *request;

  /* Owned here */
  GVariantType *param_type;

  /* Owned by request */
  const gchar *cookie;
  const gchar *name;
  const gchar *interface;
  const gchar *method;
  const gchar *path;
  const gchar *type;
  const gchar *flags;
  JsonNode *args;
} CallData;

static CockpitDBusPeer *
ensure_peer (CockpitDBusJson *self,
             const gchar *name);

static void
send_dbus_error (CockpitDBusJson *self,
                 CallData *call,
                 GError *error)
{
  JsonObject *object;

  if (!call->cookie)
    {
      g_debug ("%s: dropping error without cookie: %s", self->logname, error->message);
      return;
    }

  g_debug ("%s: failed %s", self->logname, call->method);

  object = build_json_error (error);
  json_object_set_string_member (object, "id", call->cookie);
  send_json_object (self, object);
  json_object_unref (object);
}

typedef struct {
  CockpitDBusJson *dbus_json;
  JsonObject *message;
} WaitData;

static void
on_wait_complete (CockpitDBusCache *cache,
                  gpointer user_data)
{
  WaitData *wd = user_data;
  CockpitDBusJson *self = wd->dbus_json;

  if (!g_cancellable_is_cancelled (self->cancellable))
    send_json_object (self, wd->message);

  g_object_unref (wd->dbus_json);
  json_object_unref (wd->message);
  g_slice_free (WaitData, wd);
}

static void
send_with_barrier (CockpitDBusJson *self,
                   CockpitDBusPeer *peer,
                   JsonObject *message)
{
  WaitData *wd = g_slice_new (WaitData);
  wd->dbus_json = g_object_ref (self);
  wd->message = json_object_ref (message);
  cockpit_dbus_cache_barrier (peer->cache, on_wait_complete, wd);
}

static void
send_dbus_reply (CockpitDBusJson *self,
                 CallData *call,
                 GDBusMessage *message)
{
  CockpitDBusPeer *peer;
  GVariant *scrape = NULL;
  JsonObject *object;
  GString *flags;

  g_return_if_fail (call->cookie != NULL);

  JsonArray *reply;
  gchar *type = NULL;

  object = json_object_new ();
  reply = json_array_new ();
  if (g_dbus_message_get_message_type (message) == G_DBUS_MESSAGE_TYPE_ERROR)
    {
      g_debug ("%s: errorc for %s", self->logname, call->method);
      json_array_add_string_element (reply, g_dbus_message_get_error_name (message));
      json_object_set_array_member (object, "error", reply);
    }
  else
    {
      g_debug ("%s: reply for %s", self->logname, call->method);
      json_object_set_array_member (object, "reply", reply);
      scrape = g_dbus_message_get_body (message);
    }

  json_array_add_element (reply, build_json_body (g_dbus_message_get_body (message),
                                                  call->type != NULL ? &type : NULL));

  if (type)
    {
      json_object_set_string_member (object, "type", type);
      g_free (type);
    }

  json_object_set_string_member (object, "id", call->cookie);

  if (call->flags)
    {
      flags = g_string_new ("");
      if (g_dbus_message_get_byte_order (message) == G_DBUS_MESSAGE_BYTE_ORDER_BIG_ENDIAN)
        g_string_append_c (flags, '>');
      else
        g_string_append_c (flags, '<');
      json_object_set_string_member (object, "flags", flags->str);
      g_string_free (flags, TRUE);
    }

  peer = ensure_peer (self, call->name);
  cockpit_dbus_cache_poke (peer->cache, call->path, call->interface);
  if (scrape)
    cockpit_dbus_cache_scrape (peer->cache, scrape);
  send_with_barrier (self, peer, object);

  json_object_unref (object);
}

static GVariantType *
calculate_method_param_type (GDBusInterfaceInfo *info,
                             const gchar *iface,
                             const gchar *method,
                             GError **error)
{
  const GVariantType *arg_types[256];
  GDBusMethodInfo *method_info = NULL;
  guint n;

  if (info)
    method_info = g_dbus_interface_info_lookup_method (info, method);
  if (method_info == NULL)
    {
      g_set_error (error, G_DBUS_ERROR, G_DBUS_ERROR_UNKNOWN_METHOD,
                   "Introspection data for method %s %s not available", iface, method);
      return NULL;
    }
  else if (method_info->in_args)
    {
      for (n = 0; method_info->in_args[n] != NULL; n++)
        {
          /* DBus places a hard limit of 255 on signature length.
           * therefore number of args must be less than 256.
           */
          if (n >= G_N_ELEMENTS (arg_types))
            return NULL;

          arg_types[n] = G_VARIANT_TYPE (method_info->in_args[n]->signature);

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

static void
call_data_free (CallData *call)
{
  if (call->dbus_json)
    call->dbus_json->active_calls = g_list_delete_link (call->dbus_json->active_calls, call->link);
  if (call->request)
    json_object_unref (call->request);
  if (call->param_type)
    g_variant_type_free (call->param_type);
  g_slice_free (CallData, call);
}

static void
on_send_message_reply (GObject *source,
                       GAsyncResult *result,
                       gpointer user_data)
{
  CallData *call = user_data;
  GError *error = NULL;
  GDBusMessage *message;

  message = g_dbus_connection_send_message_with_reply_finish (G_DBUS_CONNECTION (source),
                                                              result, &error);

  if (call->dbus_json)
    {
      if (error)
        send_dbus_error (call->dbus_json, call, error);
      else
        send_dbus_reply (call->dbus_json, call, message);
    }

  g_clear_error (&error);
  g_clear_object (&message);
  call_data_free (call);
}


static void
handle_dbus_call_on_interface (CockpitDBusJson *self,
                               CallData *call)
{
  GVariant *parameters = NULL;
  GError *error = NULL;
  GDBusMessage *message = NULL;

  g_return_if_fail (call->param_type != NULL);
  parameters = parse_json (call->args, call->param_type, &error);

  if (!parameters)
    goto out;

  g_debug ("%s: invoking %s %s at %s", self->logname, call->interface, call->method, call->path);

  message = g_dbus_message_new_method_call (call->name,
                                            call->path,
                                            call->interface,
                                            call->method);

  g_dbus_message_set_body (message, parameters);
  parameters = NULL;

  g_dbus_connection_send_message_with_reply (self->connection,
                                             message,
                                             G_DBUS_SEND_MESSAGE_FLAGS_NONE,
                                             G_MAXINT, /* timeout */
                                             NULL, /* serial */
                                             self->cancellable,
                                             call->cookie ? on_send_message_reply : NULL,
                                             call->cookie ? call : NULL);
  if (call->cookie)
    call = NULL; /* ownership assumed above */

out:
  if (error)
    {
      if (call)
        send_dbus_error (self, call, error);
      g_error_free (error);
    }
  if (call)
    call_data_free (call);
  if (message)
    g_object_unref (message);
}

static void
on_introspect_ready (CockpitDBusCache *cache,
                     GDBusInterfaceInfo *iface,
                     gpointer user_data)
{
  CallData *call = user_data;
  CockpitDBusJson *self = call->dbus_json;
  GError *error = NULL;

  /* Cancelled? */
  if (!call->dbus_json)
    {
      call_data_free (call);
      return;
    }

  call->param_type = calculate_method_param_type (iface, call->interface,
                                                  call->method, &error);

  if (error)
    {
      send_dbus_error (self, call, error);
      g_error_free (error);
      call_data_free (call);
    }
  else
    {
      handle_dbus_call_on_interface (self, call);
    }
}

static const gchar *
array_string_element (JsonArray *array,
                      guint i)
{
  JsonNode *node;

  node = json_array_get_element (array, i);
  if (node && JSON_NODE_HOLDS_VALUE (node) && json_node_get_value_type (node) == G_TYPE_STRING)
    return json_node_get_string (node);
  return NULL;
}

/* Useful analogs for the errors below if not yet defined by glib */
#if !GLIB_CHECK_VERSION(2,42,0)
#define G_DBUS_ERROR_UNKNOWN_INTERFACE G_DBUS_ERROR_UNKNOWN_METHOD
#define G_DBUS_ERROR_UNKNOWN_OBJECT G_DBUS_ERROR_UNKNOWN_METHOD
#endif

static gboolean
parse_json_method (CockpitDBusJson *self,
                   JsonNode *node,
                   const gchar *description,
                   const gchar **path,
                   const gchar **interface,
                   const gchar **method,
                   JsonNode **args)
{
  JsonArray *array;

  g_assert (description != NULL);
  g_assert (path != NULL);
  g_assert (interface != NULL);
  g_assert (method != NULL);
  g_assert (args != NULL);

  if (!JSON_NODE_HOLDS_ARRAY (node))
    {
      cockpit_channel_fail (COCKPIT_CHANNEL (self), "protocol-error",
                            "incorrect '%s' field in dbus command", description);
      return FALSE;
    }

  array = json_node_get_array (node);
  *path = array_string_element (array, 0);
  *interface = array_string_element (array, 1);
  *method = array_string_element (array, 2);

  *args = json_array_get_element (array, 3);
  if (!*args || !JSON_NODE_HOLDS_ARRAY (*args))
    {
      cockpit_channel_fail (COCKPIT_CHANNEL (self), "protocol-error",
                            "arguments field is invalid in dbus \"%s\"", description);
    }
  else if (!*path || !g_variant_is_object_path (*path))
    {
      cockpit_channel_fail (COCKPIT_CHANNEL (self), "protocol-error",
                            "object path is invalid in dbus \"%s\": %s", description, *path);
    }
  else if (!*interface || !g_dbus_is_interface_name (*interface))
    {
      cockpit_channel_fail (COCKPIT_CHANNEL (self), "protocol-error",
                            "interface name is invalid in dbus \"%s\": %s", description, *interface);
    }
  else if (!*method || !g_dbus_is_member_name (*method))
    {
      cockpit_channel_fail (COCKPIT_CHANNEL (self), "protocol-error",
                            "member name is invalid in dbus \"%s\": %s", description, *method);
    }
  else
    {
      return TRUE;
    }

  return FALSE;
}

static void
handle_dbus_call (CockpitDBusJson *self,
                  JsonObject *object)
{
  CockpitDBusPeer *peer = NULL;
  CallData *call;
  JsonNode *node;
  gchar *string;

  node = json_object_get_member (object, "call");
  g_return_if_fail (node != NULL);
  call = g_slice_new0 (CallData);

  if (!parse_json_method (self, node, "call", &call->path, &call->interface, &call->method, &call->args))
    {
      /* fall through to call invalid */
    }
  else if (!cockpit_json_get_string (object, "name", self->default_name, &call->name))
    {
      cockpit_channel_fail (COCKPIT_CHANNEL (self), "protocol-error",
                            "the \"name\" field is invalid in dbus call");
    }
  else if (self->bus_type != G_BUS_TYPE_NONE && call->name == NULL)
    {
      cockpit_channel_fail (COCKPIT_CHANNEL (self), "protocol-error",
                            "the \"name\" field is missing in dbus call");
    }
  else if (call->name != NULL && !g_dbus_is_name (call->name))
    {
      cockpit_channel_fail (COCKPIT_CHANNEL (self), "protocol-error",
                            "the \"name\" field in dbus call is not a valid bus name: %s", call->name);
    }
  else if (!cockpit_json_get_string (object, "id", NULL, &call->cookie))
    {
      cockpit_channel_fail (COCKPIT_CHANNEL (self), "protocol-error",
                            "the \"id\" field is invalid in call");
    }
  else if (!cockpit_json_get_string (object, "type", NULL, &call->type))
    {
      cockpit_channel_fail (COCKPIT_CHANNEL (self), "protocol-error",
                            "the \"type\" field is invalid in call");
    }
  else if (call->type && !g_variant_is_signature (call->type))
    {
      cockpit_channel_fail (COCKPIT_CHANNEL (self), "protocol-error",
                            "the \"type\" signature is not valid in dbus call: %s", call->type);
    }
  else if (!cockpit_json_get_string (object, "flags", NULL, &call->flags))
    {
      cockpit_channel_fail (COCKPIT_CHANNEL (self), "protocol-error",
                            "the \"flags\" field is invalid in dbus call");
    }
  else
    {
      if (call->type)
        {
          string = g_strdup_printf ("(%s)", call->type);
          call->param_type = g_variant_type_new (string);
          g_free (string);
        }

      /* No arguments or zero arguments, can make call without introspecting */
      if (!call->param_type)
        {
          if (json_array_get_length (json_node_get_array (call->args)) == 0)
            call->param_type = g_variant_type_new ("()");
        }

      call->dbus_json = self;
      call->request = json_object_ref (object);
      self->active_calls = g_list_prepend (self->active_calls, call);
      call->link = g_list_find (self->active_calls, call);

      if (call->param_type)
        {
          /* Frees call data when done */
          handle_dbus_call_on_interface (self, call);
        }
      else
        {
          peer = ensure_peer (self, call->name);
          cockpit_dbus_cache_introspect (peer->cache, call->path,
                                         call->interface, on_introspect_ready, call);
        }

      /* Start processing call */
      return;
    }

  /* call was invalid */
  call_data_free (call);
}

static GVariantType *
calculate_signal_param_type (CockpitDBusJson *self,
                             const gchar *iface,
                             const gchar *signal)
{
  GDBusInterfaceInfo *info;
  const GVariantType *arg_types[256];
  GDBusSignalInfo *signal_info = NULL;
  guint n;

  info = g_hash_table_lookup (self->interface_info, iface);
  if (info)
    signal_info = g_dbus_interface_info_lookup_signal (info, signal);
  if (signal_info == NULL)
    {
      cockpit_channel_fail (COCKPIT_CHANNEL (self), "protocol-error",
                            "signal argument types for signal %s %s unknown", iface, signal);
      return NULL;
    }
  else if (signal_info->args)
    {
      for (n = 0; signal_info->args[n] != NULL; n++)
        {
          /* DBus places a hard limit of 255 on signature length.
           * therefore number of args must be less than 256.
           */
          if (n >= G_N_ELEMENTS (arg_types))
            return NULL;

          arg_types[n] = G_VARIANT_TYPE (signal_info->args[n]->signature);

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

static void
handle_dbus_signal_on_interface (CockpitDBusJson *self,
                                 GVariantType *param_type,
                                 const gchar *destination,
                                 const gchar *path,
                                 const gchar *interface,
                                 const gchar *signal,
                                 JsonNode *args)
{
  CockpitChannel *channel;
  GVariant *parameters = NULL;
  GDBusMessage *message = NULL;
  GError *error = NULL;

  parameters = parse_json (args, param_type, &error);
  if (parameters)
    {
      g_debug ("%s: signal %s %s at %s", self->logname, interface, signal, path);

      message = g_dbus_message_new_signal (path, interface, signal);
      g_dbus_message_set_body (message, parameters);
      parameters = NULL;

      if (destination)
        g_dbus_message_set_destination (message, destination);

      g_dbus_connection_send_message (self->connection, message,
                                      G_DBUS_SEND_MESSAGE_FLAGS_NONE,
                                      NULL, &error);
    }

  if (error)
    {
      channel = COCKPIT_CHANNEL (self);
      if (error->code == G_IO_ERROR_INVALID_ARGUMENT ||
          error->code == G_DBUS_ERROR_INVALID_ARGS)
        {
          cockpit_channel_fail (channel, "protocol-error", "%s", error->message);
        }
      else
        {
          cockpit_channel_fail (channel, "internal-error", "%s", error->message);
        }
      g_error_free (error);
    }
  if (parameters)
    g_variant_unref (parameters);
  if (message)
    g_object_unref (message);
}

static void
handle_dbus_signal (CockpitDBusJson *self,
                    JsonObject *object)
{
  GVariantType *param_type = NULL;
  const gchar *interface;
  const gchar *destination;
  const gchar *path;
  const gchar *type;
  const gchar *flags;
  const gchar *signal;
  JsonNode *node;
  JsonNode *args;
  gchar *string;

  node = json_object_get_member (object, "signal");
  g_return_if_fail (node != NULL);

  if (!parse_json_method (self, node, "signal", &path, &interface, &signal, &args))
    {
      /* fall through to call invalid */
    }
  else if (!cockpit_json_get_string (object, "name", NULL, &destination))
    {
      cockpit_channel_fail (COCKPIT_CHANNEL (self), "protocol-error",
                            "the 'name' field is invalid in signal");
    }
  else if (destination != NULL && !g_dbus_is_name (destination))
    {
      cockpit_channel_fail (COCKPIT_CHANNEL (self), "protocol-error",
                            "the 'name' field is not a valid bus name: %s", destination);
    }
  else if (!cockpit_json_get_string (object, "type", NULL, &type))
    {
      cockpit_channel_fail (COCKPIT_CHANNEL (self), "protocol-error",
                            "the 'type' field is invalid in dbus signal");
    }
  else if (type && !g_variant_is_signature (type))
    {
      cockpit_channel_fail (COCKPIT_CHANNEL (self), "protocol-error",
                            "type signature is not valid in dbus signal: %s", type);
    }
  else if (!cockpit_json_get_string (object, "flags", NULL, &flags))
    {
      cockpit_channel_fail (COCKPIT_CHANNEL (self), "protocol-error",
                            "the 'flags' field is invalid in call");
    }
  else
    {
      if (type)
        {
          string = g_strdup_printf ("(%s)", type);
          param_type = g_variant_type_new (string);
          g_free (string);
        }
      else
        {
          param_type = calculate_signal_param_type (self, interface, signal);
        }

      if (param_type)
        {
          handle_dbus_signal_on_interface (self, param_type, destination,
                                           path, interface, signal, args);
        }
    }

  g_variant_type_free (param_type);
}

static void
on_add_match_ready (GObject *source,
                    GAsyncResult *result,
                    gpointer user_data)
{
  CockpitDBusJson *self = COCKPIT_DBUS_JSON (user_data);
  GError *error = NULL;
  GVariant *retval;

  retval = g_dbus_connection_call_finish (G_DBUS_CONNECTION (source), result, &error);
  if (error)
    {
      if (!g_cancellable_is_cancelled (self->cancellable) &&
          !g_error_matches (error, G_IO_ERROR, G_IO_ERROR_CLOSED))
        {
          cockpit_channel_fail (COCKPIT_CHANNEL (self), "internal-error",
                                "couldn't add match to bus: %s", error->message);
        }
      g_error_free (error);
    }
  if (retval)
    g_variant_unref (retval);
  g_object_unref (self);
}

static gboolean
parse_json_rule (CockpitDBusJson *self,
                 JsonNode *node,
                 const gchar **name,
                 const gchar **path,
                 const gchar **path_namespace,
                 const gchar **interface,
                 const gchar **signal,
                 const gchar **arg0)
{
  CockpitChannel *channel = COCKPIT_CHANNEL (self);
  JsonObject *object;
  gboolean valid;
  GList *names, *l;

  if (!JSON_NODE_HOLDS_OBJECT (node))
    {
      cockpit_channel_fail (channel, "protocol-error", "incorrect match field in dbus command");
      return FALSE;
    }

  object = json_node_get_object (node);

  if (name)
    *name = NULL;
  if (path)
    *path = NULL;
  if (path_namespace)
    *path_namespace = NULL;
  if (signal)
    *signal = NULL;
  if (interface)
    *interface = NULL;
  if (arg0)
    *arg0 = NULL;

  names = json_object_get_members (object);
  for (l = names; l != NULL; l = g_list_next (l))
    {
      valid = FALSE;
      if (name && g_str_equal (l->data, "name"))
        valid = cockpit_json_get_string (object, "name", NULL, name);
      if (interface && g_str_equal (l->data, "interface"))
        valid = cockpit_json_get_string (object, "interface", NULL, interface);
      else if (signal && g_str_equal (l->data, "member"))
        valid = cockpit_json_get_string (object, "member", NULL, signal);
      else if (path && g_str_equal (l->data, "path"))
        valid = cockpit_json_get_string (object, "path", NULL, path);
      else if (path_namespace && g_str_equal (l->data, "path_namespace"))
        valid = cockpit_json_get_string (object, "path_namespace", NULL, path_namespace);
      else if (arg0 && g_str_equal (l->data, "arg0"))
        valid = cockpit_json_get_string (object, "arg0", NULL, arg0);

      if (!valid)
        {
          cockpit_channel_fail (channel, "protocol-error",
                                "invalid or unsupported match field: %s", (gchar *)l->data);
          g_list_free (names);
          return FALSE;
        }
    }
  g_list_free (names);

  valid = FALSE;
  if (name && *name && !g_dbus_is_name (*name))
    cockpit_channel_fail (channel, "protocol-error", "match \"name\" is not valid: %s", *name);
  else if (path && *path && !g_variant_is_object_path (*path))
    cockpit_channel_fail (channel, "protocol-error", "match path is not valid: %s", *path);
  else if (path_namespace && *path_namespace && !g_variant_is_object_path (*path_namespace))
    cockpit_channel_fail (channel, "protocol-error", "match path_namespace is not valid: %s", *path_namespace);
  else if (interface && *interface && !g_dbus_is_interface_name (*interface))
    cockpit_channel_fail (channel, "protocol-error", "match interface is not valid: %s", *interface);
  else if (signal && *signal && !g_dbus_is_member_name (*signal))
    cockpit_channel_fail (channel, "protocol-error", "match \"member\" is not valid: %s", *signal);
  else if (arg0 && *arg0 && strchr (*arg0, '\'') != NULL)
    cockpit_channel_fail (channel, "protocol-error", "match arg0 is not valid: %s", *arg0);
  else if (path && path_namespace && *path && *path_namespace)
    cockpit_channel_fail (channel, "protocol-error", "match cannot specify both path and path_namespace");
  else
    valid = TRUE;

  if (name)
    {
      if (!*name)
        *name = self->default_name;
      if (!*name && self->bus_type != G_BUS_TYPE_NONE)
        {
          cockpit_channel_fail (channel, "protocol-error",
                                "%s: no \"name\" specified in match", self->logname);
          valid = FALSE;
        }
    }

  return valid;
}

static gchar *
build_dbus_match (CockpitDBusJson *self,
                  const gchar *name,
                  const gchar *path,
                  const gchar *path_namespace,
                  const gchar *interface,
                  const gchar *signal,
                  const gchar *arg0)
{
  GString *string = g_string_new ("type='signal'");
  if (!name)
    name = self->default_name;
  if (name)
    g_string_append_printf (string, ",sender='%s'", name);
  if (path)
    g_string_append_printf (string, ",path='%s'", path);
  if (path_namespace && !g_str_equal (path_namespace, "/"))
    g_string_append_printf (string, ",path_namespace='%s'", path_namespace);
  if (interface)
    g_string_append_printf (string, ",interface='%s'", interface);
  if (signal)
    g_string_append_printf (string, ",member='%s'", signal);
  if (arg0)
    g_string_append_printf (string, ",arg0='%s'", arg0);
  return g_string_free (string, FALSE);
}

static void
handle_dbus_add_match (CockpitDBusJson *self,
                       JsonObject *object)
{
  CockpitDBusPeer *peer = NULL;
  JsonNode *node;
  const gchar *name;
  const gchar *path;
  const gchar *path_namespace;
  const gchar *interface;
  const gchar *signal;
  const gchar *arg0;
  gchar *match;

  node = json_object_get_member (object, "add-match");
  g_return_if_fail (node != NULL);

  if (!parse_json_rule (self, node, &name, &path, &path_namespace, &interface, &signal, &arg0))
    return;

  peer = ensure_peer (self, name);
  if (cockpit_dbus_rules_add (peer->rules,
                              path ? path : path_namespace,
                              path_namespace ? TRUE : FALSE,
                              interface, signal, arg0))
    {
      if (peer->name)
        {
          match = build_dbus_match (self, name, path, path_namespace, interface, signal, arg0);
          g_dbus_connection_call (self->connection,
                                  "org.freedesktop.DBus",
                                  "/org/freedesktop/DBus",
                                  "org.freedesktop.DBus",
                                  "AddMatch",
                                  g_variant_new ("(s)", match),
                                  NULL, G_DBUS_CALL_FLAGS_NO_AUTO_START, -1,
                                  self->cancellable,
                                  on_add_match_ready,
                                  g_object_ref (self));
          g_free (match);
        }
    }
}

static void
on_remove_match_ready (GObject *source,
                       GAsyncResult *result,
                       gpointer user_data)
{
  CockpitDBusJson *self = COCKPIT_DBUS_JSON (user_data);
  GError *error = NULL;
  GVariant *retval;

  retval = g_dbus_connection_call_finish (G_DBUS_CONNECTION (source), result, &error);
  if (error)
    {
      if (!g_cancellable_is_cancelled (self->cancellable) &&
          !g_error_matches (error, G_IO_ERROR, G_IO_ERROR_CLOSED))
        {
          cockpit_channel_fail (COCKPIT_CHANNEL (self), "internal-error",
                                "couldn't remove match from bus: %s", error->message);
        }
      g_error_free (error);
    }
  if (retval)
    g_variant_unref (retval);
  g_object_unref (self);
}

static void
handle_dbus_remove_match (CockpitDBusJson *self,
                          JsonObject *object)
{
  CockpitDBusPeer *peer;
  JsonNode *node;
  const gchar *name;
  const gchar *path;
  const gchar *path_namespace;
  const gchar *interface;
  const gchar *signal;
  const gchar *arg0;
  gchar *match;

  node = json_object_get_member (object, "remove-match");
  g_return_if_fail (node != NULL);

  if (!parse_json_rule (self, node, &name, &path, &path_namespace, &interface, &signal, &arg0))
    return;

  peer = ensure_peer (self, name);
  if (cockpit_dbus_rules_remove (peer->rules,
                                 path ? path : path_namespace,
                                 path_namespace ? TRUE : FALSE,
                                 interface, signal, arg0))
    {
      if (peer->name)
        {
          match = build_dbus_match (self, name, path, path_namespace, interface, signal, arg0);
          g_dbus_connection_call (self->connection,
                                  "org.freedesktop.DBus",
                                  "/org/freedesktop/DBus",
                                  "org.freedesktop.DBus",
                                  "RemoveMatch",
                                  g_variant_new ("(s)", match),
                                  NULL, G_DBUS_CALL_FLAGS_NO_AUTO_START, -1,
                                  NULL, /* don't cancel removes */
                                  on_remove_match_ready,
                                  g_object_ref (self));
          g_free (match);
        }
    }
}

static void
maybe_include_name (CockpitDBusJson *self,
                    JsonObject *object,
                    const gchar *name)
{
  if (name && g_strcmp0 (name, self->default_name) != 0)
    json_object_set_string_member (object, "name", name);
}

static void
on_cache_meta (CockpitDBusCache *cache,
               GDBusInterfaceInfo *iface,
               gpointer user_data)
{
  CockpitDBusPeer *peer = user_data;
  JsonObject *interface;
  JsonObject *meta;
  JsonObject *message;

  interface = cockpit_dbus_meta_build (iface);

  meta = json_object_new ();
  json_object_set_object_member (meta, iface->name, interface);

  message = json_object_new ();
  json_object_set_object_member (message, "meta", meta);

  maybe_include_name (peer->dbus_json, message, peer->name);
  send_json_object (peer->dbus_json, message);
  json_object_unref (message);
}

static void
handle_dbus_meta (CockpitDBusJson *self,
                  JsonObject *object)
{
  CockpitChannel *channel = COCKPIT_CHANNEL (self);
  GDBusInterfaceInfo *iface;
  JsonObject *interface;
  GError *error = NULL;
  JsonObject *meta;
  GList *names, *l;
  JsonNode *node;

  node = json_object_get_member (object, "meta");
  g_return_if_fail (node != NULL);

  if (!JSON_NODE_HOLDS_OBJECT (node))
    {
      cockpit_channel_fail (channel, "protocol-error", "incorrect \"meta\" field in dbus command");
      return;
    }

  meta = json_node_get_object (node);
  names = json_object_get_members (meta);
  for (l = names; l != NULL; l = g_list_next (l))
    {
      if (!cockpit_json_get_object (meta, l->data, NULL, &interface))
        {
          cockpit_channel_fail (channel, "protocol-error", "invalid interface in dbus \"meta\" command");
          break;
        }

      iface = cockpit_dbus_meta_parse (l->data, interface, &error);
      if (iface)
        {
          g_hash_table_insert (self->interface_info, iface->name, iface);
        }
      else
        {
          cockpit_channel_fail (channel, "protocol-error", "%s", error->message);
          g_error_free (error);
          break;
        }
    }

  g_list_free (names);
}

static JsonObject *
build_json_update (GHashTable *paths)
{
  GHashTableIter i, j, k;
  GHashTable *interfaces;
  GHashTable *properties;
  const gchar *interface;
  const gchar *property;
  const gchar *path;
  JsonObject *notify;
  JsonObject *object;
  JsonObject *iface;
  GVariant *value;

  notify = json_object_new ();

  g_hash_table_iter_init (&i, paths);
  while (g_hash_table_iter_next (&i, (gpointer *)&path, (gpointer *)&interfaces))
    {
      object = json_object_new ();

      g_hash_table_iter_init (&j, interfaces);
      while (g_hash_table_iter_next (&j, (gpointer *)&interface, (gpointer *)&properties))
        {
          if (properties == NULL)
            {
              json_object_set_null_member (object, interface);
            }
          else
            {
              iface = json_object_new ();

              g_hash_table_iter_init (&k, properties);
              while (g_hash_table_iter_next (&k, (gpointer *)&property, (gpointer *)&value))
                json_object_set_member (iface, property, build_json (value));

              json_object_set_object_member (object, interface, iface);
            }
        }

      json_object_set_object_member (notify, path, object);
    }

  return notify;
}

static void
on_cache_update (CockpitDBusCache *cache,
                 GHashTable *update,
                 gpointer user_data)
{
  CockpitDBusPeer *peer = user_data;
  JsonObject *object = json_object_new ();
  maybe_include_name (peer->dbus_json, object, peer->name);
  json_object_set_object_member (object, "notify", build_json_update (update));
  send_json_object (peer->dbus_json, object);
  json_object_unref (object);
}

static void
handle_dbus_watch (CockpitDBusJson *self,
                   JsonObject *object)
{
  CockpitDBusPeer *peer = NULL;
  const gchar *name;
  const gchar *path;
  const gchar *path_namespace;
  const gchar *interface;
  gboolean is_namespace = FALSE;
  const gchar *cookie;
  JsonNode *node;

  node = json_object_get_member (object, "watch");
  g_return_if_fail (node != NULL);

  if (!parse_json_rule (self, node, &name, &path, &path_namespace, &interface, NULL, NULL))
    return;

  if (path_namespace)
    {
      path = path_namespace;
      is_namespace = TRUE;
    }

  peer = ensure_peer (self, name);
  cockpit_dbus_cache_watch (peer->cache, path, is_namespace, interface);

  if (!path)
    path = "/";

  /* Send back a reply when this has completed */
  if (cockpit_json_get_string (object, "id", NULL, &cookie))
    {
      object = json_object_new ();
      json_object_set_array_member (object, "reply", json_array_new ());
      json_object_set_string_member (object, "id", cookie);
      cockpit_dbus_cache_poke (peer->cache, path, NULL);
      send_with_barrier (self, peer, object);
      json_object_unref (object);
    }
}

static void
handle_dbus_unwatch (CockpitDBusJson *self,
                     JsonObject *object)
{
  CockpitDBusPeer *peer;
  const gchar *name;
  const gchar *path;
  const gchar *path_namespace;
  const gchar *interface;
  gboolean is_namespace = FALSE;
  JsonNode *node;

  node = json_object_get_member (object, "unwatch");
  g_return_if_fail (node != NULL);

  if (!parse_json_rule (self, node, &name, &path, &path_namespace, &interface, NULL, NULL))
    return;

  if (path_namespace)
    {
      path = path_namespace;
      is_namespace = TRUE;
    }

  peer = ensure_peer (self, name);
  cockpit_dbus_cache_unwatch (peer->cache, path, is_namespace, interface);
}

static void
cockpit_dbus_json_recv (CockpitChannel *channel,
                        GBytes *message)
{
  CockpitDBusJson *self = COCKPIT_DBUS_JSON (channel);
  GError *error = NULL;
  JsonObject *object = NULL;

  object = cockpit_json_parse_bytes (message, &error);
  if (!object)
    {
      cockpit_channel_fail (channel, "protocol-error", "failed to parse dbus request: %s", error->message);
      g_clear_error (&error);
      return;
    }

  if (json_object_has_member (object, "call"))
    handle_dbus_call (self, object);
  else if (json_object_has_member (object, "signal"))
    handle_dbus_signal (self, object);
  else if (json_object_has_member (object, "add-match"))
    handle_dbus_add_match (self, object);
  else if (json_object_has_member (object, "remove-match"))
    handle_dbus_remove_match (self, object);
  else if (json_object_has_member (object, "watch"))
    handle_dbus_watch (self, object);
  else if (json_object_has_member (object, "unwatch"))
    handle_dbus_unwatch (self, object);
  else if (json_object_has_member (object, "meta"))
    handle_dbus_meta (self, object);
  else
    {
      cockpit_channel_fail (channel, "protocol-error", "got unsupported dbus command");
    }

  json_object_unref (object);
}

static void
on_signal_message (GDBusConnection *connection,
                   const gchar *sender,
                   const gchar *path,
                   const gchar *interface,
                   const gchar *signal,
                   GVariant *parameters,
                   gpointer user_data)
{
  /*
   * HACK: There is no way we can access the original GDBusMessage. This
   * means things like flags and byte order are lost here.
   *
   * We cannot use a GDBusMessageFilterFunction and use that to subsribe
   * to signals, because then the ordering guarantees are out the window.
   */

  CockpitDBusPeer *peer = user_data;
  const gchar *arg0 = NULL;
  JsonObject *object;

  /* Unfortunately we also have to recalculate this */
  if (parameters &&
      g_variant_is_of_type (parameters, G_VARIANT_TYPE_TUPLE) &&
      g_variant_n_children (parameters) > 0)
    {
      GVariant *item;
      item = g_variant_get_child_value (parameters, 0);
      if (g_variant_is_of_type (item, G_VARIANT_TYPE_STRING))
        arg0 = g_variant_get_string (item, NULL);
      g_variant_unref (item);
    }

  if (cockpit_dbus_rules_match (peer->rules, path, interface, signal, arg0))
    {
      object = build_json_signal (path, interface, signal, parameters);
      cockpit_dbus_cache_poke (peer->cache, path, interface);
      maybe_include_name (peer->dbus_json, object, peer->name);
      send_with_barrier (peer->dbus_json, peer, object);
      json_object_unref (object);
    }
}

static void
cockpit_dbus_json_closed (CockpitChannel *channel,
                          const gchar *problem)
{
  /* When closed disconnect from everything */
  g_object_run_dispose (G_OBJECT (channel));
}

static void
cockpit_dbus_json_init (CockpitDBusJson *self)
{
  self->cancellable = g_cancellable_new ();

  self->peers = g_hash_table_new (g_str_hash, g_str_equal);
  self->interface_info = cockpit_dbus_interface_info_new ();
}

static void
send_owned (CockpitDBusJson *self,
            const gchar *name,
            const gchar *owner)
{
  JsonObject *object;
  object = json_object_new ();
  maybe_include_name (self, object, name);
  json_object_set_string_member (object, "owner", owner);
  send_json_object (self, object);
  json_object_unref (object);
}

static void
send_ready (CockpitDBusJson *self)
{
  CockpitChannel *channel = COCKPIT_CHANNEL (self);
  const gchar *unique_name = NULL;
  JsonObject *message;

  message = json_object_new ();
  unique_name = g_dbus_connection_get_unique_name (self->connection);
  if (unique_name)
    json_object_set_string_member (message, "unique-name", unique_name);

  cockpit_channel_ready (channel, message);
  json_object_unref (message);
}

static void
on_name_appeared (GDBusConnection *connection,
                  const gchar *name,
                  const gchar *name_owner,
                  gpointer user_data)
{
  CockpitDBusJson *self = COCKPIT_DBUS_JSON (user_data);

  g_object_ref (self);

  if (!self->default_appeared)
    {
      self->default_appeared = TRUE;
      send_ready (self);
    }

  send_owned (self, name, name_owner);

  g_object_unref (self);
}

static void
on_name_vanished (GDBusConnection *connection,
                  const gchar *name,
                  gpointer user_data)
{
  CockpitDBusJson *self = COCKPIT_DBUS_JSON (user_data);
  CockpitChannel *channel = COCKPIT_CHANNEL (self);

  send_owned (self, name, NULL);

  if (!G_IS_DBUS_CONNECTION (connection) || g_dbus_connection_is_closed (connection))
    cockpit_channel_close (channel, "disconnected");
  else if (!self->default_appeared)
    cockpit_channel_close (channel, "not-found");
}

static CockpitDBusPeer *
ensure_peer (CockpitDBusJson *self,
             const gchar *name)
{
  CockpitDBusPeer *peer;

  if (!name)
    name = self->default_name;

  peer = g_hash_table_lookup (self->peers, name ? name : "");
  if (!peer)
    {
      peer = g_new0 (CockpitDBusPeer, 1);
      peer->name = g_strdup (name);
      peer->dbus_json = self;
      peer->cache = cockpit_dbus_cache_new (self->connection, name, self->logname, self->interface_info);
      peer->meta_sig = g_signal_connect (peer->cache, "meta", G_CALLBACK (on_cache_meta), peer);
      peer->update_sig = g_signal_connect (peer->cache, "update", G_CALLBACK (on_cache_update), peer);
      peer->rules = cockpit_dbus_rules_new ();

      peer->subscribe_id = g_dbus_connection_signal_subscribe (self->connection,
                                                               name,
                                                               NULL, /* interface */
                                                               NULL, /* member */
                                                               NULL, /* object_path */
                                                               NULL, /* arg0 */
                                                               G_DBUS_SIGNAL_FLAGS_NO_MATCH_RULE,
                                                               on_signal_message, peer, NULL);

      g_hash_table_insert (self->peers, peer->name ? peer->name : "", peer);
    }

  return peer;
}

static void
subscribe_and_cache (CockpitDBusJson *self)
{
  g_dbus_connection_set_exit_on_close (self->connection, FALSE);
  if (self->default_name || self->bus_type == G_BUS_TYPE_NONE)
    ensure_peer (self, self->default_name);
}

static void
process_connection (CockpitDBusJson *self,
                    GError *error)
{
  CockpitChannel *channel = COCKPIT_CHANNEL (self);
  GBusNameWatcherFlags flags;
  if (!self->connection)
    {
      if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_CANCELLED) ||
          g_cancellable_is_cancelled (self->cancellable))
        {
          g_debug ("%s", error->message);
        }
      else
        {
          cockpit_channel_fail (channel, "internal-error", "%s", error->message);
        }
      g_error_free (error);
    }
  else
    {
      /* Yup, we don't want this */
      g_dbus_connection_set_exit_on_close (self->connection, FALSE);
      if (self->default_name)
        {
          flags = G_BUS_NAME_WATCHER_FLAGS_AUTO_START;
          self->default_watch = g_bus_watch_name_on_connection (self->connection,
                                                                self->default_name, flags,
                                                                on_name_appeared,
                                                                on_name_vanished,
                                                                self, NULL);
          self->default_watched = TRUE;
          subscribe_and_cache (self);
        }
      else
        {
          subscribe_and_cache (self);
          send_ready (self);
        }
    }
}

static void
on_connection_ready (GObject *source,
                     GAsyncResult *result,
                     gpointer user_data)
{
  CockpitDBusJson *self = COCKPIT_DBUS_JSON (user_data);
  GError *error = NULL;

  self->connection = g_dbus_connection_new_for_address_finish (result,
                                                               &error);
  process_connection (self, error);
  g_object_unref (self);
}

static void
on_bus_ready (GObject *source,
              GAsyncResult *result,
              gpointer user_data)
{
  CockpitDBusJson *self = COCKPIT_DBUS_JSON (user_data);
  GError *error = NULL;

  self->connection = g_bus_get_finish (result, &error);
  process_connection (self, error);
  g_object_unref (self);
}

static void
cockpit_dbus_json_prepare (CockpitChannel *channel)
{
  CockpitDBusJson *self = COCKPIT_DBUS_JSON (channel);
  JsonObject *options;
  const gchar *bus;
  const gchar *address;
  gboolean internal = FALSE;

  COCKPIT_CHANNEL_CLASS (cockpit_dbus_json_parent_class)->prepare (channel);

  options = cockpit_channel_get_options (channel);
  if (!cockpit_json_get_string (options, "bus", NULL, &bus))
    {
      cockpit_channel_fail (channel, "protocol-error", "invalid \"bus\" option in dbus channel");
      return;
    }
  if (!cockpit_json_get_string (options, "address", NULL, &address))
    {
      cockpit_channel_fail (channel, "protocol-error", "invalid \"address\" option in dbus channel");
      return;
    }

  /*
   * The default bus is the "user" bus which doesn't exist in many
   * places yet, so use the session bus for now.
   */
  self->bus_type = G_BUS_TYPE_SESSION;
  if (bus == NULL || g_str_equal (bus, "system"))
    {
      self->bus_type = G_BUS_TYPE_SYSTEM;
    }
  else if (g_str_equal (bus, "session") ||
           g_str_equal (bus, "user"))
    {
      self->bus_type = G_BUS_TYPE_SESSION;
    }
  else if (g_str_equal (bus, "none"))
    {
      self->bus_type = G_BUS_TYPE_NONE;
      if (address == NULL || g_str_equal (address, "internal"))
          internal = TRUE;
    }
  else if (g_str_equal (bus, "internal"))
    {
      self->bus_type = G_BUS_TYPE_NONE;
      internal = TRUE;
    }
  else
    {
      cockpit_channel_fail (channel, "protocol-error", "invalid \"bus\" option in dbus channel: %s", bus);
      return;
    }

  if (!internal && !cockpit_dbus_json_allow_external)
    {
      cockpit_channel_close (channel, "not-supported");
      return;
    }

  /* An internal peer to peer connection to cockpit-bridge */
  if (internal)
    {
      if (!cockpit_json_get_null (options, "name", NULL))
        {
          cockpit_channel_fail (channel, "protocol-error",
                                "do not specify \"name\" option in dbus channel when \"internal\"");
          return;
        }

      self->connection = cockpit_dbus_internal_client ();
      if (self->connection == NULL)
        {
          cockpit_channel_fail (channel, "internal-error", "no internal DBus connection");
          return;
        }

      self->default_name = cockpit_dbus_internal_name ();
      self->logname = "internal";

      subscribe_and_cache (self);
      send_ready (self);
    }
  else
    {
      if (!cockpit_json_get_string (options, "name", NULL, &self->default_name))
        {
          self->default_name = NULL;
          if (!cockpit_json_get_null (options, "name", NULL))
            {
              cockpit_channel_fail (channel, "protocol-error", "invalid \"name\" option in dbus channel");
              return;
            }
        }
      else if (self->default_name != NULL && !g_dbus_is_name (self->default_name))
        {
          cockpit_channel_fail (channel, "protocol-error",
                                "bad \"name\" option in dbus channel: %s", self->default_name);
          return;
        }

      if (self->bus_type == G_BUS_TYPE_NONE && !g_dbus_is_address (address))
        {
          cockpit_channel_fail (channel, "protocol-error",
                                "bad \"address\" option in dbus channel: %s", address);
          return;
        }

      if (self->default_name != NULL)
        self->logname = self->default_name;
      else if (address != NULL)
        self->logname = address;
      else
        self->logname = bus;

      /* Ready when the bus connection is available */
      if (self->bus_type == G_BUS_TYPE_NONE)
        {
          GDBusConnectionFlags flags = G_DBUS_CONNECTION_FLAGS_AUTHENTICATION_CLIENT;
          if (self->default_name)
            flags = flags | G_DBUS_CONNECTION_FLAGS_MESSAGE_BUS_CONNECTION;

          g_dbus_connection_new_for_address (address,
                                             flags,
                                             NULL,
                                             self->cancellable,
                                             on_connection_ready,
                                             g_object_ref (self));
        }
      else
        {
          g_bus_get (self->bus_type, self->cancellable, on_bus_ready, g_object_ref (self));
        }
    }
}

static void
cockpit_dbus_json_dispose (GObject *object)
{
  CockpitDBusJson *self = COCKPIT_DBUS_JSON (object);
  CockpitDBusPeer *peer;
  GHashTableIter iter;
  gpointer value;
  GList *l;

  g_cancellable_cancel (self->cancellable);

  if (self->default_watched)
    {
      g_bus_unwatch_name (self->default_watch);
      self->default_watched = FALSE;
    }

  g_hash_table_iter_init (&iter, self->peers);
  while (g_hash_table_iter_next (&iter, NULL, &value))
    {
      g_hash_table_iter_remove (&iter);
      peer = value;

      g_free (peer->name);
      g_signal_handler_disconnect (peer->cache, peer->meta_sig);
      g_signal_handler_disconnect (peer->cache, peer->update_sig);
      g_object_run_dispose (G_OBJECT (peer->cache));
      g_object_unref (peer->cache);
      cockpit_dbus_rules_free (peer->rules);

      if (self->connection)
        g_dbus_connection_signal_unsubscribe (self->connection, peer->subscribe_id);
      g_free (peer);
    }

  /* Divorce ourselves the outstanding calls */
  for (l = self->active_calls; l != NULL; l = g_list_next (l))
    ((CallData *)l->data)->dbus_json = NULL;
  g_list_free (self->active_calls);
  self->active_calls = NULL;

  G_OBJECT_CLASS (cockpit_dbus_json_parent_class)->dispose (object);
}

static void
cockpit_dbus_json_finalize (GObject *object)
{
  CockpitDBusJson *self = COCKPIT_DBUS_JSON (object);

  g_clear_object (&self->connection);
  g_hash_table_unref (self->interface_info);
  g_hash_table_unref (self->peers);
  g_object_unref (self->cancellable);

  G_OBJECT_CLASS (cockpit_dbus_json_parent_class)->finalize (object);
}

static void
cockpit_dbus_json_constructed (GObject *object)
{
  const gchar *caps[] = { "address", NULL };

  G_OBJECT_CLASS (cockpit_dbus_json_parent_class)->constructed (object);

  g_object_set (object, "capabilities", &caps, NULL);
}

static void
cockpit_dbus_json_class_init (CockpitDBusJsonClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);
  CockpitChannelClass *channel_class = COCKPIT_CHANNEL_CLASS (klass);

  gobject_class->dispose = cockpit_dbus_json_dispose;
  gobject_class->finalize = cockpit_dbus_json_finalize;
  gobject_class->constructed = cockpit_dbus_json_constructed;

  channel_class->prepare = cockpit_dbus_json_prepare;
  channel_class->recv = cockpit_dbus_json_recv;
  channel_class->closed = cockpit_dbus_json_closed;
}

/**
 * cockpit_dbus_json_open:
 * @transport: transport to send messages on
 * @channel_id: the channel id
 * @dbus_service: the DBus service name to talk to
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
                        const gchar *dbus_service)
{
  CockpitChannel *channel;
  JsonObject *options;

  g_return_val_if_fail (channel_id != NULL, NULL);

  options = json_object_new ();
  json_object_set_string_member (options, "bus", "session");
  json_object_set_string_member (options, "service", dbus_service);
  json_object_set_string_member (options, "payload", "dbus-json3");

  channel = g_object_new (COCKPIT_TYPE_DBUS_JSON,
                          "transport", transport,
                          "id", channel_id,
                          "options", options,
                          NULL);

  json_object_unref (options);
  return channel;
}
