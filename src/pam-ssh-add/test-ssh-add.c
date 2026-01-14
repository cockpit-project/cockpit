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

#include "testlib/cockpittest.h"

#include <sys/types.h>
#include <sys/wait.h>

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
static char *env_saved[G_N_ELEMENTS (env_names)] = { NULL, };

/* Dummy PAM handle for testing purposes; pam_handle_t is opaque */
static char dummy_pamh_buf[256];
static pam_handle_t *dummy_pamh = (pam_handle_t *)dummy_pamh_buf;

typedef struct {
  const char *ssh_add;
  const char *ssh_add_arg;
  const char *ssh_agent;
  const char *ssh_agent_arg;
  const char *password;
  struct passwd *pw;
  GQueue *expected_messages;
} Fixture;

static void
expect_message (Fixture *fix,
                const char *msg)
{
  g_queue_push_tail (fix->expected_messages, g_strdup (msg));
}

static void
test_logger (int level, const char *msg)
{
  Fixture *fix = NULL;
  g_assert_nonnull (msg);

  /* We need to access the current fixture, stored in a global for this callback */
  extern Fixture *current_fixture;
  fix = current_fixture;

  if (fix && !g_queue_is_empty (fix->expected_messages))
    {
      gchar *expected = g_queue_pop_head (fix->expected_messages);
      g_assert_nonnull (strstr (msg, expected));
      g_free (expected);
    }
  else
    {
      warnx ("%s", msg);
      unexpected_message = 1;
    }
}

/* Global pointer to current fixture for logger callback */
Fixture *current_fixture = NULL;

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
setup (Fixture *fix,
       gconstpointer user_data)
{
  const Fixture *template = user_data;

  unexpected_message = 0;
  fix->expected_messages = g_queue_new ();
  current_fixture = fix;

  if (template)
    {
      fix->ssh_add = template->ssh_add;
      fix->ssh_add_arg = template->ssh_add_arg;
      fix->ssh_agent = template->ssh_agent;
      fix->ssh_agent_arg = template->ssh_agent_arg;
      fix->password = template->password;
    }

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
teardown (Fixture *fix,
          gconstpointer user_data)
{
  gchar *msg;
  int missed = 0;

  /* restore original environment */
  restore_environment ();

  while (!g_queue_is_empty (fix->expected_messages))
    {
      msg = g_queue_pop_head (fix->expected_messages);
      warnx ("message didn't get logged: %s", msg);
      g_free (msg);
      missed = 1;
    }

  g_queue_free (fix->expected_messages);
  current_fixture = NULL;

  if (missed)
    g_assert_not_reached ();

  if (unexpected_message)
    g_assert_not_reached ();
}

static Fixture default_fixture = {
};

static Fixture environment_fixture = {
  .ssh_agent = SRCDIR "/src/pam-ssh-add/mock-environment",
  .ssh_agent_arg = NULL
};

static void
run_test_agent_environment (Fixture *fix,
                            const char *xdg_runtime,
                            const char *xdg_runtime_expect)
{
  int ret;
  g_autofree char *xdg_expect = NULL;
  g_autofree char *home_expect = NULL;

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

  expect_message (fix, xdg_expect);
  expect_message (fix, home_expect);

  expect_message (fix, "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin");
  expect_message (fix, "LC_ALL=C");
  expect_message (fix, "NO OTHER");

  expect_message (fix, "NO SSH_AUTH_SOCK");
  expect_message (fix, "Failed to start ssh-agent");

  ret = pam_ssh_add_start_agent (dummy_pamh, fix->pw, xdg_runtime, NULL, NULL);

  g_assert_cmpint (ret, ==, 0);
}

static void
test_environment (Fixture *fix,
                  gconstpointer user_data)
{
  run_test_agent_environment (fix, NULL, getenv ("XDG_RUNTIME_DIR"));
}

static void
test_environment_env_overides (Fixture *fix,
                               gconstpointer user_data)
{
  setenv ("PATH", "bad", 1);
  setenv ("LC_ALL", "bad", 1);
  setenv ("HOME", "bad", 1);
  setenv ("XDG_RUNTIME_DIR", "", 1);
  setenv ("SSH_AUTH_SOCK", "bad", 1);
  setenv ("OTHER", "bad", 1);

  run_test_agent_environment (fix, NULL, "");
}

static void
test_environment_overides (Fixture *fix,
                           gconstpointer user_data)
{
  setenv ("XDG_RUNTIME_DIR", "bad", 1);
  run_test_agent_environment (fix, "xdgover", "xdgover");
}

static void
test_failed_agent (Fixture *fix,
                   gconstpointer user_data)
{
  g_autofree char *sock = NULL;
  g_autofree char *pid = NULL;
  int ret;

  expect_message (fix, "Bad things");
  expect_message (fix, "Failed to start ssh-agent");
  ret = pam_ssh_add_start_agent (dummy_pamh, fix->pw, NULL, &sock, &pid);

  g_assert_cmpint (ret, ==, 0);
  g_assert_null (sock);
  g_assert_null (pid);
}

static Fixture bad_agent_fixture = {
  .ssh_agent_arg = "bad-vars",
};

static void
test_bad_agent_vars (Fixture *fix,
                     gconstpointer user_data)
{
  g_autofree char *sock = NULL;
  g_autofree char *pid = NULL;
  int ret;

  expect_message (fix, "Expected agent environment variables not found");
  ret = pam_ssh_add_start_agent (dummy_pamh, fix->pw, NULL, &sock, &pid);

  g_assert_cmpint (ret, ==, 0);
  g_assert_null (sock);
  g_assert_null (pid);
}

static Fixture good_agent_fixture = {
  .ssh_agent_arg = "good-vars",
};

static void
test_good_agent_vars (Fixture *fix,
                      gconstpointer user_data)
{
  g_autofree char *sock = NULL;
  g_autofree char *pid = NULL;
  int ret;

  ret = pam_ssh_add_start_agent (dummy_pamh, fix->pw, NULL, &sock, &pid);

  g_assert_cmpint (ret, ==, 1);
  g_assert_cmpstr (sock, ==, "SSH_AUTH_SOCKET=socket");
  g_assert_cmpstr (pid, ==, "SSH_AGENT_PID=100");
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
test_keys (Fixture *fix,
           gconstpointer user_data)
{
  int ret;
  int expect = 1;
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

  expect_message (fix, key_add_result);
  if (expect)
    expect_message (fix, "Failed adding some keys");

  ret = pam_ssh_add_load (dummy_pamh, fix->pw, "mock-socket", fix->password);

  g_assert_cmpint (ret, ==, 1);
}

static Fixture keys_environment_fixture = {
  .ssh_add = SRCDIR "/src/pam-ssh-add/mock-environment",
  .ssh_add_arg = NULL
};

static void
test_key_environment (Fixture *fix,
                      gconstpointer user_data)
{
  int ret;
  g_autofree char *home_expect = NULL;

  expect_message (fix, "ssh-add requires an agent socket");
  ret = pam_ssh_add_load (dummy_pamh, fix->pw, NULL, NULL);
  g_assert_cmpint (ret, ==, 0);

  if (asprintf (&home_expect, "HOME=%s", fix->pw->pw_dir) < 0)
    warnx ("Couldn't allocate HOME expect variable");

  expect_message (fix, "NO XDG_RUNTIME_DIR");
  expect_message (fix, home_expect);

  expect_message (fix, "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin");
  expect_message (fix, "LC_ALL=C");
  expect_message (fix, "NO OTHER");

  expect_message (fix, "SSH_AUTH_SOCK=mock-socket");
  expect_message (fix, "Failed adding some keys");

  ret = pam_ssh_add_load (dummy_pamh, fix->pw, "mock-socket", NULL);

  g_assert_cmpint (ret, ==, 1);
}

int
main (int argc,
      char *argv[])
{
  signal (SIGPIPE, SIG_IGN);

  save_environment ();

  pam_ssh_add_log_handler = &test_logger;
  pam_ssh_add_verbose_mode = 0;

  cockpit_test_init (&argc, &argv);

  g_test_add ("/pam-ssh-add/add-key-environment", Fixture, &keys_environment_fixture,
              setup, test_key_environment, teardown);
  g_test_add ("/pam-ssh-add/add-key-no-password", Fixture, &keys_no_password_fixture,
              setup, test_keys, teardown);
  g_test_add ("/pam-ssh-add/add-key-bad-password", Fixture, &keys_bad_password_fixture,
              setup, test_keys, teardown);
  g_test_add ("/pam-ssh-add/add-key-password", Fixture, &keys_password_fixture,
              setup, test_keys, teardown);

  g_test_add ("/pam-ssh-add/environment", Fixture, &environment_fixture,
              setup, test_environment, teardown);
  g_test_add ("/pam-ssh-add/environment-env-overides", Fixture, &environment_fixture,
              setup, test_environment_env_overides, teardown);
  g_test_add ("/pam-ssh-add/environment-overides", Fixture, &environment_fixture,
              setup, test_environment_overides, teardown);
  g_test_add ("/pam-ssh-add/good-agent-vars", Fixture, &good_agent_fixture,
              setup, test_good_agent_vars, teardown);
  g_test_add ("/pam-ssh-add/bad-agent-vars", Fixture, &bad_agent_fixture,
              setup, test_bad_agent_vars, teardown);
  g_test_add ("/pam-ssh-add/test-failed-agent", Fixture, &default_fixture,
              setup, test_failed_agent, teardown);

  return g_test_run ();
}
