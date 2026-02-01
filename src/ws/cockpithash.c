/*
 * Copyright (C) 2015 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#include "config.h"

/* This gets logged as part of the (more verbose) protocol logging */
#ifdef G_LOG_DOMAIN
#undef G_LOG_DOMAIN
#endif
#define G_LOG_DOMAIN "cockpit-protocol"

#include "cockpithash.h"

guint
cockpit_str_case_hash (gconstpointer v)
{
  /* A case agnostic version of g_str_hash */
  const signed char *p;
  guint32 h = 5381;
  for (p = v; *p != '\0'; p++)
    h = (h << 5) + h + g_ascii_tolower (*p);
  return h;
}

gboolean
cockpit_str_case_equal (gconstpointer v1,
                        gconstpointer v2)
{
  /* A case agnostic version of g_str_equal */
  return g_ascii_strcasecmp (v1, v2) == 0;
}
