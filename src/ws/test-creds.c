/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013 Red Hat, Inc.
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

#include "ws/cockpitcreds.h"

#include "cockpit/cockpittest.h"

static void
test_password (void)
{
  CockpitCreds *creds;

  creds = cockpit_creds_new ("user", COCKPIT_CRED_PASSWORD, "password", NULL);
  g_assert (creds != NULL);

  g_assert_cmpstr ("user", ==, cockpit_creds_get_user (creds));
  g_assert_cmpstr ("password", ==, cockpit_creds_get_password (creds));

  cockpit_creds_unref (creds);
}

static void
test_rhost (void)
{
  CockpitCreds *creds;

  creds = cockpit_creds_new ("user", COCKPIT_CRED_RHOST, "remote", NULL);
  g_assert (creds != NULL);

  g_assert_cmpstr ("user", ==, cockpit_creds_get_user (creds));
  g_assert_cmpstr ("remote", ==, cockpit_creds_get_rhost (creds));

  cockpit_creds_unref (creds);
}

static void
test_multiple (void)
{
  CockpitCreds *creds;

  creds = cockpit_creds_new ("user",
                             COCKPIT_CRED_PASSWORD, "password",
                             COCKPIT_CRED_RHOST, "remote",
                             NULL);
  g_assert (creds != NULL);

  g_assert_cmpstr ("user", ==, cockpit_creds_get_user (creds));
  g_assert_cmpstr ("remote", ==, cockpit_creds_get_rhost (creds));
  g_assert_cmpstr ("password", ==, cockpit_creds_get_password (creds));

  cockpit_creds_unref (creds);
}


int
main (int argc,
      char *argv[])
{
  cockpit_test_init (&argc, &argv);

  g_test_add_func ("/creds/basic-password", test_password);
  g_test_add_func ("/creds/rhost", test_rhost);
  g_test_add_func ("/creds/multiple", test_multiple);

  return g_test_run ();
}
