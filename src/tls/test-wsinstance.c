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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

#include "config.h"

#include <errno.h>
#include <signal.h>
#include <stdlib.h>
#include <sys/socket.h>

#include <glib.h>
#include <glib/gstdio.h>
#include <gnutls/x509.h>

#include "wsinstance.h"
#include "common/cockpittest.h"

#define COCKPIT_WS BUILDDIR "/cockpit-ws"

#define WS_SUCCESS "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n*"
#define WS_FORBIDDEN "HTTP/1.1 403 Forbidden\r\nConnection: close\r\n*"

typedef struct {
  gchar *state_dir;
  WsInstance *ws;
} TestCase;

typedef struct {
  enum WsInstanceMode mode;
  const char *cert_pem;
} TestFixture;

static void
setup (TestCase *tc, gconstpointer data)
{
  const TestFixture *fixture = data;
  gnutls_datum_t peer_der;

  tc->state_dir = g_dir_make_tmp ("wsinstance.state.XXXXXX", NULL);
  g_assert (tc->state_dir);

  if (fixture->cert_pem)
   {
     gnutls_datum_t peer_pem;
     gnutls_x509_crt_t peer_cert;
     gsize cert_pem_length;

     g_assert (g_file_get_contents (fixture->cert_pem, (gchar**) &peer_pem.data, &cert_pem_length, NULL));
     peer_pem.size = cert_pem_length;
     g_assert (gnutls_x509_crt_init (&peer_cert) >= 0);
     g_assert (gnutls_x509_crt_import (peer_cert, &peer_pem, GNUTLS_X509_FMT_PEM) >= 0);
     g_assert (gnutls_x509_crt_export2 (peer_cert, GNUTLS_X509_FMT_DER, &peer_der) >= 0);
     gnutls_x509_crt_deinit (peer_cert);
     gnutls_free (peer_pem.data);
   }

  tc->ws = ws_instance_new (COCKPIT_WS, fixture->mode, fixture->cert_pem ? &peer_der : NULL, tc->state_dir);

  if (fixture->cert_pem)
   gnutls_free (peer_der.data);

  /* process is running */
  g_assert_cmpint (kill (tc->ws->pid, 0), ==, 0);
  /* socket exists */
  g_assert (g_file_test (tc->ws->socket.sun_path, G_FILE_TEST_EXISTS));
  g_assert (g_str_has_prefix (tc->ws->socket.sun_path, tc->state_dir));
}

static void
teardown (TestCase *tc, gconstpointer data)
{
  pid_t ws_pid = tc->ws->pid;
  g_autofree char *socket_path = g_strdup (tc->ws->socket.sun_path);

  ws_instance_free (tc->ws);
  /* process is not running any more */
  g_assert_cmpint (kill (ws_pid, 0), ==, -1);
  g_assert_cmpint (errno, ==, ESRCH);
  /* socket got cleaned up */
  g_assert (!g_file_test (socket_path, G_FILE_TEST_EXISTS));

  g_assert_cmpint (g_rmdir (tc->state_dir), ==, 0);
  g_free (tc->state_dir);
}

static int
connect_to_ws (TestCase *tc)
{
  int fd = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
  g_assert (fd > 0);
  g_assert (connect (fd, (const struct sockaddr*) &tc->ws->socket, sizeof (tc->ws->socket)) == 0);
  return fd;
}

static const char*
do_request (TestCase *tc, const char *request)
{
  int fd = connect_to_ws (tc);
  static char buf[4096];
  ssize_t len;

  g_assert_cmpint (write (fd, request, strlen (request)), ==, strlen (request));
  len = read (fd, buf, sizeof (buf) - 1);
  close (fd);
  g_assert_cmpint (len, >=, 100);
  buf[len] = '\0';

  return buf;
}

static void
assert_http (TestCase *tc)
{
  const char *res = do_request (tc, "GET / HTTP/1.0\r\nHost: localhost\r\n\r\n");
  /* This succeeds (200 OK) when building in-tree, but fails with dist-check due to missing doc root */
  if (strstr (res, "200 OK"))
    cockpit_assert_strmatch (res, "HTTP/1.1 200 OK\r\n*");
  else
    cockpit_assert_strmatch (res, "HTTP/1.1 404 Not Found\r\n*");
}

static void
assert_websocket (TestCase *tc, const char *origin, const char *expected)
{
  const char request[] = "GET /socket HTTP/1.0\r\n"
                         "Host: localhost:9090\r\n"
                         "Connection: Upgrade\r\n"
                         "Upgrade: websocket\r\n"
                         "Sec-Websocket-Key: 3sc2c9IzwRUc3BlSIYwtSA==\r\n"
                         "Sec-Websocket-Version: 13\r\n"
                         "Origin: ";
  char buf[4096] = "\0";
  int fd = connect_to_ws (tc);

  g_assert_cmpint (write (fd, request, sizeof (request) - 1), ==, sizeof (request) - 1);
  g_assert_cmpint (write (fd, origin, strlen (origin)), ==, strlen (origin));
  g_assert_cmpint (write (fd, "\r\n\r\n", 4), ==, 4);
  g_assert_cmpint (read (fd, buf, sizeof (buf)), >=, 50);
  close (fd);
  cockpit_assert_strmatch (buf, expected);
}

static const TestFixture fixture_http = {
  .mode = WS_INSTANCE_HTTP,
};

static void
test_http (TestCase *tc, gconstpointer data)
{
  const char *res;

  gnutls_datum_t crt = { .size = 0 };

  g_assert_cmpuint (tc->ws->peer_cert.size, ==, 0);
  g_assert_cmpuint (tc->ws->peer_cert_info.size, ==, 0);
  assert_http (tc);
  assert_websocket (tc, "http://localhost:9090", WS_SUCCESS);
  assert_websocket (tc, "https://localhost:9090", WS_FORBIDDEN);

  g_assert (ws_instance_has_peer_cert (tc->ws, NULL));
  g_assert (ws_instance_has_peer_cert (tc->ws, &crt));
  crt.size = 1;
  g_assert (!ws_instance_has_peer_cert (tc->ws, &crt));

  /* non-localhost does not redirect */
  res = do_request (tc, "GET / HTTP/1.0\r\nHost: some.remote:1234\r\n\r\n");
  /* This succeeds (200 OK) when building in-tree, but fails with dist-check due to missing doc root */
  if (strstr (res, "200 OK"))
    cockpit_assert_strmatch (res, "HTTP/1.1 200 OK\r\n*");
  else
    cockpit_assert_strmatch (res, "HTTP/1.1 404 Not Found\r\n*");
}

static const TestFixture fixture_http_redirect = {
  .mode = WS_INSTANCE_HTTP_REDIRECT,
};

static void
test_http_redirect (TestCase *tc, gconstpointer data)
{
  /* localhost does not redirect */
  assert_http (tc);
  /* non-localhost redirects */
  cockpit_assert_strmatch (do_request (tc, "GET / HTTP/1.0\r\nHost: some.remote:1234\r\n\r\n"),
                           "HTTP/1.1 301 Moved Permanently*");
}

static const TestFixture fixture_https_nocert = {
  .mode = WS_INSTANCE_HTTPS,
};

static void
test_https_nocert (TestCase *tc, gconstpointer data)
{
  g_assert_cmpuint (tc->ws->peer_cert.size, ==, 0);
  g_assert_cmpuint (tc->ws->peer_cert_info.size, ==, 0);
  assert_http (tc);
  assert_websocket (tc, "https://localhost:9090", WS_SUCCESS);
  assert_websocket (tc, "http://localhost:9090", WS_FORBIDDEN);
}

static const TestFixture fixture_https_cert = {
  .mode = WS_INSTANCE_HTTPS,
  .cert_pem = SRCDIR "/src/bridge/mock-server.crt",
};

static void
test_https_cert (TestCase *tc, gconstpointer data)
{
  gnutls_datum_t crt = { .size = 0 };

  g_assert_cmpuint (tc->ws->peer_cert.size, >, 0);
  g_assert (tc->ws->peer_cert.data != NULL);
  cockpit_assert_strmatch ((const char*) tc->ws->peer_cert_info.data, "subject `CN=localhost', issuer `CN=localhost', *");
  assert_http (tc);
  assert_websocket (tc, "https://localhost:9090", WS_SUCCESS);
  assert_websocket (tc, "http://localhost:9090", WS_FORBIDDEN);

  g_assert (!ws_instance_has_peer_cert (tc->ws, NULL));
  g_assert (!ws_instance_has_peer_cert (tc->ws, &crt));
  g_assert (ws_instance_has_peer_cert (tc->ws, &tc->ws->peer_cert));

  /* certificate copy should match */
  crt.size = tc->ws->peer_cert.size;
  crt.data = malloc (tc->ws->peer_cert.size);
  g_assert (crt.data);
  memcpy (crt.data, tc->ws->peer_cert.data, crt.size);
  g_assert (ws_instance_has_peer_cert (tc->ws, &crt));
  /* modified crt should not match */
  crt.data[0]++;
  g_assert (!ws_instance_has_peer_cert (tc->ws, &crt));

  gnutls_free (crt.data);
}

int
main (int argc, char *argv[])
{
  cockpit_test_init (&argc, &argv);

  g_test_add ("/ws-instance/http", TestCase, &fixture_http,
              setup, test_http, teardown);
  g_test_add ("/ws-instance/http-redirect", TestCase, &fixture_http_redirect,
              setup, test_http_redirect, teardown);
  g_test_add ("/ws-instance/tls-nocert", TestCase, &fixture_https_nocert,
              setup, test_https_nocert, teardown);
  g_test_add ("/ws-instance/tls-cert", TestCase, &fixture_https_cert,
              setup, test_https_cert, teardown);

  return g_test_run ();
}
