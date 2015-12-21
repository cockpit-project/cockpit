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

#include "common/cockpittest.h"

static void
test_password (void)
{
  CockpitCreds *creds;

  creds = cockpit_creds_new ("user", "test", COCKPIT_CRED_PASSWORD, "password", NULL);
  g_assert (creds != NULL);

  g_assert_cmpstr ("user", ==, cockpit_creds_get_user (creds));
  g_assert_cmpstr ("password", ==, cockpit_creds_get_password (creds));
  g_assert_cmpstr ("test", ==, cockpit_creds_get_application (creds));

  cockpit_creds_unref (creds);
}

static void
test_gssapi (void)
{
  CockpitCreds *creds;

  creds = cockpit_creds_new ("user", "test", COCKPIT_CRED_PASSWORD, "password", NULL);
  g_assert (creds != NULL);

  g_assert_false (cockpit_creds_has_gssapi (creds));

  cockpit_creds_unref (creds);

  creds = cockpit_creds_new ("user", "test", COCKPIT_CRED_GSSAPI, "bad-but-present", NULL);
  g_assert (creds != NULL);

  g_assert_true (cockpit_creds_has_gssapi (creds));

  cockpit_creds_unref (creds);

}

static void
test_poison (void)
{
  CockpitCreds *creds;

  creds = cockpit_creds_new ("user", "app", COCKPIT_CRED_PASSWORD, "password", NULL);
  g_assert (creds != NULL);

  g_assert_cmpstr ("user", ==, cockpit_creds_get_user (creds));
  g_assert_cmpstr ("password", ==, cockpit_creds_get_password (creds));
  g_assert_cmpstr ("app", ==, cockpit_creds_get_application (creds));

  cockpit_creds_poison (creds);

  g_assert_cmpstr (NULL, ==, cockpit_creds_get_password (creds));

  cockpit_creds_unref (creds);
}

static void
test_rhost (void)
{
  CockpitCreds *creds;

  creds = cockpit_creds_new ("user", "app", COCKPIT_CRED_RHOST, "remote", NULL);
  g_assert (creds != NULL);

  g_assert_cmpstr ("user", ==, cockpit_creds_get_user (creds));
  g_assert_cmpstr ("remote", ==, cockpit_creds_get_rhost (creds));
  g_assert_cmpstr ("app", ==, cockpit_creds_get_application (creds));

  cockpit_creds_unref (creds);
}

static void
test_multiple (void)
{
  CockpitCreds *creds;

  creds = cockpit_creds_new ("user", "app",
                             COCKPIT_CRED_PASSWORD, "password",
                             COCKPIT_CRED_RHOST, "remote",
                             NULL);
  g_assert (creds != NULL);

  g_assert_cmpstr ("user", ==, cockpit_creds_get_user (creds));
  g_assert_cmpstr ("remote", ==, cockpit_creds_get_rhost (creds));
  g_assert_cmpstr ("password", ==, cockpit_creds_get_password (creds));
  g_assert_cmpstr ("app", ==, cockpit_creds_get_application (creds));

  cockpit_creds_unref (creds);
}

static void
test_hash (void)
{
  CockpitCreds *one = cockpit_creds_new ("user", "app", COCKPIT_CRED_PASSWORD, "pass1", NULL);
  CockpitCreds *rhost = cockpit_creds_new ("user", "app", COCKPIT_CRED_PASSWORD, "pass1",
                                           COCKPIT_CRED_RHOST, "meh", NULL);
  CockpitCreds *app = cockpit_creds_new ("user", "app2", COCKPIT_CRED_PASSWORD, "pass1", NULL);
  CockpitCreds *copy = cockpit_creds_new ("user", "app", COCKPIT_CRED_PASSWORD, "pass1", NULL);

  g_assert_cmpuint (cockpit_creds_hash (one), !=, cockpit_creds_hash (rhost));
  g_assert_cmpuint (cockpit_creds_hash (one), !=, cockpit_creds_hash (app));
  g_assert_cmpuint (cockpit_creds_hash (one), ==, cockpit_creds_hash (one));
  g_assert_cmpuint (cockpit_creds_hash (one), ==, cockpit_creds_hash (copy));

  cockpit_creds_unref (one);
  cockpit_creds_unref (rhost);
  cockpit_creds_unref (copy);
  cockpit_creds_unref (app);
}

static void
test_equal (void)
{
  CockpitCreds *one = cockpit_creds_new ("user", "app", COCKPIT_CRED_PASSWORD, "pass1", NULL);
  CockpitCreds *rhost = cockpit_creds_new ("user", "app", COCKPIT_CRED_PASSWORD, "pass1",
                                           COCKPIT_CRED_RHOST, "meh", NULL);
  CockpitCreds *app = cockpit_creds_new ("user", "app2", COCKPIT_CRED_PASSWORD, "pass1", NULL);
  CockpitCreds *scruffy = cockpit_creds_new ("scruffy", "app", COCKPIT_CRED_PASSWORD, "pass1", NULL);
  CockpitCreds *two = cockpit_creds_new ("user2", "app", COCKPIT_CRED_PASSWORD, "pass2", NULL);
  CockpitCreds *copy = cockpit_creds_new ("user", "app", COCKPIT_CRED_PASSWORD, "pass1", NULL);

  g_assert (!cockpit_creds_equal (one, two));
  g_assert (cockpit_creds_equal (one, one));
  g_assert (cockpit_creds_equal (one, copy));
  g_assert (!cockpit_creds_equal (one, rhost));
  g_assert (!cockpit_creds_equal (one, app));
  g_assert (!cockpit_creds_equal (one, scruffy));
  g_assert (!cockpit_creds_equal (rhost, scruffy));
  g_assert (!cockpit_creds_equal (two, scruffy));
  g_assert (!cockpit_creds_equal (two, NULL));
  g_assert (!cockpit_creds_equal (NULL, two));
  g_assert (cockpit_creds_equal (NULL, NULL));


  cockpit_creds_unref (one);
  cockpit_creds_unref (two);
  cockpit_creds_unref (scruffy);
  cockpit_creds_unref (rhost);
  cockpit_creds_unref (copy);
  cockpit_creds_unref (app);
}

static void
test_login_data (void)
{
  JsonObject *object;
  const gchar *invalid = "invalid";
  const gchar *no_data = "{ \"no-data\" : \"none\" }";
  const gchar *invalid_login = "{ \"login-data\" : \"invalid\" }";
  const gchar *valid = "{ \"login-data\" : { \"login\": \"data\" } }";
  CockpitCreds *creds;
  CockpitCreds *creds2;
  CockpitCreds *creds3;
  CockpitCreds *creds4;
  CockpitCreds *creds5;

  creds = cockpit_creds_new ("user", "app", NULL);

  cockpit_expect_warning ("*received bad json data:*");
  creds2 = cockpit_creds_new ("user", "app",
                              COCKPIT_CRED_LOGIN_DATA, invalid, NULL);

  creds3 = cockpit_creds_new ("user", "app",
                              COCKPIT_CRED_LOGIN_DATA, no_data, NULL);

  cockpit_expect_warning ("*received bad login-data:*");
  creds4 = cockpit_creds_new ("user", "app",
                              COCKPIT_CRED_LOGIN_DATA, invalid_login, NULL);

  creds5 = cockpit_creds_new ("user", "app",
                              COCKPIT_CRED_LOGIN_DATA, valid, NULL);

  g_assert (creds != NULL);

  g_assert_null (cockpit_creds_get_login_data (creds));
  g_assert_null (cockpit_creds_get_login_data (creds2));
  g_assert_null (cockpit_creds_get_login_data (creds3));
  g_assert_null (cockpit_creds_get_login_data (creds4));

  object = cockpit_creds_get_login_data (creds5);
  g_assert_cmpstr ("data", ==, json_object_get_string_member (object, "login"));

  cockpit_creds_unref (creds);
  cockpit_creds_unref (creds2);
  cockpit_creds_unref (creds3);
  cockpit_creds_unref (creds4);
  cockpit_creds_unref (creds5);

  cockpit_assert_expected ();
}

int
main (int argc,
      char *argv[])
{
  cockpit_test_init (&argc, &argv);

  g_test_add_func ("/creds/basic-password", test_password);
  g_test_add_func ("/creds/poison", test_poison);
  g_test_add_func ("/creds/rhost", test_rhost);
  g_test_add_func ("/creds/multiple", test_multiple);
  g_test_add_func ("/creds/hash", test_hash);
  g_test_add_func ("/creds/equal", test_equal);
  g_test_add_func ("/creds/has_gssapi", test_gssapi);
  g_test_add_func ("/creds/login-data", test_login_data);

  return g_test_run ();
}
