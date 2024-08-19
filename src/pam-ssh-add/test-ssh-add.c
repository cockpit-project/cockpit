/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
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

#include "pam-ssh-add.h"

#include "testlib/retest.h"

#include <sys/types.h>
#include <sys/wait.h>
#include <sys/queue.h>

#include <err.h>
#include <errno.h>
#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

static int unexpected_message;

/* Environment variables we set */
static const char *env_names[] = {
  "XDG_RUNTIME_DIR",
  "HOME",
  "PATH",
  "LC_ALL",
  "SSH_AUTH_SOCK",
  NULL
};


/* Holds environment values to set in pam context */
static char *env_saved[N_ELEMENTS (env_names)] = { NULL, };

typedef struct {
  const char *ssh_add;
  const char *ssh_add_arg;
  const char *ssh_agent;
  const char *ssh_agent_arg;
  const char *password;
  struct passwd *pw;
} Fixture;

struct _ExpectedMessage {
  const char *line;
  TAILQ_ENTRY (_ExpectedMessage) messages;
};

TAILQ_HEAD (ExpectedList, _ExpectedMessage) el_head;

typedef struct _ExpectedMessage ExpectedMessage;

static void
expect_message (const char *msg)
{
  ExpectedMessage *em = NULL;
  em = (ExpectedMessage *) malloc(sizeof(ExpectedMessage));
  if (em == NULL)
    assert_not_reached ("expected message allocation failed");
  em->line = msg;
  TAILQ_INSERT_TAIL (&el_head, em, messages);
}

static void
test_logger (int level, const char *msg)
{
  assert (msg != NULL);
  if (el_head.tqh_first != NULL)
    {
      ExpectedMessage *em = el_head.tqh_first;
      assert_str_contains (msg, em->line);
      TAILQ_REMOVE (&el_head, el_head.tqh_first, messages);
      free (em);
    }
  else
    {
      warnx ("%s", msg);
      unexpected_message = 1;
    }
}

static void
save_environment (void)
{
  int i;

  for (i = 0; env_names[i] != NULL; i++)
    env_saved[i] = getenv (env_names[i]);
}

static void
restore_environment (void)
{
  int i;
  for (i = 0; env_names[i] != NULL; i++)
    {
      if (env_saved[i])
        setenv (env_names[i], env_saved[i], 1);
      else
        unsetenv (env_names[i]);
    }
}

static void
setup (void *arg)
{
  Fixture *fix = arg;
  unexpected_message = 0;
  if (!fix->ssh_add)
    fix->ssh_add = SRCDIR "/src/pam-ssh-add/mock-ssh-add";

  if (!fix->ssh_agent)
    fix->ssh_agent = SRCDIR "/src/pam-ssh-add/mock-ssh-agent";

  pam_ssh_add_program = fix->ssh_add;
  pam_ssh_add_arg = fix->ssh_add_arg;
  pam_ssh_agent_program = fix->ssh_agent;
  pam_ssh_agent_arg = fix->ssh_agent_arg;
  fix->pw = getpwuid (getuid ());
}

static void
teardown (void *arg)
{
  int missed = 0;

  // restore original environment
  restore_environment ();

  while (el_head.tqh_first != NULL)
    {
      ExpectedMessage *em = el_head.tqh_first;
      warnx ("message didn't get logged: %s", em->line);
      TAILQ_REMOVE (&el_head, el_head.tqh_first, messages);
      free (em);
      missed = 1;
    }

  if (missed)
    assert_not_reached ("expected messages didn't get logged");

  if (unexpected_message)
    assert_not_reached ("got unexpected messages");

}

static Fixture default_fixture = {
};

static Fixture environment_fixture = {
  .ssh_agent = SRCDIR "/src/pam-ssh-add/mock-environment",
  .ssh_agent_arg = NULL
};

static void
run_test_agent_environment (void *data,
                            const char *xdg_runtime,
                            const char *xdg_runtime_expect)
{
  Fixture *fix = data;
  int ret;
  char *xdg_expect = NULL;
  char *home_expect = NULL;

  if (xdg_runtime_expect)
    {
      if (asprintf (&xdg_expect, "XDG_RUNTIME_DIR=%s",
                    xdg_runtime_expect) < 0)
        warnx ("Couldn't allocate XDG_RUNTIME_DIR expect variable");
    }
  else
    {
      xdg_expect = strdup ("NO XDG_RUNTIME_DIR");
    }

  if (asprintf (&home_expect, "HOME=%s", fix->pw->pw_dir) < 0)
    warnx ("Couldn't allocate HOME expect variable");

  expect_message (xdg_expect);
  expect_message (home_expect);

  expect_message ("PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin");
  expect_message ("LC_ALL=C");
  expect_message ("NO OTHER");

  expect_message ("NO SSH_AUTH_SOCK");
  expect_message ("Failed to start ssh-agent");

  ret = pam_ssh_add_start_agent (NULL, fix->pw, xdg_runtime, NULL, NULL);

  assert_num_eq (0, ret);

  free (xdg_expect);
  free (home_expect);
}

static void
test_environment (void *data)
{
  run_test_agent_environment (data, NULL, getenv ("XDG_RUNTIME_DIR"));
}

static void
test_environment_env_overides (void *data)
{
  setenv ("PATH", "bad", 1);
  setenv ("LC_ALL", "bad", 1);
  setenv ("HOME", "bad", 1);
  setenv ("XDG_RUNTIME_DIR", "", 1);
  setenv ("SSH_AUTH_SOCK", "bad", 1);
  setenv ("OTHER", "bad", 1);

  run_test_agent_environment (data, NULL, "");
}

static void
test_environment_overides (void *data)
{
  setenv ("XDG_RUNTIME_DIR", "bad", 1);
  run_test_agent_environment (data, "xdgover", "xdgover");
}

static void
test_failed_agent (void *data)
{
  Fixture *fix = data;
  char *sock = NULL;
  char *pid = NULL;
  int ret;

  expect_message ("Bad things");
  expect_message ("Failed to start ssh-agent");
  ret = pam_ssh_add_start_agent (NULL, fix->pw, NULL, &sock, &pid);

  assert_num_eq (0, ret);
  assert_ptr_eq (sock, NULL);
  assert_ptr_eq (pid, NULL);

  free (sock);
  free (pid);
}

static Fixture bad_agent_fixture = {
  .ssh_agent_arg = "bad-vars",
};

static void
test_bad_agent_vars (void *data)
{
  Fixture *fix = data;
  char *sock = NULL;
  char *pid = NULL;
  int ret;

  expect_message ("Expected agent environment variables not found");
  ret = pam_ssh_add_start_agent (NULL, fix->pw, NULL, &sock, &pid);

  assert_num_eq (0, ret);
  assert_ptr_eq (sock, NULL);
  assert_ptr_eq (pid, NULL);

  free (sock);
  free (pid);
}

static Fixture good_agent_fixture = {
  .ssh_agent_arg = "good-vars",
};

static void
test_good_agent_vars (void *data)
{
  Fixture *fix = data;
  char *sock = NULL;
  char *pid = NULL;
  int ret;

  ret = pam_ssh_add_start_agent (NULL, fix->pw, NULL, &sock, &pid);

  assert_num_eq (1, ret);
  assert_str_cmp (sock, ==, "SSH_AUTH_SOCKET=socket");
  assert_str_cmp (pid, ==, "SSH_AGENT_PID=100");

  free (sock);
  free (pid);
}

static Fixture keys_password_fixture = {
  .ssh_add_arg = NULL,
  .password = "foobar",
};

static Fixture keys_no_password_fixture = {
  .ssh_add_arg = NULL,
  .password = NULL,
};

static Fixture keys_bad_password_fixture = {
  .ssh_add_arg = NULL,
  .password = "bad",
};

static void
test_keys (void *data)
{
  int ret;
  int expect = 1;
  Fixture *fix = data;
  const char *key_add_result;

  if (fix->password == NULL)
    {
      key_add_result = "Correct password 0, bad password 0, password_blanks 3";
    }
  else if (strcmp (fix->password, "foobar") == 0)
    {
      expect = 0;
      key_add_result = "Correct password 3, bad password 0, password_blanks 0";
    }
  else
    {
      key_add_result = "Correct password 0, bad password 3, password_blanks 3";
    }

  expect_message (key_add_result);
  if (expect)
    expect_message ("Failed adding some keys");

  ret = pam_ssh_add_load (NULL, fix->pw, "mock-socket", fix->password);

  assert_num_eq (1, ret);
}

static Fixture keys_environment_fixture = {
  .ssh_add = SRCDIR "/src/pam-ssh-add/mock-environment",
  .ssh_add_arg = NULL
};

static void
test_key_environment (void *data)
{
  Fixture *fix = data;
  int ret;
  char *home_expect = NULL;

  expect_message ("ssh-add requires an agent socket");
  ret = pam_ssh_add_load (NULL, fix->pw, NULL, NULL);
  assert_num_eq (0, ret);

  if (asprintf (&home_expect, "HOME=%s", fix->pw->pw_dir) < 0)
    warnx ("Couldn't allocate HOME expect variable");

  expect_message ("NO XDG_RUNTIME_DIR");
  expect_message (home_expect);

  expect_message ("PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin");
  expect_message ("LC_ALL=C");
  expect_message ("NO OTHER");

  expect_message ("SSH_AUTH_SOCK=mock-socket");
  expect_message ("Failed adding some keys");

  ret = pam_ssh_add_load (NULL, fix->pw, "mock-socket", NULL);

  assert_num_eq (1, ret);

  free (home_expect);
}

int
main (int argc,
      char *argv[])
{
  signal (SIGPIPE, SIG_IGN);

  TAILQ_INIT(&el_head);

  save_environment ();

  re_fixture (setup, teardown);

  pam_ssh_add_log_handler = &test_logger;
  pam_ssh_add_verbose_mode = 0;

  re_testx (test_key_environment, &keys_environment_fixture,
            "/pam-ssh-add/add-key-environment");
  re_testx (test_keys, &keys_no_password_fixture,
            "/pam-ssh-add/add-key-no-password");
  re_testx (test_keys, &keys_bad_password_fixture,
            "/pam-ssh-add/add-key-bad-password");
  re_testx (test_keys, &keys_password_fixture,
            "/pam-ssh-add/add-key-password");

  re_testx (test_environment, &environment_fixture,
            "/pam-ssh-add/environment");
  re_testx (test_environment_env_overides, &environment_fixture,
            "/pam-ssh-add/environment-env-overides");
  re_testx (test_environment_overides, &environment_fixture,
            "/pam-ssh-add/environment-overides");
  re_testx (test_good_agent_vars, &good_agent_fixture,
            "/pam-ssh-add/good-agent-vars");
  re_testx (test_bad_agent_vars, &bad_agent_fixture,
            "/pam-ssh-add/bad-agent-vars");
  re_testx (test_failed_agent, &default_fixture,
            "/pam-ssh-add/test-failed-agent");

  return re_test_run (argc, argv);
}
