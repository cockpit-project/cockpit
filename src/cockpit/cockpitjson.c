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
