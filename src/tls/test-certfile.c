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
#include <stdatomic.h>
#include <stdbool.h>
#include <sys/socket.h>
#include <unistd.h>

#include "common/cockpittest.h"
#include "certfile.h"

/* We could use atomics here, but we want to assert an invariant between
 * the counters and the content of the filesystem.  We can't do that
 * reliably without preventing the counters from being updated, so we
 * need to use a mutex.
 *
 * The reason for having two variables is because we can't assume the
 * filesystem state one way or the other in case the first/last thread
 * is starting/exiting.  In that case, we'll see running_threads > 0,
 * but active_threads == 0.
 */
static pthread_mutex_t running_threads_mutex = PTHREAD_MUTEX_INITIALIZER;
static int running_threads;
static pthread_mutex_t active_threads_mutex = PTHREAD_MUTEX_INITIALIZER;
static int active_threads;

static int testdir_fd;

#define SHA256_HELLO_PEM "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"

static gpointer
test_thread (gpointer data)
{
  int socket_fd = GPOINTER_TO_INT (data);
  gnutls_datum_t der = { (unsigned char *) "hello", 5 };
  int certfile_fd;
  Fingerprint fingerprint;

  pthread_mutex_lock (&running_threads_mutex);
  running_threads++;
  pthread_mutex_unlock (&running_threads_mutex);

  certfile_fd = certfile_open (testdir_fd, &fingerprint, &der);
  g_assert_cmpint (certfile_fd, !=, -1);

  pthread_mutex_lock (&active_threads_mutex);
  active_threads++;
  pthread_mutex_unlock (&active_threads_mutex);

  /* wait to read an EOF from the socket */
  {
    ssize_t s;
    char b;

    do
      s = read (socket_fd, &b, sizeof b);
    while (s == -1 && errno == EINTR);

    g_assert_cmpint (s, ==, 0);
  }

  pthread_mutex_lock (&active_threads_mutex);
  active_threads--;
  pthread_mutex_unlock (&active_threads_mutex);

  certfile_close (testdir_fd, certfile_fd, &fingerprint);

  pthread_mutex_lock (&running_threads_mutex);
  running_threads--;
  pthread_mutex_unlock (&running_threads_mutex);

  close (socket_fd);

  return NULL;
}

static void
assert_invariant (bool must_not_exist)
{
  Fingerprint fingerprint = { .str = SHA256_HELLO_PEM };

  pthread_mutex_lock (&running_threads_mutex);
  pthread_mutex_lock (&active_threads_mutex);

  int r = faccessat (testdir_fd, fingerprint.str, F_OK, 0);
  g_assert (r == 0 || errno == ENOENT);

  /* these checks are the same as below, but produce better error messages */
  if (r == 0)
    g_assert_cmpint (running_threads, >, 0);
  else
    g_assert_cmpint (active_threads, ==, 0);

  /* these checks should effectively be doing the same as above */
  if (active_threads)
    g_assert (r == 0);
  else if (running_threads == 0)
    g_assert (r == -1 && errno == ENOENT);
  else
    ; /* nothing can be said in this state */

  pthread_mutex_unlock (&active_threads_mutex);
  pthread_mutex_unlock (&running_threads_mutex);
}

static void
test_certfile_multithreaded (void)
{
  GError *error = NULL;
  int connections[50];

  if (cockpit_test_skip_slow ())
    return;

  g_autofree char *dirname = g_dir_make_tmp ("cockpit-tests.XXXXXX", &error);
  g_assert_no_error (error);
  testdir_fd = open (dirname, O_PATH);
  g_assert (dirfd >= 0);

  for (int slot_nr = 0; slot_nr < G_N_ELEMENTS (connections); slot_nr++)
    connections[slot_nr] = -1;

  for (int n = 0; n < 2000; n += 10)
    {
      /* run for 'n' iterations randomly starting and stopping
       * connections.  on average this will converge towards ~50% of the
       * threads running at a given time.
       */
      for (int i = 0; i < n; i++)
        {
          int slot_nr = g_test_rand_int_range (0, G_N_ELEMENTS (connections));

          if (connections[slot_nr] == -1)
            {
              int sv[2];

              g_assert_cmpint (socketpair (AF_UNIX, SOCK_STREAM, 0, sv), ==, 0);
              g_thread_unref (g_thread_new ("connection", test_thread, GINT_TO_POINTER (sv[1])));
              connections[slot_nr] = sv[0];
            }
          else
            {
              /* async thread termination */
              close (connections[slot_nr]);
              connections[slot_nr] = -1;
            }

          assert_invariant (false);
          g_thread_yield ();
          assert_invariant (false);
        }

      /* close all the connections */
      for (int slot_nr = 0; slot_nr < G_N_ELEMENTS (connections); slot_nr++)
        if (connections[slot_nr] != -1)
          {
            ssize_t r;
            char b;

            /* blocking thread termination */
            shutdown (connections[slot_nr], SHUT_WR);
            do
              r = read (connections[slot_nr], &b, sizeof b);
            while (r == -1 && errno == EINTR);
            close (connections[slot_nr]);
            connections[slot_nr] = -1;
          }

      /* assert that nothing exists */
      assert_invariant (true);
    }

  for (int slot_nr = 0; slot_nr < G_N_ELEMENTS (connections); slot_nr++)
    g_assert_cmpint (connections[slot_nr], ==, -1);

  close (testdir_fd);

  /* no certfile should be left, so rmdir should work */
  g_assert_cmpint (rmdir (dirname), ==, 0);
}

int
main (int argc,
      char *argv[])
{
  cockpit_test_init (&argc, &argv);

  g_test_add_func ("/certfile/multi-threaded", test_certfile_multithreaded);

  return g_test_run ();
}
