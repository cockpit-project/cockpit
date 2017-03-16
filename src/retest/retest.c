/*
 * Copyright (c) 2013, Red Hat Inc.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 *     * Redistributions of source code must retain the above
 *       copyright notice, this list of conditions and the
 *       following disclaimer.
 *     * Redistributions in binary form must reproduce the
 *       above copyright notice, this list of conditions and
 *       the following disclaimer in the documentation and/or
 *       other materials provided with the distribution.
 *     * The names of contributors to this software may not be
 *       used to endorse or promote products derived from this
 *       software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS
 * FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE
 * COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT,
 * INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING,
 * BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS
 * OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED
 * AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF
 * THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH
 * DAMAGE.
 *
 * Author: Stef Walter <stefw@redhat.com>
 */

#define _GNU_SOURCE 1

#include "retest.h"
#undef assert

#include <sys/stat.h>
#include <sys/wait.h>

#include <assert.h>
#include <errno.h>
#include <setjmp.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

enum {
  FIXTURE,
  TEST,
};

typedef void (*func_with_arg) (void *);

typedef struct _test_item {
  int type;

  union {
    struct {
      char name[1024];
      func_with_arg func;
      void *argument;
      int done;
    } test;
    struct {
      func_with_arg setup;
      func_with_arg teardown;
    } fix;
  } x;

  struct _test_item *next;
} test_item;

struct {
  test_item *suite;
  test_item *last;
  int number;
  jmp_buf jump;

  /* forking */
  int am_child;
  pid_t child_pid;
  int child_status;
} gl = { NULL, NULL, 0, };

GNUC_NORETURN static void
exit_child (int code)
{
  fflush (stderr);
  fflush (stdout);
  _exit (code);
}

void
re_test_fail (const char *filename,
              int line,
              const char *function,
              const char *message,
              ...)
{
  const char *pos;
  char *output;
  char *from;
  char *next;
  va_list va;

  assert (gl.last != NULL);
  assert (gl.last->type == TEST);

  if (gl.child_status == 0)
    {
      gl.last->x.test.done = 1;

      printf ("not ok %d %s\n", gl.number, gl.last->x.test.name);

      va_start (va, message);
      if (vasprintf (&output, message, va) < 0)
        assert (0 && "vasprintf failed");
      va_end (va);

      for (from = output; from != NULL; )
        {
          next = strchr (from, '\n');
          if (next)
            {
              next[0] = '\0';
              next += 1;
            }

          printf ("# %s\n", from);
          from = next;
        }

      pos = strrchr (filename, '/');
      if (pos != NULL && pos[1] != '\0')
        filename = pos + 1;

      printf ("# in %s() at %s:%d\n", function, filename, line);

      free (output);
    }

  if (gl.child_pid)
    kill (gl.child_pid, SIGPIPE);

  /* Let coverity know we're not supposed to return from here */
#ifdef __COVERITY__
  abort();
#endif

  if (!gl.am_child)
    longjmp (gl.jump, 1);
  exit_child (67);
}

void
re_test_skip (const char *reason)
{
  assert (gl.last != NULL);
  assert (gl.last->type == TEST);

  if (gl.child_status == 0)
    {
      gl.last->x.test.done = 1;
      printf ("ok %d # skip -- %s\n", gl.number, reason);
    }

  if (gl.child_pid)
    kill (gl.child_pid, SIGPIPE);

  /* Let coverity know we're not supposed to return from here */
#ifdef __COVERITY__
  abort();
#endif

  if (gl.am_child)
    exit_child (77);
  else
    longjmp (gl.jump, 1);
}

static void
test_push (test_item *it)
{
  test_item *item;

  item = calloc (1, sizeof (test_item));
  assert (item != NULL);
  memcpy (item, it, sizeof (test_item));

  if (!gl.suite)
    gl.suite = item;
  if (gl.last)
    gl.last->next = item;
  gl.last = item;
}

void
re_test (void (* function) (void),
         const char *name,
         ...)
{
  test_item item = { TEST, };
  va_list va;

  item.x.test.func = (func_with_arg)function;

  va_start (va, name);
  vsnprintf (item.x.test.name, sizeof (item.x.test.name), name, va);
  va_end (va);

  test_push (&item);
}

void
re_testx (void (* function) (void *),
          void *argument,
          const char *name,
          ...)
{
  test_item item = { TEST, };
  va_list va;

  item.type = TEST;
  item.x.test.func = function;
  item.x.test.argument = argument;

  va_start (va, name);
  vsnprintf (item.x.test.name, sizeof (item.x.test.name), name, va);
  va_end (va);

  test_push (&item);
}

void
re_fixture (void (* setup) (void *),
            void (* teardown) (void *))
{
  test_item item;

  item.type = FIXTURE;
  item.x.fix.setup = setup;
  item.x.fix.teardown = teardown;

  test_push (&item);
}

int
re_test_run (int argc,
             char **argv)
{
  test_item *fixture = NULL;
  test_item *item;
  test_item *next;
  int count;
  int setup;

  assert (gl.number == 0);
  gl.last = NULL;

  for (item = gl.suite, count = 0; item != NULL; item = item->next)
    {
      if (item->type == TEST)
        count++;
    }

  if (count == 0)
    {
      printf ("1..0 # No tests\n");
      return 0;
    }

  printf ("1..%d\n", count);

  for (item = gl.suite, gl.number = 0; item != NULL; item = item->next)
    {
      if (item->type == FIXTURE)
        {
          fixture = item;
          continue;
        }

      assert (item->type == TEST);
      gl.last = item;
      gl.am_child = 0;
      gl.child_status = 0;
      gl.child_pid = 0;
      gl.number++;
      setup = 0;

      if (setjmp (gl.jump) == 0)
        {
          if (fixture && fixture->x.fix.setup)
            (fixture->x.fix.setup) (item->x.test.argument);

          setup = 1;

          assert (item->x.test.func);
          (item->x.test.func)(item->x.test.argument);

          /* child success path */
          if (gl.am_child)
            exit_child (0);
        }

      /* parent checks on child */
      if (gl.child_pid)
        {
          if (waitpid (gl.child_pid, &gl.child_status, 0) < 0)
            assert (0 && "waitpid failed");
          gl.child_pid = 0;
        }
      if (gl.child_status != 0)
        {
          if (WIFEXITED (gl.child_status) &&
              WEXITSTATUS (gl.child_status) != 77 &&
              WEXITSTATUS (gl.child_status) != 67)
            printf ("not ok %d %s\n", gl.number, item->x.test.name);
          gl.last->x.test.done = 1;
        }

      if (setup)
        {
          if (setjmp (gl.jump) == 0)
            {
              if (fixture && fixture->x.fix.teardown)
                (fixture->x.fix.teardown) (item->x.test.argument);
            }
        }

      if (!gl.last->x.test.done)
        printf ("ok %d %s\n", gl.number, item->x.test.name);

      gl.last = NULL;
    }

  for (item = gl.suite; item != NULL; item = next)
    {
      next = item->next;
      free (item);
    }

  gl.suite = NULL;
  gl.last = 0;
  gl.number = 0;
  return 0;
}

char *
re_test_directory (const char *prefix)
{
  char *directory;

  if (asprintf (&directory, "%s.XXXXXX", prefix) < 0)
    assert (0 && "allocation failed");

  if (!mkdtemp (directory)) {
    printf ("# couldn't create temp directory: %s: %s\n",
            directory, strerror (errno));
    free (directory);
    assert (0 && "mkdtemp failed");
  }

  return directory;
}

static void
child_handler (int sig)
{
  pid_t pid;
  int status;

  pid = waitpid (gl.child_pid, &status, WNOHANG);
  if (pid < 0)
    {
      if (errno == ECHILD || errno == EAGAIN)
        return;
      assert (pid >= 0);
    }
  if (pid != 0 && gl.child_pid == pid)
    {
      gl.child_status = status;
      gl.child_pid = 0;
    }
}

int
re_test_fork (void)
{
  struct sigaction sa;

  assert (!gl.am_child);
  assert (!gl.child_pid);

  fflush (stdout);
  fflush (stderr);

  gl.child_pid = fork();
  assert (gl.child_pid >= 0);

  if (gl.child_pid == 0)
    {
      if (signal (SIGCHLD, SIG_DFL) == SIG_ERR)
        assert (0 && "signal failed");
      gl.am_child = 1;
    }
  else
    {
      /* Remove SA_RESTART from SIGCHLD */
      sa.sa_handler = child_handler;
      sigemptyset (&sa.sa_mask);
      sa.sa_flags = SA_NOCLDSTOP;
      if (sigaction (SIGCHLD, &sa, 0) < 0)
        assert (0 && "sigaction failed");
    }

  return gl.am_child;
}
