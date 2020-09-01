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

#include "cockpitcgroupsamples.h"

#include <fts.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

const gchar *cockpit_cgroup_memory_root = "/sys/fs/cgroup/memory";
const gchar *cockpit_cgroup_cpuacct_root = "/sys/fs/cgroup/cpuacct";

static gint64
read_int64 (const gchar *prefix,
            const gchar *suffix)
{
  g_autofree gchar *path = NULL;
  g_autofree gchar *file_contents = NULL;
  g_autoptr(GError) error = NULL;
  gint64 ret;
  gsize len;

  path = g_build_filename (prefix, suffix, NULL);
  if (!g_file_get_contents (path, &file_contents, &len, &error))
    {
      if (g_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_NOENT) ||
          g_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_NODEV))
        g_debug ("samples file not found: %s", path);
      else
        g_message ("error loading file: %s: %s", path, error->message);
      ret = -1;
    }
  else
    {
      ret = g_ascii_strtoll (file_contents, NULL, 10);
    }

  return ret;
}

static void
collect_memory (CockpitSamples *samples,
                const gchar *path,
                const gchar *cgroup)
{
  gint64 mem_usage_in_bytes;
  gint64 mem_limit_in_bytes;
  gint64 memsw_usage_in_bytes;
  gint64 memsw_limit_in_bytes;

  if (access (path, F_OK) == 0)
    {
      mem_usage_in_bytes = read_int64 (path, "memory.usage_in_bytes");
      mem_limit_in_bytes = read_int64 (path, "memory.limit_in_bytes");
      memsw_usage_in_bytes = read_int64 (path, "memory.memsw.usage_in_bytes");
      memsw_limit_in_bytes = read_int64 (path, "memory.memsw.limit_in_bytes");

      /* If at max for arch, then unlimited => zero */
      if (mem_limit_in_bytes == G_MAXINT64)
        mem_limit_in_bytes = 0;
      if (memsw_limit_in_bytes == G_MAXINT64)
        memsw_limit_in_bytes = 0;

      cockpit_samples_sample (samples, "cgroup.memory.usage", cgroup, mem_usage_in_bytes);
      cockpit_samples_sample (samples, "cgroup.memory.limit", cgroup, mem_limit_in_bytes);
      cockpit_samples_sample (samples, "cgroup.memory.sw-usage", cgroup, memsw_usage_in_bytes);
      cockpit_samples_sample (samples, "cgroup.memory.sw-limit", cgroup, memsw_limit_in_bytes);
    }
}

static void
collect_cpu (CockpitSamples *samples,
             const gchar *path,
             const gchar *cgroup)
{
  gint64 cpuacct_usage;
  gint64 cpu_shares;

  if (access (path, F_OK) == 0)
    {
      cpuacct_usage = read_int64 (path, "cpuacct.usage");
      cpu_shares = read_int64 (path, "cpu.shares");

      cockpit_samples_sample (samples, "cgroup.cpu.usage", cgroup, cpuacct_usage/1000000);
      cockpit_samples_sample (samples, "cgroup.cpu.shares", cgroup, cpu_shares);
    }
}

static void
notice_cgroups_in_hierarchy (CockpitSamples *samples,
                             const gchar *prefix,
                             void (* collect) (CockpitSamples *, const gchar *, const gchar *))
{
  const gchar *paths[] = { prefix, NULL };
  gsize prefix_len;
  FTSENT *ent;
  FTS *fs;

  prefix_len = strlen (prefix);

  fs = fts_open ((gchar **)paths, FTS_NOCHDIR | FTS_COMFOLLOW, NULL);
  if (fs)
    {
      while((ent = fts_read (fs)) != NULL)
        {
          if (ent->fts_info == FTS_D)
            {
              const char *f = ent->fts_path + prefix_len;
              if (*f == '/')
                f++;
              collect (samples, ent->fts_path, f);
            }
        }
      fts_close (fs);
    }
}


void
cockpit_cgroup_samples (CockpitSamples *samples)
{
  /* We are looking for files like

     /sys/fs/cgroup/memory/.../memory.usage_in_bytes
     /sys/fs/cgroup/memory/.../memory.limit_in_bytes
     /sys/fs/cgroup/cpuacct/.../cpuacct.usage
  */

  notice_cgroups_in_hierarchy (samples, cockpit_cgroup_memory_root, collect_memory);
  notice_cgroups_in_hierarchy (samples, cockpit_cgroup_cpuacct_root, collect_cpu);
}
