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

#include "cockpithex.h"

#include <string.h>

gpointer
cockpit_hex_decode (const gchar *hex,
                    gsize *length)
{
  static const char HEX[] = "0123456789abcdef";
  const gchar *hpos;
  const gchar *lpos;
  gsize len;
  gchar *out;
  gint i;

  len = strlen (hex);
  if (len % 2 != 0)
    return NULL;

  out = g_malloc (len * 2 + 1);
  for (i = 0; i < len / 2; i++)
    {
      hpos = strchr (HEX, hex[i * 2]);
      lpos = strchr (HEX, hex[i * 2 + 1]);
      if (hpos == NULL || lpos == NULL)
        {
          g_free (out);
          return NULL;
        }
      out[i] = ((hpos - HEX) << 4) | ((lpos - HEX) & 0xf);
    }

  /* A convenience null termination */
  out[i] = '\0';

  if (length)
    *length = i;
  return out;
}
