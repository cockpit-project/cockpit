/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013 Red Hat, Inc.
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
#include "cockpitsshservice.h"

#include "common/cockpitpipetransport.h"
#include "common/cockpittransport.h"
#include "common/cockpitjson.h"
#include "common/cockpittest.h"
#include "common/cockpitwebserver.h"
#include "common/cockpitconf.h"

#include "bridge/mock-transport.h"

#include <glib.h>

#include <string.h>
#include <errno.h>

#include <sys/types.h>
#include <sys/socket.h>
#include <sys/wait.h>

#define TIMEOUT 30

#define WAIT_UNTIL(cond) \
  G_STMT_START \
    while (!(cond)) g_main_context_iteration (NULL, TRUE); \
  G_STMT_END

#define PASSWORD "this is the password"

typedef struct {
  GPid mock_sshd;
  guint16 ssh_port;

  MockTransport *transport;

  const gchar *old_ask;
} TestCase;

typedef struct {
  const char *user;
  const char *password;
} TestFixture;

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

static gboolean
start_mock_sshd (const gchar *user,
                 const gchar *password,
                 GPid *out_pid,
                 gushort *out_port)
{
  GError *error = NULL;
  GString *port;
  gchar *endptr;
  guint64 value;
  gint out_fd;

  const gchar *argv[] = {
      BUILDDIR "/mock-sshd",
      "--user", user,
      "--password", password,
      NULL
  };


  g_spawn_async_with_pipes (BUILDDIR, (gchar **)argv, NULL, G_SPAWN_DO_NOT_REAP_CHILD, NULL, NULL,
                            out_pid, NULL, &out_fd, NULL, &error);
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

  *out_port = (gushort)value;
  g_string_free (port, TRUE);
  return TRUE;
}

static void
setup_mock_sshd (TestCase *test,
                 gconstpointer data)
{
  const TestFixture *fix = data;

  start_mock_sshd (fix->user ? fix->user : g_get_user_name (),
                   fix->password ? fix->password : PASSWORD,
                   &test->mock_sshd,
                   &test->ssh_port);

  cockpit_ssh_specific_port = test->ssh_port;
}

static void
teardown_mock_sshd (TestCase *test,
                    gconstpointer data)
{
  GPid pid;
  int status;

  pid = waitpid (test->mock_sshd, &status, WNOHANG);
  g_assert_cmpint (pid, >=, 0);
  if (pid == 0)
    kill (test->mock_sshd, SIGTERM);
  else if (status != 0)
    {
      if (WIFSIGNALED (status))
        g_message ("mock-sshd terminated: %d", WTERMSIG (status));
      else
        g_message ("mock-sshd failed: %d", WEXITSTATUS (status));
    }
  g_spawn_close_pid (test->mock_sshd);
}

static void
setup (TestCase *test,
       gconstpointer data)
{
  alarm (TIMEOUT);

  cockpit_ssh_known_hosts = SRCDIR "/src/ssh/mock_known_hosts";
  cockpit_ssh_bridge_program = SRCDIR "/src/ssh/mock-pid-cat";

  setup_mock_sshd (test, data);

  test->old_ask = g_getenv ("SSH_ASKPASS");
  g_setenv ("SSH_ASKPASS", BUILDDIR "/cockpit-askpass", TRUE);

  test->transport = g_object_new (mock_transport_get_type (), NULL);
  while (g_main_context_iteration (NULL, FALSE));
}

static void
teardown (TestCase *test,
          gconstpointer data)
{
  teardown_mock_sshd (test, data);

  /* Reset this if changed by a test */
  cockpit_ssh_session_timeout = 30;

  cockpit_assert_expected ();

  g_object_add_weak_pointer (G_OBJECT (test->transport), (gpointer *)&test->transport);
  g_object_unref (test->transport);
  g_assert (test->transport == NULL);

  if (test->old_ask)
    g_setenv ("SSH_ASKPASS", test->old_ask, TRUE);
  else
    g_unsetenv ("SSH_ASKPASS");

  alarm (0);
}

static void
emit_string (TestCase *test,
             const gchar *channel,
             const gchar *string)
{
  GBytes *bytes = g_bytes_new (string, strlen (string));
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (test->transport), channel, bytes);
  g_bytes_unref (bytes);
}

static void
handle_authorize_and_init (TestCase *test,
                           gconstpointer data)
{
  JsonObject *control = NULL;
  gchar *cmd = NULL;
  const gchar *command;
  const gchar *cookie;
  const TestFixture *fix = data;

  /* Init message */
  while ((control = mock_transport_pop_control (test->transport)) == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_json_eq (control, "{\"command\":\"init\",\"version\":1}");
  control = NULL;

  while ((control = mock_transport_pop_control (test->transport)) == NULL)
    g_main_context_iteration (NULL, TRUE);
  g_assert (cockpit_json_get_string (control, "command", NULL, &command));
  g_assert (cockpit_json_get_string (control, "cookie", NULL, &cookie));

  g_assert_cmpstr (command, ==, "authorize");
  cmd = g_strdup_printf ("{\"command\": \"authorize\","
                           " \"cookie\": \"%s\","
                           " \"response\": \"%s\"}", cookie, fix->password ? fix->password : PASSWORD);
  emit_string (test, NULL, cmd);
  g_free (cmd);
}

static const TestFixture fixture_default = {
  .user = NULL
};

static const TestFixture fixture_custom_user = {
  .user = "user",
  .password = "Another password"
};

static void
test_specified_creds (TestCase *test,
                      gconstpointer data)
{
  GBytes *sent;
  CockpitSshService *service = NULL;

  service = cockpit_ssh_service_new (COCKPIT_TRANSPORT (test->transport));

  emit_string (test, NULL, "{\"command\": \"init\", \"version\": 1, \"host\": \"localhost\" }");
  emit_string (test, NULL, "{\"command\": \"open\", \"user\": \"user\","
                           " \"password\": \"Another password\","
                           " \"channel\": \"4\", \"payload\": \"echo\"}");
  emit_string (test, "4", "wheee");

  while ((sent = mock_transport_pop_channel (test->transport, "4")) == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_bytes_eq (sent, "wheee", -1);

  g_object_unref (service);
}

static void
test_specified_creds_overide_host (TestCase *test,
                                   gconstpointer data)
{
  GBytes *sent = NULL;
  CockpitSshService *service = NULL;

  service = cockpit_ssh_service_new (COCKPIT_TRANSPORT (test->transport));

  emit_string (test, NULL, "{\"command\": \"init\", \"version\": 1, \"host\": \"localhost\" }");
  emit_string (test, NULL, "{\"command\": \"open\", \"user\": \"user\","
                           " \"password\": \"Another password\","
                           " \"host\": \"test@127.0.0.1\","
                           " \"channel\": \"4\", \"payload\": \"echo\"}");
  emit_string (test, "4", "wheee");

  while ((sent = mock_transport_pop_channel (test->transport, "4")) == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_bytes_eq (sent, "wheee", -1);

  g_object_unref (service);
}

static void
test_user_host_fail (TestCase *test,
                     gconstpointer data)
{
  JsonObject *control = NULL;
  CockpitSshService *service = NULL;
  service = cockpit_ssh_service_new (COCKPIT_TRANSPORT (test->transport));

  emit_string (test, NULL, "{\"command\": \"init\", \"version\": 1, \"host\": \"localhost\" }");
  emit_string (test, NULL, "{\"command\": \"open\", \"password\": \"Another password\","
                           " \"user\": \"baduser\","
                           " \"host\": \"user@127.0.0.1\","
                           " \"channel\": \"4\", \"payload\": \"echo\"}");

  /* Init message */
  while ((control = mock_transport_pop_control (test->transport)) == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_json_eq (control, "{\"command\":\"init\",\"version\":1}");
  control = NULL;

  /* Should have gotten a failure message, about the credentials */
  while ((control = mock_transport_pop_control (test->transport)) == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_json_eq (control, "{\"command\":\"close\",\"channel\":\"4\",\"problem\":\"authentication-failed\",\"auth-method-results\":{\"password\":\"denied\",\"public-key\":\"denied\",\"gssapi-mic\":\"no-server-support\"}}");
  control = NULL;

  g_object_unref (service);
}


static void
test_user_host_reuse_password (TestCase *test,
                               gconstpointer data)
{
  GBytes *sent;
  const gchar *user = g_get_user_name ();
  gchar *cmd = NULL;
  CockpitSshService *service = NULL;

  /* Open a channel with the same user as creds but no password */
  cmd = g_strdup_printf ("{\"command\": \"open\","
                           " \"host\": \"%s@127.0.0.1\","
                           " \"channel\": \"4\", \"payload\": \"echo\"}", user);
  service = cockpit_ssh_service_new (COCKPIT_TRANSPORT (test->transport));

  emit_string (test, NULL, "{\"command\": \"init\", \"version\": 1, \"host\": \"localhost\" }");
  emit_string (test, NULL, cmd);
  emit_string (test, "4", "wheee");

  handle_authorize_and_init (test, data);

  while ((sent = mock_transport_pop_channel (test->transport, "4")) == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_bytes_eq (sent, "wheee", -1);

  g_object_unref (service);
  g_free (cmd);
}

static void
test_specified_creds_fail (TestCase *test,
                           gconstpointer data)
{
  JsonObject *control = NULL;
  CockpitSshService *service = NULL;

  service = cockpit_ssh_service_new (COCKPIT_TRANSPORT (test->transport));

  emit_string (test, NULL, "{\"command\": \"init\", \"version\": 1, \"host\": \"localhost\" }");
  emit_string (test, NULL, "{\"command\": \"open\", \"user\": \"user\","
                           " \"password\": \"wrong-password\","
                           " \"host\": \"127.0.0.1\","
                           " \"channel\": \"4\", \"payload\": \"echo\"}");

  /* Init message */
  while ((control = mock_transport_pop_control (test->transport)) == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_json_eq (control, "{\"command\":\"init\",\"version\":1}");
  control = NULL;

  /* Should have gotten a failure message, about the credentials */
  while ((control = mock_transport_pop_control (test->transport)) == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_json_eq (control, "{\"command\":\"close\",\"channel\":\"4\",\"problem\":\"authentication-failed\",\"auth-method-results\":{\"password\":\"denied\",\"public-key\":\"denied\",\"gssapi-mic\":\"no-server-support\"}}");
  control = NULL;

  g_object_unref (service);
}

static void
test_host_port (TestCase *test,
                gconstpointer data)
{
  GBytes *sent = NULL;
  gchar *cmd = NULL;
  GPid pid;
  gushort port;
  CockpitSshService *service = NULL;

  service = cockpit_ssh_service_new (COCKPIT_TRANSPORT (test->transport));

  /* start a new mock sshd on a different port */
  start_mock_sshd ("auser", "apassword", &pid, &port);

  /* Open a channel with a host that has a port
   * and a user that doesn't work on the main mock ssh
   */
  /* Open a channel with the same user as creds but no password */
  cmd = g_strdup_printf ("{\"command\": \"open\", \"user\": \"auser\","
                           " \"password\": \"apassword\","
                           " \"host\": \"127.0.0.1:%d\","
                           " \"channel\": \"4\", \"payload\": \"echo\"}", port);

  emit_string (test, NULL, "{\"command\": \"init\", \"version\": 1, \"host\": \"localhost\" }");
  emit_string (test, NULL, cmd);
  emit_string (test, "4", "wheee");

  while ((sent = mock_transport_pop_channel (test->transport, "4")) == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_bytes_eq (sent, "wheee", -1);

  g_free (cmd);
  g_object_unref (service);
}


static gboolean
on_timeout_dummy (gpointer unused)
{
  return TRUE;
}

static void
test_timeout_session (TestCase *test,
                      gconstpointer data)
{
  GBytes *received = NULL;
  CockpitSshService *service;
  GError *error = NULL;
  JsonObject *object;
  pid_t pid;
  guint tag;

  cockpit_ssh_session_timeout = 1;
  cockpit_ssh_bridge_program = SRCDIR "/src/ssh/mock-pid-cat";

  /* Open a channel with a host that has a port
   * and a user that doesn't work on the main mock ssh
   */
  /* Open a channel with the same user as creds but no password */
  service = cockpit_ssh_service_new (COCKPIT_TRANSPORT (test->transport));

  emit_string (test, NULL, "{\"command\": \"init\", \"version\": 1, \"host\": \"localhost\" }");
  emit_string (test, NULL, "{\"command\": \"open\", \"user\": \"user\","
                            " \"password\": \"Another password\","
                            " \"channel\": \"11x\", \"payload\": \"echo\"}");

  while ((received = mock_transport_pop_channel (test->transport, "11x")) == NULL)
    g_main_context_iteration (NULL, TRUE);
  object = cockpit_json_parse_bytes (received, &error);
  g_assert_no_error (error);
  pid = json_object_get_int_member (object, "pid");
  json_object_unref (object);

  emit_string (test, NULL, "{\"command\": \"close\", \"channel\": \"11x\"}");

  /* The process should exit shortly */
  tag = g_timeout_add_seconds (1, on_timeout_dummy, NULL);
  while (kill (pid, 0) == 0)
    g_main_context_iteration (NULL, TRUE);
  g_source_remove (tag);

  g_assert_cmpint (errno, ==, ESRCH);
  g_object_unref (service);
}


static const gchar MOCK_RSA_KEY[] = "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCYzo07OA0H6f7orVun9nIVjGYrkf8AuPDScqWGzlKpAqSipoQ9oY/mwONwIOu4uhKh7FTQCq5p+NaOJ6+Q4z++xBzSOLFseKX+zyLxgNG28jnF06WSmrMsSfvPdNuZKt9rZcQFKn9fRNa8oixa+RsqEEVEvTYhGtRf7w2wsV49xIoIza/bln1ABX1YLaCByZow+dK3ZlHn/UU0r4ewpAIZhve4vCvAsMe5+6KJH8ft/OKXXQY06h6jCythLV4h18gY/sYosOa+/4XgpmBiE7fDeFRKVjP3mvkxMpxce+ckOFae2+aJu51h513S9kxY2PmKaV/JU9HBYO+yO4j+j24v";

static const gchar MOCK_RSA_FP[] = "0e:6a:c8:b1:07:72:e2:04:95:9f:0e:b3:56:af:48:e2";


static void
test_unknown_host_key (TestCase *test,
                       gconstpointer data)
{
  CockpitSshService *service;
  JsonObject *control = NULL;
  gchar *knownhosts;
  const gchar *fp;
  const gchar *key;

  knownhosts = g_strdup_printf ("[127.0.0.1]:%d %s", (int)test->ssh_port, MOCK_RSA_KEY);

  /* No known hosts */
  cockpit_ssh_known_hosts = "/dev/null";

  service = cockpit_ssh_service_new (COCKPIT_TRANSPORT (test->transport));

  emit_string (test, NULL, "{\"command\": \"init\", \"version\": 1, \"host\": \"localhost\" }");
  emit_string (test, NULL, "{\"command\": \"open\","
                           " \"channel\": \"4\", \"payload\": \"echo\"}");

  /* Init message */
  while ((control = mock_transport_pop_control (test->transport)) == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_json_eq (control, "{\"command\":\"init\",\"version\":1}");
  control = NULL;

  /* Should have gotten a failure message, about the credentials */
  while ((control = mock_transport_pop_control (test->transport)) == NULL)
    g_main_context_iteration (NULL, TRUE);

  g_assert (cockpit_json_get_string (control, "host-key", NULL, &key));
  g_assert (cockpit_json_get_string (control, "host-fingerprint", NULL, &fp));

  g_assert_cmpstr (key, ==, knownhosts);
  g_assert_cmpstr (fp, ==, MOCK_RSA_FP);

  g_free (knownhosts);
  g_object_unref (service);
}


static void
test_expect_host_key (TestCase *test,
                      gconstpointer data)
{
  CockpitSshService *service;
  GBytes *sent = NULL;
  JsonObject *control = NULL;
  gchar *cmd;

  cmd = g_strdup_printf ("{\"command\": \"open\","
                         " \"host-key\": \"[127.0.0.1]:%d %s\","
                         " \"channel\": \"4\", \"payload\": \"echo\"}",
                         (int)test->ssh_port, MOCK_RSA_KEY);

  /* No known hosts */
  cockpit_ssh_known_hosts = "/dev/null";
  cockpit_ssh_session_timeout = 1;

  service = cockpit_ssh_service_new (COCKPIT_TRANSPORT (test->transport));

  emit_string (test, NULL, "{\"command\": \"init\", \"version\": 1, \"host\": \"localhost\" }");
  emit_string (test, NULL, cmd);
  emit_string (test, "4", "wheee");

  handle_authorize_and_init (test, data);

  while ((sent = mock_transport_pop_channel (test->transport, "4")) == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_bytes_eq (sent, "wheee", -1);

  /* Make sure that a new channel doesn't
   * reuse the same connection. Open a new
   * channel (5) while 4 is still open.
   */
  emit_string (test, NULL, "{\"command\": \"open\", \"channel\": \"5\", \"payload\": \"echo\"}");
  /* Close the initial channel so mock-sshd dies */
  emit_string (test, NULL, "{\"command\": \"close\", \"channel\": \"4\"}");

  /*
   * Because our mock sshd only deals with one connection
   * channel 5 should be trying to connect to it instead of
   * reusing the same transport. When channel 4 closes and it's
   * transport get cleaned up mock-ssh will go away and channel
   * 5 will fail with a no-host error.
   */
  while ((control = mock_transport_pop_control (test->transport)) == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_json_eq (control, "{\"command\": \"open\", \"channel\": \"4\", \"payload\": \"echo\"}");
  control = NULL;

  while ((control = mock_transport_pop_control (test->transport)) == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_json_eq (control, "{\"command\": \"close\", \"channel\": \"5\", \"problem\":\"no-host\",\"auth-method-results\":{}}");
  control = NULL;

  g_object_unref (service);
  g_free (cmd);
}


static void
test_expect_host_key_public (TestCase *test,
                             gconstpointer data)
{
  CockpitSshService *service;
  GBytes *sent = NULL;
  JsonObject *control = NULL;
  gchar *cmd;

  cmd = g_strdup_printf ("{\"command\": \"open\", \"temp-session\": false,"
                         " \"host-key\": \"[127.0.0.1]:%d %s\","
                         " \"channel\": \"4\", \"payload\": \"echo\"}",
                         (int)test->ssh_port, MOCK_RSA_KEY);

  /* No known hosts */
  cockpit_ssh_known_hosts = "/dev/null";
  cockpit_ssh_session_timeout = 1;

  service = cockpit_ssh_service_new (COCKPIT_TRANSPORT (test->transport));

  emit_string (test, NULL, "{\"command\": \"init\", \"version\": 1, \"host\": \"localhost\" }");
  emit_string (test, NULL, cmd);
  emit_string (test, "4", "wheee");

  handle_authorize_and_init (test, data);

  while ((sent = mock_transport_pop_channel (test->transport, "4")) == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_bytes_eq (sent, "wheee", -1);

  /* Make sure that a new channel doesn't
   * reuse the same connection. Open a new
   * channel (5) while 4 is still open.
   */
  emit_string (test, NULL, "{\"command\": \"open\", \"channel\": \"5\", \"payload\": \"echo\"}");
  emit_string (test, "5", "wheee2");
  /* Close the initial channel so mock-sshd dies */
  emit_string (test, NULL, "{\"command\": \"close\", \"channel\": \"4\"}");

  /*
   * Because our mock sshd only deals with one connection
   * channel 5 should be trying to connect to it instead of
   * reusing the same transport. When channel 4 closes and it's
   * transport get cleaned up mock-ssh will go away and channel
   * 5 will fail with a no-host error.
   */
  while ((control = mock_transport_pop_control (test->transport)) == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_json_eq (control, "{\"command\": \"open\", \"channel\": \"4\", \"payload\": \"echo\"}");
  control = NULL;

  while ((sent = mock_transport_pop_channel (test->transport, "5")) == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_bytes_eq (sent, "wheee2", -1);

  g_object_unref (service);
  g_free (cmd);
}

static void
test_auth_results (TestCase *test,
                   gconstpointer data)
{
  JsonObject *control = NULL;
  CockpitSshService *service = NULL;

  /* Fail to spawn this program */
  cockpit_ssh_bridge_program = "/nonexistant";

  service = cockpit_ssh_service_new (COCKPIT_TRANSPORT (test->transport));

  emit_string (test, NULL, "{\"command\": \"init\", \"version\": 1, \"host\": \"localhost\" }");
  emit_string (test, NULL, "{\"command\": \"open\", "
                           " \"host\": \"127.0.0.1\","
                           " \"channel\": \"4\", \"payload\": \"echo\"}");

  handle_authorize_and_init (test, data);

  /* Should have gotten a failure message, about the credentials */
  while ((control = mock_transport_pop_control (test->transport)) == NULL)
    g_main_context_iteration (NULL, TRUE);
  cockpit_assert_json_eq (control, "{\"command\":\"close\",\"channel\":\"4\",\"problem\":\"no-cockpit\",\"auth-method-results\":{\"password\":\"succeeded\",\"public-key\":\"denied\",\"gssapi-mic\":\"no-server-support\"}}");
  control = NULL;

  g_object_unref (service);
}

static void
test_kill_host (TestCase *test,
                gconstpointer data)
{
  JsonObject *control = NULL;
  CockpitSshService *service = NULL;
  GHashTable *seen;
  const gchar *command;
  const gchar *channel;
  gboolean sent_kill = FALSE;

  service = cockpit_ssh_service_new (COCKPIT_TRANSPORT (test->transport));

  emit_string (test, NULL, "{\"command\": \"init\", \"version\": 1, \"host\": \"localhost\" }");
  emit_string (test, NULL, "{\"command\": \"open\","
                           " \"channel\": \"a\", \"payload\": \"echo\"}");
  emit_string (test, NULL, "{\"command\": \"open\","
                           " \"channel\": \"b\", \"payload\": \"echo\"}");
  emit_string (test, NULL, "{\"command\": \"open\","
                           " \"channel\": \"c\", \"payload\": \"echo\"}");
  seen = g_hash_table_new (g_str_hash, g_str_equal);
  g_hash_table_add (seen, "a");
  g_hash_table_add (seen, "b");
  g_hash_table_add (seen, "c");

  handle_authorize_and_init (test, data);

  /* All the close messages */
  while (g_hash_table_size (seen) > 0)
    {
      while ((control = mock_transport_pop_control (test->transport)) == NULL)
        g_main_context_iteration (NULL, TRUE);

      command = json_object_get_string_member (control, "command");
      if (!sent_kill)
        {
          emit_string (test, NULL, "{\"command\": \"kill\", \"host\": \"localhost\"}");
          sent_kill = TRUE;
        }

      if (!g_str_equal (command, "open") && !g_str_equal (command, "ready"))
        {
          g_assert_cmpstr (command, ==, "close");
          channel = json_object_get_string_member (control, "channel");
          g_assert_cmpstr (json_object_get_string_member (control, "problem"), ==, "terminated");
          g_assert (g_hash_table_remove (seen, channel));
        }
      control = NULL;
    }

  g_hash_table_destroy (seen);
  g_object_unref (service);
}

static gboolean
on_hack_raise_sigchld (gpointer user_data)
{
  raise (SIGCHLD);
  return TRUE;
}

int
main (int argc,
      char *argv[])
{
  cockpit_test_init (&argc, &argv);
  cockpit_ssh_program = BUILDDIR "/cockpit-ssh";
  cockpit_ssh_known_hosts = SRCDIR "/src/ssh/mock_known_hosts";
  cockpit_ssh_bridge_program = SRCDIR "/src/ssh/mock-pid-cat";

  /*
   * HACK: Work around races in glib SIGCHLD handling.
   *
   * https://bugzilla.gnome.org/show_bug.cgi?id=731771
   * https://bugzilla.gnome.org/show_bug.cgi?id=711090
   */
  g_timeout_add_seconds (1, on_hack_raise_sigchld, NULL);

  /* Try to debug crashing during tests */
  signal (SIGSEGV, cockpit_test_signal_backtrace);

  g_test_add ("/ssh-service/user-host-fail", TestCase,
              &fixture_custom_user, setup,
              test_user_host_fail, teardown);
  g_test_add ("/ssh-service/specified-creds", TestCase,
              &fixture_custom_user, setup,
              test_specified_creds, teardown);
  g_test_add ("/ssh-service/specified-creds-overide-host", TestCase,
              &fixture_custom_user, setup,
              test_specified_creds_overide_host, teardown);
  g_test_add ("/ssh-service/user-host-same", TestCase,
              &fixture_default, setup,
              test_user_host_reuse_password, teardown);
  g_test_add ("/ssh-service/host-port", TestCase,
              &fixture_default, setup,
              test_host_port, teardown);
  g_test_add ("/ssh-service/specified-creds-fail", TestCase,
              &fixture_custom_user, setup,
              test_specified_creds_fail, teardown);
  g_test_add ("/ssh-service/timeout-session", TestCase,
              &fixture_custom_user, setup,
              test_timeout_session, teardown);
  g_test_add ("/ssh-service/unknown-hostkey", TestCase,
              &fixture_default, setup,
              test_unknown_host_key, teardown);
  g_test_add ("/ssh-service/expect-host-key", TestCase,
              &fixture_default, setup,
              test_expect_host_key, teardown);
  g_test_add ("/ssh-service/expect-host-key-public", TestCase,
              &fixture_default, setup,
              test_expect_host_key_public, teardown);
  g_test_add ("/ssh-service/auth-results", TestCase,
              &fixture_default, setup,
              test_auth_results, teardown);
  g_test_add ("/ssh-service/kill-host", TestCase,
              &fixture_default, setup,
              test_kill_host, teardown);

  return g_test_run ();
}
