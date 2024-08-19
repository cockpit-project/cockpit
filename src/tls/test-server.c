/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2019 Red Hat, Inc.
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

#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdlib.h>
#include <string.h>
#include <netinet/in.h>
#include <sys/poll.h>
#include <sys/socket.h>
#include <sys/wait.h>

#include <glib.h>
#include <glib/gstdio.h>
#include <gnutls/x509.h>

#include "connection.h"
#include "testing.h"
#include "server.h"
#include "utils.h"
#include "testlib/cockpittest.h"
#include "common/cockpithacks-glib.h"

#define SOCKET_ACTIVATION_HELPER BUILDDIR "/socket-activation-helper"
#define COCKPIT_WS BUILDDIR "/cockpit-ws"
/* this has a corresponding mock-server.key */
#define CERTFILE SRCDIR "/src/bridge/mock-server.crt"
#define KEYFILE SRCDIR "/src/bridge/mock-server.key"

#define CLIENT_CERTFILE SRCDIR "/src/tls/ca/alice.pem"
#define CLIENT_KEYFILE SRCDIR "/src/tls/ca/alice.key"
#define ALTERNATE_CERTFILE SRCDIR "/src/tls/ca/bob.pem"
#define ALTERNATE_KEYFILE SRCDIR "/src/tls/ca/bob.key"
#define CLIENT_EXPIRED_CERTFILE SRCDIR "/src/tls/ca/alice-expired.pem"

typedef struct {
  gchar *ws_socket_dir;
  gchar *runtime_dir;
  gchar *clients_dir;
  gchar *cgroup_line;
  GPid ws_spawner;
  struct sockaddr_in server_addr;
} TestCase;

typedef struct {
  const char *certfile;
  const char *keyfile;
  int cert_request_mode;
  int idle_timeout;
  const char *client_crt;
  const char *client_key;
  const char *client_fingerprint;
} TestFixture;

static const TestFixture fixture_separate_crt_key = {
  .certfile = CERTFILE,
  .keyfile = KEYFILE,
};

static const TestFixture fixture_separate_crt_key_client_cert = {
  .certfile = CERTFILE,
  .keyfile = KEYFILE,
  .cert_request_mode = GNUTLS_CERT_REQUEST,
  .client_crt = CLIENT_CERTFILE,
  .client_key = CLIENT_KEYFILE,
  .client_fingerprint = CLIENT_CERT_FINGERPRINT,
};

static const TestFixture fixture_expired_client_cert = {
  .certfile = CERTFILE,
  .keyfile = KEYFILE,
  .cert_request_mode = GNUTLS_CERT_REQUEST,
  .client_crt = CLIENT_EXPIRED_CERTFILE,
  .client_key = CLIENT_KEYFILE,
  .client_fingerprint = CLIENT_CERT_FINGERPRINT,
};

static const TestFixture fixture_alternate_client_cert = {
  .certfile = CERTFILE,
  .keyfile = KEYFILE,
  .cert_request_mode = GNUTLS_CERT_REQUEST,
  .client_crt = ALTERNATE_CERTFILE,
  .client_key = ALTERNATE_KEYFILE,
  .client_fingerprint = ALTERNATE_FINGERPRINT,
};

static const TestFixture fixture_run_idle = {
  .idle_timeout = 1,
};

/* for forking test cases, where server's SIGCHLD handling gets in the way */
static void
block_sigchld (void)
{
  const struct sigaction child_action = { .sa_handler = SIG_DFL };
  g_assert_cmpint (sigaction (SIGCHLD, &child_action, NULL), ==, 0);
}

/* check if we have a client certificate for a given cgroup */
static bool
check_for_certfile (TestCase *tc,
                    char **out_contents)
{
  g_autoptr(GDir) dir = g_dir_open (tc->clients_dir, 0, NULL);
  g_assert (dir != NULL);

  const char *name;
  while ((name = g_dir_read_name (dir)))
    {
      g_autofree char *filename = g_build_filename (tc->clients_dir, name, NULL);

      g_autofree char *contents = NULL;
      g_autoptr(GError) error = NULL;
      if (!g_file_get_contents (filename, &contents, NULL, &error))
        {
          /* files are flying around all the time: this might reasonably fail */
          if (g_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_NOENT))
            continue;
          g_assert_no_error (error);
          g_assert_not_reached ();
        }

      if (g_str_has_prefix (contents, tc->cgroup_line))
        {
          if (out_contents)
            *out_contents = g_steal_pointer (&contents);

          return true;
        }
    }

  return false;
}

static int
do_connect (TestCase *tc)
{
  int fd = socket (AF_INET, SOCK_STREAM | SOCK_CLOEXEC, 0);
  g_assert_cmpint (fd, >, 0);
  if (connect (fd, (struct sockaddr *) &tc->server_addr, sizeof (tc->server_addr)) < 0)
    {
      close (fd);
      return -errno;
    }
  else
    {
      return fd;
    }
}

static void
send_request (int fd, const char *request)
{
  g_assert_cmpint (fd, >, 0);
  g_assert_cmpint (write (fd, request, strlen (request)), ==, strlen (request));
}

static const char*
recv_reply (int fd, char *buf, size_t buflen)
{
  ssize_t len;

  len = recv (fd, buf, buflen - 1, MSG_DONTWAIT);
  close (fd);
  if (len < 0)
    g_error ("recv_reply: unexpected error: %m");
  g_assert_cmpint (len, >=, 50);
  buf[len] = '\0'; /* so that we can use string functions on it */

  return buf;
}

static const char*
do_request (TestCase *tc, const char *request)
{
  static char buf[4096];
  int fd = do_connect (tc);
  int res;

  send_request (fd, request);
  /* wait until data is available */
  for (int timeout = 0; timeout < 100; ++timeout) {
    res = recv (fd, buf, 100, MSG_PEEK | MSG_DONTWAIT);
    if (res >= 50)
      return recv_reply (fd, buf, sizeof (buf));

    server_poll_event (100);
  }

  g_error ("timed out waiting for enough data to become available: res=%d, error: %m", res);
}

static void
assert_http (TestCase *tc)
{
  const char *res = do_request (tc, "GET / HTTP/1.0\r\nHost: localhost\r\n\r\n");
  /* This succeeds (200 OK) when building in-tree, but fails with dist-check due to missing doc root */
  if (strstr (res, "200 OK"))
    {
      cockpit_assert_strmatch (res, "HTTP/1.1 200 OK\r\n"
                                    "Content-Type: text/html\r\n"
                                    "Content-Security-Policy: connect-src 'self' http://localhost ws://localhost;*");
    }
  else
    {
      cockpit_assert_strmatch (res, "HTTP/1.1 404 Not Found\r\nContent-Type: text/html*");
    }
}

static void
assert_https_outcome (TestCase *tc,
                      const TestFixture *fixture,
                      unsigned expected_server_certs,
                      bool expect_tls_failure)
{
  pid_t pid;
  int status = -1;

  block_sigchld ();

  /* do the connection in a subprocess, as gnutls_handshake is synchronous */
  pid = fork ();
  if (pid < 0)
    g_error ("failed to fork: %m");
  if (pid == 0)
    {
      const char request[] = "GET / HTTP/1.0\r\nHost: localhost\r\n\r\n";
      char buf[4096];
      gnutls_session_t session;
      gnutls_certificate_credentials_t xcred;
      const gnutls_datum_t *server_certs;
      unsigned server_certs_len;
      ssize_t len;
      int ret;
      int fd = do_connect (tc);

      g_assert_cmpint (fd, >, 0);

      g_assert_cmpint (gnutls_init (&session, GNUTLS_CLIENT), ==, GNUTLS_E_SUCCESS);
      gnutls_transport_set_int (session, fd);
      g_assert_cmpint (gnutls_set_default_priority (session), ==, GNUTLS_E_SUCCESS);
      gnutls_handshake_set_timeout(session, 5000);
      g_assert_cmpint (gnutls_certificate_allocate_credentials (&xcred), ==, GNUTLS_E_SUCCESS);
      g_assert_cmpint (gnutls_certificate_set_x509_system_trust (xcred), >=, 0);
      if (fixture && fixture->client_crt)
        {
          g_assert (fixture->client_key);
          g_assert_cmpint (gnutls_certificate_set_x509_key_file (xcred,
                                                                 fixture->client_crt,
                                                                 fixture->client_key,
                                                                 GNUTLS_X509_FMT_PEM),
                           ==, GNUTLS_E_SUCCESS);;
        }
      g_assert_cmpint (gnutls_credentials_set (session, GNUTLS_CRD_CERTIFICATE, xcred), ==, GNUTLS_E_SUCCESS);

      ret = gnutls_handshake (session);
      if (ret != GNUTLS_E_SUCCESS)
        {
          if (expect_tls_failure)
            exit (0);
          else
            g_error ("Handshake failed: %s", gnutls_strerror (ret));
        }

      /* check server certificate */
      server_certs = gnutls_certificate_get_peers (session, &server_certs_len);
      g_assert (server_certs);
      g_assert_cmpuint (server_certs_len, ==, expected_server_certs);

      /* send request, read response */
      len = gnutls_record_send (session, request, sizeof (request));
      if (len < 0 && expect_tls_failure)
        exit (0);
      g_assert_cmpint (len, ==, sizeof (request));

      len = gnutls_record_recv (session, buf, sizeof (buf) - 1);
      if (len < 0 && expect_tls_failure)
        exit (0);
      g_assert_cmpint (len, >=, 100);
      g_assert_cmpint (len, <=, sizeof (buf) - 1);

      buf[len] = '\0'; /* so that we can use string functions on it */
      /* This succeeds (200 OK) when building in-tree, but fails with dist-check due to missing doc root */
      if (strstr (buf, "200 OK"))
        {
          cockpit_assert_strmatch (buf, "HTTP/1.1 200 OK\r\n"
                                        "Content-Type: text/html\r\n"
                                        "Content-Security-Policy: connect-src 'self' https://localhost wss://localhost;*");
        }
      else
        {
          cockpit_assert_strmatch (buf, "HTTP/1.1 404 Not Found\r\nContent-Type: text/html*");
        }

      /* check client certificate in state dir */
      if (fixture && fixture->client_crt && tc->cgroup_line)
        {
          if (fixture->cert_request_mode != GNUTLS_CERT_IGNORE)
            {
              g_autofree char *cert_file = NULL;
              g_autofree char *expected_pem = NULL;

              g_assert (check_for_certfile (tc, &cert_file));
              g_assert (g_file_get_contents (fixture->client_crt, &expected_pem, NULL, NULL));
              g_assert (g_str_has_suffix (cert_file, expected_pem));
            }
          else
            {
              g_assert (!check_for_certfile (tc, NULL));
            }
        }

      g_assert_cmpint (gnutls_bye (session, GNUTLS_SHUT_RDWR), ==, GNUTLS_E_SUCCESS);

      g_assert_false (expect_tls_failure);

      close (fd);
      exit (0);
    }

  for (int retry = 0; retry < 100 && waitpid (pid, &status, WNOHANG) <= 0; ++retry)
    server_poll_event (200);
  g_assert_cmpint (status, ==, 0);

  /* cleans up client certificate after closing connection */
  g_assert (!check_for_certfile (tc, NULL));
}

static void
assert_https (TestCase *tc, const TestFixture *fixture, unsigned expected_server_certs)
{
  assert_https_outcome (tc, fixture, expected_server_certs, false);
}

static void
setup (TestCase *tc, gconstpointer data)
{
  const TestFixture *fixture = data;
  g_autoptr(GError) error = NULL;

  alarm (120);

  tc->ws_socket_dir = g_dir_make_tmp ("server.wssock.XXXXXX", NULL);
  g_assert (tc->ws_socket_dir);

  /* This absolutely must be on a real filesystem: overlayfs (as often
   * seen for /tmp in containers) doesn't work.  /dev/shm is always
   * tmpfs, which works nicely (and matches what we expect to be at /run
   * when we use this code in production).
   */
  char runtime_dir_template[] = "/dev/shm/server.runtime.XXXXXX";
  tc->runtime_dir = g_mkdtemp (runtime_dir_template);
  g_assert (tc->runtime_dir);
  tc->runtime_dir = g_strdup (tc->runtime_dir);
  tc->clients_dir = g_build_filename (tc->runtime_dir, "clients", NULL);

  if (fixture && fixture->client_fingerprint)
    tc->cgroup_line = g_strdup_printf ("0::/system.slice/system-cockpithttps.slice/cockpit-wsinstance-https@%s.service\n", fixture->client_fingerprint);

  gchar* sah_argv[] = { SOCKET_ACTIVATION_HELPER, COCKPIT_WS, tc->ws_socket_dir, NULL };
  if (!g_spawn_async (NULL, sah_argv, NULL, G_SPAWN_DO_NOT_REAP_CHILD, NULL, NULL, &tc->ws_spawner, &error))
    g_error ("Failed to spawn " SOCKET_ACTIVATION_HELPER ": %s", error->message);

  /* wait until socket activation helper is ready */
  int socket_dir_fd = open (tc->ws_socket_dir, O_RDONLY | O_DIRECTORY);
  g_assert_cmpint (socket_dir_fd, >=, 0);
  for (int retry = 0; retry < 200; ++retry)
    {
      if (faccessat (socket_dir_fd, "ready", F_OK, 0) == 0)
        break;
      g_usleep (10000);
    }
  close (socket_dir_fd);

  /* Let the kernel assign a port */
  server_init (tc->ws_socket_dir, tc->runtime_dir, fixture ? fixture->idle_timeout : 0, 0);

  if (fixture && fixture->certfile)
    connection_crypto_init (fixture->certfile, fixture->keyfile, false, fixture->cert_request_mode);

  /* Figure out the socket address we ought to connect to */
  socklen_t addrlen = sizeof tc->server_addr;
  int r = getsockname (server_get_listener (), (struct sockaddr *) &tc->server_addr, &addrlen);
  g_assert_no_errno (r);

  /* Sanity check */
  g_assert_cmpint (addrlen, ==, sizeof tc->server_addr);
  g_assert_cmpint (tc->server_addr.sin_family, ==, AF_INET);
}

static void
teardown (TestCase *tc, gconstpointer data)
{
  for (int i = 0; i < 100 && server_num_connections (); i++) /* 10s */
    g_usleep (100000); /* 0.1s */

  server_cleanup ();
  g_assert_cmpint (kill (tc->ws_spawner, SIGTERM), ==, 0);
  g_assert_cmpint (waitpid (tc->ws_spawner, NULL, 0), ==, tc->ws_spawner);

  /* all children got cleaned up */
  g_assert_cmpint (wait (NULL), ==, -1);
  g_assert_cmpint (errno, ==, ECHILD);
  /* connection should fail */
  /* coverity[leaked_handle : FALSE] */
  g_assert_cmpint (do_connect (tc), ==, -ECONNREFUSED);
  g_unsetenv ("COCKPIT_WS_PROCESS_IDLE");

  int socket_dir_fd = open (tc->ws_socket_dir, O_RDONLY | O_DIRECTORY);
  g_assert_cmpint (socket_dir_fd, >=, 0);
  g_assert_cmpint (unlinkat (socket_dir_fd, "http.sock", 0), ==, 0);
  g_assert_cmpint (unlinkat (socket_dir_fd, "https-factory.sock", 0), ==, 0);
  g_assert_cmpint (unlinkat (socket_dir_fd, "https@" SHA256_NIL ".sock", 0), ==, 0);
  g_assert_cmpint (unlinkat (socket_dir_fd, "https@" CLIENT_CERT_FINGERPRINT ".sock", 0), ==, 0);
  g_assert_cmpint (unlinkat (socket_dir_fd, "https@" ALTERNATE_FINGERPRINT ".sock", 0), ==, 0);
  g_assert_cmpint (unlinkat (socket_dir_fd, "ready", 0), ==, 0);
  close (socket_dir_fd);
  g_assert_cmpint (g_rmdir (tc->ws_socket_dir), ==, 0);
  g_free (tc->ws_socket_dir);

  g_free (tc->cgroup_line);

  g_assert_cmpint (g_rmdir (tc->clients_dir), ==, 0);
  g_free (tc->clients_dir);

  g_assert_cmpint (g_rmdir (tc->runtime_dir), ==, 0);
  g_free (tc->runtime_dir);

  alarm (0);
}

static void
test_no_tls_single (TestCase *tc, gconstpointer data)
{
  g_assert_cmpuint (server_num_connections (), ==, 0);
  assert_http (tc);

  /* let the server process "peer has closed connection" */
  for (int retries = 0; retries < 10 && server_num_connections () == 1; ++retries)
    server_poll_event (100);
  g_assert_cmpuint (server_num_connections (), ==, 0);
}

static void
test_no_tls_many_serial (TestCase *tc, gconstpointer data)
{
  for (int i = 0; i < 20; ++i)
    assert_http (tc);
}

static void
test_tls_blocked_handshake (TestCase *tc, gconstpointer data)
{
  block_sigchld ();

  pid_t pid = fork ();
  if (pid == -1)
    g_error ("fork failed: %m");

  if (pid == 0)
    {
      /* child */
      gint first_fd = do_connect (tc);
      send_request (first_fd, "\x16"); /* start the TLS handshake */

      /* Make sure the byte gets there before the next connection request */
      sleep (1);

      /* make sure we can do a second connection while the first one is
       * blocked in the handshake
       */
      gint second_fd = do_connect (tc);
      send_request (second_fd, "GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");

      /* wait 10 seconds for the reply */
      struct pollfd pfd = { .fd = second_fd, .events = POLLIN };
      g_assert_cmpint (poll (&pfd, 1, 10000), ==, 1);
      close (second_fd);

      close (first_fd);
      exit (0);
    }
  else
    {
      /* parent */
      int status;

      while (waitpid (pid, &status, WNOHANG) <= 0)
        server_poll_event (50);
      g_assert_cmpint (status, ==, 0);
    }
}

static void
test_no_tls_many_parallel (TestCase *tc, gconstpointer data)
{
  int i;

  block_sigchld ();

  for (i = 0; i < 20; ++i)
    {
      pid_t pid = fork ();
      if (pid < 0)
        g_error ("failed to fork: %m");

      if (pid > 0)
        continue;

      /* child */
      char buf[4096];
      int fd = do_connect (tc);

      server_cleanup ();

      send_request (fd, "GET / HTTP/1.0\r\nHost: localhost\r\n\r\n");
      /* wait until data is available */
      for (int timeout = 0; timeout < 10 && recv (fd, buf, 100, MSG_PEEK | MSG_DONTWAIT) < 100; ++timeout)
        sleep (1);
      recv_reply (fd, buf, sizeof (buf));
      /* This succeeds (200 OK) when building in-tree, but fails with dist-check due to missing doc root */
      if (strstr (buf, "200 OK"))
        cockpit_assert_strmatch (buf, "HTTP/1.1 200 OK*");
      else
        cockpit_assert_strmatch (buf, "HTTP/1.1 404 Not Found*");
      exit (0);
    }

  /* wait until all i child processes have finished */
  while (i > 0)
  {
    int status;
    int r = waitpid (-1, &status, WNOHANG);
    g_assert_cmpint (r, >=, 0);
    if (r == 0)
      {
        server_poll_event (50);
      }
    else
      {
        g_assert_cmpint (status, ==, 0);
        --i;
      }
  }
}

static void
test_no_tls_redirect (TestCase *tc, gconstpointer data)
{
  /* Make sure we connect on something other than localhost */
  tc->server_addr.sin_addr.s_addr = htonl (INADDR_LOOPBACK + 1);

  /* without TLS support it should not redirect */
  const char *res = do_request (tc, "GET / HTTP/1.0\r\nHost: some.remote:1234\r\n\r\n");
  /* This succeeds (200 OK) when building in-tree, but fails with dist-check due to missing doc root */
  if (strstr (res, "200 OK"))
    cockpit_assert_strmatch (res, "HTTP/1.1 200 OK*");
  else
    cockpit_assert_strmatch (res, "HTTP/1.1 404 Not Found*");
}

static void
test_tls_no_client_cert (TestCase *tc, gconstpointer data)
{
  assert_https (tc, data, 1);
}

static void
test_tls_no_server_cert (TestCase *tc, gconstpointer data)
{
  assert_http (tc);
  assert_https_outcome (tc, data, 0, true);
  assert_http (tc);
}

static void
test_tls_redirect (TestCase *tc, gconstpointer data)
{
  /* Make sure we connect on something other than localhost */
  tc->server_addr.sin_addr.s_addr = htonl (INADDR_LOOPBACK + 1);

  /* with TLS support it should redirect */
  const char *res = do_request (tc, "GET / HTTP/1.0\r\nHost: some.remote:1234\r\n\r\n");
  cockpit_assert_strmatch (res, "HTTP/1.1 301 Moved Permanently*");
}

static void
test_tls_client_cert (TestCase *tc, gconstpointer data)
{
  assert_https (tc, data, 1);
  /* no-cert case is handled by separate ws; pass NULL fixture to not use a client cert */
  assert_https (tc, NULL, 1);
  assert_https (tc, data, 1);
}

static void
test_tls_client_cert_disabled (TestCase *tc, gconstpointer data)
{
  assert_https (tc, data, 1);
  /* no-cert case is handled by same ws, as client certs are disabled server-side;
     pass NULL fixture to not use a client cert */
  assert_https (tc, NULL, 1);
}

static void
test_tls_client_cert_expired (TestCase *tc, gconstpointer data)
{
  /* expect_tls_failure==true only does a coarse-grained check that the request
   * fails anywhere during handshake or the first send/recv. GnuTLS 3.6.4
   * introduces TLS 1.3 by default, which has only a two-step handshake: that
   * does not pick up the server's late failing handshake from the verify
   * function, only the next read/write attempt does */
  assert_https_outcome (tc, data, 1, true);
}

static void
test_tls_client_cert_parallel (TestCase *tc, gconstpointer data)
{
  const TestFixture *fixture = data;
  gboolean alternate = strcmp (fixture->client_fingerprint, ALTERNATE_FINGERPRINT) == 0;
  pid_t pid;
  int status;

  /* HACK: This testcase runs slowly under valgrind and sometimes fails
   * inexplicably.  It's not likely that we're going to find leaks in
   * the code with this test, so running it under valgrind is just
   * costing us pain.  Disable it for now.
   */
  if (cockpit_test_skip_slow ())
    return;

  block_sigchld ();

  /* do the connection in a subprocess, as gnutls_handshake is synchronous */
  pid = fork ();
  if (pid < 0)
    g_error ("failed to fork: %m");
  if (pid == 0)
    {
      gnutls_certificate_credentials_t xcred;
      const unsigned n_connections = 20;
      int fds[n_connections];
      gnutls_session_t sessions[n_connections];

      g_assert_cmpint (gnutls_certificate_allocate_credentials (&xcred), ==, GNUTLS_E_SUCCESS);
      g_assert_cmpint (gnutls_certificate_set_x509_system_trust (xcred), >=, 0);
      g_assert_cmpint (gnutls_certificate_set_x509_key_file (xcred,
                                                             fixture->client_crt,
                                                             fixture->client_key,
                                                             GNUTLS_X509_FMT_PEM),
                       ==, GNUTLS_E_SUCCESS);

      g_assert (!check_for_certfile (tc, NULL));

      /* start parallel connections; we don't actually need to send/receive anything (i. e. talk to cockpit-ws) --
       * certificate export and refcounting is entirely done on the client → cockpit-tls side */
      for (unsigned i = 0; i < n_connections; ++i)
        {
          fds[i] = do_connect (tc);
          g_assert_cmpint (fds[i], >, 0);

          g_assert_cmpint (gnutls_init (&sessions[i], GNUTLS_CLIENT), ==, GNUTLS_E_SUCCESS);
          gnutls_transport_set_int (sessions[i], fds[i]);
          g_assert_cmpint (gnutls_set_default_priority (sessions[i]), ==, GNUTLS_E_SUCCESS);
          g_assert_cmpint (gnutls_credentials_set (sessions[i], GNUTLS_CRD_CERTIFICATE, xcred), ==, GNUTLS_E_SUCCESS);
          gnutls_handshake_set_timeout(sessions[i], 5000);
          g_assert_cmpint (gnutls_handshake (sessions[i]), ==, GNUTLS_E_SUCCESS);

          /* the file should be written on first connection, and just exist for the next ones.
           *
           * In the "alternate" mode we will receive a "hello" message to tell us that the
           * server is active (by which time the file will have been created).  For the
           * other case, we have to wait for it to appear.
           * */
          if (alternate)
            {
              char buffer[6];
              ssize_t s;

              do
                s = gnutls_record_recv (sessions[i], buffer, sizeof buffer);
              while (s == GNUTLS_E_INTERRUPTED);
              g_assert_cmpint (s, ==, 5);
              g_assert (memcmp (buffer, "hello", 5) == 0);
            }
          else
            {
              if (i == 0)
                {
                  for (int retry = 0; retry < 100; ++retry)
                    {
                      if (check_for_certfile (tc, NULL))
                        break;
                      g_usleep (10000);
                    }
                }
            }

          g_assert (check_for_certfile (tc, NULL));
        }

      /* close the connections again, all but the last one */
      for (unsigned i = 0; i < n_connections - 1; ++i)
        {
          g_assert_cmpint (gnutls_bye (sessions[i], GNUTLS_SHUT_RDWR), ==, GNUTLS_E_SUCCESS);
          close (fds[i]);
        }

      if (!alternate)
        {
          /* The certificate file should still exist for the last connection, but it might
           * not *yet* exist (if the last connection failed to initialise before all the
           * other connections exited, which is a race that we've seen in practice).  Wait
           * for it, as above.
           */
          for (int retry = 0;; ++retry)
            {
              g_assert_cmpint (retry, <, 100);

              if (check_for_certfile (tc, NULL))
                break;
              g_usleep (10000);
            }
        }
      else
        {
          /* In the "alternate" case there should be no such strange
           * races.
           */
          g_assert (check_for_certfile (tc, NULL));
        }

      /* closing last connection removes it */
      g_assert_cmpint (gnutls_bye (sessions[n_connections - 1], GNUTLS_SHUT_RDWR), ==, GNUTLS_E_SUCCESS);
      close (fds[n_connections - 1]);
      for (int retry = 0; retry < 100; ++retry)
        {
          if (!check_for_certfile (tc, NULL))
            break;
          g_usleep (10000);
        }
      g_assert (!check_for_certfile (tc, NULL));
      exit (0);
    }

  for (int retry = 0; retry < 200 && waitpid (pid, &status, WNOHANG) <= 0; ++retry)
    server_poll_event (100);
  g_assert_cmpint (status, ==, 0);
}

static void
test_mixed_protocols (TestCase *tc, gconstpointer data)
{
  assert_https (tc, data, 1);
  assert_http (tc);
  assert_https (tc, data, 1);
  assert_http (tc);
}

static void
test_run_idle (TestCase *tc, gconstpointer data)
{
  /* exits after idle without any connections */
  server_run ();

  /* exits after idle after processing an event */
  assert_http (tc);
  server_run ();
}

int
main (int argc, char *argv[])
{
  cockpit_test_init (&argc, &argv);

  g_test_add ("/server/no-tls/single-request", TestCase, NULL,
              setup, test_no_tls_single, teardown);
  g_test_add ("/server/no-tls/many-serial", TestCase, NULL,
              setup, test_no_tls_many_serial, teardown);
  g_test_add ("/server/no-tls/many-parallel", TestCase, NULL,
              setup, test_no_tls_many_parallel, teardown);
  g_test_add ("/server/no-tls/redirect", TestCase, NULL,
              setup, test_no_tls_redirect, teardown);
  g_test_add ("/server/tls/no-client-cert", TestCase, &fixture_separate_crt_key,
              setup, test_tls_no_client_cert, teardown);
  g_test_add ("/server/tls/client-cert", TestCase, &fixture_separate_crt_key_client_cert,
              setup, test_tls_client_cert, teardown);
  g_test_add ("/server/tls/client-cert-disabled", TestCase, &fixture_separate_crt_key,
              setup, test_tls_client_cert_disabled, teardown);
  g_test_add ("/server/tls/client-cert-expired", TestCase, &fixture_expired_client_cert,
              setup, test_tls_client_cert_expired, teardown);
  g_test_add ("/server/tls/client-cert-parallel", TestCase, &fixture_separate_crt_key_client_cert,
              setup, test_tls_client_cert_parallel, teardown);
  g_test_add ("/server/tls/client-cert-parallel/alternate", TestCase, &fixture_alternate_client_cert,
              setup, test_tls_client_cert_parallel, teardown);
  g_test_add ("/server/tls/no-server-cert", TestCase, NULL,
              setup, test_tls_no_server_cert, teardown);
  g_test_add ("/server/tls/redirect", TestCase, &fixture_separate_crt_key,
              setup, test_tls_redirect, teardown);
  g_test_add ("/server/tls/blocked-handshake", TestCase, &fixture_separate_crt_key,
              setup, test_tls_blocked_handshake, teardown);
  g_test_add ("/server/mixed-protocols", TestCase, &fixture_separate_crt_key,
              setup, test_mixed_protocols, teardown);
  g_test_add ("/server/run-idle", TestCase, &fixture_run_idle,
              setup, test_run_idle, teardown);

  return g_test_run ();
}
