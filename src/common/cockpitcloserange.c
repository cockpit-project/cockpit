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
#include <stddef.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/resource.h>

typedef struct {
  int from;
  int until;
} CloseRange;

static int
closefd (void *data,
         int fd)
{
  CloseRange *ca = data;
  if (fd >= ca->from && fd <= ca->until)
    {
      while (close (fd) < 0)
        {
          if (errno == EAGAIN || errno == EINTR)
            continue;
          if (errno == EBADF || errno == EINVAL)
            break;
          warnx ("couldn't close fd: %m");
          return -1;
        }
    }

  return 0;
}

static int
fdwalk (int (*cb)(void *data, int fd),
        void *data)
{
  int open_max;
  int fd;
  int res = 0;

  struct rlimit rl;

#ifdef __linux__
  DIR *d;

  if ((d = opendir ("/proc/self/fd"))) {
      struct dirent *de;

      while ((de = readdir (d))) {
          long l;
          char *e = NULL;

          if (de->d_name[0] == '.')
              continue;

          errno = 0;
          l = strtol (de->d_name, &e, 10);
          if (errno != 0 || !e || *e)
              continue;

          fd = (int) l;

          if ((long) fd != l)
              continue;

          if (fd == dirfd (d))
              continue;

          if ((res = cb (data, fd)) != 0)
              break;
        }

      closedir (d);
      return res;
  }

  /* If /proc is not mounted or not accessible we fall back to the old
   * rlimit trick */

#endif

  if (getrlimit (RLIMIT_NOFILE, &rl) == 0 && rl.rlim_max != RLIM_INFINITY)
      open_max = rl.rlim_max;
  else
      open_max = sysconf (_SC_OPEN_MAX);

  for (fd = 0; fd < open_max; fd++)
      if ((res = cb (data, fd)) != 0)
          break;

  return res;
}

int
cockpit_close_range (int from, int max_fd, int flags)
{
  /* we want to keep the API compatible to glibc's upcoming close_range(), but don't implement flags */
  assert (flags == 0);
  CloseRange ca = { from, max_fd };
  return fdwalk (closefd, &ca);
}
