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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

#include "config.h"

#include "cockpitmemorysamples.h"

#include <stdio.h>

/* TODO: this should be optimized so we don't allocate memory and call open()/close() all the time */

void
cockpit_memory_samples (CockpitSamples *samples)
{
  gchar *contents = NULL;
  GError *error = NULL;
  gchar **lines = NULL;
  gsize len;
  guint n;

  guint64 free_kb = 0;
  guint64 total_kb = 0;
  guint64 buffers_kb = 0;
  guint64 cached_kb = 0;
  guint64 available_kb = 0;
  guint64 swap_total_kb = 0;
  guint64 swap_free_kb = 0;

  if (!g_file_get_contents ("/proc/meminfo", &contents, &len, &error))
    {
      g_message ("error loading contents /proc/meminfo: %s", error->message);
      g_error_free (error);
      goto out;
    }

  /* see 'man proc' for the format of /proc/stat */

  lines = g_strsplit (contents, "\n", -1);
  for (n = 0; lines != NULL && lines[n] != NULL; n++)
    {
      const gchar *line = lines[n];
      if (g_str_has_prefix (line, "MemTotal:"))
        g_warn_if_fail (sscanf (line + sizeof ("MemTotal:") - 1, "%" G_GUINT64_FORMAT, &total_kb) == 1);
      else if (g_str_has_prefix (line, "MemFree:"))
        g_warn_if_fail (sscanf (line + sizeof ("MemFree:") - 1, "%" G_GUINT64_FORMAT, &free_kb) == 1);
      else if (g_str_has_prefix (line, "SwapTotal:"))
        g_warn_if_fail (sscanf (line + sizeof ("SwapTotal:") - 1, "%" G_GUINT64_FORMAT, &swap_total_kb) == 1);
      else if (g_str_has_prefix (line, "SwapFree:"))
        g_warn_if_fail (sscanf (line + sizeof ("SwapFree:") - 1, "%" G_GUINT64_FORMAT, &swap_free_kb) == 1);
      else if (g_str_has_prefix (line, "Buffers:"))
        g_warn_if_fail (sscanf (line + sizeof ("Buffers:") - 1, "%" G_GUINT64_FORMAT, &buffers_kb) == 1);
      else if (g_str_has_prefix (line, "Cached:"))
        g_warn_if_fail (sscanf (line + sizeof ("Cached:") - 1, "%" G_GUINT64_FORMAT, &cached_kb) == 1);
      else if (g_str_has_prefix (line, "MemAvailable:"))
        g_warn_if_fail (sscanf (line + sizeof ("MemAvailable:") - 1, "%" G_GUINT64_FORMAT, &available_kb) == 1);

    }

  cockpit_samples_sample (samples, "memory.free", NULL, free_kb * 1024);
  cockpit_samples_sample (samples, "memory.used", NULL, (total_kb - available_kb) * 1024);
  cockpit_samples_sample (samples, "memory.cached", NULL, (buffers_kb + cached_kb) * 1024);
  cockpit_samples_sample (samples, "memory.swap-used", NULL, (swap_total_kb - swap_free_kb) * 1024);

out:
  g_strfreev (lines);
  g_free (contents);
}
