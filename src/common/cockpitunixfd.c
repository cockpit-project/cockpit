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
