/*
 * Copyright (c) 2014 Red Hat Inc.
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

#include "reauthorize.h"

#include <sys/mman.h>
#include <sys/resource.h>
#include <sys/types.h>
#include <sys/stat.h>

#include <assert.h>
#include <err.h>
#include <errno.h>
#include <fcntl.h>
#include <keyutils.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static int verbose = 0;

static void
on_reauthorize_log (const char *message)
{
  warnx ("%s", message);
}

static int
mock_prepare (const char *user,
              const char *password)
{
  long key;
  int ret;

  /* Become a real root process */
  if (setgid (0) < 0 || setuid (0) < 0)
    err (1, "couldn't become root process");

  ret = reauthorize_prepare (user, password, KEY_SPEC_SESSION_KEYRING, &key);
  if (ret < 0)
    ret = 127;

  return ret;
}

static int
mock_perform (const char *user,
              const char *response)
{
  char *challenge = NULL;
  int ret;

  ret = reauthorize_perform (user, response, &challenge);
  if (ret < 0)
    return 127;

  if (challenge)
    {
      fwrite (challenge, 1, strlen (challenge), stdout);
      fflush (stdout);
      if (ferror (stdout))
        err (127, "couldn't write challenge");
      free (challenge);
    }

  return ret;
}

static int
usage (void)
{
  fprintf (stderr, "usage: mock-reauthorize [-q] prepare <user> <password>\n");
  fprintf (stderr, "       mock-reauthorize [-q] perform <user> [response]\n");
  return 127;
}

int
main (int argc,
      char *argv[])
{
  struct rlimit rl;
  int open_max;
  int opt;
  int i;

  /* Both to be safe, and to simulate what polkit/sudo do */
  clearenv ();
  setenv ("PATH", "/usr/sbin:/usr/bin:/sbin:/bin", 1);

  if (getrlimit(RLIMIT_NOFILE, &rl) == 0 && rl.rlim_max != RLIM_INFINITY)
    open_max = rl.rlim_max;
  else
    open_max = sysconf (_SC_OPEN_MAX);
  for (i = 3; i < open_max; i++)
    close (i);

  while ((opt = getopt(argc, argv, "q")) != -1)
    {
      switch (opt)
        {
        case 'q':
          verbose = 0;
          break;
        default: /* '?' */
          return usage();
        }
    }

  if (verbose)
    reauthorize_logger (on_reauthorize_log, 1);

  argc -= optind;
  argv += optind;

  if (geteuid () != 0)
    {
      if (verbose)
        warnx ("mock-reauthorize needs to be setuid root");
      exit (77);
    }

  if (argc == 3 && strcmp (argv[0], "prepare") == 0)
    return mock_prepare (argv[1], argv[2]);
  else if (argc == 3 && strcmp (argv[0], "perform") == 0)
    return mock_perform (argv[1], argv[2]);
  else if (argc == 2 && strcmp (argv[0], "perform") == 0)
    return mock_perform (argv[1], NULL);

  return usage ();
}
