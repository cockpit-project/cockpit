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
  { "valid", "valid", "", 0 },
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
  { "invalid:", "73637275666679", NULL, EINVAL },
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

static ChallengeFixture basic_fixtures[] = {
  { "Basic c2NydWZmeTp6ZXJvZw==", "scruffy", "zerog", 0 },
  { "Basic!c2NydWZmeTp6ZXJvZw==", NULL, NULL, EINVAL },
  { "Basic c2NydWZ!!eXplcm9n", NULL, NULL, EINVAL },
  { "Basic c2NydWZmeXplcm9n", NULL, NULL, EINVAL },
  { "Basic!c2NydWZmeTp6ZXJvZw==", NULL, NULL, EINVAL },
  { "Basic", NULL, "", 0 },
  { NULL },
};

static void
test_parse_basic (void *data)
{
  ChallengeFixture *fix = data;
  char *user = "blah";
  char *password = NULL;

  if (fix->ret == NULL)
    expect_message = "invalid";

  password = cockpit_authorize_parse_basic (fix->input, &user);
  if (fix->errn != 0)
    assert_num_eq (errno, fix->errn);
  if (fix->ret)
    {
      assert_str_eq (password, fix->ret);
      if (fix->expected)
        assert_str_eq (user, fix->expected);
      else
        assert (user == NULL);
      free (password);
      free (user);
    }
  else
    {
      assert (password == NULL);
      assert_str_eq (user, "blah"); /* not reassigned */
    }

  if (fix->ret == NULL)
    expect_message = "invalid";

  password = cockpit_authorize_parse_basic (fix->input, NULL);
  if (fix->errn != 0)
    assert_num_eq (errno, fix->errn);
  if (fix->ret)
    {
      assert_str_eq (password, fix->ret);
      free (password);
    }
  else
    {
      assert (password == NULL);
    }
}

typedef struct {
  const char *input;
  size_t length;
  const char *ret;
  int errn;
} NegotiateFixture;

static NegotiateFixture parse_negotiate_fixtures[] = {
  { "Negotiate c2NydWZmeTp6ZXJvZw==", 13, "scruffy:zerog", 0 },
  { "Negotiate!c2NydWZmeTp6ZXJvZw==", 0, NULL, EINVAL },
  { "Negotiate c2Nyd!!ZmeTp6ZXJvZw==", 0, NULL, EINVAL },
  { "Negotiate!c2NydWZmeTp6ZXJvZw==", 0, NULL, EINVAL },
  { "Negotiate", 0, "", 0 },
  { NULL },
};

static void
test_parse_negotiate (void *data)
{
  NegotiateFixture *fix = data;
  size_t length = 0xFFFFDD;
  void *result = NULL;

  if (fix->ret == NULL)
    expect_message = "invalid";

  result = cockpit_authorize_parse_negotiate (fix->input, &length);
  if (fix->errn != 0)
    assert_num_eq (errno, fix->errn);
  if (fix->ret)
    {
      assert_num_eq (fix->length, length);
      assert (memcmp (result, fix->ret, length) == 0);
      free (result);
    }
  else
    {
      assert (result == NULL);
      assert_num_eq (length, 0xFFFFDD); /* not reassigned */
    }

  if (fix->ret == NULL)
    expect_message = "invalid";

  result = cockpit_authorize_parse_negotiate (fix->input, NULL);
  if (fix->errn != 0)
    assert_num_eq (errno, fix->errn);
  if (fix->ret)
    {
      assert (memcmp (result, fix->ret, length) == 0);
      free (result);
    }
  else
    {
      assert (result == NULL);
    }
}

static NegotiateFixture build_negotiate_fixtures[] = {
  { "scruffy:zerog", 13, "Negotiate c2NydWZmeTp6ZXJvZw==", 0 },
  { NULL, 0, "Negotiate", 0, },
  { NULL },
};

static void
test_build_negotiate (void *data)
{
  NegotiateFixture *fix = data;
  char *result = NULL;

  if (fix->ret == NULL)
    expect_message = "invalid";

  result = cockpit_authorize_build_negotiate (fix->input, fix->length);
  if (fix->errn != 0)
    assert_num_eq (errno, fix->errn);
  if (fix->ret)
    {
      assert_str_eq (result, fix->ret);
      free (result);
    }
  else
    {
      assert (result == NULL);
    }
}

typedef struct {
  const char *input;
  const char *conversation;
  const char *ret;
  int errn;
} XConversationFixture;

static XConversationFixture parse_x_conversation_fixtures[] = {
  { "X-Conversation abcdefghi c2NydWZmeTp6ZXJvZw==", NULL, "scruffy:zerog", 0 },
  { "X-Conversation abcdefghi", NULL, "", 0 },
  { "X-Conversation abcdefghi c2NydW!!meTp6ZXJvZw==", NULL, NULL, EINVAL },
  { NULL },
};

static void
test_parse_x_conversation (void *data)
{
  XConversationFixture *fix = data;
  char *result = NULL;

  if (fix->ret == NULL)
    expect_message = "invalid";

  result = cockpit_authorize_parse_x_conversation (fix->input);
  if (fix->errn != 0)
    assert_num_eq (errno, fix->errn);
  if (fix->ret)
    {
      assert_str_eq (result, fix->ret);
      free (result);
    }
  else
    {
      assert (result == NULL);
    }
}

static XConversationFixture build_x_conversation_fixtures[] = {
  { "scruffy:zerog", "abcdefghi", "X-Conversation abcdefghi c2NydWZmeTp6ZXJvZw==", 0 },
  { "scruffy:zerog", NULL, " c2NydWZmeTp6ZXJvZw==", 0 },
  { "", "abcdefghi", "X-Conversation abcdefghi", 0 },
  { "scruffy:zerog", "", NULL, EINVAL },
  { NULL },
};

static void
test_build_x_conversation (void *data)
{
  XConversationFixture *fix = data;
  char *conversation = NULL;
  char *result = NULL;

  if (fix->ret == NULL)
    expect_message = "invalid";

  if (fix->conversation)
    conversation = strdup (fix->conversation);

  result = cockpit_authorize_build_x_conversation (fix->input, &conversation);
  if (fix->errn != 0)
    assert_num_eq (errno, fix->errn);
  if (fix->ret)
    {
      if (strstr (fix->ret, "X-Conversation"))
        assert_str_eq (result, fix->ret);
      else
        assert (strstr (result, fix->ret));
      free (result);
    }
  else
    {
      assert (result == NULL);
    }

  free (conversation);
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
    {
      re_testx (test_type, type_fixtures + i,
                "/authorize/type/%s", type_fixtures[i].input);
    }
  for (i = 0; subject_fixtures[i].input != NULL; i++)
    {
      re_testx (test_subject, subject_fixtures + i,
                "/authorize/subject/%s", subject_fixtures[i].input);
    }
  for (i = 0; basic_fixtures[i].input != NULL; i++)
    {
      re_testx (test_parse_basic, basic_fixtures + i,
                "/authorize/basic/%s", basic_fixtures[i].input);
    }
  for (i = 0; parse_negotiate_fixtures[i].input != NULL; i++)
    {
      re_testx (test_parse_negotiate, parse_negotiate_fixtures + i,
                "/authorize/negotiate/parse/%s", parse_negotiate_fixtures[i].input);
    }
  for (i = 0; build_negotiate_fixtures[i].ret != NULL; i++)
    {
      re_testx (test_build_negotiate, build_negotiate_fixtures + i,
                "/authorize/negotiate/build/%s", build_negotiate_fixtures[i].ret);
    }
  for (i = 0; parse_x_conversation_fixtures[i].input != NULL; i++)
    {
      re_testx (test_parse_x_conversation, parse_x_conversation_fixtures + i,
                "/authorize/x-conversation/parse/%s", parse_x_conversation_fixtures[i].input);
    }
  for (i = 0; build_x_conversation_fixtures[i].input || build_x_conversation_fixtures[i].ret; i++)
    {
      re_testx (test_build_x_conversation, build_x_conversation_fixtures + i,
                "/authorize/x-conversation/build/%s", build_x_conversation_fixtures[i].input);
    }

  return re_test_run (argc, argv);
}
