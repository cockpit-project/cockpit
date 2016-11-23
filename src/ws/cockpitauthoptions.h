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

#ifndef __COCKPIT_AUTH_OPTIONS_H__
#define __COCKPIT_AUTH_OPTIONS_H__

#include <gio/gio.h>

#define SSH_SECTION "Ssh-Login"

G_BEGIN_DECLS

typedef struct {
  const gchar *remote_peer;
  const gchar *auth_type;
} CockpitAuthOptions;

CockpitAuthOptions * cockpit_auth_options_from_env  (gchar **env);

gchar **             cockpit_auth_options_to_env    (CockpitAuthOptions *options,
                                                     gchar **env);

typedef struct {
  const gchar *knownhosts_data;
  const gchar *knownhosts_file;
  const gchar *command;
  const gchar *krb5_ccache_name;
  gboolean allow_unknown_hosts;
  gboolean supports_hostkey_prompt;
  gboolean ignore_hostkey;
  guint agent_fd;
} CockpitSshOptions;

CockpitSshOptions * cockpit_ssh_options_from_env   (gchar **env);

gchar **             cockpit_ssh_options_to_env     (CockpitSshOptions *options,
                                                     gchar **env);

G_END_DECLS

#endif
