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

#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif

#include "reauthorize.h"

#include <sys/socket.h>
#include <sys/types.h>
#include <sys/un.h>

#include <assert.h>
#include <crypt.h>
#include <errno.h>
#include <fcntl.h>
#include <keyutils.h>
#include <shadow.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

/* ----------------------------------------------------------------------------
 * Tools
 */

#ifndef debug
#define debug(format, ...) \
  do { if (logger_verbose) \
      message ("debug: " format, ##__VA_ARGS__); \
  } while (0)
#endif

static int logger_verbose = 0;
static void (* logger) (const char *data);

#ifndef message
#if __GNUC__ > 2
static void
message (const char *format, ...)
__attribute__((__format__(__printf__, 1, 2)));
#endif

static void
message (const char *format, ...)
{
  va_list va;
  char *data;
  int res;

  if (!logger)
    return;

  /* Fast path for simple messages */
  if (!strchr (format, '%'))
    {
      logger (format);
      return;
    }

  va_start (va, format);
  res = vasprintf (&data, format, va);
  va_end (va);

  if (res < 0)
    {
      logger ("out of memory printing message");
      return;
    }

  logger (data);
  free (data);
}
#endif

void
reauthorize_logger (void (* func) (const char *data),
                    int verbose)
{
  logger_verbose = verbose;
  logger = func;
}

static const char HEX[] = "0123456789abcdef";

static int
hex_encode (const void *data,
            ssize_t len,
            char **hex)
{
  const unsigned char *in = data;
  char *out;
  size_t i;

  if (len < 0)
    len = strlen (data);

  out = malloc (len * 2 + 1);
  if (out == NULL)
    return -ENOMEM;

  for (i = 0; i < len; i++)
    {
      out[i * 2] = HEX[in[i] >> 4];
      out[i * 2 + 1] = HEX[in[i] & 0xf];
    }
  out[i * 2] = '\0';
  *hex = out;
  return 0;
}

static int
hex_decode (const char *hex,
            ssize_t len,
            void **data,
            size_t *data_len)
{
  const char *hpos;
  const char *lpos;
  char *out;
  int i;

  if (len < 0)
    len = strlen (hex);
  if (len % 2 != 0)
    return -EINVAL;

  out = malloc (len * 2 + 1);
  if (out == NULL)
    return -ENOMEM;

  for (i = 0; i < len / 2; i++)
    {
      hpos = strchr (HEX, hex[i * 2]);
      lpos = strchr (HEX, hex[i * 2 + 1]);
      if (hpos == NULL || lpos == NULL)
        {
          free (out);
          return -EINVAL;
        }
      out[i] = ((hpos - HEX) << 4) | ((lpos - HEX) & 0xf);
    }

  /* A convenience null termination */
  out[i] = '\0';

  *data = out;
  *data_len = i;
  return 0;
}

int _reauthorize_drain = 0;

static void
secfree (void *data,
         ssize_t len)
{
  volatile char *vp;

  if (!data)
    return;

  if (len < 0)
    len = strlen (data);

  /* Defeats some optimizations */
  memset (data, 0xAA, len);
  memset (data, 0xBB, len);

  /* Defeats others */
  vp = (volatile char*)data;
  while (len--)
    {
      _reauthorize_drain |= *vp;
      *(vp++) = 0xAA;
    }

  free (data);
}

static ssize_t
parse_salt (const char *input)
{
  const char *pos;
  const char *end;

  /*
   * Parse a encrypted secret produced by crypt() using one
   * of the additional algorithms. Return the length of
   * the salt or -1.
   */

  if (input[0] != '$')
    return -1;
  pos = strchr (input + 1, '$');
  if (pos == NULL || pos == input + 1)
    return -1;
  end = strchr (pos + 1, '$');
  if (end == NULL || end < pos + 8)
    return -1;

  /* Full length of the salt */
  return (end - input) + 1;
}

static int
generate_salt (char **salt)
{
  static const char set[] = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789./";
  static const char random[] = "/dev/urandom";
  static const char prefix[] = "$6$";
  static const int salt_len = 16;

  unsigned char *data;
  char *buffer;
  ssize_t count;
  size_t length;
  size_t prefix_len;
  size_t set_len;
  int ret;
  int fd;
  int i;

  /*
   * We are making a string like this:
   *
   * $6$0123456789abcdef$
   */

  prefix_len = strlen (prefix);
  buffer = malloc (prefix_len + salt_len + 2);
  if (buffer == NULL)
    return -ENOMEM;

  fd = open (random, O_RDONLY);
  if (fd < 0)
    {
      ret = -errno;
      free (buffer);
      return ret;
    }

  /* Read binary data into appropriate place in buffer */
  length = salt_len;
  data = (unsigned char *)buffer + prefix_len;
  while (length > 0)
    {
      count = read (fd, data, length);
      if (count == 0)
        {
          /* Strange condition, but just in case */
          errno = EWOULDBLOCK;
          count = -1;
        }
      if (count < 0)
        {
          if (errno == EAGAIN || errno == EINTR)
            {
              count = 0;
            }
          else
            {
              ret = -errno;
              close (fd);
              free (buffer);
              return ret;
            }
        }
      assert (count <= length);
      data += count;
      length -= count;
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

  *salt = buffer;
  return 0;
}

/* ----------------------------------------------------------------------------
 * Prepare for later reauthorization
 */

int
reauthorize_prepare (const char *user,
                     const char *password,
                     long keyring,
                     long *out_key)
{
  struct crypt_data *cd = NULL;
  key_serial_t key;
  const char *secret;
  char *salt = NULL;
  ssize_t salt_len;
  char *name = NULL;
  key_perm_t perm;
  int ret;

  if (password == NULL)
    {
      debug ("no password available for user %s", user);
      return 0;
    }

  /* The salt already contains algorithm prefix and suffix */
  ret = generate_salt (&salt);
  if (ret < 0)
    {
      message ("couldn't generate crypt salt: %m");
      goto out;
    }

  cd = calloc (1, sizeof (struct crypt_data));
  if (!cd)
    {
      message ("couldn't allocate crypt data");
      ret = -ENOMEM;
      goto out;
    }

  secret = crypt_r (password, salt, cd);
  if (!secret)
    {
      ret = -errno;
      message ("couldn't crypt reauthorize secret: %m");
      goto out;
    }

  /*
   * Double check that our assumptions about crypt() work
   * as expected. We're later going to be sending away the
   * salt as a challenge, so guarantee that it works.
   */

  salt_len = parse_salt (secret);
  if (salt_len != strlen (salt) || memcmp (secret, salt, salt_len) != 0)
    {
      ret = -EINVAL;
      message ("got invalid result from crypt");
      goto out;
    }

  if (asprintf (&name, "reauthorize/secret/%s", user) < 0)
    {
      ret = -ENOMEM;
      message ("couldn't allocate keyring name");
      goto out;
    }

  /*
   * Don't put our secret into the session keyring until the permissions
   * are strong enough. Since we want that to be atomic, first store in
   * our thread keyring, and then link below.
   */
  if (keyring == 0)
    keyring = KEY_SPEC_SESSION_KEYRING;

  key = add_key ("user", name, "xxx", 3, keyring);
  if (key < 0)
    {
      ret = -errno;
      message ("couldn't create key in kernel session keyring: %s: %m", name);
      goto out;
    }

  /* Set permissions, and double check that what we expect happened */
  perm = KEY_USR_VIEW | KEY_USR_READ | KEY_USR_WRITE | KEY_USR_SEARCH | KEY_USR_LINK;
  if (keyctl_setperm (key, perm) < 0)
    {
      ret = -errno;
      message ("couldn't set permissions on kernel key: %s: %m", name);
      goto out;
    }

  if (keyctl_update (key, secret, strlen (secret)))
    {
      ret = -errno;
      message ("couldn't update secret reauthorize key in kernel keyring: %s: %m", name);
      goto out;
    }

  debug ("placed secret in kernel session keyring");
  *out_key = key;
  ret = 0;

out:
  secfree (cd, sizeof (struct crypt_data));
  free (name);
  free (salt);
  return ret;
}

/* ----------------------------------------------------------------------------
 * Perform reauthorization
 */

static int
build_reauthorize_challenge (const char *user,
                             const char *secret,
                             char **challenge)
{
  int ret;
  char *nonce = NULL;
  char *hex = NULL;
  ssize_t salt_len;
  int len;

  salt_len = parse_salt (secret);
  if (salt_len < 0)
    {
      message ("ignoring invalid reauthorize secret");
      ret = -EINVAL;
      goto out;
    }

  ret = generate_salt (&nonce);
  if (ret < 0)
    {
      errno = -ret;
      message ("unable to generate crypt salt: %m");
      goto out;
    }

  ret = hex_encode (user, -1, &hex);
  if (ret < 0)
    {
      errno = -ret;
      message ("couldn't encode user as hex: %m");
      goto out;
    }

  len = asprintf (challenge, "crypt1:%s:%s:%.*s", hex, nonce, (int)salt_len, secret);
  if (len < 0)
    {
      message ("failed to allocate challenge");
      ret = -ENOMEM;
      goto out;
    }

  /* Double check that we didn't include the whole secret */
  assert ((*challenge)[len - 1] == '$');
  assert (strstr (*challenge, secret) == NULL);
  ret = 0;

out:
  free (nonce);
  free (hex);
  return ret;
}

static int
perform_reauthorize_validate (const char *user,
                              const char *secret,
                              const char *response)
{
  struct crypt_data *cd = NULL;
  char *nonce = NULL;
  const char *check;
  ssize_t nonce_len;
  int ret;

  assert (user != NULL);
  assert (secret != NULL);
  assert (response != NULL);

  if (strncmp (response, "crypt1:", 7) != 0)
    {
      message ("received invalid response");
      ret = -EINVAL;
      goto out;
    }
  response += 7;

  nonce_len = parse_salt (response);
  if (nonce_len < 0)
    {
      message ("ignoring invalid reauthorize response");
      ret = -EINVAL;
      goto out;
    }

  nonce = strndup (response, nonce_len);
  if (!nonce)
    {
      message ("couldn't allocate memory for nonce");
      ret = -ENOMEM;
      goto out;
    }

  cd = calloc (1, sizeof (struct crypt_data));
  if (cd == NULL)
    {
      message ("couldn't allocate crypt data context");
      ret = -ENOMEM;
      goto out;
    }

  check = crypt_r (secret, nonce, cd);
  if (check == NULL)
    {
      ret = -errno;
      message ("couldn't crypt data: %m");
      goto out;
    }

  debug ("expected response is: %s", check);

  if (strcmp (check, response) != 0)
    {
      ret = REAUTHORIZE_NO;
      message ("user %s reauthorization failed", user);
      goto out;
    }

  message ("user %s was reauthorized", user);
  ret = REAUTHORIZE_YES;

out:
  free (nonce);
  secfree (cd, sizeof (struct crypt_data));
  return ret;
}

static int
lookup_reauthorize_secret (const char *user,
                           char **secret)
{
  char *buffer = NULL;
  char *name = NULL;
  key_serial_t key;
  int ret;

  if (asprintf (&name, "reauthorize/secret/%s", user) < 0)
    {
      message ("failed to allocate secret name");
      ret = -ENOMEM;
      goto out;
    }

  key = keyctl_search (KEY_SPEC_SESSION_KEYRING, "user", name, 0);
  if (key < 0)
    {
      /* missing key or revoked key is not an error */
      if (errno == ENOKEY || errno == EKEYREVOKED)
        {
          ret = 0;
          *secret = NULL;
          goto out;
        }

      ret = -errno;
      message ("failed to lookup reauthorize secret key: %s: %m", name);
      goto out;
    }

  if (keyctl_describe_alloc (key, &buffer) < 0)
    {
      ret = -errno;
      message ("couldn't describe reauthorize secret key: %s: %m", name);
      goto out;
    }
  if (strncmp (buffer, "user;0;0;001f0000;", 18) != 0)
    {
      ret = -EPERM;
      message ("kernel reauthorize secret key has invalid permissions: %s: %s", name, buffer);
      goto out;
    }

  /* null-terminates */
  if (keyctl_read_alloc (key, (void **)secret) < 0)
    {
      ret = -errno;
      message ("couldn't read kernel reauthorize secret key: %s: %m", name);
      goto out;
    }

  ret = 0;

out:
  free (buffer);
  free (name);
  return ret;
}

static struct spwd *
getspnam_a (const char *name)
{
  int err;
  long bufsize = sysconf (_SC_GETPW_R_SIZE_MAX);
  struct spwd *ret = NULL;
  struct spwd *buf;

  if (bufsize <= 0)
    bufsize = 8192;

  buf = malloc (sizeof(struct spwd) + bufsize);
  if (buf == NULL)
    {
      errno = ENOMEM;
      return NULL;
    }

  err = getspnam_r (name, buf, (char *)(buf + 1), bufsize, &ret);

  if (ret == NULL)
    {
      free (buf);
      if (err == 0)
        err = ENOENT;
      errno = err;
    }

  return ret;
}

static int
lookup_shadow_secret (const char *user,
                      char **secret)
{
  struct spwd *sp;

  sp = getspnam_a (user);
  if (!sp)
    {
      if (errno == ENOENT)
        {
          debug ("no shadow for user: %s", user);
          return 0;
        }
      else
        {
          message ("couldn't lookup shadow entry for user: %s: %m", user);
          return -errno;
        }
    }

  if (!sp->sp_pwdp || parse_salt (sp->sp_pwdp) < 0)
    {
      debug ("no valid salted password hash in shadow for user: %s", user);
      free (sp);
      return 0;
    }

  memmove (sp, sp->sp_pwdp, strlen (sp->sp_pwdp) + 1);
  *secret = (char *)sp;
  return 0;
}

int
reauthorize_perform (const char *user,
                     const char *response,
                     char **challenge)
{
  char *secret = NULL;
  int ret;

  if (!user || !challenge)
    {
      message ("bad arguments");
      ret = -EINVAL;
      goto out;
    }

  if (response != NULL &&
      strcmp (response, "") == 0)
    {
      debug ("reauthorize was cancelled");
      *challenge = NULL;
      ret = REAUTHORIZE_NO;
      goto out;
    }

  ret = lookup_reauthorize_secret (user, &secret);
  if (ret < 0)
    goto out;

  if (secret == NULL)
    {
      ret = lookup_shadow_secret (user, &secret);
      if (ret < 0)
        goto out;
    }

  /* This is where we'll plug in GSSAPI auth */
  if (secret == NULL)
    {
      debug ("no reauthorize secret available");
      *challenge = NULL;
      ret = REAUTHORIZE_NO;
    }
  else if (response == NULL)
    {
      ret = build_reauthorize_challenge (user, secret, challenge);
    }
  else if (strcmp (response, ""))
    {
      ret = perform_reauthorize_validate (user, secret, response);
    }

out:
  secfree (secret, -1);
  return ret;
}

/* ----------------------------------------------------------------------------
 * Respond to challenges
 */

int
reauthorize_type (const char *challenge,
                  char **type)
{
  const char *pos;
  char *val;

  pos = strchr (challenge, ':');
  if (pos == NULL || pos == challenge)
    {
      message ("invalid reauthorize challenge");
      return -EINVAL;
    }

  val = strndup (challenge, pos - challenge);
  if (val == NULL)
    {
      message ("couldn't allocate memory for challenge field");
      return -ENOMEM;
    }

  *type = val;
  return 0;
}

int
reauthorize_user (const char *challenge,
                  char **user)
{
  const char *beg = NULL;
  void *result;
  size_t user_len;
  size_t len;
  int ret;

  beg = strchr (challenge, ':');
  if (beg != NULL)
    {
      beg++;
      len = strcspn (beg, ":");
    }

  if (beg == NULL)
    {
      message ("invalid reauthorize challenge: no type");
      return -EINVAL;
    }

  ret = hex_decode (beg, len, &result, &user_len);
  if (ret != 0)
    {
      message ("invalid reauthorize challenge: bad hex encoding");
      return ret;
    }
  if (memchr (result, '\0', user_len) != NULL)
    {
      free (result);
      message ("invalid reauthorize challenge: embedded nulls in user");
      return -EINVAL;
    }

  *user = result;
  return 0;
}

int
reauthorize_crypt1 (const char *challenge,
                    const char *password,
                    char **response)
{
  struct crypt_data *cd = NULL;
  char *nonce = NULL;
  char *salt = NULL;
  const char *npos;
  const char *spos;
  char *secret;
  char *resp;
  int ret;

  if (strncmp (challenge, "crypt1:", 7) != 0)
    {
      message ("reauthorize challenge is not a crypt1");
      ret = -EINVAL;
      goto out;
    }
  challenge += 7;

  spos = NULL;
  npos = strchr (challenge, ':');
  if (npos != NULL)
    {
      npos++;
      spos = strchr (npos, ':');
    }

  if (npos == NULL || spos == NULL)
    {
      ret = -EINVAL;
      message ("couldn't parse reauthorize challenge");
      goto out;
    }

  nonce = strndup (npos, spos - npos);
  salt = strdup (spos + 1);
  if (!nonce || !salt)
    {
      ret = -ENOMEM;
      message ("couldn't allocate memory for challenge fields");
      goto out;
    }

  if (parse_salt (nonce) < 0 ||
      parse_salt (salt) < 0)
    {
      message ("reauthorize challenge has bad nonce or salt");
      ret = -EINVAL;
      goto out;
    }

  cd = calloc (2, sizeof (struct crypt_data));
  if (cd == NULL)
    {
      message ("couldn't allocate crypt data");
      ret = -ENOMEM;
      goto out;
    }

  /*
   * This is what we're generating here:
   *
   * response = "crypt1:" crypt(crypt(password, salt), nonce)
   */

  secret = crypt_r (password, salt, cd + 0);
  if (secret == NULL)
    {
      ret = -errno;
      message ("couldn't hash password via crypt: %m");
      goto out;
    }

  resp = crypt_r (secret, nonce, cd + 1);
  if (resp == NULL)
    {
      ret = -errno;
      message ("couldn't hash secret via crypt: %m");
      goto out;
    }

  if (asprintf (response, "crypt1:%s", resp) < 0)
    {
      ret = -ENOMEM;
      message ("couldn't allocate response");
      goto out;
    }

  ret = 0;

out:
  free (nonce);
  free (salt);
  secfree (cd, sizeof (struct crypt_data) * 2);

  return ret;
}
