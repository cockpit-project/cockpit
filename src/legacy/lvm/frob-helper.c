/* -*- mode: C; c-file-style: "gnu"; indent-tabs-mode: nil; -*-
 *
 * Copyright (C) 2007-2010 David Zeuthen <david@fubar.dk>
 * Copyright (C) 2013-2014 Red Hat, Inc.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin St, Fifth Floor, Boston, MA  02110-1301  USA
 *
 */

#include "config.h"

#include <glib.h>

#include <stdio.h>
#include <stdlib.h>

int
main (int argc,
      char *argv[])
{
  gint ret;

  ret = 1;

  g_assert_cmpint (argc, ==, 2);
  switch (strtol (argv[1], NULL, 10))
    {
    case 0:
      g_print ("Hello Stdout\n"
               "Line 2\n");
      ret = 0;
      break;

    case 1:
      g_printerr ("Hello Stderr\n"
                  "Line 2\n");
      ret = 0;
      break;

    case 2:
      ret = 1;
      break;

    case 3:
      ret = 2;
      break;

    case 4:
      /* cause abnormal termination, segfault */
      g_print ("OK, deliberately causing a segfault\n");
      {
        const gchar **p = NULL;
        *p = "fail";
      }
      g_assert_not_reached ();
      break;

    case 5:
      /* abort */
      g_print ("OK, deliberately abort()'ing\n");
      abort ();
      g_assert_not_reached ();
      break;

    case 6:
      /* write binary output to stdout (including NUL bytes) */
      {
        guint n;
        for (n = 0; n < 100; n++)
          {
            g_assert_cmpint (fputc (n, stdout), !=, EOF);
            g_assert_cmpint (fputc (0, stdout), !=, EOF);
          }
        ret = 0;
      }
      break;

    case 7:
      /* read from stdin.. echo that back */
      {
        GString *s;
        gint c;

        s = g_string_new (NULL);
        while ((c = fgetc (stdin)) != EOF)
          g_string_append_c (s, c);
        g_print ("Woah, you said `%s', partner!\n", s->str);
        g_string_free (s, TRUE);
        ret = 0;
      }
      break;

    default:
      g_assert_not_reached ();
      break;
    }

  /* stderr is not buffered so force a flush */
  if (fflush (stdout) != 0)
    abort ();
  if (fflush (stderr) != 0)
    abort ();

  return ret;
}
