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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

#include "config.h"

#include "common/cockpitconf.h"
#include "testlib/cockpittest.h"

#include "cockpitsshoptions.h"

/* Mock override these from other files */
extern const gchar *cockpit_config_file;

static void
test_ssh_options (void)
{
  gchar **env = NULL;
  CockpitSshOptions *options = NULL;

  options = cockpit_ssh_options_from_env (env);
  g_assert_cmpstr (options->remote_peer, ==, "localhost");
  g_assert_cmpstr (options->knownhosts_file, ==, NULL);
  g_assert_cmpstr (options->command, ==, "cockpit-bridge");

  options->knownhosts_file = "other-known";
  options->command = "other-command";
  options->remote_peer = "other";

  env = cockpit_ssh_options_to_env (options, NULL);

  g_assert_cmpstr (g_environ_getenv (env, "COCKPIT_SSH_CONNECT_TO_UNKNOWN_HOSTS"), ==, "");
  g_assert_cmpstr (g_environ_getenv (env, "COCKPIT_SSH_KNOWN_HOSTS_FILE"), ==, "other-known");
  g_assert_cmpstr (g_environ_getenv (env, "COCKPIT_SSH_BRIDGE_COMMAND"), ==, "other-command");
  g_assert_cmpstr (g_environ_getenv (env, "COCKPIT_REMOTE_PEER"), ==, "other");

  options->connect_to_unknown_hosts = TRUE;

  g_strfreev (env);
  env = cockpit_ssh_options_to_env (options, NULL);
  g_assert_cmpstr (g_environ_getenv (env, "COCKPIT_SSH_CONNECT_TO_UNKNOWN_HOSTS"), ==, "1");

  g_free (options);
  g_strfreev (env);

  /* Start with a clean env */
  env = g_environ_setenv (NULL, "COCKPIT_SSH_KNOWN_HOSTS_FILE", "other-known", TRUE);
  env = g_environ_setenv (env, "COCKPIT_SSH_BRIDGE_COMMAND", "other-command", TRUE);
  env = g_environ_setenv (env, "COCKPIT_SSH_CONNECT_TO_UNKNOWN_HOSTS", "", TRUE);

  options = cockpit_ssh_options_from_env (env);
  g_assert_false (options->connect_to_unknown_hosts);
  g_assert_cmpstr (options->knownhosts_file, ==, "other-known");
  g_assert_cmpstr (options->command, ==, "other-command");

  g_free (options);

  env = g_environ_setenv (env, "COCKPIT_SSH_CONNECT_TO_UNKNOWN_HOSTS", "bogus", TRUE);
  options = cockpit_ssh_options_from_env (env);
  g_assert_false (options->connect_to_unknown_hosts);
  g_free (options);

  env = g_environ_setenv (env, "COCKPIT_SSH_CONNECT_TO_UNKNOWN_HOSTS", "yes", TRUE);
  options = cockpit_ssh_options_from_env (env);
  g_assert_true (options->connect_to_unknown_hosts);
  g_free (options);

  env = g_environ_setenv (env, "COCKPIT_SSH_CONNECT_TO_UNKNOWN_HOSTS", "", TRUE);
  options = cockpit_ssh_options_from_env (env);
  g_assert_false (options->connect_to_unknown_hosts);
  g_free (options);
  g_strfreev (env);
}

static void
test_ssh_options_deprecated (void)
{
  gchar **env = NULL;
  CockpitSshOptions *options = NULL;

  env = g_environ_setenv (NULL, "COCKPIT_SSH_ALLOW_UNKNOWN", "yes", TRUE);
  options = cockpit_ssh_options_from_env (env);
  g_assert_true (options->connect_to_unknown_hosts);
  g_free (options);

  env = g_environ_setenv (env, "COCKPIT_SSH_KNOWN_HOSTS_DATA", "authorize", TRUE);
  options = cockpit_ssh_options_from_env (env);
  g_free (options);

  env = g_environ_setenv (env, "COCKPIT_SSH_KNOWN_HOSTS_DATA", "", TRUE);
  options = cockpit_ssh_options_from_env (env);
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
  g_assert_true (options->connect_to_unknown_hosts);
  g_free (options);
}

static void
test_ssh_options_conf_deprecated (void)
{
  CockpitSshOptions *options = NULL;

  cockpit_config_file = SRCDIR "/src/ws/mock-config/cockpit/cockpit-deprecated.conf";
  cockpit_conf_cleanup ();

  options = cockpit_ssh_options_from_env (NULL);
  g_assert_true (options->connect_to_unknown_hosts);
  g_free (options);
}

int
main (int argc,
      char *argv[])
{
  cockpit_test_init (&argc, &argv);

  g_test_add_func ("/ssh-options/basic", test_ssh_options);
  g_test_add_func ("/ssh-options/deprecated", test_ssh_options_deprecated);
  g_test_add_func ("/ssh-options/alt-conf", test_ssh_options_alt_conf);
  g_test_add_func ("/ssh-options/deprecated-conf", test_ssh_options_conf_deprecated);

  return g_test_run ();
}
