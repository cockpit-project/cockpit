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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

#include "config.h"

#include "cockpittemplate.h"

#include "cockpitjson.h"

#include <glib.h>

#include <string.h>

#define VARCHARS "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-"

static gchar *
find_variable (const gchar *start_marker,
               const gchar *end_marker,
               const gchar *data,
               const gchar *end,
               const gchar **before,
               const gchar **after)
{
  const gchar *a;
  const gchar *b;
  const gchar *c;
  const gchar *d;

  for (;;)
    {
      /* Look for start_marker to end_marker */
      a = memmem (data, strlen(data), start_marker, strlen (start_marker));
      if (a == NULL)
        return NULL;

      data = a + strlen (start_marker);
      b = data;

      c = memmem (data, strlen(data), end_marker, strlen (end_marker));
      if (c == NULL)
        return NULL;

      data = c + strlen (end_marker);
      d = data;

      /*
       * We've found a variable like this:
       *
       * Some text @@variable.part@@ trailing.
       *           a b            c d
       *
       * Check that the name makes sense.
       */
      if (b != c && b + strspn (b, VARCHARS) == c)
        break;
    }

  if (before)
    *before = a;
  if (after)
    *after = d;
  return g_strndup (b, c - b);
}

GList *
cockpit_template_expand (GBytes *input,
                         const gchar *start_marker,
                         const gchar *end_marker,
                         CockpitTemplateFunc func,
                         gpointer user_data)
{
  GList *output = NULL;
  const gchar *data;
  const gchar *end;
  const gchar *before;
  const gchar *after;
  GBytes *bytes;
  gchar *name;
  gboolean escaped;
  gint before_len;

  g_return_val_if_fail (func != NULL, NULL);

  data = g_bytes_get_data (input, NULL);
  end = data + g_bytes_get_size (input);

  for (;;)
    {
      escaped = FALSE;
      name = find_variable (start_marker, end_marker, data, end, &before, &after);
      if (name == NULL)
        break;

      if (before != data)
        {
          g_assert (before > data);

          /* Check if the char before the match is the escape char '/' */
          before_len = before - data;
          if (data[before_len - 1] == '\\')
            {
              escaped = TRUE;
              before_len--;
            }

          bytes = g_bytes_new_with_free_func (data, before_len,
                                              (GDestroyNotify)g_bytes_unref,
                                              g_bytes_ref (input));
          output = g_list_prepend (output, bytes);
        }

      if (!escaped)
        bytes = (func) (name, user_data);
      else
        bytes = NULL; // Set bytes to null so it's treated as skipped
      g_free (name);

      if (!bytes)
        {
          g_assert (after > before);
          bytes = g_bytes_new_with_free_func (before, after - before,
                                              (GDestroyNotify)g_bytes_unref,
                                              g_bytes_ref (input));
        }
      if (g_bytes_get_size (bytes) > 0)
        output = g_list_prepend (output, bytes);
      else
        g_bytes_unref (bytes);

      g_assert (after <= end);
      data = after;
    }

  if (data != end)
    {
      g_assert (end > data);
      bytes = g_bytes_new_with_free_func (data, end - data,
                                          (GDestroyNotify)g_bytes_unref,
                                          g_bytes_ref (input));
      output = g_list_prepend (output, bytes);
    }

  return g_list_reverse (output);
}

typedef struct
{
  const gchar         *start;
  const gchar         *end;
  CockpitTemplateFunc  func;
  gpointer             user_data;
} TemplateClosure;

static JsonNode *
template_walk_func (JsonNode *node,
                    gpointer  user_data)
{
  TemplateClosure *closure = user_data;
  const gchar *string = json_node_get_string (node);

  if (string == NULL)
    return NULL;

  if (strstr (string, closure->start) == NULL)
    return NULL;

  g_autoptr(GBytes) input = g_bytes_new_with_free_func (string, strlen (string),
                                                        (GDestroyNotify) json_node_unref,
                                                        json_node_ref (node));

  GList *output = cockpit_template_expand (input, closure->start, closure->end, closure->func, closure->user_data);

  g_autoptr(GString) result = g_string_new (NULL);
  while (output)
    {
      g_autoptr(GBytes) fragment = output->data;
      g_string_append_len (result, g_bytes_get_data (fragment, NULL), g_bytes_get_size (fragment));
      output = g_list_delete_link (output, output);
    }

  if (g_str_equal (result->str, string))
    return NULL;

  node = json_node_new (JSON_NODE_VALUE);
  json_node_set_string (node, result->str);

  return node;
}

JsonObject *
cockpit_template_expand_json (JsonObject *object,
                              const gchar *start_marker,
                              const gchar *end_marker,
                              CockpitTemplateFunc func,
                              gpointer user_data)
{
  TemplateClosure closure = { start_marker, end_marker, func, user_data };

  return cockpit_json_walk (object, template_walk_func, &closure);
}
