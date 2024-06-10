/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
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

/*
 * Inspired by gnome-keyring:
 *   Stef Walter <stef@memberwebs.com>
 */


#include "config.h"

#include <sys/types.h>
#include <sys/wait.h>
#include <signal.h>
#include <assert.h>
#include <err.h>
#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdarg.h>
#include <string.h>
#include <ctype.h>
#include <syslog.h>
#include <unistd.h>
#include <pwd.h>
#include <grp.h>

#include <security/pam_modules.h>
#include <security/pam_modutil.h>

#include "pam-ssh-add.h"

/* programs that can be overwidden in tests */
const char *pam_ssh_agent_program = PATH_SSH_AGENT;
const char *pam_ssh_agent_arg = NULL;

const char *pam_ssh_add_program = PATH_SSH_ADD;
const char *pam_ssh_add_arg = NULL;

static unsigned long ssh_agent_pid;
static uid_t ssh_agent_uid;

/* Environment */
#define ENVIRON_SIZE 5
#define PATH "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

/* ssh-agent output variables we care about */
static const char *agent_vars[] = {
  "SSH_AUTH_SOCK",
  "SSH_AGENT_PID",
  NULL
};

/* pre-set file descriptors */
#define  STDIN   0
#define  STDOUT  1
#define  STDERR  2

/* read & write ends of a pipe */
#define  READ_END   0
#define  WRITE_END  1

/* pre-set file descriptors */
#define  STDIN   0
#define  STDOUT  1
#define  STDERR  2

/* attribute for stored auth */
#define STORED_AUTHTOK "pam_ssh_add_authtok"

#ifndef debug
#define debug(format, ...) \
  do { if (pam_ssh_add_verbose_mode) \
      syslog (LOG_INFO | LOG_AUTHPRIV, "pam_ssh_add: " format, ##__VA_ARGS__); \
  } while (0)
#endif

#ifndef error
#define error(format, ...) \
  do { message_handler (LOG_ERR, "pam_ssh_add: " format, ##__VA_ARGS__); \
  } while (0)
#endif

#ifndef message
#define message(format, ...) \
  do { message_handler (LOG_WARNING, "pam_ssh_add: " format, ##__VA_ARGS__); \
  } while (0)
#endif

typedef int (* line_cb) (char *line, void *arg);
int pam_ssh_add_verbose_mode = 0;
pam_ssh_add_logger pam_ssh_add_log_handler = NULL;

#ifndef message_handler
#if __GNUC__ > 2
static void
message_handler (int level, const char *format, ...)
__attribute__((__format__(__printf__, 2, 3)));
#endif

static void
default_logger (int level, const char *str)
{
  if (level == LOG_INFO)
    debug ("%s", str);
  else if (level == LOG_ERR)
    syslog (LOG_ERR, "%s", str);
  else
    syslog (LOG_WARNING, "%s", str);
}

static void
message_handler (int level,
                 const char *format, ...)
{
  va_list va;
  char *data;
  int res;

  if (!pam_ssh_add_log_handler)
    pam_ssh_add_log_handler = &default_logger;

  /* Fast path for simple messages */
  if (!strchr (format, '%'))
    {
      pam_ssh_add_log_handler (level, format);
      return;
    }

  va_start (va, format);
  res = vasprintf (&data, format, va);
  va_end (va);

  if (res > 0)
    pam_ssh_add_log_handler (level, data);

  free (data);
}
#endif

static void
close_safe (int fd)
{
  if (fd != -1)
    close (fd);
}

static char *
strbtrim (char *data)
{
  assert (data);
  while (*data && isspace (*data))
    ++data;
  return (char*)data;
}

static int
foreach_line (char *lines,
              line_cb cb,
              void *arg)
{
  char *line, *ctx;
  int ret = 1;

  assert (lines);

  /* Call cb for each line in the text block */
  for (line = strtok_r (lines, "\n", &ctx); line != NULL;
       line = strtok_r (NULL, "\n", &ctx))
    {
      ret = (cb) (line, arg);
      if (!ret)
        return ret;
    }
  return ret;
}

static char *
read_string (int fd,
             int consume)
{
  /* We only accept a max of 8K */
  #define MAX_LENGTH 8192
  #define BLOCK 256

  char *ret = NULL;
  int r, len = 0;

  for (;;)
    {
      char *n = realloc (ret, len + BLOCK);
      if (!n)
        {
          free (ret);
          errno = ENOMEM;
          return NULL;
        }

      memset (n + len, 0, BLOCK);
      ret = n;

      r = read (fd, ret + len, BLOCK-1);
      if (r < 0)
        {
          if (errno == EAGAIN || errno == EINTR)
              continue;

          free (ret);
          return NULL;
        }
      else
        {
          len = len + r;
        }

      if (r == 0 || len > MAX_LENGTH || consume == 0)
        break;
    }

  return ret;
}

static int
write_string (int fd,
              const char *buf)
{
  size_t bytes = 0;
  int res, len = strlen (buf);

  while (bytes < len)
    {
      res = write (fd, buf + bytes, len - bytes);
      if (res < 0)
        {
          if (errno != EINTR && errno != EAGAIN)
            return -1;
        }
      else
        {
          bytes += res;
        }
    }

  return 0;
}

static int
log_problem (char *line,
             void *arg)
{
  /*
   * Called for each stderr output line from the daemon.
   * Send it all to the log.
   */

  int *success;

  assert (line);
  assert (arg);

  success = (int*)arg;
  if (*success)
    message ("%s", line);
  else
    error ("%s", line);

  return 1;
}

static const char *
get_optional_env (const char *name,
                  const char *override)
{
  if (override)
    return override;

  return getenv (name);
}

static int
build_environment (char **env,
                   const char *first_key, ...)
{
  int i = 0;
  int res = 0;
  const char *key = first_key;
  va_list va;

  va_start (va, first_key);

  while (key != NULL)
    {
      const char *value = va_arg (va, char*);
      if (value != NULL)
        {
          if (asprintf (env + (i++), "%s=%s", key, value) < 0)
            {
              error ("couldn't allocate environment");
              goto out;
            }
        }
      key = va_arg (va, char*);
    }
  res = 1;

out:
  va_end (va);
  return res;
}

static void
setup_child (pam_handle_t *pamh,
             const char **args,
             char **env,
             struct passwd *pwd,
             int inp[2],
             int outp[2],
             int errp[2])
{
  assert (pwd);
  assert (pwd->pw_dir);

  /* Fix up our end of the pipes */
  if (dup2 (inp[READ_END], STDIN) < 0 ||
      dup2 (outp[WRITE_END], STDOUT) < 0 ||
      dup2 (errp[WRITE_END], STDERR) < 0)
    {
      error ("couldn't setup pipes: %m");
      exit (EXIT_FAILURE);
    }

  pam_modutil_sanitize_helper_fds (pamh,
                                   PAM_MODUTIL_IGNORE_FD,
                                   PAM_MODUTIL_IGNORE_FD,
                                   PAM_MODUTIL_IGNORE_FD);

  /* Close unnecessary file descriptors */
  close (inp[READ_END]);
  close (inp[WRITE_END]);
  close (outp[READ_END]);
  close (outp[WRITE_END]);
  close (errp[READ_END]);
  close (errp[WRITE_END]);

  /* Start a new session, to detach from tty */
  if (setsid() < 0)
    {
      error ("failed to detach child process");
      exit (EXIT_FAILURE);
    }

  /* We may be running effective as another user, revert that */
  if (setegid (getgid ()) < 0 || seteuid (getuid ()) < 0)
      error ("failed to restore credentials");

  /* Setup process credentials; if we actually change the group, drop any auxiliary groups too */
  if ((getegid() != pwd->pw_gid ? initgroups(pwd->pw_name, pwd->pw_gid) < 0 : 0) ||
      setgid (pwd->pw_gid) < 0 || setuid (pwd->pw_uid) < 0 ||
      setegid (pwd->pw_gid) < 0 || seteuid (pwd->pw_uid) < 0)
    {
      error ("couldn't setup credentials: %m");
      exit (EXIT_FAILURE);
    }

  /* Now actually execute the process */
  execve (args[0], (char **) args, env);
  error ("couldn't run %s: %m", args[0]);
  _exit (EXIT_FAILURE);
}

static void
ignore_signals (struct sigaction *defsact,
                struct sigaction *oldsact,
                struct sigaction *ignpipe,
                struct sigaction *oldpipe)
{
  /*
   * Make sure that SIGCHLD occurs. Otherwise our waitpid below
   * doesn't work properly. We need to wait on the process to
   * get the daemon exit status.
   */
  memset (defsact, 0, sizeof (*defsact));
  memset (oldsact, 0, sizeof (*oldsact));
  defsact->sa_handler = SIG_DFL;
  sigaction (SIGCHLD, defsact, oldsact);

  /*
   * Make sure we don't exit with a SIGPIPE while doing this, that
   * would be very annoying to a user trying to log in.
   */
  memset (ignpipe, 0, sizeof (*ignpipe));
  memset (oldpipe, 0, sizeof (*oldpipe));
  ignpipe->sa_handler = SIG_IGN;
  sigaction (SIGPIPE, ignpipe, oldpipe);
}

static void
restore_signals (struct sigaction *oldsact,
                 struct sigaction *oldpipe)
{
  /* Restore old handler */
  sigaction (SIGCHLD, oldsact, NULL);
  sigaction (SIGPIPE, oldpipe, NULL);
}

static pid_t
run_as_user (pam_handle_t *pamh,
             const char **args,
             char **env,
             struct passwd *pwd,
             int inp[2],
             int outp[2],
             int errp[2])
{
  pid_t pid = -1;

  /* Start up daemon child process */
  switch (pid = fork ())
    {
    case -1:
      error ("couldn't fork: %m");
      goto done;

    /* This is the child */
    case 0:
      setup_child (pamh, args, env, pwd, inp, outp, errp);
      /* Should never be reached */
      break;

    /* This is the parent */
    default:
      break;
    };

done:
  return pid;
}

static int
get_environ_vars_from_agent (char *line,
                             void *arg)
{
  /*
  * ssh-agent outputs commands for exporting it's environment
  * variables. We want to return these variables so parse
  * them out and store them.
  */

  char *c = NULL;
  int i;
  int ret = 1;
  const char sep[] = "; export";

  char **ret_array = (char**)arg;

  assert (line);
  assert (arg);

  line = strbtrim (line);
  debug ("got line: %s", line);
  c = strstr (line, sep);
  if (c)
    {
      *c = '\0';
      debug ("name/value is: %s", line);
      for (i = 0; agent_vars[i] != NULL; i++)
        {
          if (strstr(line, agent_vars[i]))
            {
              if (asprintf (ret_array + (i), "%s", line) < 0)
                {
                  error ("Error allocating output variable");
                  ret = 0;
                }
              break;
            }
        }
    }

  return ret;
}

int
pam_ssh_add_load (pam_handle_t *pamh,
                  struct passwd *pwd,
                  const char *agent_socket,
                  const char *password)
{
  struct sigaction defsact, oldsact, ignpipe, oldpipe;
  int i;
  int inp[2] = { -1, -1 };
  int outp[2] = { -1, -1 };
  int errp[2] = { -1, -1 };

  char *env[ENVIRON_SIZE] = { NULL };
  const char *args[] = { "/bin/sh", "-c", "$0 $1",
                         pam_ssh_add_program,
                         pam_ssh_add_arg,
                         NULL };

  pid_t pid;
  int success = 0;
  int force_stderr_debug = 1;

  siginfo_t result;

  ignore_signals (&defsact, &oldsact, &ignpipe, &oldpipe);

  assert (pwd);
  if (!agent_socket)
    {
      message ("ssh-add requires an agent socket");
      goto done;
    }

  if (!build_environment (env,
                          "PATH", PATH,
                          "LC_ALL", "C",
                          "HOME", pwd->pw_dir,
                          "SSH_AUTH_SOCK", agent_socket,
                          NULL))
    goto done;

  /* Create the necessary pipes */
  if (pipe (inp) < 0 || pipe (outp) < 0 || pipe (errp) < 0)
    {
      error ("couldn't create pipes: %m");
      goto done;
    }

  pid = run_as_user (pamh, args, env, pwd,
                     inp, outp, errp);
  if (pid < 1)
    goto done;

  /* in the parent, close our unneeded ends of the pipes */
  close (inp[READ_END]);
  close (outp[WRITE_END]);
  close (errp[WRITE_END]);
  inp[READ_END] = outp[WRITE_END] = errp[WRITE_END] = -1;
  for (;;)
    {
      /* ssh-add asks for password on stderr */
      char *outerr = read_string (errp[READ_END], 0);
      if (outerr == NULL || outerr[0] == '\0')
        {
          free (outerr);
          break;
        }

      if (strstr (outerr, "Enter passphrase") != NULL)
        {
          debug ("Got password request");
          if (password != NULL)
            write_string (inp[WRITE_END], password);
          write_string (inp[WRITE_END], "\n");
        }
      else if (strstr (outerr, "Bad passphrase"))
        {
          debug ("sent bad password");
          write_string (inp[WRITE_END], "\n");
        }
      else
        {
            foreach_line (outerr, log_problem,
                          &force_stderr_debug);
        }

      free (outerr);
    }

  /* Wait for the initial process to exit */
  if (waitid (P_PID, pid, &result, WEXITED) < 0)
    {
      error ("couldn't wait on ssh-add process: %m");
      goto done;
    }

  success = result.si_code == CLD_EXITED && result.si_status == 0;
  /* Failure from process */
  if (!success)
    {
      /* key loading failed, don't report as an error */
      if (result.si_code == 1)
        {
          success = 1;
          message ("Failed adding some keys");
        }
      else
        {
          message ("Failed adding keys: %d", result.si_status);
        }
    }

done:
  restore_signals (&oldsact, &oldpipe);

  close_safe (inp[0]);
  close_safe (inp[1]);
  close_safe (outp[0]);
  close_safe (outp[1]);
  close_safe (errp[0]);
  close_safe (errp[1]);

  for (i = 0; env[i] != NULL; i++)
    free (env[i]);

  return success;
}

int
pam_ssh_add_start_agent (pam_handle_t *pamh,
                         struct passwd *pwd,
                         const char *xdg_runtime_overide,
                         char **out_auth_sock_var,
                         char **out_agent_pid_var)
{
  char *env[ENVIRON_SIZE] = { NULL };
  const char *xdg_runtime;

  struct sigaction defsact, oldsact, ignpipe, oldpipe;
  siginfo_t result;

  int inp[2] = { -1, -1 };
  int outp[2] = { -1, -1 };
  int errp[2] = { -1, -1 };
  pid_t pid;

  const char *args[] = { "/bin/sh", "-c", "$0 $1",
                         pam_ssh_agent_program,
                         pam_ssh_agent_arg,
                         NULL };

  char *output = NULL;
  char *outerr = NULL;
  int success = 0;
  int i = 0;

  char *save_vars[N_ELEMENTS (agent_vars)] = { NULL, };

  assert (pwd);
  xdg_runtime = get_optional_env ("XDG_RUNTIME_DIR",
                                  xdg_runtime_overide);
  if (!build_environment (env,
                          "PATH", PATH,
                          "LC_ALL", "C",
                          "HOME", pwd->pw_dir,
                          "XDG_RUNTIME_DIR", xdg_runtime,
                          NULL))
    goto done;

  ignore_signals (&defsact, &oldsact, &ignpipe, &oldpipe);
  /* Create the necessary pipes */
  if (pipe (inp) < 0 || pipe (outp) < 0 || pipe (errp) < 0)
    {
      error ("couldn't create pipes: %m");
      goto done;
    }

  pid = run_as_user (pamh, args, env, pwd,
                     inp, outp, errp);
  if (pid < 1)
    goto done;

  /* in the parent, close our unneeded ends of the pipes */
  close (inp[READ_END]);
  close (outp[WRITE_END]);
  close (errp[WRITE_END]);
  close (inp[WRITE_END]);

  inp[READ_END] = outp[WRITE_END] = errp[WRITE_END] = -1;

  /* Read any stdout and stderr data */
  output = read_string (outp[READ_END], 1);
  outerr = read_string (errp[READ_END], 0);
  if (!output || !outerr)
    {
      error ("couldn't read data from ssh-agent: %m");
      goto done;
    }

  /* Wait for the initial process to exit */
  if (waitid (P_PID, pid, &result, WEXITED) < 0)
    {
      error ("couldn't wait on ssh-agent process: %m");
      goto done;
    }

  success = result.si_code == CLD_EXITED && result.si_status == 0;

  if (outerr && outerr[0])
    foreach_line (outerr, log_problem, &success);

  foreach_line (output, get_environ_vars_from_agent, save_vars);

  /* Failure from process */
  if (!success)
    {
      error ("Failed to start ssh-agent");
    }
  /* Failure to find vars */
  else if (!save_vars[0] || !save_vars[1])
    {
      message ("Expected agent environment variables not found");
      success = 0;
    }

  if (out_auth_sock_var && save_vars[0])
    *out_auth_sock_var = strdup (save_vars[0]);

  if (out_agent_pid_var && save_vars[1])
    *out_agent_pid_var = strdup (save_vars[1]);

done:
  restore_signals (&oldsact, &oldpipe);

  close_safe (inp[0]);
  close_safe (inp[1]);
  close_safe (outp[0]);
  close_safe (outp[1]);
  close_safe (errp[0]);
  close_safe (errp[1]);

  free (output);
  free (outerr);

  /* save_vars may contain NULL
   * values use agent_vars as the
   * marker instead
   */
  for (i = 0; agent_vars[i] != NULL; i++)
    free (save_vars[i]);

  for (i = 0; env[i] != NULL; i++)
    free (env[i]);

  return success;
}

/* --------------------------------------------------------------------------------
 * PAM Module
 */

static void
parse_args (int argc,
            const char **argv)
{
  int i;

  pam_ssh_add_verbose_mode = 0;

  /* Parse the arguments */
  for (i = 0; i < argc; i++)
    {
      if (strcmp (argv[i], "debug") == 0)
        {
          pam_ssh_add_verbose_mode = 1;
        }
      else
        {
          message ("invalid option: %s", argv[i]);
          continue;
        }
    }
}

static void
free_password (char *password)
{
  volatile char *vp;
  size_t len;

  if (!password)
    return;

  /* Defeats some optimizations */
  len = strlen (password);
  memset (password, 0xAA, len);
  memset (password, 0xBB, len);

  /* Defeats others */
  vp = (volatile char*)password;
  while (*vp)
    *(vp++) = 0xAA;

  free (password);
}

static void
cleanup_free_password (pam_handle_t *pamh,
                       void *data,
                       int pam_end_status)
{
  free_password (data);
}

static char *
strdupx (const char *string)
{
  char *copy = strdup (string);
  if (copy != NULL)
    return copy;

  warn ("failed to allocate memory for strdup");
  abort ();
}

static int
stash_password_for_session (pam_handle_t *pamh,
                            const char *password)
{
  char *password_copy = strdupx (password);
  if (pam_set_data (pamh, STORED_AUTHTOK, password_copy,
                    cleanup_free_password) != PAM_SUCCESS)
    {
      free_password (password_copy);
      message ("error stashing password for session");
      return PAM_AUTHTOK_RECOVER_ERR;
    }

  /* coverity[leaked_storage : FALSE] */
  return PAM_SUCCESS;
}

static int
start_agent (pam_handle_t *pamh,
             struct passwd *auth_pwd)
{
  char *auth_socket = NULL;
  char *auth_pid = NULL;
  int success = 0;
  int res;

  success = pam_ssh_add_start_agent (pamh, auth_pwd,
                                     pam_getenv (pamh, "XDG_RUNTIME_DIR"),
                                     &auth_socket,
                                     &auth_pid);

  /* Store pid and socket environment vars */
  if (!success || !auth_socket || !auth_pid)
    {
      res = PAM_SERVICE_ERR;
    }
  else
    {
      res = pam_putenv (pamh, auth_socket);
      if (res == PAM_SUCCESS)
        res = pam_putenv (pamh, auth_pid);

      if (res != PAM_SUCCESS)
        {
          error ("couldn't set agent environment: %s",
                 pam_strerror (pamh, res));
        }

      /* parse and store the agent pid for later cleanup */
      if (strncmp (auth_pid, "SSH_AGENT_PID=", 14) == 0)
        {
          unsigned long pid = strtoul (auth_pid + 14, NULL, 10);
          if (pid > 0 && pid != ULONG_MAX)
            {
              ssh_agent_pid = pid;
              ssh_agent_uid = auth_pwd->pw_uid;
            }
          else
            {
              error ("invalid SSH_AGENT_PID value: %s", auth_pid);
            }
        }
      else
        {
          error ("unexpected agent pid format: %s", auth_pid);
        }
    }

  free (auth_socket);
  free (auth_pid);

  return res;
}

static int
load_keys (pam_handle_t *pamh,
           struct passwd *auth_pwd)
{
  const char *password;
  int success = 0;

  /* Get the stored authtok here */
  if (pam_get_data (pamh, STORED_AUTHTOK,
                    (const void**)&password) != PAM_SUCCESS)
    {
      password = NULL;
    }

  success = pam_ssh_add_load (pamh, auth_pwd,
                              pam_getenv (pamh, "SSH_AUTH_SOCK"),
                              password);

  return success ? PAM_SUCCESS : PAM_SERVICE_ERR;
}

PAM_EXTERN int
pam_sm_open_session (pam_handle_t *pamh,
                     int flags,
                     int argc,
                     const char *argv[])
{
  int res;
  int o_res;

  struct passwd *auth_pwd;
  const char *user;

  parse_args (argc, argv);

  /* Lookup the user */
  res = pam_get_user (pamh, &user, NULL);
  if (res != PAM_SUCCESS)
    {
      message ("couldn't get pam user: %s", pam_strerror (pamh, res));
      goto out;
    }

  auth_pwd = getpwnam (user);
  if (!auth_pwd)
    {
      error ("error looking up user information");
      res = PAM_SERVICE_ERR;
      goto out;
    }

  res = start_agent (pamh, auth_pwd);

  if (res == PAM_SUCCESS)
      res = load_keys (pamh, auth_pwd);

out:
  /* Delete the stored password,
     unless we are not in start mode
     then we might still need it.
   */
  o_res = pam_set_data (pamh, STORED_AUTHTOK,
                        NULL, cleanup_free_password);
  if (o_res != PAM_SUCCESS)
    {
      message ("couldn't delete stored authtok: %s",
               pam_strerror (pamh, o_res));
    }

  return res;
}

PAM_EXTERN int
pam_sm_close_session (pam_handle_t *pamh,
                      int flags,
                      int argc,
                      const char *argv[])
{
  parse_args (argc, argv);

  /* Kill the ssh agent we started */
  if (ssh_agent_pid > 0)
    {
      debug ("Closing %lu", ssh_agent_pid);
      /* kill as user to guard against crashing ssh-agent and PID reuse */
      if (setresuid (ssh_agent_uid, ssh_agent_uid,  -1) < 0)
        {
          error ("could not drop privileges for killing ssh agent: %m");
          return PAM_SESSION_ERR;
        }
      if (kill (ssh_agent_pid, SIGTERM) < 0 && errno != ESRCH)
        message ("could not kill ssh agent %lu: %m", ssh_agent_pid);
      if (setresuid (0, 0, -1) < 0)
        {
          error ("could not restore privileges after killing ssh agent: %m");
          return PAM_SESSION_ERR;
        }
    }
  return PAM_SUCCESS;
}

PAM_EXTERN int
pam_sm_authenticate (pam_handle_t *pamh,
                     int unused,
                     int argc,
                     const char **argv)
{
  const char *password;
  int ret;

  parse_args (argc, argv);

  /* Look up the password and store it for later */
  ret = pam_get_item (pamh, PAM_AUTHTOK,
                      (const void**)&password);
  if (ret != PAM_SUCCESS)
      message ("no password is available: %s",
               pam_strerror (pamh, ret));

  if (password != NULL)
    stash_password_for_session (pamh, password);

  /* We're not an authentication module */
  return PAM_CRED_INSUFFICIENT;
}

PAM_EXTERN int
pam_sm_setcred (pam_handle_t *pamh,
                int flags,
                int argc,
                const char *argv[])
{
  return PAM_SUCCESS;
}
