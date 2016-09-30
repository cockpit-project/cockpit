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

#include "cockpitunixfd.h"

#include <glib-unix.h>

#include <sys/resource.h>

#include <dirent.h>
#include <errno.h>
#include <stdlib.h>
#include <unistd.h>

typedef struct {
    GSource source;
    GPollFD pollfd;
    GIOCondition condition;
} CockpitUnixFdSource;

static gboolean
unix_fd_prepare (GSource *source,
                 gint *timeout)
{
  CockpitUnixFdSource *us = (CockpitUnixFdSource *)source;
  *timeout = -1;
  us->pollfd.revents = 0;
  return FALSE;
}

static gboolean
unix_fd_check (GSource *source)
{
  CockpitUnixFdSource *us = (CockpitUnixFdSource *)source;
  return ((us->condition & us->pollfd.revents) != 0);
}

static gboolean
unix_fd_dispatch (GSource *source,
                  GSourceFunc callback,
                  gpointer user_data)
{
  CockpitUnixFdFunc func = (CockpitUnixFdFunc)callback;
  CockpitUnixFdSource *us = (CockpitUnixFdSource *)source;

  return (* func) (us->pollfd.fd,
                   us->pollfd.revents & us->condition,
                   user_data);
}

static GSourceFuncs unix_fd_funcs = {
  unix_fd_prepare,
  unix_fd_check,
  unix_fd_dispatch,
};

GSource *
cockpit_unix_fd_source_new (gint fd,
                            GIOCondition condition)
{
  GSource *source;
  CockpitUnixFdSource *us;

  condition |= G_IO_HUP | G_IO_ERR | G_IO_NVAL;

  source = g_source_new (&unix_fd_funcs, sizeof (CockpitUnixFdSource));
  us = (CockpitUnixFdSource *)source;
  us->pollfd.fd = fd;
  us->condition = condition;
  us->pollfd.events = condition;
  us->pollfd.revents = 0;
  g_source_add_poll (source, &us->pollfd);

  return source;
}

guint
cockpit_unix_fd_add (gint fd,
                     GIOCondition condition,
                     CockpitUnixFdFunc callback,
                     gpointer user_data)
{
  return cockpit_unix_fd_add_full (G_PRIORITY_DEFAULT, fd,
                                   condition, callback, user_data, NULL);
}

guint
cockpit_unix_fd_add_full (gint priority,
                          gint fd,
                          GIOCondition condition,
                          GUnixFDSourceFunc function,
                          gpointer user_data,
                          GDestroyNotify notify)
{
  GSource *source;
  guint ret;

  source = cockpit_unix_fd_source_new (fd, condition);
  g_source_set_priority (source, priority);
  g_source_set_callback (source, (GSourceFunc)function, user_data, notify);
  ret = g_source_attach (source, NULL);
  g_source_unref (source);

  return ret;
}

typedef struct {
  int from;
  int except;
  int until;
} CloseAll;

static int
closefd (void *data,
         gint fd)
{
  CloseAll *ca = data;

  if (fd >= ca->from && fd != ca->except && fd < ca->until)
    {
      while (close (fd) < 0)
        {
          if (errno == EAGAIN || errno == EINTR)
            continue;
          if (errno == EBADF || errno == EINVAL)
            break;
          g_critical ("couldn't close fd in child process: %s", g_strerror (errno));
          return -1;
        }
    }

  return 0;
}

#ifndef HAVE_FDWALK
static int
fdwalk (int (*cb)(void *data, int fd), void *data)
{
  gint open_max;
  gint fd;
  gint res = 0;

  struct rlimit rl;

#ifdef __linux__
  DIR *d;

  if ((d = opendir("/proc/self/fd"))) {
      struct dirent *de;

      while ((de = readdir(d))) {
          glong l;
          gchar *e = NULL;

          if (de->d_name[0] == '.')
              continue;

          errno = 0;
          l = strtol(de->d_name, &e, 10);
          if (errno != 0 || !e || *e)
              continue;

          fd = (gint) l;

          if ((glong) fd != l)
              continue;

          if (fd == dirfd(d))
              continue;

          if ((res = cb (data, fd)) != 0)
              break;
        }

      closedir(d);
      return res;
  }

  /* If /proc is not mounted or not accessible we fall back to the old
   * rlimit trick */

#endif

  if (getrlimit(RLIMIT_NOFILE, &rl) == 0 && rl.rlim_max != RLIM_INFINITY)
      open_max = rl.rlim_max;
  else
      open_max = sysconf (_SC_OPEN_MAX);

  for (fd = 0; fd < open_max; fd++)
      if ((res = cb (data, fd)) != 0)
          break;

  return res;
}

#endif /* HAVE_FDWALK */

/**
 * cockpit_unix_fd_close_all:
 * @from: minimum FD to close, or -1
 * @except: an FD to leave open, or -1
 *
 * Close all open file descriptors starting from @from
 * and skipping @except.
 *
 * Will set errno if a failure happens.
 *
 * Returns: zero if successful, -1 if not
 */
int
cockpit_unix_fd_close_all (int from,
                           int except)
{
  CloseAll ca = { from, except, G_MAXINT };
  return fdwalk (closefd, &ca);
}

/**
 * cockpit_unix_fd_close_until:
 * @from: minimum FD to close, or -1
 * @except: an FD to leave open, or -1
 * @until: stop closing fds when this number is hit.
 *
 * Close all open file descriptors starting from @from
 * and skipping @except up to but not including @until.
 *
 * Will set errno if a failure happens.
 *
 * Returns: zero if successful, -1 if not
 */
int
cockpit_unix_fd_close_until (int from,
                             int except,
                             int until)
{
  CloseAll ca = { from, except, until };
  return fdwalk (closefd, &ca);
}
