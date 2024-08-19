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

#include "cockpitcgroupsamples.h"

#include <errno.h>
#include <fcntl.h>
#include <fts.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

const char *cockpit_cgroupv1_memory_root = "/sys/fs/cgroup/memory";
const char *cockpit_cgroupv1_cpuacct_root = "/sys/fs/cgroup/cpuacct";
const char *cockpit_cgroupv2_root = "/sys/fs/cgroup";

static const char *
read_file (int dirfd,
           char *buf,
           size_t bufsize,
           const char *cgroup,
           const char *fname)
{
  const char *ret = NULL;

  const int fd = openat (dirfd, fname, O_RDONLY);
  if (fd < 0)
    {
      if (errno == ENOENT || errno == ENODEV)
        g_debug ("samples file not found: %s/%s", cgroup, fname);
      else
        g_message ("error opening file: %s/%s: %m", cgroup, fname);
      goto out;
    }

  /* don't do fancy retry/error handling here -- we know what cgroupfs attributes look like,
   * it's a virtual file system (does not block/no multiple reads), and it's ok to miss
   * one sample due to EINTR or some race condition */
  const ssize_t len = read (fd, buf, bufsize);
  if (len < 0)
    {
      if (errno == ENODEV) /* similar to error at open() */
        g_debug ("error loading file: %s/%s: %m", cgroup, fname);
      else
        g_message ("error loading file: %s/%s: %m", cgroup, fname);
      goto out;
    }
  /* we really expect a much smaller read; if we get a full buffer, there's likely
   * more data, and we are misinterpreting stuff */
  if (len >= bufsize)
    {
      g_warning ("cgroupfs value %s/%s is too large", cgroup, fname);
      goto out;
    }
  buf[len] = '\0';
  ret = buf;

out:
  if (fd >= 0)
    close (fd);
  return ret;
}


static gint64
read_int64 (int dirfd,
            const char *cgroup,
            const char *fname)
{
  char buf[30];
  const char *contents = read_file (dirfd, buf, sizeof buf, cgroup, fname);

  if (contents == NULL)
      return -1;
  /* no error checking; these often have values like "max" which we want to treat as "invalid/absent" */
  return atoll(contents);
}

static gint64
read_keyed_int64 (int dirfd,
                  const char *cgroup,
                  const char *fname,
                  const char *key)
{
  char buf[256];
  const char *contents = read_file (dirfd, buf, sizeof buf, cgroup, fname);
  const char *match;
  size_t key_len = strlen (key);
  char *endptr = NULL;
  gint64 result;

  if (contents == NULL)
      return -1;

  /* search for a word match of key */
  match = contents;
  for (;;)
    {
      match = strstr (match, key);
      if (match == NULL)
        return -1;
      /* either matches at start of string, or after a line break */
      if (match == contents || match[-1] == '\n')
        break;
      match += key_len;
    }

  result = strtoll (match + key_len, &endptr, 10);
  if (!endptr || (*endptr != '\0' && *endptr != '\n'))
    {
      g_warning ("cgroupfs file %s/%s value '%s' is an invalid number", cgroup, fname, contents);
      return -1;
    }
  return result;
}

static void
collect_memory_v1 (CockpitSamples *samples,
                   int dirfd,
                   const char *cgroup)
{
  gint64 val;

  val = read_int64 (dirfd, cgroup, "memory.usage_in_bytes");
  if (val > 0 && val < G_MAXINT64)
    cockpit_samples_sample (samples, "cgroup.memory.usage", cgroup, val);

  val = read_int64 (dirfd, cgroup, "memory.limit_in_bytes");
  /* If at max for arch, then unlimited => zero */
  if (val > 0 && val < G_MAXINT64)
    cockpit_samples_sample (samples, "cgroup.memory.limit", cgroup, val);

  val = read_int64 (dirfd, cgroup, "memory.memsw.usage_in_bytes");
  if (val >= 0 && val < G_MAXINT64)
      cockpit_samples_sample (samples, "cgroup.memory.sw-usage", cgroup, val);

  val = read_int64 (dirfd, cgroup, "memory.memsw.limit_in_bytes");
  /* If at max for arch, then unlimited => zero */
  if (val > 0 && val < G_MAXINT64)
      cockpit_samples_sample (samples, "cgroup.memory.sw-limit", cgroup, val);
}

static void
collect_cpu_v1 (CockpitSamples *samples,
                int dirfd,
                const char *cgroup)
{
  gint64 val;

  val = read_int64 (dirfd, cgroup, "cpuacct.usage");
  if (val >= 0 && val < G_MAXINT64)
    cockpit_samples_sample (samples, "cgroup.cpu.usage", cgroup, val/1000000);

  val = read_int64 (dirfd, cgroup, "cpu.shares");
  if (val > 0 && val < G_MAXINT64)
    cockpit_samples_sample (samples, "cgroup.cpu.shares", cgroup, val);
}

static void
collect_v2 (CockpitSamples *samples,
            int dirfd,
            const char *cgroup)
{
  gint64 val;

  /* memory.current: single unsigned value in bytes */
  val = read_int64 (dirfd, cgroup, "memory.current");
  if (val >= 0 && val < G_MAXINT64)
    cockpit_samples_sample (samples, "cgroup.memory.usage", cgroup, val);

  /* memory.max: literally says "max" if there is no limit set, which ends up as "0" after integer conversion;
   * only create samples for actually limited cgroups */
  val = read_int64 (dirfd, cgroup, "memory.max");
  if (val > 0 && val < G_MAXINT64)
    cockpit_samples_sample (samples, "cgroup.memory.limit", cgroup, val);

  /* same as above for swap */
  val = read_int64 (dirfd, cgroup, "memory.swap.current");
  if (val >= 0 && val < G_MAXINT64)
    cockpit_samples_sample (samples, "cgroup.memory.sw-usage", cgroup, val);

  val = read_int64 (dirfd, cgroup, "memory.swap.max");
  if (val > 0 && val < G_MAXINT64)
    cockpit_samples_sample (samples, "cgroup.memory.sw-limit", cgroup, val);

  /* cpu.weight: only exists if cpu controller is enabled; integer in range [1, 10000] */
  val = read_int64 (dirfd, cgroup, "cpu.weight");
  if (val > 0 && val < G_MAXINT64)
    cockpit_samples_sample (samples, "cgroup.cpu.shares", cgroup, val);

  /* cpu.stat: keyed file:
     usage_usec 50000
     user_usec 40000
     system_usec 10000
     */
  val = read_keyed_int64 (dirfd, cgroup, "cpu.stat", "usage_usec ");
  if (val >= 0 && val < G_MAXINT64)
    cockpit_samples_sample (samples, "cgroup.cpu.usage", cgroup, val/1000);
}

static void
notice_cgroups_in_hierarchy (CockpitSamples *samples,
                             const char *root_dir,
                             void (* collect) (CockpitSamples *, int, const char *))
{
  const char *paths[] = { root_dir, NULL };
  gsize root_dir_len = strlen (root_dir);
  FTSENT *ent;
  FTS *fs;

  fs = fts_open ((char **)paths, FTS_NOCHDIR | FTS_COMFOLLOW, NULL);
  if (fs)
    {
      while((ent = fts_read (fs)) != NULL)
        {
          if (ent->fts_info == FTS_D)
            {
              const char *f = ent->fts_path + root_dir_len;
              int dfd;

              if (*f == '/')
                f++;
              dfd = open (ent->fts_path, O_PATH | O_DIRECTORY);
              if (dfd >= 0)
                {
                  collect (samples, dfd, f);
                  close (dfd);
                }
              else if (errno != ENOENT)
                {
                  g_message ("error opening cgroup directory: %s: %m", ent->fts_path);
                }
            }
        }
      fts_close (fs);
    }
}


void
cockpit_cgroup_samples (CockpitSamples *samples)
{
  static int cgroup_ver = 0; /* 0: uninitialized */

  /* do we have cgroupv2? initialize this just once */
  if (cgroup_ver == 0)
    {
      cgroup_ver = (access ("/sys/fs/cgroup/cgroup.controllers", F_OK) == 0) ? 2 : 1;
      g_debug ("cgroup samples: detected cgroup version: %i", cgroup_ver);
    }

  if (cgroup_ver == 2)
    {
      /* For cgroupv2, the groups are directly in /sys/fs/cgroup/<name>/.../.
         Inside, we are looking for files "memory.current" or "cpu.stat".
      */
      notice_cgroups_in_hierarchy (samples, cockpit_cgroupv2_root, collect_v2);
    }
  else
    {
      /* For cgroupv1, we are looking for files like

         /sys/fs/cgroup/memory/.../memory.usage_in_bytes
         /sys/fs/cgroup/memory/.../memory.limit_in_bytes
         /sys/fs/cgroup/cpuacct/.../cpuacct.usage
      */
      notice_cgroups_in_hierarchy (samples, cockpit_cgroupv1_memory_root, collect_memory_v1);
      notice_cgroups_in_hierarchy (samples, cockpit_cgroupv1_cpuacct_root, collect_cpu_v1);
    }
}
