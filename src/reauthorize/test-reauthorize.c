/*
 * Copyright (c) 2014 Red Hat Inc.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 *     * Redistributions of source code must retain the above
 *       copyright notice, this list of conditions and the
 *       following disclaimer.
 *     * Redistributions in binary form must reproduce the
 *       above copyright notice, this list of conditions and
 *       the following disclaimer in the documentation and/or
 *       other materials provided with the distribution.
 *     * The names of contributors to this software may not be
 *       used to endorse or promote products derived from this
 *       software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS
 * FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE
 * COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT,
 * INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING,
 * BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS
 * OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED
 * AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF
 * THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH
 * DAMAGE.
 *
 * Author: Stef Walter <stefw@redhat.com>
 */

#define _GNU_SOURCE

#include "retest/retest.h"

#include "reauthorize.h"

#include <sys/types.h>
#include <sys/wait.h>

#include <err.h>
#include <errno.h>
#include <keyutils.h>
#include <pwd.h>
#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

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

static char *
read_until_eof (int fd)
{
  size_t len = 0;
  size_t alloc = 0;
  char *buf = NULL;
  int r;

  for (;;)
    {
      if (alloc <= len)
        {
          alloc += 1024;
          buf = realloc (buf, alloc);
          assert (buf != NULL);
        }

      r = read (fd, buf + len, alloc - len);
      if (r < 0)
        {
          if (errno == EAGAIN)
            continue;
          assert_not_reached ();
        }
      else if (r == 0)
        {
          break;
        }
      else
        {
          len += r;
        }
    }

  buf[len] = '\0';
  return buf;
}

static int
mock_reauthorize (const char *mode,
                  const char *user,
                  const char *argument,
                  char **output)
{
  int fds[2];
  pid_t pid;
  int status;

  const char *argv[] = {
      BUILDDIR "/mock-reauthorize",
      mode,
      user,
      argument,
      NULL
  };

  if (output)
    {
      if (pipe (fds) < 0)
        assert_not_reached ();
    }

  pid = fork ();
  if (pid == 0)
    {
      if (output)
        dup2 (fds[1], 1);
      execv (argv[0], (char **)argv);
      fprintf (stderr, "exec failed: %s: %m\n", argv[0]);
      _exit (127);
    }

  if (output)
    {
      close (fds[1]);
      *output = read_until_eof (fds[0]);
      close (fds[0]);
    }

  assert_num_eq (waitpid (pid, &status, 0), pid);

  assert (WIFEXITED (status));
  if (WEXITSTATUS (status) == 77)
    {
      if (output)
        {
          free (*output);
          *output = NULL;
        }
      re_test_skip ("need to 'make enable-root-tests'");
    }

  return WEXITSTATUS (status);
}

typedef struct {
  const char *challenge;
  const char *expected;
  int ret;
} ChallengeFixture;

static ChallengeFixture type_fixtures[] = {
  { "invalid", NULL, -EINVAL },
  { ":invalid", NULL, -EINVAL },
  { "valid:test", "valid", 0 },
  { "valid1:", "valid1", 0 },
  { "valid2:test:test", "valid2", 0 },
  { NULL },
};

static void
test_type (void *data)
{
  ChallengeFixture *fix = data;
  char *type;

  if (fix->ret != 0)
    expect_message = "invalid reauthorize challenge";

  assert_num_eq (reauthorize_type (fix->challenge, &type), fix->ret);
  if (fix->ret == 0)
    {
      assert_str_eq (type, fix->expected);
      free (type);
    }
}

static ChallengeFixture user_fixtures[] = {
  { "valid:73637275666679", "scruffy", 0 },
  { "valid:73637275666679:more-data", "scruffy", 0 },
  { "invalid:7363727566667", NULL, -EINVAL },
  { "invalid:736372756666790055", NULL, -EINVAL },
  { "invalid:scruffy", NULL, -EINVAL },
  { "invalid", NULL, -EINVAL },
  { NULL },
};

static void
test_user (void *data)
{
  ChallengeFixture *fix = data;
  char *user = NULL;

  if (fix->ret != 0)
    expect_message = "invalid reauthorize challenge";

  assert_num_eq (reauthorize_user (fix->challenge, &user), fix->ret);
  if (fix->ret == 0)
    {
      assert_str_eq (user, fix->expected);
    }
  free (user);
}

typedef struct {
  const char *challenge;
  const char *password;
  const char *expected;
  int ret;
} CryptFixture;

static CryptFixture crypt1_fixtures[] = {
  { "crypt1:75:$1$invalid:$1$invalid", "password", NULL, -EINVAL },
  { "gssapi1:75", "password", NULL, -EINVAL },
  { "crypt1:invalid", "password", NULL, -EINVAL },
  { "crypt1:75:$1$0123456789abcdef$:$1$0123456789abcdef$",
    "password", "crypt1:$1$01234567$mmR7jVZhYpBJ6s6uTlnIR0", 0 },
  { NULL },
};

static void
test_crypt1 (void *data)
{
  CryptFixture *fix = data;
  char *response;

  if (fix->ret != 0)
    expect_message = "reauthorize challenge";

  assert_num_eq (reauthorize_crypt1 (fix->challenge, fix->password, &response), fix->ret);
  if (fix->ret == 0)
    {
      assert_str_eq (response, fix->expected);
      free (response);
    }
}

static void
test_password_success (void)
{
  const char *password = "booo";
  char *response;
  char *challenge;

  assert_num_eq (mock_reauthorize ("prepare", user, password, NULL), 0);
  assert_num_eq (mock_reauthorize ("perform", user, NULL, &challenge), REAUTHORIZE_CONTINUE);
  assert_num_eq (reauthorize_crypt1 (challenge, password, &response), 0);
  assert_num_eq (mock_reauthorize ("perform", user, response, NULL), REAUTHORIZE_YES);

  free (response);
  free (challenge);
}

static void
test_password_bad (void)
{
  char *response;
  char *challenge;

  assert_num_eq (mock_reauthorize ("prepare", user, "actual-password", NULL), 0);
  assert_num_eq (mock_reauthorize ("perform", user, NULL, &challenge), REAUTHORIZE_CONTINUE);

  assert_num_eq (reauthorize_crypt1 (challenge, "bad password", &response), 0);
  assert_num_eq (mock_reauthorize ("perform", user, response, NULL), REAUTHORIZE_NO);

  free (response);
  free (challenge);
}

static void
test_password_no_prepare (void)
{
  char *challenge = NULL;

  assert_num_eq (mock_reauthorize ("perform", "unknown", NULL, &challenge), REAUTHORIZE_NO);

  free (challenge);
}

static void
test_password_bad_secret (void)
{
  char *description;
  char *challenge = NULL;

  if (asprintf (&description, "reauthorize/secret/%s", user) < 0)
    assert_not_reached ();
  if (add_key ("user", description, "$6$abcdef0123456789$", 20, KEY_SPEC_SESSION_KEYRING) < 0)
    assert_not_reached (0);
  free (description);

  assert_num_eq (mock_reauthorize ("perform", user, NULL, &challenge), 127);

  free (challenge);
}

int
main (int argc,
      char *argv[])
{
  int i;

  /* Some initial preparation */
  signal (SIGPIPE, SIG_IGN);
  reauthorize_logger (test_logger, 0);

  re_fixture (setup, teardown);

  for (i = 0; type_fixtures[i].challenge != NULL; i++)
    re_testx (test_type, type_fixtures + i,
              "/reauthorize/type/%s", type_fixtures[i].challenge);
  for (i = 0; user_fixtures[i].challenge != NULL; i++)
    re_testx (test_user, user_fixtures + i,
              "/reauthorize/user/%s", user_fixtures[i].challenge);
  for (i = 0; crypt1_fixtures[i].challenge != NULL; i++)
    re_testx (test_crypt1, crypt1_fixtures + i,
              "/reauthorize/crypt1/%s", crypt1_fixtures[i].challenge);

  re_test (test_password_success, "/pamreauth/password-success");
  re_test (test_password_bad, "/pamreauth/password-bad");
  re_test (test_password_no_prepare, "/pamreauth/password-no-prepare");
  re_test (test_password_bad_secret, "/pamreauth/password-bad-secret");

  return re_test_run (argc, argv);
}
