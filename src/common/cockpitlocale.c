/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
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

#include "cockpitlocale.h"
#include "common/cockpitsystem.h"

#include <locale.h>
#include <string.h>

gchar *
cockpit_locale_from_language (const gchar *value,
                              const gchar *encoding,
                              gchar **shorter)
{
  const gchar *spot;
  gchar *country = NULL;
  gchar *lang = NULL;
  gchar *result = NULL;
  const gchar *dot;

  if (value == NULL)
    value = "C";

  dot = ".";
  if (!encoding)
    dot = encoding = "";

  spot = strchr (value, '-');
  if (spot)
    {
      country = g_ascii_strup (spot + 1, -1);
      lang = g_ascii_strdown (value, spot - value);
      result = g_strconcat (lang, "_", country, dot, encoding, NULL);
      if (shorter)
        {
          *shorter = lang;
          lang = NULL;
        }
    }
  else
    {
      result = g_strconcat (value, dot, encoding, NULL);
      if (shorter)
        *shorter = g_strdup (value);
    }

  g_free (country);
  g_free (lang);
  return result;
}
