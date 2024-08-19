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

#include "cockpitauthorize.h"
#include "cockpitbase64.h"
#include "cockpitmemory.h"

#include <assert.h>
#include <ctype.h>
#include <crypt.h>
#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
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

void *
cockpit_authorize_nonce (size_t length)
{
  unsigned char *key;
  int errn = 0;
  int fd;
  ssize_t read_bytes;
  ssize_t read_result;

  fd = open ("/dev/urandom", O_RDONLY, 0);
  if (fd < 0)
    return NULL;

  key = malloc (length);
  if (!key)
    {
      close (fd);
      errno = ENOMEM;
      return NULL;
    }

  read_bytes = 0;
  do
    {
      errno = 0;
      read_result = read (fd, key + read_bytes, length - read_bytes);
      if (read_result <= 0)
        {
          if (errno == EAGAIN || errno == EINTR)
              continue;
          errn = errno;
          break;
        }
      read_bytes += read_result;
    }
  while (read_bytes < length);
  close (fd);

  if (read_bytes < length)
    {
      free (key);
      key = NULL;
      errno = errn;
    }

  return key;
}

const char *
cockpit_authorize_type (const char *challenge,
                        char **type)
{
  size_t i, len = 0;

  /*
   * Either a space or a colon is the delimiter
   * that splits the type from the remainder
   * of the content.
   */
  if (challenge)
    len = strcspn (challenge, ": ");
  if (len == 0)
    {
      debug ("invalid \"authorize\" message");
      errno = EINVAL;
      return NULL;
    }

  if (type)
    {
      *type = strndup (challenge, len);
      if (*type == NULL)
        {
          message ("couldn't allocate memory for \"authorize\" challenge");
          errno = ENOMEM;
          return NULL;
        }
      for (i = 0; i < len; i++)
        (*type)[i] = tolower ((*type)[i]);
    }

  if (challenge[len])
    len++;
  while (challenge[len] == ' ')
    len++;
  return challenge + len;
}

const char *
cockpit_authorize_subject (const char *challenge,
                           char **subject)
{
  size_t len;

  challenge = cockpit_authorize_type (challenge, NULL);
  if (!challenge)
    return NULL;

  len = strcspn (challenge, ": ");
  if (len == 0)
    {
      message ("invalid \"authorize\" message \"challenge\": no subject");
      errno = EINVAL;
      return NULL;
    }

  if (subject)
    {
      *subject = strndup (challenge, len);
      if (!*subject)
        {
          message ("couldn't allocate memory for \"authorize\" message \"challenge\"");
          errno = ENOMEM;
          return NULL;
        }
    }

  if (challenge[len])
    len++;
  while (challenge[len] == ' ')
    len++;
  return challenge + len;
}

char *
cockpit_authorize_parse_basic (const char *challenge,
                               char **user)
{
  unsigned char *buf = NULL;
  char *type = NULL;
  size_t len;
  ssize_t res;
  int errn = 0;
  size_t off;

  challenge = cockpit_authorize_type (challenge, &type);
  if (!challenge)
    return NULL;

  if (strcmp (type, "basic") != 0)
    {
      message ("invalid prefix in Basic header");
      errn = EINVAL;
      goto out;
    }

  len = strcspn (challenge, " ");
  buf = malloc (len + 1);
  if (!buf)
    {
      message ("couldn't allocate memory for Basic header");
      errn = ENOMEM;
      goto out;
    }

  /* No value */
  if (len == 0)
    {
      buf[0] = 0;
      if (user)
        *user = NULL;
      goto out;
    }

  /* Decode and find split point */
  res = cockpit_base64_pton (challenge, len, buf, len);
  if (res < 0)
    {
      message ("invalid base64 data in Basic header");
      errn = EINVAL;
      goto out;
    }
  assert (res <= len);
  buf[res] = 0;

  off = strcspn ((char *)buf, ":");
  if (off == res)
    {
      message ("invalid base64 data in Basic header");
      errn = EINVAL;
      goto out;
    }

  if (user)
    {
      *user = strndup ((char *)buf, off);
      if (!*user)
        {
          message ("couldn't allocate memory for user name");
          errn = ENOMEM;
          goto out;
        }
    }

  memmove (buf, buf + off + 1, res - off);

out:
  free (type);
  if (errn != 0)
    {
      errno = errn;
      free (buf);
      buf = NULL;
    }
  return (char *)buf;
}

char *
cockpit_authorize_build_basic (const char *user,
                               const char *password)
{
  char *content = NULL;
  char *encoded = NULL;
  char *response = NULL;
  size_t elen, clen;
  int errn = 0;

  if (!user)
    user = "";
  if (!password)
    password = "";

  if (asprintf (&content, "%s:%s", user, password) < 0)
    {
      errn = errno;
      message ("could not build basic response");
      goto out;
    }

  clen = strlen (content);
  elen = cockpit_base64_size (clen);
  encoded = malloc (elen + 1);
  if (!encoded)
    {
      errn = ENOMEM;
      message ("could not allocate memory for basic response");
      goto out;
    }
  if (cockpit_base64_ntop ((unsigned char *)content, clen, encoded, elen) < 0)
    {
      errn = errno;
      message ("could not encode basic response");
      goto out;
    }

  if (asprintf (&response, "Basic %s", encoded) < 0)
    {
      errn = errno;
      message ("could not build basic response");
      response = NULL;
      goto out;
    }

out:
  free (encoded);
  if (content)
    cockpit_memory_clear (content, -1);
  free (content);
  if (!response)
     errno = errn;
  return response;
}

void *
cockpit_authorize_parse_negotiate (const char *challenge,
                                   size_t *length)
{
  unsigned char *buf = NULL;
  size_t len;
  ssize_t res;
  int negotiate;
  char *type;

  challenge = cockpit_authorize_type (challenge, &type);
  if (!challenge)
    return NULL;

  negotiate = strcmp (type, "negotiate") == 0;
  free (type);

  if (!negotiate)
    {
      message ("invalid prefix in Negotiate header");
      errno = EINVAL;
      return NULL;
    }

  len = strcspn (challenge, " ");
  buf = malloc (len + 1);
  if (!buf)
    {
      message ("couldn't allocate memory for Negotiate header");
      errno = ENOMEM;
      return NULL;
    }

  /* Decode data */
  res = cockpit_base64_pton (challenge, len, buf, len);
  if (res < 0)
    {
      message ("invalid base64 data in Negotiate header");
      free (buf);
      errno = EINVAL;
      return NULL;
    }

  if (length)
    *length = res;
  return buf;
}

char *
cockpit_authorize_build_negotiate (const void *input,
                                   size_t length)
{
  char *encoded = NULL;
  char *response = NULL;
  size_t elen;
  int errn = 0;

  if (!input)
    length = 0;

  if (length > 0)
    {
      elen = cockpit_base64_size (length);
      encoded = malloc (elen);
      if (!encoded)
        {
          errn = ENOMEM;
          message ("could not allocate memory for negotiate challenge");
          goto out;
        }
      if (cockpit_base64_ntop ((unsigned char *)input, length, encoded, elen) < 0)
        {
          errn = errno;
          message ("could not encode negotiate prompt");
          goto out;
        }
    }

  if (asprintf (&response, "Negotiate%s%s", encoded ? " " : "", encoded ? encoded : "") < 0)
    {
      errn = errno;
      message ("could not build negotiate challenge");
      response = NULL;
      goto out;
    }

out:
  free (encoded);
  if (!response)
     errno = errn;
  return response;
}

char *
cockpit_authorize_parse_x_conversation (const char *challenge,
                                        char **conversation)
{
  unsigned char *buf = NULL;
  int x_conversation;
  char *type;
  size_t len;
  ssize_t res;

  if (!cockpit_authorize_type (challenge, &type))
    return NULL;

  x_conversation = strcmp (type, "x-conversation") == 0;
  free (type);

  if (!x_conversation)
    {
      message ("invalid prefix in X-Conversation header");
      errno = EINVAL;
      return NULL;
    }

  challenge = cockpit_authorize_subject (challenge, conversation);
  if (!challenge)
    return NULL;

  len = strcspn (challenge, " ");
  buf = malloc (len + 1);
  if (!buf)
    {
      message ("couldn't allocate memory for X-Conversation header");
      errno = ENOMEM;
      return NULL;
    }

  res = cockpit_base64_pton (challenge, len, buf, len);
  if (res < 0)
    {
      message ("invalid base64 data in X-Conversation header");
      free (buf);
      errno = EINVAL;
      return NULL;
    }

  /* Null terminate the thing */
  buf[res] = '\0';
  return (char *)buf;
}

char *
cockpit_authorize_build_x_conversation (const char *prompt,
                                        char **conversation)
{
  const size_t nlen = 128;
  unsigned char *nonce = NULL;
  char *encoded = NULL;
  char *response = NULL;
  char *conv = NULL;
  size_t plen, elen, clen;
  char *alloc = NULL;
  int errn = 0;

  if (!prompt)
    prompt = "";

  /* Reuse a conversation we get */
  if (conversation)
    conv = *conversation;

  if (!conv)
    {
      nonce = cockpit_authorize_nonce (nlen);
      if (!nonce)
        {
          errn = errno;
          message ("could not generate nonce");
          goto out;
        }

      clen = cockpit_base64_size (nlen);
      conv = alloc = malloc (clen);
      if (!conv)
        {
          errn = ENOMEM;
          message ("could not allocate memory for conversation");
          goto out;
        }
      if (cockpit_base64_ntop (nonce, nlen, conv, clen) < 0)
        {
          errn = errno;
          message ("could not encode conversation nonce");
          goto out;
        }
    }

  if (strlen (conv) == 0)
    {
      message ("invalid conversation nonce");
      errn = EINVAL;
      goto out;
    }

  plen = strlen (prompt);
  if (plen > 0)
    {
      elen = cockpit_base64_size (plen);
      encoded = malloc (elen);
      if (!encoded)
        {
          errn = ENOMEM;
          message ("could not allocate memory for conversation");
          goto out;
        }
      if (cockpit_base64_ntop ((unsigned char *)prompt, plen, encoded, elen) < 0)
        {
          errn = errno;
          message ("could not encode conversation prompt");
          goto out;
        }
    }

  if (asprintf (&response, "X-Conversation %s%s%s", conv, encoded ? " " : "", encoded ? encoded : "") < 0)
    {
      errn = errno;
      message ("could not build conversation challenge");
      response = NULL;
      goto out;
    }

  if (conversation)
    {
      *conversation = conv;
      conv = alloc = NULL;
    }

out:
  free (nonce);
  free (alloc);
  free (encoded);
  if (!response)
     errno = errn;
  return response;
}
