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
#include <fcntl.h>
#include <sys/socket.h>

#include "connection.h"
#include "common/cockpittest.h"

/* create a valid throwaway fd */
static int get_fd (void)
{
  int fd = open ("/dev/zero", O_RDWR);
  g_assert_cmpint (fd, >, 0);
  return fd;
}

static void
test_no_ws (void)
{
  int fd = get_fd ();
  Connection *c;

  c = connection_new (fd);
  g_assert (c);
  g_assert_cmpint (c->client_fd, ==, fd);
  /* back references from buffer to connection */
  g_assert (c->buf_client.connection == c);
  g_assert (c->buf_ws.connection == c);

  /* other fields are clear */
  g_assert (!c->is_tls);
  g_assert (c->ws == NULL);
  g_assert_cmpint (c->ws_fd, ==, 0);

  connection_free (c);
  /* closes fd */
  g_assert_cmpint (fcntl (fd, F_GETFD), ==, -1);
  g_assert_cmpint (errno, ==, EBADF);
}

static void
test_with_ws (void)
{
  int client_fd, ws_fd;
  Connection *c;

  client_fd = get_fd ();
  ws_fd = get_fd ();

  c = connection_new (client_fd);
  g_assert (c);
  c->ws_fd = ws_fd;

  connection_free (c);
  /* closes both fds */
  g_assert_cmpint (fcntl (client_fd, F_GETFD), ==, -1);
  g_assert_cmpint (errno, ==, EBADF);
  g_assert_cmpint (fcntl (ws_fd, F_GETFD), ==, -1);
  g_assert_cmpint (errno, ==, EBADF);
}

static void
test_tls_session (void)
{
  Connection *c;
  gnutls_session_t session;

  c = connection_new (-1);
  g_assert (c);
  g_assert (!c->is_tls);

  g_assert_cmpint (gnutls_init (&session, GNUTLS_SERVER), ==, GNUTLS_E_SUCCESS);

  connection_set_tls_session (c, session);
  g_assert (c->is_tls);

  /* releases the session; valgrind will complain otherwise */
  connection_free (c);
}

static void
test_read_write (void)
{
  int client_fds[2];
  int ws_fds[2];
  char buffer[10];
  const char *msg = "hello";
  const size_t msglen = strlen (msg);
  Connection *c;

  g_assert_cmpint (socketpair (AF_UNIX, SOCK_STREAM, 0, client_fds), ==, 0);
  g_assert_cmpint (socketpair (AF_UNIX, SOCK_STREAM, 0, ws_fds), ==, 0);
  c = connection_new (client_fds[0]);
  g_assert (c);
  c->ws_fd = ws_fds[0];

  /* client → ws */
  g_assert_cmpint (connection_read (c, CLIENT), ==, RETRY);
  g_assert_cmpint (c->buf_client.length, ==, 0);
  g_assert_cmpint (send (client_fds[1], msg, msglen, 0), ==, msglen);
  g_assert_cmpint (connection_read (c, CLIENT), ==, SUCCESS);
  g_assert_cmpint (c->buf_client.length, ==, msglen);
  g_assert_cmpint (c->buf_ws.length, ==, 0);

  g_assert_cmpint (connection_write (c, CLIENT), ==, SUCCESS);
  g_assert_cmpint (c->buf_client.length, ==, 0);
  g_assert_cmpint (c->buf_client.offset, ==, 0);

  g_assert_cmpint (recv (ws_fds[1], buffer, sizeof (buffer), 0), ==, msglen);
  buffer[msglen] = '\0';
  g_assert_cmpstr (buffer, ==, msg);

  g_assert_cmpint (connection_read (c, CLIENT), ==, RETRY);

  /* ws → client */
  g_assert_cmpint (connection_read (c, WS), ==, RETRY);

  g_assert_cmpint (send (ws_fds[1], msg, msglen, 0), ==, msglen);
  g_assert_cmpint (connection_read (c, WS), ==, SUCCESS);
  g_assert_cmpint (c->buf_ws.length, ==, msglen);
  g_assert_cmpint (c->buf_client.length, ==, 0);

  g_assert_cmpint (connection_write (c, WS), ==, SUCCESS);
  g_assert_cmpint (c->buf_ws.length, ==, 0);

  bzero (buffer, sizeof (buffer));
  g_assert_cmpint (recv (client_fds[1], buffer, sizeof (buffer), 0), ==, msglen);
  buffer[msglen] = '\0';
  g_assert_cmpstr (buffer, ==, msg);

  g_assert_cmpint (connection_read (c, WS), ==, RETRY);

  /* EOF detection */
  close (client_fds[1]);
  g_assert_cmpint (connection_read (c, CLIENT), ==, CLOSED);
  close (ws_fds[1]);
  g_assert_cmpint (connection_read (c, WS), ==, CLOSED);

  connection_free (c);
}

int
main (int argc,
      char *argv[])
{
  cockpit_test_init (&argc, &argv);

  g_test_add_func ("/connection/no-ws", test_no_ws);
  g_test_add_func ("/connection/with-ws", test_with_ws);
  g_test_add_func ("/connection/tls-session", test_tls_session);
  g_test_add_func ("/connection/read-write", test_read_write);

  return g_test_run ();
}
