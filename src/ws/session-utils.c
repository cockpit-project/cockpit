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
#include <dirent.h>
#include <fcntl.h>
#include <inttypes.h>
#include <sched.h>
#include <stdarg.h>
#include <stdlib.h>
#include <stdnoreturn.h>
#include <sys/mman.h>
#include <sys/param.h>
#include <sys/resource.h>
#include <sys/wait.h>
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


static bool
char_needs_json_escape (char c)
{
  return c < ' ' || c == '\\' || c == '"';
}

static bool
json_escape_char (FILE *stream,
                  char c)
{
  if (c == '\\')
    return fputs ("\\\\", stream) >= 0;
  else if (c == '"')
    return fputs ("\\\"", stream) >= 0;
  else
    return fprintf (stream, "\\u%04x", c) == 6;
}

static bool
json_escape_string (FILE       *stream,
                    const char *str,
                    size_t      maxlen)
{
  size_t offset = 0;

  while (offset < maxlen && str[offset])
    {
      size_t start = offset;

      while (offset < maxlen && str[offset] && !char_needs_json_escape (str[offset]))
        offset++;

      /* print the non-escaped prefix, if there is one */
      if (offset != start)
        {
          size_t length = offset - start;
          if (fwrite (str + start, 1, length, stream) != length)
            return false;
        }

      /* print the escaped character, if there is one */
      if (offset < maxlen && str[offset])
        {
          if (!json_escape_char (stream, str[offset]))
            return false;

          offset++;
        }
    }

  return true;
}

bool
json_print_string_property (FILE       *stream,
                            const char *key,
                            const char *value,
                            ssize_t     maxlen)
{
  size_t expected = strlen (key) + 7;

  return fprintf (stream, ", \"%s\": \"", key) == expected &&
         json_escape_string (stream, value, maxlen) &&
         fputc ('"', stream) >= 0;
}

bool
json_print_bool_property (FILE       *stream,
                          const char *key,
                          bool        value)
{
  size_t expected = 6 + strlen (key) + (value ? 4 : 5); /* "true" or "false" */

  return fprintf (stream, ", \"%s\": %s", key, value ? "true" : "false") == expected;
}

bool
json_print_integer_property (FILE       *stream,
                             const char *key,
                             uint64_t    value)
{
  /* too much effort to figure out the expected length exactly */
  return fprintf (stream, ", \"%s\": %"PRIu64, key, value) > 6;
}

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
  json_print_string_property (authf, field, str, -1);
}

void
write_control_bool (const char *field,
                    bool        val)
{
  json_print_bool_property (authf, field, val);
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

      _exit (session (env));
    }

  close (0);
  close (1);
  waitpid (child, &status, 0);
  return status;
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
      if (!json_print_integer_property (messages, "last-login-time", entry.ll_time) ||
          !json_print_string_property (messages, "last-login-host", entry.ll_host, UT_HOSTSIZE) ||
          !json_print_string_property (messages, "last-login-line", entry.ll_line, UT_LINESIZE))
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
  success = json_print_integer_property (messages, "fail-count", fail_count) &&
            json_print_integer_property (messages, "last-fail-time", last.ut_tv.tv_sec) &&
            json_print_string_property (messages, "last-fail-host", last.ut_host, UT_HOSTSIZE) &&
            json_print_string_property (messages, "last-fail-line", last.ut_line, UT_LINESIZE);

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

  strncpy (entry.ut_host, rhost, sizeof entry.ut_host);
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

FILE *
open_memfd (const char *name)
{
  int fd = memfd_create ("cockpit login messages", MFD_ALLOW_SEALING);

  if (fd == -1)
    return NULL;

  return fdopen (fd, "w");
}

bool
seal_memfd (FILE *memfd)
{
  if (fflush (memfd) != 0)
    return false;

  const int seals = F_SEAL_SHRINK | F_SEAL_GROW | F_SEAL_WRITE;
  return fcntl (fileno (memfd), F_ADD_SEALS, seals) == 0;
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
void
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
  if (fdwalk (closefd, &n_remap_fds) < 0)
    abort_with_message ("couldn't close all file descriptors");
}
