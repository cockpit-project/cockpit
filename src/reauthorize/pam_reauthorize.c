/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2014 Red Hat, Inc.
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

#define _GNU_SOURCE 1

#include "reauthorize.h"

#include <sys/types.h>

#include <assert.h>
#include <errno.h>
#include <pwd.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <syslog.h>
#include <unistd.h>

#include <keyutils.h>

#include <security/pam_modules.h>

#define message(format, ...) \
  syslog (LOG_WARNING | LOG_AUTHPRIV, "pam_reauthorize: " format, ##__VA_ARGS__)

/* Not thread safe, but not sure I care */
static int verbose_mode = 0;

#define debug(format, ...) \
  do { if (verbose_mode) \
      syslog (LOG_INFO | LOG_AUTHPRIV, "pam_reauthorize: " format, ##__VA_ARGS__); \
  } while (0)

static void
on_reauthorize_logger (const char *str)
{
  message ("%s", str);
}

static int
lookup_user_uid (const char *user,
                 uid_t *uid)
{
  struct passwd *pwd = NULL;
  struct passwd buf;
  char *buf2;
  long len;
  int ret;
  int rc;

  if (user == NULL)
    {
      debug ("couldn't lookup user: %s", "null user from pam");
      return PAM_USER_UNKNOWN;
    }

  len = sysconf(_SC_GETPW_R_SIZE_MAX);
  if (len < 0)
    len = 16384; /* Should be more than enough */
  buf2 = malloc (len);
  if (buf2 == NULL)
    {
      message ("couldn't lookup user %s: out of memory", user);
      return PAM_SYSTEM_ERR;
    }

  pwd = NULL;
  rc = getpwnam_r (user, &buf, buf2, len, &pwd);
  if (pwd == NULL)
    {
      if (rc == 0)
        {
          debug ("no such user: %s", user);
          ret = PAM_USER_UNKNOWN;
        }
      else
        {
          errno = rc;
          message ("couldn't lookup user %s: %m", user);
          ret = PAM_SYSTEM_ERR;
        }
    }
  else
    {
      debug ("found user: %s = %d", user, (int)pwd->pw_uid);
      *uid = pwd->pw_uid;
      ret = PAM_SUCCESS;
    }

  free (buf2);
  return ret;
}

static int
parse_args (int argc,
            const char **argv)
{
  int args = 0;
  int i;

  verbose_mode = 0;

  /* Parse the arguments */
  for (i = 0; i < argc; i++)
    {
      if (strcmp (argv[i], "prepare") == 0)
        {
          /* The only mode right now */
        }
      else if (strcmp (argv[i], "verbose") == 0)
        {
          verbose_mode = 1;
        }
      else
        {
          message ("invalid option: %s", argv[i]);
          continue;
        }
    }

  reauthorize_logger (on_reauthorize_logger, verbose_mode);
  return args;
}

static void
cleanup_key (pam_handle_t *pamh,
             void *data,
             int error_status)
{
  long *key = data;
  free (key);
}

PAM_EXTERN int
pam_sm_authenticate (pam_handle_t *pamh,
                     int flags,
                     int argc,
                     const char *argv[])
{
  const void *password;
  const char *user;
  uid_t auth_uid;
  long *key;
  int res;

  parse_args (argc, argv);

  /* We only work if the process is running as root */
  if (geteuid () != 0)
    {
      debug ("skipping module, not running with root privileges");
      return PAM_CRED_INSUFFICIENT;
    }

  /* Lookup the user */
  res = pam_get_user (pamh, &user, NULL);
  if (res != PAM_SUCCESS)
    {
      message ("couldn't get pam user: %s", pam_strerror (pamh, res));
      return res;
    }
  res = lookup_user_uid (user, &auth_uid);
  if (res != PAM_SUCCESS)
    return res;

  /* We'll never try to reauthorize root, so don't prepare either */
  if (auth_uid == 0)
    {
      debug ("not reauthorizing: root user");
      return PAM_CRED_INSUFFICIENT;
    }

  res = pam_get_item (pamh, PAM_AUTHTOK, &password);
  if (res != PAM_SUCCESS)
    {
      message ("error getting user password: %s: %s", user, pam_strerror (pamh, res));
      return PAM_AUTHTOK_ERR;
    }

 key = calloc (1, sizeof (long));
 if (!key)
   {
     message ("couldn't allocate memory for key serial");
     return PAM_BUF_ERR;
   }

 res = reauthorize_prepare (user, password, KEY_SPEC_PROCESS_KEYRING, key);
 if (res < 0)
   {
     free (key);
     if (res == -ENOMEM)
       return PAM_BUF_ERR;
     return PAM_SYSTEM_ERR;
   }

  /*
   * We can't store the secret in the session keyring yet as the session
   * keyring may not have been created yet. So do it later during the
   * session handler. Store the secret here until then.
   */
  res = pam_set_data (pamh, "reauthorize/key", key, cleanup_key);
  if (res != PAM_SUCCESS)
    {
      message ("failed to set secret for session: %s", pam_strerror (pamh, res));
      free (key);
      return res;
    }

  debug ("stashed secret for session handler");

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

PAM_EXTERN int
pam_sm_open_session (pam_handle_t *pamh,
                     int flags,
                     int argc,
                     const char *argv[])
{
  int ret = PAM_SUCCESS;
  const char *user;
  long *key;

  parse_args (argc, argv);

  /* Lookup the user */
  ret = pam_get_user (pamh, &user, NULL);
  if (ret != PAM_SUCCESS)
    {
      message ("couldn't get pam user: %s", pam_strerror (pamh, ret));
      return ret;
    }

  if (pam_get_data (pamh, "reauthorize/key", (const void **)&key) != PAM_SUCCESS || !key)
    {
      debug ("no secret set by our auth handler");
      return PAM_CRED_INSUFFICIENT;
    }

  if (keyctl_link (*key, KEY_SPEC_SESSION_KEYRING) < 0 ||
      keyctl_unlink (*key, KEY_SPEC_PROCESS_KEYRING) < 0)
    {
      message ("couldn't move reauthorize secret key into kernel session keyring: %m");
      return PAM_SYSTEM_ERR;
    }

  return PAM_SUCCESS;
}

PAM_EXTERN int
pam_sm_close_session (pam_handle_t *pamh,
                      int flags,
                      int argc,
                      const char *argv[])
{
  return PAM_SUCCESS;
}
