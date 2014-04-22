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

#include "config.h"

#include "cockpitsshtransport.h"

#include "cockpit/cockpittest.h"

#include <libssh/libssh.h>

#include <sys/wait.h>
#include <errno.h>
#include <stdlib.h>

/*
 * You can sorta cobble together things and run some of the following
 * tests against sshd if you define this to zero. Remember not to
 * commit your user account password.
 */
#define WITH_MOCK 1

#define PASSWORD "this is the password"

typedef struct {
  CockpitTransport *transport;

  /* setup_mock_sshd */
  GPid mock_sshd;
  guint16 ssh_port;
} TestCase;

typedef struct {
    const char *ssh_command;
    const char *mock_sshd_arg;
    const char *known_hosts;
    const char *client_password;
} TestFixture;

#if WITH_MOCK
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
setup_mock_sshd (TestCase *tc,
                 gconstpointer data)
{
  const TestFixture *fixture = data;
  GError *error = NULL;
  GString *port;
  gchar *endptr;
  guint64 value;
  gint out_fd;

  const gchar *argv[] = {
      BUILDDIR "/mock-sshd",
      "--user", g_get_user_name (),
      "--password", PASSWORD,
      fixture->mock_sshd_arg,
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
#endif

static void
setup_transport (TestCase *tc,
                 gconstpointer data)
{
  const TestFixture *fixture = data;
  const gchar *password = fixture->client_password ? fixture->client_password : PASSWORD;
  CockpitCreds *creds;
  const gchar *known_hosts;
  const gchar *command;

#if WITH_MOCK
  setup_mock_sshd (tc, data);
#endif

  creds = cockpit_creds_new_password (g_get_user_name (), password);

  known_hosts = fixture->known_hosts;
  if (!known_hosts)
    {
#if WITH_MOCK
      known_hosts = SRCDIR "/src/ws/mock_known_hosts";
#else
      known_hosts = "/data/.ssh/known_hosts";
#endif
    }
  command = fixture->ssh_command;
  if (!command)
    command = "cat";

  tc->transport = g_object_new (COCKPIT_TYPE_SSH_TRANSPORT,
                                "name", "test",
                                "host", "127.0.0.1",
#if WITH_MOCK
                                "port", (guint)tc->ssh_port,
#else
                                "port", 22,
#endif
                                "command", command,
                                "known-hosts", known_hosts,
                                "creds", creds,
                                NULL);

  cockpit_creds_unref (creds);
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

  g_object_add_weak_pointer (G_OBJECT (tc->transport), (gpointer*)&tc->transport);
  g_object_unref (tc->transport);

  /* If this asserts, outstanding references to transport */
  g_assert (tc->transport == NULL);
}

static gboolean
on_recv_get_payload (CockpitTransport *transport,
                     guint channel,
                     GBytes *message,
                     gpointer user_data)
{
  GBytes **received = user_data;
  g_assert_cmpuint (channel, ==, 546);
  g_assert (*received == NULL);
  *received = g_bytes_ref (message);
  return TRUE;
}

static gboolean
on_recv_multiple (CockpitTransport *transport,
                  guint channel,
                  GBytes *message,
                  gpointer user_data)
{
  gint *state = user_data;
  GBytes *check;

  g_assert_cmpuint (channel, ==, 9);

  if (*state == 0)
    check = g_bytes_new_static ("one", 3);
  else if (*state == 1)
    check = g_bytes_new_static ("two", 3);
  else
    g_assert_not_reached ();

  (*state)++;
  g_assert (g_bytes_equal (message, check));
  return TRUE;
}

static void
on_closed_set_flag (CockpitTransport *transport,
                    const gchar *problem,
                    gpointer user_data)
{
  gboolean *flag = user_data;
  g_assert_cmpstr (problem, ==, NULL);
  g_assert (*flag == FALSE);
  *flag = TRUE;
}

static const TestFixture fixture_mock_echo = {
  .ssh_command = BUILDDIR "/mock-echo"
};

static const TestFixture fixture_cat = {
  .ssh_command = "cat"
};

static void
test_echo_and_close (TestCase *tc,
                     gconstpointer data)
{

  GBytes *received = NULL;
  GBytes *sent;
  gboolean closed = FALSE;

  sent = g_bytes_new_static ("the message", 11);
  g_signal_connect (tc->transport, "recv", G_CALLBACK (on_recv_get_payload), &received);
  g_signal_connect (tc->transport, "closed", G_CALLBACK (on_closed_set_flag), &closed);
  cockpit_transport_send (tc->transport, 546, sent);

  while (received == NULL && !closed)
    g_main_context_iteration (NULL, TRUE);

  g_assert (!closed);
  g_assert (g_bytes_equal (received, sent));
  g_bytes_unref (sent);
  g_bytes_unref (received);
  received = NULL;

  cockpit_transport_close (tc->transport, NULL);

  while (received == NULL && !closed)
    g_main_context_iteration (NULL, TRUE);

  g_assert (closed);
  g_assert (received == NULL);
}

static void
test_echo_queue (TestCase *tc,
                 gconstpointer data)
{
  GBytes *sent;
  gint state = 0;
  gboolean closed = FALSE;

  g_signal_connect (tc->transport, "recv", G_CALLBACK (on_recv_multiple), &state);
  g_signal_connect (tc->transport, "closed", G_CALLBACK (on_closed_set_flag), &closed);

  sent = g_bytes_new_static ("one", 3);
  cockpit_transport_send (tc->transport, 9, sent);
  g_bytes_unref (sent);
  sent = g_bytes_new_static ("two", 3);
  cockpit_transport_send (tc->transport, 9, sent);
  g_bytes_unref (sent);

  /* Only closes after above are sent */
  cockpit_transport_close (tc->transport, NULL);

  while (!closed)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpint (state, ==, 2);
}

static void
test_echo_large (TestCase *tc,
                 gconstpointer data)
{
  GBytes *received = NULL;
  GBytes *sent;

  g_signal_connect (tc->transport, "recv", G_CALLBACK (on_recv_get_payload), &received);

  /* Medium length */
  sent = g_bytes_new_take (g_strnfill (1020, '!'), 1020);
  cockpit_transport_send (tc->transport, 546, sent);
  while (received == NULL)
    g_main_context_iteration (NULL, TRUE);
  g_assert (g_bytes_equal (received, sent));
  g_bytes_unref (sent);
  g_bytes_unref (received);
  received = NULL;

  /* Extra large */
  sent = g_bytes_new_take (g_strnfill (10 * 1000 * 1000, '?'), 10 * 1000 * 1000);
  cockpit_transport_send (tc->transport, 546, sent);
  while (received == NULL)
    g_main_context_iteration (NULL, TRUE);
  g_assert (g_bytes_equal (received, sent));
  g_bytes_unref (sent);
  g_bytes_unref (received);
  received = NULL;

  /* Double check that didn't csrew things up */
  sent = g_bytes_new_static ("yello", 5);
  cockpit_transport_send (tc->transport, 546, sent);
  while (received == NULL)
    g_main_context_iteration (NULL, TRUE);
  g_assert (g_bytes_equal (received, sent));
  g_bytes_unref (sent);
  g_bytes_unref (received);
  received = NULL;

}

static void
on_closed_get_problem (CockpitTransport *transport,
                       const gchar *problem,
                       gpointer user_data)
{
  const gchar **ret = user_data;
  g_assert (problem != NULL);
  g_assert (*ret == NULL);
  *ret = g_strdup (problem);
}

static void
test_close_problem (TestCase *tc,
                    gconstpointer data)
{
  gchar *problem = NULL;

  g_signal_connect (tc->transport, "closed", G_CALLBACK (on_closed_get_problem), &problem);
  cockpit_transport_close (tc->transport, "right now");

  while (problem == NULL)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpstr (problem, ==, "right now");
  g_free (problem);
}

#if WITH_MOCK

/* An ssh command that sends back a payload with process id */
static const TestFixture fixture_terminate_problem = {
  .ssh_command = "/usr/bin/printf '\\x00\\x00\\x00\\x14546\\n% 16s' $$; exec cat"
};

static void
test_terminate_problem (TestCase *tc,
                        gconstpointer data)
{
  gchar *problem = NULL;
  gconstpointer str;
  gsize length;
  GBytes *payload = NULL;
  gchar *cmd;

  g_signal_connect (tc->transport, "closed", G_CALLBACK (on_closed_get_problem), &problem);

  /* Get the first message which is the pid */
  g_signal_connect (tc->transport, "recv", G_CALLBACK (on_recv_get_payload), &payload);
  while (payload == NULL && problem == NULL)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpstr (problem, ==, NULL);
  g_assert (payload != NULL);

  str = g_bytes_get_data (payload, &length);
  g_assert (tc->mock_sshd != 0);
  cmd = g_strdup_printf ("kill %.*s", (gint)length, (gchar *)str);
  g_assert_cmpint (system (cmd), ==, 0);
  g_free (cmd);

  while (problem == NULL)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpstr (problem, ==, "terminated");
  g_free (problem);
}

static const TestFixture fixture_unsupported_auth = {
  .mock_sshd_arg = "--broken-auth",
};

static void
test_unsupported_auth (TestCase *tc,
                       gconstpointer data)
{
  gchar *problem = NULL;

  cockpit_expect_message ("*server offered unsupported authentication methods*");

  g_signal_connect (tc->transport, "closed", G_CALLBACK (on_closed_get_problem), &problem);
  while (problem == NULL)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpstr (problem, ==, "not-authorized");
  g_free (problem);
}


static const TestFixture fixture_auth_failed = {
  .client_password = "bad password",
};

static void
test_auth_failed (TestCase *tc,
                  gconstpointer data)
{
  gchar *problem = NULL;

  g_signal_connect (tc->transport, "closed", G_CALLBACK (on_closed_get_problem), &problem);
  while (problem == NULL)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpstr (problem, ==, "not-authorized");
  g_free (problem);
}

#endif

static const TestFixture fixture_unknown_hostkey = {
  .known_hosts = "/dev/null"
};

static void
test_unknown_hostkey (TestCase *tc,
                      gconstpointer data)
{
  gchar *problem = NULL;

  cockpit_expect_message ("*host key for server is not known*");

  g_signal_connect (tc->transport, "closed", G_CALLBACK (on_closed_get_problem), &problem);
  while (problem == NULL)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpstr (problem, ==, "unknown-hostkey");
  g_free (problem);
}

static const TestFixture fixture_bad_command = {
  .ssh_command = "/nonexistant 2> /dev/null"
};

static void
test_bad_command (TestCase *tc,
                  gconstpointer data)
{
  gchar *problem = NULL;

  g_signal_connect (tc->transport, "closed", G_CALLBACK (on_closed_get_problem), &problem);
  while (problem == NULL)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpstr (problem, ==, "no-agent");
  g_free (problem);
}

static void
test_cannot_connect (void)
{
  CockpitTransport *transport;
  CockpitCreds *creds;
  gchar *problem = NULL;

  cockpit_expect_message ("*couldn't connect*");

  creds = cockpit_creds_new_password ("user", "unused password");
  transport = cockpit_ssh_transport_new ("localhost", 65533, creds);
  g_signal_connect (transport, "closed", G_CALLBACK (on_closed_get_problem), &problem);

  while (problem == NULL)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpstr (problem, ==, "no-host");
  g_free (problem);
}

static void
test_close_while_connecting (TestCase *tc,
                             gconstpointer data)
{
  gchar *problem = NULL;

  g_signal_connect (tc->transport, "closed", G_CALLBACK (on_closed_get_problem), &problem);
  cockpit_transport_close (tc->transport, "special-problem");

  while (problem == NULL)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpstr (problem, ==, "special-problem");
  g_free (problem);
}


int
main (int argc,
      char *argv[])
{
  ssh_init ();

  cockpit_test_init (&argc, &argv);

  g_test_add ("/ssh-transport/echo-message", TestCase, &fixture_mock_echo,
              setup_transport, test_echo_and_close, teardown);
  g_test_add ("/ssh-transport/echo-queue", TestCase, &fixture_mock_echo,
              setup_transport, test_echo_queue, teardown);
  g_test_add ("/ssh-transport/echo-large", TestCase, &fixture_cat,
              setup_transport, test_echo_large, teardown);

  g_test_add ("/ssh-transport/close-problem", TestCase, &fixture_cat,
              setup_transport, test_close_problem, teardown);
#if WITH_MOCK
  g_test_add ("/ssh-transport/terminate-problem", TestCase, &fixture_terminate_problem,
              setup_transport, test_terminate_problem, teardown);
  g_test_add ("/ssh-transport/unsupported-auth", TestCase, &fixture_unsupported_auth,
              setup_transport, test_unsupported_auth, teardown);
  g_test_add ("/ssh-transport/auth-failed", TestCase, &fixture_auth_failed,
              setup_transport, test_auth_failed, teardown);
#endif
  g_test_add ("/ssh-transport/unknown-hostkey", TestCase, &fixture_unknown_hostkey,
              setup_transport, test_unknown_hostkey, teardown);
  g_test_add ("/ssh-transport/bad-command", TestCase, &fixture_bad_command,
              setup_transport, test_bad_command, teardown);
  g_test_add ("/ssh-transport/close-while-connecting", TestCase, &fixture_cat,
              setup_transport, test_close_while_connecting, teardown);
  g_test_add_func ("/ssh-transport/cannot-connect", test_cannot_connect);

  return g_test_run ();
}
