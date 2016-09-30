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

#ifndef __COCKPIT_UNIX_FD_H__
#define __COCKPIT_UNIX_FD_H__

#include <glib.h>

G_BEGIN_DECLS

/* Backports of g_unix_fd_add() and friends */

typedef gboolean  (* CockpitUnixFdFunc)  (gint fd,
                                          GIOCondition cond,
                                          gpointer user_data);

guint       cockpit_unix_fd_add           (gint fd,
                                           GIOCondition condition,
                                           CockpitUnixFdFunc callback,
                                           gpointer user_data);

guint       cockpit_unix_fd_add_full      (gint priority,
                                           gint fd,
                                           GIOCondition condition,
                                           CockpitUnixFdFunc callback,
                                           gpointer user_data,
                                           GDestroyNotify notify);

GSource *   cockpit_unix_fd_source_new    (gint fd,
                                           GIOCondition condition);

int         cockpit_unix_fd_close_all     (int from,
                                           int except);

int         cockpit_unix_fd_close_until   (int from,
                                           int except,
                                           int until);

G_END_DECLS

#endif /* __COCKPIT_UNIX_FD_H__ */
