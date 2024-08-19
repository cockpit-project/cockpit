/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2020 Red Hat, Inc.
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

#include "common/cockpitframe.h"
#include "testlib/cockpittest.h"

#include <glib.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <unistd.h>

typedef struct
{
  FILE *write_fp;
  int read_fd;
} Fixture;

typedef struct
{
  const char *input;
  int expect_errno;
} TestCase;

static void
fixture_setup (Fixture        *self,
               const TestCase *tc)
{
  int pipefd[2];

  int r = pipe (pipefd);
  g_assert_cmpint (r, ==, 0);

  self->write_fp = fdopen (pipefd[1], "w");
  g_assert (self->write_fp != NULL);
  self->read_fd = pipefd[0];

  if (tc->input)
    {
      fprintf (self->write_fp, "%s", tc->input);
      fflush (self->write_fp);
    }
}

static void
fixture_close_write (Fixture *self)
{
  if (self->write_fp)
    {
      fclose (self->write_fp);
      self->write_fp = NULL;
    }
}

static void
fixture_close_read (Fixture *self)
{
  if (self->read_fd != -1)
    {
      close (self->read_fd);
      self->read_fd = -1;
    }
}

static void
fixture_teardown (Fixture *self,
                  const TestCase *tc)
{
  if (tc->expect_errno)
    {
      alarm (10);

      g_autofree unsigned char *output = NULL;
      ssize_t size = cockpit_frame_read (self->read_fd, &output);

      g_assert_cmpint (size, ==, -1);
      g_assert_cmpint (errno, ==, tc->expect_errno);
      g_assert (output == NULL);

      alarm (0);
    }

  fixture_close_write (self);
  fixture_close_read (self);
}

static void
test_valid (Fixture *pipe, const TestCase *tc)
{
  /* Try sending valid frames of various sizes */
  for (gint i = 1; i < 1000; i++)
    {
      /* Write a frame consisting of `i` spaces.  After the frame, write
       * a pattern that we can use to detect that only the correct
       * amount of bytes were read.
       */
      fprintf (pipe->write_fp, "%u\n%*sTHEEND", i, i, "");
      fflush (pipe->write_fp);

      /* Read it back and see what happens */
      g_autofree unsigned char *output = NULL;
      ssize_t size = cockpit_frame_read (pipe->read_fd, &output);

      g_assert_cmpint (size, ==, i);
      for (gint j = 0; j < size; j++)
        g_assert (output[j] == ' ');

      /* Make sure our pattern is there */
      char buffer[7];
      size = read (pipe->read_fd, buffer, sizeof buffer);
      g_assert_cmpint (size, ==, 6);
      g_assert (memcmp (buffer, "THEEND", 6) == 0);
    }
}

static void
test_fail_badfd (Fixture *fixture, const TestCase *tc)
{
  /* cause cockpit_frame_read() to read from -1 */
  fixture_close_read (fixture);
}

static void
test_fail_short (Fixture *fixture, const TestCase *tc)
{
  /* cause cockpit_frame_read() to read the message, then EOF */
  fixture_close_write (fixture);
}

static void
test_fail_nonblocking (Fixture *pipe, const TestCase *tc)
{
  /* cause cockpit_frame_read() to read the message, then EAGAIN */
  (void) fcntl (pipe->read_fd, F_SETFL, O_NONBLOCK);
}

/* many of the testcases are driven entirely by the fixture setup/teardown */
static void nil (void) { }

int
main (int argc,
      char *argv[])
{
  cockpit_test_init (&argc, &argv);

  /* kwargs hack, plus avoid casting gconstpointer */
#define PIPE_TEST(name,func,...) g_test_add_vtable(name, sizeof(Fixture), \
                                            &(TestCase) { __VA_ARGS__ }, \
                                            (GTestFixtureFunc) fixture_setup, \
                                            (GTestFixtureFunc) func, \
                                            (GTestFixtureFunc) fixture_teardown)

  PIPE_TEST("/frame/read-frame/valid", test_valid);

  PIPE_TEST("/frame/read-frame/fail/badfd", test_fail_badfd,
            .expect_errno=EBADF);

  PIPE_TEST("/frame/read-frame/fail/short", test_fail_short,
            .input="10\nabc", .expect_errno=EBADMSG);

  PIPE_TEST("/frame/read-frame/fail/nonblocking", test_fail_nonblocking,
            .input="10\nabc", .expect_errno=EAGAIN);

  /* This valid message should fail because we get EAGAIN while trying to read it... */
  PIPE_TEST("/frame/read-frame/fail/nonblocking-big", test_fail_nonblocking,
            .input="99999999\nabc", .expect_errno=EAGAIN);
  /* ...but add one byte more, and it's now an invalid message. */
  PIPE_TEST("/frame/read-frame/fail/nonblocking-toobig", test_fail_nonblocking,
            .input="100000000\nabc", .expect_errno=EBADMSG);

  /* Some generic failures due to broken messages */
  PIPE_TEST("/frame/read-frame/fail/non-numeric", nil,
            .input="abc\nabc", .expect_errno=EBADMSG);
  PIPE_TEST("/frame/read-frame/fail/semi-numeric", nil,
            .input="1000abc\nabc", .expect_errno=EBADMSG);
  PIPE_TEST("/frame/read-frame/fail/toobig", nil,
            .input="100000000\nabc", .expect_errno=EBADMSG);
  PIPE_TEST("/frame/read-frame/fail/toobig-nonnumeric", nil,
            .input="10000000a\nabc", .expect_errno=EBADMSG);
  PIPE_TEST("/frame/read-frame/fail/leading-zero", nil,
            .input="03\nabc", .expect_errno=EBADMSG);
  PIPE_TEST("/frame/read-frame/fail/empty-header", nil,
            .input="\nabc", .expect_errno=EBADMSG);

  return g_test_run ();
}
