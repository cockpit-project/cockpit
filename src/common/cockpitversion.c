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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

#include "config.h"

#include "cockpitversion.h"

#include <stdlib.h>
#include <string.h>

gint
cockpit_version_compare (const gchar *one,
                         const gchar *two)
{
  gchar **p1 = g_strsplit (one, ".", -1);
  gchar **p2 = g_strsplit (two, ".", -1);
  gchar *e1, *e2;
  gulong v1, v2;
  gint ret = 0;
  gint i = 0;

  while (p1[i] != NULL && p2[i] != NULL)
    {
      e1 = e2 = NULL;
      v1 = strtoul (p1[i], &e1, 10);
      v2 = strtoul (p2[i], &e2, 10);

      /* Compare as numbers */
      if (e1 && e1[0] == '\0' && e2 && e2[0] == '\0')
        {
          if (v1 < v2)
            {
              ret = -1;
              break;
            }
          else if (v1 > v2)
            {
              ret = 1;
              break;
            }
        }
      else
        {
          ret = strcmp (p1[i], p2[i]);
          if (ret != 0)
            break;
        }

      i++;
    }

  if (p1[i] && !p2[i])
    ret = 1;
  else if (!p1[i] && p2[i])
    ret = -1;

  g_strfreev (p1);
  g_strfreev (p2);
  return ret;
}
