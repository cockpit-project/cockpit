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

int
main (int argc,
      char *argv[])
{
  cockpit_test_init (&argc, &argv);

  g_test_add_func ("/auth-options/basic", test_auth_options);

  return g_test_run ();
}
