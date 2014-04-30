/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2014 Red Hat, Inc.
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

#define _GNU_SOURCE

#include "retest.h"

#include "reauthorize.h"

#include <sys/socket.h>
#include <sys/types.h>
#include <sys/un.h>
#include <sys/wait.h>

#include <err.h>
#include <errno.h>
#include <keyutils.h>
#include <pwd.h>
#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>


#include <security/pam_appl.h>

static const char *expect_message;
static char *user;

static void
test_logger (const char *msg)
{
  assert (msg != NULL);

  if (expect_message)
    {
      assert_str_contains (msg, expect_message);
      expect_message = NULL;
    }
  else
    {
      warnx ("%s", msg);
    }
}

static void
setup (void *arg)
{
  key_serial_t keyring;
  struct passwd *pw;

  expect_message = NULL;

  keyring = keyctl_join_session_keyring (NULL);
  assert (keyring >= 0);

  pw = getpwuid (getuid ());
  assert (pw != NULL);
  user = strdup (pw->pw_name);
  assert (user != NULL);
}

static void
teardown (void *arg)
{
  if (expect_message)
    assert_fail ("message didn't get logged", expect_message);
  free (user);
  user = NULL;
}

static int
mock_reauthorize (const char *mode,
                  const char *user,
                  const char *password)
{
  int mock_reauthorize;
  char *cmd;

  if (asprintf (&cmd, "%s/mock-reauthorize -q %s %s %s",
                BUILDDIR, mode, user, password ? password : "") < 0)
    assert_not_reached ();
  mock_reauthorize = system (cmd);
  free (cmd);

  assert (WIFEXITED (mock_reauthorize));
  if (WEXITSTATUS (mock_reauthorize) == 77)
    re_test_skip ("need to 'make enable-pam-tests'");

  return WEXITSTATUS (mock_reauthorize);
}

static void
test_password_success (void)
{
  const char *password = "booo";
  int sock;
  int connection;
  char *response;
  char *challenge;

  assert_num_eq (mock_reauthorize ("prepare", user, password), 0);
  assert_num_eq (reauthorize_listen (0, &sock), 0);

  if (re_test_fork ())
    {
      assert_num_eq (mock_reauthorize ("perform", user, NULL), 0);
      return;
    }

  assert_num_eq (reauthorize_accept (sock, &connection), 0);
  assert_num_eq (reauthorize_recv (connection, &challenge), 0);
  assert_num_eq (reauthorize_crypt1 (challenge, password, &response), 0);
  assert_num_eq (reauthorize_send (connection, response), 0);
  close (connection);
  close (sock);
}

static void
test_password_bad (void)
{
  int sock;
  int connection;
  char *response;
  char *challenge;

  assert_num_eq (mock_reauthorize ("prepare", user, "actual-password"), 0);
  assert_num_eq (reauthorize_listen (0, &sock), 0);

  if (re_test_fork ())
    {
      assert_num_eq (mock_reauthorize ("perform", user, NULL), PAM_AUTH_ERR);
      return;
    }

  assert_num_eq (reauthorize_accept (sock, &connection), 0);
  assert_num_eq (reauthorize_recv (connection, &challenge), 0);
  assert_num_eq (reauthorize_crypt1 (challenge, "bad password", &response), 0);
  assert_num_eq (reauthorize_send (connection, response), 0);
  close (connection);
  close (sock);
}

static void
test_password_no_prepare (void)
{
  int sock;
  int connection;

  assert_num_eq (reauthorize_listen (0, &sock), 0);

  if (re_test_fork ())
    {
      assert_num_eq (mock_reauthorize ("perform", user, NULL), PAM_AUTH_ERR);
      return;
    }

  assert_num_eq (reauthorize_accept (sock, &connection), -EINTR);
  close (sock);
}

static void
test_password_bad_secret (void)
{
  char *description;
  int sock;
  int connection;

  if (asprintf (&description, "reauthorize/secret/%s", user) < 0)
    assert_not_reached ();
  if (add_key ("user", description, "$6$abcdef0123456789$", 20, KEY_SPEC_SESSION_KEYRING) < 0)
    assert_not_reached (0);
  free (description);

  assert_num_eq (reauthorize_listen (0, &sock), 0);

  if (re_test_fork ())
    {
      assert_num_eq (mock_reauthorize ("perform", user, NULL), PAM_AUTH_ERR);
      return;
    }

  assert_num_eq (reauthorize_accept (sock, &connection), -EINTR);
  close (sock);
}

typedef struct {
  const char *data;
  ssize_t len;
} FuzzFixture;

static FuzzFixture fuzz_fixtures[] = {
  { "", 0 },
  { "blah", -1 },
  { "crypt1:xxx:", -1 },
  { "crypt1:xxx:zzzz", -1 },
  { "o9t", -1 },
  { "1292929", -1 },
  { "\x01\x02", -1 },
  { "crypt1:\x00", 9 },
  { NULL },
};

static void
test_fuzz_response (void *arg)
{
  FuzzFixture *fix = arg;
  int sock;
  int connection;
  char *challenge;
  size_t len;

  assert_num_eq (mock_reauthorize ("prepare", user, "booo"), 0);
  assert_num_eq (reauthorize_listen (0, &sock), 0);

  if (re_test_fork ())
    {
      assert_num_eq (mock_reauthorize ("perform", user, NULL), PAM_AUTH_ERR);
      return;
    }

  assert_num_eq (reauthorize_accept (sock, &connection), 0);
  assert_num_eq (reauthorize_recv (connection, &challenge), 0);

  len = fix->len < 0 ? strlen (fix->data) : fix->len;
  assert_num_eq (send (connection, fix->data, len, MSG_NOSIGNAL), len);
  close (connection);
  close (sock);
}

int
main (int argc,
      char *argv[])
{
  int i;

  /* Some initial preparation */
  reauthorize_logger (test_logger, 0);

  re_fixture (setup, teardown);

  re_test (test_password_success, "/pamreauth/password-success");
  re_test (test_password_bad, "/pamreauth/password-bad");
  re_test (test_password_no_prepare, "/pamreauth/password-no-prepare");
  re_test (test_password_bad_secret, "/pamreauth/password-bad-secret");

  for (i = 0; fuzz_fixtures[i].data != NULL; i++)
    {
      re_testx (test_fuzz_response, fuzz_fixtures + i,
                "/pamreauth/fuzz/%s", fuzz_fixtures[i].data);
    }

  return re_test_run (argc, argv);
}
