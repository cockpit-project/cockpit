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
