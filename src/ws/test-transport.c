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

#include "cockpittransport.h"
#include "cockpitfdtransport.h"

#include "websocket/websocket.h"

#include <glib.h>

#include <string.h>

#include <sys/types.h>
#include <sys/socket.h>

#define WAIT_UNTIL(cond) \
  G_STMT_START \
    while (!(cond)) g_main_context_iteration (NULL, TRUE); \
  G_STMT_END

typedef struct {
  CockpitTransport *transport;
} TestCase;

static void
setup_with_child (TestCase *tc,
                  gconstpointer data)
{
  gchar *argv[] = { (gchar *)data, NULL };
  GError *error = NULL;
  GPid pid;
  int in;
  int out;

  g_spawn_async_with_pipes (NULL, argv, NULL, G_SPAWN_SEARCH_PATH | G_SPAWN_DO_NOT_REAP_CHILD,
                            NULL, NULL, &pid, &in, &out, NULL, &error);
  g_assert_no_error (error);

  tc->transport = g_object_new (COCKPIT_TYPE_FD_TRANSPORT,
                                "name", "mock",
                                "in-fd", out,
                                "out-fd", in,
                                "pid", pid);
}

static void
setup_no_child (TestCase *tc,
                gconstpointer data)
{
  int sv[2];

  if (socketpair (PF_LOCAL, SOCK_STREAM, 0, sv) < 0)
    g_assert_not_reached ();

  tc->transport = cockpit_fd_transport_new ("mock", sv[0], sv[1]);
}

static void
teardown_transport (TestCase *tc,
                    gconstpointer data)
{
  g_object_add_weak_pointer (G_OBJECT (tc->transport),
                             (gpointer *)&tc->transport);
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
  g_assert_cmpuint (channel, ==, 0);
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
  g_assert (problem == NULL);
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

  sent = g_bytes_new_static ("the message", 11);
  g_signal_connect (tc->transport, "recv", G_CALLBACK (on_recv_get_payload), &received);
  cockpit_transport_send (tc->transport, 0, sent);

  WAIT_UNTIL (received != NULL);

  g_assert (g_bytes_equal (received, sent));
  g_bytes_unref (sent);
  g_bytes_unref (received);
  received = NULL;

  g_signal_connect (tc->transport, "closed", G_CALLBACK (on_closed_set_flag), &closed);
  cockpit_transport_close (tc->transport, NULL);

  WAIT_UNTIL (closed == TRUE);
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
  cockpit_transport_send (tc->transport, 0, sent);
  g_bytes_unref (sent);
  sent = g_bytes_new_static ("two", 3);
  cockpit_transport_send (tc->transport, 0, sent);
  g_bytes_unref (sent);

  /* Only closes after above are sent */
  cockpit_transport_close (tc->transport, NULL);

  WAIT_UNTIL (state == 2 && closed == TRUE);
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
  cockpit_transport_send (tc->transport, 0, sent);
  WAIT_UNTIL (received != NULL);
  g_assert (g_bytes_equal (received, sent));
  g_bytes_unref (sent);
  g_bytes_unref (received);
  received = NULL;

  /* Extra large */
  sent = g_bytes_new_take (g_strnfill (10 * 1000 * 1000, '?'), 10 * 1000 * 1000);
  cockpit_transport_send (tc->transport, 0, sent);
  WAIT_UNTIL (received != NULL);
  g_assert (g_bytes_equal (received, sent));
  g_bytes_unref (sent);
  g_bytes_unref (received);
  received = NULL;

  /* Double check that didn't csrew things up */
  sent = g_bytes_new_static ("yello", 5);
  cockpit_transport_send (tc->transport, 0, sent);
  WAIT_UNTIL (received != NULL);
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

  WAIT_UNTIL (problem != NULL);

  g_assert_cmpstr (problem, ==, "right now");
  g_free (problem);
}

static void
test_terminate_problem (TestCase *tc,
                        gconstpointer data)
{
  gchar *problem = NULL;
  GPid pid;

  g_signal_connect (tc->transport, "closed", G_CALLBACK (on_closed_get_problem), &problem);

  g_object_get (tc->transport, "pid", &pid, NULL);
  g_assert (pid != 0);
  kill (pid, SIGTERM);

  WAIT_UNTIL (problem != NULL);

  g_assert_cmpstr (problem, ==, "terminated");
  g_free (problem);
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
  CockpitTransport *transport;
  gchar *problem = NULL;

  /* Assuming FD 1000 is not taken */
  g_assert (write (1000, "1", 1) < 0);

  /* Below we cause a warning, and g_test_expect_message() is broken */
  g_test_log_set_fatal_handler (on_log_ignore_warnings, NULL);

  /* Pass in a bad read descriptor */
  transport = cockpit_fd_transport_new ("test", 1000, 2);

  g_signal_connect (transport, "closed", G_CALLBACK (on_closed_get_problem), &problem);

  WAIT_UNTIL (problem != NULL);
  g_assert_cmpstr (problem, ==, "internal-error");
  g_free (problem);

  g_object_unref (transport);
}

static void
test_write_error (void)
{
  CockpitTransport *transport;
  gchar *problem = NULL;
  GBytes *sent;
  int fds[2];

  /* Just used so we have a valid fd */
  if (pipe(fds) < 0)
    g_assert_not_reached ();

  /* Assuming FD 1000 is not taken */
  g_assert (write (1000, "1", 1) < 0);

  /* Below we cause a warning, and g_test_expect_message() is broken */
  g_test_log_set_fatal_handler (on_log_ignore_warnings, NULL);

  /* Pass in a bad write descriptor */
  transport = cockpit_fd_transport_new ("test", fds[0], 1000);

  sent = g_bytes_new ("test", 4);
  cockpit_transport_send (transport, 0, sent);
  g_bytes_unref (sent);

  g_signal_connect (transport, "closed", G_CALLBACK (on_closed_get_problem), &problem);

  WAIT_UNTIL (problem != NULL);
  g_assert_cmpstr (problem, ==, "internal-error");
  g_free (problem);

  close (fds[0]);
  close (fds[1]);

  g_object_unref (transport);
}

static void
test_read_combined (void)
{
  CockpitTransport *transport;
  struct iovec iov[4];
  gint state = 0;
  gint fds[2];
  guint32 size;

  if (pipe(fds) < 0)
    g_assert_not_reached ();

  /* Pass in a read end of the pipe */
  transport = cockpit_fd_transport_new ("test", fds[0], 2);
  g_signal_connect (transport, "recv", G_CALLBACK (on_recv_multiple), &state);

  /* Write two messages to the pipe at once */
  size = GUINT32_TO_BE (3);
  iov[0].iov_base = &size;
  iov[0].iov_len = sizeof (size);
  iov[1].iov_base = "one";
  iov[1].iov_len = 3;
  iov[2].iov_base = &size;
  iov[2].iov_len = sizeof (size);
  iov[3].iov_base = "two";
  iov[3].iov_len = 3;
  g_assert_cmpint (writev (fds[1], iov, 4), ==, 14);

  WAIT_UNTIL (state == 2);

  close (fds[1]);
  g_object_unref (transport);
}

static void
test_read_truncated (void)
{
  CockpitTransport *transport;
  gchar *problem = NULL;
  gint fds[2];

  if (pipe(fds) < 0)
    g_assert_not_reached ();

  /* Below we cause a warning, and g_test_expect_message() is broken */
  g_test_log_set_fatal_handler (on_log_ignore_warnings, NULL);

  /* Pass in a read end of the pipe */
  transport = cockpit_fd_transport_new ("test", fds[0], 2);
  g_signal_connect (transport, "closed", G_CALLBACK (on_closed_get_problem), &problem);

  /* Not a full 4 byte length (ie: truncated) */
  g_assert_cmpint (write (fds[1], "X", 1), ==, 1);
  g_assert_cmpint (close (fds[1]), ==, 0);

  WAIT_UNTIL (problem != NULL);

  g_assert_cmpstr (problem, ==, "internal-error");
  g_free (problem);

  g_object_unref (transport);
}

int
main (int argc,
      char *argv[])
{
#if !GLIB_CHECK_VERSION(2,36,0)
  g_type_init ();
#endif

  g_set_prgname ("test-transport");
  g_test_init (&argc, &argv, NULL);

  g_test_add ("/transport/echo-message/child", TestCase,
              BUILDDIR "/mock-echo", setup_with_child,
              test_echo_and_close, teardown_transport);
  g_test_add ("/transport/echo-message/no-child", TestCase,
              NULL, setup_no_child,
              test_echo_and_close, teardown_transport);
  g_test_add ("/transport/echo-queue/child", TestCase,
              BUILDDIR "/mock-echo", setup_with_child,
              test_echo_queue, teardown_transport);
  g_test_add ("/transport/echo-queue/no-child", TestCase,
              NULL, setup_no_child,
              test_echo_queue, teardown_transport);
  g_test_add ("/transport/echo-large/child", TestCase,
              "cat", setup_with_child,
              test_echo_large, teardown_transport);
  g_test_add ("/transport/echo-large/no-child", TestCase,
              NULL, setup_no_child,
              test_echo_large, teardown_transport);

  g_test_add ("/transport/close-problem/child", TestCase,
              BUILDDIR "/mock-echo", setup_with_child,
              test_close_problem, teardown_transport);
  g_test_add ("/transport/close-problem/no-child", TestCase,
              NULL, setup_no_child,
              test_close_problem, teardown_transport);

  g_test_add ("/transport/terminate-problem", TestCase,
              BUILDDIR "/mock-echo", setup_with_child,
              test_terminate_problem, teardown_transport);

  g_test_add_func ("/transport/read-error", test_read_error);
  g_test_add_func ("/transport/write-error", test_write_error);
  g_test_add_func ("/transport/read-combined", test_read_combined);
  g_test_add_func ("/transport/read-truncated", test_read_truncated);

  return g_test_run ();
}
