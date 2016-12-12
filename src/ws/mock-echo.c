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

#include <glib.h>

#include <errno.h>
#include <stdlib.h>
#include <unistd.h>

int
main (void)
{
  /* Small buffer to find partial read/write bugs */
  gchar buffer[sizeof (gint) - 1];
  gsize written;
  gssize count;
  gint i;

  g_print ("37\n\n{ \"command\" : \"init\", \"version\": 1 }");
  for (i = 0; TRUE; i++)
    {
      count = read (0, buffer, sizeof (buffer));
      if (count < 0)
        {
          g_printerr ("mock-echo: failed to read: %s", g_strerror (errno));
          return 1;
        }
      if (count == 0)
        return 0;

      written = 0;
      while (written < count)
        {
          count = write (1, buffer + written, count - written);
          if (count < 0)
            {
              if (errno != EAGAIN)
                {
                  g_printerr ("mock-echo: failed to write: %s", g_strerror (errno));
                  return 1;
                }
            }
          written += count;
        }

      /* Slow short reads and writes for the first, 10 and then accelerate */
      if (i < 3)
        g_usleep (G_USEC_PER_SEC / 10);
      else if (i < 30)
        g_usleep (G_USEC_PER_SEC / 100);
    }
}
