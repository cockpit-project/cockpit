/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
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

#include "cockpitunicode.h"

gboolean
cockpit_unicode_has_incomplete_ending (GBytes *input)
{
  const gchar *data;
  const gchar *end;
  gsize length;

  data = g_bytes_get_data (input, &length);
  if (g_utf8_validate (data, length, &end))
    return FALSE;

  do
    {
      length -= (end - data) + 1;
      data = end + 1;
    }
  while (!g_utf8_validate (data, length, &end));

  return length == 0;
}

GBytes *
cockpit_unicode_force_utf8 (GBytes *input)
{
  const gchar *data;
  const gchar *end;
  gsize length;
  GString *string;

  data = g_bytes_get_data (input, &length);
  if (g_utf8_validate (data, length, &end))
    return g_bytes_ref (input);

  string = g_string_sized_new (length + 16);
  do
    {
      /* Valid part of the string */
      g_string_append_len (string, data, end - data);

      /* Replacement character */
      g_string_append (string, "\xef\xbf\xbd");

      length -= (end - data) + 1;
      data = end + 1;
    }
  while (!g_utf8_validate (data, length, &end));

  if (length)
    g_string_append_len (string, data, length);

  return g_string_free_to_bytes (string);
}

