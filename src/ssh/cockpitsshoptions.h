/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
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

#ifndef __COCKPIT_SSH_OPTIONS_H__
#define __COCKPIT_SSH_OPTIONS_H__

#include <gio/gio.h>

G_BEGIN_DECLS

typedef struct {
  const gchar *knownhosts_data;
  const gchar *knownhosts_file;
  const gchar *command;
  const gchar *remote_peer;
  gboolean allow_unknown_hosts;
  gboolean ignore_hostkey;
  gboolean knownhosts_authorize;
} CockpitSshOptions;

CockpitSshOptions * cockpit_ssh_options_from_env   (gchar **env);

gchar **            cockpit_ssh_options_to_env     (CockpitSshOptions *options,
                                                    gchar **env);

const gchar *       cockpit_get_default_knownhosts  (void);

G_END_DECLS

#endif
