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

#include "cockpitsshoptions.h"

static const gchar *default_knownhosts = PACKAGE_SYSCONF_DIR "/ssh/ssh_known_hosts";
static const gchar *default_command = "cockpit-bridge";
static const gchar *ignore_hosts_data = "*";
static const gchar *authorize_knownhosts_data = "authorize";
static const gchar *hostkey_mismatch_data = "* invalid key";

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

static gboolean
get_environment_bool (gchar **env,
                      const gchar *name,
                      gboolean defawlt)
{
  const gchar *value = get_environment_val (env, name, NULL);

  if (!value)
    return defawlt;

  return g_strcmp0 (value, "yes") == 0 ||
         g_strcmp0 (value, "true") == 0 ||
         g_strcmp0 (value, "1") == 0;
}

static gchar **
set_environment_bool (gchar **env,
                      const gchar *name,
                      gboolean val)
{
  return g_environ_setenv (env, name, val ? "1" : "", TRUE);
}

static gboolean
get_allow_unknown_hosts (gchar **env)
{
  const gchar *remote_peer = g_environ_getenv (env, "COCKPIT_REMOTE_PEER");

  if (g_strcmp0 (remote_peer, "127.0.0.1") == 0 ||
      g_strcmp0 (remote_peer, "::1") == 0 ||
      cockpit_conf_bool (COCKPIT_CONF_SSH_SECTION, "allowUnknown", FALSE))
    return TRUE;

  return get_environment_bool (env, "COCKPIT_SSH_ALLOW_UNKNOWN", FALSE);
}

CockpitSshOptions *
cockpit_ssh_options_from_env (gchar **env)
{

  CockpitSshOptions *options = g_new0 (CockpitSshOptions, 1);
  options->knownhosts_data = get_environment_val (env, "COCKPIT_SSH_KNOWN_HOSTS_DATA",
                                                 NULL);
  if (g_strcmp0 (options->knownhosts_data, ignore_hosts_data) == 0)
    options->ignore_hostkey = TRUE;

  if (g_strcmp0 (options->knownhosts_data, authorize_knownhosts_data) == 0)
    options->knownhosts_authorize = TRUE;

  options->knownhosts_file = get_environment_val (env, "COCKPIT_SSH_KNOWN_HOSTS_FILE",
                                                  default_knownhosts);
  options->command = get_environment_val (env, "COCKPIT_SSH_BRIDGE_COMMAND", default_command);
  options->remote_peer = get_environment_val (env, "COCKPIT_REMOTE_PEER", "localhost");

  if (options->knownhosts_data != NULL && !options->knownhosts_authorize)
    options->allow_unknown_hosts = TRUE;
  else
    options->allow_unknown_hosts = get_allow_unknown_hosts (env);

  return options;
}

gchar **
cockpit_ssh_options_to_env (CockpitSshOptions *options,
                            gchar **env)
{
  const gchar *knownhosts_data;

  env = set_environment_bool (env, "COCKPIT_SSH_ALLOW_UNKNOWN",
                              options->allow_unknown_hosts);
  env = set_environment_val (env, "COCKPIT_SSH_KNOWN_HOSTS_FILE",
                             options->knownhosts_file);
  env = set_environment_val (env, "COCKPIT_REMOTE_PEER",
                             options->remote_peer);

  if (options->ignore_hostkey)
    knownhosts_data = ignore_hosts_data;
  else if (options->knownhosts_authorize)
    knownhosts_data = authorize_knownhosts_data;
  else if (options->knownhosts_data && options->knownhosts_data[0] == '\0')
    knownhosts_data = hostkey_mismatch_data;
  else
    knownhosts_data = options->knownhosts_data;

  env = set_environment_val (env, "COCKPIT_SSH_KNOWN_HOSTS_DATA",
                             knownhosts_data);

  /* Don't reset these vars unless we have values for them */
  if (options->command)
    {
      env = set_environment_val (env, "COCKPIT_SSH_BRIDGE_COMMAND",
                                 options->command);
    }

  return env;
}

const gchar *
cockpit_get_default_knownhosts (void)
{
  return default_knownhosts;
}
