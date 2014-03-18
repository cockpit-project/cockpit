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
