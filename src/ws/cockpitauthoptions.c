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

static const gchar *default_knownhosts = PACKAGE_LOCALSTATE_DIR "/known_hosts";
static const gchar *default_command = "cockpit-bridge";
static const gchar *ignore_hosts_data = "*";
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

static guint
get_agent_fd (gchar **env)
{
  const gchar *socket;
  gchar *endptr = NULL;
  guint agent_fd = 0;
  socket = g_environ_getenv (env, "SSH_AUTH_SOCK");

  if (socket)
    agent_fd = g_ascii_strtoull (socket, &endptr, 10);

  if (agent_fd > 3 && agent_fd < G_MAXINT &&
      (endptr == NULL || endptr[0] == '\0'))
    return agent_fd;

  return 0;
}

static gboolean
get_allow_unknown_hosts (gchar **env)
{
  const gchar *remote_peer = g_environ_getenv (env, "COCKPIT_REMOTE_PEER");

  if (g_strcmp0 (remote_peer, "127.0.0.1") == 0 ||
      g_strcmp0 (remote_peer, "::1") == 0 ||
      cockpit_conf_bool (SSH_SECTION, "allowUnknown", FALSE))
    return TRUE;

  return get_environment_bool (env, "COCKPIT_SSH_ALLOW_UNKNOWN", FALSE);
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

CockpitSshOptions *
cockpit_ssh_options_from_env (gchar **env)
{

  CockpitSshOptions *options = g_new0 (CockpitSshOptions, 1);
  options->knownhosts_data = get_environment_val (env, "COCKPIT_SSH_KNOWN_HOSTS_DATA",
                                                 NULL);
  if (g_strcmp0 (options->knownhosts_data, ignore_hosts_data) == 0)
    options->ignore_hostkey = TRUE;

  options->knownhosts_file = get_environment_val (env, "COCKPIT_SSH_KNOWN_HOSTS_FILE",
                                                  default_knownhosts);
  options->command = get_environment_val (env, "COCKPIT_SSH_BRIDGE_COMMAND", default_command);
  options->krb5_ccache_name = get_environment_val (env, "KRB5CCNAME", NULL);
  options->supports_hostkey_prompt = get_environment_bool (env, "COCKPIT_SSH_SUPPORTS_HOST_KEY_PROMPT", FALSE);
  options->agent_fd = get_agent_fd (env);

  if (options->knownhosts_data != NULL)
    options->allow_unknown_hosts = TRUE;
  else
    options->allow_unknown_hosts = get_allow_unknown_hosts (env);

  return options;
}

gchar **
cockpit_ssh_options_to_env (CockpitSshOptions *options,
                            gchar **env)
{
  gchar *agent = NULL;
  const gchar *knownhosts_data;

  env = set_environment_bool (env, "COCKPIT_SSH_ALLOW_UNKNOWN",
                              options->allow_unknown_hosts);
  env = set_environment_bool (env, "COCKPIT_SSH_SUPPORTS_HOST_KEY_PROMPT",
                              options->supports_hostkey_prompt);
  env = set_environment_val (env, "COCKPIT_SSH_KNOWN_HOSTS_FILE",
                             options->knownhosts_file);

  if (options->ignore_hostkey)
    knownhosts_data = ignore_hosts_data;
  else if (options->knownhosts_data && options->knownhosts_data[0] == '\0')
    knownhosts_data = hostkey_mismatch_data;
  else
    knownhosts_data = options->knownhosts_data;

  env = set_environment_val (env, "COCKPIT_SSH_KNOWN_HOSTS_DATA",
                             knownhosts_data);
  env = set_environment_val (env, "KRB5CCNAME", options->krb5_ccache_name);

  /* Don't reset these vars unless we have values for them */
  if (options->command)
    {
      env = set_environment_val (env, "COCKPIT_SSH_BRIDGE_COMMAND",
                                 options->command);
    }

  if (options->agent_fd)
    {
      agent = g_strdup_printf ("%d", options->agent_fd);
      env = g_environ_setenv (env, "SSH_AUTH_SOCK", agent, TRUE);
    }

  g_free (agent);
  return env;
}
