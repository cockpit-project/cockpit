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

#define _GNU_SOURCE

#include "reauthorize.h"
#include "reauthutil.h"

#include <sys/socket.h>
#include <sys/types.h>
#include <sys/un.h>

#include <crypt.h>
#include <errno.h>
#include <keyutils.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define debug(format, ...) \
  do { if (verbose_mode) \
      message ("debug: " format, ##__VA_ARGS__); \
  } while (0)

static int verbose_mode = 0;
static void (* logger) (const char *data);

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

void
reauthorize_logger (void (* func) (const char *data),
                    int verbose)
{
  verbose_mode = verbose;
  logger = func;
}

int
reauthorize_listen (int flags,
                    int *sock)
{
  struct sockaddr_un addr;
  socklen_t addr_len;
  key_serial_t key;
  int have_addr = 0;
  int fd = -1;
  int ret;

  fd = socket (AF_UNIX, SOCK_SEQPACKET, 0);
  if (fd < 0)
    {
      ret = -errno;
      message ("couldn't open socket: %m");
      goto out;
    }

  if (flags & REAUTHORIZE_REPLACE)
    {
      key = keyctl_search (KEY_SPEC_SESSION_KEYRING, "user", "reauthorize/socket", 0);
      if (key < 0)
        {
          if (errno != ENOKEY)
            {
              ret = -errno;
              message ("couldn't search for socket address to replace: %m");
              goto out;
            }
        }
      else
        {
          addr_len = keyctl_read (key, (char *)&addr, sizeof (addr));
          if (addr_len < 0)
            {
              if (errno != ENOKEY)
                {
                  ret = -errno;
                  message ("couldn't read socket address to replace: %m");
                  goto out;
                }
            }
          else if (addr_len < sizeof (sa_family_t) || addr_len > sizeof (struct sockaddr_un))
            {
              ret = -EMSGSIZE;
              message ("socket address to replace was invalid");
              goto out;
            }
          have_addr = 1;
        }
    }

  /* The local address: autobind */
  if (!have_addr)
    {
      memset (&addr, 0, sizeof (addr));
      addr.sun_family = AF_UNIX;
      addr_len = sizeof (addr.sun_family);
    }

  if (bind (fd, &addr, addr_len) < 0)
    {
      ret = -errno;
      message ("couldn't bind socket: %m");
      goto out;
    }

  if (listen (fd, 64) < 0)
    {
      ret = -errno;
      message ("couldn't listen on socket: %m");
      goto out;
    }

  /* Dig out the automatically assigned address */
  if (!have_addr)
    {
      addr_len = sizeof (addr);
      if (getsockname (fd, &addr, &addr_len) < 0)
        {
          ret = -errno;
          message ("couldn't lookup socket address: %m");
          goto out;
        }

      if (add_key ("user", "reauthorize/socket", &addr, addr_len, KEY_SPEC_SESSION_KEYRING) < 0)
        {
          ret = -errno;
          message ("couldn't put socket address into keyring: %m");
          goto out;
        }
    }

  debug ("listening on reauthorize socket");

  ret = 0;
  *sock = fd;
  fd = -1;

out:
  if (fd != -1)
    close (fd);
  return ret;
}

int
reauthorize_accept (int sock,
                    int *connection)
{
  int conn = -1;
  int ret;

  conn = accept (sock, NULL, NULL);
  if (conn < 0)
    {
      ret = -errno;
      if (ret != -EINTR && ret != -EAGAIN)
        message ("couldn't accept reauthorize connection: %m");
      goto out;
    }

  debug ("accepted reauthorize connection");

  *connection = conn;
  conn = -1;
  ret = 0;

out:
  if (conn != -1)
    close (conn);
  return ret;
}

int
reauthorize_recv (int connection,
                  char **challenge)
{
  char *msg = NULL;
  socklen_t msg_len;
  ssize_t count;
  char dummy[2];
  int ret;

  for (msg = NULL, msg_len = 8192; 1; msg_len *= 2)
    {
      msg = _reauthorize_xrealloc (msg, msg_len);
      if (msg == NULL)
        {
          ret = -ENOMEM;
          message ("couldn't allocate response buffer");
          goto out;
        }

      count = recv (connection, msg, msg_len - 1, MSG_PEEK);

      if (count < 0)
        {
          ret = -errno;
          if (ret != -EAGAIN && ret != -EINTR)
            message ("couldn't read reauthorize message: %m");
          goto out;
        }
      else if (count != msg_len - 1)
        {
          if (memchr (msg, 0, count) != NULL)
            {
              ret = -EINVAL;
              message ("invalid null characters in reauthorize message");
              goto out;
            }
          msg[count] = '\0';

          /* Drain the peeked message */
          for (;;)
            {
              count = recv (connection, dummy, sizeof (dummy), 0);
              if (count < 0)
                {
                  if (errno == EINTR || errno == EAGAIN)
                    continue;
                  ret = -errno;
                  message ("couldn't drain reauthorize message: %m");
                  goto out;
                }
              break;
            }

          break;
        }
      else
        {
          /* try again if buffer was too small */
        }
    }

  debug ("received reauthorize challenge: %s", msg);

  *challenge = msg;
  msg = NULL;
  ret = 0;

out:
  free (msg);
  return ret;
}

int
reauthorize_send (int connection,
                  const char *response)
{
  size_t response_len;
  ssize_t count;
  int ret;

  response_len = strlen (response);

  count = send (connection, response, response_len, MSG_NOSIGNAL);
  if (count < 0)
    {
      ret = -errno;
      if (errno != EAGAIN && errno != EINTR)
        message ("couldn't send response message: %m");
      goto out;
    }
  if (count != response_len)
    {
      ret = -EMSGSIZE;
      message ("couldn't send response message: too long");
      goto out;
    }

  debug ("sent reauthorize response: %s", response);

  ret = 0;

out:
  return ret;
}

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

  ret = _reauthorize_unhex (beg, len, &result, &user_len);
  if (ret < 0)
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

  if (_reauthorize_parse_salt (nonce) < 0 ||
      _reauthorize_parse_salt (salt) < 0)
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
      message ("coudln't hash secret via crypt: %m");
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
  _reauthorize_secfree (cd, sizeof (struct crypt_data) * 2);

  return ret;
}
