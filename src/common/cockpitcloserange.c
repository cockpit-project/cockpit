/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2021 Red Hat, Inc.
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

#include "cockpitcloserange.h"

#include <assert.h>
#include <dirent.h>
#include <err.h>
#include <errno.h>
#include <limits.h>
#include <stddef.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/resource.h>

int
cockpit_close_range (int from, int max_fd, int flags)
{
  /* we want to keep the API compatible to glibc's upcoming close_range(), but don't implement flags or upper bounds */
  assert (flags == 0);
  assert (max_fd == INT_MAX);

  DIR *d;

  if ((d = opendir ("/proc/self/fd"))) {
      struct dirent *de;

      while ((de = readdir (d))) {
          char *e;

          errno = 0;
          long l = strtol (de->d_name, &e, 10);
          if (errno != 0 || !e || *e)
              continue;

          int fd = (int) l;

          if ((long) fd != l)
              continue;

          if (fd == dirfd (d))
              continue;

          /* don't bother about error checking; On Linux, EINTR still closes the fd, and with EBADF we already have a closed fd */
          if (fd >= from)
            close (fd);
        }

      closedir (d);
      return 0;
  }

  /* If /proc is not mounted or not accessible we fall back to the old
   * rlimit trick */
  struct rlimit rl;
  int open_max;

  if (getrlimit (RLIMIT_NOFILE, &rl) == 0 && rl.rlim_max != RLIM_INFINITY)
      open_max = rl.rlim_max;
  else
      open_max = sysconf (_SC_OPEN_MAX);

  for (int fd = from; fd < open_max; fd++)
    close (fd);

  return 0;
}
