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

#include "cockpittemplate.h"

#include <glib.h>

#include <string.h>

#define VARCHARS "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._"

static gchar *
find_variable (const gchar *data,
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
      /* Look for @@xxxx@@ */
      a = memchr (data, '@', end - data);
      if (a == NULL)
        return NULL;
      data = a + 1;
      if (data[0] != '@')
        continue;
      data++;
      b = data;
      c = memchr (data, '@', end - data);
      if (c == NULL)
        return NULL;
      data = c + 1;
      if (data[0] != '@')
        continue;
      d = data + 1;

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

  g_return_val_if_fail (func != NULL, NULL);

  data = g_bytes_get_data (input, NULL);
  end = data + g_bytes_get_size (input);

  for (;;)
    {
      name = find_variable (data, end, &before, &after);
      if (name == NULL)
        break;

      if (before != data)
        {
          g_assert (before > data);
          bytes = g_bytes_new_with_free_func (data, before - data,
                                              (GDestroyNotify)g_bytes_unref,
                                              g_bytes_ref (input));
          output = g_list_prepend (output, bytes);
        }

      bytes = (func) (name, user_data);
      g_free (name);

      if (!bytes)
        {
          g_assert (after > before);
          bytes = g_bytes_new_with_free_func (before, after - before,
                                              (GDestroyNotify)g_bytes_unref,
                                              g_bytes_ref (input));
        }
      output = g_list_prepend (output, bytes);

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
