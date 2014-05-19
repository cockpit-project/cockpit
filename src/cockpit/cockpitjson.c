/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2014 Red Hat, Inc.
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

#include "cockpitjson.h"

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
      *value = defawlt;
      return TRUE;
    }
  else if (json_node_get_value_type (node) == G_TYPE_INT64 ||
           json_node_get_value_type (node) == G_TYPE_DOUBLE)
    {
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
      *value = defawlt;
      return TRUE;
    }
  else if (json_node_get_value_type (node) == G_TYPE_BOOLEAN)
    {
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
      *value = defawlt;
      return TRUE;
    }
  else if (json_node_get_value_type (node) == G_TYPE_STRING)
    {
      *value = json_node_get_string (node);
      return TRUE;
    }
  else
    {
      return FALSE;
    }

  return TRUE;
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
                       gchar ***value)
{
  gboolean valid = FALSE;
  JsonArray *array;
  JsonNode *node;
  guint length, i;
  gchar **val = NULL;

  node = json_object_get_member (options, member);
  if (!node)
    {
      if (defawlt)
        val = g_memdup (defawlt, sizeof (gchar *) * (g_strv_length ((gchar **)defawlt) + 1));
      valid = TRUE;
    }
  else if (json_node_get_node_type (node) == JSON_NODE_ARRAY)
    {
      valid = TRUE;
      array = json_node_get_array (node);
      length = json_array_get_length (array);
      val = g_new (gchar *, length + 1);
      for (i = 0; i < length; i++)
        {
          node = json_array_get_element (array, i);
          if (json_node_get_value_type (node) == G_TYPE_STRING)
            {
              val[i] = (gchar *)json_node_get_string (node);
            }
          else
            {
              valid = FALSE;
              break;
            }
        }
      val[length] = NULL;
    }

  if (valid)
    *value = val;
  else
    g_free (val);

  return valid;
}

static gboolean
cockpit_json_equal_object (JsonObject *previous,
                           JsonObject *current)
{
  const gchar *name = NULL;
  gboolean ret = TRUE;
  GList *names;
  GList *l;

  names = json_object_get_members (previous);
  names = g_list_concat (names, json_object_get_members (current));
  names = g_list_sort (names, (GCompareFunc)strcmp);

  for (l = names; l != NULL; l = g_list_next (l))
    {
      if (name && g_str_equal (name, l->data))
          continue;

      name = l->data;
      if (!cockpit_json_equal (json_object_get_member (previous, name),
                               json_object_get_member (current, name)))
        {
          ret = FALSE;
          break;
        }
    }

  g_list_free (names);
  return ret;
}

static gboolean
cockpit_json_equal_array (JsonArray *previous,
                          JsonArray *current)
{
  guint len_previous;
  guint len_current;
  guint i;

  len_previous = json_array_get_length (previous);
  len_current = json_array_get_length (current);

  if (len_previous != len_current)
    return FALSE;

  /* Look for something that has changed */
  for (i = 0; i < len_previous; i++)
    {
      if (!cockpit_json_equal (json_array_get_element (previous, i),
                               json_array_get_element (current, i)))
        return FALSE;
    }

  return TRUE;
}

/**
 * cockpit_json_equal:
 * @previous: first JSON thing or %NULL
 * @current: second JSON thing or %NULL
 *
 * Compares whether two JSON nodes are equal or not. Accepts
 * %NULL for either parameter, and if both are %NULL is equal.
 *
 * The keys of objects do not have to be in the same order.
 *
 * If nodes have different types or value types then equality
 * is FALSE.
 *
 * Returns: whether equal or not
 */
gboolean
cockpit_json_equal (JsonNode *previous,
                    JsonNode *current)

{
  JsonNodeType type = 0;
  GType gtype = 0;

  if (previous == current)
    return TRUE;
  if (!previous || !current)
    return FALSE;

  type = json_node_get_node_type (previous);
  if (type != json_node_get_node_type (current))
    return FALSE;
  if (type == JSON_NODE_VALUE)
    {
      gtype = json_node_get_value_type (previous);
      if (gtype != json_node_get_value_type (current))
        return FALSE;
    }

  /* Now compare values */
  switch (type)
    {
    case JSON_NODE_OBJECT:
      return cockpit_json_equal_object (json_node_get_object (previous),
                                        json_node_get_object (current));
    case JSON_NODE_ARRAY:
      return cockpit_json_equal_array (json_node_get_array (previous),
                                       json_node_get_array (current));
    case JSON_NODE_NULL:
      return TRUE;

    case JSON_NODE_VALUE:
      if (gtype == G_TYPE_INT64)
        return json_node_get_int (previous) == json_node_get_int (current);
      else if (gtype == G_TYPE_DOUBLE)
        return json_node_get_double (previous) == json_node_get_double (current);
      else if (gtype == G_TYPE_BOOLEAN)
        return json_node_get_boolean (previous) == json_node_get_boolean (current);
      else if (gtype == G_TYPE_STRING)
        return g_strcmp0 (json_node_get_string (previous), json_node_get_string (current)) == 0;
      else
        return TRUE;

    default:
      return FALSE;
    }
}

/**
 * cockpit_json_int_hash:
 * @v: pointer to a gint64
 *
 * Hash a pointer to a gint64. This is like g_int_hash()
 * but for gint64.
 *
 * Returns: the hash
 */
guint
cockpit_json_int_hash (gconstpointer v)
{
  return (guint)*((const guint64 *)v);
}

/**
 * cockpit_json_int_equal:
 * @v1: pointer to a gint64
 * @v2: pointer to a gint64
 *
 * Compare pointers to a gint64. This is like g_int_equal()
 * but for gint64.
 *
 * Returns: the hash
 */
gboolean
cockpit_json_int_equal (gconstpointer v1,
                        gconstpointer v2)
{
  return *((const guint64 *)v1) == *((const guint64 *)v2);
}

/**
 * cockpit_json_skip:
 * @data: the data to parse
 * @length: length of data
 * @spaces: location to return number of prefix spaces, or %NULL
 *
 * Skip over a single block of JSON, whether it's an object, array
 * string or other primitive.
 *
 * Will return the number of bytes to skip. If the block of JSON
 * continues past @length, then will return zero.
 *
 * If @spaces is non-NULL, then count the number whitespace characters
 * than prefix @data, and put that count in @spaces.
 *
 * The returned count will also consume any whitespace following
 * the JSON block.
 *
 * Does not validate that the returned block is valid JSON. Assumes
 * that the block is valid and/or will be parsed to find errors.
 *
 * Returns: the number of bytes in the JSON block, or %NULL
 */
gsize
cockpit_json_skip (const gchar *data,
                   gsize length,
                   gsize *spaces)
{
  gint depth = 0;
  gboolean instr = FALSE;
  gboolean inword = FALSE;
  gboolean any = FALSE;
  const gchar *p;
  const gchar *end;

  for (p = data, end = data + length; p != end; p++)
    {
      if (any && depth <= 0)
        break; /* skipped over one thing */

#if 0
      g_printerr ("%d:  %c  %s%d%s%s\n", (gint)(p - data), (gint)*p,
                  depth > 0 ? "+" : "", depth,
                  instr ? " instr" : "", inword ? " inword" : "");
#endif

      if (inword)
        {
          if (g_ascii_isspace (*p) || strchr ("[{}]\"", *p))
            {
              inword = FALSE;
              depth--;
              p--;
            }
          continue;
        }

      if (g_ascii_isspace (*p))
        continue;

      if (instr)
        {
          switch (*p)
            {
            case '\\':
              if (p != end)
                p++; /* skip char after bs */
              break;
            case '"':
              instr = FALSE;
              depth--;
              break;
            }
          continue;
        }

      if (spaces)
        {
          *spaces = p - data;
          spaces = NULL;
        }

      any = TRUE;
      switch (*p)
        {
        case '[': case '{':
          depth++;
          break;
        case ']': case '}':
          depth--;
          break;
        case '"':
          instr = TRUE;
          depth++;
          break;
        default:
          inword = TRUE;
          depth++;
          break;
        }
    }

  /* Consume any trailing whitespace */
  while (p != end && g_ascii_isspace (*p))
    p++;

  if (!any && spaces)
    *spaces = p - data;

  /* End of data can be end of word */
  if (inword && depth == 1)
    depth = 0;

  /* No complete JSON blocks found */
  if (depth > 0)
    return 0;

  /* The position at which we found the end */
  return p - data;
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
  JsonNode *ret;

  parser = g_private_get (&cached_parser);
  if (parser == NULL)
    {
      parser = json_parser_new ();
      g_private_set (&cached_parser, parser);
    }

  /*
   * HACK: Workaround for the fact that json-glib did not utf-8
   * validate its data until 0.99.2
   */
#ifdef COCKPIT_JSON_GLIB_NEED_UTF8_VALIDATE
  if (!g_utf8_validate (data, length, NULL))
    {
      GError *local_error = NULL;
      g_set_error_literal (&local_error, JSON_PARSER_ERROR,
                           JSON_PARSER_ERROR_INVALID_DATA,
                           "JSON data must be UTF-8 encoded");
      g_signal_emit_by_name (parser, "error", 0, error);
      g_propagate_error (error, local_error);
      return NULL;
    }
#endif


  if (json_parser_load_from_data (parser, data, length, error))
    {
      root = json_parser_get_root (parser);
      ret = json_node_copy (root);

      /*
       * HACK: JsonParser doesn't give us a way to clear the parser
       * and remove memory sitting around until the next parse, so
       * we clear it like this.
       *
       * https://bugzilla.gnome.org/show_bug.cgi?id=728951
       */
      json_node_init_null (root);
    }
  else
    {
      ret = NULL;
    }

  return ret;
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
  return cockpit_json_parse_object (g_bytes_get_data (data, NULL), length, error);
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

/**
 * cockpit_json_write_object:
 * @object: object to write
 * @length: optionally a location to return the length
 *
 * Encode a JsonObject to a string.
 *
 * Returns: (transfer full): the encoded data
 */
gchar *
cockpit_json_write_object (JsonObject *object,
                           gsize *length)
{
  JsonNode *node;
  gchar *ret;

  node = json_node_init_object (json_node_alloc (), object);
  ret = cockpit_json_write (node, length);
  json_node_free (node);

  return ret;
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

/* non-ASCII characters can't be escaped, otherwise UTF-8
 * chars will break, so we just pregenerate this table of
 * high characters and then we feed it to g_strescape()
 */
static const char json_exceptions[] = {
  0x7f,  0x80,  0x81,  0x82,  0x83,  0x84,  0x85,  0x86,
  0x87,  0x88,  0x89,  0x8a,  0x8b,  0x8c,  0x8d,  0x8e,
  0x8f,  0x90,  0x91,  0x92,  0x93,  0x94,  0x95,  0x96,
  0x97,  0x98,  0x99,  0x9a,  0x9b,  0x9c,  0x9d,  0x9e,
  0x9f,  0xa0,  0xa1,  0xa2,  0xa3,  0xa4,  0xa5,  0xa6,
  0xa7,  0xa8,  0xa9,  0xaa,  0xab,  0xac,  0xad,  0xae,
  0xaf,  0xb0,  0xb1,  0xb2,  0xb3,  0xb4,  0xb5,  0xb6,
  0xb7,  0xb8,  0xb9,  0xba,  0xbb,  0xbc,  0xbd,  0xbe,
  0xbf,  0xc0,  0xc1,  0xc2,  0xc3,  0xc4,  0xc5,  0xc6,
  0xc7,  0xc8,  0xc9,  0xca,  0xcb,  0xcc,  0xcd,  0xce,
  0xcf,  0xd0,  0xd1,  0xd2,  0xd3,  0xd4,  0xd5,  0xd6,
  0xd7,  0xd8,  0xd9,  0xda,  0xdb,  0xdc,  0xdd,  0xde,
  0xdf,  0xe0,  0xe1,  0xe2,  0xe3,  0xe4,  0xe5,  0xe6,
  0xe7,  0xe8,  0xe9,  0xea,  0xeb,  0xec,  0xed,  0xee,
  0xef,  0xf0,  0xf1,  0xf2,  0xf3,  0xf4,  0xf5,  0xf6,
  0xf7,  0xf8,  0xf9,  0xfa,  0xfb,  0xfc,  0xfd,  0xfe,
  0xff,
  '\0'   /* g_strescape() expects a NUL-terminated string */
};

static gchar *
json_strescape (const gchar *str)
{
  return g_strescape (str, json_exceptions);
}

static gchar *
dump_value (const gchar   *name,
            JsonNode      *node,
            gsize         *length)
{
  GString *buffer;
  GType type;

  buffer = g_string_new ("");

  if (name)
    g_string_append_printf (buffer, "\"%s\":", name);

  type = json_node_get_value_type (node);
  if (type == G_TYPE_INT64)
    {
      g_string_append_printf (buffer, "%" G_GINT64_FORMAT, json_node_get_int (node));
    }
  else if (type == G_TYPE_DOUBLE)
    {
        gchar buf[G_ASCII_DTOSTR_BUF_SIZE];

        g_string_append (buffer,
                         g_ascii_dtostr (buf, sizeof (buf),
                                         json_node_get_double (node)));
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
      g_return_val_if_reached (NULL);
    }

  if (length)
    *length = buffer->len;

  return g_string_free (buffer, FALSE);
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
