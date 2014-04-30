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

#include "retest.h"

#include "reauthorize.h"

#include <sys/socket.h>
#include <sys/types.h>
#include <sys/un.h>

#include <err.h>
#include <errno.h>
#include <keyutils.h>
#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

static const char *expect_message;

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

  expect_message = NULL;

  keyring = keyctl_join_session_keyring (NULL);
  assert (keyring >= 0);
}

static void
teardown (void *arg)
{
  if (expect_message)
    assert_fail ("message didn't get logged", expect_message);
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
  char *user;

  if (fix->ret != 0)
    expect_message = "invalid reauthorize challenge";

  assert_num_eq (reauthorize_user (fix->challenge, &user), fix->ret);
  if (fix->ret == 0)
    {
      assert_str_eq (user, fix->expected);
      free (user);
    }
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
test_listen_chat (void)
{
  int connection;
  char *challenge;
  int sock;

  assert_num_eq (reauthorize_listen (0, &sock), 0);
  assert_num_cmp (sock, >=, 0);

  if (re_test_fork ())
    {
      struct sockaddr *addr;
      socklen_t addr_len;
      key_serial_t key;
      char *response;
      int client;

      close (sock);

      key = keyctl_search (KEY_SPEC_SESSION_KEYRING, "user", "reauthorize/socket", 0);
      assert_num_cmp (key, >=, 0);
      addr_len = keyctl_read_alloc (key, (void *)&addr);
      assert_num_cmp (addr_len, >=, sizeof (sa_family_t));
      assert_num_cmp (addr_len, <=, sizeof (struct sockaddr_un));
      client = socket (AF_UNIX, SOCK_SEQPACKET, 0);
      assert_num_cmp (client, >, 0);
      assert_num_cmp (connect (client, addr, addr_len), >=, 0);

      assert_num_eq (reauthorize_send (client, "Marmalaaade!"), 0);

      assert_num_eq (reauthorize_recv (client, &response), 0);
      assert_str_eq (response, "Zerogjuggs");
      free (response);
      assert_num_eq (shutdown (client, SHUT_WR), 0);

      return;
    }

  assert_num_eq (reauthorize_accept (sock, &connection), 0);
  assert_num_cmp (connection, >=, 0);

  assert_num_eq (reauthorize_recv (connection, &challenge), 0);
  assert_str_eq (challenge, "Marmalaaade!");

  assert_num_eq (reauthorize_send (connection, "Zerogjuggs"), 0);

  free (challenge);
  assert_num_eq (shutdown (connection, SHUT_WR), 0);

  close (sock);
}
static void
test_listen_bad_data (void)
{
  int connection;
  char *challenge;
  int sock;

  assert_num_eq (reauthorize_listen (0, &sock), 0);
  assert_num_cmp (sock, >=, 0);

  if (re_test_fork ())
    {
      struct sockaddr *addr;
      socklen_t addr_len;
      key_serial_t key;
      char *response;
      int client;

      close (sock);

      key = keyctl_search (KEY_SPEC_SESSION_KEYRING, "user", "reauthorize/socket", 0);
      assert_num_cmp (key, >=, 0);
      addr_len = keyctl_read_alloc (key, (void *)&addr);
      assert_num_cmp (addr_len, >=, sizeof (sa_family_t));
      assert_num_cmp (addr_len, <=, sizeof (struct sockaddr_un));
      client = socket (AF_UNIX, SOCK_SEQPACKET, 0);
      assert_num_cmp (client, >, 0);
      assert_num_cmp (connect (client, addr, addr_len), >=, 0);

      /* message contains nul bytes: invalid */
      assert_num_eq (send (client, "1\x00z", 3, 0), 3);

      expect_message = "invalid null characters";

      assert_num_eq (reauthorize_recv (client, &response), -EINVAL);
      assert_num_eq (shutdown (client, SHUT_WR), 0);

      return;
    }

  assert_num_eq (reauthorize_accept (sock, &connection), 0);
  assert_num_cmp (connection, >=, 0);

  expect_message = "invalid null characters";

  assert_num_eq (reauthorize_recv (connection, &challenge), -EINVAL);

  /* message contains nul bytes: invalid */
  assert_num_eq (send (connection, "2\x00z", 3, 0), 3);

  assert_num_eq (shutdown (connection, SHUT_WR), 0);
  close (sock);
}

static void
test_listen_replace (void)
{
  int connection;
  char *challenge;
  int sock;

  assert_num_eq (reauthorize_listen (0, &sock), 0);
  assert_num_cmp (sock, >=, 0);

  /* That socket went away */
  close (sock);

  /* But another one takes its place */
  assert_num_eq (reauthorize_listen (REAUTHORIZE_REPLACE, &sock), 0);
  assert_num_cmp (sock, >=, 0);

  if (re_test_fork ())
    {
      struct sockaddr *addr;
      socklen_t addr_len;
      key_serial_t key;
      int client;

      close (sock);

      key = keyctl_search (KEY_SPEC_SESSION_KEYRING, "user", "reauthorize/socket", 0);
      assert_num_cmp (key, >=, 0);
      addr_len = keyctl_read_alloc (key, (void *)&addr);
      assert_num_cmp (addr_len, >=, sizeof (sa_family_t));
      assert_num_cmp (addr_len, <=, sizeof (struct sockaddr_un));
      client = socket (AF_UNIX, SOCK_SEQPACKET, 0);
      assert_num_cmp (client, >, 0);
      assert_num_cmp (connect (client, addr, addr_len), >=, 0);

      assert_num_eq (reauthorize_send (client, "Marmalaaadeo!"), 0);

      assert_num_eq (shutdown (client, SHUT_WR), 0);
      return;
    }

  assert_num_eq (reauthorize_accept (sock, &connection), 0);
  assert_num_cmp (connection, >=, 0);

  assert_num_eq (reauthorize_recv (connection, &challenge), 0);
  assert_str_eq (challenge, "Marmalaaadeo!");

  free (challenge);
  assert_num_eq (shutdown (connection, SHUT_WR), 0);

  close (sock);
}

static void
test_listen_replace_fail (void)
{
  int sock;
  int sock2;

  expect_message = "couldn't bind socket";

  assert_num_eq (reauthorize_listen (0, &sock), 0);
  assert_num_cmp (sock, >=, 0);

  assert_num_eq (reauthorize_listen (REAUTHORIZE_REPLACE, &sock2), -EADDRINUSE);

  close (sock);
}

static void
test_listen_replace_invalid (void)
{
  key_serial_t key;
  int sock;

  expect_message = "socket address to replace was invalid";

  key = add_key ("user", "reauthorize/socket", "x", 1, KEY_SPEC_SESSION_KEYRING);
  assert_num_cmp (key, >=, 0);

  assert_num_eq (reauthorize_listen (REAUTHORIZE_REPLACE, &sock), -EMSGSIZE);
}

static void
test_listen_replace_nothing (void)
{
  int sock;

  assert_num_eq (reauthorize_listen (REAUTHORIZE_REPLACE, &sock), 0);
  assert_num_cmp (sock, >=, 0);

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

  re_test (test_listen_chat, "/reauthorize/listen-chat");
  re_test (test_listen_bad_data, "/reauthorize/listen-bad-data");
  re_test (test_listen_replace, "/reauthorize/listen-replace");
  re_test (test_listen_replace_fail, "/reauthorize/listen-replace-fail");
  re_test (test_listen_replace_invalid, "/reauthorize/listen-replace-invalid");
  re_test (test_listen_replace_nothing, "/reauthorize/listen-replace-nothing");

  for (i = 0; type_fixtures[i].challenge != NULL; i++)
    re_testx (test_type, type_fixtures + i,
              "/reauthorize/type/%s", type_fixtures[i].challenge);
  for (i = 0; user_fixtures[i].challenge != NULL; i++)
    re_testx (test_user, user_fixtures + i,
              "/reauthorize/user/%s", user_fixtures[i].challenge);
  for (i = 0; crypt1_fixtures[i].challenge != NULL; i++)
    re_testx (test_crypt1, crypt1_fixtures + i,
              "/reauthorize/crypt1/%s", crypt1_fixtures[i].challenge);

  return re_test_run (argc, argv);
}
