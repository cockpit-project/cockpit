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

static gchar*
read_file (const gchar *path)
{
  g_autoptr(GError) error = NULL;
  gchar *content = NULL;

  if (!g_file_get_contents (path, &content, NULL, &error))
    {
      // ENOENT is used to break loops, do not log it
      if (!g_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_NOENT))
          g_warning ("error reading file: %s", error->message);

      return NULL;
    }

  return content;
}

static void
sample_cpu_sensors (CockpitSamples *samples,
                    int hwmonID)
{
  for (int i = 1; TRUE; i++)
    {
      g_autofree gchar *temp = g_strdup_printf ("/sys/class/hwmon/hwmon%d/temp%d_input", hwmonID, i);
      g_autofree gchar *temp_content = read_file (temp);

      // end loop on error
      if (temp_content == NULL)
          break;

      gint64 temperature = g_ascii_strtoll (temp_content, NULL, 10);
      // overflow or invalid
      if (temperature == G_MAXINT64 || temperature == G_MININT64 || temperature == 0)
        {
          g_debug("Invalid number in %s: %m", temp);
          continue;
        }

      g_autofree gchar *label = g_strdup_printf ("/sys/class/hwmon/hwmon%d/temp%d_label", hwmonID, i);
      g_autofree gchar *label_content = read_file (label);

      if (label_content == NULL)
        {
          // labels aren't used on ARM
          label_content = g_strdup_printf ("Core %d", i);
        }

      g_strchomp (label_content);

      // ignore Tctl on AMD devices
      if (g_str_equal (label_content, "Tctl"))
          continue;

      g_autofree gchar *instance = g_strdup_printf ("hwmon%d %s", hwmonID, label_content);
      cockpit_samples_sample (samples, "cpu.temperature", instance, temperature/1000);
    }
}

void
cockpit_cpu_temperature (CockpitSamples *samples)
{
  // iterate through all hwmon folders to find CPU sensors
  for (int i = 0; TRUE; i++)
    {
      g_autofree gchar *path = g_strdup_printf ("/sys/class/hwmon/hwmon%d/name", i);
      g_autofree gchar *name = read_file (path);

      // end loop on error
      if (name == NULL)
          break;

      g_strchomp (name);

      // compare device name with CPU names
      // Intel: coretemp, AMD: k8temp or k10temp, ARM: cpu_thermal
      if (g_str_equal (name, "coretemp") || g_str_equal (name, "cpu_thermal") ||
          g_str_equal (name, "k8temp") || g_str_equal (name, "k10temp"))
        {
          // hwmon contains CPU info
          sample_cpu_sensors (samples, i);
        }
    }
}
