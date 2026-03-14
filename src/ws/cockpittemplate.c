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

#include "cockpittemplate.h"

#include "cockpitjson.h"

#include <glib.h>

#include <string.h>

#define IS_WORDCHAR(c) (g_ascii_isalnum (c) || (c) == '_')

static gchar *
find_variable (const gchar *data,
               const gchar *end,
               const gchar **before,
               const gchar **after)
{
  const gchar *a, *b, *c;

  g_return_val_if_fail (before != NULL, NULL);
  g_return_val_if_fail (after != NULL, NULL);
  g_return_val_if_fail (data <= end, NULL);

  while ((a = memmem (data, end - data, "${", 2)))
    {
      /*
       * Found "${". Scan for a valid variable name:
       *
       *   Some text ${variable_name} trailing.
       *             a b            c
       *
       * a = "${"
       * b = first char of variable name
       * c = should be '}'
       */
      b = a + 2;

      for (c = b; c < end && IS_WORDCHAR (*c); c++)
        ;

      if (b < c && c < end && *c == '}')
        {
          *before = a;
          *after = c + 1;
          return g_strndup (b, c - b);
        }

      data = c;
    }

  return NULL;
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
  gboolean escaped;
  gint before_len;

  g_return_val_if_fail (func != NULL, NULL);

  data = g_bytes_get_data (input, NULL);
  end = data + g_bytes_get_size (input);

  for (;;)
    {
      escaped = FALSE;
      name = find_variable (data, end, &before, &after);
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
