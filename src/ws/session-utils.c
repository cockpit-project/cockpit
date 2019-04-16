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

#include "session-utils.h"

#include "common/cockpitframe.h"

#include <ctype.h>
#include <fcntl.h>
#include <stdarg.h>
#include <stdlib.h>

#include <sys/resource.h>
#include <sys/wait.h>

#include <dirent.h>
#include <sched.h>
#include <utmp.h>
#include <time.h>

const char *program_name;
struct passwd *pwd;
pid_t child;
int want_session = 1;
char *last_err_msg = NULL;

static char *auth_prefix = NULL;
static size_t auth_prefix_size = 0;
static char *auth_msg = NULL;
static size_t auth_msg_size = 0;
static FILE *authf = NULL;


char *
read_authorize_response (const char *what)
{
  const char *auth_response = ",\"response\":\"";
  size_t auth_response_size = 13;
  const char *auth_suffix = "\"}";
  size_t auth_suffix_size = 2;
  unsigned char *message;
  ssize_t len;

  debug ("reading %s authorize message", what);

  len = cockpit_frame_read (STDIN_FILENO, &message);
  if (len < 0)
    err (EX, "couldn't read %s", what);

  /*
   * The authorize messages we receive always have an exact prefix and suffix:
   *
   * \n{"command":"authorize","cookie":"NNN","response":"...."}
   */
  if (len <= auth_prefix_size + auth_response_size + auth_suffix_size ||
      memcmp (message, auth_prefix, auth_prefix_size) != 0 ||
      memcmp (message + auth_prefix_size, auth_response, auth_response_size) != 0 ||
      memcmp (message + (len - auth_suffix_size), auth_suffix, auth_suffix_size) != 0)
    {
      errx (EX, "didn't receive expected \"authorize\" message");
    }

  len -= auth_prefix_size + auth_response_size + auth_suffix_size;
  memmove (message, message + auth_prefix_size + auth_response_size, len);
  message[len] = '\0';
  return (char *)message;
}

void
write_control_string (const char *field,
                      const char *str)
{
  const unsigned char *at;
  char buf[8];

  if (!str)
    return;

  debug ("writing %s %s", field, str);
  fprintf (authf, ",\"%s\":\"", field);
  for (at = (const unsigned char *)str; *at; at++)
    {
      if (*at == '\\' || *at == '\"' || *at < 0x1f)
        {
          snprintf (buf, sizeof (buf), "\\u%04x", (int)*at);
          fputs_unlocked (buf, authf);
        }
      else
        {
          fputc_unlocked (*at, authf);
        }
    }
  fputc_unlocked ('\"', authf);
}

void
write_control_bool (const char *field,
                      int val)
{
  const char *str = val ? "true" : "false";
  debug ("writing %s %s", field, str);
  fprintf (authf, ",\"%s\":%s", field, str);
}

void
write_authorize_begin (void)
{
  assert (authf == NULL);
  assert (auth_msg_size == 0);
  assert (auth_msg == NULL);

  debug ("writing auth challenge");

  if (auth_prefix)
    {
      free (auth_prefix);
      auth_prefix = NULL;
    }

  if (asprintf (&auth_prefix, "\n{\"command\":\"authorize\",\"cookie\":\"session%u%u\"",
                (unsigned int)getpid(), (unsigned int)time (NULL)) < 0)
    {
      errx (EX, "out of memory allocating string");
    }
  auth_prefix_size = strlen (auth_prefix);

  authf = open_memstream (&auth_msg, &auth_msg_size);
  fprintf (authf, "%s", auth_prefix);
}

void
write_control_end (void)
{
  assert (authf != NULL);

  fprintf (authf, "}\n");
  fflush (authf);
  fclose (authf);

  assert (auth_msg_size > 0);
  assert (auth_msg != NULL);

  if (cockpit_frame_write (STDOUT_FILENO, (unsigned char *)auth_msg, auth_msg_size) < 0)
    err (EX, "couldn't write auth request");

  debug ("finished auth request");
  free (auth_msg);
  auth_msg = NULL;
  authf = NULL;
  auth_msg_size = 0;
}

void
exit_init_problem (int result_code)
{
  const char *problem = NULL;
  const char *message = NULL;
  char *payload = NULL;

  assert (result_code != PAM_SUCCESS);

  debug ("writing init problem %d", result_code);

  if (result_code == PAM_AUTH_ERR || result_code == PAM_USER_UNKNOWN)
    problem = "authentication-failed";
  else if (result_code == PAM_PERM_DENIED)
    problem = "access-denied";
  else if (result_code == PAM_AUTHINFO_UNAVAIL)
    problem = "authentication-unavailable";
  else
    problem = "internal-error";

  if (last_err_msg)
    message = last_err_msg;
  else
    message = pam_strerror (NULL, result_code);

  if (asprintf (&payload, "\n{\"command\":\"init\",\"version\":1,\"problem\":\"%s\",\"message\":\"%s\"}",
                problem, message) < 0)
    errx (EX, "couldn't allocate memory for message");

  if (cockpit_frame_write (STDOUT_FILENO, (unsigned char *)payload, strlen (payload)) < 0)
    err (EX, "couldn't write init message");

  free (payload);
  exit (5);
}

void
build_string (char **buf,
              size_t *size,
              const char *str,
              size_t len)
{
  if (*size == 0)
    return;

  if (len > *size - 1)
    len = *size - 1;

  memcpy (*buf, str, len);
  (*buf)[len] = '\0';
  *buf += len;
  *size -= len;
}

int
open_session (pam_handle_t *pamh)
{
  const char *name;
  int res;
  static struct passwd pwd_buf;
  static char pwd_string_buf[8192];
  static char home_env_buf[8192];
  int i;

  name = NULL;
  pwd = NULL;

  res = pam_get_item (pamh, PAM_USER, (const void **)&name);
  if (res != PAM_SUCCESS)
    {
      warnx ("couldn't load user from pam");
      return res;
    }

  res = getpwnam_r (name, &pwd_buf, pwd_string_buf, sizeof (pwd_string_buf), &pwd);
  if (pwd == NULL)
    {
      warnx ("couldn't load user info for: %s: %s", name,
             res == 0 ? "not found" : strerror (res));
      return PAM_SYSTEM_ERR;
    }

  /*
   * If we're already running as the right user, and have authenticated
   * then skip starting a new session. This is used when testing, or
   * running as your own user.
   */

  want_session = !(geteuid () != 0 &&
                   geteuid () == pwd->pw_uid &&
                   getuid () == pwd->pw_uid &&
                   getegid () == pwd->pw_gid &&
                   getgid () == pwd->pw_gid);

  if (want_session)
    {
      debug ("checking access for %s", name);
      res = pam_acct_mgmt (pamh, 0);
      if (res == PAM_NEW_AUTHTOK_REQD)
        {
          warnx ("user account or password has expired: %s: %s", name, pam_strerror (pamh, res));

          /*
           * Certain PAM implementations return PAM_AUTHTOK_ERR if the users input does not
           * match criteria. Let the conversation happen three times in that case.
           */
          for (i = 0; i < 3; i++) {
              res = pam_chauthtok (pamh, PAM_CHANGE_EXPIRED_AUTHTOK);
              if (res != PAM_SUCCESS)
                warnx ("unable to change expired account or password: %s: %s", name, pam_strerror (pamh, res));
              if (res != PAM_AUTHTOK_ERR)
                break;
          }
        }
      else if (res != PAM_SUCCESS)
        {
          warnx ("user account access failed: %d %s: %s", res, name, pam_strerror (pamh, res));
        }

      if (res != PAM_SUCCESS)
        {
          /* We change PAM_AUTH_ERR to PAM_PERM_DENIED so that we can
           * distinguish between failures here and in *
           * pam_authenticate.
           */
          if (res == PAM_AUTH_ERR)
            res = PAM_PERM_DENIED;

          return res;
        }

      debug ("opening pam session for %s", name);

      res = snprintf (home_env_buf, sizeof (home_env_buf), "HOME=%s", pwd->pw_dir);
      /* this really can't fail, as the buffer for the entire pwd is not larger, but make double sure */
      assert (res < sizeof (home_env_buf));

      pam_putenv (pamh, "XDG_SESSION_CLASS=user");
      pam_putenv (pamh, "XDG_SESSION_TYPE=web");
      pam_putenv (pamh, home_env_buf);

      res = pam_setcred (pamh, PAM_ESTABLISH_CRED);
      if (res != PAM_SUCCESS)
        {
          warnx ("establishing credentials failed: %s: %s", name, pam_strerror (pamh, res));
          return res;
        }

      res = pam_open_session (pamh, 0);
      if (res != PAM_SUCCESS)
        {
          warnx ("couldn't open session: %s: %s", name, pam_strerror (pamh, res));
          return res;
        }

      res = pam_setcred (pamh, PAM_REINITIALIZE_CRED);
      if (res != PAM_SUCCESS)
        {
          warnx ("reinitializing credentials failed: %s: %s", name, pam_strerror (pamh, res));
          return res;
        }
    }

  return PAM_SUCCESS;
}

int
fork_session (char **env, int (*session)(char**))
{
  int status;
  int from;

  fflush (stderr);
  assert (pwd != NULL);

  child = fork ();
  if (child < 0)
    {
      warn ("can't fork");
      return 1 << 8;
    }

  if (child == 0)
    {
      if (setgid (pwd->pw_gid) < 0)
        {
          warn ("setgid() failed");
          _exit (42);
        }

      if (setuid (pwd->pw_uid) < 0)
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

      _exit (session (env));
    }

  close (0);
  close (1);
  waitpid (child, &status, 0);
  return status;
}

void
utmp_log (int login,
          const char *rhost)
{
  char id[UT_LINESIZE + 1];
  struct utmp ut;
  struct timeval tv;
  int pid;

  pid = getpid ();

  snprintf (id, UT_LINESIZE, "%d", pid);

  assert (pwd != NULL);
  utmpname (_PATH_UTMP);
  setutent ();

  memset (&ut, 0, sizeof(ut));

  strncpy (ut.ut_id, id, sizeof (ut.ut_id));
  ut.ut_id[sizeof (ut.ut_id) - 1] = 0;
  ut.ut_line[0] = 0;

  if (login)
    {
      strncpy (ut.ut_user, pwd->pw_name, sizeof(ut.ut_user));
      ut.ut_user[sizeof (ut.ut_user) - 1] = 0;
      strncpy (ut.ut_host, rhost, sizeof(ut.ut_host));
      ut.ut_host[sizeof (ut.ut_host) - 1] = 0;
    }

  gettimeofday (&tv, NULL);
  ut.ut_tv.tv_sec = tv.tv_sec;
  ut.ut_tv.tv_usec = tv.tv_usec;

  ut.ut_type = login ? LOGIN_PROCESS : DEAD_PROCESS;
  ut.ut_pid = pid;

  pututline (&ut);
  endutent ();

  updwtmp (_PATH_WTMP, &ut);
}

int
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
          warnx ("couldn't close fd in bridge process: %m");
          return -1;
        }
    }

  return 0;
}

#ifndef HAVE_FDWALK

int
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

void
pass_to_child (int signo)
{
  if (child > 0)
    kill (child, signo);
}

/* Environment variables to transfer */
static const char *env_names[] = {
  "G_DEBUG",
  "G_MESSAGES_DEBUG",
  "G_SLICE",
  "PATH",
  "COCKPIT_REMOTE_PEER",
  NULL
};

/* Holds environment values to set in pam context */
char *env_saved[sizeof (env_names) / sizeof (env_names)[0]] = { NULL, };

void
save_environment (void)
{
  const char *value;
  int i, j;

  /* Force save our default path */
  if (!getenv ("COCKPIT_TEST_KEEP_PATH"))
    setenv ("PATH", DEFAULT_PATH, 1);

  for (i = 0, j = 0; env_names[i] != NULL; i++)
    {
      value = getenv (env_names[i]);
      if (value)
        {
          if (asprintf (env_saved + (j++), "%s=%s", env_names[i], value) < 0)
            errx (42, "couldn't allocate environment");
        }
    }

  env_saved[j] = NULL;
}

void
authorize_logger (const char *data)
{
  warnx ("%s", data);
}
