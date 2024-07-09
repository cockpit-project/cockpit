/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
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

#include "common/cockpitauthorize.h"
#include "testlib/cockpittest.h"
#include "common/cockpiterror.h"
#include "common/cockpitpipe.h"
#include "common/cockpitpipetransport.h"
#include "common/cockpitjson.h"

#include <sys/wait.h>
#include <errno.h>
#include <fcntl.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <sys/stat.h>

#define TIMEOUT 120

#define WAIT_UNTIL(cond) \
  G_STMT_START \
    while (!(cond)) g_main_context_iteration (NULL, TRUE); \
  G_STMT_END

#define PASSWORD "this is the password"

#define INVALID_KEY ""

typedef struct {
  CockpitTransport *transport;
  gboolean closed;

  /* setup_mock_sshd */
  GPid mock_sshd;
  guint16 ssh_port;
  gchar *home_dir;
  gchar *home_ssh_dir;
  gchar *home_knownhosts_file;
  gchar *home_ssh_config_file;
} TestCase;

typedef struct {
    const char *ssh_command;
    const char *mock_sshd_arg;
    const char *mock_sshd_arg_value;
    const char *client_password;
    const char *hostname;
    const char *username;
    const char *knownhosts_file;
    const char *knownhosts_home;
    const char *host_key_authorize; /* authorize x-host-key response for test_problem() */
    const char *config;
    const char *problem;
    const char *ssh_config_identity_file;
    gboolean allow_unknown;
    gboolean test_home_ssh_config;
    enum { USER_NONE = 0, USER_INVALID, USER_INVALID_HOST_PRIORITY, USER_ME } ssh_config_user;
    enum { PORT_VALID = 0, PORT_INVALID_HOST_PRIORITY } ssh_config_port;
} TestFixture;

/* check if /proc/net/if_inet6 is non-empty, otherwise there is no IPv6 support */
static gboolean
have_ipv6 (void)
{
  int fd;
  gboolean avail = FALSE;

  fd = open ("/proc/net/if_inet6", O_RDONLY);
  if (fd >= 0)
    {
      char c;
      avail = read (fd, &c, 1) == 1;
      close (fd);
    }
  return avail;
}

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
spawn_setup (gpointer data)
{
  int fd = GPOINTER_TO_INT (data);

  /* Send this signal to all direct child processes, when bridge dies */
  prctl (PR_SET_PDEATHSIG, SIGHUP);

  g_assert_cmpint (dup2 (fd, 0), >, -1);
  g_assert_cmpint (dup2 (fd, 1), >, -1);

  close (fd);
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
      "--bind", fixture->hostname ?: "127.0.0.1",
      "--user", g_get_user_name (),
      "--password", PASSWORD,
      fixture->mock_sshd_arg, fixture->mock_sshd_arg_value,
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

static const TestFixture fixture_mock_echo = {
  .ssh_command = BUILDDIR "/mock-echo"
};

static const TestFixture fixture_cat = {
  .ssh_command =  SRCDIR "/src/ws/mock-cat-with-init"
};

static const TestFixture fixture_ipv6_address = {
  .ssh_command = BUILDDIR "/mock-echo",
  .hostname = "::1",
};

static gchar **
setup_env (const TestFixture *fix)
{
  const gchar *command;
  const gchar *knownhosts_file;
  const gchar *config;
  gchar **env = g_get_environ ();

  config = fix ? fix->config : NULL;
  if (!config)
    config = SRCDIR "/src/ssh/mock-config";
  env = g_environ_setenv (env, "XDG_CONFIG_DIRS", config, TRUE);

  command = fix ? fix->ssh_command : NULL;
  if (!command)
    command = fixture_cat.ssh_command;
  env = g_environ_setenv (env, "COCKPIT_SSH_BRIDGE_COMMAND", command, TRUE);

  if (fix && fix->allow_unknown)
    {
      env = g_environ_setenv (env, "COCKPIT_SSH_CONNECT_TO_UNKNOWN_HOSTS",
                              "true", TRUE);
    }

  knownhosts_file = fix ? fix->knownhosts_file : NULL;
  if (!knownhosts_file)
      knownhosts_file = SRCDIR "/src/ssh/mock_known_hosts";

  env = g_environ_setenv (env, "COCKPIT_SSH_KNOWN_HOSTS_FILE",
                          knownhosts_file, TRUE);
  return env;
}

static CockpitTransport *
start_bridge (gchar **env,
              gchar **argv)
{
  GError *error = NULL;
  int fds[2];

  g_assert_cmpint (socketpair (PF_LOCAL, SOCK_STREAM, 0, fds), ==, 0);
  g_spawn_async_with_pipes (BUILDDIR, argv, env,
                            G_SPAWN_DO_NOT_REAP_CHILD | G_SPAWN_SEARCH_PATH,
                            spawn_setup, GINT_TO_POINTER (fds[0]),
                            NULL, NULL, NULL, NULL, &error);
  g_assert_no_error (error);
  close (fds[0]);

  return cockpit_pipe_transport_new_fds ("test-ssh", fds[1], fds[1]);
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
setup (TestCase *tc,
       gconstpointer data)
{
  const TestFixture *fixture = data;
  const gchar *argv[] = { BUILDDIR "/cockpit-ssh", NULL, NULL };
  const gchar *hostname = fixture->hostname ?: "127.0.0.1";
  gchar **env = NULL;
  gchar *host = NULL;
  gchar *path = NULL;

  alarm (TIMEOUT);

  g_assert (fixture != NULL);

  env = setup_env (fixture);
  setup_mock_sshd (tc, data);

  if (tc->ssh_port && strchr (hostname, ':') != NULL)  /* bracket IPv6 addresses */
    host = g_strdup_printf ("[%s]:%d", hostname, tc->ssh_port);
  else if (tc->ssh_port)
    host = g_strdup_printf ("%s:%d", hostname, tc->ssh_port);
  else
    host = g_strdup (hostname);
  argv[1] = host;

  /* run our tests with temp home dir, to avoid influence from the real ~/.ssh */
  tc->home_dir = g_dir_make_tmp ("home.XXXXXX", NULL);
  g_assert (tc->home_dir != NULL);
  env = g_environ_setenv (env, "HOME", tc->home_dir, TRUE);
  /* use preload library to bend getpwuid_r home dir to the temporary one */
  env = g_environ_setenv (env, "LD_PRELOAD", BUILDDIR "/libpreload-temp-home.so", TRUE);

  tc->home_ssh_dir = g_build_filename (tc->home_dir, ".ssh", NULL);
  g_assert (tc->home_ssh_dir != NULL);

  if (fixture->knownhosts_home)
    {
      gchar *content;

      tc->home_knownhosts_file = g_build_filename (tc->home_ssh_dir, "known_hosts", NULL);
      g_assert (tc->home_knownhosts_file != NULL);
      g_assert_cmpint (mkdir (tc->home_ssh_dir, 0700), ==, 0);

      content = g_strdup_printf ("[%s]:%d %s\n",
                                 fixture->hostname ?: "127.0.0.1",
                                 (int)tc->ssh_port,
                                 fixture->knownhosts_home);

      g_assert (g_file_set_contents (tc->home_knownhosts_file, content, -1, NULL));

      g_free (content);
    }

  if (fixture->test_home_ssh_config)
    {
      g_autoptr(GString) content = g_string_new (NULL);
      g_autoptr(GString) new_host = g_string_new (NULL);

      tc->home_ssh_config_file = g_build_filename (tc->home_ssh_dir, "config", NULL);
      if (!fixture->knownhosts_home)
          g_assert_cmpint (mkdir (tc->home_ssh_dir, 0700), ==, 0);

      g_string_append (content, "Host somehost\n");
      g_string_append_printf (content, "\tHostname %s\n", hostname);

      if (fixture->ssh_config_port == PORT_VALID)
        g_string_append_printf (content, "\tPort %hu\n", tc->ssh_port);
      else if (fixture->ssh_config_port == PORT_INVALID_HOST_PRIORITY)
        g_string_append_printf (content, "\tPort %d\n", (tc->ssh_port - 1));

      if (fixture->ssh_config_user == USER_ME)
        g_string_append_printf (content, "\tUser %s\n",  g_get_user_name ());
      else if (fixture->ssh_config_user == USER_INVALID || fixture->ssh_config_user == USER_INVALID_HOST_PRIORITY)
        g_string_append (content, "\tUser invalid\n");

      if (fixture->ssh_config_identity_file)
        g_string_append_printf (content, "\tIdentityFile %s\n", fixture->ssh_config_identity_file);

      g_assert (g_file_set_contents (tc->home_ssh_config_file, content->str, -1, NULL));

      g_free (host);
      /* The user in host should take priority over the user in ssh config */
      if (fixture->ssh_config_user == USER_INVALID_HOST_PRIORITY)
        g_string_append_printf (new_host, "%s@", g_get_user_name ());
      /* Host in the ssh config file */
      g_string_append (new_host, "somehost");
      /* The port in host should take priority over the port in ssh config */
      if (fixture->ssh_config_port == PORT_INVALID_HOST_PRIORITY)
        g_string_append_printf (new_host, ":%hu", tc->ssh_port);

      host = g_strdup (new_host->str);
      argv[1] = host;
    }

  tc->transport = start_bridge (env, (gchar **) argv);
  g_signal_connect (tc->transport, "closed", G_CALLBACK (on_closed_set_flag), &tc->closed);
  g_strfreev (env);
  g_free (host);
  g_free (path);
}

static void
teardown (TestCase *tc,
          gconstpointer data)
{
  if (tc->home_knownhosts_file)
    {
      unlink (tc->home_knownhosts_file);
      g_free (tc->home_knownhosts_file);
    }
  if (tc->home_ssh_config_file)
    {
      unlink (tc->home_ssh_config_file);
      g_free (tc->home_ssh_config_file);
    }
  if (tc->home_ssh_dir)
    {
      rmdir (tc->home_ssh_dir);
      g_free (tc->home_ssh_dir);
    }
  rmdir (tc->home_dir);
  g_free (tc->home_dir);

  WAIT_UNTIL (tc->closed == TRUE);
  g_object_add_weak_pointer (G_OBJECT (tc->transport), (gpointer*)&tc->transport);
  g_object_unref (tc->transport);

  /* If this asserts, outstanding references  */
  g_assert (tc->transport == NULL);

  if (tc->mock_sshd)
    {
      kill (tc->mock_sshd, SIGTERM);
      g_assert_cmpint (waitpid (tc->mock_sshd, 0, 0), ==, tc->mock_sshd);
      g_spawn_close_pid (tc->mock_sshd);
    }

  alarm (0);
}

static gboolean
on_recv_get_payload (CockpitTransport *transport,
                     const gchar *channel,
                     GBytes *message,
                     gpointer user_data)
{
  GBytes **received = user_data;
  if (channel == NULL)
    return FALSE;
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
  GBytes *check = NULL;

  if (channel == NULL)
    return FALSE;

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

static gboolean
on_control_get_options (CockpitTransport *transport,
                        const gchar *command,
                        const gchar *channel,
                        JsonObject *options,
                        GBytes *payload,
                        gpointer user_data)
{
  JsonObject **ret_options = user_data;
  g_assert (ret_options);
  g_assert (*ret_options == NULL);
  *ret_options = json_object_ref (options);
  return TRUE;
}

static void
do_auth_response (CockpitTransport *transport,
                  const gchar *challenge,
                  const gchar *response)
{
  JsonObject *auth = NULL;
  GBytes *payload = NULL;
  const gchar *cookie;
  guint sig = 0;

  sig = g_signal_connect (transport, "control",
                          G_CALLBACK (on_control_get_options),
                          &auth);
  WAIT_UNTIL (auth != NULL);
  g_signal_handler_disconnect (transport, sig);
  g_assert (cockpit_json_get_string (auth, "cookie", NULL, &cookie));
  g_assert_cmpstr (json_object_get_string_member (auth, "command"),
                   ==, "authorize");
  g_assert_cmpstr (json_object_get_string_member (auth, "challenge"),
                   ==, challenge);
  g_assert_cmpstr (cookie, !=, NULL);

  payload = cockpit_transport_build_control ("command", "authorize",
                                             "cookie", cookie,
                                             "response", response,
                                             NULL);
  cockpit_transport_send (transport, NULL, payload);
  g_bytes_unref (payload);

  json_object_unref (auth);
}

static void
do_basic_auth (CockpitTransport *transport,
               const gchar *challenge,
               const gchar *user,
               const gchar *password)
{
  gchar *userpass = NULL;
  gchar *encoded = NULL;
  gchar *response = NULL;

  userpass = g_strdup_printf ("%s:%s", user, password);
  encoded = g_base64_encode ((guchar *)userpass, strlen (userpass));
  response = g_strdup_printf ("Basic %s", encoded);

  do_auth_response (transport, challenge, response);

  g_free (userpass);
  g_free (response);
  g_free (encoded);
}

static void
do_fixture_auth (CockpitTransport *transport,
                 gconstpointer data)
{
  const TestFixture *fixture = data;
  const gchar *user;
  const gchar *password;

  password = fixture->client_password ? fixture->client_password : PASSWORD;
  user = fixture->username ? fixture->username : g_get_user_name ();
  do_basic_auth (transport, "*", user, password);
}

static JsonObject *
wait_until_transport_init (CockpitTransport *transport,
                           const gchar *expect_problem)
{
  JsonObject *init = NULL;
  guint sig;
  const gchar *problem;

  sig = g_signal_connect (transport, "control",
                          G_CALLBACK (on_control_get_options),
                          &init);
  WAIT_UNTIL (init != NULL);
  g_signal_handler_disconnect (transport, sig);

  g_assert_cmpstr (json_object_get_string_member (init, "command"),
                   ==, "init");
  g_assert (cockpit_json_get_string (init, "problem", NULL, &problem));
  g_assert_cmpstr (problem, ==, expect_problem);
  return init;
}

static void
do_echo_and_close (TestCase *tc)
{
  GBytes *received = NULL;
  GBytes *sent;
  gboolean closed = FALSE;

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
}

static void
test_echo_and_close (TestCase *tc,
                     gconstpointer data)
{
  JsonObject *init = NULL;

  do_fixture_auth (tc->transport, data);
  init = wait_until_transport_init (tc->transport, NULL);
  do_echo_and_close (tc);
  json_object_unref (init);
}

static void
test_echo_queue (TestCase *tc,
                 gconstpointer data)
{
  GBytes *sent;
  gint state = 0;
  gboolean closed = FALSE;
  JsonObject *init = NULL;

  do_fixture_auth (tc->transport, data);
  init = wait_until_transport_init (tc->transport, NULL);

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
  json_object_unref (init);
}

static void
test_echo_large (TestCase *tc,
                 gconstpointer data)
{
  GBytes *received = NULL;
  GBytes *sent;
  JsonObject *init = NULL;

  /* HACK: TODO: find out exactly why this test is so slow under Valgrind */
  if (cockpit_test_skip_slow ())
    {
      tc->closed = TRUE;
      return;
    }

  do_fixture_auth (tc->transport, data);
  init = wait_until_transport_init (tc->transport, NULL);

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

  /* Double check that didn't screw things up */
  sent = g_bytes_new_static ("yello", 5);
  cockpit_transport_send (tc->transport, "546", sent);
  while (received == NULL)
    g_main_context_iteration (NULL, TRUE);
  g_assert (g_bytes_equal (received, sent));
  g_bytes_unref (sent);
  g_bytes_unref (received);
  received = NULL;

  cockpit_transport_close (tc->transport, NULL);
  json_object_unref (init);
}

#define MOCK_RSA_KEY "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCYzo07OA0H6f7orVun9nIVjGYrkf8AuPDScqWGzlKpAqSipoQ9oY/mwONwIOu4uhKh7FTQCq5p+NaOJ6+Q4z++xBzSOLFseKX+zyLxgNG28jnF06WSmrMsSfvPdNuZKt9rZcQFKn9fRNa8oixa+RsqEEVEvTYhGtRf7w2wsV49xIoIza/bln1ABX1YLaCByZow+dK3ZlHn/UU0r4ewpAIZhve4vCvAsMe5+6KJH8ft/OKXXQY06h6jCythLV4h18gY/sYosOa+/4XgpmBiE7fDeFRKVjP3mvkxMpxce+ckOFae2+aJu51h513S9kxY2PmKaV/JU9HBYO+yO4j+j24v"
#define MOCK_RSA_KEY_INVALID  "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC7YmnYAJaC579hyNFzcszH+ZFQeDuR8I2li1vCgKeM0lOIkV5TwCY4Tl1lbXI7NNffDACQnUrJfNNm6FamdhVzFEvyQAk+iQz/Wz6lHbDlY2dVvoVaJzNWyqXu/qaYs8Mb2QUmNXKtYk4IuM8PH88z5L4JwZXRbOEPOxnJNcaazP9pBhN/0TrHALaXwW29BR0SIJicJqK2r/mPuDovg/SWs8NdgY9DTAAfzdELshTigVXlc1AX6vo71x3O9NWMaPKZuy88o0BeQNI+mkVeV04Pewm3bUlDsr3VeEcd4D+Ixdyfg4+S57K1in0kHQD4PXrd/x5GoCZekxgUuBoE7HVB"

static const gchar MOCK_RSA_FP[] = "SHA256:XQ8a7zGxMFstDrGecBRUP9OMnOUXd/T3vkNGtYShs2w";
#define SSH_PUBLICKEY_HASH_NAME "SHA256"

#define MOCK_ECDSA_PUB_KEY "ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBK4PZL/iBp7/hQhRvsBh6Mg/UsLXGIRFWTekFq1nJXm3CkBkysa3Jxi9MUkNo0hIDHly2bOMKCKNSpN2U6iGCjw="

static void
do_auth_conversation (CockpitTransport *transport,
                      const gchar *expect_prompt,
                      const gchar *expect_json,
                      const gchar *response,
                      gboolean add_header)
{
  JsonObject *auth = NULL;
  GBytes *payload = NULL;
  const gchar *cookie;
  const gchar *challenge = NULL;
  guint sig = 0;
  gchar *encoded = NULL;
  gchar *full = NULL;
  gchar *result = NULL;

  if (add_header)
    {
      encoded = g_base64_encode ((guchar *)response, strlen (response));
      full = g_strdup_printf ("x-conversation id %s", encoded);
    }
  else
    {
      full = g_strdup (response);
    }

  sig = g_signal_connect (transport, "control",
                          G_CALLBACK (on_control_get_options),
                          &auth);
  WAIT_UNTIL (auth != NULL);
  g_signal_handler_disconnect (transport, sig);

  g_assert (cockpit_json_get_string (auth, "cookie", NULL, &cookie));
  g_assert_cmpstr (json_object_get_string_member (auth, "command"),
                   ==, "authorize");
  g_assert_cmpstr (cookie, !=, NULL);

  challenge = json_object_get_string_member (auth, "challenge");
  result = cockpit_authorize_parse_x_conversation (challenge, NULL);
  g_assert_cmpstr (result, ==, expect_prompt);

  json_object_remove_member (auth, "cookie");
  json_object_remove_member (auth, "command");
  json_object_remove_member (auth, "challenge");
  cockpit_assert_json_eq (auth, expect_json);

  payload = cockpit_transport_build_control ("command", "authorize",
                                             "cookie", "cookie",
                                             "response", full,
                                             NULL);
  cockpit_transport_send (transport, NULL, payload);
  g_bytes_unref (payload);
  g_free (full);
  g_free (encoded);
  g_free (result);
  json_object_unref (auth);
}

static void
do_hostkey_conversation (TestCase *tc,
                         const gchar *response,
                         gboolean add_header)
{
  gchar *expect_json = NULL;
  expect_json = g_strdup_printf ("{\"message\": \"The authenticity of host '127.0.0.1:%d' can't be established. Do you want to proceed this time?\", \"default\": \"%s\", \"host-key\": \"[127.0.0.1]:%d %s\\n\", \"echo\": true }",
                                 (int)tc->ssh_port, MOCK_RSA_FP,
                                 (int)tc->ssh_port, MOCK_RSA_KEY);

  do_auth_conversation (tc->transport, SSH_PUBLICKEY_HASH_NAME " Fingerprint (ssh-rsa):",
                        expect_json, response, add_header);
  g_free (expect_json);
}

static void
check_host_key_values (TestCase *tc,
                       JsonObject *init,
                       const char *hostname)
{
  gchar *knownhosts = g_strdup_printf ("[%s]:%d %s\n",
                                       hostname ?: "127.0.0.1",
                                       (int)tc->ssh_port,
                                       MOCK_RSA_KEY);

  g_assert_cmpstr (json_object_get_string_member (init, "host-key"),
                   ==, knownhosts);
  g_assert_cmpstr (json_object_get_string_member (init, "host-fingerprint"),
                   ==, MOCK_RSA_FP);

  g_free (knownhosts);
}

static void
test_problem (TestCase *tc,
              gconstpointer data)
{
  JsonObject *init = NULL;
  const TestFixture *fix = data;

  do_fixture_auth (tc->transport, data);
  if (fix->host_key_authorize)
    do_auth_response (tc->transport, "x-host-key", fix->host_key_authorize);
  init = wait_until_transport_init (tc->transport, fix->problem);
  json_object_unref (init);
}

static const TestFixture fixture_unknown_localhost = {
  .knownhosts_file = "/dev/null",
  .host_key_authorize = INVALID_KEY,
  .ssh_command = BUILDDIR "/mock-echo"
};

static const TestFixture fixture_unknown_host = {
  .knownhosts_file = "/dev/null",
  .hostname = "127.0.0.99",
  .host_key_authorize = INVALID_KEY,
  .problem = "unknown-host"
};

static const TestFixture fixture_known_host_home = {
  .knownhosts_file = "/dev/null",
  .knownhosts_home = MOCK_RSA_KEY,
  .ssh_command = BUILDDIR "/mock-echo"
};

static const TestFixture fixture_home_ssh_config = {
  .knownhosts_file = "/dev/null",
  .test_home_ssh_config = TRUE,
  .knownhosts_home = MOCK_RSA_KEY,
  .allow_unknown = TRUE,
  .ssh_command = BUILDDIR "/mock-echo"
};

static const TestFixture fixture_ssh_config_valid_user = {
  .knownhosts_file = "/dev/null",
  .test_home_ssh_config = TRUE,
  .ssh_config_user = USER_ME,
  .knownhosts_home = MOCK_RSA_KEY,
  .allow_unknown = TRUE,
  .ssh_command = BUILDDIR "/mock-echo"
};

static const TestFixture fixture_ssh_config_invalid_user = {
  .knownhosts_file = "/dev/null",
  .test_home_ssh_config = TRUE,
  .ssh_config_user = USER_INVALID,
  .knownhosts_home = MOCK_RSA_KEY,
  .allow_unknown = TRUE,
  .ssh_command = BUILDDIR "/mock-echo",
  .problem = "authentication-failed"
};

static const TestFixture fixture_ssh_config_invalid_user_host_priority = {
  .knownhosts_file = "/dev/null",
  .test_home_ssh_config = TRUE,
  .ssh_config_user = USER_INVALID_HOST_PRIORITY,
  .knownhosts_home = MOCK_RSA_KEY,
  .allow_unknown = TRUE,
  .ssh_command = BUILDDIR "/mock-echo",
  .problem = "authentication-failed"
};

static const TestFixture fixture_ssh_config_invalid_port_host_priority = {
  .knownhosts_file = "/dev/null",
  .test_home_ssh_config = TRUE,
  .knownhosts_home = MOCK_RSA_KEY,
  .allow_unknown = TRUE,
  .ssh_command = BUILDDIR "/mock-echo",
  .ssh_config_port = PORT_INVALID_HOST_PRIORITY
};

static const TestFixture fixture_ssh_config_good_key = {
  .knownhosts_file = "/dev/null",
  .test_home_ssh_config = TRUE,
  .ssh_config_user = USER_ME,
  .ssh_config_identity_file = SRCDIR "/src/ssh/test_rsa",
  .client_password = "bad password", /* we don't need this password because the key will work */
  .knownhosts_home = MOCK_RSA_KEY,
  .allow_unknown = TRUE,
  .ssh_command = BUILDDIR "/mock-echo",
};

static const TestFixture fixture_ssh_config_good_key_password_protected = {
  .knownhosts_file = "/dev/null",
  .test_home_ssh_config = TRUE,
  .ssh_config_user = USER_ME,
  .ssh_config_identity_file = SRCDIR "/src/ssh/test_rsa_password_protected",
  .client_password = "bad password",
  .knownhosts_home = MOCK_RSA_KEY,
  .allow_unknown = TRUE,
  .ssh_command = BUILDDIR "/mock-echo",
  .mock_sshd_arg = "--import-pubkey",
  .mock_sshd_arg_value = SRCDIR "/src/ssh/test_rsa_password_protected.pub",
  .problem = "authentication-failed",
};

static const TestFixture fixture_ssh_config_bad_key = {
  .knownhosts_file = "/dev/null",
  .test_home_ssh_config = TRUE,
  .ssh_config_user = USER_ME,
  .ssh_config_identity_file = SRCDIR "/src/ssh/mock_rsa_key",
  .client_password = "bad password",
  .knownhosts_home = MOCK_RSA_KEY,
  .allow_unknown = TRUE,
  .ssh_command = BUILDDIR "/mock-echo",
  .problem = "authentication-failed",
};

static const TestFixture fixture_ssh_config_key_password_fallback = {
  .knownhosts_file = "/dev/null",
  .test_home_ssh_config = TRUE,
  .ssh_config_user = USER_ME,
  .ssh_config_identity_file = SRCDIR "/src/ssh/mock_rsa_key",
  .knownhosts_home = MOCK_RSA_KEY,
  .allow_unknown = TRUE,
  .ssh_command = BUILDDIR "/mock-echo",
  .problem = "authentication-failed",
};

static const TestFixture fixture_knownhost_challenge_preconnect = {
  .knownhosts_file = "/dev/null",
  .allow_unknown = TRUE,
  .ssh_command = BUILDDIR "/mock-echo"
};

static const TestFixture fixture_host_key_invalid = {
  .knownhosts_file = SRCDIR "/src/ssh/invalid_known_hosts",
};

static const TestFixture fixture_prompt_host_key = {
  .knownhosts_file = "/dev/null",
  .allow_unknown = TRUE,
  .ssh_command = BUILDDIR "/mock-echo"
};

static void
test_invalid_knownhost (TestCase *tc,
                        gconstpointer data)
{
  const TestFixture *fix = data;
  JsonObject *init = NULL;

  g_assert_cmpstr (fix->knownhosts_file, ==, SRCDIR "/src/ssh/invalid_known_hosts");
  do_auth_response (tc->transport, "*", "");

  init = wait_until_transport_init (tc->transport, "invalid-hostkey");

  json_object_unref (init);
}

static void
test_knownhost_data_prompt (TestCase *tc,
                            gconstpointer data)
{
  const TestFixture *fix = data;
  JsonObject *init = NULL;
  gchar *knownhosts = g_strdup_printf ("x-host-key [%s]:%d %s",
                                       fix->hostname ?: "127.0.0.1",
                                       (int)tc->ssh_port,
                                       MOCK_RSA_KEY);

  g_assert_cmpstr (fix->knownhosts_file, ==, "/dev/null");

  do_fixture_auth (tc->transport, data);
  do_auth_response (tc->transport, "x-host-key", knownhosts);

  init = wait_until_transport_init (tc->transport, NULL);
  do_echo_and_close (tc);

  json_object_unref (init);
  g_free (knownhosts);
}

static void
test_hostkey_unknown (TestCase *tc,
                      gconstpointer data)
{
  const TestFixture *fix = data;
  JsonObject *init = NULL;

  g_assert_cmpstr (fix->knownhosts_file, ==, "/dev/null");

  do_auth_response (tc->transport, "*", "");
  do_auth_response (tc->transport, "x-host-key", INVALID_KEY);
  do_hostkey_conversation (tc, "", FALSE);

  init = wait_until_transport_init (tc->transport, "unknown-hostkey");
  check_host_key_values (tc, init, fix->hostname);
  json_object_unref (init);
}

static void
test_hostkey_conversation (TestCase *tc,
                           gconstpointer data)
{
  const TestFixture *fix = data;
  JsonObject *init = NULL;

  g_assert_cmpstr (fix->knownhosts_file, ==, "/dev/null");

  do_fixture_auth (tc->transport, data);
  do_auth_response (tc->transport, "x-host-key", INVALID_KEY);
  do_hostkey_conversation (tc, MOCK_RSA_FP, TRUE);
  init = wait_until_transport_init (tc->transport, NULL);
  do_echo_and_close (tc);

  json_object_unref (init);
}

static void
test_hostkey_conversation_bad (TestCase *tc,
                               gconstpointer data)
{
  const TestFixture *fix = data;
  JsonObject *init = NULL;

  g_assert_cmpstr (fix->knownhosts_file, ==, "/dev/null");

  do_auth_response (tc->transport, "*", "");
  do_auth_response (tc->transport, "x-host-key", INVALID_KEY);
  do_hostkey_conversation (tc, "other-value", TRUE);
  init = wait_until_transport_init (tc->transport, "unknown-hostkey");
  check_host_key_values (tc, init, fix->hostname);
  json_object_unref (init);
}

static void
test_hostkey_conversation_invalid (TestCase *tc,
                                   gconstpointer data)
{
  const TestFixture *fix = data;
  JsonObject *init = NULL;

  g_assert_cmpstr (fix->knownhosts_file, ==, "/dev/null");

  do_auth_response (tc->transport, "*", "");
  do_auth_response (tc->transport, "x-host-key", INVALID_KEY);
  do_hostkey_conversation (tc, "other-value", FALSE);
  init = wait_until_transport_init (tc->transport, "unknown-hostkey");
  check_host_key_values (tc, init, fix->hostname);
  json_object_unref (init);
}

/* The output from this will go to stderr */
static const TestFixture fixture_bad_command = {
  .ssh_command = "/nonexistent",
  .problem = "no-cockpit"
};

/* Yes this makes a difference with bash, output goes to stdout */
static const TestFixture fixture_command_not_found = {
  .ssh_command = "nonexistant-command",
  .problem = "no-cockpit"
};

/* A valid command that exits with 0 */
static const TestFixture fixture_command_exits = {
  .ssh_command = "/usr/bin/true",
  .problem = "no-cockpit"
};

/* A valid command that exits with 1 */
static const TestFixture fixture_command_fails = {
  .ssh_command = "/usr/bin/false",
  .problem = "no-cockpit"
};

/* An ssh command that just kills itself with SIGTERM */
static const TestFixture fixture_terminate_problem = {
  .ssh_command = "kill $$",
  .problem = "terminated"
};


static const TestFixture fixture_unsupported_auth = {
  .mock_sshd_arg = "--broken-auth",
};

static void
test_unsupported_auth (TestCase *tc,
                       gconstpointer data)
{
  JsonObject *init = NULL;
  JsonObject *auth_results = NULL;

  do_fixture_auth (tc->transport, data);
  init = wait_until_transport_init (tc->transport, "authentication-failed");
  auth_results = json_object_get_object_member (init, "auth-method-results");
  cockpit_assert_json_eq (auth_results, "{\"password\":\"no-server-support\",\"public-key\":\"no-server-support\",\"gssapi-mic\":\"no-server-support\"}");

  json_object_unref (init);
}


static const TestFixture fixture_auth_failed = {
  .client_password = "bad password",
};

static void
test_auth_failed (TestCase *tc,
                  gconstpointer data)
{
  JsonObject *init = NULL;
  JsonObject *auth_results = NULL;

  do_fixture_auth (tc->transport, data);
  init = wait_until_transport_init (tc->transport, "authentication-failed");
  auth_results = json_object_get_object_member (init, "auth-method-results");
  cockpit_assert_json_eq (auth_results, "{\"password\":\"denied\",\"public-key\":\"denied\",\"gssapi-mic\":\"no-server-support\"}");

  json_object_unref (init);
}

static void
test_cannot_connect (void)
{
  const gchar *argv[] = {
    BUILDDIR "/cockpit-ssh",
    "localhost:65533",
    NULL,
  };

  JsonObject *init = NULL;
  gchar **env = setup_env (NULL);
  CockpitTransport *transport = start_bridge (env, (gchar **) argv);
  do_basic_auth (transport, "*", "user", "unused");
  init = wait_until_transport_init (transport, "no-host");

  g_object_unref (transport);
  json_object_unref (init);
  g_strfreev (env);
}

static void
test_key_good (TestCase *tc,
               gconstpointer data)
{
  g_autofree gchar *privkey = NULL;
  g_assert (g_file_get_contents (SRCDIR "/src/ssh/test_rsa", &privkey, NULL, NULL));

  g_autofree gchar *msg = g_strdup_printf ("private-key %s", privkey);

  do_auth_response (tc->transport, "*", msg);
  g_autoptr(JsonObject) init = wait_until_transport_init (tc->transport, NULL);
  do_echo_and_close (tc);
}

static void
test_key_fail (TestCase *tc,
               gconstpointer data)
{
  g_autofree gchar *privkey = NULL;
  g_assert (g_file_get_contents (SRCDIR "/src/ssh/mock_ecdsa_key", &privkey, NULL, NULL));

  g_autofree gchar *msg = g_strdup_printf ("private-key %s", privkey);

  do_auth_response (tc->transport, "*", msg);
  g_autoptr(JsonObject) init = wait_until_transport_init (tc->transport, "authentication-failed");
  JsonObject *auth_results = json_object_get_object_member (init, "auth-method-results");
  cockpit_assert_json_eq (auth_results, "{\"password\":\"not-provided\",\"public-key\":\"denied\",\"gssapi-mic\":\"no-server-support\"}");
}

static void
test_key_invalid (TestCase *tc,
                  gconstpointer data)
{
  JsonObject *init = NULL;
  JsonObject *auth_results = NULL;

  do_auth_response (tc->transport, "*", "private-key invalid");
  init = wait_until_transport_init (tc->transport, "internal-error");
  auth_results = json_object_get_object_member (init, "auth-method-results");
  cockpit_assert_json_eq (auth_results, "{\"password\":\"not-provided\",\"public-key\":\"error\",\"gssapi-mic\":\"no-server-support\"}");

  json_object_unref (init);
}

static void
test_password_good (TestCase *tc,
                    gconstpointer data)
{
  JsonObject *init = NULL;
  gchar *msg = g_strdup_printf ("password %s", PASSWORD);

  do_auth_response (tc->transport, "*", msg);
  init = wait_until_transport_init (tc->transport, NULL);
  do_echo_and_close (tc);

  json_object_unref (init);
  g_free (msg);
}

static void
test_password_fail (TestCase *tc,
                    gconstpointer data)
{
  JsonObject *init = NULL;
  JsonObject *auth_results = NULL;

  do_auth_response (tc->transport, "*", "password bad");
  init = wait_until_transport_init (tc->transport, "authentication-failed");
  auth_results = json_object_get_object_member (init, "auth-method-results");
  cockpit_assert_json_eq (auth_results, "{\"password\":\"denied\",\"public-key\":\"denied\",\"gssapi-mic\":\"no-server-support\"}");

  json_object_unref (init);
}

static void
test_basic_no_user (TestCase *tc,
                    gconstpointer data)
{
  JsonObject *init = NULL;
  JsonObject *auth_results = NULL;

  do_basic_auth (tc->transport, "*", "", PASSWORD);
  init = wait_until_transport_init (tc->transport, "authentication-failed");
  auth_results = json_object_get_object_member (init, "auth-method-results");
  cockpit_assert_json_eq (auth_results, "{}");

  json_object_unref (init);
}

static void
test_basic_user_mismatch (TestCase *tc,
                          gconstpointer data)
{
  JsonObject *init = NULL;
  JsonObject *auth_results = NULL;

  /* Auth fails because user doesn't match */
  do_basic_auth (tc->transport, "*", "other", PASSWORD);
  init = wait_until_transport_init (tc->transport, "authentication-failed");
  auth_results = json_object_get_object_member (init, "auth-method-results");
  cockpit_assert_json_eq (auth_results, "{\"password\":\"denied\",\"public-key\":\"denied\",\"gssapi-mic\":\"no-server-support\"}");

  json_object_unref (init);
}

static void
test_basic_secondary_no_user (TestCase *tc,
                              gconstpointer data)
{
  JsonObject *init = NULL;

  do_auth_response (tc->transport, "*", "");
  /* Auth succeeds because user is already set */
  do_basic_auth (tc->transport, "basic", "", PASSWORD);
  init = wait_until_transport_init (tc->transport, NULL);
  do_echo_and_close (tc);

  json_object_unref (init);
}


static void
test_basic_secondary_user_mismatch (TestCase *tc,
                                    gconstpointer data)
{
  JsonObject *init = NULL;

  do_auth_response (tc->transport, "*", "");
  /* Auth succeeds because secondary user is ignored */
  do_basic_auth (tc->transport, "basic", "bad-user", PASSWORD);
  init = wait_until_transport_init (tc->transport, NULL);
  do_echo_and_close (tc);

  json_object_unref (init);
}

static const TestFixture fixture_multi_auth = {
  .mock_sshd_arg = "--multi-step",
};

static void
test_multi_auth (TestCase *tc,
                 gconstpointer data)
{
  JsonObject *init = NULL;

  do_fixture_auth (tc->transport, data);
  do_auth_conversation (tc->transport, "Token",
                        "{\"message\":\"Password and Token\",\"echo\":true}",
                        "5", TRUE);
  init = wait_until_transport_init (tc->transport, NULL);
  do_echo_and_close (tc);

  json_object_unref (init);
}

static void
test_multi_auth_fail (TestCase *tc,
                      gconstpointer data)
{
  JsonObject *init = NULL;
  JsonObject *auth_results = NULL;

  do_fixture_auth (tc->transport, data);
  do_auth_conversation (tc->transport, "Token",
                        "{\"message\":\"Password and Token\",\"echo\":true}",
                        "4", TRUE);
  init = wait_until_transport_init (tc->transport, "authentication-failed");
  auth_results = json_object_get_object_member (init, "auth-method-results");
  cockpit_assert_json_eq (auth_results, "{\"password\":\"denied\",\"public-key\":\"denied\",\"gssapi-mic\":\"no-server-support\"}");

  json_object_unref (init);
}

static void
test_multi_auth_empty (TestCase *tc,
                       gconstpointer data)
{
  JsonObject *init = NULL;
  JsonObject *auth_results = NULL;

  do_fixture_auth (tc->transport, data);
  do_auth_conversation (tc->transport, "Token",
                        "{\"message\":\"Password and Token\",\"echo\":true}",
                        "", FALSE);
  init = wait_until_transport_init (tc->transport, "internal-error");
  auth_results = json_object_get_object_member (init, "auth-method-results");
  cockpit_assert_json_eq (auth_results, "{\"password\":\"error\",\"public-key\":\"denied\",\"gssapi-mic\":\"no-server-support\"}");

  json_object_unref (init);
}

static void
test_multi_auth_bad (TestCase *tc,
                       gconstpointer data)
{
  JsonObject *init = NULL;
  JsonObject *auth_results = NULL;

  do_fixture_auth (tc->transport, data);
  do_auth_conversation (tc->transport, "Token",
                        "{\"message\":\"Password and Token\",\"echo\":true}",
                        "invalid", FALSE);
  init = wait_until_transport_init (tc->transport, "internal-error");
  auth_results = json_object_get_object_member (init, "auth-method-results");
  cockpit_assert_json_eq (auth_results, "{\"password\":\"error\",\"public-key\":\"denied\",\"gssapi-mic\":\"no-server-support\"}");

  json_object_unref (init);
}

static void
test_multi_auth_3 (TestCase *tc,
                   gconstpointer data)
{
  JsonObject *init = NULL;

  do_fixture_auth (tc->transport, data);
  do_auth_conversation (tc->transport, "Token",
                        "{\"message\":\"Password and Token\",\"echo\":true}",
                        "6", TRUE);
  do_auth_conversation (tc->transport, "So Close",
                        "{\"message\":\"Again\",\"echo\":false}",
                        "5", TRUE);
  init = wait_until_transport_init (tc->transport, NULL);
  do_echo_and_close (tc);

  json_object_unref (init);
}

static void
test_multi_auth_3_fail (TestCase *tc,
                        gconstpointer data)
{
  JsonObject *init = NULL;
  JsonObject *auth_results = NULL;

  do_fixture_auth (tc->transport, data);
  do_auth_conversation (tc->transport, "Token",
                        "{\"message\":\"Password and Token\",\"echo\":true}",
                        "6", TRUE);
  do_auth_conversation (tc->transport, "So Close",
                        "{\"message\":\"Again\",\"echo\":false}",
                        "4", TRUE);
  init = wait_until_transport_init (tc->transport, "authentication-failed");
  auth_results = json_object_get_object_member (init, "auth-method-results");
  cockpit_assert_json_eq (auth_results, "{\"password\":\"denied\",\"public-key\":\"denied\",\"gssapi-mic\":\"no-server-support\"}");

  json_object_unref (init);
}


int
main (int argc,
      char *argv[])
{

  cockpit_test_init (&argc, &argv);

  g_test_add ("/ssh-bridge/echo-message", TestCase, &fixture_mock_echo,
              setup, test_echo_and_close, teardown);
  g_test_add ("/ssh-bridge/echo-queue", TestCase, &fixture_mock_echo,
              setup, test_echo_queue, teardown);
  g_test_add ("/ssh-bridge/echo-large", TestCase, &fixture_cat,
              setup, test_echo_large, teardown);

  if (have_ipv6 ())
    g_test_add ("/ssh-bridge/ipv6-address", TestCase, &fixture_ipv6_address,
                setup, test_echo_and_close, teardown);
  else
    g_message ("No IPv6 support, skipping IPv6 tests");

  g_test_add ("/ssh-bridge/bad-command", TestCase, &fixture_bad_command,
              setup, test_problem, teardown);
  g_test_add ("/ssh-bridge/command-not-found", TestCase, &fixture_command_not_found,
              setup, test_problem, teardown);
  g_test_add ("/ssh-bridge/command-not-cockpit", TestCase, &fixture_command_exits,
              setup, test_problem, teardown);
  g_test_add ("/ssh-bridge/command-just-fails", TestCase, &fixture_command_fails,
              setup, test_problem, teardown);
  g_test_add_func ("/ssh-bridge/cannot-connect", test_cannot_connect);
  g_test_add ("/ssh-bridge/ssh-config-home", TestCase, &fixture_home_ssh_config,
              setup, test_echo_and_close, teardown);
  g_test_add ("/ssh-bridge/ssh-config-valid-user", TestCase, &fixture_ssh_config_valid_user,
              setup, test_echo_and_close, teardown);
  g_test_add ("/ssh-bridge/ssh-config-invalid-user", TestCase, &fixture_ssh_config_invalid_user,
              setup, test_problem, teardown);
  g_test_add ("/ssh-bridge/ssh-config-host-user-priority", TestCase, &fixture_ssh_config_invalid_user_host_priority,
              setup, test_echo_and_close, teardown);
  g_test_add ("/ssh-bridge/ssh-config-host-port-priority", TestCase, &fixture_ssh_config_invalid_port_host_priority,
              setup, test_echo_and_close, teardown);
  g_test_add ("/ssh-bridge/ssh-config-home-good-key", TestCase, &fixture_ssh_config_good_key,
              setup, test_echo_and_close, teardown);
  g_test_add ("/ssh-bridge/ssh-config-home-good-key-password-protected", TestCase, &fixture_ssh_config_good_key_password_protected,
              setup, test_problem, teardown);
  g_test_add ("/ssh-bridge/ssh-config-home-bad-key", TestCase, &fixture_ssh_config_bad_key,
              setup, test_problem, teardown);
  g_test_add ("/ssh-bridge/ssh-config-home-bad-key-good-key-fallback", TestCase, &fixture_ssh_config_bad_key,
              setup, test_key_good, teardown);
  g_test_add ("/ssh-bridge/ssh-config-home-key-password-fallback", TestCase, &fixture_ssh_config_key_password_fallback,
              setup, test_echo_and_close, teardown);

  g_test_add ("/ssh-bridge/terminate-problem", TestCase, &fixture_terminate_problem,
              setup, test_problem, teardown);
  g_test_add ("/ssh-bridge/unsupported-auth", TestCase, &fixture_unsupported_auth,
              setup, test_unsupported_auth, teardown);
  g_test_add ("/ssh-bridge/auth-failed", TestCase,
              &fixture_auth_failed, setup,
              test_auth_failed, teardown);
  g_test_add ("/ssh-bridge/key-good", TestCase, &fixture_mock_echo,
              setup, test_key_good, teardown);
  g_test_add ("/ssh-bridge/key-invalid", TestCase, &fixture_mock_echo,
              setup, test_key_invalid, teardown);
  g_test_add ("/ssh-bridge/key-fail", TestCase, &fixture_mock_echo,
              setup, test_key_fail, teardown);
  g_test_add ("/ssh-bridge/password-fail", TestCase, &fixture_mock_echo,
              setup, test_password_fail, teardown);
  g_test_add ("/ssh-bridge/password-good", TestCase, &fixture_mock_echo,
              setup, test_password_good, teardown);
  g_test_add ("/ssh-bridge/basic-no-user", TestCase, &fixture_mock_echo,
              setup, test_basic_no_user, teardown);
  g_test_add ("/ssh-bridge/basic-secondary-no-user", TestCase, &fixture_mock_echo,
              setup, test_basic_secondary_no_user, teardown);
  g_test_add ("/ssh-bridge/basic-user-mismatch", TestCase, &fixture_mock_echo,
              setup, test_basic_user_mismatch, teardown);
  g_test_add ("/ssh-bridge/basic-secondary-user-mismatch", TestCase, &fixture_mock_echo,
              setup, test_basic_secondary_user_mismatch, teardown);
  g_test_add ("/ssh-bridge/kb-multi-bad", TestCase,
              &fixture_multi_auth,
              setup, test_multi_auth_bad, teardown);
  g_test_add ("/ssh-bridge/kb-multi-empty", TestCase,
              &fixture_multi_auth,
              setup, test_multi_auth_empty, teardown);
  g_test_add ("/ssh-bridge/kb-multi-fail", TestCase,
              &fixture_multi_auth,
              setup, test_multi_auth_fail, teardown);
  g_test_add ("/ssh-bridge/kb-multi-echo-message", TestCase,
              &fixture_multi_auth,
              setup, test_multi_auth, teardown);
  g_test_add ("/ssh-bridge/kb-multi-3-fail", TestCase,
              &fixture_multi_auth,
              setup, test_multi_auth_3_fail, teardown);
  g_test_add ("/ssh-bridge/kb-multi-3-echo-message", TestCase,
              &fixture_multi_auth,
              setup, test_multi_auth_3, teardown);

  g_test_add ("/ssh-bridge/unknown-host", TestCase, &fixture_unknown_host,
              setup, test_problem, teardown);
  g_test_add ("/ssh-bridge/unknown-localhost", TestCase, &fixture_unknown_localhost,
              setup, test_hostkey_unknown, teardown);
  g_test_add ("/ssh-bridge/knownhost-challenge-preconnect", TestCase,
              &fixture_knownhost_challenge_preconnect,
              setup, test_knownhost_data_prompt, teardown);
  g_test_add ("/ssh-bridge/knownhost-invalid", TestCase, &fixture_host_key_invalid,
              setup, test_invalid_knownhost, teardown);
  g_test_add ("/ssh-bridge/knownhost-home", TestCase, &fixture_known_host_home,
              setup, test_echo_and_close, teardown);

  g_test_add ("/ssh-bridge/hostkey-unknown", TestCase, &fixture_prompt_host_key,
              setup, test_hostkey_unknown, teardown);
  g_test_add ("/ssh-bridge/hostkey-conversation", TestCase, &fixture_prompt_host_key,
              setup, test_hostkey_conversation, teardown);
  g_test_add ("/ssh-bridge/hostkey-conversation-bad", TestCase, &fixture_prompt_host_key,
              setup, test_hostkey_conversation_bad, teardown);
  g_test_add ("/ssh-bridge/hostkey-conversation-invalid", TestCase, &fixture_prompt_host_key,
              setup, test_hostkey_conversation_invalid, teardown);

  return g_test_run ();
}
