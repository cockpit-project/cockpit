/*
 * Copyright (C) 2016 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#include "config.h"

/* This gets logged as part of the (more verbose) protocol logging */
#ifdef G_LOG_DOMAIN
#undef G_LOG_DOMAIN
#endif
#define G_LOG_DOMAIN "cockpit-protocol"

#include "cockpitlocale.h"
#include "cockpitsystem.h"

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
