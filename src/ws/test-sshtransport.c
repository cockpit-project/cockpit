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

#undef G_LOG_DOMAIN
#define G_LOG_DOMAIN "cockpit-protocol"

#include "config.h"

#include "cockpitsshtransport.h"
#include "cockpitsshagent.h"
#include "cockpitws.h"

#include "common/cockpittest.h"
#include "common/cockpiterror.h"
#include "common/cockpitpipe.h"
#include "common/cockpitpipetransport.h"

#include <sys/wait.h>
#include <errno.h>
#include <stdlib.h>
#include <string.h>

/*
 * You can sorta cobble together things and run some of the following
 * tests against sshd if you define this to zero. Remember not to
 * commit your user account password.
 */
#define WITH_MOCK 1

#undef G_LOG_DOMAIN
#define G_LOG_DOMAIN "cockpit-protocol"

#define PASSWORD "this is the password"

typedef struct {
  CockpitTransport *transport;

  /* setup_agent_transport */
  CockpitTransport *agent_transport;
  gboolean agent_closed;
  gboolean agent_started;

  /* setup_mock_sshd */
  GPid mock_sshd;
  guint16 ssh_port;
} TestCase;


typedef struct {
    const char *message;
    const char *expected;
} TestAuthResponse;

typedef struct {
    int size;
    int spot;
    const TestAuthResponse *responses;
} TestAuthResponseSet;

typedef struct {
    const char *ssh_command;
    const char *mock_sshd_arg;
    const char *known_hosts;
    const char *client_password;
    const char *expect_key;
    const gchar *mock_agent_arg;

    gboolean no_password;
    gboolean ignore_key;
    gboolean prompt_hostkey;

    const TestAuthResponse *responses;
    int responses_size;
    int timeout;
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
check_auth_results (TestCase *tc,
                    const gchar *expect_key_result,
                    const gchar *expect_pw_result,
                    const gchar *expect_gss_result)
{
  gchar *expected;
  JsonObject *json = cockpit_ssh_transport_get_auth_method_results (COCKPIT_SSH_TRANSPORT (tc->transport));


#ifdef HAVE_SSH_SET_AGENT_SOCKET
  expected = g_strdup_printf ("{\"public-key\":\"%s\",\"password\":\"%s\",\"gssapi-mic\":\"%s\"}",
                              expect_key_result, expect_pw_result, expect_gss_result);
#else
  expected = g_strdup_printf ("{\"password\":\"%s\",\"gssapi-mic\":\"%s\"}",
                              expect_pw_result, expect_gss_result);
#endif


  cockpit_assert_json_eq (json, expected);
  g_free (expected);
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

static guint old_process_timeout = 0;
static guint old_response_timeout = 0;

static const TestFixture fixture_mock_echo = {
  .ssh_command = BUILDDIR "/mock-echo"
};

static const TestFixture fixture_cat = {
  .ssh_command =  SRCDIR "/src/ws/mock-cat-with-init"
};

static void
setup_transport (TestCase *tc,
                 gconstpointer data)
{
  const TestFixture *fixture = data;
  g_assert (fixture != NULL);

  const gchar *password;
  CockpitCreds *creds;
  CockpitSshAgent *agent = NULL;
  const gchar *known_hosts;
  const gchar *command;
  gchar *expect_knownhosts = NULL;
  gboolean ignore_key = FALSE;
  gboolean prompt_hostkey = FALSE;

  /* First time around */
  if (old_process_timeout == 0)
    old_process_timeout = cockpit_ws_auth_process_timeout;
  if (old_response_timeout == 0)
    old_response_timeout = cockpit_ws_auth_response_timeout;

  if (fixture->timeout)
    {
      cockpit_ws_auth_process_timeout = fixture->timeout;
      cockpit_ws_auth_response_timeout = fixture->timeout;
    }

#if WITH_MOCK
  setup_mock_sshd (tc, data);
#endif

  if (fixture->no_password)
    password = NULL;
  else
    password = fixture->client_password ? fixture->client_password : PASSWORD;

  creds = cockpit_creds_new (g_get_user_name (), "cockpit", COCKPIT_CRED_PASSWORD, password, NULL);

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
    command = fixture_cat.ssh_command;

  if (fixture->expect_key)
    {
      if (fixture->expect_key[0] == '\0')
        expect_knownhosts = g_strdup ("");
      else
        expect_knownhosts = g_strdup_printf ("[127.0.0.1]:%d %s", (int)tc->ssh_port, fixture->expect_key);

    }
  ignore_key = fixture->ignore_key;
  prompt_hostkey = fixture->prompt_hostkey;

  if (tc->agent_transport != NULL)
    agent = cockpit_ssh_agent_new (tc->agent_transport, "ssh-tests", "ssh-agent");

  tc->transport = g_object_new (COCKPIT_TYPE_SSH_TRANSPORT,
                              "host", "127.0.0.1",
  #if WITH_MOCK
                              "port", (guint)tc->ssh_port,
                              "agent", agent,
  #else
                              "port", 22,
  #endif
                              "command", command,
                              "known-hosts", known_hosts,
                              "creds", creds,
                              "host-key", expect_knownhosts,
                              "ignore-key", ignore_key,
                              "prompt-hostkey", prompt_hostkey,
                              NULL);

  cockpit_creds_unref (creds);
  g_free (expect_knownhosts);

  if (agent)
    g_object_unref (agent);
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

  /* If this asserts, outstanding references  */
  g_assert (tc->transport == NULL);

  cockpit_ws_auth_process_timeout = old_process_timeout;
  cockpit_ws_auth_response_timeout = old_response_timeout;
}

static gboolean
on_recv_get_payload (CockpitTransport *transport,
                     const gchar *channel,
                     GBytes *message,
                     gpointer user_data)
{
  GBytes **received = user_data;
  g_assert_cmpstr (channel, ==, "546");
  g_assert (*received == NULL);
  *received = g_bytes_ref (message);
  return TRUE;
}

static gboolean
on_recv_multiple (CockpitTransport *transport,
                  const gchar *channel,
                  GBytes *message,
                  gpointer user_data)
{
  gint *state = user_data;
  GBytes *check;

  g_assert_cmpstr (channel, ==, "9");

  if (*state == 0)
    check = g_bytes_new_static ("one", 3);
  else if (*state == 1)
    check = g_bytes_new_static ("two", 3);
  else
    g_assert_not_reached ();

  (*state)++;
  g_assert (g_bytes_equal (message, check));
  g_bytes_unref (check);

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

static void
test_echo_and_close (TestCase *tc,
                     gconstpointer data)
{

  GBytes *received = NULL;
  GBytes *sent;
  gboolean closed = FALSE;
  const TestFixture *fixture = data;

  sent = g_bytes_new_static ("the message", 11);
  g_signal_connect (tc->transport, "recv", G_CALLBACK (on_recv_get_payload), &received);
  g_signal_connect (tc->transport, "closed", G_CALLBACK (on_closed_set_flag), &closed);
  cockpit_transport_send (tc->transport, "546", sent);

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

  if (fixture->mock_agent_arg)
    check_auth_results (tc, "succeeded", "not-tried", "no-server-support");
  else
    check_auth_results (tc, "denied", "succeeded", "no-server-support");
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
  cockpit_transport_send (tc->transport, "9", sent);
  g_bytes_unref (sent);
  sent = g_bytes_new_static ("two", 3);
  cockpit_transport_send (tc->transport, "9", sent);
  g_bytes_unref (sent);

  while (state != 2)
    g_main_context_iteration (NULL, TRUE);

  /* Only closes after above are sent */
  cockpit_transport_close (tc->transport, NULL);

  while (!closed)
    g_main_context_iteration (NULL, TRUE);
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
  cockpit_transport_send (tc->transport, "546", sent);
  while (received == NULL)
    g_main_context_iteration (NULL, TRUE);
  g_assert (g_bytes_equal (received, sent));
  g_bytes_unref (sent);
  g_bytes_unref (received);
  received = NULL;

  /* Extra large */
  sent = g_bytes_new_take (g_strnfill (10 * 1000 * 1000, '?'), 10 * 1000 * 1000);
  cockpit_transport_send (tc->transport, "546", sent);
  while (received == NULL)
    g_main_context_iteration (NULL, TRUE);
  g_assert (g_bytes_equal (received, sent));
  g_bytes_unref (sent);
  g_bytes_unref (received);
  received = NULL;

  /* Double check that didn't csrew things up */
  sent = g_bytes_new_static ("yello", 5);
  cockpit_transport_send (tc->transport, "546", sent);
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
  g_assert (*ret == NULL);
  if (problem == NULL)
    problem = "";
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

/* An ssh command that just kills itself with SIGTERM */
static const TestFixture fixture_terminate_problem = {
  .ssh_command = "kill $$",
};

static void
test_terminate_problem (TestCase *tc,
                        gconstpointer data)
{
  gchar *problem = NULL;

  g_assert (data == &fixture_terminate_problem);

  g_signal_connect (tc->transport, "closed", G_CALLBACK (on_closed_get_problem), &problem);

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

  g_signal_connect (tc->transport, "closed", G_CALLBACK (on_closed_get_problem), &problem);

  /* Gets fired first */
  while (problem == NULL)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpstr (problem, ==, "authentication-failed");
  g_free (problem);

  check_auth_results (tc, "no-server-support", "no-server-support", "no-server-support");
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

  g_assert_cmpstr (problem, ==, "authentication-failed");
  g_free (problem);

  check_auth_results (tc, "denied", "denied", "no-server-support");
}

static gboolean
on_prompt_do_nothing (CockpitSshTransport *transport,
                      JsonObject *prompt,
                      gpointer user_data)
{
  return TRUE;
}

static void
test_multi_auth_timeout (TestCase *tc,
                         gconstpointer data)
{
  gchar *problem = NULL;

  // Ad a prompt handler that does nothing
  g_signal_connect (COCKPIT_SSH_TRANSPORT (tc->transport), "prompt",
                    G_CALLBACK (on_prompt_do_nothing),
                    NULL);

  cockpit_expect_log ("cockpit-ws", G_LOG_LEVEL_WARNING,
                      "*Auth pipe closed: timeout*");

  g_signal_connect (tc->transport, "closed", G_CALLBACK (on_closed_get_problem), &problem);
  while (problem == NULL)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpstr (problem, ==, "timeout");

  g_free (problem);
  cockpit_assert_expected ();
}

static gboolean
on_prompt (CockpitSshTransport *transport,
           JsonObject *prompt,
           gpointer user_data)
{
  TestAuthResponseSet *rs = user_data;
  TestAuthResponse r;
  CockpitAuthProcess *auth_process;
  GBytes *input = NULL;

  g_assert (rs->spot < rs->size);
  r = rs->responses[rs->spot];
  rs->spot++;

  cockpit_assert_json_eq (prompt, r.expected);
  input = g_bytes_new_static (r.message, strlen (r.message));
  auth_process = cockpit_ssh_transport_get_auth_process (transport);
  g_assert (auth_process != NULL);
  cockpit_auth_process_write_auth_bytes (auth_process, input);
  g_bytes_unref (input);
  return TRUE;
}

static void
test_multi_auth_fail (TestCase *tc,
                      gconstpointer data)
{
  const TestFixture *fixture = data;
  TestAuthResponseSet set = {
    .responses = fixture->responses,
    .size = fixture->responses_size,
  };

  g_signal_connect (COCKPIT_SSH_TRANSPORT (tc->transport), "prompt",
                    G_CALLBACK (on_prompt),
                    &set);
  test_auth_failed (tc, data);

  g_assert (set.spot == set.size);
}

static void
test_multi_auth (TestCase *tc,
                      gconstpointer data)
{
  const TestFixture *fixture = data;
  TestAuthResponseSet set = {
    .responses = fixture->responses,
    .size = fixture->responses_size,
  };
  g_signal_connect (COCKPIT_SSH_TRANSPORT (tc->transport), "prompt",
                    G_CALLBACK (on_prompt),
                    &set);

  test_echo_and_close (tc, data);
  g_assert (set.spot == set.size);
}

static const TestAuthResponse good_responses[1] = {
  {
    .expected = "{\"prompt\":\"Token\",\"message\":\"Password and Token\",\"echo\":true}",
    .message = "5",
  }
};

static const TestAuthResponse wrong_responses[2] = {
  {
    .expected = "{\"prompt\":\"Token\",\"message\":\"Password and Token\",\"echo\":true}",
    .message = "4",
  }
};

static const TestAuthResponse two_responses[2] = {
  {
    .expected = "{\"prompt\":\"Token\",\"message\":\"Password and Token\",\"echo\":true}",
    .message = "6",
  },
  {
    .expected = "{\"prompt\":\"So Close\",\"message\":\"Again\",\"echo\":false}",
    .message = "5",
  }
};

static const TestAuthResponse two_wrong_responses[2] = {
  {
    .expected = "{\"prompt\":\"Token\",\"message\":\"Password and Token\",\"echo\":true}",
    .message = "6",
  },
  {
    .expected = "{\"prompt\":\"So Close\",\"message\":\"Again\",\"echo\":false}",
    .message = "6",
  }
};

static const TestFixture fixture_kb_auth_failed = {
  .client_password = "bad password",
  .responses = NULL,
  .responses_size = 0
};

static const TestFixture fixture_kb_multi_auth_failed = {
  .client_password = PASSWORD,
  .mock_sshd_arg = "--multi-step",
  .responses = wrong_responses,
  .responses_size = 1
};

static const TestFixture fixture_kb_multi_auth = {
  .client_password = PASSWORD,
  .mock_sshd_arg = "--multi-step",
  .responses = good_responses,
  .responses_size = 1
};

static const TestFixture fixture_kb_multi_auth_timeout = {
  .client_password = PASSWORD,
  .mock_sshd_arg = "--multi-step",
  .responses = good_responses,
  .responses_size = 1,
  .timeout = 3
};

static const TestFixture fixture_kb_multi_auth_3 = {
  .client_password = PASSWORD,
  .mock_sshd_arg = "--multi-step",
  .responses = two_responses,
  .responses_size = 2
};

static const TestFixture fixture_kb_multi_auth_3_failed = {
  .client_password = PASSWORD,
  .mock_sshd_arg = "--multi-step",
  .responses = two_wrong_responses,
  .responses_size = 2
};

#endif

static const TestFixture fixture_unknown_hostkey = {
  .known_hosts = "/dev/null"
};

static const TestFixture fixture_prompt_hostkey = {
  .known_hosts = "/dev/null",
  .prompt_hostkey = TRUE
};

static void
test_unknown_hostkey (TestCase *tc,
                      gconstpointer data)
{
  gchar *problem = NULL;

  g_signal_connect (tc->transport, "closed", G_CALLBACK (on_closed_get_problem), &problem);
  while (problem == NULL)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpstr (problem, ==, "unknown-hostkey");
  g_free (problem);
}

static const TestFixture fixture_ignore_hostkey = {
  .known_hosts = "/dev/null",
  .ignore_key = TRUE
};

static void
test_ignore_hostkey (TestCase *tc,
                      gconstpointer data)
{
  const TestFixture *fixture = data;
  const gchar *json;
  gchar *problem = NULL;
  GBytes *bytes;

  /* This test should validate in spite of not having known_hosts */
  g_assert (fixture->ignore_key == TRUE);

  json = "{\"command\":\"init\",\"version\":1}";
  bytes = g_bytes_new_static (json, strlen (json));
  cockpit_transport_send (tc->transport, NULL, bytes);
  g_bytes_unref (bytes);

  g_signal_connect (tc->transport, "closed", G_CALLBACK (on_closed_get_problem), &problem);
  cockpit_transport_close (tc->transport, NULL);

  while (!problem)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpstr (problem, ==, "");

  g_free (problem);
}

static const gchar MOCK_RSA_KEY[] = "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCYzo07OA0H6f7orVun9nIVjGYrkf8AuPDScqWGzlKpAqSipoQ9oY/mwONwIOu4uhKh7FTQCq5p+NaOJ6+Q4z++xBzSOLFseKX+zyLxgNG28jnF06WSmrMsSfvPdNuZKt9rZcQFKn9fRNa8oixa+RsqEEVEvTYhGtRf7w2wsV49xIoIza/bln1ABX1YLaCByZow+dK3ZlHn/UU0r4ewpAIZhve4vCvAsMe5+6KJH8ft/OKXXQY06h6jCythLV4h18gY/sYosOa+/4XgpmBiE7fDeFRKVjP3mvkxMpxce+ckOFae2+aJu51h513S9kxY2PmKaV/JU9HBYO+yO4j+j24v";

static const gchar MOCK_RSA_FP[] = "0e:6a:c8:b1:07:72:e2:04:95:9f:0e:b3:56:af:48:e2";

static void
test_get_host_key (TestCase *tc,
                   gconstpointer data)
{

  GBytes *received = NULL;
  GBytes *sent;
  gboolean closed = FALSE;
  gchar *ssh_key;
  gchar *ssh_fingerprint;
  gchar *knownhosts;

  sent = g_bytes_new_static ("the message", 11);
  g_signal_connect (tc->transport, "recv", G_CALLBACK (on_recv_get_payload), &received);
  g_signal_connect (tc->transport, "closed", G_CALLBACK (on_closed_set_flag), &closed);
  cockpit_transport_send (tc->transport, "546", sent);
  g_bytes_unref (sent);

  while (received == NULL && !closed)
    g_main_context_iteration (NULL, TRUE);

  g_assert (!closed);
  g_bytes_unref (received);
  received = NULL;

  knownhosts = g_strdup_printf ("[127.0.0.1]:%d %s", (int)tc->ssh_port, MOCK_RSA_KEY);

  g_assert_cmpstr (cockpit_ssh_transport_get_host_key (COCKPIT_SSH_TRANSPORT (tc->transport)), ==, knownhosts);
  g_assert_cmpstr (cockpit_ssh_transport_get_host_fingerprint (COCKPIT_SSH_TRANSPORT (tc->transport)), ==, MOCK_RSA_FP);

  g_object_get (tc->transport, "host-key", &ssh_key, "host-fingerprint", &ssh_fingerprint, NULL);
  g_assert_cmpstr (ssh_key, ==, knownhosts);
  g_free (ssh_key);
  g_assert_cmpstr (ssh_fingerprint, ==, MOCK_RSA_FP);
  g_free (ssh_fingerprint);

  g_signal_handlers_disconnect_by_func (tc->transport, on_closed_set_flag, &closed);
  g_free (knownhosts);
}

static const TestFixture fixture_expect_host_key = {
  .known_hosts = "/dev/null",
  .expect_key = MOCK_RSA_KEY
};

static void
test_expect_host_key (TestCase *tc,
                      gconstpointer data)
{
  const gchar *json = "{\"command\":\"init\",\"version\":1}";
  const TestFixture *fixture = data;
  gchar *problem = NULL;
  GBytes *bytes;

  /* This test should validate in spite of not having known_hosts */
  g_assert (fixture->expect_key != NULL);

  bytes = g_bytes_new_static (json, strlen (json));
  cockpit_transport_send (tc->transport, NULL, bytes);
  g_bytes_unref (bytes);

  g_signal_connect (tc->transport, "closed", G_CALLBACK (on_closed_get_problem), &problem);
  cockpit_transport_close (tc->transport, NULL);

  while (!problem)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpstr (problem, ==, "");

  g_free (problem);
}

static const TestFixture fixture_expect_bad_key = {
  .expect_key = "wrong key"
};

static void
test_expect_bad_key (TestCase *tc,
                     gconstpointer data)
{
  const TestFixture *fixture = data;
  gchar *problem = NULL;

  /*
   * This tail should fail in spite of having key in known_hosts,
   * because expect_key is set.
   */
  g_assert (fixture->known_hosts == NULL);
  g_assert (fixture->expect_key != NULL);

  g_signal_connect (tc->transport, "closed", G_CALLBACK (on_closed_get_problem), &problem);
  cockpit_transport_close (tc->transport, NULL);

  while (!problem)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpstr (problem, ==, "invalid-hostkey");

  g_free (problem);
}

static const TestFixture fixture_expect_empty_key = {
  .expect_key = ""
};

static void
test_expect_empty_key (TestCase *tc,
                       gconstpointer data)
{
  const TestFixture *fixture = data;
  gchar *problem = NULL;

  /*
   * This tail should fail in spite of having key in known_hosts,
   * because expect_key is set.
   */
  g_assert (fixture->known_hosts == NULL);
  g_assert (fixture->expect_key != NULL);

  g_signal_connect (tc->transport, "closed", G_CALLBACK (on_closed_get_problem), &problem);
  cockpit_transport_close (tc->transport, NULL);

  while (!problem)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpstr (problem, ==, "invalid-hostkey");

  g_free (problem);
}

/* The output from this will go to stderr */
static const TestFixture fixture_bad_command = {
  .ssh_command = "/nonexistant",
};

/* Yes this makes a difference with bash, output goes to stdout */
static const TestFixture fixture_command_not_found = {
  .ssh_command = "nonexistant-command",
};

/* A valid command that exits with 0 */
static const TestFixture fixture_command_exits = {
  .ssh_command = "/usr/bin/true",
};

/* A valid command that exits with 1 */
static const TestFixture fixture_command_fails = {
  .ssh_command = "/usr/bin/false",
};

static void
test_no_cockpit (TestCase *tc,
                 gconstpointer data)
{
  gchar *problem = NULL;

  g_signal_connect (tc->transport, "closed", G_CALLBACK (on_closed_get_problem), &problem);
  while (problem == NULL)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpstr (problem, ==, "no-cockpit");
  g_free (problem);

  check_auth_results (tc, "denied", "succeeded", "no-server-support");
}

static void
test_cannot_connect (void)
{
  CockpitTransport *transport;
  CockpitCreds *creds;
  gchar *problem = NULL;

  creds = cockpit_creds_new ("user", "cockpit", COCKPIT_CRED_PASSWORD, "unused password", NULL);
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

#ifdef HAVE_SSH_SET_AGENT_SOCKET

static gboolean
on_bridge_control (CockpitTransport *transport,
                   const char *command,
                   const gchar *channel_id,
                   JsonObject *options,
                   GBytes *message,
                   gpointer user_data)
{
  TestCase *tc = user_data;
  tc->agent_started = TRUE;
  if (channel_id && strstr (channel_id, "ssh-agent") &&
      g_strcmp0 (command, "close") == 0)
    {
      tc->agent_closed = TRUE;
    }
  return FALSE;
}

static void
setup_key_transport (TestCase *tc,
                     gconstpointer data)
{
  const TestFixture *fixture = data;
  CockpitPipe *pipe;
  const gchar *json;
  GBytes *bytes = NULL;
  const gchar *argv[] = {
      BUILDDIR "/mock-agent-bridge",
      fixture->mock_agent_arg,
      NULL
  };
  gboolean bridge_closed = FALSE;
  guint c_sig = 0;

  pipe = cockpit_pipe_spawn (argv, NULL, NULL, COCKPIT_PIPE_FLAGS_NONE);
  tc->agent_transport = cockpit_pipe_transport_new (pipe);
  json = "{\"command\":\"init\",\"version\":1}";
  bytes = g_bytes_new_static (json, strlen (json));
  cockpit_transport_send (tc->agent_transport, NULL, bytes);
  g_bytes_unref (bytes);
  g_object_unref (pipe);

  g_signal_connect (tc->agent_transport, "control",
                    G_CALLBACK (on_bridge_control), tc);
  c_sig = g_signal_connect (tc->agent_transport, "closed",
                            G_CALLBACK (on_closed_set_flag), &bridge_closed);
  while (!tc->agent_started && !bridge_closed)
    g_main_context_iteration (NULL, TRUE);

  g_assert (!bridge_closed);
  g_signal_handler_disconnect (tc->agent_transport, c_sig);
  setup_transport (tc, data);
}

static void
key_teardown (TestCase *tc,
          gconstpointer data)
{
  g_assert_true (tc->agent_closed);
  g_assert_true (tc->agent_started);
  if (tc->agent_transport)
    {
      g_object_add_weak_pointer (G_OBJECT (tc->agent_transport), (gpointer*)&tc->agent_transport);
      g_object_unref (tc->agent_transport);
      g_assert (tc->agent_transport != NULL);
    }

  teardown (tc, data);
  g_assert (tc->agent_transport == NULL);
}

static const TestFixture fixture_valid_key_auth = {
  .ssh_command = BUILDDIR "/mock-echo",
  .client_password = "bad password",
  .mock_agent_arg = BUILDDIR "/test_rsa_key"
};

static const TestFixture fixture_invalid_key_auth = {
  .ssh_command = BUILDDIR "/mock-echo",
  .client_password = "bad password",
  .mock_agent_arg = NULL
};

static void
test_key_auth_failed (TestCase *tc,
                  gconstpointer data)
{

  test_auth_failed (tc, data);
  while (!tc->agent_closed)
    g_main_context_iteration (NULL, TRUE);

  check_auth_results (tc, "denied", "denied", "no-server-support");
}

#endif

int
main (int argc,
      char *argv[])
{
  cockpit_ws_ssh_program = BUILDDIR "/cockpit-ssh";

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
  g_test_add ("/ssh-transport/auth-failed", TestCase,
              &fixture_auth_failed, setup_transport,
              test_auth_failed, teardown);
  g_test_add ("/ssh-transport/kb-auth-failed", TestCase,
              &fixture_kb_auth_failed, setup_transport,
              test_multi_auth_fail, teardown);
  g_test_add ("/ssh-transport/kb-multi-auth-failed", TestCase,
              &fixture_kb_multi_auth_failed, setup_transport,
              test_multi_auth_fail, teardown);
  g_test_add ("/ssh-transport/kb-multi-3-auth-failed", TestCase,
              &fixture_kb_multi_auth_3_failed, setup_transport,
              test_multi_auth_fail, teardown);
  g_test_add ("/ssh-transport/kb-multi-auth-timeout", TestCase,
              &fixture_kb_multi_auth_timeout, setup_transport,
              test_multi_auth_timeout, teardown);
  g_test_add ("/ssh-transport/kb-echo-message", TestCase, &fixture_mock_echo,
              setup_transport, test_multi_auth, teardown);
  g_test_add ("/ssh-transport/kb-multi-echo-message", TestCase,
              &fixture_kb_multi_auth,
              setup_transport, test_multi_auth, teardown);
  g_test_add ("/ssh-transport/kb-multi-3-echo-message", TestCase,
              &fixture_kb_multi_auth_3,
              setup_transport, test_multi_auth, teardown);

#ifdef HAVE_SSH_SET_AGENT_SOCKET
  g_test_add ("/ssh-transport/key-auth-message", TestCase, &fixture_valid_key_auth, setup_key_transport, test_echo_and_close, key_teardown);
  g_test_add ("/ssh-transport/key-auth-failed", TestCase, &fixture_invalid_key_auth, setup_key_transport, test_key_auth_failed, key_teardown);
#endif
#endif

  g_test_add ("/ssh-transport/bad-command", TestCase, &fixture_bad_command,
              setup_transport, test_no_cockpit, teardown);
  g_test_add ("/ssh-transport/command-not-found", TestCase, &fixture_command_not_found,
              setup_transport, test_no_cockpit, teardown);
  g_test_add ("/ssh-transport/command-not-cockpit", TestCase, &fixture_command_exits,
              setup_transport, test_no_cockpit, teardown);
  g_test_add ("/ssh-transport/command-just-fails", TestCase, &fixture_command_fails,
              setup_transport, test_no_cockpit, teardown);
  g_test_add ("/ssh-transport/close-while-connecting", TestCase, &fixture_cat,
              setup_transport, test_close_while_connecting, teardown);
  g_test_add_func ("/ssh-transport/cannot-connect", test_cannot_connect);

  g_test_add ("/ssh-transport/unknown-hostkey", TestCase, &fixture_unknown_hostkey,
              setup_transport, test_unknown_hostkey, teardown);
  g_test_add ("/ssh-transport/prompt-hostkey-fail", TestCase, &fixture_prompt_hostkey,
              setup_transport, test_unknown_hostkey, teardown);
  g_test_add ("/ssh-transport/ignore-hostkey", TestCase, &fixture_ignore_hostkey,
              setup_transport, test_ignore_hostkey, teardown);
  g_test_add ("/ssh-transport/get-host-key", TestCase, &fixture_cat,
              setup_transport, test_get_host_key, teardown);
  g_test_add ("/ssh-transport/expect-host-key", TestCase, &fixture_expect_host_key,
              setup_transport, test_expect_host_key, teardown);
  g_test_add ("/ssh-transport/expect-bad-key", TestCase, &fixture_expect_bad_key,
              setup_transport, test_expect_bad_key, teardown);
  g_test_add ("/ssh-transport/expect-empty-key", TestCase, &fixture_expect_empty_key,
              setup_transport, test_expect_empty_key, teardown);

  return g_test_run ();
}
