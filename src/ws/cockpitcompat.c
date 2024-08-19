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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

#include "config.h"

#include "cockpitcompat.h"

#include "common/cockpitauthorize.h"
#include "common/cockpitmemory.h"

#include <glib.h>

#include <assert.h>
#include <ctype.h>
#include <crypt.h>
#include <errno.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static void
secfree (void *data,
         ssize_t len)
{
  if (!data)
    return;

  cockpit_memory_clear (data, len);
  g_free (data);
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

char *
cockpit_compat_reply_crypt1 (const char *challenge,
                             const char *password)
{
  struct crypt_data *cd = NULL;
  char *response = NULL;
  char *nonce = NULL;
  char *salt = NULL;
  const char *npos;
  const char *spos;
  char *secret;
  char *resp;
  int errn = 0;

  challenge = cockpit_authorize_subject (challenge, NULL);
  if (!challenge)
    return NULL;

  npos = challenge;
  spos = strchr (npos, ':');

  if (spos == NULL)
    {
      g_message ("couldn't parse \"authorize\" message \"challenge\"");
      errn = EINVAL;
      goto out;
    }

  nonce = g_strndup (npos, spos - npos);
  salt = g_strdup (spos + 1);

  if (parse_salt (nonce) < 0 ||
      parse_salt (salt) < 0)
    {
      g_message ("\"authorize\" message \"challenge\" has bad nonce or salt");
      errn = EINVAL;
      goto out;
    }

  cd = g_new0 (struct crypt_data, 2);

  /*
   * This is what we're generating here:
   *
   * response = "crypt1:" crypt(crypt(password, salt), nonce)
   */

  secret = crypt_r (password, salt, cd + 0);
  if (secret == NULL)
    {
      errn = errno;
      g_message ("couldn't hash password via crypt: %m");
      goto out;
    }

  resp = crypt_r (secret, nonce, cd + 1);
  if (resp == NULL)
    {
      errn = errno;
      g_message ("couldn't hash secret via crypt: %m");
      goto out;
    }

  response = g_strdup_printf ("crypt1:%s", resp);

out:
  g_free (nonce);
  g_free (salt);
  secfree (cd, sizeof (struct crypt_data) * 2);

  if (!response)
    errno = errn;

  return response;
}
