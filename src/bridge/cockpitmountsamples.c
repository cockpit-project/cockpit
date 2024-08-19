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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

#include "config.h"

#include "cockpitmountsamples.h"

#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <math.h>
#include <fts.h>
#include <ctype.h>
#include <sys/statvfs.h>

void
cockpit_mount_samples (CockpitSamples *samples)
{
  gchar *contents = NULL;
  GError *error = NULL;
  gchar **lines = NULL;
  gchar *line;
  gchar *esc_dir, *dir;
  struct statvfs buf;
  gint64 total;
  gsize len;
  guint n;

  if (!g_file_get_contents ("/proc/mounts", &contents, &len, &error))
    {
      g_message ("error loading contents /proc/mounts: %s", error->message);
      g_error_free (error);
      goto out;
    }

  lines = g_strsplit (contents, "\n", -1);
  for (n = 0; lines != NULL && lines[n] != NULL; n++)
    {
      line = lines[n];

      if (strlen (line) == 0)
        continue;

      /* Only look at real devices
       */
      if (line[0] != '/')
        continue;

      while (*line && !isspace (*line))
        line++;
      while (*line && isspace (*line))
        line++;
      esc_dir = line;
      while (*line && !isspace (*line))
        line++;
      *line = '\0';

      dir = g_strcompress (esc_dir);

      if (statvfs (dir, &buf) >= 0)
        {
          // We explicitly store the fragment size as 64 bits so that
          // computations with it don't overflow on 32 bit
          // architectures.

          gint64 frsize = buf.f_frsize;
          total = frsize * buf.f_blocks;
          cockpit_samples_sample (samples, "mount.total", dir, total);
          cockpit_samples_sample (samples, "mount.used", dir, total - frsize * buf.f_bfree);
        }

      g_free (dir);
    }

 out:
  g_strfreev (lines);
  g_free (contents);
}
