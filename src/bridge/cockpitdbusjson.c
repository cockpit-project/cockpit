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

#include "common/cockpitjson.h"

#include <json-glib/json-glib.h>

#include <string.h>

/**
 * CockpitDBusJson:
 *
 * A #CockpitChannel that sends DBus messages with the dbus-json payload
 * type.
 */

#define COCKPIT_DBUS_JSON(o)    (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_DBUS_JSON, CockpitDBusJson))

/*
 * HACK: Work around recently added constants in gdbus
 * https://bugzilla.gnome.org/show_bug.cgi?id=727900
 */

#if !GLIB_CHECK_VERSION(2,42,0)
#define G_DBUS_ERROR_UNKNOWN_INTERFACE G_DBUS_ERROR_UNKNOWN_METHOD
#define G_DBUS_ERROR_UNKNOWN_OBJECT G_DBUS_ERROR_UNKNOWN_METHOD
#endif

typedef struct {
  CockpitChannel parent;
  GDBusConnection *connection;
  gboolean filter_added;
  guint filter_id;

  /* Talking to */
  const gchar *name;
  gchar *name_owner;
  guint name_watch;
  GHashTable *introspect_cache;
  gboolean name_watched;

  /* Call related */
  GCancellable *cancellable;
  GList *active_calls;

  /* Signal related */
  GHashTable *rules;
} CockpitDBusJson;

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

  /* base64 strings are always multiple of 3 */
  if (pos % 3 == 0 || value[pos] == '\0')
    data = g_base64_decode (value, &length);

  if (!data)
    {
      g_set_error (error, G_DBUS_ERROR, G_DBUS_ERROR_INVALID_ARGS,
                   "Invalid base64 in argument");
      goto out;
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
          key_node = json_node_init_string (json_node_alloc (), l->data);
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
  string = g_base64_encode (data, length);
  node = json_node_init_string (json_node_alloc (), string);
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
      return json_node_init_boolean (json_node_alloc (), g_variant_get_boolean (value));

    case G_VARIANT_CLASS_BYTE:
      return json_node_init_int (json_node_alloc (), g_variant_get_byte (value));

    case G_VARIANT_CLASS_INT16:
      return json_node_init_int (json_node_alloc (), g_variant_get_int16 (value));

    case G_VARIANT_CLASS_UINT16:
      return json_node_init_int (json_node_alloc (), g_variant_get_uint16 (value));

    case G_VARIANT_CLASS_INT32:
      return json_node_init_int (json_node_alloc (), g_variant_get_int32 (value));

    case G_VARIANT_CLASS_UINT32:
      return json_node_init_int (json_node_alloc (), g_variant_get_uint32 (value));

    case G_VARIANT_CLASS_INT64:
      return json_node_init_int (json_node_alloc (), g_variant_get_int64 (value));

    case G_VARIANT_CLASS_UINT64:
      return json_node_init_int (json_node_alloc (), g_variant_get_uint64 (value));

    case G_VARIANT_CLASS_HANDLE:
      return json_node_init_int (json_node_alloc (), g_variant_get_handle (value));

    case G_VARIANT_CLASS_DOUBLE:
      return json_node_init_double (json_node_alloc (), g_variant_get_double (value));

    case G_VARIANT_CLASS_STRING:      /* explicit fall-through */
    case G_VARIANT_CLASS_OBJECT_PATH: /* explicit fall-through */
    case G_VARIANT_CLASS_SIGNATURE:
      return json_node_init_string (json_node_alloc (), g_variant_get_string (value, NULL));

    case G_VARIANT_CLASS_VARIANT:
      object = build_json_variant (value);
      node = json_node_init_object (json_node_alloc (), object);
      json_object_unref (object);
      return node;

    case G_VARIANT_CLASS_ARRAY:
      type = g_variant_get_type (value);
      element_type = g_variant_type_element (type);
      if (g_variant_type_is_dict_entry (element_type))
        {
          object = build_json_dictionary (element_type, value);
          node = json_node_init_object (json_node_alloc (), object);
          json_object_unref (object);
        }
      else if (g_variant_type_equal (element_type, G_VARIANT_TYPE_BYTE))
        {
          node = build_json_byte_array (value);
        }
      else
        {
          array = build_json_array_or_tuple (value);
          node = json_node_init_array (json_node_alloc (), array);
          json_array_unref (array);
        }
      return node;

    case G_VARIANT_CLASS_TUPLE:
      array = build_json_array_or_tuple (value);
      node = json_node_init_array (json_node_alloc (), array);
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
  cockpit_channel_send (COCKPIT_CHANNEL (self), bytes);
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
build_json_body (GDBusMessage *message,
                 gchar **type)
{
  GVariant *body = g_dbus_message_get_body (message);
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
      return json_node_init_null (json_node_alloc ());
    }
}

static JsonObject *
build_json_reply (GDBusMessage *message,
                  gboolean with_type)
{
  JsonObject *object;
  JsonArray *reply;
  gchar *type = NULL;

  object = json_object_new ();
  reply = json_array_new ();
  if (g_dbus_message_get_message_type (message) == G_DBUS_MESSAGE_TYPE_ERROR)
    {
      json_array_add_string_element (reply, g_dbus_message_get_error_name (message));
      json_object_set_array_member (object, "error", reply);
    }
  else
    {
      json_object_set_array_member (object, "reply", reply);
    }

  json_array_add_element (reply, build_json_body (message, with_type ? &type : NULL));

  if (type)
    {
      json_object_set_string_member (object, "type", type);
      g_free (type);
    }
  return object;
}

static JsonObject *
build_json_signal (GDBusMessage *message)
{
  JsonObject *object;
  JsonArray *signal;

  object = json_object_new ();
  signal = json_array_new ();
  json_array_add_string_element (signal, g_dbus_message_get_path (message));
  json_array_add_string_element (signal, g_dbus_message_get_interface (message));
  json_array_add_string_element (signal, g_dbus_message_get_member (message));
  json_array_add_element (signal, build_json_body (message, FALSE));
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

  /* Owned by cache */
  GDBusInterfaceInfo *info;

  /* Owned by request */
  const gchar *cookie;
  const gchar *interface;
  const gchar *method;
  const gchar *path;
  const gchar *type;
  JsonNode *args;
} CallData;

static void
send_dbus_error (CockpitDBusJson *self,
                 CallData *call,
                 GError *error)
{
  JsonObject *object;

  if (!call->cookie)
    {
      g_debug ("%s: dropping error without cookie: %s", self->name, error->message);
      return;
    }

  object = build_json_error (error);
  json_object_set_string_member (object, "id", call->cookie);
  send_json_object (self, object);
  json_object_unref (object);
}

static void
send_dbus_reply (CockpitDBusJson *self,
                 CallData *call,
                 GDBusMessage *message)
{
  JsonObject *object;

  g_return_if_fail (call->cookie != NULL);

  object = build_json_reply (message, call->type != NULL);
  json_object_set_string_member (object, "id", call->cookie);
  send_json_object (self, object);
  json_object_unref (object);
}

static GVariantType *
calculate_param_type (GDBusInterfaceInfo *info,
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
                   "Introspection data for method %s on D-Bus interface %s not available",
                   info->name, method);
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
  GDBusMessage *message;

  g_return_if_fail (call->param_type != NULL);
  parameters = parse_json (call->args, call->param_type, &error);

  if (!parameters)
    goto out;

  g_debug ("%s: invoking %s %s at %s", self->name, call->interface, call->method, call->path);

  message = g_dbus_message_new_method_call (call->dbus_json->name_owner,
                                            call->path,
                                            call->interface,
                                            call->method);

  g_dbus_message_set_body (message, parameters);

  g_dbus_connection_send_message_with_reply (call->dbus_json->connection,
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
      send_dbus_error (self, call, error);
      g_error_free (error);
    }
  if (call)
    call_data_free (call);
}

static void
on_introspect_ready (GObject *source,
                     GAsyncResult *result,
                     gpointer user_data)
{
  CallData *call = user_data;
  CockpitDBusJson *self = call->dbus_json;
  GVariant *val = NULL;
  GDBusNodeInfo *node = NULL;
  GDBusInterfaceInfo *iface = NULL;
  GDBusInterfaceInfo *found = NULL;
  const gchar *xml = NULL;
  GError *error = NULL;
  gboolean expected;
  gchar *remote;
  gint i;

  /* Cancelled? */
  if (!call->dbus_json)
    {
      call_data_free (call);
      return;
    }

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
          g_free (remote);
        }

      if (expected)
        {
          g_debug ("%s: no introspect data found for object %s", self->name, call->path);
        }
      else
        {
          g_message ("Couldn't look up introspection for object %s: %s",
                     call->path, error->message);
        }
      g_clear_error (&error);
    }

  if (val)
    {
      g_debug ("%s: got introspect data for %s", self->name, call->path);

      g_variant_get (val, "(&s)", &xml);
      node = g_dbus_node_info_new_for_xml (xml, &error);
      if (error)
        {
          g_message ("Invalid DBus introspect data received for object %s: %s",
                     call->path, error->message);
          g_clear_error (&error);
        }
      else if (node)
        {
          for (i = 0; node->interfaces && node->interfaces[i] != NULL; i++)
            {
              iface = node->interfaces[i];
              if (iface->name)
                {
                  g_hash_table_replace (self->introspect_cache, iface->name,
                                        g_dbus_interface_info_ref (iface));
                  if (g_str_equal (iface->name, call->interface))
                    found = iface;
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
  if (!found)
    {
      g_set_error (&error, G_DBUS_ERROR, G_DBUS_ERROR_UNKNOWN_INTERFACE,
                   "no interface %s at path %s while calling %s",
                   call->path, call->interface, call->method);
    }
  else
    {
      call->param_type = calculate_param_type (found, call->method, &error);
    }

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

static void
handle_dbus_call (CockpitDBusJson *self,
                  JsonObject *object)
{
  GError *error = NULL;
  CallData *call;
  JsonArray *array;
  JsonNode *node;
  gchar *type;

  node = json_object_get_member (object, "call");
  g_return_if_fail (node != NULL);

  if (!JSON_NODE_HOLDS_ARRAY (node))
    {
      g_warning ("incorrect call field in dbus command");
      cockpit_channel_close (COCKPIT_CHANNEL (self), "protocol-error");
      return;
    }

  call = g_slice_new0 (CallData);
  array = json_node_get_array (node);

  call->path = array_string_element (array, 0);
  call->interface = array_string_element (array, 1);
  call->method = array_string_element (array, 2);
  node = json_array_get_element (array, 3);
  if (node && JSON_NODE_HOLDS_ARRAY (node))
    call->args = node;

  cockpit_json_get_string (object, "id", NULL, &call->cookie);
  cockpit_json_get_string (object, "type", NULL, &call->type);

  if (!call->path || !g_variant_is_object_path (call->path))
    {
      g_set_error (&error, G_DBUS_ERROR, G_DBUS_ERROR_UNKNOWN_OBJECT,
                   "Object path is not valid: %s", call->path);
    }
  else if (!call->interface || !g_dbus_is_interface_name (call->interface))
    {
      g_set_error (&error, G_DBUS_ERROR, G_DBUS_ERROR_UNKNOWN_INTERFACE,
                   "Interface name is not valid: %s", call->interface);
    }
  else if (!call->method || !g_dbus_is_member_name (call->method))
    {
      g_set_error (&error, G_DBUS_ERROR, G_DBUS_ERROR_UNKNOWN_METHOD,
                   "Method name is not valid: %s", call->method);
    }
  else if (!call->args)
    {
      g_set_error (&error, G_DBUS_ERROR, G_DBUS_ERROR_INVALID_ARGS,
                   "Missing arguments in method call");
    }
  else if (call->type)
    {
      if (!g_variant_is_signature (call->type))
        {
          g_set_error (&error, G_DBUS_ERROR, G_DBUS_ERROR_INVALID_ARGS,
                       "Type signature is not valid: %s", call->type);
        }
      else
        {
          type = g_strdup_printf ("(%s)", call->type);
          call->param_type = g_variant_type_new (type);
          g_free (type);
        }
    }

  if (!error && !call->param_type)
    {
      call->info = g_hash_table_lookup (self->introspect_cache, call->interface);
      if (call->info)
        {
          g_debug ("%s: found introspect data for %s in cache", self->name, call->interface);
          call->param_type = calculate_param_type (call->info, call->method, &error);
        }
    }

  if (error)
    {
      send_dbus_error (self, call, error);
      g_error_free (error);
      call_data_free (call);
      return;
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
      g_debug ("%s: no introspect data for %s %s", self->name, call->path, call->interface);

      g_dbus_connection_call (self->connection, self->name_owner, call->path,
                              "org.freedesktop.DBus.Introspectable", "Introspect",
                              NULL, G_VARIANT_TYPE ("(s)"),
                              G_DBUS_CALL_FLAGS_NO_AUTO_START,
                              -1, /* timeout */
                              NULL, /* GCancellable */
                              on_introspect_ready, call);
    }
}

typedef struct {
  CockpitDBusJson *dbus_json;
  JsonObject *request;
  gint refs;

  const gchar *id;
  const gchar *path;
  const gchar *path_namespace;
  const gchar *interface;
  const gchar *signal;
  const gchar *arg0;
  gchar *match;
} RuleData;

static void
rule_data_free (gpointer data)
{
  RuleData *rule = data;
  json_object_unref (rule->request);
  g_free (rule->match);
  g_slice_free (RuleData,rule);
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
      g_warning ("couldn't add match to bus: %s", error->message);
      cockpit_channel_close (COCKPIT_CHANNEL (self), "internal-error");
      g_error_free (error);
    }
  if (retval)
    g_variant_unref (retval);
  g_object_unref (self);
}

static RuleData *
parse_json_rule (CockpitDBusJson *self,
                 JsonNode *node)
{
  JsonObject *object;
  RuleData *rule;
  gboolean valid;
  GString *string;
  GList *names, *l;

  if (!JSON_NODE_HOLDS_OBJECT (node))
    {
      g_warning ("incorrect match field in dbus command");
      return NULL;
    }

  object = json_node_get_object (node);
  rule = g_slice_new0 (RuleData);

  names = json_object_get_members (object);
  for (l = names; l != NULL; l = g_list_next (l))
    {
      valid = FALSE;
      if (g_str_equal (l->data, "interface"))
        valid = cockpit_json_get_string (object, "interface", NULL, &rule->interface);
      else if (g_str_equal (l->data, "member"))
        valid = cockpit_json_get_string (object, "member", NULL, &rule->signal);
      else if (g_str_equal (l->data, "path"))
        valid = cockpit_json_get_string (object, "path", NULL, &rule->path);
      else if (g_str_equal (l->data, "path_namespace"))
        valid = cockpit_json_get_string (object, "path_namespace", NULL, &rule->path_namespace);
      else if (g_str_equal (l->data, "arg0"))
        valid = cockpit_json_get_string (object, "arg0", NULL, &rule->arg0);

      if (!valid)
        {
          g_warning ("invalid or unsupported match field: %s", (gchar *)l->data);
          g_list_free (names);
          g_slice_free (RuleData, rule);
          return NULL;
        }
    }
  g_list_free (names);

  valid = FALSE;
  if (rule->path && !g_variant_is_object_path (rule->path))
    g_warning ("match path is not valid: %s", rule->path);
  else if (rule->path_namespace && !g_variant_is_object_path (rule->path_namespace))
    g_warning ("match path is not valid: %s", rule->path);
  else if (rule->interface && !g_dbus_is_interface_name (rule->interface))
    g_warning ("match interface is not valid: %s", rule->interface);
  else if (rule->signal && !g_dbus_is_member_name (rule->signal))
    g_warning ("match name is not valid: %s", rule->signal);
  else if (rule->arg0 && strchr (rule->arg0, '\'') != NULL)
    g_warning ("match arg0 is not valid: %s", rule->arg0);
  else if (rule->path && rule->path_namespace)
    g_warning ("match cannot specify both path and path_namespace");
  else
    valid = TRUE;

  if (!valid)
    {
      g_slice_free (RuleData, rule);
      return NULL;
    }

  string = g_string_new ("type='signal'");
  g_string_append_printf (string, ",sender='%s'", self->name_owner);
  if (rule->path)
    g_string_append_printf (string, ",path='%s'", rule->path);
  if (rule->path_namespace)
    g_string_append_printf (string, ",path_namespace='%s'", rule->path_namespace);
  if (rule->interface)
    g_string_append_printf (string, ",interface='%s'", rule->interface);
  if (rule->signal)
    g_string_append_printf (string, ",member='%s'", rule->interface);
  if (rule->arg0)
    g_string_append_printf (string, ",arg0='%s'", rule->arg0);
  rule->match = g_string_free (string, FALSE);

  rule->request = json_object_ref (object);
  rule->refs = 1;

  return rule;
}

static void
handle_dbus_add_match (CockpitDBusJson *self,
                       JsonObject *object)
{
  RuleData *rule, *prev;
  JsonNode *node;

  node = json_object_get_member (object, "add-match");
  g_return_if_fail (node != NULL);

  rule = parse_json_rule (self, node);
  if (!rule)
    {
      cockpit_channel_close (COCKPIT_CHANNEL (self), "protocol-error");
      return;
    }

  prev = g_hash_table_lookup (self->rules, rule->match);
  if (prev == NULL)
    {
      g_hash_table_replace (self->rules, rule->match, rule);
      g_dbus_connection_call (self->connection,
                              "org.freedesktop.DBus",
                              "/org/freedesktop/DBus",
                              "org.freedesktop.DBus",
                              "AddMatch",
                              g_variant_new ("(s)", rule->match),
                              NULL, G_DBUS_CALL_FLAGS_NO_AUTO_START, -1,
                              self->cancellable,
                              on_add_match_ready,
                              g_object_ref (self));
    }
  else
    {
      prev->refs++;
      rule_data_free (rule);
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
      g_warning ("couldn't add match to bus: %s", error->message);
      cockpit_channel_close (COCKPIT_CHANNEL (self), "internal-error");
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
  RuleData *rule, *prev;
  JsonNode *node;

  node = json_object_get_member (object, "remove-match");
  g_return_if_fail (node != NULL);

  rule = parse_json_rule (self, node);
  if (!rule)
    {
      cockpit_channel_close (COCKPIT_CHANNEL (self), "protocol-error");
      return;
    }

  prev = g_hash_table_lookup (self->rules, rule->match);
  rule_data_free (rule);

  if (!prev)
    {
      g_warning ("no previously added rule to unsubscribe");
      cockpit_channel_close (COCKPIT_CHANNEL (self), "protocol-error");
      return;
    }

  /*
   * So there is a slight race, where we don't actually know if the AddMatch
   * was successful yet ... but if the bus is failing AddMatch, then there's
   * all bets are off anyway.
   */

  prev->refs--;
  if (prev->refs == 0)
    {
      g_dbus_connection_call (self->connection,
                              "org.freedesktop.DBus",
                              "/org/freedesktop/DBus",
                              "org.freedesktop.DBus",
                              "RemoveMatch",
                              g_variant_new ("(s)", prev->match),
                              NULL, G_DBUS_CALL_FLAGS_NO_AUTO_START, -1,
                              self->cancellable,
                              on_remove_match_ready, g_object_ref (self));
      g_hash_table_remove (self->rules, prev->match);
    }
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
      g_warning ("failed to parse request: %s", error->message);
      g_clear_error (&error);
      cockpit_channel_close (channel, "protocol-error");
      return;
    }

  if (json_object_has_member (object, "call"))
    handle_dbus_call (self, object);
  else if (json_object_has_member (object, "add-match"))
    handle_dbus_add_match (self, object);
  else if (json_object_has_member (object, "remove-match"))
    handle_dbus_remove_match (self, object);
  else
    {
      g_warning ("got unsupported dbus command");
      cockpit_channel_close (channel, "protocol-error");
    }

  json_object_unref (object);
}

static void
process_incoming_signal (CockpitDBusJson *self,
                         GDBusMessage *message)
{
  JsonObject *object;
  const gchar *sender;
  GHashTableIter iter;
  const gchar *path;
  RuleData *rule;

  /* Must match sender we're talking to */
  sender = g_dbus_message_get_sender (message);
  if (sender && g_strcmp0 (sender, self->name) != 0 &&
      g_strcmp0 (sender, self->name_owner) != 0)
    return;

  /* This is a possible future optimization point, once usage patterns are clear */
  g_hash_table_iter_init (&iter, self->rules);
  while (g_hash_table_iter_next (&iter, NULL, (gpointer *)&rule))
    {
      if (rule->interface &&
          g_strcmp0 (rule->interface, g_dbus_message_get_interface (message)) != 0)
        return;

      if (rule->signal &&
          g_strcmp0 (rule->signal, g_dbus_message_get_member (message)) != 0)
        return;

      if (rule->path)
        {
          path = g_dbus_message_get_path (message);
          if (rule->path_namespace)
            {
              if (!path || !g_str_has_prefix (path, rule->path))
                return;
            }
          else
            {
              if (g_strcmp0 (path, rule->path) != 0)
                return;
            }
        }

      if (rule->arg0 &&
          g_strcmp0 (rule->arg0, g_dbus_message_get_arg0 (message)) != 0)
            return;
    }

  /* If we got here then this is a signal to send */
  object = build_json_signal (message);
  send_json_object (self, object);
  json_object_unref (object);
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
  self->introspect_cache = g_hash_table_new_full (g_str_hash, g_str_equal, NULL,
                                                  (GDestroyNotify)g_dbus_interface_info_unref);

  self->rules = g_hash_table_new_full (g_str_hash, g_str_equal, NULL, rule_data_free);
}

typedef struct {
  CockpitDBusJson *dbus_json;
  GDBusMessage *message;
} SignalData;

static void
signal_data_free (gpointer data)
{
  SignalData *sd = data;
  g_object_unref (sd->dbus_json);
  g_object_unref (sd->message);
  g_slice_free (SignalData, sd);
}

static gboolean
on_signal_message (gpointer data)
{
  SignalData *sd = data;
  process_incoming_signal (sd->dbus_json, sd->message);
  return FALSE;
}

static GDBusMessage *
on_message_filter (GDBusConnection *connection,
                   GDBusMessage *message,
                   gboolean incoming,
                   gpointer user_data)
{
  /* No way to subscrcibe and get full GDBusMessage objects ... so this is a filter */
  CockpitDBusJson *self = user_data;
  const gchar *sender;
  SignalData *sd;

  if (incoming && g_dbus_message_get_message_type (message) == G_DBUS_MESSAGE_TYPE_SIGNAL)
    {
      /* These never change while the filter is installed, safe to access */
      sender = g_dbus_message_get_sender (message);
      if (!sender || g_strcmp0 (sender, self->name) == 0 || g_strcmp0 (sender, self->name_owner) == 0)
        {
          sd = g_slice_new0 (SignalData);
          sd->dbus_json = g_object_ref (self);
          sd->message = g_object_ref (message);
          g_main_context_invoke_full (NULL, G_PRIORITY_DEFAULT,
                                      on_signal_message, sd, signal_data_free);
        }
    }

  return message;
}

static void
on_name_appeared (GDBusConnection *connection,
                  const gchar *name,
                  const gchar *name_owner,
                  gpointer user_data)
{
  CockpitDBusJson *self = COCKPIT_DBUS_JSON (user_data);

  g_return_if_fail (self->name_owner == NULL);
  g_return_if_fail (self->filter_added == FALSE);

  if (!self->name_owner)
    {
      self->name_owner = g_strdup (name_owner);
      g_debug ("%s: name owner is %s", self->name, self->name_owner);
      cockpit_channel_ready (COCKPIT_CHANNEL (self));
    }

  if (!self->filter_added)
    {
      self->filter_id = g_dbus_connection_add_filter (self->connection,
                                                      on_message_filter,
                                                      self, NULL);
      self->filter_added = TRUE;
    }
}

static void
on_name_vanished (GDBusConnection *connection,
                  const gchar *name,
                  gpointer user_data)
{
  CockpitDBusJson *self = COCKPIT_DBUS_JSON (user_data);
  CockpitChannel *channel = COCKPIT_CHANNEL (self);

  if (G_IS_DBUS_CONNECTION (connection) && g_dbus_connection_is_closed (connection))
    cockpit_channel_close (channel, "disconnected");
  else if (self->name_owner)
    cockpit_channel_close (channel, NULL);
  else
    cockpit_channel_close (channel, "not-found");
}

static void
on_bus_ready (GObject *source,
              GAsyncResult *result,
              gpointer user_data)
{
  CockpitDBusJson *self = COCKPIT_DBUS_JSON (user_data);
  CockpitChannel *channel = COCKPIT_CHANNEL (self);
  GBusNameWatcherFlags flags;
  GError *error = NULL;

  self->connection = g_bus_get_finish (result, &error);
  if (!self->connection)
    {
      if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_CANCELLED) ||
          g_cancellable_is_cancelled (self->cancellable))
        {
          g_debug ("%s", error->message);
        }
      else
        {
          g_warning ("%s", error->message);
          cockpit_channel_close (channel, "internal-error");
        }
      g_error_free (error);
    }
  else
    {
      g_dbus_connection_set_exit_on_close (self->connection, FALSE);

      flags = G_BUS_NAME_WATCHER_FLAGS_AUTO_START;
      self->name_watch = g_bus_watch_name_on_connection (self->connection,
                                                         self->name,
                                                         flags,
                                                         on_name_appeared,
                                                         on_name_vanished,
                                                         self, NULL);
      self->name_watched = TRUE;
    }

  g_object_unref (self);
}

static gboolean
on_idle_protocol_error (gpointer user_data)
{
  CockpitDBusJson *self = COCKPIT_DBUS_JSON (user_data);
  if (!g_cancellable_is_cancelled (self->cancellable))
    cockpit_channel_close (user_data, "protocol-error");
  return FALSE;
}

static void
protocol_error_later (CockpitDBusJson *self)
{
  g_idle_add_full (G_PRIORITY_DEFAULT, on_idle_protocol_error,
                   g_object_ref (self), g_object_unref);
}

static void
cockpit_dbus_json_constructed (GObject *object)
{
  CockpitDBusJson *self = COCKPIT_DBUS_JSON (object);
  CockpitChannel *channel = COCKPIT_CHANNEL (self);
  GBusType bus_type;
  const gchar *bus;

  G_OBJECT_CLASS (cockpit_dbus_json_parent_class)->constructed (object);

  /*
   * Guarantee: Remember that we cannot close the channel until we've
   * hit the main loop. This is to make it easier and predictable on
   * callers. See the similar GLib async guarantee.
   */

  self->name = cockpit_channel_get_option (channel, "name");
  if (self->name == NULL || !g_dbus_is_name (self->name))
    {
      g_warning ("bridge got invalid dbus name: %s", self->name);
      protocol_error_later (self);
      return;
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
      g_warning ("bridge got an invalid bus type: %s", bus);
      protocol_error_later (self);
      return;
    }

  g_bus_get (bus_type, self->cancellable, on_bus_ready, g_object_ref (self));
}

static void
cockpit_dbus_json_dispose (GObject *object)
{
  CockpitDBusJson *self = COCKPIT_DBUS_JSON (object);
  GList *l;

  if (self->name_watched)
    {
      g_bus_unwatch_name (self->name_watch);
      self->name_watched = FALSE;
    }

  /* Divorce ourselves the outstanding calls */
  for (l = self->active_calls; l != NULL; l = g_list_next (l))
    ((CallData *)l->data)->dbus_json = NULL;
  g_list_free (self->active_calls);
  self->active_calls = NULL;

  if (self->connection && self->filter_added)
    {
      g_dbus_connection_remove_filter (self->connection, self->filter_id);
      self->filter_added = FALSE;
    }

  g_hash_table_remove_all (self->rules);

  /* And cancel them all, which should free them eventually */
  g_cancellable_cancel (self->cancellable);

  G_OBJECT_CLASS (cockpit_dbus_json_parent_class)->dispose (object);
}

static void
cockpit_dbus_json_finalize (GObject *object)
{
  CockpitDBusJson *self = COCKPIT_DBUS_JSON (object);

  g_free (self->name_owner);
  g_clear_object (&self->connection);
  g_object_unref (self->cancellable);
  g_hash_table_destroy (self->introspect_cache);
  g_hash_table_destroy (self->rules);

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
  json_object_set_string_member (options, "payload", "dbus-json");

  channel = g_object_new (COCKPIT_TYPE_DBUS_JSON,
                          "transport", transport,
                          "id", channel_id,
                          "options", options,
                          NULL);

  json_object_unref (options);
  return channel;
}
