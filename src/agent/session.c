/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013 Red Hat, Inc.
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

#include <assert.h>
#include <err.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <security/pam_appl.h>
#include <sys/signal.h>
#include <utmp.h>
#include <unistd.h>
#include <sys/types.h>
#include <pwd.h>
#include <sys/wait.h>
#include <grp.h>

/* This program opens a session for a given user and runs the agent in
 * it.  It is used to manage localhost; for remote hosts sshd does
 * this job.
 */

const char *user;
const char *rhost;
const char *agent;
char line[UT_LINESIZE + 1];

static int
pam_conv_func (int num_msg,
               const struct pam_message **msg,
               struct pam_response **resp,
               void *appdata_ptr)
{
  return PAM_CONV_ERR;
}

static void
check (int r)
{
  if (r != PAM_SUCCESS)
    errx (1, "%s", pam_strerror (NULL, r));
}

static void
usage (void)
{
  fprintf (stderr, "Usage: cockpit-session USER REMOTE-HOST AGENT\n");
  exit (1);
}

static void
utmp_log (int login)
{
  struct utmp ut;
  struct timeval tv;

  int pid = getpid ();
  const char *id = line + strlen (line) - sizeof(ut.ut_id);

  utmpname (_PATH_UTMP);
  setutent ();

  memset (&ut, 0, sizeof(ut));

  strncpy (ut.ut_id, id, sizeof (ut.ut_id));
  ut.ut_id[sizeof (ut.ut_id) - 1] = 0;
  strncpy (ut.ut_line, line, sizeof (ut.ut_line));
  ut.ut_line[sizeof (ut.ut_line) - 1] = 0;

  if (login)
    {
      strncpy (ut.ut_user, user, sizeof(ut.ut_user));
      ut.ut_user[sizeof (ut.ut_user) - 1] = 0;
      strncpy (ut.ut_host, rhost, sizeof(ut.ut_host));
      ut.ut_host[sizeof (ut.ut_host) - 1] = 0;
    }

  gettimeofday (&tv, NULL);
  ut.ut_tv.tv_sec = tv.tv_sec;
  ut.ut_tv.tv_usec = tv.tv_usec;

  ut.ut_type = login ? USER_PROCESS : DEAD_PROCESS;
  ut.ut_pid = pid;

  pututline (&ut);
  endutent ();

  updwtmp (_PATH_WTMP, &ut);
}

static pid_t child;

static int
fork_session (void (*func) (void))
{
  int status;
  struct passwd *pw = getpwnam (user);
  if (pw == NULL)
    {
      warn ("can't get uid");
      return 1 << 8;
    }

  fflush (stderr);

  child = fork ();
  if (child < 0)
    {
      warn ("can't fork");
      return 1 << 8;
    }

  if (child == 0)
    {
      signal (SIGTERM, SIG_DFL);

      if (setgid (pw->pw_gid) < 0)
        {
          warn ("setgid() failed");
          _exit (42);
        }

      if (setuid (pw->pw_uid) < 0)
        {
          warn ("setuid() failed");
          _exit (42);
        }

      if (getuid() != geteuid() &&
          getgid() != getegid())
        {
          warnx ("couldn't drop privileges");
          _exit (42);
        }

      func ();
      _exit (0);
    }

  close (0);
  close (1);
  waitpid (child, &status, 0);
  return status;
}

static void
session (void)
{
  execl (agent, agent, NULL);
  warn ("can't exec %s", agent);
}

static void
pass_to_child (int signo)
{
  kill (child, signo);
}

int
main (int argc,
      char **argv)
{
  struct pam_conv conv;
  pam_handle_t *pamh = NULL;
  struct passwd *pw;
  int status;

  if (argc != 4)
    usage ();

  user = argv[1];
  rhost = argv[2];
  agent = argv[3];

  snprintf (line, UT_LINESIZE, "cockpit-%d", getpid ());
  line[UT_LINESIZE] = '\0';

  conv.conv = pam_conv_func;

  signal (SIGALRM, SIG_DFL);
  signal (SIGQUIT, SIG_DFL);
  signal (SIGTSTP, SIG_IGN);
  signal (SIGTERM, pass_to_child);
  signal (SIGINT, SIG_IGN);
  signal (SIGHUP, SIG_IGN);

  pw = getpwnam (user);
  if (pw == NULL)
    errx (1, "invalid user: %s", user);

  if (initgroups (user, pw->pw_gid) < 0)
    err (1, "can't init groups");

  check (pam_start ("cockpit", user, &conv, &pamh));
  check (pam_set_item (pamh, PAM_RHOST, rhost));
  check (pam_set_item (pamh, PAM_TTY, line));
  check (pam_setcred (pamh, PAM_ESTABLISH_CRED));
  check (pam_open_session (pamh, 0));
  check (pam_setcred (pamh, PAM_REINITIALIZE_CRED));

  utmp_log (1);

  status = fork_session (session);

  utmp_log (0);

  check (pam_setcred (pamh, PAM_DELETE_CRED));
  check (pam_close_session (pamh, 0));

  if (pamh)
    pam_end (pamh, PAM_SUCCESS);

  signal (SIGTERM, SIG_DFL);

  if (WIFEXITED(status))
    exit (WEXITSTATUS(status));
  else if (WIFSIGNALED(status))
    raise (WTERMSIG(status));
  else
    exit (127);
}
