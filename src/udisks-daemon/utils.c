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

#include "utils.h"

/**
 * SECTION:utils
 * @title: Utilities
 * @short_description: Various utility routines
 *
 * Various utility routines.
 */

/**
 * utils_generate_object_path:
 * @base: The base object path (without trailing '/').
 * @s: A UTF-8 string.
 *
 * Appends @s to @base in a way such that only characters that can be
 * used in a D-Bus object path will be used. E.g. a character not in
 * <literal>[A-Z][a-z][0-9]_</literal> will be escaped as _HEX where
 * HEX is a two-digit hexadecimal number.
 *
 * Note that his mapping is not bijective - e.g. you cannot go back
 * to the original string.
 *
 * Returns: An allocated string that must be freed with g_free().
 */
gchar *
utils_generate_object_path (const gchar *base,
                            const gchar *s)
{
  guint n;
  GString *str;

  g_return_val_if_fail (g_variant_is_object_path (base), NULL);
  g_return_val_if_fail (g_utf8_validate (s, -1, NULL), NULL);

  str = g_string_new (base);
  g_string_append_c (str, '/');
  for (n = 0; s[n] != '\0'; n++)
    {
      gint c = s[n];
      /* D-Bus spec sez:
       *
       * Each element must only contain the ASCII characters "[A-Z][a-z][0-9]_"
       */
      if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_')
        {
          g_string_append_c (str, c);
        }
      else
        {
          /* Escape bytes not in [A-Z][a-z][0-9] as _<hex-with-two-digits> */
          g_string_append_printf (str, "_%02x", c & 0xFF);
        }
    }
  return g_string_free (str, FALSE);
}
