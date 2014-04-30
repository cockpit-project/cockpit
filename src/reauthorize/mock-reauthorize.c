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

#include <security/pam_appl.h>

#include <sys/mman.h>
#include <sys/resource.h>
#include <sys/types.h>
#include <sys/stat.h>

#include <assert.h>
#include <err.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static int verbose = 0;

static int
mock_conv (int n,
           const struct pam_message **msg,
           struct pam_response **resp,
           void *arg)
{
  const char **password = (const char **)arg;
  struct pam_response *aresp;
  int i;

  assert (n > 0 && n < PAM_MAX_NUM_MSG);
  aresp = calloc(n, sizeof (struct pam_response));
  assert (aresp != NULL);

  for (i = 0; i < n; ++i)
    {
      aresp[i].resp_retcode = 0;
      aresp[i].resp = NULL;
      switch (msg[i]->msg_style)
        {
        case PAM_PROMPT_ECHO_OFF:
          if (*password)
            {
              if (verbose)
                warnx ("responded to PAM with password");
              aresp[i].resp = strdup (*password);
              *password = NULL;
            }
          else
            {
              warnx ("pam prompted for too many passwords: auth likely failed");
              return PAM_CONV_ERR;
            }
          break;
        case PAM_PROMPT_ECHO_ON:
          warnx ("pam prompted: %s", msg[i]->msg);
          return PAM_CONV_ERR;
        case PAM_ERROR_MSG:
          fputs (msg[i]->msg, stderr);
          if (strlen(msg[i]->msg) > 0 &&
              msg[i]->msg[strlen(msg[i]->msg) - 1] != '\n')
            fputc('\n', stderr);
          break;
        case PAM_TEXT_INFO:
          fprintf(stdout, "# %s", msg[i]->msg);
          if (strlen(msg[i]->msg) > 0 &&
              msg[i]->msg[strlen(msg[i]->msg) - 1] != '\n')
            fputc('\n', stdout);
          break;
        default:
          return PAM_CONV_ERR;
        }
    }

  *resp = aresp;
  return PAM_SUCCESS;
}

static int
mock_prepare (const char *user,
              const char *password)
{
  struct pam_conv conv = { .conv = mock_conv, .appdata_ptr = &password };
  pam_handle_t *pamh;
  int ret;

  /* Become a real root process */
  if (setgid (0) < 0 || setuid (0) < 0)
    err (1, "couldn't become root process");

  ret = pam_start ("mock-reauthorize-prepare", user, &conv, &pamh);
  if (ret != PAM_SUCCESS)
    errx (1, "pam_start() failed: %s", pam_strerror (NULL, ret));

  ret = pam_authenticate (pamh, 0);
  if (ret == PAM_SUCCESS)
    {
      ret = pam_open_session (pamh, 0);
      if (ret != PAM_SUCCESS)
        warnx ("session failed: %s", pam_strerror (pamh, ret));
      else if (verbose)
        warnx ("auth and session succeed");
    }
  else if (verbose)
    warnx ("auth failed: %s", pam_strerror (pamh, ret));

  pam_end (pamh, ret);
  return ret;
}

static int
mock_perform (const char *user)
{
  const char *no_password = NULL;
  struct pam_conv conv = { .conv = mock_conv, .appdata_ptr = &no_password };
  pam_handle_t *pamh;
  int ret;

  ret = pam_start ("mock-reauthorize-perform", user, &conv, &pamh);
  if (ret != PAM_SUCCESS)
    errx (1, "pam_start() failed: %s", pam_strerror (NULL, ret));

  ret = pam_authenticate (pamh, 0);
  if (ret == PAM_SUCCESS)
    {
      if (verbose)
        warnx ("auth succeeded");
    }
  else if (ret != PAM_AUTH_ERR || verbose)
    {
      warnx ("auth failed: %s", pam_strerror (pamh, ret));
    }

  pam_end (pamh, ret);
  return ret;
}

static void
check_prerequisite (const char *filename,
                    const char *needle)
{
  size_t needle_len;
  struct stat sb;
  const char *end;
  void *data;
  char *p;
  int ret;
  int fd;

  fd = open (filename, O_RDONLY);
  if (fd < 0)
    {
      if (errno == ENOENT)
        {
          if (verbose)
            warnx ("mock pam config not installed corectly: %s", filename);
          exit (77);
        }
      err (1, "couldn't open: %s", filename);
    }

  if (fstat (fd, &sb) < 0)
    err (1, "couldn't stat: %s", filename);

  needle_len = strlen (needle);
  if (sb.st_size == 0 || needle_len > sb.st_size)
    {
      if (verbose)
        warnx ("mock pam config not installed corectly: %s", filename);
      exit (77);
    }

  data = mmap (NULL, sb.st_size, PROT_READ, MAP_PRIVATE, fd, 0);
  if (data == MAP_FAILED)
    err (1, "couldn't map: %s", filename);

  ret = 0;
  p = data;
  end = p + sb.st_size - needle_len;
  while (p <= end)
    {
      if (memcmp (p, needle, needle_len) == 0)
        {
          ret = 1;
          break;
        }
      p++;
    }

  if (ret == 0)
    {
      if (verbose)
        warnx ("mock pam config not installed corectly: %s", filename);
      exit (77);
    }

  munmap (data, sb.st_size);
  close (fd);
}

static int
usage (void)
{
  fprintf (stderr, "usage: mock-reauthorize [-v] prepare <user> <password>\n");
  fprintf (stderr, "       mock-reauthorize [-v] perform <user>\n");
  return 2;
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

  argc -= optind;
  argv += optind;

  if (geteuid () != 0)
    {
      if (verbose)
        warnx ("mock-reauthorize needs to be setuid root");
      exit (77);
    }

  /* First check if we have the right pam config xxxx */
  check_prerequisite (SYSCONFDIR "/pam.d/mock-reauthorize-prepare", BUILDDIR);
  check_prerequisite (SYSCONFDIR "/pam.d/mock-reauthorize-perform", BUILDDIR);

  if (argc == 3 && strcmp (argv[0], "prepare") == 0)
    return mock_prepare (argv[1], argv[2]);
  else if (argc == 2 && strcmp (argv[0], "perform") == 0)
    return mock_perform (argv[1]);

  return usage ();
}
