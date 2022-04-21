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

#include "cockpitcpusamples.h"

#include <stdio.h>
#include <unistd.h>

#define CPU_CORE_MAXLEN 8

gint cockpit_cpu_user_hz = -1;

static gint
ensure_user_hz (void)
{
  if (cockpit_cpu_user_hz <= 0)
    {
      cockpit_cpu_user_hz = sysconf (_SC_CLK_TCK);
      if (cockpit_cpu_user_hz == -1 || cockpit_cpu_user_hz == 0)
        {
          g_warning ("sysconf (_SC_CLK_TCK) returned %d - forcing user_hz to 100", cockpit_cpu_user_hz);
          cockpit_cpu_user_hz = 100;
        }
    }
  return cockpit_cpu_user_hz;
}

/* TODO: this should be optimized so we don't allocate memory and call open()/close() all the time */

void
cockpit_cpu_samples (CockpitSamples *samples)
{
  gchar *contents = NULL;
  GError *error = NULL;
  gchar **lines = NULL;
  guint64 user_hz;
  gsize len;
  guint n;

  if (!g_file_get_contents ("/proc/stat", &contents, &len, &error))
    {
      g_message ("error loading contents /proc/stat: %s", error->message);
      g_error_free (error);
      goto out;
    }

  /* see 'man proc' for the format of /proc/stat */

  lines = g_strsplit (contents, "\n", -1);
  for (n = 0; lines != NULL && lines[n] != NULL; n++)
    {
      const gchar *line = lines[n];
      guint64 user;
      guint64 nice;
      guint64 system;
      guint64 idle;
      guint64 iowait;
      gchar cpu_core[CPU_CORE_MAXLEN + 1];

      if (!(g_str_has_prefix (line, "cpu")))
        continue;

      #define FMT64 "%" G_GUINT64_FORMAT " "
      if (sscanf (line, "%" G_STRINGIFY (CPU_CORE_MAXLEN) "s " FMT64 FMT64 FMT64 FMT64 FMT64,
                  cpu_core,
                  &user,
                  &nice,
                  &system,
                  &idle,
                  &iowait) != 6)
        {
          g_warning ("Error parsing line %d of /proc/stat with content `%s'", n, line);
          continue;
        }

      user_hz = ensure_user_hz ();
      if (strlen (cpu_core) > 3)
        {
          cockpit_samples_sample (samples, "cpu.core.nice", cpu_core + 3, nice*1000/user_hz);
          cockpit_samples_sample (samples, "cpu.core.user", cpu_core + 3, user*1000/user_hz);
          cockpit_samples_sample (samples, "cpu.core.system", cpu_core + 3, system*1000/user_hz);
          cockpit_samples_sample (samples, "cpu.core.iowait", cpu_core + 3, iowait*1000/user_hz);
        }
      else
        {
          cockpit_samples_sample (samples, "cpu.basic.nice", NULL, nice*1000/user_hz);
          cockpit_samples_sample (samples, "cpu.basic.user", NULL, user*1000/user_hz);
          cockpit_samples_sample (samples, "cpu.basic.system", NULL, system*1000/user_hz);
          cockpit_samples_sample (samples, "cpu.basic.iowait", NULL, iowait*1000/user_hz);
        }
    }

out:
  g_strfreev (lines);
  g_free (contents);
}
