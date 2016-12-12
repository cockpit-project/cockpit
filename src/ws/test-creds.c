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
  GBytes *password;

  password = g_bytes_new_take (g_strdup ("password"), 8);
  creds = cockpit_creds_new ("user", "test", COCKPIT_CRED_PASSWORD, password, NULL);
  g_bytes_unref (password);

  g_assert (creds != NULL);

  g_assert_cmpstr ("user", ==, cockpit_creds_get_user (creds));
  g_assert_cmpstr ("password", ==, g_bytes_get_data (cockpit_creds_get_password (creds), NULL));
  g_assert_cmpstr ("test", ==, cockpit_creds_get_application (creds));

  cockpit_creds_unref (creds);
}

static void
test_gssapi (void)
{
  CockpitCreds *creds;
  GBytes *password;

  password = g_bytes_new_take (g_strdup ("password"), 8);
  creds = cockpit_creds_new ("user", "test", COCKPIT_CRED_PASSWORD, password, NULL);
  g_bytes_unref (password);

  g_assert (creds != NULL);

  g_assert_false (cockpit_creds_has_gssapi (creds));

  cockpit_creds_unref (creds);

  creds = cockpit_creds_new ("user", "test", COCKPIT_CRED_GSSAPI, "bad-but-present", NULL);
  g_assert (creds != NULL);

  g_assert_true (cockpit_creds_has_gssapi (creds));

  cockpit_creds_unref (creds);

}

static void
test_set_password (void)
{
  CockpitCreds *creds;
  GBytes *password;
  GBytes *out;
  GBytes *two;

  password = g_bytes_new_take (g_strdup ("password"), 8);
  creds = cockpit_creds_new ("user", "app", COCKPIT_CRED_PASSWORD, password, NULL);
  g_bytes_unref (password);

  g_assert (creds != NULL);

  out = cockpit_creds_get_password (creds);
  g_assert (out != NULL);
  g_assert_cmpstr ("password", ==, g_bytes_get_data (out, NULL));

  password = g_bytes_new_take (g_strdup ("second"), 6);
  cockpit_creds_set_password (creds, password);
  g_bytes_unref (password);

  two = cockpit_creds_get_password (creds);
  g_assert (two != NULL);
  g_assert_cmpstr ("second", ==, g_bytes_get_data (two, NULL));

  cockpit_creds_set_password (creds, NULL);
  g_assert (NULL == cockpit_creds_get_password (creds));

  /* Still hold references to all old passwords, but they are cleared */
  g_assert_cmpstr ("\252\252\252\252\252\252\252\252", ==, g_bytes_get_data (out, NULL));
  g_assert_cmpstr ("\252\252\252\252\252\252", ==, g_bytes_get_data (two, NULL));

  cockpit_creds_unref (creds);
}

static void
test_poison (void)
{
  CockpitCreds *creds;
  GBytes *password;
  GBytes *out;

  password = g_bytes_new_take (g_strdup ("password"), 8);
  creds = cockpit_creds_new ("user", "app", COCKPIT_CRED_PASSWORD, password, NULL);
  g_bytes_unref (password);

  g_assert (creds != NULL);

  g_assert_cmpstr ("user", ==, cockpit_creds_get_user (creds));
  g_assert_cmpstr ("password", ==, g_bytes_get_data (cockpit_creds_get_password (creds), NULL));
  g_assert_cmpstr ("app", ==, cockpit_creds_get_application (creds));

  out = cockpit_creds_get_password (creds);
  cockpit_creds_poison (creds);

  g_assert (NULL == cockpit_creds_get_password (creds));

  password = g_bytes_new_take (g_strdup ("second"), 6);
  cockpit_creds_set_password (creds, password);
  g_bytes_unref (password);

  /* Even though we set a new password, still NULL */
  g_assert (NULL == cockpit_creds_get_password (creds));
  g_assert_cmpstr ("\252\252\252\252\252\252\252\252", ==, g_bytes_get_data (out, NULL));

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
  GBytes *password;

  password = g_bytes_new_take (g_strdup ("password"), 8);
  creds = cockpit_creds_new ("user", "app",
                             COCKPIT_CRED_PASSWORD, password,
                             COCKPIT_CRED_RHOST, "remote",
                             NULL);
  g_assert (creds != NULL);

  g_assert_cmpstr ("user", ==, cockpit_creds_get_user (creds));
  g_assert_cmpstr ("remote", ==, cockpit_creds_get_rhost (creds));
  g_assert_cmpstr ("password", ==, g_bytes_get_data (cockpit_creds_get_password (creds), NULL));
  g_assert_cmpstr ("app", ==, cockpit_creds_get_application (creds));

  g_bytes_unref (password);
  cockpit_creds_unref (creds);
}

static void
test_hash (void)
{
  GBytes *pass1 = g_bytes_new_take (g_strdup ("pass1"), 5);
  GBytes *pass2 = g_bytes_new_take (g_strdup ("pass2"), 5);

  CockpitCreds *one = cockpit_creds_new ("user", "app", COCKPIT_CRED_PASSWORD, pass1, NULL);
  CockpitCreds *rhost = cockpit_creds_new ("user", "app", COCKPIT_CRED_PASSWORD, pass1,
                                           COCKPIT_CRED_RHOST, "meh", NULL);
  CockpitCreds *app = cockpit_creds_new ("user", "app2", COCKPIT_CRED_PASSWORD, pass1, NULL);
  CockpitCreds *copy = cockpit_creds_new ("user", "app", COCKPIT_CRED_PASSWORD, pass1, NULL);

  g_bytes_unref (pass1);
  g_bytes_unref (pass2);

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
  GBytes *pass1 = g_bytes_new_take (g_strdup ("pass1"), 5);
  GBytes *pass2 = g_bytes_new_take (g_strdup ("pass2"), 5);

  CockpitCreds *one = cockpit_creds_new ("user", "app", COCKPIT_CRED_PASSWORD, pass1, NULL);
  CockpitCreds *rhost = cockpit_creds_new ("user", "app", COCKPIT_CRED_PASSWORD, pass1,
                                           COCKPIT_CRED_RHOST, "meh", NULL);
  CockpitCreds *app = cockpit_creds_new ("user", "app2", COCKPIT_CRED_PASSWORD, pass1, NULL);
  CockpitCreds *scruffy = cockpit_creds_new ("scruffy", "app", COCKPIT_CRED_PASSWORD, pass1, NULL);
  CockpitCreds *two = cockpit_creds_new ("user2", "app", COCKPIT_CRED_PASSWORD, pass2, NULL);
  CockpitCreds *copy = cockpit_creds_new ("user", "app", COCKPIT_CRED_PASSWORD, pass1, NULL);

  g_bytes_unref (pass1);
  g_bytes_unref (pass2);

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
  g_test_add_func ("/creds/set-password", test_set_password);
  g_test_add_func ("/creds/poison", test_poison);
  g_test_add_func ("/creds/rhost", test_rhost);
  g_test_add_func ("/creds/multiple", test_multiple);
  g_test_add_func ("/creds/hash", test_hash);
  g_test_add_func ("/creds/equal", test_equal);
  g_test_add_func ("/creds/has_gssapi", test_gssapi);
  g_test_add_func ("/creds/login-data", test_login_data);

  return g_test_run ();
}
