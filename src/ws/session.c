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
#include <fcntl.h>
#include <stdio.h>
#include <stdarg.h>
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
#define AUTH_FD 3
#define EX 127

const char *user;
const char *rhost;
char line[UT_LINESIZE + 1];
static pid_t child;
static char **env;
static int want_session = 1;

#if DEBUG_SESSION
#define debug(fmt, ...) (fprintf (stderr, "cockpit-session: " fmt "\n", ##__VA_ARGS__))
#else
#define debug(...)
#endif

static char *
read_auth_until_eof (void)
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

      r = read (AUTH_FD, buf + len, alloc - len);
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
write_auth_result (int result_code,
                   const char *user)
{
  FILE *file;

  file = fdopen (AUTH_FD, "w");
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

  fprintf (file, "{ \"result-code\": %d", result_code);
  if (user)
    {
      fprintf (file, ", \"user\": ");
      write_json_string (file, user);
    }
  fprintf (file, " }\n");

  if (ferror (file) || fclose (file) != 0)
    err (EX, "couldn't write result to cockpit-ws");

  debug ("wrote result %d/%s to cockpit-ws", result_code, user);
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
          warnx ("pam asked us for an unsupported info: %s", msg[i]->msg);
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

static int
open_session (pam_handle_t *pamh,
              const char *user)
{
  char login[256];
  int res;

  /*
   * If we're already in the right session, then skip cockpit-session.
   * This is used when testing, or running as your own user.
   *
   * This doesn't apply if this code is running as a service, or otherwise
   * unassociated from a terminal, we get a non-zero return value from
   * getlogin_r() in that case.
   */

  want_session = (getlogin_r (login, sizeof (login)) != 0 ||
                  strcmp (login, user) != 0);

  if (want_session)
    {
      debug ("checking access for %s", user);
      res = pam_acct_mgmt (pamh, 0);
      if (res != PAM_SUCCESS)
        {
          warnx ("user account access failed: %s: %s", user, pam_strerror (pamh, res));
          return res;
        }

      debug ("opening pam session for %s", user);

      res = pam_set_item (pamh, PAM_TTY, line);
      if (res != PAM_SUCCESS)
        {
          warnx ("couldn't set tty: %s", pam_strerror (pamh, res));
          return res;
        }

      res = pam_setcred (pamh, PAM_ESTABLISH_CRED);
      if (res != PAM_SUCCESS)
        {
          warnx ("establishing credentials failed: %s: %s", user, pam_strerror (pamh, res));
          return res;
        }

      res = pam_open_session (pamh, 0);
      if (res != PAM_SUCCESS)
        {
          warnx ("couldn't open session: %s: %s", user, pam_strerror (pamh, res));
          return res;
        }

      res = pam_setcred (pamh, PAM_REINITIALIZE_CRED);
      if (res != PAM_SUCCESS)
        {
          warnx ("reinitializing credentials failed: %s: %s", user, pam_strerror (pamh, res));
          return res;
        }
    }

  return PAM_SUCCESS;
}

static pam_handle_t *
perform_basic (void)
{
  struct pam_conv conv = { pam_conv_func, };
  pam_handle_t *pamh;
  char *input = NULL;
  char *password;
  int res;

  debug ("reading password from cockpit-ws");

  /* The input should be a user:password */
  input = read_auth_until_eof ();
  password = strchr (input, ':');
  if (password == NULL || strchr (password + 1, '\n'))
    {
      debug ("bad basic auth input");
      write_auth_result (PAM_AUTH_ERR, NULL);
      exit (5);
    }

  *password = '\0';
  password++;
  conv.appdata_ptr = &input;

  res = pam_start ("cockpit", input, &conv, &pamh);
  if (res != PAM_SUCCESS)
    errx (EX, "couldn't start pam: %s", pam_strerror (NULL, res));

  /* Move the password into place for use during auth */
  memmove (input, password, strlen (password) + 1);

  if (pam_set_item (pamh, PAM_RHOST, rhost) != PAM_SUCCESS ||
      pam_get_item (pamh, PAM_USER, (const void **)&user) != PAM_SUCCESS)
    errx (EX, "couldn't setup pam");

  debug ("authenticating %s", user);
  res = pam_authenticate (pamh, 0);
  if (res == PAM_SUCCESS)
    res = open_session (pamh, user);

  write_auth_result (res, user);
  if (res != PAM_SUCCESS)
    exit (5);

  if (input)
    {
      memset (input, 0, strlen (input));
      free (input);
    }

  return pamh;
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
  char *argv[] = { PACKAGE_LIBEXEC_DIR "/cockpit-agent", NULL };
  debug ("executing agent: %s", argv[0]);
  if (env)
    execve (argv[0], argv, env);
  else
    execv (argv[0], argv);
  warn ("can't exec %s", argv[0]);
  return 127;
}

static void
pass_to_child (int signo)
{
  kill (child, signo);
}

static void
transfer_pam_env (pam_handle_t *pamh,
                  ...)
{
  const char *name;
  const char *value;
  char *nameval;
  va_list va;

  va_start (va, pamh);
  for (;;)
    {
      name = va_arg (va, const char *);
      if (!name)
        break;
      value = getenv (name);
      if (value)
        {
          if (asprintf (&nameval, "%s=%s", name, value) < 0)
            errx (42, "couldn't allocate environment");
          pam_putenv (pamh, nameval);
        }
    }
  va_end (va);
}

int
main (int argc,
      char **argv)
{
  pam_handle_t *pamh = NULL;
  struct passwd *pw;
  const char *auth;
  int status;
  int flags;
  int res;

  if (isatty (0))
    errx (2, "this command is not meant to be run from the console");

  if (argc != 3)
    errx (2, "invalid arguments to cockpit-session");

  /* When setuid root, make sure our group is also root */
  if (geteuid () == 0)
    {
      /* Never trust the environment when running setuid() */
      if (getuid() != 0)
        {
          if (clearenv () != 0)
            err (1, "couldn't clear environment");

          /* set a minimal environment */
          setenv ("PATH", "/usr/sbin:/usr/bin:/sbin:/bin", 1);
        }

      if (setgid (0) != 0 || setuid (0) != 0)
        err (1, "couldn't switch permissions correctly");
    }

  /* We should never leak our auth fd to other processes */
  flags = fcntl (AUTH_FD, F_GETFD);
  if (flags < 0 || fcntl (AUTH_FD, F_SETFD, flags | FD_CLOEXEC))
    err (1, "couldn't set auth fd flags");

  auth = argv[1];
  rhost = argv[2];

  signal (SIGALRM, SIG_DFL);
  signal (SIGQUIT, SIG_DFL);
  signal (SIGTSTP, SIG_IGN);
  signal (SIGHUP, SIG_IGN);
  signal (SIGPIPE, SIG_IGN);

  snprintf (line, UT_LINESIZE, "cockpit-%d", getpid ());
  line[UT_LINESIZE] = '\0';

  if (strcmp (auth, "basic") == 0)
    pamh = perform_basic ();
  else
    errx (2, "unrecognized authentication method: %s", auth);

  if (want_session)
    {
      /* Let the G_MESSAGES_DEBUG leak through from parent as a default */
      transfer_pam_env (pamh, "G_DEBUG", "G_MESSAGES_DEBUG", NULL);

      env = pam_getenvlist (pamh);
      if (env == NULL)
        errx (EX, "get pam environment failed");

      pw = getpwnam (user);
      if (pw == NULL)
        errx (EX, "%s: invalid user", user);

      if (initgroups (user, pw->pw_gid) < 0)
        err (EX, "%s: can't init groups", user);

      signal (SIGTERM, pass_to_child);
      signal (SIGINT, pass_to_child);
      signal (SIGQUIT, pass_to_child);

      utmp_log (1);

      status = fork_session (pw, session);

      utmp_log (0);

      signal (SIGTERM, SIG_DFL);
      signal (SIGINT, SIG_DFL);
      signal (SIGQUIT, SIG_DFL);

      res = pam_setcred (pamh, PAM_DELETE_CRED);
      if (res != PAM_SUCCESS)
        err (EX, "%s: couldn't delete creds: %s", user, pam_strerror (pamh, res));
      res = pam_close_session (pamh, 0);
      if (res != PAM_SUCCESS)
        err (EX, "%s: couldn't close session: %s", user, pam_strerror (pamh, res));
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
