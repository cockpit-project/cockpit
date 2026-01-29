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
