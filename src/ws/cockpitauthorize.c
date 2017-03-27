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

#include "config.h"

#include "cockpitauthorize.h"

#include "common/cockpithex.h"
#include "common/cockpitmemory.h"

#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif

#include <crypt.h>
#include <errno.h>
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
cockpit_authorize_logger (void (* func) (const char *data),
                          int verbose)
{
  logger_verbose = verbose;
  logger = func;
}

static void
secfree (void *data,
         ssize_t len)
{
  if (!data)
    return;

  cockpit_memory_clear (data, len);
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

/* ----------------------------------------------------------------------------
 * Respond to challenges
 */

int
cockpit_authorize_type (const char *challenge,
                        char **type)
{
  const char *pos;
  char *val;

  pos = strchr (challenge, ':');
  if (pos == NULL || pos == challenge)
    {
      message ("invalid \"authorize\" message");
      return -EINVAL;
    }

  val = strndup (challenge, pos - challenge);
  if (val == NULL)
    {
      message ("couldn't allocate memory for \"authorize\" challenge");
      return -ENOMEM;
    }

  *type = val;
  return 0;
}

int
cockpit_authorize_user (const char *challenge,
                        char **user)
{
  const char *beg = NULL;
  void *result;
  size_t user_len;
  size_t len;

  beg = strchr (challenge, ':');
  if (beg != NULL)
    {
      beg++;
      len = strcspn (beg, ":");
    }

  if (beg == NULL)
    {
      message ("invalid \"authorize\" message \"challenge\": no type");
      return -EINVAL;
    }

  result = cockpit_hex_decode (beg, len, &user_len);
  if (!result)
    {
      message ("invalid \"authorize\" message \"challenge\": bad hex encoding");
      return -EINVAL;
    }
  if (memchr (result, '\0', user_len) != NULL)
    {
      free (result);
      message ("invalid \"authorize\" message \"challenge\": embedded nulls in user");
      return -EINVAL;
    }

  *user = result;
  return 0;
}

int
cockpit_authorize_crypt1 (const char *challenge,
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
      message ("\"authorize\" message \"challenge\" is not a crypt1");
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
      message ("couldn't parse \"authorize\" message \"challenge\"");
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
      message ("\"authorize\" message \"challenge\" has bad nonce or salt");
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
