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

#define _GNU_SOURCE

#include <assert.h>
#include <err.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <security/pam_appl.h>
#include <sys/signal.h>
#include <sys/resource.h>
#include <dirent.h>
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

#define DEBUG_SESSION 0
#define EX 127

const char *user;
const char *rhost;
const char *agent;
char line[UT_LINESIZE + 1];
static pid_t child;
static char **env = NULL;

#if DEBUG_SESSION
#define debug(fmt, ...) (fprintf (stderr, "cockpit-session: " fmt "\n", ##__VA_ARGS__))
#else
#define debug(...)
#endif

static char *
read_until_eof (int fd)
{
  size_t len = 0;
  size_t alloc = 0;
  char *buf = NULL;
  int r;

  for (;;)
    {
      if (alloc <= len)
        {
          alloc += 1024;
          buf = realloc (buf, alloc);
          if (!buf)
            errx (EX, "couldn't allocate memory for password");
        }

      r = read (fd, buf + len, alloc - len);
      if (r < 0)
        {
          if (errno == EAGAIN)
            continue;
          err (EX, "couldn't read password from cockpit-ws");
        }
      else if (r == 0)
        {
          break;
        }
      else
        {
          len += r;
        }
    }

  buf[len] = '\0';
  return buf;
}

static void
write_json_string (FILE *file,
                   const char *str)
{
  const unsigned char *at;
  char buf[8];

  fputc_unlocked ('\"', file);
  for (at = (const unsigned char *)str; *at; at++)
    {
      if (*at == '\\' || *at == '\"' || *at < 0x1f)
        {
          snprintf (buf, sizeof (buf), "\\u%04x", (int)*at);
          fputs_unlocked (buf, file);
        }
      else
        {
          fputc_unlocked (*at, file);
        }
    }
  fputc_unlocked ('\"', file);
}

static void
write_pam_result (int fd,
                  int pam_result,
                  const char *user)
{
  FILE *file;

  file = fdopen (fd, "w");
  if (!file)
    err (EX, "couldn't write result to cockpit-ws");

  /*
   * The use of JSON here is not coincidental. It allows the cockpit-ws
   * to detect whether it received the entire result or not. Partial
   * JSON objects do not parse.
   *
   * In addition this is not a cross platform message. We are sending
   * to cockpit-ws running on the same machine. PAM codes will be
   * identical and should all be understood by cockpit-ws.
   */

  fprintf (file, "{ \"pam-result\": %d", pam_result);
  if (user)
    {
      fprintf (file, ", \"user\": ");
      write_json_string (file, user);
    }
  fprintf (file, " }\n");

  if (ferror (file) || fclose (file) != 0)
    err (EX, "couldn't write result to cockpit-ws");

  debug ("wrote pam result %d/%s to cockpit-ws", pam_result, user);
}

static int
pam_conv_func (int num_msg,
               const struct pam_message **msg,
               struct pam_response **ret_resp,
               void *appdata_ptr)
{
  char **passwd = (char **)appdata_ptr;
  struct pam_response *resp;
  int success = 1;
  int i;

  resp = calloc (sizeof (struct pam_response), num_msg);
  if (resp == NULL)
    {
      warnx ("couldn't allocate memory for pam response");
      return PAM_BUF_ERR;
    }

  for (i = 0; i < num_msg; i++)
    {
      if (msg[i]->msg_style == PAM_PROMPT_ECHO_OFF)
        {
          if (*passwd == NULL)
            {
              warnx ("pam asked us for more than one password");
              success = 0;
            }
          else
            {
              debug ("answered pam passwd prompt");
              resp[i].resp = *passwd;
              resp[i].resp_retcode = 0;
              *passwd = NULL;
            }
        }
      else if (msg[i]->msg_style == PAM_ERROR_MSG ||
               msg[i]->msg_style == PAM_TEXT_INFO)
        {
          warnx ("pam: %s", msg[i]->msg);
        }
      else
        {
          warnx ("pam asked us for an unspported info: %s", msg[i]->msg);
          success = 0;
        }
    }

  if (!success)
    {
      for (i = 0; i < num_msg; i++)
        free (resp[i].resp);
      free (resp);
      return PAM_CONV_ERR;
    }

  *ret_resp = resp;
  return PAM_SUCCESS;
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
  fprintf (stderr, "usage: cockpit-session [-p FD] USER REMOTE-HOST AGENT\n");
  exit (2);
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

static int
closefd (void *data,
         int fd)
{
  int *from = data;
  if (fd >= *from)
    {
      while (close (fd) < 0)
        {
          if (errno == EAGAIN || errno == EINTR)
            continue;
          if (errno == EBADF || errno == EINVAL)
            break;
          warnx ("couldn't close fd in agent process: %m");
          return -1;
        }
    }

  return 0;
}

#ifndef HAVE_FDWALK

static int
fdwalk (int (*cb)(void *data, int fd),
        void *data)
{
  int open_max;
  int fd;
  int res = 0;

  struct rlimit rl;

#ifdef __linux__
  DIR *d;

  if ((d = opendir ("/proc/self/fd"))) {
      struct dirent *de;

      while ((de = readdir (d))) {
          long l;
          char *e = NULL;

          if (de->d_name[0] == '.')
              continue;

          errno = 0;
          l = strtol (de->d_name, &e, 10);
          if (errno != 0 || !e || *e)
              continue;

          fd = (int) l;

          if ((long) fd != l)
              continue;

          if (fd == dirfd (d))
              continue;

          if ((res = cb (data, fd)) != 0)
              break;
        }

      closedir (d);
      return res;
  }

  /* If /proc is not mounted or not accessible we fall back to the old
   * rlimit trick */

#endif

  if (getrlimit (RLIMIT_NOFILE, &rl) == 0 && rl.rlim_max != RLIM_INFINITY)
      open_max = rl.rlim_max;
  else
      open_max = sysconf (_SC_OPEN_MAX);

  for (fd = 0; fd < open_max; fd++)
      if ((res = cb (data, fd)) != 0)
          break;

  return res;
}

#endif /* HAVE_FDWALK */

static int
fork_session (struct passwd *pw,
              int (*func) (void))
{
  int status;
  int from;

  fflush (stderr);

  child = fork ();
  if (child < 0)
    {
      warn ("can't fork");
      return 1 << 8;
    }

  if (child == 0)
    {
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

      debug ("dropped privileges");

      from = 3;
      if (fdwalk (closefd, &from) < 0)
        {
          warnx ("couldn't close all file descirptors");
          _exit (42);
        }

      _exit (func ());
    }

  close (0);
  close (1);
  waitpid (child, &status, 0);
  return status;
}

static int
session (void)
{
  char *argv[] = { (char *)agent, NULL };
  debug ("executing agent: %s", agent);
  if (env)
    execve (argv[0], argv, env);
  else
    execv (argv[0], argv);
  warn ("can't exec %s", agent);
  return 127;
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
  pam_handle_t *pamh = NULL;
  struct pam_conv conv = { pam_conv_func, };
  const char *pam_user = NULL;
  int want_session;
  char *password = NULL;
  struct passwd *pw;
  char login[256];
  int pwfd = 0;
  int status;
  int opt;
  int res;

  while ((opt = getopt (argc, argv, "p:")) != -1)
    {
      switch (opt)
        {
        case 'p':
          pwfd = atoi (optarg);
          if (pwfd == 0)
            errx (2, "invalid password fd: %s\n", optarg);
          break;
        default:
          usage ();
          break;
        }
    }

  argc -= optind;
  argv += optind;

  if (argc != 3)
    usage ();

  user = argv[0];
  rhost = argv[1];
  agent = argv[2];

  signal (SIGALRM, SIG_DFL);
  signal (SIGQUIT, SIG_DFL);
  signal (SIGTSTP, SIG_IGN);
  signal (SIGHUP, SIG_IGN);
  signal (SIGPIPE, SIG_IGN);

  snprintf (line, UT_LINESIZE, "cockpit-%d", getpid ());
  line[UT_LINESIZE] = '\0';

  if (pwfd)
    {
      debug ("reading password from cockpit-ws");
      password = read_until_eof (pwfd);
      conv.appdata_ptr = &password;
    }

  check (pam_start ("cockpit", user, &conv, &pamh));
  check (pam_set_item (pamh, PAM_RHOST, rhost));

  if (pwfd)
    {
      debug ("authenticating %s", user);
      res = pam_authenticate (pamh, 0);
      if (res != PAM_SUCCESS)
        {
          write_pam_result (pwfd, res, NULL);
          exit (5); /* auth failure */
        }
    }

  check (pam_get_item (pamh, PAM_USER, (const void **)&pam_user));
  debug ("user from pam is %s", user);

  /*
   * If we're already in the right session, then skip cockpit-session.
   * This is used when testing, or running as your own user.
   *
   * This doesn't apply if this code is running as a service, or otherwise
   * unassociated from a terminal, we get a non-zero return value from
   * getlogin_r() in that case.
   */
  want_session = (getlogin_r (login, sizeof (login)) != 0 ||
                  strcmp (login, pam_user) != 0);

  if (want_session)
    {
      debug ("checking access for %s", user);
      check (pam_acct_mgmt (pamh, 0));

      debug ("opening pam session for %s", user);
      check (pam_set_item (pamh, PAM_TTY, line));
      check (pam_setcred (pamh, PAM_ESTABLISH_CRED));
      check (pam_open_session (pamh, 0));
      check (pam_setcred (pamh, PAM_REINITIALIZE_CRED));
    }

  if (pwfd)
    {
      write_pam_result (pwfd, res, pam_user);
    }

  if (password)
    {
      memset (password, 0, strlen (password));
      free (password);
    }

  if (want_session)
    {
      env = pam_getenvlist (pamh);
      if (env == NULL)
        errx (1, "get pam environment failed");

      pw = getpwnam (user);
      if (pw == NULL)
        errx (1, "invalid user: %s", user);

      if (initgroups (user, pw->pw_gid) < 0)
        err (1, "can't init groups");

      signal (SIGTERM, pass_to_child);
      signal (SIGINT, pass_to_child);
      signal (SIGQUIT, pass_to_child);

      utmp_log (1);

      status = fork_session (pw, session);

      utmp_log (0);

      signal (SIGTERM, SIG_DFL);
      signal (SIGINT, SIG_DFL);
      signal (SIGQUIT, SIG_DFL);

      check (pam_setcred (pamh, PAM_DELETE_CRED));
      check (pam_close_session (pamh, 0));
    }
  else
    {
      status = session ();
    }

  pam_end (pamh, PAM_SUCCESS);


  if (WIFEXITED(status))
    exit (WEXITSTATUS(status));
  else if (WIFSIGNALED(status))
    raise (WTERMSIG(status));
  else
    exit (127);
}
