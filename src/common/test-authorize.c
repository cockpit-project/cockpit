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
  const char *input;
  const char *expected;
  const char *ret;
  int errn;
} ChallengeFixture;

static ChallengeFixture type_fixtures[] = {
  { "invalid", NULL, NULL, EINVAL },
  { ":invalid", NULL, NULL, EINVAL },
  { "Basic more-data", "basic", "more-data", 0 },
  { "Basic   more-data", "basic", "more-data", 0 },
  { "valid:test", "valid", "test", 0 },
  { "valid1:", "valid1", "", 0 },
  { "valid2:test:test", "valid2", "test:test", 0 },
  { NULL },
};

static void
test_type (void *data)
{
  ChallengeFixture *fix = data;
  const char *result;
  char *type;

  if (fix->ret == NULL)
    expect_message = "invalid \"authorize\" message";

  result = cockpit_authorize_type (fix->input, &type);
  if (fix->errn != 0)
    assert_num_eq (errno, fix->errn);
  if (fix->ret)
    {
      assert_str_eq (result, fix->ret);
      assert_str_eq (type, fix->expected);
      free (type);
    }
  else
    {
      assert (result == NULL);
    }
}

static ChallengeFixture subject_fixtures[] = {
  { "valid:73637275666679:", "73637275666679", "", 0 },
  { "valid:73637275666679:more-data", "73637275666679", "more-data", 0 },
  { "valid:scruffy:", "scruffy", "", 0 },
  { "X-Conversation conversationtoken more-data", "conversationtoken", "more-data", 0 },
  { "X-Conversation  conversationtoken    more-data", "conversationtoken", "more-data", 0 },
  { "invalid:73637275666679", "73637275666679", NULL, EINVAL },
  { "invalid", NULL, NULL, EINVAL },
  { NULL },
};

static void
test_subject (void *data)
{
  ChallengeFixture *fix = data;
  const char *result;
  char *subject = NULL;

  if (fix->ret == NULL)
    expect_message = "\"authorize\" message";

  result = cockpit_authorize_subject (fix->input, &subject);
  if (fix->errn != 0)
    assert_num_eq (errno, fix->errn);
  if (fix->ret)
    {
      assert_str_eq (result, fix->ret);
      assert_str_eq (subject, fix->expected);
      free (subject);
    }
  else
    {
      assert (result == NULL);
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

  for (i = 0; type_fixtures[i].input != NULL; i++)
    re_testx (test_type, type_fixtures + i,
              "/authorize/type/%s", type_fixtures[i].input);
  for (i = 0; subject_fixtures[i].input != NULL; i++)
    re_testx (test_subject, subject_fixtures + i,
              "/authorize/subject/%s", subject_fixtures[i].input);

  return re_test_run (argc, argv);
}
