/*
 * SPDX-License-Identifier: BSD-3-Clause
 * Copyright (c) 2014 Red Hat Inc.
 * Author: Stef Walter <stefw@redhat.com>
 */

#include "config.h"

#include "cockpitauthorize.h"
#include "testlib/cockpittest.h"

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
  g_assert_nonnull (msg);

  if (expect_message)
    {
      g_assert_nonnull (strstr (msg, expect_message));
      expect_message = NULL;
    }
  else
    {
      warnx ("%s", msg);
    }
}

static void
setup (char **user_ptr,
       gconstpointer data)
{
  struct passwd *pw;

  expect_message = NULL;

  pw = getpwuid (getuid ());
  g_assert_nonnull (pw);
  *user_ptr = g_strdup (pw->pw_name);
  user = *user_ptr;
}

static void
teardown (char **user_ptr,
          gconstpointer data)
{
  if (expect_message)
    g_assert_not_reached ();
  g_free (*user_ptr);
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
test_type (char **user_ptr,
           gconstpointer data)
{
  const ChallengeFixture *fix = data;
  const char *result;
  g_autofree char *type = NULL;

  result = cockpit_authorize_type (fix->input, &type);
  if (fix->errn != 0)
    g_assert_cmpint (errno, ==, fix->errn);
  if (fix->ret)
    {
      g_assert_cmpstr (result, ==, fix->ret);
      g_assert_cmpstr (type, ==, fix->expected);
    }
  else
    {
      g_assert_null (result);
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
test_subject (char **user_ptr,
              gconstpointer data)
{
  const ChallengeFixture *fix = data;
  const char *result;
  g_autofree char *subject = NULL;

  if (fix->ret == NULL)
    expect_message = "\"authorize\" message";

  result = cockpit_authorize_subject (fix->input, &subject);
  if (fix->errn != 0)
    g_assert_cmpint (errno, ==, fix->errn);
  if (fix->ret)
    {
      g_assert_cmpstr (result, ==, fix->ret);
      g_assert_cmpstr (subject, ==, fix->expected);
    }
  else
    {
      g_assert_null (result);
    }
}

static ChallengeFixture basic_fixtures[] = {
  { "Basic c2NydWZmeTp6ZXJvZw==", "scruffy", "zerog", 0 },
  { "Basic!c2NydWZmeTp6ZXJvZw==", NULL, NULL, EINVAL },
  { "Basic c2NydWZ!!eXplcm9n", NULL, NULL, EINVAL },
  { "Basic c2NydWZmeXplcm9n", NULL, NULL, EINVAL },
  { "Basic", NULL, "", 0 },
  { NULL },
};

static void
test_parse_basic (char **user_ptr,
                  gconstpointer data)
{
  const ChallengeFixture *fix = data;
  const char *original = "blah";
  char *user = (char *)original;
  g_autofree char *password = NULL;

  if (fix->ret == NULL)
    expect_message = "invalid";

  password = cockpit_authorize_parse_basic (fix->input, &user);
  if (fix->errn != 0)
    g_assert_cmpint (errno, ==, fix->errn);
  if (fix->ret)
    {
      g_assert_cmpstr (password, ==, fix->ret);
      if (fix->expected)
        g_assert_cmpstr (user, ==, fix->expected);
      else
        g_assert_null (user);
    }
  else
    {
      g_assert_null (password);
      g_assert_cmpstr (user, ==, "blah"); /* not reassigned */
    }

  if (user != original)
    g_free (user);
  g_clear_pointer (&password, g_free);

  if (fix->ret == NULL)
    expect_message = "invalid";

  password = cockpit_authorize_parse_basic (fix->input, NULL);
  if (fix->errn != 0)
    g_assert_cmpint (errno, ==, fix->errn);
  if (fix->ret)
    {
      g_assert_cmpstr (password, ==, fix->ret);
    }
  else
    {
      g_assert_null (password);
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
  { "Negotiate", 0, "", 0 },
  { NULL },
};

static void
test_parse_negotiate (char **user_ptr,
                      gconstpointer data)
{
  const NegotiateFixture *fix = data;
  size_t length = 0xFFFFDD;
  g_autofree void *result = NULL;

  if (fix->ret == NULL)
    expect_message = "invalid";

  result = cockpit_authorize_parse_negotiate (fix->input, &length);
  if (fix->errn != 0)
    g_assert_cmpint (errno, ==, fix->errn);
  if (fix->ret)
    {
      g_assert_cmpuint (fix->length, ==, length);
      g_assert_cmpint (memcmp (result, fix->ret, length), ==, 0);
    }
  else
    {
      g_assert_null (result);
      g_assert_cmpuint (length, ==, 0xFFFFDD); /* not reassigned */
    }

  g_clear_pointer (&result, g_free);

  if (fix->ret == NULL)
    expect_message = "invalid";

  result = cockpit_authorize_parse_negotiate (fix->input, NULL);
  if (fix->errn != 0)
    g_assert_cmpint (errno, ==, fix->errn);
  if (fix->ret)
    {
      g_assert_cmpint (memcmp (result, fix->ret, fix->length), ==, 0);
    }
  else
    {
      g_assert_null (result);
    }
}

static NegotiateFixture build_negotiate_fixtures[] = {
  { "scruffy:zerog", 13, "Negotiate c2NydWZmeTp6ZXJvZw==", 0 },
  { NULL, 0, "Negotiate", 0, },
  { NULL },
};

static void
test_build_negotiate (char **user_ptr,
                      gconstpointer data)
{
  const NegotiateFixture *fix = data;
  g_autofree char *result = NULL;

  if (fix->ret == NULL)
    expect_message = "invalid";

  result = cockpit_authorize_build_negotiate (fix->input, fix->length);
  if (fix->errn != 0)
    g_assert_cmpint (errno, ==, fix->errn);
  if (fix->ret)
    {
      g_assert_cmpstr (result, ==, fix->ret);
    }
  else
    {
      g_assert_null (result);
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
test_parse_x_conversation (char **user_ptr,
                           gconstpointer data)
{
  const XConversationFixture *fix = data;
  g_autofree char *result = NULL;

  if (fix->ret == NULL)
    expect_message = "invalid";

  result = cockpit_authorize_parse_x_conversation (fix->input, NULL);
  if (fix->errn != 0)
    g_assert_cmpint (errno, ==, fix->errn);
  if (fix->ret)
    {
      g_assert_cmpstr (result, ==, fix->ret);
    }
  else
    {
      g_assert_null (result);
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
test_build_x_conversation (char **user_ptr,
                           gconstpointer data)
{
  const XConversationFixture *fix = data;
  g_autofree char *conversation = NULL;
  g_autofree char *result = NULL;

  if (fix->ret == NULL)
    expect_message = "invalid";

  if (fix->conversation)
    conversation = g_strdup (fix->conversation);

  result = cockpit_authorize_build_x_conversation (fix->input, &conversation);
  if (fix->errn != 0)
    g_assert_cmpint (errno, ==, fix->errn);
  if (fix->ret)
    {
      if (strstr (fix->ret, "X-Conversation"))
        g_assert_cmpstr (result, ==, fix->ret);
      else
        g_assert_nonnull (strstr (result, fix->ret));
    }
  else
    {
      g_assert_null (result);
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

  cockpit_test_init (&argc, &argv);

  for (i = 0; type_fixtures[i].input != NULL; i++)
    {
      g_autofree gchar *name = g_strdup_printf ("/authorize/type/%s", type_fixtures[i].input);
      g_test_add (name, char *, type_fixtures + i,
                  setup, test_type, teardown);
    }
  for (i = 0; subject_fixtures[i].input != NULL; i++)
    {
      g_autofree gchar *name = g_strdup_printf ("/authorize/subject/%s", subject_fixtures[i].input);
      g_test_add (name, char *, subject_fixtures + i,
                  setup, test_subject, teardown);
    }
  for (i = 0; basic_fixtures[i].input != NULL; i++)
    {
      g_autofree gchar *name = g_strdup_printf ("/authorize/basic/%s", basic_fixtures[i].input);
      g_test_add (name, char *, basic_fixtures + i,
                  setup, test_parse_basic, teardown);
    }
  for (i = 0; parse_negotiate_fixtures[i].input != NULL; i++)
    {
      g_autofree gchar *name = g_strdup_printf ("/authorize/negotiate/parse/%s", parse_negotiate_fixtures[i].input);
      g_test_add (name, char *, parse_negotiate_fixtures + i,
                  setup, test_parse_negotiate, teardown);
    }
  for (i = 0; build_negotiate_fixtures[i].ret != NULL; i++)
    {
      g_autofree gchar *name = g_strdup_printf ("/authorize/negotiate/build/%s", build_negotiate_fixtures[i].ret);
      g_test_add (name, char *, build_negotiate_fixtures + i,
                  setup, test_build_negotiate, teardown);
    }
  for (i = 0; parse_x_conversation_fixtures[i].input != NULL; i++)
    {
      g_autofree gchar *name = g_strdup_printf ("/authorize/x-conversation/parse/%s", parse_x_conversation_fixtures[i].input);
      g_test_add (name, char *, parse_x_conversation_fixtures + i,
                  setup, test_parse_x_conversation, teardown);
    }
  for (i = 0; build_x_conversation_fixtures[i].input || build_x_conversation_fixtures[i].ret; i++)
    {
      g_autofree gchar *name = g_strdup_printf ("/authorize/x-conversation/build/%d", i);
      g_test_add (name, char *, build_x_conversation_fixtures + i,
                  setup, test_build_x_conversation, teardown);
    }

  return g_test_run ();
}
