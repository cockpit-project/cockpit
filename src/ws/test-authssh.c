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
  g_assert_cmpstr (PASSWORD, ==, cockpit_creds_get_password (creds));

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
  return g_test_run ();
}
