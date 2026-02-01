/*
 * Copyright (C) 2014 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#include "config.h"

/* This gets logged as part of the (more verbose) protocol logging */
#ifdef G_LOG_DOMAIN
#undef G_LOG_DOMAIN
#endif
#define G_LOG_DOMAIN "cockpit-protocol"

#include "cockpitjson.h"

#include <math.h>
#include <string.h>

gboolean
cockpit_json_get_int (JsonObject *object,
                      const gchar *name,
                      gint64 defawlt,
                      gint64 *value)
{
  JsonNode *node;

  node = json_object_get_member (object, name);
  if (!node)
    {
      if (value)
        *value = defawlt;
      return TRUE;
    }
  else if (json_node_get_value_type (node) == G_TYPE_INT64 ||
           json_node_get_value_type (node) == G_TYPE_DOUBLE)
    {
      if (value)
        *value = json_node_get_int (node);
      return TRUE;
    }
  else
    {
      return FALSE;
    }
}

gboolean
cockpit_json_get_bool (JsonObject *object,
                       const gchar *name,
                       gboolean defawlt,
                       gboolean *value)
{
  JsonNode *node;

  node = json_object_get_member (object, name);
  if (!node)
    {
      if (value)
        *value = defawlt;
      return TRUE;
    }
  else if (json_node_get_value_type (node) == G_TYPE_BOOLEAN)
    {
      if (value)
        *value = json_node_get_boolean (node);
      return TRUE;
    }
  else
    {
      return FALSE;
    }
}


gboolean
cockpit_json_get_string (JsonObject *options,
                         const gchar *name,
                         const gchar *defawlt,
                         const gchar **value)
{
  JsonNode *node;

  node = json_object_get_member (options, name);
  if (!node)
    {
      if (value)
        *value = defawlt;
      return TRUE;
    }
  else if (json_node_get_value_type (node) == G_TYPE_STRING)
    {
      if (value)
        *value = json_node_get_string (node);
      return TRUE;
    }
  else
    {
      return FALSE;
    }
}

gboolean
cockpit_json_get_object (JsonObject *options,
                         const gchar *member,
                         JsonObject *defawlt,
                         JsonObject **value)
{
  JsonNode *node;

  node = json_object_get_member (options, member);
  if (!node)
    {
      if (value)
        *value = defawlt;
      return TRUE;
    }
  else if (json_node_get_node_type (node) == JSON_NODE_OBJECT)
    {
      if (value)
        *value = json_node_get_object (node);
      return TRUE;
    }
  else
    {
      return FALSE;
    }
}

/**
 * cockpit_json_get_strv:
 * @options: the json object
 * @member: the member name
 * @defawlt: defawlt value
 * @value: returned value
 *
 * Gets a string array member from a JSON object. Validates
 * that the member is an array, and that all elements in the
 * array are strings. If these fail, then will return %FALSE.
 *
 * If @member does not exist in @options, returns the values
 * in @defawlt.
 *
 * The returned value in @value should be freed with g_free()
 * but the actual strings are owned by the JSON object.
 *
 * Returns: %FALSE if invalid member, %TRUE if valid or missing.
 */
gboolean
cockpit_json_get_strv (JsonObject *options,
                       const gchar *member,
                       const gchar **defawlt,
                       const gchar ***value)
{
  gboolean valid = FALSE;
  JsonArray *array;
  JsonNode *node;
  guint length, i;
  const gchar **val = NULL;

  node = json_object_get_member (options, member);
  if (!node)
    {
      if (defawlt)
        val = g_memdup2 (defawlt, sizeof (gchar *) * (g_strv_length ((gchar **)defawlt) + 1));
      valid = TRUE;
    }
  else if (json_node_get_node_type (node) == JSON_NODE_ARRAY)
    {
      valid = TRUE;
      array = json_node_get_array (node);
      length = json_array_get_length (array);
      val = g_new (const gchar *, length + 1);
      for (i = 0; i < length; i++)
        {
          node = json_array_get_element (array, i);
          if (json_node_get_value_type (node) == G_TYPE_STRING)
            {
              val[i] = json_node_get_string (node);
            }
          else
            {
              valid = FALSE;
              break;
            }
        }
      val[length] = NULL;
    }

  if (valid && value)
    *value = val;
  else
    g_free (val);

  return valid;
}

/**
 * cockpit_json_parse:
 * @data: string data to parse
 * @length: length of @data or -1
 * @error: optional location to return an error
 *
 * Parses JSON into a JsonNode.
 *
 * Returns: (transfer full): the parsed node or %NULL
 */
JsonNode *
cockpit_json_parse (const gchar *data,
                    gssize length,
                    GError **error)
{
  static GPrivate cached_parser = G_PRIVATE_INIT (g_object_unref);
  JsonParser *parser;
  JsonNode *root;

  parser = g_private_get (&cached_parser);
  if (parser == NULL)
    {
      parser = json_parser_new ();
      g_private_set (&cached_parser, parser);
    }

  if (!json_parser_load_from_data (parser, data, length, error))
    return NULL;

  root = json_parser_steal_root (parser);
  if (root == NULL)
    {
      g_set_error (error, JSON_PARSER_ERROR, JSON_PARSER_ERROR_PARSE,
                   "JSON data was empty");
      return NULL;
    }

  return root;
}

/**
 * cockpit_json_parse_object:
 * @data: string data to parse
 * @length: length of @data or -1
 * @error: optional location to return an error
 *
 * Parses JSON GBytes into a JsonObject. This is a helper function
 * combining cockpit_json_parse(), json_node_get_type() and
 * json_node_get_object().
 *
 * Returns: (transfer full): the parsed object or %NULL
 */
JsonObject *
cockpit_json_parse_object (const gchar *data,
                           gssize length,
                           GError **error)
{
  JsonNode *node;
  JsonObject *object;

  node = cockpit_json_parse (data, length, error);
  if (!node)
    return NULL;

  if (json_node_get_node_type (node) != JSON_NODE_OBJECT)
    {
      object = NULL;
      g_set_error (error, JSON_PARSER_ERROR, JSON_PARSER_ERROR_UNKNOWN, "Not a JSON object");
    }
  else
    {
      object = json_node_dup_object (node);
    }

  json_node_free (node);
  return object;
}

/**
 * cockpit_json_parse_bytes:
 * @data: data to parse
 * @error: optional location to return an error
 *
 * Parses JSON GBytes into a JsonObject. This is a helper function
 * combining cockpit_json_parse(), json_node_get_type() and
 * json_node_get_object().
 *
 * Returns: (transfer full): the parsed object or %NULL
 */
JsonObject *
cockpit_json_parse_bytes (GBytes *data,
                          GError **error)
{
  gsize length = g_bytes_get_size (data);

  if (length == 0)
    {
      g_set_error (error, JSON_PARSER_ERROR, JSON_PARSER_ERROR_PARSE,
                   "JSON data was empty");
      return NULL;
    }

  return cockpit_json_parse_object (g_bytes_get_data (data, NULL), length, error);
}

/**
 * cockpit_json_write_object:
 * @object: object to write
 * @length: optionally a location to return the length
 *
 * Encode a JsonObject to a string.
 *
 * Returns: (transfer full): the encoded data
 */
static gchar *
cockpit_json_write_object (JsonObject *object,
                           gsize *length)
{
  JsonNode *node;
  gchar *ret;

  node = json_node_new (JSON_NODE_OBJECT);
  json_node_set_object (node, object);
  ret = cockpit_json_write (node, length);
  json_node_free (node);

  return ret;
}

/**
 * cockpit_json_write_bytes:
 * @object: object to write
 *
 * Encode a JsonObject to a GBytes.
 *
 * Returns: (transfer full): the encoded data
 */
GBytes *
cockpit_json_write_bytes (JsonObject *object)
{
  gchar *data;
  gsize length;

  data = cockpit_json_write_object (object, &length);
  return g_bytes_new_take (data, length);
}

/*
 * HACK: JsonGenerator is completely borked, so we've copied it\
 * here until we can rely on a fixed version.
 *
 * https://bugzilla.gnome.org/show_bug.cgi?id=727593
 */

static gchar *dump_value  (const gchar   *name,
                           JsonNode      *node,
                           gsize         *length);
static gchar *dump_array  (const gchar   *name,
                           JsonArray     *array,
                           gsize         *length);
static gchar *dump_object (const gchar   *name,
                           JsonObject    *object,
                           gsize         *length);

static gchar *
json_strescape (const gchar *str)
{
  const gchar *p;
  const gchar *end;
  GString *output;
  gsize len;

  len = strlen (str);
  end = str + len;
  output = g_string_sized_new (len);

  for (p = str; p < end; p++)
    {
      if (*p == '\\' || *p == '"')
        {
          g_string_append_c (output, '\\');
          g_string_append_c (output, *p);
        }
      else if ((*p > 0 && *p < 0x1f) || *p == 0x7f)
        {
          switch (*p)
            {
            case '\b':
              g_string_append (output, "\\b");
              break;
            case '\f':
              g_string_append (output, "\\f");
              break;
            case '\n':
              g_string_append (output, "\\n");
              break;
            case '\r':
              g_string_append (output, "\\r");
              break;
            case '\t':
              g_string_append (output, "\\t");
              break;
            default:
              g_string_append_printf (output, "\\u00%02x", (guint)*p);
              break;
            }
        }
      else
        {
          g_string_append_c (output, *p);
        }
    }

  return g_string_free (output, FALSE);
}

static gchar *
dump_value (const gchar   *name,
            JsonNode      *node,
            gsize         *length)
{
  g_autoptr(GString) buffer = g_string_new ("");

  if (name)
    g_string_append_printf (buffer, "\"%s\":", name);

  GType type = json_node_get_value_type (node);
  if (type == G_TYPE_INT64)
    {
      g_string_append_printf (buffer, "%" G_GINT64_FORMAT, json_node_get_int (node));
    }
  else if (type == G_TYPE_DOUBLE)
    {
      gchar buf[G_ASCII_DTOSTR_BUF_SIZE];
      gdouble d = json_node_get_double (node);

      if (fpclassify (d) == FP_NAN || fpclassify (d) == FP_INFINITE)
        {
          g_string_append (buffer, "null");
        }
      else
        {
          g_string_append (buffer, g_ascii_dtostr (buf, sizeof (buf), d));
        }
    }
  else if (type == G_TYPE_BOOLEAN)
    {
      g_string_append (buffer, json_node_get_boolean (node) ? "true" : "false");
    }
  else if (type == G_TYPE_STRING)
    {
        gchar *tmp;

        tmp = json_strescape (json_node_get_string (node));
        g_string_append_c (buffer, '"');
        g_string_append (buffer, tmp);
        g_string_append_c (buffer, '"');

        g_free (tmp);
    }
  else
    {
      if (length)
        *length = 0;
      g_return_val_if_reached (NULL);
    }

  if (length)
    *length = buffer->len;

  return g_string_free (g_steal_pointer (&buffer), FALSE);
}

static gchar *
dump_array (const gchar   *name,
            JsonArray     *array,
            gsize         *length)
{
  guint array_len = json_array_get_length (array);
  guint i;
  GString *buffer;

  buffer = g_string_new ("");

  if (name)
    g_string_append_printf (buffer, "\"%s\":", name);

  g_string_append_c (buffer, '[');

  for (i = 0; i < array_len; i++)
    {
      JsonNode *cur = json_array_get_element (array, i);
      gchar *value;

      switch (JSON_NODE_TYPE (cur))
        {
        case JSON_NODE_NULL:
          g_string_append (buffer, "null");
          break;

        case JSON_NODE_VALUE:
          value = dump_value (NULL, cur, NULL);
          g_string_append (buffer, value);
          g_free (value);
          break;

        case JSON_NODE_ARRAY:
          value = dump_array (NULL, json_node_get_array (cur), NULL);
          g_string_append (buffer, value);
          g_free (value);
          break;

        case JSON_NODE_OBJECT:
          value = dump_object (NULL, json_node_get_object (cur), NULL);
          g_string_append (buffer, value);
          g_free (value);
          break;
        }

      if ((i + 1) != array_len)
        g_string_append_c (buffer, ',');
    }

  g_string_append_c (buffer, ']');

  if (length)
    *length = buffer->len;

  return g_string_free (buffer, FALSE);
}

static gchar *
dump_object (const gchar   *name,
             JsonObject    *object,
             gsize         *length)
{
  GList *members, *l;
  GString *buffer;

  buffer = g_string_new ("");

  if (name)
    g_string_append_printf (buffer, "\"%s\":", name);

  g_string_append_c (buffer, '{');

  members = json_object_get_members (object);

  for (l = members; l != NULL; l = l->next)
    {
      const gchar *member_name = l->data;
      gchar *escaped_name = json_strescape (member_name);
      JsonNode *cur = json_object_get_member (object, member_name);
      gchar *value;

      switch (JSON_NODE_TYPE (cur))
        {
        case JSON_NODE_NULL:
          g_string_append_printf (buffer, "\"%s\":null", escaped_name);
          break;

        case JSON_NODE_VALUE:
          value = dump_value (escaped_name, cur, NULL);
          g_string_append (buffer, value);
          g_free (value);
          break;

        case JSON_NODE_ARRAY:
          value = dump_array (escaped_name, json_node_get_array (cur), NULL);
          g_string_append (buffer, value);
          g_free (value);
          break;

        case JSON_NODE_OBJECT:
          value = dump_object (escaped_name, json_node_get_object (cur), NULL);
          g_string_append (buffer, value);
          g_free (value);
          break;
        }

      if (l->next != NULL)
        g_string_append_c (buffer, ',');

      g_free (escaped_name);
    }

  g_list_free (members);

  g_string_append_c (buffer, '}');

  if (length)
    *length = buffer->len;

  return g_string_free (buffer, FALSE);
}

/**
 * cockpit_json_write:
 * @node: the node to encode
 * @length: optional place to return length
 *
 * Encode a JsonNode to a string.
 *
 * Returns: (transfer full): the encoded string
 */
gchar *
cockpit_json_write (JsonNode *node,
                    gsize *length)
{
  gchar *retval = NULL;

  if (!node)
    {
      if (length)
        *length = 0;
      return NULL;
    }

  switch (JSON_NODE_TYPE (node))
    {
    case JSON_NODE_ARRAY:
      retval = dump_array (NULL, json_node_get_array (node), length);
      break;

    case JSON_NODE_OBJECT:
      retval = dump_object (NULL, json_node_get_object (node), length);
      break;

    case JSON_NODE_NULL:
      retval = g_strdup ("null");
      if (length)
        *length = 4;
      break;

    case JSON_NODE_VALUE:
      retval = dump_value (NULL, node, length);
      break;
    }

  return retval;
}

GHashTable *
cockpit_json_to_hash_table (JsonObject *object,
                            const gchar **fields)
{
  gint i;
  GHashTable *hash_table = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, g_free);

  for (i = 0; fields[i] != NULL; i++)
    {
      const gchar *value;
      if (!cockpit_json_get_string (object, fields[i], NULL, &value))
        continue;

      if (value)
        g_hash_table_insert (hash_table, g_strdup (fields[i]), g_strdup (value));
   }

  return hash_table;
}
