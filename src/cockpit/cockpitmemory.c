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

#include "cockpitmemory.h"

#include <string.h>

int      cockpit_secmem_drain = 0;

void
cockpit_secfree (gpointer data,
                 gssize len)
{
  volatile gchar *vp;

  if (!data)
    return;

  if (len < 0)
    len = strlen (data);

  /* Defeats some optimizations */
  memset (data, 0xAA, len);
  memset (data, 0xBB, len);

  /* Defeats others */
  vp = (volatile gchar *)data;
  while (len--)
    {
      cockpit_secmem_drain |= *vp;
      *(vp++) = 0xAA;
    }

  g_free (data);
}
