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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

#include "config.h"

#include "ws/cockpitcreds.h"

#include "common/cockpitjson.h"
#include "testlib/cockpittest.h"

static void
assert_all_zeros (GBytes *bytes)
{
  gsize size;
  const gchar *data = g_bytes_get_data (bytes, &size);

  for (gsize i = 0; i < size; i++)
    g_assert (data[i] == '\0');
}

static void
test_password (void)
{
  CockpitCreds *creds;
  GBytes *password;

  password = g_bytes_new_take (g_strdup ("password"), 8);
  creds = cockpit_creds_new ("test",
                             COCKPIT_CRED_USER, "user",
                             COCKPIT_CRED_PASSWORD, password,
                             NULL);
  g_bytes_unref (password);

  g_assert (creds != NULL);

  g_assert_cmpstr ("user", ==, cockpit_creds_get_user (creds));
  g_assert_cmpstr ("password", ==, g_bytes_get_data (cockpit_creds_get_password (creds), NULL));
  g_assert_cmpstr ("test", ==, cockpit_creds_get_application (creds));

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
  creds = cockpit_creds_new ("app", COCKPIT_CRED_PASSWORD, password, NULL);
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
  assert_all_zeros (out);
  assert_all_zeros (two);

  cockpit_creds_unref (creds);
}

static void
test_poison (void)
{
  CockpitCreds *creds;
  GBytes *password;
  GBytes *out;

  password = g_bytes_new_take (g_strdup ("password"), 8);
  creds = cockpit_creds_new ("app", COCKPIT_CRED_PASSWORD, password, NULL);
  g_bytes_unref (password);

  g_assert (creds != NULL);

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
  assert_all_zeros (out);

  cockpit_creds_unref (creds);
}

static void
test_rhost (void)
{
  CockpitCreds *creds;

  creds = cockpit_creds_new ("app", COCKPIT_CRED_RHOST, "remote", NULL);
  g_assert (creds != NULL);

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
  creds = cockpit_creds_new ("app",
                             COCKPIT_CRED_PASSWORD, password,
                             COCKPIT_CRED_RHOST, "remote",
                             NULL);
  g_assert (creds != NULL);

  g_assert_cmpstr ("remote", ==, cockpit_creds_get_rhost (creds));
  g_assert_cmpstr ("password", ==, g_bytes_get_data (cockpit_creds_get_password (creds), NULL));
  g_assert_cmpstr ("app", ==, cockpit_creds_get_application (creds));

  g_bytes_unref (password);
  cockpit_creds_unref (creds);
}

static void
test_login_data (void)
{
  JsonObject *object;
  const gchar *valid = "{ \"login-data\" : { \"login\": \"data\" } }";
  CockpitCreds *creds;

  creds = cockpit_creds_new ("app", NULL);
  g_assert (cockpit_creds_get_login_data (creds) == NULL);

  object = cockpit_json_parse_object (valid, -1, NULL);
  cockpit_creds_set_login_data (creds, object);
  json_object_unref (object);
  cockpit_assert_json_eq (cockpit_creds_get_login_data (creds), valid);

  object = cockpit_json_parse_object (valid, -1, NULL);
  cockpit_creds_set_login_data (creds, object);
  json_object_unref (object);
  cockpit_assert_json_eq (cockpit_creds_get_login_data (creds), valid);

  cockpit_creds_set_login_data (creds, NULL);
  g_assert (cockpit_creds_get_login_data (creds) == NULL);
  cockpit_creds_unref (creds);
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
  g_test_add_func ("/creds/login-data", test_login_data);

  return g_test_run ();
}
