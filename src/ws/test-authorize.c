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

#include "cockpitauthorize.h"

#include <sys/types.h>
#include <sys/wait.h>

#include <err.h>
#include <errno.h>
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
  struct passwd *pw;

  expect_message = NULL;

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
    expect_message = "invalid \"authorize\" message";

  assert_num_eq (cockpit_authorize_type (fix->challenge, &type), fix->ret);
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
    expect_message = "\"authorize\" message \"challenge\"";

  assert_num_eq (cockpit_authorize_user (fix->challenge, &user), fix->ret);
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
    expect_message = "\"authorize\" message \"challenge\"";

  assert_num_eq (cockpit_authorize_crypt1 (fix->challenge, fix->password, &response), fix->ret);
  if (fix->ret == 0)
    {
      assert_str_eq (response, fix->expected);
      free (response);
    }
}

int
main (int argc,
      char *argv[])
{
  int i;

  /* Some initial preparation */
  signal (SIGPIPE, SIG_IGN);
  cockpit_authorize_logger (test_logger, 0);

  re_fixture (setup, teardown);

  for (i = 0; type_fixtures[i].challenge != NULL; i++)
    re_testx (test_type, type_fixtures + i,
              "/authorize/type/%s", type_fixtures[i].challenge);
  for (i = 0; user_fixtures[i].challenge != NULL; i++)
    re_testx (test_user, user_fixtures + i,
              "/authorize/user/%s", user_fixtures[i].challenge);
  for (i = 0; crypt1_fixtures[i].challenge != NULL; i++)
    re_testx (test_crypt1, crypt1_fixtures + i,
              "/authorize/crypt1/%s", crypt1_fixtures[i].challenge);

  return re_test_run (argc, argv);
}
