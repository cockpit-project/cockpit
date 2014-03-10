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

#include "cockpitpipe.h"

#include <glib.h>

#include <sys/uio.h>
#include <string.h>

/* ----------------------------------------------------------------------------
 * Mock
 */

static GType mock_echo_pipe_get_type (void) G_GNUC_CONST;

typedef struct {
  CockpitPipe parent;
  GByteArray *received;
  gboolean closed;
  gchar *problem;
} MockEchoPipe;

typedef CockpitPipeClass MockEchoPipeClass;

G_DEFINE_TYPE (MockEchoPipe, mock_echo_pipe, COCKPIT_TYPE_PIPE);

static void
mock_echo_pipe_read (CockpitPipe *pipe,
                     GByteArray *buffer,
                     gboolean end_of_data)
{
  MockEchoPipe *self = (MockEchoPipe *)pipe;
  g_byte_array_append (self->received, buffer->data, buffer->len);
  g_byte_array_set_size (buffer, 0);
}

static void
mock_echo_pipe_closed (CockpitPipe *pipe,
                       const gchar *problem)
{
  MockEchoPipe *self = (MockEchoPipe *)pipe;
  g_assert (!self->closed);
  self->closed = TRUE;
  self->problem = g_strdup (problem);
}

static void
mock_echo_pipe_init (MockEchoPipe *self)
{
  self->received = g_byte_array_new ();
}

static void
mock_echo_pipe_finalize (GObject *object)
{
  MockEchoPipe *self = (MockEchoPipe *)object;

  g_byte_array_free (self->received, TRUE);
  g_free (self->problem);

  G_OBJECT_CLASS (mock_echo_pipe_parent_class)->finalize (object);
}
static void
mock_echo_pipe_class_init (MockEchoPipeClass *klass)
{
  GObjectClass *object_class = G_OBJECT_CLASS (klass);
  CockpitPipeClass *pipe_class = COCKPIT_PIPE_CLASS (klass);

  object_class->finalize = mock_echo_pipe_finalize;

  pipe_class->read = mock_echo_pipe_read;
  pipe_class->closed = mock_echo_pipe_closed;
}

/* ----------------------------------------------------------------------------
 * Testing
 */

typedef struct {
  CockpitPipe *pipe;
} TestCase;

static void
setup_echo (TestCase *tc,
            gconstpointer data)
{
  int fds[2];

  if (pipe (fds) < 0)
    g_assert_not_reached ();

  tc->pipe = g_object_new (mock_echo_pipe_get_type (),
                           "name", "test",
                           "in-fd", fds[0],
                           "out-fd", fds[1],
                           NULL);
}

static void
teardown (TestCase *tc,
          gconstpointer data)
{
  g_object_add_weak_pointer (G_OBJECT (tc->pipe),
                             (gpointer *)&tc->pipe);
  g_object_unref (tc->pipe);

  /* If this asserts, outstanding references to transport */
  g_assert (tc->pipe == NULL);
}

static void
test_echo_and_close (TestCase *tc,
                     gconstpointer data)
{
  MockEchoPipe *echo_pipe = (MockEchoPipe *)tc->pipe;
  GBytes *sent, *bytes;

  sent = g_bytes_new_static ("the message", 11);
  cockpit_pipe_write (tc->pipe, sent);

  while (echo_pipe->received->len < 11)
    g_main_context_iteration (NULL, TRUE);

  g_byte_array_ref (echo_pipe->received);
  bytes = g_byte_array_free_to_bytes (echo_pipe->received);
  g_assert (g_bytes_equal (bytes, sent));
  g_bytes_unref (sent);
  g_bytes_unref (bytes);

  cockpit_pipe_close (tc->pipe, NULL);

  while (!echo_pipe->closed)
    g_main_context_iteration (NULL, TRUE);
}

static void
test_echo_queue (TestCase *tc,
                 gconstpointer data)
{
  MockEchoPipe *echo_pipe = (MockEchoPipe *)tc->pipe;
  GBytes *sent;

  sent = g_bytes_new_static ("one", 3);
  cockpit_pipe_write (tc->pipe, sent);
  g_bytes_unref (sent);
  sent = g_bytes_new_static ("two", 3);
  cockpit_pipe_write (tc->pipe, sent);
  g_bytes_unref (sent);

  /* Only closes after above are sent */
  cockpit_pipe_close (tc->pipe, NULL);

  while (!echo_pipe->closed)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpint (echo_pipe->received->len, ==, 6);
  g_assert (memcmp (echo_pipe->received->data, "onetwo", 6) == 0);
}

static void
test_echo_large (TestCase *tc,
                 gconstpointer data)
{
  MockEchoPipe *echo_pipe = (MockEchoPipe *)tc->pipe;
  GBytes *sent;

  /* Medium length */
  sent = g_bytes_new_take (g_strnfill (1020, '!'), 1020);
  cockpit_pipe_write (tc->pipe, sent);
  while (echo_pipe->received->len < g_bytes_get_size (sent))
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpint (echo_pipe->received->len, ==, g_bytes_get_size (sent));
  g_assert (memcmp (echo_pipe->received->data, g_bytes_get_data (sent, NULL), g_bytes_get_size (sent)) == 0);
  g_bytes_unref (sent);

  g_byte_array_set_size (echo_pipe->received, 0);

  /* Extra large */
  sent = g_bytes_new_take (g_strnfill (10 * 1000 * 1000, '?'), 10 * 1000 * 1000);
  cockpit_pipe_write (tc->pipe, sent);
  while (echo_pipe->received->len < g_bytes_get_size (sent))
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpint (echo_pipe->received->len, ==, g_bytes_get_size (sent));
  g_assert (memcmp (echo_pipe->received->data, g_bytes_get_data (sent, NULL), g_bytes_get_size (sent)) == 0);
  g_bytes_unref (sent);

  g_byte_array_set_size (echo_pipe->received, 0);

  /* Double check that didn't csrew things up */
  sent = g_bytes_new_static ("yello", 5);
  cockpit_pipe_write (tc->pipe, sent);
  while (echo_pipe->received->len < g_bytes_get_size (sent))
    g_main_context_iteration (NULL, TRUE);
  g_assert_cmpint (echo_pipe->received->len, ==, g_bytes_get_size (sent));
  g_assert (memcmp (echo_pipe->received->data, g_bytes_get_data (sent, NULL), g_bytes_get_size (sent)) == 0);
  g_bytes_unref (sent);
}


static void
test_close_problem (TestCase *tc,
                    gconstpointer data)
{
  MockEchoPipe *echo_pipe = (MockEchoPipe *)tc->pipe;

  cockpit_pipe_close (tc->pipe, "right now");

  while (!echo_pipe->closed)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpstr (echo_pipe->problem, ==, "right now");
}

static gboolean
on_log_ignore_warnings (const gchar *log_domain,
                        GLogLevelFlags log_level,
                        const gchar *message,
                        gpointer user_data)
{
  switch (log_level & G_LOG_LEVEL_MASK)
    {
    case G_LOG_LEVEL_WARNING:
    case G_LOG_LEVEL_MESSAGE:
    case G_LOG_LEVEL_INFO:
    case G_LOG_LEVEL_DEBUG:
      return FALSE;
    default:
      return TRUE;
    }
}

static void
test_read_error (void)
{
  MockEchoPipe *echo_pipe;
  int out;

  /* Assuming FD 1000 is not taken */
  g_assert (write (1000, "1", 1) < 0);

  out = dup (2);
  g_assert (out >= 0);

  /* Below we cause a warning, and g_test_expect_message() is broken */
  g_test_log_set_fatal_handler (on_log_ignore_warnings, NULL);

  /* Pass in a bad read descriptor */
  echo_pipe = g_object_new (mock_echo_pipe_get_type (),
                            "name", "test",
                            "in-fd", 1000,
                            "out-fd", out,
                            NULL);

  while (!echo_pipe->closed)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpstr (echo_pipe->problem, ==, "internal-error");

  g_object_unref (echo_pipe);
}

static void
test_write_error (void)
{
  MockEchoPipe *echo_pipe;
  GBytes *sent;
  int fds[2];

  /* Just used so we have a valid fd */
  if (pipe(fds) < 0)
    g_assert_not_reached ();

  /* Below we cause a warning, and g_test_expect_message() is broken */
  g_test_log_set_fatal_handler (on_log_ignore_warnings, NULL);

  /* Pass in a bad write descriptor */
  echo_pipe = g_object_new (mock_echo_pipe_get_type (),
                            "name", "test",
                            "in-fd", fds[0],
                            "out-fd", 1000,
                            NULL);

  sent = g_bytes_new ("test", 4);
  cockpit_pipe_write (COCKPIT_PIPE (echo_pipe), sent);
  g_bytes_unref (sent);

  while (!echo_pipe->closed)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpstr (echo_pipe->problem, ==, "internal-error");

  close (fds[1]);

  g_object_unref (echo_pipe);
}

static void
test_read_combined (void)
{
  MockEchoPipe *echo_pipe;
  struct iovec iov[4];
  gint fds[2];
  int out;

  if (pipe(fds) < 0)
    g_assert_not_reached ();

  out = dup (2);
  g_assert (out >= 0);

  /* Pass in a read end of the pipe */
  echo_pipe = g_object_new (mock_echo_pipe_get_type (),
                            "name", "test",
                            "in-fd", fds[0],
                            "out-fd", out,
                            NULL);

  /* Write two messages to the pipe at once */
  iov[0].iov_base = "one";
  iov[0].iov_len = 3;
  iov[1].iov_base = "two";
  iov[1].iov_len = 3;
  iov[2].iov_base = "three";
  iov[2].iov_len = 5;
  iov[3].iov_base = "\0";
  iov[3].iov_len = 1;
  g_assert_cmpint (writev (fds[1], iov, 4), ==, 12);

  while (echo_pipe->received->len < 12)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpint (echo_pipe->received->len, ==, 12);
  g_assert_cmpstr ((gchar *)echo_pipe->received->data, ==, "onetwothree");

  close (fds[1]);
  g_object_unref (echo_pipe);
}

static void
test_consume_entire (void)
{
  GByteArray *buffer;
  GBytes *bytes;

  buffer = g_byte_array_new ();
  g_byte_array_append (buffer, (guint8 *)"Marmaalaaaade!", 15);

  bytes = cockpit_pipe_consume (buffer, 0, 15);
  g_assert_cmpuint (buffer->len, ==, 0);
  g_byte_array_free (buffer, TRUE);

  g_assert_cmpuint (g_bytes_get_size (bytes), ==, 15);
  g_assert_cmpstr (g_bytes_get_data (bytes, NULL), ==, "Marmaalaaaade!");
  g_bytes_unref (bytes);
}

static void
test_consume_partial (void)
{
  GByteArray *buffer;
  GBytes *bytes;

  buffer = g_byte_array_new ();
  g_byte_array_append (buffer, (guint8 *)"Marmaalaaaade!", 15);

  bytes = cockpit_pipe_consume (buffer, 0, 7);
  g_assert_cmpuint (buffer->len, ==, 8);
  g_assert_cmpstr ((gchar *)buffer->data, ==, "aaaade!");
  g_byte_array_free (buffer, TRUE);

  g_assert_cmpuint (g_bytes_get_size (bytes), ==, 7);
  g_assert (memcmp (g_bytes_get_data (bytes, NULL), "Marmaal", 7) == 0);
  g_bytes_unref (bytes);
}

static void
test_consume_skip (void)
{
  GByteArray *buffer;
  GBytes *bytes;

  buffer = g_byte_array_new ();
  g_byte_array_append (buffer, (guint8 *)"Marmaalaaaade!", 15);

  bytes = cockpit_pipe_consume (buffer, 7, 8);
  g_assert_cmpuint (buffer->len, ==, 0);
  g_byte_array_free (buffer, TRUE);

  g_assert_cmpuint (g_bytes_get_size (bytes), ==, 8);
  g_assert_cmpstr (g_bytes_get_data (bytes, NULL), ==,  "aaaade!");
  g_bytes_unref (bytes);
}

static void
test_properties (void)
{
  CockpitPipe *tpipe;
  gchar *name;
  gint in;
  gint out;
  int fds[2];

  if (pipe(fds) < 0)
    g_assert_not_reached ();

  tpipe = g_object_new (mock_echo_pipe_get_type (),
                       "name", "testo",
                       "in-fd", fds[0],
                       "out-fd", fds[1],
                       NULL);

  g_object_get (tpipe, "name", &name, "in-fd", &in, "out-fd", &out, NULL);
  g_assert_cmpstr (name, ==, "testo");
  g_free (name);
  g_assert_cmpint (in, ==, fds[0]);
  g_assert_cmpint (out, ==, fds[1]);

  g_object_unref (tpipe);
}

int
main (int argc,
      char *argv[])
{
  g_type_init ();

  g_set_prgname ("test-pipe");
  g_test_init (&argc, &argv, NULL);

  g_test_add_func ("/pipe/consume/entire", test_consume_entire);
  g_test_add_func ("/pipe/consume/partial", test_consume_partial);
  g_test_add_func ("/pipe/consume/skip", test_consume_skip);

  g_test_add_func ("/pipe/properties", test_properties);

  g_test_add ("/pipe/echo-message", TestCase, NULL,
              setup_echo, test_echo_and_close, teardown);
  g_test_add ("/pipe/echo-queue", TestCase, NULL,
              setup_echo, test_echo_queue, teardown);
  g_test_add ("/pipe/echo-large", TestCase, NULL,
              setup_echo, test_echo_large, teardown);
  g_test_add ("/pipe/close-problem", TestCase, NULL,
              setup_echo, test_close_problem, teardown);

  g_test_add_func ("/pipe/read-error", test_read_error);
  g_test_add_func ("/pipe/write-error", test_write_error);
  g_test_add_func ("/pipe/read-combined", test_read_combined);

  return g_test_run ();
}
