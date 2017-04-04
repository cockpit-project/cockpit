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

#include "common/cockpitconf.h"

#include "cockpitauthoptions.h"

static gboolean
has_environment_val (gchar **env,
                     const gchar *name)
{
  const gchar *v = g_environ_getenv (env, name);
  return v != NULL && v[0] != '\0';
}

static const gchar *
get_environment_val (gchar **env,
                     const gchar *name,
                     const gchar *defawlt)
{
  if (has_environment_val (env, name))
    return g_environ_getenv (env, name);
  else
    return defawlt;
}

static gchar **
set_environment_val (gchar **env,
                     const gchar *name,
                     const gchar *val)
{
  return g_environ_setenv (env, name, val ? val : "", TRUE);
}

CockpitAuthOptions *
cockpit_auth_options_from_env (gchar **env)
{
  CockpitAuthOptions *options = g_new0 (CockpitAuthOptions, 1);
  options->auth_type = get_environment_val (env, "COCKPIT_AUTH_MESSAGE_TYPE", "none");
  options->remote_peer = get_environment_val (env, "COCKPIT_REMOTE_PEER", "localhost");
  return options;
}

gchar **
cockpit_auth_options_to_env (CockpitAuthOptions *options,
                             gchar **env)
{
  env = g_environ_setenv (env, "COCKPIT_AUTH_MESSAGE_TYPE",
                          options->auth_type ? options->auth_type : "none", TRUE);
  env = set_environment_val (env, "COCKPIT_REMOTE_PEER",
                             options->remote_peer);
  return env;
}
