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

#include "reauthutil.h"

#include <sys/socket.h>
#include <sys/types.h>
#include <sys/un.h>

#include <assert.h>
#include <crypt.h>
#include <errno.h>
#include <fcntl.h>
#include <pwd.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <syslog.h>
#include <time.h>
#include <unistd.h>

#include <keyutils.h>

#include <security/pam_modules.h>

enum {
    ARG_PREPARE = 1 << 0,
    ARG_PERFORM = 1 << 1
};

#define message(format, ...) \
  syslog (LOG_WARNING | LOG_AUTHPRIV, "pam_reauthorize: " format, ##__VA_ARGS__)

/* Not thread safe, but not sure I care */
static int verbose_mode = 0;

#define debug(format, ...) \
  do { if (verbose_mode) \
      syslog (LOG_INFO | LOG_AUTHPRIV, "pam_reauthorize: " format, ##__VA_ARGS__); \
  } while (0)

static char *
generate_crypt_salt (void)
{
  static const char set[] = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789./";
  static const char random[] = "/dev/urandom";
  static const char prefix[] = "$6$";
  static const int salt_len = 16;

  unsigned char *data;
  char *buffer;
  ssize_t ret;
  size_t length;
  size_t prefix_len;
  size_t set_len;
  int fd;
  int i;

  /*
   * We are making a string like this:
   *
   * $6$0123456789abcdef$
   */

  prefix_len = strlen (prefix);
  buffer = malloc (prefix_len + salt_len + 2);
  if (buffer < 0)
    {
      message ("cannot generate salt: out of memory");
      return NULL;
    }

  fd = open (random, O_RDONLY);
  if (fd < 0)
    {
      message ("couldn't open %s: %m", random);
      free (buffer);
      return NULL;
    }

  /* Read binary data into appropriate place in buffer */
  length = salt_len;
  data = (unsigned char *)buffer + prefix_len;
  while (length > 0)
    {
      ret = read (fd, data, length);
      if (ret == 0)
        {
          /* Strange condition, but just in case */
          errno = EWOULDBLOCK;
          ret = -1;
        }
      if (ret < 0)
        {
          if (errno == EAGAIN || errno == EINTR)
            {
              ret = 0;
            }
          else
            {
              message ("couldn't read from %s: %m", random);
              close (fd);
              free (buffer);
              return NULL;
            }
        }
      assert (ret <= length);
      data += ret;
      length -= ret;
    }

  close (fd);

  /* Buffer first has prefix */
  memcpy (buffer, prefix, prefix_len);

  /* Encode the binary data into crypt() allowed set */
  set_len = strlen (set);
  for (i = prefix_len; i < prefix_len + salt_len; i++)
    buffer[i] = set[buffer[i] % set_len];

  /* End up with a '$\0' */
  memcpy (buffer + prefix_len + salt_len, "$", 2);

  debug ("generated salt: %s", buffer);
  return buffer;
}


/* ----------------------------------------------------------------------------
 * Phase: 'prepare'
 *
 * Here we derive a secret from the user's password than we can later use
 * for reauthorize if something does the same derivation elsewhere.
 */

struct secret_and_crypt {
    const char *secret;
    struct crypt_data cd;
};

static void
cleanup_secret_and_crypt (pam_handle_t *pamh,
                          void *data,
                          int error_status)
{
  _reauthorize_secfree (data, sizeof (struct secret_and_crypt));
}

static void
derive_reauthorize_secret (pam_handle_t *pamh,
                           const char *password)
{
  struct secret_and_crypt *scd = NULL;
  char *salt = NULL;
  ssize_t salt_len;
  int res;

  /* The salt already contains algorithm prefix and suffix */
  salt = generate_crypt_salt ();
  if (!salt)
    goto out;

  scd = calloc (1, sizeof (struct secret_and_crypt));
  if (!scd)
    {
      message ("couldn't allocate crypt data");
      goto out;
    }

  scd->secret = crypt_r (password, salt, &scd->cd);
  if (!scd->secret)
    {
      message ("couldn't crypt reauthorize secret: %m");
      goto out;
    }

  /*
   * Double check that our assumptions about crypt() work
   * as expected. We're later going to be sending away the
   * salt as a challenge, so guarantee that it works.
   */

  salt_len = _reauthorize_parse_salt (scd->secret);
  if (salt_len != strlen (salt) || memcmp (scd->secret, salt, salt_len) != 0)
    {
      message ("got invalid result from crypt");
      scd->secret = NULL;
      goto out;
    }

  /*
   * We can't store the secret in the kernel keyring yet as the session
   * keyring may not have been created yet. So do it later during the
   * session handler. Store the secret here until then.
   */
  res = pam_set_data (pamh, "reauthorize/secret", scd, cleanup_secret_and_crypt);
  if (res == PAM_SUCCESS)
    {
      debug ("stashed secret for session handler");
      scd = NULL;
    }
  else
    {
      message ("failed to set secret for session: %s", pam_strerror (pamh, res));
    }

out:
  free (salt);
  _reauthorize_secfree (scd, sizeof (struct secret_and_crypt));
}

static void
begin_reauthorize_prep (pam_handle_t *pamh,
                        const char *user,
                        uid_t auth_uid)
{
  const void *password;
  int res;

  /* We'll never try to reauthorize root, so don't prepare either */
  if (auth_uid == 0)
    {
      debug ("not reauthorizing: root user");
      return;
    }

  /* We never try to prepare if running as setuid() */
  if (getuid() != 0)
    {
      debug ("not reauthorizing: running setuid");
      return;
    }

  res = pam_get_item (pamh, PAM_AUTHTOK, &password);
  if (res != PAM_SUCCESS)
    {
      message ("no password available for user %s: %s", user, pam_strerror (pamh, res));
      return;
    }
  else if (password == NULL)
    {
      debug ("no password available for user %s", user);
      return;
    }

  derive_reauthorize_secret (pamh, password);
}

static void
store_keyring_for_reauthorize (const char *user,
                               const char *secret)
{
  char *name = NULL;
  key_serial_t key;
  key_perm_t perm;

  if (asprintf (&name, "reauthorize/secret/%s", user) < 0)
    {
      message ("couldn't allocate keyring name");
      goto out;
    }

  /*
   * Don't put our secret into the session keyring until the permissions
   * are strong enough. Since we want that to be atomic, first store in
   * our thread keyring, and then link below.
   */

  key = add_key ("user", name, "xxx", 3, KEY_SPEC_THREAD_KEYRING);
  if (key < 0)
    {
      message ("couldn't create key in kernel session keyring: %s: %m", name);
      goto out;
    }

  /* Set permissions, and double check that what we expect happened */
  perm = KEY_USR_VIEW | KEY_USR_READ | KEY_USR_WRITE | KEY_USR_SEARCH | KEY_USR_LINK;
  if (keyctl_setperm (key, perm) < 0)
    {
      message ("couldn't set permissions on kernel key: %s: %m", name);
      goto out;
    }

  if (keyctl_update (key, secret, strlen (secret)))
    {
      message ("couldn't update secret reauthorize key in kernel keyring: %s: %m", name);
      goto out;
    }

  if (keyctl_link (key, KEY_SPEC_SESSION_KEYRING) < 0 ||
      keyctl_unlink (key, KEY_SPEC_THREAD_KEYRING) < 0)
    {
      message ("couldn't move reauthorize secret key into kernel session keyring: %s: %m", name);
      goto out;
    }

  debug ("placed secret in kernel session keyring");

out:
  free (name);
}

static void
complete_reauthorize_prep (pam_handle_t *pamh,
                           const char *user)
{
  struct secret_and_crypt *scd;

  if (pam_get_data (pamh, "reauthorize/secret", (const void **)&scd) != PAM_SUCCESS || !scd)
    {
      debug ("no secret set by our auth handler");
    }
  else
    {
      store_keyring_for_reauthorize (user, scd->secret);
      if (pam_set_data (pamh, "reauthorize/secret", NULL, NULL) != PAM_SUCCESS)
        message ("couldn't clear secret from pam stack");
    }
}

/* ----------------------------------------------------------------------------
 * 'perform' phase
 */

static int
perform_reauthorize_chat (struct sockaddr *peer,
                          socklen_t peer_len,
                          const char *challenge,
                          char **response)
{
  int ret = PAM_SYSTEM_ERR;
  size_t challenge_len;
  ssize_t count;
  char *resp = NULL;
  size_t resp_len;
  int sock;

  sock = socket (AF_UNIX, SOCK_SEQPACKET, 0);
  if (sock < 0)
    {
      message ("couldn't open socket: %m");
      goto out;
    }

  for (;;)
    {
      if (connect (sock, peer, peer_len) < 0)
        {
          if (errno == EAGAIN || errno == EINTR)
            continue;
          message ("couldn't connect to reauthorize socket: %m");
          goto out;
        }
      break;
    }

  debug ("sending reauthorize challenge");
  challenge_len = strlen (challenge);

  for (;;)
    {
      count = send (sock, challenge, challenge_len, MSG_NOSIGNAL);
      if (count < 0)
        {
          if (errno == EAGAIN || errno == EINTR)
            continue;
          message ("couldn't send reauthorize chat: %m");
          goto out;
        }
      else if (count != challenge_len)
        {
          message ("couldn't send reauthorize chat: partial send");
          goto out;
        }
      break;
    }

  resp = NULL;
  resp_len = 8192;
  debug ("reading reauthorize response");

  for (;;)
    {
      resp = _reauthorize_xrealloc (resp, resp_len);
      if (resp == NULL)
        {
          message ("couldn't allocate response buffer");
          ret = PAM_BUF_ERR;
          goto out;
        }
      count = recv (sock, resp, resp_len - 1, MSG_PEEK);
      if (count < 0)
        {
          if (errno == EAGAIN || errno == EINTR)
            continue;
          message ("couldn't read reauthorize chat: %m");
          goto out;
        }
      else if (count == resp_len - 1)
        {
          debug ("trying read again with a bigger buffer");
          resp_len *= 2;
          continue;
        }

      resp[count] = '\0';
      debug ("received reauthorize response: %s", resp);
      break;
    }

  *response = resp;
  resp = NULL;
  ret = PAM_SUCCESS;

out:
  if (sock != -1)
    close (sock);
  free (resp);

  return ret;
}

static int
build_reauthorize_challenge (const char *user,
                             const char *secret,
                             char **nonce,
                             char **challenge)
{
  int ret = PAM_SYSTEM_ERR;
  char *hex = NULL;
  ssize_t salt_len;
  int len;

  /* This is where we'll plug in GSAPI auth */
  if (secret == NULL)
    {
      debug ("no reauthorize secret available");
      ret = PAM_CRED_INSUFFICIENT;
      goto out;
    }

  salt_len = _reauthorize_parse_salt (secret);
  if (salt_len < 0)
    {
      message ("ignoring invalid reauthorize secret");
      ret = PAM_AUTH_ERR;
      goto out;
    }

  *nonce = generate_crypt_salt ();
  if (*nonce == NULL)
    goto out;

  if (_reauthorize_hex (user, -1, &hex) < 0)
    {
      message ("couldn't encode user as hex");
      ret = PAM_BUF_ERR;
    }

  len = asprintf (challenge, "crypt1:%s:%s:%.*s", hex, *nonce, (int)salt_len, secret);
  if (len < 0)
    {
      message ("failed to allocate challenge");
      ret = PAM_BUF_ERR;
      goto out;
    }

  /* Double check that we didn't include the secret */
  assert ((*challenge)[len - 1] == '$');
  assert (strstr (*challenge, secret) == NULL);
  ret = PAM_SUCCESS;

out:
  free (hex);
  return ret;
}

static int
lookup_reauthorize_secret (const char *user,
                           char **secret)
{
  int ret = PAM_SYSTEM_ERR;
  char *buffer = NULL;
  char *name = NULL;
  key_serial_t key;

  if (asprintf (&name, "reauthorize/secret/%s", user) < 0)
    {
      ret = PAM_BUF_ERR;
      goto out;
    }

  key = keyctl_search (KEY_SPEC_SESSION_KEYRING, "user", name, 0);
  if (key < 0)
    {
      /* missing key is not an error */
      if (errno == ENOKEY)
        {
          ret = PAM_SUCCESS;
          *secret = NULL;
          goto out;
        }

      message ("failed to lookup reauthorize secret key: %s: %m", name);
      goto out;
    }

  if (keyctl_describe_alloc (key, &buffer) < 0)
    {
      message ("couldn't describe reauthorize secret key: %s: %m", name);
      goto out;
    }
  if (strncmp (buffer, "user;0;0;001f0000;", 18) != 0)
    {
      message ("kernel reauthorize secret key has invalid permissions: %s: %s", name, buffer);
      goto out;
    }

  /* null-terminates */
  if (keyctl_read_alloc (key, (void **)secret) < 0)
    {
      message ("couldn't read kernel reauthorize secret key: %s: %m", name);
      goto out;
    }

  ret = PAM_SUCCESS;

out:
  free (buffer);
  free (name);
  return ret;
}

static int
lookup_reauthorize_sockaddr (struct sockaddr **addr,
                             socklen_t *addr_len)
{
  const char *name = "reauthorize/socket";
  struct sockaddr_un *sun;
  key_serial_t key;
  long len;

  /*
   * It would be lovely if we didn't have to abuse the kernel keyring for this.
   * But polkit completely clears the environment that we are executed in,
   * so the kernel keyring is one of the few ways to pass this info.
   */

  key = keyctl_search (KEY_SPEC_SESSION_KEYRING, "user", name, 0);
  if (key < 0)
    {
      if (errno == ENOKEY)
        {
          debug ("no reauthorize socket address found");
          return PAM_CRED_INSUFFICIENT;
        }
      message ("failed to find reauthorize socket address: %s: %m", name);
      return PAM_SYSTEM_ERR;
    }

  len = keyctl_read_alloc (key, (void **)&sun);
  if (len < 0)
    {
      message ("failed to lookup reauthorize socket address: %s: %m", name);
      return PAM_SYSTEM_ERR;
    }

  if (len < sizeof (sa_family_t) ||
      len > sizeof (struct sockaddr_un) ||
      sun->sun_family != AF_UNIX)
    {
      message ("invalid socket address in keyring");
      free (sun);
      return PAM_AUTH_ERR;
    }

  *addr = (struct sockaddr *)sun;
  *addr_len = len;
  return PAM_SUCCESS;
}

static int
perform_reauthorize_validate (const char *user,
                              const char *nonce,
                              const char *secret,
                              const char *response)
{
  struct crypt_data *cd = NULL;
  int ret = PAM_AUTH_ERR;
  const char *check;

  assert (nonce != NULL);
  assert (secret != NULL);
  assert (response != NULL);

  /* This happens when caller cancels */
  if (response[0] == '\0')
    {
      message ("received empty reauthorize response");
      ret = PAM_CRED_INSUFFICIENT;
      goto out;
    }

  if (strncmp (response, "crypt1:", 7) != 0)
    {
      message ("received invalid response");
      goto out;
    }
  response += 7;

  cd = calloc (1, sizeof (struct crypt_data));
  if (cd == NULL)
    {
      message ("couldn't allocate crypt data context");
      ret = PAM_BUF_ERR;
      goto out;
    }

  check = crypt_r (secret, nonce, cd);
  if (check == NULL)
    {
      message ("couldn't crypt data: %m");
      goto out;
    }

  debug ("expected response is: %s", check);

  if (strcmp (check, response) != 0)
    {
      message ("user %s reauthorization failed", user);
      goto out;
    }

  message ("user %s was reauthorized", user);
  ret = PAM_SUCCESS;

out:
  _reauthorize_secfree (cd, sizeof (struct crypt_data));
  return ret;
}

static int
perform_reauthorize (pam_handle_t *pamh,
                     const char *user,
                     uid_t auth_uid)
{
  struct sockaddr *peer = NULL;
  socklen_t peer_len;
  char *challenge = NULL;
  char *secret = NULL;
  char *response = NULL;
  char *nonce = NULL;
  int res = 0;
  int ret;

  ret = PAM_CRED_INSUFFICIENT;

  /* We'll never try to reauthorize root */
  if (auth_uid == 0)
    {
      debug ("not reauthorizing: root user");
      goto out;
    }

  if (getuid () != auth_uid)
    {
      debug ("not reauthorizing: different user");
      goto out;
    }

  res = lookup_reauthorize_sockaddr (&peer, &peer_len);
  if (res != PAM_SUCCESS)
    goto out;

  ret = PAM_SYSTEM_ERR;

  res = lookup_reauthorize_secret (user, &secret);
  if (res != PAM_SUCCESS)
    goto out;

  res = build_reauthorize_challenge (user, secret, &nonce, &challenge);
  if (res != PAM_SUCCESS)
    goto out;

  res = perform_reauthorize_chat (peer, peer_len, challenge, &response);
  if (res != PAM_SUCCESS)
    goto out;

  res = 0;
  ret = perform_reauthorize_validate (user, nonce, secret, response);

out:
  if (ret == PAM_SYSTEM_ERR && res != PAM_SUCCESS)
    ret = res;

  _reauthorize_secfree (secret, -1);
  _reauthorize_secfree (response, -1);
  free (challenge);
  free (peer);
  free (nonce);

  return ret;
}

/* ----------------------------------------------------------------------------
 * PAM module callbacks
 */

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
          args |= ARG_PREPARE;
        }
      else if (strcmp (argv[i], "perform") == 0)
        {
          args |= ARG_PERFORM;
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

  return args;
}

PAM_EXTERN int
pam_sm_authenticate (pam_handle_t *pamh,
                     int flags,
                     int argc,
                     const char *argv[])
{
  const char *user;
  uid_t auth_uid;
  int args;
  int ret;

  /* We only work if the process is running as root */
  if (geteuid () != 0)
    {
      debug ("skipping module, not running with root privileges");
      return PAM_USER_UNKNOWN;
    }

  /* Lookup the user */
  ret = pam_get_user (pamh, &user, NULL);
  if (ret != PAM_SUCCESS)
    {
      message ("couldn't get pam user: %s", pam_strerror (pamh, ret));
      return ret;
    }
  ret = lookup_user_uid (user, &auth_uid);
  if (ret != PAM_SUCCESS)
    return ret;

  args = parse_args (argc, argv);
  if (args & ARG_PREPARE)
    {
      begin_reauthorize_prep (pamh, user, auth_uid);

      /* No we're not authenticating the user here */
      return PAM_CRED_INSUFFICIENT;
    }
  else if (args & ARG_PERFORM)
    {
      return perform_reauthorize (pamh, user, auth_uid);
    }
  else
    {
      message ("neither the prepare or perform argument was set");
      return PAM_CRED_INSUFFICIENT;
    }
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
  int args;

  /* Lookup the user */
  ret = pam_get_user (pamh, &user, NULL);
  if (ret != PAM_SUCCESS)
    {
      message ("couldn't get pam user: %s", pam_strerror (pamh, ret));
      return ret;
    }

  args = parse_args (argc, argv);

  if (args & ARG_PREPARE)
    complete_reauthorize_prep (pamh, user);

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

#include "reauthutil.c"
