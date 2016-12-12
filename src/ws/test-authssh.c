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

#include "cockpitws.h"
#include "mock-auth.h"

#include "common/cockpittest.h"
#include "common/cockpitwebserver.h"
#include "common/cockpiterror.h"

#include <sys/wait.h>
#include <errno.h>
#include <stdlib.h>
#include <string.h>

#define PASSWORD "this is the password"

typedef struct {
  CockpitAuth *auth;

  /* setup_mock_sshd */
  GPid mock_sshd;
  guint16 ssh_port;
} TestCase;

typedef struct {
  const char *header;
} TestFixture;

static GString *
read_all_into_string (int fd)
{
  GString *input = g_string_new ("");
  gsize len;
  gssize ret;

  for (;;)
    {
      len = input->len;
      g_string_set_size (input, len + 256);
      ret = read (fd, input->str + len, 256);
      if (ret < 0)
        {
          if (errno != EAGAIN)
            {
              g_critical ("couldn't read from mock input: %s", g_strerror (errno));
              g_string_free (input, TRUE);
              return NULL;
            }
        }
      else if (ret == 0)
        {
          return input;
        }
      else
        {
          input->len = len + ret;
          input->str[input->len] = '\0';
        }
    }
}

static void
setup_mock_sshd (TestCase *tc)
{
  GError *error = NULL;
  GString *port;
  gchar *endptr;
  guint64 value;
  gint out_fd;

  const gchar *argv[] = {
      BUILDDIR "/mock-sshd",
      "--user", "me",
      "--password", PASSWORD,
      NULL
  };

  g_spawn_async_with_pipes (BUILDDIR, (gchar **)argv, NULL, G_SPAWN_DO_NOT_REAP_CHILD, NULL, NULL,
                            &tc->mock_sshd, NULL, &out_fd, NULL, &error);
  g_assert_no_error (error);

  /*
   * mock-sshd prints its port on stdout, and then closes stdout
   * This also lets us know when it has initialized.
   */

  port = read_all_into_string (out_fd);
  g_assert (port != NULL);
  close (out_fd);
  g_assert_no_error (error);

  g_strstrip (port->str);
  value = g_ascii_strtoull (port->str, &endptr, 10);
  if (!endptr || *endptr != '\0' || value == 0 || value > G_MAXUSHORT)
      g_critical ("invalid port printed by mock-sshd: %s", port->str);

  tc->ssh_port = (gushort)value;
  g_string_free (port, TRUE);
}

static void
setup (TestCase *tc,
       gconstpointer data)
{
  tc->auth = cockpit_auth_new (TRUE);
  setup_mock_sshd (tc);
}

static void
teardown (TestCase *tc,
          gconstpointer data)
{
  if (tc->mock_sshd)
    {
      kill (tc->mock_sshd, SIGTERM);
      g_assert_cmpint (waitpid (tc->mock_sshd, 0, 0), ==, tc->mock_sshd);
      g_spawn_close_pid (tc->mock_sshd);
    }

  g_clear_object (&tc->auth);
}

static void
on_ready_get_result (GObject *source,
                     GAsyncResult *result,
                     gpointer user_data)
{
  GAsyncResult **retval = user_data;
  g_assert (retval != NULL);
  g_assert (*retval == NULL);
  *retval = g_object_ref (result);
}

static void
test_basic_good (TestCase *test,
                 gconstpointer data)
{
  GHashTable *in_headers;
  GHashTable *out_headers;
  GAsyncResult *result = NULL;
  CockpitCreds *creds;
  CockpitWebService *service;
  JsonObject *response;
  GError *error = NULL;
  gchar *path = NULL;
  gchar *application = NULL;
  gchar *cookie = NULL;

  in_headers = mock_auth_basic_header ("me", PASSWORD);
  g_hash_table_insert (in_headers, g_strdup ("X-Authorize"), g_strdup ("password"));
  out_headers = cockpit_web_server_new_table ();

  application = g_strdup_printf ("cockpit+=127.0.0.1:%d", test->ssh_port);
  cookie = g_strdup_printf ("machine-cockpit+127.0.0.1:%d", test->ssh_port);
  path = g_strdup_printf ("/%s", application);

  cockpit_auth_login_async (test->auth, path, NULL, in_headers, on_ready_get_result, &result);
  g_hash_table_unref (in_headers);

  while (result == NULL)
    g_main_context_iteration (NULL, TRUE);

  response = cockpit_auth_login_finish (test->auth, result, NULL, out_headers, &error);
  g_object_unref (result);
  g_assert_no_error (error);
  g_assert (response != NULL);
  json_object_unref (response);

  mock_auth_include_cookie_as_if_client (out_headers, out_headers, cookie);
  service = cockpit_auth_check_cookie (test->auth, path, out_headers);
  g_assert (service != NULL);

  creds = cockpit_web_service_get_creds (service);
  g_assert_cmpstr ("me", ==, cockpit_creds_get_user (creds));
  g_assert_cmpstr (application, ==, cockpit_creds_get_application (creds));
  g_assert_cmpstr (PASSWORD, ==, g_bytes_get_data (cockpit_creds_get_password (creds), NULL));

  g_hash_table_unref (out_headers);
  g_object_unref (service);
  g_free (cookie);
  g_free (path);
  g_free (application);
}

static const TestFixture fixture_bad_format = {
  .header = "Basic d3JvbmctZm9ybWF0Cg=="
};

static const TestFixture fixture_wrong_pw = {
  .header = "Basic bWU6d3JvbmcK"
};

static const TestFixture fixture_empty = {
  .header = "Basic"
};

static void
test_basic_fail (TestCase *test,
                 gconstpointer data)
{
  GHashTable *headers;
  GAsyncResult *result = NULL;
  GError *error = NULL;
  gchar *path = NULL;
  gchar *application = NULL;
  const TestFixture *fix = data;

  headers = cockpit_web_server_new_table ();
  g_hash_table_insert (headers, g_strdup ("Authorization"), g_strdup (fix->header));
  g_hash_table_insert (headers, g_strdup ("X-Authorize"), g_strdup ("password"));

  application = g_strdup_printf ("cockpit+=127.0.0.1:%d", test->ssh_port);
  path = g_strdup_printf ("/%s", application);

  cockpit_auth_login_async (test->auth, path, NULL, headers, on_ready_get_result, &result);
  g_hash_table_unref (headers);
  headers = cockpit_web_server_new_table ();

  while (result == NULL)
    g_main_context_iteration (NULL, TRUE);

  g_assert_null (cockpit_auth_login_finish (test->auth, result, NULL, headers, &error));
  g_object_unref (result);
  g_assert_error (error, COCKPIT_ERROR, COCKPIT_ERROR_AUTHENTICATION_FAILED);
  g_assert_cmpstr ("Authentication failed", ==, error->message);

  g_clear_error (&error);
  g_hash_table_unref (headers);
  g_free (path);
  g_free (application);
}

/*
 * These tests exist to test the private key auth function in cockpit-ssh.
 * They pass a contrived header that includes key data to cockpit_auth_login.
 * This is not a valid header and not how this is actually meant to be used.
 * It's just easiest to test like this.
 */

/* test_rsa */
static const gchar MOCK_RSA_KEY[] = "-----BEGIN RSA PRIVATE KEY-----\n"
"MIIEowIBAAKCAQEAvkPEj9GX9I0v/3dxCUB73TgOYjxkXB/m2ecKnUYmYtEwgirA\n"
"onCgZRMAvB7UaP5e6U/pNCXuZ+UgS0yU6tqEXD7MQ4YZiiNU1RaLe/gQ21NEx27h\n"
"hCGTZOLKcSfOFv2Z77OUcXSop2PZxQweYaH1+RB7hojOd7ZchN/tIBxvea5JSg/0\n"
"wLC8Lm65gpCZCxG2TNgfymovnyrYB44HnwEm4jCMU4uP68h0+D297US4oWwcpcqE\n"
"2S4LOxazjw1Brvntpqwtq624tUb1QVYMxdHpCR7Qu843r3XSpS4BwrnOks7Sbgyg\n"
"tHiKgogY5Xhu7ZqsTODtzyJ950YD0scnY41qHQIDAQABAoIBAFlQHnkUfixCCoH1\n"
"Y45gQsS5h6b9im7kWs128ziYsXQ5lnfD8eFO1TwdC39DSZpvrcX/yQy9sYf7uoke\n"
"Tdlg8jkLEX+w91Qs+al9h8SN0fvivqqPljUcPcBh5X3wnYGVUil/NvN7O6A38wXY\n"
"hnp2OKzN2+5vUdxIMm39X6ZvMrT/FyQjvdp393G4f0blYl7Npdc+HYPNnhHdgi4I\n"
"NUa32pG3ypoWkQRAYApaG2RXPTWQXTM2w4CFK5uJx/pB3r5NidU/H0XAl4TAuw9M\n"
"V9hrIPAOh5zKvHcPv8xOwR0Bt36F+/QATjO9pvlzQO6Rn3x2dyAVdaFMgdYTNpQQ\n"
"t0ZYsYECgYEA8yAhKUnArEQ4A+AI+pCtZuftzkXmnQ5SHNUtF2GeR5tRZ1PBF/tp\n"
"zoVRW+5ge1hI2VEx3ziGHEIBr7FfVej7twQ3URv5ILYj6CoNOf+HxkZgkTDGpYdj\n"
"AVvyjeD5qJEwCSeJ2bxD5LmxS9is8b8rXjVKRuPxwLeWqEjemPb0KNUCgYEAyFcL\n"
"TdN9cZghuzLZ0vfP4k9Hratunskz5njTFKnJx90riE7VqPH9OHvTeHn1xJ5WACnb\n"
"mFpAUG1v7BmC+WLEIPnKRKvuzL5C1yr+mntwTZsrwsLDdT/nfTS9hWzk9U6ykhJA\n"
"De8nNfxHuCoqM++CNvh+rA4W2Zc6WmE0uCwXYCkCgYEA70KMP+Sb3yvXcEDWtTcR\n"
"3raZ+agitib0ufk0QdFIgbGhH6111lMOIjZjBbSGcHxGXM8h5Ens+PwgSrWkW5hH\n"
"tylIAuMjfYShu4U+tPf6ty5lNB0rMJUW4qyI/AUNzEztV+T4LTWwHvR7PWgDcniu\n"
"hiytZyxFqmFBu2TS4vgM+e0CgYAvAL0WNVhpHlhLo1KXvKx5XEBk7qO1fV8/43ki\n"
"j/NXgPyFrnlSefP/HI4w5exThRKIV0m+JO6R8BsiOZoRCKsbUX+zPON6BemIsf2q\n"
"IOvoSU+rEibpi2S0a3tLopDVPPGIc9+zZTi94cKx4rKkHL1gSEzv8R5LTr/SFJxZ\n"
"2X5igQKBgBTkIeB0yI2PGf1drI+YbhDfgIphEeSCPbWxcUzPCcwLqXGo41cr8RXY\n"
"TgWtKk0gXhJWkMSIIXrfucCvXHTkk8wlqqgAVwrTgq4Q16LfBuucLwSe4TLp4SJZ\n"
"Lko5CzOq+EIv6DIlZ3tRHeDFatWe+41w27KhrV9yxB6Ay0MalP4i\n"
"-----END RSA PRIVATE KEY-----";

 /* mock_dsa_key */
static const gchar MOCK_DSA_KEY[] = "-----BEGIN DSA PRIVATE KEY-----\n"
"MIIBugIBAAKBgQCCt0UxFgcPqwD3GFDNkKuJBMOfYF6VEP1r5HXmO0AzuuDB2mqK\n"
"8ko/MbK2jbnZkBYeMW/4uUNRDJzXIThcbYpX1OW1CYHU73rcmRFhS/th8agbPBml\n"
"kcgdb7UhQMNxjvFVBJ4xfOODd3Tci6HNDV/CL88DSGkIaOik7LnkJRtV/QIVAJdS\n"
"XhrlS8SUvi2GL/xCXFHk+0R7AoGAajaZeTEwcSkLuY09PlgEmu6QKsE+d6H7+2Uw\n"
"yBKJGEW+e/58Mw4JHLNX7AUayOnnMyf1ZV1sCm7IJMdjYd2YlmMAvh2ObqkaQ2o9\n"
"xxEQuizJ+Hc3XJdvX2Hs4hImwm0YyV+ZWRdryGgNRML/Mk9FJbp8h2UYssOFpRIJ\n"
"ZH/zSEwCgYBxLsdBBXn+8qEYwWK9KT+arRqNXC/lrl0Fp5YyxGNGCv82JcnuOShG\n"
"GTzhYf8AtTCY1u5oixiW9kea6KXGAKgTjfJShr7n47SZVfOPOrBT3VLhRdGGO3Gb\n"
"lDUppzfL8wsEdoqXjzrJuxSdrGnkFu8S9QjkPn9dCtScvWEcluHqMwIUUd82Co5T\n"
"738f4g+9Iuj9G/rNdfg=\n"
"-----END DSA PRIVATE KEY-----";

typedef struct {
  const char *key;
  gint error_code;
  const char *error_message;
} TestKeyFixture;

static const TestKeyFixture fixture_invalid_key = {
  .key = "invalid-key",
  .error_code = COCKPIT_ERROR_FAILED,
  .error_message = "Authentication failed: internal-error"
};

static const TestKeyFixture fixture_wrong_key = {
  .key = MOCK_DSA_KEY,
  .error_code = COCKPIT_ERROR_AUTHENTICATION_FAILED,
  .error_message = "Authentication failed"
};

static void
test_key_fail (TestCase *test,
                 gconstpointer data)
{
  GHashTable *headers;
  GAsyncResult *result = NULL;
  GError *error = NULL;
  gchar *path = NULL;
  gchar *application = NULL;
  const TestKeyFixture *fix = data;
  gchar *header_data = g_strdup_printf ("private-key %s", fix->key);

  headers = cockpit_web_server_new_table ();
  g_hash_table_insert (headers, g_strdup ("Authorization"), header_data);

  application = g_strdup_printf ("cockpit+=me@127.0.0.1:%d", test->ssh_port);
  path = g_strdup_printf ("/%s", application);

  cockpit_auth_login_async (test->auth, path, NULL, headers, on_ready_get_result, &result);
  g_hash_table_unref (headers);
  headers = cockpit_web_server_new_table ();

  while (result == NULL)
    g_main_context_iteration (NULL, TRUE);

  g_assert_null (cockpit_auth_login_finish (test->auth, result, NULL, headers, &error));
  g_object_unref (result);
  g_assert_error (error, COCKPIT_ERROR, fix->error_code);
  g_assert_cmpstr (fix->error_message, ==, error->message);

  g_clear_error (&error);
  g_hash_table_unref (headers);
  g_free (path);
  g_free (application);
}

static void
test_key_good (TestCase *test,
               gconstpointer data)
{
  GHashTable *in_headers;
  GHashTable *out_headers;
  GAsyncResult *result = NULL;
  CockpitCreds *creds;
  CockpitWebService *service;
  JsonObject *response;
  GError *error = NULL;
  gchar *path = NULL;
  gchar *application = NULL;
  gchar *cookie = NULL;
  gchar *header_data = g_strdup_printf ("private-key %s", MOCK_RSA_KEY);

  in_headers = cockpit_web_server_new_table ();
  out_headers = cockpit_web_server_new_table ();
  g_hash_table_insert (in_headers, g_strdup ("Authorization"), header_data);

  application = g_strdup_printf ("cockpit+=me@127.0.0.1:%d", test->ssh_port);
  cookie = g_strdup_printf ("machine-cockpit+me@127.0.0.1:%d", test->ssh_port);
  path = g_strdup_printf ("/%s", application);

  cockpit_auth_login_async (test->auth, path, NULL, in_headers, on_ready_get_result, &result);
  g_hash_table_unref (in_headers);

  while (result == NULL)
    g_main_context_iteration (NULL, TRUE);

  response = cockpit_auth_login_finish (test->auth, result, NULL, out_headers, &error);
  g_object_unref (result);
  g_assert_no_error (error);
  g_assert (response != NULL);
  json_object_unref (response);

  mock_auth_include_cookie_as_if_client (out_headers, out_headers, cookie);
  service = cockpit_auth_check_cookie (test->auth, path, out_headers);
  g_assert (service != NULL);

  creds = cockpit_web_service_get_creds (service);
  g_assert_cmpstr ("me", ==, cockpit_creds_get_user (creds));
  g_assert_cmpstr (application, ==, cockpit_creds_get_application (creds));
  g_assert (NULL == cockpit_creds_get_password (creds));

  g_hash_table_unref (out_headers);
  g_object_unref (service);
  g_free (cookie);
  g_free (path);
  g_free (application);
}

int
main (int argc,
      char *argv[])
{
  cockpit_ws_ssh_program = BUILDDIR "/cockpit-ssh";
  cockpit_ws_known_hosts = SRCDIR "/src/ws/mock_known_hosts";

  g_setenv ("COCKPIT_SSH_BRIDGE_COMMAND", BUILDDIR "/cockpit-bridge", TRUE);

  cockpit_test_init (&argc, &argv);

  g_test_add ("/auth-ssh/basic-good", TestCase, NULL,
              setup, test_basic_good, teardown);
  g_test_add ("/auth-ssh/basic-bad-password", TestCase, &fixture_wrong_pw,
              setup, test_basic_fail, teardown);
  g_test_add ("/auth-ssh/basic-bad-format", TestCase, &fixture_bad_format,
              setup, test_basic_fail, teardown);
  g_test_add ("/auth-ssh/basic-empty", TestCase, &fixture_empty,
              setup, test_basic_fail, teardown);
  g_test_add ("/auth-ssh/key-good", TestCase, NULL,
              setup, test_key_good, teardown);
  g_test_add ("/auth-ssh/key-invalid", TestCase, &fixture_invalid_key,
              setup, test_key_fail, teardown);
  g_test_add ("/auth-ssh/key-fail", TestCase, &fixture_wrong_key,
              setup, test_key_fail, teardown);
  return g_test_run ();
}
