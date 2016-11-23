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

#include "config.h"

#include "common/cockpitconf.h"
#include "common/cockpittest.h"

#include "cockpitauthoptions.h"

/* Mock override these from other files */
extern const gchar *cockpit_config_file;

static void
test_auth_options (void)
{
  gchar **env = NULL;
  CockpitAuthOptions *options = NULL;

  options = cockpit_auth_options_from_env (env);
  g_assert_cmpstr (options->auth_type, ==, "none");
  g_assert_cmpstr (options->remote_peer, ==, "localhost");

  options->auth_type = "test";
  options->remote_peer = "other";

  env = cockpit_auth_options_to_env (options, NULL);

  g_assert_cmpstr (g_environ_getenv (env, "COCKPIT_REMOTE_PEER"), ==, "other");
  g_assert_cmpstr (g_environ_getenv (env, "COCKPIT_AUTH_MESSAGE_TYPE"), ==, "test");

  g_free (options);

  options = cockpit_auth_options_from_env (env);
  g_assert_cmpstr (options->auth_type, ==, "test");
  g_assert_cmpstr (options->remote_peer, ==, "other");

  g_free (options);
  g_strfreev (env);
}

static void
test_ssh_options (void)
{
  gchar **env = NULL;
  CockpitSshOptions *options = NULL;

  options = cockpit_ssh_options_from_env (env);
  g_assert_null (options->knownhosts_data);
  g_assert_null (options->krb5_ccache_name);
  g_assert_cmpstr (options->knownhosts_file, ==, PACKAGE_LOCALSTATE_DIR "/known_hosts");
  g_assert_cmpstr (options->command, ==, "cockpit-bridge");
  g_assert_false (options->allow_unknown_hosts);
  g_assert_false (options->supports_hostkey_prompt);
  g_assert_false (options->ignore_hostkey);
  g_assert_cmpuint (options->agent_fd, ==, 0);

  options->knownhosts_data = "";
  options->knownhosts_file = "other-known";
  options->command = "other-command";
  options->krb5_ccache_name = "";
  options->ignore_hostkey = TRUE;

  env = cockpit_ssh_options_to_env (options, NULL);

  g_assert_cmpstr (g_environ_getenv (env, "COCKPIT_SSH_ALLOW_UNKNOWN"), ==, "");
  g_assert_cmpstr (g_environ_getenv (env, "COCKPIT_SSH_KNOWN_HOSTS_FILE"), ==, "other-known");
  g_assert_cmpstr (g_environ_getenv (env, "COCKPIT_SSH_KNOWN_HOSTS_DATA"), ==, "*");
  g_assert_cmpstr (g_environ_getenv (env, "COCKPIT_SSH_BRIDGE_COMMAND"), ==, "other-command");
  g_assert_cmpstr (g_environ_getenv (env, "COCKPIT_SSH_SUPPORTS_HOST_KEY_PROMPT"), ==, "");
  g_assert_cmpstr (g_environ_getenv (env, "KRB5CCNAME"), ==, "");
  g_assert_null (g_environ_getenv (env, "SSH_AUTH_SOCK"));

  options->agent_fd = 5;
  options->krb5_ccache_name = "cache";
  options->allow_unknown_hosts = TRUE;
  options->supports_hostkey_prompt = TRUE;
  options->ignore_hostkey = FALSE;

  g_strfreev (env);
  env = cockpit_ssh_options_to_env (options, NULL);
  g_assert_cmpstr (g_environ_getenv (env, "COCKPIT_SSH_KNOWN_HOSTS_DATA"), ==, "* invalid key");
  g_assert_cmpstr (g_environ_getenv (env, "COCKPIT_SSH_ALLOW_UNKNOWN"), ==, "1");
  g_assert_cmpstr (g_environ_getenv (env, "COCKPIT_SSH_SUPPORTS_HOST_KEY_PROMPT"), ==, "1");
  g_assert_cmpstr (g_environ_getenv (env, "KRB5CCNAME"), ==, "cache");
  g_assert_cmpstr (g_environ_getenv (env, "SSH_AUTH_SOCK"), ==, "5");

  options->knownhosts_data = "key";
  g_strfreev (env);
  env = cockpit_ssh_options_to_env (options, NULL);
  g_assert_cmpstr (g_environ_getenv (env, "COCKPIT_SSH_KNOWN_HOSTS_DATA"), ==, "key");
  g_strfreev (env);
  g_free (options);

  /* Start with a clean env */
  env = g_environ_setenv (NULL, "SSH_AUTH_SOCK", "other", TRUE);
  env = g_environ_setenv (env, "COCKPIT_SSH_KNOWN_HOSTS_DATA", "*", TRUE);
  env = g_environ_setenv (env, "COCKPIT_SSH_KNOWN_HOSTS_FILE", "other-known", TRUE);
  env = g_environ_setenv (env, "COCKPIT_SSH_BRIDGE_COMMAND", "other-command", TRUE);
  env = g_environ_setenv (env, "COCKPIT_SSH_ALLOW_UNKNOWN", "", TRUE);
  env = g_environ_setenv (env, "COCKPIT_SSH_SUPPORTS_HOST_KEY_PROMPT", "", TRUE);
  env = g_environ_setenv (env, "KRB5CCNAME", "", TRUE);

  options = cockpit_ssh_options_from_env (env);
  g_assert_cmpuint (options->agent_fd, ==, 0);
  g_assert_true (options->ignore_hostkey);
  g_assert_cmpstr (options->knownhosts_data, ==, "*");
  g_assert_null (options->krb5_ccache_name);
  g_assert_false (options->supports_hostkey_prompt);
  g_assert_true (options->allow_unknown_hosts);
  g_assert_cmpstr (options->knownhosts_file, ==, "other-known");
  g_assert_cmpstr (options->command, ==, "other-command");

  g_free (options);
  g_strfreev (env);

  env = g_environ_setenv (NULL, "SSH_AUTH_SOCK", "5", TRUE);
  env = g_environ_setenv (env, "COCKPIT_SSH_KNOWN_HOSTS_DATA", "data", TRUE);
  env = g_environ_setenv (env, "COCKPIT_SSH_SUPPORTS_HOST_KEY_PROMPT", "1", TRUE);
  env = g_environ_setenv (env, "KRB5CCNAME", "cache", TRUE);
  options = cockpit_ssh_options_from_env (env);
  g_assert_cmpuint (options->agent_fd, ==, 5);
  g_assert_false (options->ignore_hostkey);
  g_assert_cmpstr (options->knownhosts_data, ==, "data");
  g_assert_cmpstr (options->krb5_ccache_name, ==, "cache");
  g_assert_true (options->supports_hostkey_prompt);
  g_assert_true (options->allow_unknown_hosts);
  g_free (options);
  g_strfreev (env);

  env = g_environ_setenv (NULL, "SSH_AUTH_SOCK", "5other", TRUE);
  env = g_environ_setenv (env, "COCKPIT_SSH_SUPPORTS_HOST_KEY_PROMPT", "key", TRUE);
  env = g_environ_setenv (env, "COCKPIT_SSH_ALLOW_UNKNOWN", "key", TRUE);
  options = cockpit_ssh_options_from_env (env);
  g_assert_cmpuint (options->agent_fd, ==, 0);
  g_assert_false (options->ignore_hostkey);
  g_assert_null (options->knownhosts_data);
  g_assert_false (options->supports_hostkey_prompt);
  g_assert_false (options->allow_unknown_hosts);
  g_free (options);
  g_strfreev (env);

  env = g_environ_setenv (NULL, "COCKPIT_SSH_ALLOW_UNKNOWN", "yes", TRUE);
  env = g_environ_setenv (env, "SSH_AUTH_SOCK", "5other", TRUE);
  options = cockpit_ssh_options_from_env (env);
  g_assert_cmpuint (options->agent_fd, ==, 0);
  g_assert_false (options->ignore_hostkey);
  g_assert_false (options->supports_hostkey_prompt);
  g_assert_true (options->allow_unknown_hosts);
  g_free (options);
  g_strfreev (env);

  env = g_environ_setenv (NULL, "COCKPIT_REMOTE_PEER", "127.0.0.1", TRUE);
  options = cockpit_ssh_options_from_env (env);
  g_assert_true (options->allow_unknown_hosts);
  g_free (options);
  g_strfreev (env);

  env = g_environ_setenv (NULL, "COCKPIT_REMOTE_PEER", "::1", TRUE);
  options = cockpit_ssh_options_from_env (env);
  g_assert_true (options->allow_unknown_hosts);
  g_free (options);
  g_strfreev (env);
}

static void
test_ssh_options_alt_conf (void)
{
  CockpitSshOptions *options = NULL;

  cockpit_config_file = SRCDIR "/src/ws/mock-config/cockpit/cockpit-alt.conf";
  cockpit_conf_cleanup ();

  options = cockpit_ssh_options_from_env (NULL);
  g_assert_true (options->allow_unknown_hosts);
  g_free (options);
}

int
main (int argc,
      char *argv[])
{
  cockpit_test_init (&argc, &argv);

  g_test_add_func ("/auth-options/auth-options", test_auth_options);
  g_test_add_func ("/auth-options/ssh-options", test_ssh_options);
  g_test_add_func ("/auth-options/ssh-options-alt-conf", test_ssh_options_alt_conf);

  return g_test_run ();
}
