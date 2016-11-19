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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

#include "config.h"

#include "cockpitstream.h"

#include "common/cockpitloopback.h"
#include "common/cockpittest.h"
#include "common/mock-io-stream.h"

#include <glib.h>
#include <glib-unix.h>
#include <glib/gstdio.h>
#include <gio/gunixsocketaddress.h>
#include <gio/gunixinputstream.h>
#include <gio/gunixoutputstream.h>

#include <sys/uio.h>
#include <string.h>

/* ----------------------------------------------------------------------------
 * Mock
 */

static GType mock_echo_stream_get_type (void) G_GNUC_CONST;

typedef struct {
  CockpitStream parent;
  GByteArray *received;
  gboolean closed;
  gchar *problem;
} MockEchoStream;

typedef CockpitStreamClass MockEchoStreamClass;

G_DEFINE_TYPE (MockEchoStream, mock_echo_stream, COCKPIT_TYPE_STREAM);

static void
mock_echo_stream_read (CockpitStream *stream,
                       GByteArray *buffer,
                       gboolean end_of_data)
{
  MockEchoStream *self = (MockEchoStream *)stream;
  g_byte_array_append (self->received, buffer->data, buffer->len);
  g_byte_array_set_size (buffer, 0);
}

static void
mock_echo_stream_close (CockpitStream *stream,
                        const gchar *problem)
{
  MockEchoStream *self = (MockEchoStream *)stream;
  g_assert (!self->closed);
  self->closed = TRUE;
  self->problem = g_strdup (problem);
}

static void
mock_echo_stream_init (MockEchoStream *self)
{
  self->received = g_byte_array_new ();
}

static void
mock_echo_stream_finalize (GObject *object)
{
  MockEchoStream *self = (MockEchoStream *)object;

  g_byte_array_free (self->received, TRUE);
  g_free (self->problem);

  G_OBJECT_CLASS (mock_echo_stream_parent_class)->finalize (object);
}

static void
mock_echo_stream_class_init (MockEchoStreamClass *klass)
{
  GObjectClass *object_class = G_OBJECT_CLASS (klass);
  CockpitStreamClass *stream_class = COCKPIT_STREAM_CLASS (klass);

  object_class->finalize = mock_echo_stream_finalize;

  stream_class->read = mock_echo_stream_read;
  stream_class->close = mock_echo_stream_close;
}

/* ----------------------------------------------------------------------------
 * Testing
 */

typedef struct {
  CockpitStream *stream;
  guint timeout;
} TestCase;

typedef struct {
  const gchar *stream_type_name;
  gboolean no_timeout;
} TestFixture;

static gboolean
on_timeout_abort (gpointer unused)
{
  g_error ("timed out");
  return FALSE;
}

static void
setup_timeout (TestCase *tc,
               gconstpointer data)
{
  const TestFixture *fixture = data;
  if (!fixture || !fixture->no_timeout)
    tc->timeout = g_timeout_add_seconds (10, on_timeout_abort, tc);
}

static GIOStream *
mock_io_stream_for_fds (int in_fd,
                        int out_fd)
{
  GInputStream *is;
  GOutputStream *os;
  GIOStream *io;

  g_assert (g_unix_set_fd_nonblocking (in_fd, TRUE, NULL));
  g_assert (g_unix_set_fd_nonblocking (out_fd, TRUE, NULL));

  is = g_unix_input_stream_new (in_fd, TRUE);
  os = g_unix_output_stream_new (out_fd, TRUE);

  io = mock_io_stream_new (is, os);

  g_object_unref (is);
  g_object_unref (os);

  return io;
}

static void
setup_simple (TestCase *tc,
              gconstpointer data)
{
  const TestFixture *fixture = data;
  const gchar *stream_type;
  GIOStream *io;
  int fds[2];

  setup_timeout (tc, data);

  stream_type = "MockEchoStream";
  if (fixture && fixture->stream_type_name)
    stream_type = fixture->stream_type_name;

  if (pipe (fds) < 0)
    g_assert_not_reached ();

  io = mock_io_stream_for_fds (fds[0], fds[1]);

  tc->stream = g_object_new (g_type_from_name (stream_type),
                             "name", "test",
                             "io-stream", io,
                             NULL);

  g_object_unref (io);
}

static void
teardown (TestCase *tc,
          gconstpointer data)
{
  if (tc->stream)
    {
      g_object_add_weak_pointer (G_OBJECT (tc->stream),
                                 (gpointer *)&tc->stream);
      g_object_unref (tc->stream);

      /* If this asserts, outstanding references to transport */
      g_assert (tc->stream == NULL);
    }

  if (tc->timeout)
    g_source_remove (tc->timeout);
}

static void
test_echo_and_close (TestCase *tc,
                     gconstpointer data)
{
  MockEchoStream *echo_stream = (MockEchoStream *)tc->stream;
  GBytes *sent, *bytes;

  sent = g_bytes_new_static ("the message", 11);
  cockpit_stream_write (tc->stream, sent);

  while (echo_stream->received->len < 11)
    g_main_context_iteration (NULL, TRUE);

  g_byte_array_ref (echo_stream->received);
  bytes = g_byte_array_free_to_bytes (echo_stream->received);
  g_assert (g_bytes_equal (bytes, sent));
  g_bytes_unref (sent);
  g_bytes_unref (bytes);

  cockpit_stream_close (tc->stream, NULL);

  while (!echo_stream->closed)
    g_main_context_iteration (NULL, TRUE);
}

static void
test_echo_queue (TestCase *tc,
                 gconstpointer data)
{
  MockEchoStream *echo_stream = (MockEchoStream *)tc->stream;
  GBytes *sent;

  sent = g_bytes_new_static ("one", 3);
  cockpit_stream_write (tc->stream, sent);
  g_bytes_unref (sent);
  sent = g_bytes_new_static ("two", 3);
  cockpit_stream_write (tc->stream, sent);
  g_bytes_unref (sent);

  /* Only closes after above are sent */
  cockpit_stream_close (tc->stream, NULL);

  while (!echo_stream->closed)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpint (echo_stream->received->len, ==, 6);
  g_assert (memcmp (echo_stream->received->data, "onetwo", 6) == 0);
}

static const TestFixture fixture_no_timeout = {
    .no_timeout = TRUE
};

static void
test_echo_large (TestCase *tc,
                 gconstpointer data)
{
  MockEchoStream *echo_stream = (MockEchoStream *)tc->stream;
  GBytes *sent;

  /* Medium length */
  sent = g_bytes_new_take (g_strnfill (1020, '!'), 1020);
  cockpit_stream_write (tc->stream, sent);
  while (echo_stream->received->len < g_bytes_get_size (sent))
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpint (echo_stream->received->len, ==, g_bytes_get_size (sent));
  g_assert (memcmp (echo_stream->received->data, g_bytes_get_data (sent, NULL), g_bytes_get_size (sent)) == 0);
  g_bytes_unref (sent);

  g_byte_array_set_size (echo_stream->received, 0);

  /* Extra large */
  sent = g_bytes_new_take (g_strnfill (10 * 1000 * 1000, '?'), 10 * 1000 * 1000);
  cockpit_stream_write (tc->stream, sent);
  while (echo_stream->received->len < g_bytes_get_size (sent))
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpint (echo_stream->received->len, ==, g_bytes_get_size (sent));
  g_assert (memcmp (echo_stream->received->data, g_bytes_get_data (sent, NULL), g_bytes_get_size (sent)) == 0);
  g_bytes_unref (sent);

  g_byte_array_set_size (echo_stream->received, 0);

  /* Double check that didn't csrew things up */
  sent = g_bytes_new_static ("yello", 5);
  cockpit_stream_write (tc->stream, sent);
  while (echo_stream->received->len < g_bytes_get_size (sent))
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpint (echo_stream->received->len, ==, g_bytes_get_size (sent));
  g_assert (memcmp (echo_stream->received->data, g_bytes_get_data (sent, NULL), g_bytes_get_size (sent)) == 0);
  g_bytes_unref (sent);
}

static void
test_close_problem (TestCase *tc,
                    gconstpointer data)
{
  MockEchoStream *echo_stream = (MockEchoStream *)tc->stream;

  cockpit_stream_close (tc->stream, "right now");

  while (!echo_stream->closed)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpstr (echo_stream->problem, ==, "right now");
}

static const TestFixture fixture_buffer = {
    .stream_type_name = "CockpitStream"
};

static void
test_buffer (TestCase *tc,
             gconstpointer data)
{
  GByteArray *buffer;
  GBytes *sent;

  buffer = cockpit_stream_get_buffer (tc->stream);
  g_assert (buffer != NULL);
  g_assert_cmpuint (buffer->len, ==, 0);

  /* Including null terminator */
  sent = g_bytes_new_static ("blahdeedoo", 11);
  cockpit_stream_write (tc->stream, sent);
  g_bytes_unref (sent);

  while (buffer->len == 0)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpint (buffer->len, ==, 11);
  g_assert_cmpstr ((gchar *)buffer->data, ==, "blahdeedoo");
}

static void
test_skip_zero (TestCase *tc,
                gconstpointer data)
{
  MockEchoStream *echo_stream = (MockEchoStream *)tc->stream;
  GBytes *sent;
  GBytes *zero;

  /* Including null terminator */
  sent = g_bytes_new_static ("blah", 4);
  zero = g_bytes_new_static ("", 0);
  cockpit_stream_write (tc->stream, sent);
  cockpit_stream_write (tc->stream, zero);
  cockpit_stream_write (tc->stream, sent);
  g_bytes_unref (zero);
  g_bytes_unref (sent);

  while (echo_stream->received->len < 8)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpint (echo_stream->received->len, ==, 8);
  g_byte_array_append (echo_stream->received, (guint8 *)"", 1);
  g_assert_cmpstr ((gchar *)echo_stream->received->data, ==, "blahblah");
}

static void
test_read_error (void)
{
  MockEchoStream *echo_stream;
  GIOStream *io;
  int fds[2];
  int out;

  /* Just used so we have a valid fd */
  if (pipe (fds) < 0)
    g_assert_not_reached ();

  out = dup (2);
  g_assert (out >= 0);

  cockpit_expect_message ("*Bad file descriptor");

  /* Using wrong end of the pipe */
  io = mock_io_stream_for_fds (fds[1], out);

  echo_stream = g_object_new (mock_echo_stream_get_type (),
                            "name", "read-error",
                            "io-stream", io,
                            NULL);

  /* Close the file descriptor to cause error */
  close (fds[1]);

  g_object_unref (io);

  while (!echo_stream->closed)
    g_main_context_iteration (NULL, TRUE);

  cockpit_assert_expected ();

  g_assert_cmpstr (echo_stream->problem, ==, "internal-error");

  close (fds[0]);

  g_object_unref (echo_stream);

  cockpit_assert_expected ();
}

static void
test_write_error (void)
{
  MockEchoStream *echo_stream;
  GIOStream *io;
  GBytes *sent;
  int fds[2];

  /* Just used so we have a valid fd */
  if (pipe (fds) < 0)
    g_assert_not_reached ();

  cockpit_expect_message ("*Bad file descriptor");

  io = mock_io_stream_for_fds (fds[0], fds[1]);

  /* Pass in a bad write descriptor */
  echo_stream = g_object_new (mock_echo_stream_get_type (),
                              "name", "write-error",
                              "io-stream", io,
                              NULL);

  /* Close the file descriptor to cause error */
  close (fds[1]);

  g_object_unref (io);

  sent = g_bytes_new ("test", 4);
  cockpit_stream_write (COCKPIT_STREAM (echo_stream), sent);
  g_bytes_unref (sent);

  while (!echo_stream->closed)
    g_main_context_iteration (NULL, TRUE);

  cockpit_assert_expected ();

  g_assert_cmpstr (echo_stream->problem, ==, "internal-error");

  g_object_unref (echo_stream);

  cockpit_assert_expected ();
}

static void
test_read_combined (void)
{
  MockEchoStream *echo_stream;
  struct iovec iov[4];
  GIOStream *io;
  gint fds_a[2];
  gint fds_b[2];
  gint ret;

  if (pipe(fds_a) < 0)
    g_assert_not_reached ();
  if (pipe(fds_b) < 0)
    g_assert_not_reached ();

  io = mock_io_stream_for_fds (fds_a[0], fds_b[1]);

  /* Pass in a read end of the pipe */
  echo_stream = g_object_new (mock_echo_stream_get_type (),
                              "name", "read-combined",
                              "io-stream", io,
                              NULL);

  g_object_unref (io);

  /* Write two messages to the stream at once */
  iov[0].iov_base = "one";
  iov[0].iov_len = 3;
  iov[1].iov_base = "two";
  iov[1].iov_len = 3;
  iov[2].iov_base = "three";
  iov[2].iov_len = 5;
  iov[3].iov_base = "\0";
  iov[3].iov_len = 1;
  do
    {
      ret = writev (fds_a[1], iov, 4);
      if (ret < 0 && (errno == EAGAIN || errno == EINTR))
        continue;
      if (ret < 0)
        g_message ("writev failed with %d: %s", ret, g_strerror (errno));
      g_assert_cmpint (ret, ==, 12);
      break;
    }
  while (TRUE);

  while (echo_stream->received->len < 12)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpint (echo_stream->received->len, ==, 12);
  g_assert_cmpstr ((gchar *)echo_stream->received->data, ==, "onetwothree");

  g_object_add_weak_pointer (G_OBJECT (echo_stream),
                             (gpointer *)&echo_stream);
  g_object_unref (echo_stream);
  g_assert (echo_stream == NULL);

  close (fds_a[1]);
  close (fds_b[0]);
}

static void
test_properties (void)
{
  CockpitStream *tstream;
  GIOStream *io;
  gchar *name;
  GIOStream *x;
  int fds[2];

  if (pipe(fds) < 0)
    g_assert_not_reached ();

  io = mock_io_stream_for_fds (fds[0], fds[1]);

  tstream = g_object_new (mock_echo_stream_get_type (),
                          "name", "testo",
                          "io-stream", io,
                          NULL);

  g_object_get (tstream, "name", &name, "io-stream", &x, NULL);
  g_assert_cmpstr (name, ==, "testo");
  g_free (name);
  g_assert (io == x);

  g_object_unref (x);
  g_object_unref (io);

  g_object_unref (tstream);
}

static void
on_close_get_problem (CockpitStream *stream,
                      const gchar *problem,
                      gpointer user_data)
{
  gchar **retval = user_data;
  g_assert (retval != NULL && *retval == NULL);
  *retval = g_strdup (problem ? problem : "");
}

typedef struct {
  GSocket *listen_sock;
  GSource *listen_source;
  GSocket *conn_sock;
  GSource *conn_source;
  GSocketAddress *address;
  gboolean skip_ipv6_loopback;
  guint16 port;
} TestConnect;

static gboolean
on_socket_input (GSocket *socket,
                 GIOCondition cond,
                 gpointer user_data)
{
  gchar buffer[1024];
  GError *error = NULL;
  gssize ret, wret;

  ret = g_socket_receive (socket, buffer, sizeof (buffer), NULL, &error);
  g_assert_no_error (error);

  if (ret == 0)
    {
      g_socket_shutdown (socket, FALSE, TRUE, &error);
      g_assert_no_error (error);
      return FALSE;
    }

  g_assert (ret > 0);
  wret = g_socket_send (socket, buffer, ret, NULL, &error);
  g_assert_no_error (error);
  g_assert (wret == ret);
  return TRUE;
}

static gboolean
on_socket_connection (GSocket *socket,
                      GIOCondition cond,
                      gpointer user_data)
{
  TestConnect *tc = user_data;
  GError *error = NULL;

  g_assert (tc->conn_source == NULL);
  tc->conn_sock = g_socket_accept (tc->listen_sock, NULL, &error);
  g_assert_no_error (error);

  tc->conn_source = g_socket_create_source (tc->conn_sock, G_IO_IN, NULL);
  g_source_set_callback (tc->conn_source, (GSourceFunc)on_socket_input, tc, NULL);
  g_source_attach (tc->conn_source, NULL);

  /* Only one connection */
  return FALSE;
}

static void
setup_connect (TestConnect *tc,
               gconstpointer data)
{
  GError *error = NULL;
  GInetAddress *inet;
  GSocketAddress *address;
  GSocketFamily family = GPOINTER_TO_INT (data);

  if (family == G_SOCKET_FAMILY_INVALID)
    family = G_SOCKET_FAMILY_IPV4;

  inet = g_inet_address_new_loopback (family);
  address = g_inet_socket_address_new (inet, 0);
  g_object_unref (inet);

  tc->listen_sock = g_socket_new (family, G_SOCKET_TYPE_STREAM,
                                  G_SOCKET_PROTOCOL_DEFAULT, &error);
  g_assert_no_error (error);

  g_socket_bind (tc->listen_sock, address, TRUE, &error);
  g_object_unref (address);

  if (error != NULL && family == G_SOCKET_FAMILY_IPV6)
    {
      /* Some test runners don't have IPv6 loopback, strangely enough */
      g_clear_error (&error);
      tc->skip_ipv6_loopback = TRUE;
      return;
    }

  g_assert_no_error (error);

  tc->address = g_socket_get_local_address (tc->listen_sock, &error);
  g_assert_no_error (error);

  tc->port = g_inet_socket_address_get_port (G_INET_SOCKET_ADDRESS (tc->address));

  g_socket_listen (tc->listen_sock, &error);
  g_assert_no_error (error);

  tc->listen_source = g_socket_create_source (tc->listen_sock, G_IO_IN, NULL);
  g_source_set_callback (tc->listen_source, (GSourceFunc)on_socket_connection, tc, NULL);
  g_source_attach (tc->listen_source, NULL);
}

static void
teardown_connect (TestConnect *tc,
                  gconstpointer data)
{
  if (tc->address)
    g_object_unref (tc->address);
  if (tc->conn_source)
    {
      g_source_destroy (tc->conn_source);
      g_source_unref (tc->conn_source);
    }
  if (tc->listen_source)
    {
      g_source_destroy (tc->listen_source);
      g_source_unref (tc->listen_source);
    }
  g_clear_object (&tc->listen_sock);
  g_clear_object (&tc->conn_sock);
}

static void
test_connect_and_read (TestConnect *tc,
                       gconstpointer user_data)
{
  CockpitConnectable connectable = { .address = G_SOCKET_CONNECTABLE (tc->address) };
  CockpitStream *stream;
  GError *error = NULL;
  GByteArray *buffer;

  stream = cockpit_stream_connect ("connect-and-read", &connectable);
  g_assert (stream != NULL);

  while (tc->conn_sock == NULL)
    g_main_context_iteration (NULL, TRUE);

  /* Send the null terminator */
  g_assert_cmpint (g_socket_send (tc->conn_sock, "eier", 5, NULL, &error), ==, 5);
  g_assert_no_error (error);

  buffer = cockpit_stream_get_buffer (stream);
  while (buffer->len == 0)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpuint (buffer->len, ==, 5);
  g_assert_cmpstr ((gchar *)buffer->data, ==, "eier");

  g_object_unref (stream);
}

static void
test_connect_early_close (TestConnect *tc,
                          gconstpointer user_data)
{
  CockpitConnectable connectable = { .address = G_SOCKET_CONNECTABLE (tc->address) };
  CockpitStream *stream;

  stream = cockpit_stream_connect ("connect-early-close", &connectable);
  g_assert (stream != NULL);

  cockpit_stream_close (stream, NULL);
  g_object_unref (stream);

  while (tc->conn_sock == NULL)
    g_main_context_iteration (NULL, TRUE);
}

static void
test_connect_loopback (TestConnect *tc,
                       gconstpointer user_data)
{
  CockpitConnectable connectable = { 0 };
  CockpitStream *stream;
  GError *error = NULL;
  GByteArray *buffer;


  if (tc->skip_ipv6_loopback)
    {
      cockpit_test_skip ("no loopback for ipv6 found");
      return;
    }

  connectable.address = cockpit_loopback_new (tc->port);
  stream = cockpit_stream_connect ("loopback", &connectable);
  g_object_unref (connectable.address);
  g_assert (stream != NULL);

  while (tc->conn_sock == NULL)
    g_main_context_iteration (NULL, TRUE);

  /* Send the null terminator */
  g_assert_cmpint (g_socket_send (tc->conn_sock, "eier", 5, NULL, &error), ==, 5);
  g_assert_no_error (error);

  buffer = cockpit_stream_get_buffer (stream);
  while (buffer->len == 0)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpuint (buffer->len, ==, 5);
  g_assert_cmpstr ((gchar *)buffer->data, ==, "eier");

  g_object_unref (stream);
}

static void
test_connect_and_write (TestConnect *tc,
                        gconstpointer user_data)
{
  CockpitConnectable connectable = { .address = G_SOCKET_CONNECTABLE (tc->address) };
  gchar buffer[8];
  CockpitStream *stream;
  GError *error = NULL;
  GBytes *sent;
  gssize ret;

  stream = cockpit_stream_connect ("connect-and-write", &connectable);
  g_assert (stream != NULL);

  /* Sending on the stream before actually connected */
  sent = g_bytes_new_static ("J", 1);
  cockpit_stream_write (stream, sent);
  g_bytes_unref (sent);
  g_assert (tc->conn_sock == NULL);

  /* Now we connect in main loop */
  while (tc->conn_sock == NULL)
    g_main_context_iteration (NULL, TRUE);

  /* Read from the socket */
  for (;;)
    {
      ret = g_socket_receive_with_blocking (tc->conn_sock, buffer, sizeof (buffer), FALSE, NULL, &error);
      if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_WOULD_BLOCK))
        {
          g_assert_cmpint (ret, ==, -1);
          g_main_context_iteration (NULL, TRUE);
          g_clear_error (&error);
          continue;
        }
      g_assert_no_error (error);
      g_assert_cmpint (ret, ==, 1);
      break;
    }

  g_assert_cmpint (buffer[0], ==, 'J');
  g_object_unref (stream);
}

static void
test_fail_not_found (void)
{
  CockpitConnectable connectable = { 0 };
  CockpitStream *stream;
  GSocketAddress *address;
  gchar *problem = NULL;

  cockpit_expect_message ("*No such file or directory");

  address = g_unix_socket_address_new ("/non-existent");
  connectable.address = G_SOCKET_CONNECTABLE (address);
  stream = cockpit_stream_connect ("bad", &connectable);
  g_object_unref (connectable.address);

  /* Should not have closed at this point */
  g_assert (stream != NULL);
  g_signal_connect (stream, "close", G_CALLBACK (on_close_get_problem), &problem);

  /* closes in main loop */
  while (problem == NULL)
    g_main_context_iteration (NULL, TRUE);

  cockpit_assert_expected ();

  g_assert_cmpstr (problem, ==, "not-found");
  g_free (problem);
  g_object_unref (stream);
}

static void
test_fail_access_denied (void)
{
  CockpitConnectable connectable = { 0 };
  CockpitStream *stream;
  GSocketAddress *address;
  gchar *unix_path;
  gchar *problem = NULL;
  gint fd;

  if (geteuid () == 0)
    {
      cockpit_test_skip ("running as root");
      return;
    }

  unix_path = g_strdup ("/tmp/cockpit-test-XXXXXX.sock");
  fd = g_mkstemp (unix_path);
  g_assert_cmpint (fd, >=, 0);

  /* Take away all permissions from the file */
  g_assert_cmpint (fchmod (fd, 0000), ==, 0);

  cockpit_expect_message ("*Permission denied");

  address = g_unix_socket_address_new (unix_path);
  connectable.address = G_SOCKET_CONNECTABLE (address);
  stream = cockpit_stream_connect ("bad", &connectable);
  g_object_unref (address);

  /* Should not have closed at this point */
  g_assert (stream != NULL);
  g_signal_connect (stream, "close", G_CALLBACK (on_close_get_problem), &problem);

  /* closes in main loop */
  while (problem == NULL)
    g_main_context_iteration (NULL, TRUE);

  cockpit_assert_expected ();

  g_assert_cmpstr (problem, ==, "access-denied");
  g_free (unix_path);
  g_free (problem);
  g_object_unref (stream);
}

static void
test_problem_later (void)
{
  gchar *problem = NULL;
  gchar *check;
  CockpitStream *stream;

  stream = g_object_new (COCKPIT_TYPE_STREAM,
                         "problem", "i-have-a-problem",
                         NULL);
  g_signal_connect (stream, "close", G_CALLBACK (on_close_get_problem), &problem);

  g_object_get (stream, "problem", &check, NULL);
  g_assert_cmpstr (check, ==, "i-have-a-problem");
  g_free (check);
  check = NULL;

  g_assert (problem == NULL);
  while (problem == NULL)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpstr (problem, ==, "i-have-a-problem");
  g_object_get (stream, "problem", &check, NULL);
  g_assert_cmpstr (problem, ==, check);

  g_object_unref (stream);
  g_free (problem);
  g_free (check);
}

int
main (int argc,
      char *argv[])
{
  cockpit_test_init (&argc, &argv);

  g_test_add_func ("/stream/properties", test_properties);

  /*
   * Fixture data is the GType name of the stream class
   * so register these types here.
   */
  g_type_class_ref (mock_echo_stream_get_type ());
  g_type_class_ref (cockpit_stream_get_type ());

  g_test_add ("/stream/echo-message", TestCase, NULL,
              setup_simple, test_echo_and_close, teardown);
  g_test_add ("/stream/echo-queue", TestCase, NULL,
              setup_simple, test_echo_queue, teardown);
  g_test_add ("/stream/echo-large", TestCase, &fixture_no_timeout,
              setup_simple, test_echo_large, teardown);
  g_test_add ("/stream/close-problem", TestCase, NULL,
              setup_simple, test_close_problem, teardown);
  g_test_add ("/stream/buffer", TestCase, &fixture_buffer,
              setup_simple, test_buffer, teardown);
  g_test_add ("/stream/skip-zero", TestCase, NULL,
              setup_simple, test_skip_zero, teardown);

  g_test_add_func ("/stream/read-error", test_read_error);
  g_test_add_func ("/stream/write-error", test_write_error);
  g_test_add_func ("/stream/read-combined", test_read_combined);

  g_test_add ("/stream/connect/and-read", TestConnect, NULL,
              setup_connect, test_connect_and_read, teardown_connect);
  g_test_add ("/stream/connect/early-close", TestConnect, NULL,
              setup_connect, test_connect_early_close, teardown_connect);
  g_test_add ("/stream/connect/and-write", TestConnect, NULL,
              setup_connect, test_connect_and_write, teardown_connect);
  g_test_add ("/stream/connect/loopback-ipv4", TestConnect, GINT_TO_POINTER (G_SOCKET_FAMILY_IPV4),
              setup_connect, test_connect_loopback, teardown_connect);
  g_test_add ("/stream/connect/loopback-ipv6", TestConnect, GINT_TO_POINTER (G_SOCKET_FAMILY_IPV6),
              setup_connect, test_connect_loopback, teardown_connect);

  g_test_add_func ("/stream/problem-later", test_problem_later);

  g_test_add_func ("/stream/connect/not-found", test_fail_not_found);
  g_test_add_func ("/stream/connect/access-denied", test_fail_access_denied);

  return g_test_run ();
}
