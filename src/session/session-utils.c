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

#include "common/cockpitcloserange.h"
#include "common/cockpitframe.h"
#include "common/cockpitjsonprint.h"

#include <fcntl.h>
#include <stdarg.h>
#include <stdlib.h>
#include <sys/param.h>
#include <time.h>
#include <utmp.h>

#ifndef _PATH_BTMP
#define _PATH_BTMP "/var/log/btmp"
#endif

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
  cockpit_json_print_string_property (authf, field, str, -1);
}

void
write_control_bool (const char *field,
                    bool        val)
{
  cockpit_json_print_bool_property (authf, field, val);
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
  if (!authf)
    err (EX, "failed to open_memstream()");
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


static bool
do_lastlog (uid_t                 uid,
            const struct timeval *now,
            const char           *rhost,
            time_t               *out_last_login,
            FILE                 *messages)
{
  struct lastlog entry;
  bool result = false;
  int fd = -1;
  ssize_t r;

  fd = open (_PATH_LASTLOG, O_RDWR);
  if (fd == -1)
    {
      warn ("failed to open %s", _PATH_LASTLOG);
      goto out;
    }

  r = pread (fd, &entry, sizeof entry, uid * sizeof entry);
  if (r == sizeof entry && entry.ll_time != 0)
    {
      /* got an entry for the user */

      /* the ll_host and ll_line fields can be nul-terminated, but they
       * can also extend to the full length of the field without
       * nul-termination.  use the maxlen parameter to help with that.
       */
      if (!cockpit_json_print_integer_property (messages, "last-login-time", entry.ll_time) ||
          !cockpit_json_print_string_property (messages, "last-login-host", entry.ll_host, UT_HOSTSIZE) ||
          !cockpit_json_print_string_property (messages, "last-login-line", entry.ll_line, UT_LINESIZE))
        {
          warnx ("failed to print last-login details to messages memfd");
          goto out;
        }

      if (out_last_login)
        *out_last_login = entry.ll_time;
    }
  else if (r == sizeof entry)
    {
      /* read the entry, but it's nul.  user never logged in. */
      *out_last_login = 0;
    }
  else if (r == 0)
    {
      /* no such entry in file: never logged in? */
      *out_last_login = 0;
    }
  else if (r < 0)
    {
      /* error */
      warn ("failed to pread() %s for uid %u", _PATH_LASTLOG, (unsigned) uid);
      goto out;
    }
  else
    {
      /* some other size (incomplete read) */
      warnx ("incomplete pread() %s for uid %u: %zu of %zu bytes",
             _PATH_LASTLOG, (unsigned) uid, r, sizeof entry);
      goto out;
    }

  /* XXX: We'd really like to use strncpy() here, which is perfectly
   * designed for what we need to do: copy a string up to N characters
   * into a fixed width field, adding nul bytes if the string is shorter
   * than N.
   *
   * Unfortunately, when you use it in this way, GCC is convinced that
   * you don't know what you're doing and gives a warning that's very
   * difficult to get rid of.  We tried using #pragma here before, but
   * after several attempts, it was difficult to get the
   * conditionalising (for the compiler version) correct.
   *
   * Let's just nul out the struct and use memcpy().  Sigh.
   *
   *  strncpy (entry.ll_host, rhost, sizeof entry.ll_host);
   *  strncpy (entry.ll_line, "web console", sizeof entry.ll_line);
   *
   * See also https://gcc.gnu.org/bugzilla/show_bug.cgi?id=94615
   * See also https://sourceware.org/bugzilla/show_bug.cgi?id=25844
   */
  memset (&entry, 0, sizeof entry);
  memcpy (entry.ll_host, rhost, MIN (strlen (rhost), sizeof entry.ll_host));
  const char * const line = "web console";
  memcpy (entry.ll_line, line, MIN (strlen (line), sizeof entry.ll_line));

  entry.ll_time = now->tv_sec;

  r = pwrite (fd, &entry, sizeof entry, uid * sizeof entry);
  if (r == -1)
    {
      /* error */
      warn ("failed to pwrite() %s for uid %u", _PATH_LASTLOG, (unsigned) uid);
      goto out;
    }
  else if (r != sizeof entry)
    {
      /* incomplete write */
      warnx ("incomplete pwrite() %s for uid %u: %zu or %zu bytes",
             _PATH_LASTLOG, (unsigned) uid, r, sizeof entry);
      goto out;
    }

  result = true;

out:
  if (fd != -1)
    close (fd);

  return result;
}

static bool
scan_btmp (const char *username,
           time_t      last_success,
           FILE       *messages)
{
  bool success = false;
  int fail_count = 0;
  struct utmp last;
  int fd;

  fd = open (_PATH_BTMP, O_RDONLY | O_CLOEXEC);
  if (fd == -1)
    {
      if (errno == ENOENT)
        {
          /* no btmp → no failed attempts */
          success = true;
          goto out;
        }

      warn ("open(%s) failed", _PATH_BTMP);
      goto out;
    }

  while (true)
    {
      struct utmp entry;
      ssize_t r;

      do
        r = read (fd, &entry, sizeof entry);
      while (r == -1 && errno != EINTR);

      if (r == 0)
        break;

      if (r < 0)
        {
          warn ("read(%s) failed", _PATH_BTMP);
          goto out;
        }
      if (r != sizeof entry)
        {
          warnx ("read(%s) returned partial result (%zu of %zu bytes)",
                 _PATH_BTMP, r, sizeof entry);
          goto out;
        }

      if (entry.ut_tv.tv_sec > last_success &&
          strncmp (entry.ut_user, username, sizeof entry.ut_user) == 0)
        {
          last = entry;
          fail_count++;
        }
    }

  if (fail_count == 0)
    {
      success = true;
      goto out;
    }

  /* only print messages if we actually have failures */
  success = cockpit_json_print_integer_property (messages, "fail-count", fail_count) &&
            cockpit_json_print_integer_property (messages, "last-fail-time", last.ut_tv.tv_sec) &&
            cockpit_json_print_string_property (messages, "last-fail-host", last.ut_host, UT_HOSTSIZE) &&
            cockpit_json_print_string_property (messages, "last-fail-line", last.ut_line, UT_LINESIZE);

out:
  if (fd > -1)
    close (fd);

  return success;
}

void
utmp_log (int login,
          const char *rhost,
          FILE *messages)
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

  strncpy (ut.ut_line, "web console", sizeof ut.ut_line);
  ut.ut_line[sizeof ut.ut_line - 1] = 0;

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

  ut.ut_type = login ? USER_PROCESS : DEAD_PROCESS;
  ut.ut_pid = pid;

  pututline (&ut);
  endutent ();

  updwtmp (_PATH_WTMP, &ut);

  if (login)
    {
      time_t last_success;

      if (do_lastlog (pwd->pw_uid, &tv, rhost, &last_success, messages))
        scan_btmp (pwd->pw_name, last_success, messages);
    }
}

void
btmp_log (const char *username,
          const char *rhost)
{
  struct timeval tv;

  /* the `tv` in the utmp struct is not actually a `struct timeval`, so
   * we need to read into a temporary variable and then copy the fields.
   */
  gettimeofday (&tv, NULL);

  struct utmp entry = {
    .ut_line = "web console",
    .ut_pid = getpid (),
    .ut_tv.tv_sec = tv.tv_sec,
    .ut_tv.tv_usec = tv.tv_usec,
    .ut_type = LOGIN_PROCESS,
  };

  /* see utmp(5), it is ok to not null-terminate these if they have maximum size */
  /* add coverity markers for older glibcs: https://sourceware.org/bugzilla/show_bug.cgi?id=24899 */
  /* coverity[buffer_size_warning : FALSE] */
  strncpy (entry.ut_host, rhost, sizeof entry.ut_host);
  /* coverity[buffer_size_warning : FALSE] */
  strncpy (entry.ut_user, username, sizeof entry.ut_user);

  int fd = open (_PATH_BTMP, O_WRONLY | O_APPEND);
  if (fd == -1)
    {
      warn ("open(%s) failed", _PATH_BTMP);
      goto out;
    }

  ssize_t r = write (fd, &entry, sizeof entry);
  if (r < 0)
    {
      warn ("write() %s failed", _PATH_BTMP);
      goto out;
    }
  else if (r != sizeof entry)
    {
      warnx ("incomplete write() %s: %zu of %zu bytes",
             _PATH_BTMP, r, sizeof entry);
      goto out;
    }

out:
  if (fd != -1)
    close (fd);
}

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

/* signal- and after-fork()-safe function to format a string, print it
 * to stderr and abort execution.  Never returns.
 */
static noreturn void
__attribute__ ((format (printf, 1, 2)))
abort_with_message (const char *format,
                    ...)
{
  char buffer[1024];
  va_list ap;

  va_start (ap, format);
  size_t length = vsnprintf (buffer, sizeof buffer, format, ap);
  va_end (ap);

  size_t ofs = 0;
  while (ofs != length)
    {
      ssize_t r;
      do
        r = write (STDERR_FILENO, buffer + ofs, length - ofs);
      while (r == -1 && errno == EINTR);

      if (0 <= r && r <= length - ofs)
        ofs += r;
      else
        break; /* something went wrong, but we can't deal with it */
    }

  abort ();
}

/* signal- and after-fork()-safe function to remap file descriptors
 * according to a specified array.  All other file descriptors are
 * closed.
 *
 * Commonly used after fork() and before exec().
 */
static void
fd_remap (const int *remap_fds,
          int        n_remap_fds)
{
  if (n_remap_fds < 0 || n_remap_fds > 1024)
    abort_with_message ("requested to fd_remap() too many fds!");

  int *fds = alloca (sizeof (int) * n_remap_fds);
  memcpy (fds, remap_fds, sizeof (int) * n_remap_fds);

  /* we need to get all of the remap-fds to be numerically above
   * n_remap_fds in order to make sure that we don't overwrite them in
   * the middle of the dup2() loop below, and also avoid the case that
   * dup2() is a no-op (which could fail to clear the O_CLOEXEC flag,
   * for example).
   */
  for (int i = 0; i < n_remap_fds; i++)
    if (fds[i] != -1 && fds[i] < n_remap_fds)
        {
          int new_fd = fcntl (fds[i], F_DUPFD, n_remap_fds); /* returns >= n_remap_fds */

          if (new_fd == -1)
            abort_with_message ("fcntl(%d, F_DUPFD) failed: %m", fds[i]);

          fds[i] = new_fd;
        }

  /* now we can map the fds into their final spot */
  for (int i = 0; i < n_remap_fds; i++)
    if (fds[i] != -1) /* no-op */
      if (dup2 (fds[i], i) != i)
        abort_with_message ("dup2(%d, %d) failed: %m", fds[i], i);

  /* close everything else */
  if (cockpit_close_range (n_remap_fds, INT_MAX, 0) < 0)
    abort_with_message ("couldn't close all file descriptors");
}

int
spawn_and_wait (const char **argv, const char **envp,
                const int *remap_fds, int n_remap_fds,
                uid_t uid, gid_t gid)
{
  pid_t child;

  child = fork ();
  if (child == -1)
    abort_with_message ("cockpit-session: fork() failed: %m");

  if (child == 0)
    {
      /* This is the child process.  Do preparation, and exec(). */
      if (setresgid (gid, gid, gid) != 0)
        abort_with_message ("setresgid: couldn't set gid to %u: %m\n", (int) gid);

      if (setresuid (uid, uid, uid) != 0)
        abort_with_message ("setresgid: couldn't set uid to %u: %m\n", (int) gid);

      /* paranoid */
      {
        uid_t real, effective, saved;
        int r;

        r = getresuid (&real, &effective, &saved);
        assert (r == 0 && real == uid && effective == uid && saved == uid);
      }

      {
        gid_t real, effective, saved;
        int r;

        r = getresgid (&real, &effective, &saved);
        assert (r == 0 && real == gid && effective == gid && saved == gid);
      }

      if (n_remap_fds != -1)
        fd_remap (remap_fds, n_remap_fds);

      execvpe (argv[0], (char **) argv, (char **) envp);
      _exit(127);
    }

  else
    {
      /* This is the parent process.  Wait for the child to exit. */
      int wstatus;
      int r;

      do
        r = waitpid (child, &wstatus, 0);
      while (r == -1 && errno == EINTR);

      if (r == -1)
        abort_with_message ("waitpid(%d) on cockpit-bridge process failed: %m", (int) child);

      /* 0 can only be returned of WNOHANG was given */
      assert (r == child);

      return wstatus;
    }
}

bool
user_has_valid_login_shell (const char **envp)
{
  /* <lis> >>> random.randint(0,127)
   * <lis> 71
   * <pitti> https://xkcd.com/221/
   */
  const char *argv[] = { pwd->pw_shell, "-c", "exit 71;", NULL };
  const int remap_fds[] = { -1, 2, -1 }; /* send stdout to stderr */
  int wstatus;

  wstatus = spawn_and_wait (argv, envp, remap_fds, 3, pwd->pw_uid, pwd->pw_gid);
  return WIFEXITED(wstatus) && WEXITSTATUS(wstatus) == 71;
}
