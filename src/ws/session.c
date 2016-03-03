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

#include "config.h"

#include <assert.h>
#include <ctype.h>
#include <err.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdarg.h>
#include <stdlib.h>
#include <string.h>

#include <security/pam_appl.h>

#include <sys/types.h>
#include <sys/signal.h>
#include <sys/stat.h>
#include <sys/resource.h>
#include <dirent.h>
#include <sched.h>
#include <utmp.h>
#include <unistd.h>
#include <pwd.h>
#include <sys/wait.h>
#include <grp.h>

#include <gssapi/gssapi.h>
#include <gssapi/gssapi_generic.h>
#include <gssapi/gssapi_krb5.h>

/* This program opens a session for a given user and runs the bridge in
 * it.  It is used to manage localhost; for remote hosts sshd does
 * this job.
 */

#define DEBUG_SESSION 0
#define MAX_BUFFER 64 * 1024
#define AUTH_FD 3
#define EX 127
#define DEFAULT_PATH "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

static struct passwd *pwd;
const char *rhost;
static pid_t child;
static int want_session = 1;
static char *auth_delimiter = "";
static FILE *authf;

#if DEBUG_SESSION
#define debug(fmt, ...) (fprintf (stderr, "cockpit-session: " fmt "\n", ##__VA_ARGS__))
#else
#define debug(...)
#endif

static char *
read_fd_until_eof (int fd,
                   const char *what,
                   size_t *out_len)
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
          if (alloc > MAX_BUFFER)
            errx (EX, "input data is too long for %s", what);
          buf = realloc (buf, alloc);
          if (!buf)
            errx (EX, "couldn't allocate memory for %s", what);
        }

      r = read (fd, buf + len, alloc - len);
      if (r < 0)
        {
          if (errno == EAGAIN)
            continue;
          err (EX, "couldn't read %s", what);
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
  if (out_len)
    *out_len = len;
  return buf;
}

static void
write_auth_string (const char *field,
                   const char *str)
{
  const unsigned char *at;
  char buf[8];

  fprintf (authf, "%s \"%s\": \"", auth_delimiter, field);
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
  auth_delimiter = ",";
}

static void
write_auth_hex (const char *field,
                const unsigned char *src,
                size_t len)
{
  static const char hex[] = "0123456789abcdef";
  size_t i;

  fprintf (authf, "%s \"%s\": \"", auth_delimiter, field);
  for (i = 0; i < len; i++)
    {
      unsigned char byte = src[i];
      fputc_unlocked (hex[byte >> 4], authf);
      fputc_unlocked (hex[byte & 0xf], authf);
    }
  fputc_unlocked ('\"', authf);
  auth_delimiter = ",";
}

static void
write_auth_begin (int result_code)
{
  authf = fdopen (AUTH_FD, "w");
  if (!authf)
    err (EX, "couldn't write result to cockpit-ws");

  /*
   * The use of JSON here is not coincidental. It allows the cockpit-ws
   * to detect whether it received the entire result or not. Partial
   * JSON objects do not parse.
   */

  fprintf (authf, "{ ");

  if (result_code == PAM_AUTH_ERR || result_code == PAM_USER_UNKNOWN)
    {
      write_auth_string ("error", "authentication-failed");
    }
  else if (result_code == PAM_PERM_DENIED)
    {
      write_auth_string ("error", "permission-denied");
    }
  else if (result_code == PAM_AUTHINFO_UNAVAIL)
    {
      write_auth_string ("error", "authentication-unavailable");
    }
  else if (result_code != PAM_SUCCESS)
    {
      write_auth_string ("error", "pam-error");
    }

  if (result_code != PAM_SUCCESS)
    write_auth_string ("message", pam_strerror (NULL, result_code));

  debug ("wrote result %d to cockpit-ws", result_code);
}

static void
write_auth_end (void)
{
  fprintf (authf, " }\n");

  if (ferror (authf) || fclose (authf) != 0)
    err (EX, "couldn't write result to cockpit-ws");
}

static void
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

static char *
dup_string (const char *str,
            size_t len)
{
  char *buf = malloc (len + 1);
  if (!buf)
    err (EX, "couldn't allocate memory for string");
  memcpy (buf, str, len);
  buf[len] = '\0';
  return buf;
}

static const char *
gssapi_strerror (OM_uint32 major_status,
                 OM_uint32 minor_status)
{
  static char buffer[1024];
  OM_uint32 major, minor;
  OM_uint32 ctx;
  gss_buffer_desc status;
  char *buf;
  size_t len;
  int had_major;
  int had_minor;

  debug ("gssapi: major_status: %8.8x, minor_status: %8.8x",
         major_status, minor_status);

  buf = buffer;
  len = sizeof (buffer);
  buf[0] = '\0';
  had_major = 0;
  ctx = 0;

  if (major_status != GSS_S_FAILURE || minor_status == 0)
    {
      for (;;)
        {
          major = gss_display_status (&minor, major_status, GSS_C_GSS_CODE,
                                      GSS_C_NO_OID, &ctx, &status);
          if (GSS_ERROR (major))
            break;

          if (had_major)
            build_string (&buf, &len, ": ", 2);
          had_major = 1;

          build_string (&buf, &len, status.value, status.length);
          gss_release_buffer (&minor, &status);

          if (!ctx)
            break;
        }
    }

   ctx = 0;
   had_minor = 0;
   for (;;)
     {
       major = gss_display_status (&minor, minor_status, GSS_C_MECH_CODE,
                                   GSS_C_NULL_OID, &ctx, &status);
       if (GSS_ERROR (major))
         break;

       if (had_minor)
         build_string (&buf, &len, ", ", 2);
       else if (had_major)
         build_string (&buf, &len, " (", 2);
       had_minor = 1;
       build_string (&buf, &len, status.value, status.length);

       gss_release_buffer (&minor, &status);

       if (!ctx)
         break;
     }

   if (had_major && had_minor)
     build_string (&buf, &len, ")", 1);

   return buffer;
}

static int
pam_conv_func (int num_msg,
               const struct pam_message **msg,
               struct pam_response **ret_resp,
               void *appdata_ptr)
{
  char **password = (char **)appdata_ptr;
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
          if (*password == NULL)
            {
              warnx ("pam asked us for unexpected password");
              success = 0;
            }
          else
            {
              debug ("answered pam password prompt");
              resp[i].resp = *password;
              resp[i].resp_retcode = 0;
              *password = NULL;
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
open_session (pam_handle_t *pamh)
{
  struct passwd *buf = NULL;
  const char *name;
  int res;

  name = NULL;
  pwd = NULL;

  res = pam_get_item (pamh, PAM_USER, (const void **)&name);
  if (res != PAM_SUCCESS)
    {
      warnx ("couldn't load user from pam");
      return res;
    }

  /* Yes, buf "leaks" */
  buf = malloc (sizeof (struct passwd) + 8192);
  if (buf == NULL)
    res = ENOMEM;
  else
    res = getpwnam_r (name, buf, (char *)(buf + 1), 8192, &pwd);
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
      if (res != PAM_SUCCESS)
        {
          warnx ("user account access failed: %s: %s", name, pam_strerror (pamh, res));

          /* We change PAM_AUTH_ERR to PAM_PERM_DENIED so that we can
           * distinguish between failures here and in *
           * pam_authenticate.
           */
          if (res == PAM_AUTH_ERR)
            res = PAM_PERM_DENIED;

          return res;
        }

      debug ("opening pam session for %s", name);

      pam_putenv (pamh, "XDG_SESSION_CLASS=user");

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
  input = read_fd_until_eof (AUTH_FD, "password", NULL);
  password = strchr (input, ':');
  if (password == NULL || strchr (password + 1, '\n'))
    {
      debug ("bad basic auth input");
      write_auth_begin (PAM_AUTH_ERR);
      write_auth_end ();
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

  if (pam_set_item (pamh, PAM_RHOST, rhost) != PAM_SUCCESS)
    errx (EX, "couldn't setup pam");

  debug ("authenticating");

  res = pam_authenticate (pamh, 0);
  if (res == PAM_SUCCESS)
    res = open_session (pamh);

  write_auth_begin (res);
  if (res == PAM_SUCCESS && pwd)
    write_auth_string ("user", pwd->pw_name);
  write_auth_end ();

  if (res != PAM_SUCCESS)
    exit (5);

  if (input)
    {
      memset (input, 0, strlen (input));
      free (input);
    }

  return pamh;
}

static pam_handle_t *
perform_gssapi (void)
{
  struct pam_conv conv = { pam_conv_func, };
  OM_uint32 major, minor;
  gss_cred_id_t client = GSS_C_NO_CREDENTIAL;
  gss_cred_id_t server = GSS_C_NO_CREDENTIAL;
  gss_buffer_desc input = GSS_C_EMPTY_BUFFER;
  gss_buffer_desc output = GSS_C_EMPTY_BUFFER;
  gss_buffer_desc local = GSS_C_EMPTY_BUFFER;
  gss_buffer_desc display = GSS_C_EMPTY_BUFFER;
  gss_name_t name = GSS_C_NO_NAME;
  gss_ctx_id_t context = GSS_C_NO_CONTEXT;
  gss_OID mech_type = GSS_C_NO_OID;
  pam_handle_t *pamh = NULL;
  OM_uint32 flags = 0;
  const char *msg;
  char *str = NULL;
  OM_uint32 caps = 0;
  int res;

  res = PAM_AUTH_ERR;

  /* We shouldn't be writing to kerberos caches here */
  setenv ("KRB5CCNAME", "FILE:/dev/null", 1);
  setenv ("KRB5RCACHETYPE", "none", 1);

  debug ("reading kerberos auth from cockpit-ws");
  input.value = read_fd_until_eof (AUTH_FD, "gssapi data", &input.length);

  debug ("acquiring server credentials");
  major = gss_acquire_cred (&minor, GSS_C_NO_NAME, GSS_C_INDEFINITE, GSS_C_NO_OID_SET,
                            GSS_C_ACCEPT, &server, NULL, NULL);
  if (GSS_ERROR (major))
    {
      /* This is a routine error message, don't litter */
      msg = gssapi_strerror (major, minor);
      if (input.length == 0 && !strstr (msg, "nonexistent or empty"))
        warnx ("couldn't acquire server credentials: %s", msg);
      res = PAM_AUTHINFO_UNAVAIL;
      goto out;
    }

  major = gss_accept_sec_context (&minor, &context, server, &input,
                                  GSS_C_NO_CHANNEL_BINDINGS, &name, &mech_type,
                                  &output, &flags, &caps, &client);

  if (GSS_ERROR (major))
    {
      warnx ("gssapi auth failed: %s", gssapi_strerror (major, minor));
      goto out;
    }

  /*
   * In general gssapi mechanisms can require multiple challenge response
   * iterations keeping &context between each, however Kerberos doesn't
   * require this, so we don't care :O
   *
   * If we ever want this to work with something other than Kerberos, then
   * we'll have to have some sorta session that holds the context.
   */
  if (major & GSS_S_CONTINUE_NEEDED)
    goto out;

  major = gss_localname (&minor, name, mech_type, &local);
  if (major == GSS_S_COMPLETE)
    {
      minor = 0;
      str = dup_string (local.value, local.length);
      debug ("mapped gssapi name to local user '%s'", str);

      if (getpwnam (str))
        {
          res = pam_start ("cockpit", str, &conv, &pamh);
        }
      else
        {
          /* If the local user doesn't exist, pretend gss_localname() failed */
          free (str);
          str = NULL;
          major = GSS_S_FAILURE;
          minor = KRB5_NO_LOCALNAME;
        }
    }

  if (major != GSS_S_COMPLETE)
    {
      if (minor == (OM_uint32)KRB5_NO_LOCALNAME || minor == (OM_uint32)KRB5_LNAME_NOTRANS)
        {
          major = gss_display_name (&minor, name, &display, NULL);
          if (GSS_ERROR (major))
            {
              warnx ("couldn't get gssapi display name: %s", gssapi_strerror (major, minor));
              goto out;
            }

          str = dup_string (display.value, display.length);
          debug ("no local user mapping for gssapi name '%s'", str);

          res = pam_start ("cockpit", str, &conv, &pamh);
        }
      else
        {
          warnx ("couldn't map gssapi name to local user: %s", gssapi_strerror (major, minor));
          goto out;
        }
    }

  if (res != PAM_SUCCESS)
    errx (EX, "couldn't start pam: %s", pam_strerror (NULL, res));

  if (pam_set_item (pamh, PAM_RHOST, rhost) != PAM_SUCCESS)
    errx (EX, "couldn't setup pam");

  res = open_session (pamh);

out:
  write_auth_begin (res);
  if (pwd)
    write_auth_string ("user", pwd->pw_name);
  if (output.value)
    write_auth_hex ("gssapi-output", output.value, output.length);

  if (output.value)
    gss_release_buffer (&minor, &output);
  output.value = NULL;
  output.length = 0;

  if (caps & GSS_C_DELEG_FLAG && client != GSS_C_NO_CREDENTIAL)
    {
#ifdef HAVE_GSS_IMPORT_CRED
      major = gss_export_cred (&minor, client, &output);
      if (GSS_ERROR (major))
        warnx ("couldn't export gssapi credentials: %s", gssapi_strerror (major, minor));
      else if (output.value)
        write_auth_hex ("gssapi-creds", output.value, output.length);
#else
      /* cockpit-ws will complain for us, if they're ever used */
      write_auth_hex ("gssapi-creds", (void *)"", 0);
#endif
    }

  write_auth_end ();

  if (display.value)
    gss_release_buffer (&minor, &display);
  if (output.value)
    gss_release_buffer (&minor, &output);
  if (local.value)
    gss_release_buffer (&minor, &local);
  if (client != GSS_C_NO_CREDENTIAL)
    gss_release_cred (&minor, &client);
  if (server != GSS_C_NO_CREDENTIAL)
    gss_release_cred (&minor, &server);
  if (name != GSS_C_NO_NAME)
     gss_release_name (&minor, &name);
  if (context != GSS_C_NO_CONTEXT)
     gss_delete_sec_context (&minor, &context, GSS_C_NO_BUFFER);
  free (input.value);
  free (str);

  unsetenv ("KRB5CCNAME");

  if (res != PAM_SUCCESS)
    exit (5);

  return pamh;
}

static void
utmp_log (int login)
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
          warnx ("couldn't close fd in bridge process: %m");
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
session (char **env)
{
  char *argv[] = { "cockpit-bridge", NULL };
  debug ("executing bridge: %s", argv[0]);
  if (env)
    execvpe (argv[0], argv, env);
  else
    execvp (argv[0], argv);
  warn ("can't exec %s", argv[0]);
  return 127;
}

static int
fork_session (char **env)
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

static void
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
  NULL
};

/* Holds environment values to set in pam context */
static char *env_saved[sizeof (env_names) / sizeof (env_names)[0]] = { NULL, };

static void
save_environment (void)
{
  const char *value;
  int i, j;

  /* Force save our default path */
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

int
main (int argc,
      char **argv)
{
  pam_handle_t *pamh = NULL;
  const char *auth;
  char **env;
  int status;
  int flags;
  int res;
  int i;

  if (isatty (0))
    errx (2, "this command is not meant to be run from the console");

  if (argc != 3)
    errx (2, "invalid arguments to cockpit-session");

  /* Cleanup the umask */
  umask (077);

  save_environment ();

  /* When setuid root, make sure our group is also root */
  if (geteuid () == 0)
    {
      /* Never trust the environment when running setuid() */
      if (getuid() != 0)
        {
          if (clearenv () != 0)
            err (1, "couldn't clear environment");
        }

      /* set a minimal environment */
      setenv ("PATH", DEFAULT_PATH, 1);

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

  if (strcmp (auth, "basic") == 0)
    pamh = perform_basic ();
  else if (strcmp (auth, "negotiate") == 0)
    pamh = perform_gssapi ();
  else
    errx (2, "unrecognized authentication method: %s", auth);

  for (i = 0; env_saved[i] != NULL; i++)
    pam_putenv (pamh, env_saved[i]);

  env = pam_getenvlist (pamh);
  if (env == NULL)
    errx (EX, "get pam environment failed");

  if (want_session)
    {
      assert (pwd != NULL);

      if (initgroups (pwd->pw_name, pwd->pw_gid) < 0)
        err (EX, "%s: can't init groups", pwd->pw_name);

      signal (SIGTERM, pass_to_child);
      signal (SIGINT, pass_to_child);
      signal (SIGQUIT, pass_to_child);

      utmp_log (1);

      status = fork_session (env);

      utmp_log (0);

      signal (SIGTERM, SIG_DFL);
      signal (SIGINT, SIG_DFL);
      signal (SIGQUIT, SIG_DFL);

      res = pam_setcred (pamh, PAM_DELETE_CRED);
      if (res != PAM_SUCCESS)
        err (EX, "%s: couldn't delete creds: %s", pwd->pw_name, pam_strerror (pamh, res));
      res = pam_close_session (pamh, 0);
      if (res != PAM_SUCCESS)
        err (EX, "%s: couldn't close session: %s", pwd->pw_name, pam_strerror (pamh, res));
    }
  else
    {
      status = session (env);
    }

  pam_end (pamh, PAM_SUCCESS);


  if (WIFEXITED(status))
    exit (WEXITSTATUS(status));
  else if (WIFSIGNALED(status))
    raise (WTERMSIG(status));
  else
    exit (127);
}
