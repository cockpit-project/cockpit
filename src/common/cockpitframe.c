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

#include "cockpitframe.h"

#include <assert.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define MAX_FRAME_SIZE_BYTES 7

/**
 * cockpit_frame_parse:
 * @input: An buffer of bytes
 * @length: The length of @input buffer
 * @consumed: Number of bytes consumed from @input
 *
 * Parse message framing length string from the top
 * of the @input buffer. These are used by Cockpit transport framing
 * over a stream based protocol.
 *
 * Returns: The length, zero if more data is needed, or -1 if an error.
 */
ssize_t
cockpit_frame_parse (unsigned char *input,
                     size_t length,
                     size_t *consumed)
{
  size_t size = 0;
  size_t i;

  assert (input != NULL || length == 0);

  size = 0;
  for (i = 0; i < length; i++)
    {
      /* Check invalid characters, prevent integer overflow, limit max length */
      if (i > MAX_FRAME_SIZE_BYTES || (char)(input[i]) < '0' || (char)(input[i]) > '9')
        break;
      size *= 10;
      size += (char)(input[i]) - '0';
    }

  /* Want more data */
  if (i == length)
    return 0;

  /* A failure */
  if (size == 0 || input[i] != '\n')
    return -1;

  if (consumed)
    *consumed = i + 1;
  return size;
}

ssize_t
cockpit_fd_write_all (int fd,
           unsigned char *data,
           size_t length)
{
  ssize_t written = 0;
  ssize_t res;

  assert (data != NULL || length == 0);

  while (length > 0)
    {
      res = write (fd, data, length);
      if (res < 0)
        {
          if (errno != EAGAIN && errno != EINTR)
            return -1;
        }
      else
        {
          data += res;
          length -= res;
          written += res;
        }
    }

  return written;
}

ssize_t
cockpit_frame_write (int fd,
                     unsigned char *input,
                     size_t length)
{
  char *prefix = NULL;
  ssize_t ret = -1;
  int errn = 0;

  assert (length > 0);
  assert (input != NULL);

  if (asprintf (&prefix, "%u\n", (unsigned int)length) < 0)
    {
      errn = ENOMEM;
      goto out;
    }

  ret = cockpit_fd_write_all (fd, (unsigned char *)prefix, strlen (prefix));
  if (ret > 0)
    ret = cockpit_fd_write_all (fd, input, length);
  if (ret < 0)
    errn = errno;

out:
  free (prefix);
  if (ret < 0)
    errno = errn;
  return ret;
}

static void *
xrealloc (void *old,
          size_t length)
{
  void *data = realloc (old, length);
  if (!data && length > 0)
    free (old);
  return data;
}

ssize_t
cockpit_frame_read (int fd,
                    unsigned char **output)
{
  ssize_t size = 0;
  size_t skip;
  ssize_t res;
  int errn = 0;
  ssize_t ret = -1;

  unsigned char *buf = NULL;
  size_t buflen = 0;
  size_t allocated = 0;

  while (size == 0 || buflen < size)
    {
      /* Reallocate */
      if (buflen + 1 > allocated)
        {
          allocated = size;
          if (allocated < buflen + 128)
            allocated = buflen + 128;
          buf = xrealloc (buf, allocated);
          if (!buf)
            {
              errn = ENOMEM;
              goto out;
            }
        }

      res = read (fd, buf + buflen, 1);
      if (res < 0 && errno == ECONNRESET && buflen == 0)
        res = 0;
      if (res < 0)
        {
          /* A read failure */
          if (errno != EINTR || errno != EAGAIN)
            {
              errn = errno;
              goto out;
            }
        }
      else if (res == 0)
        {
          /* No message parsed, but also no data received */
          if (size == 0 && buflen == 0)
            ret = 0;
          else
            errn = EBADMSG;
          goto out;
        }
      else if (res > 0)
        {
          buflen += 1;
        }

      /* Parse the length if necessary */
      if (size == 0)
        {
          assert (buf != NULL);
          size = cockpit_frame_parse (buf, buflen, &skip);
          if (size > 0)
            {
              assert (buflen >= skip);
              if (buflen > skip)
                memmove (buf, buf + skip, buflen - skip);
              buflen -= skip;
            }
        }

      if (size < 0)
        {
          errn = EBADMSG;
          goto out;
        }
    }

  if (output)
    {
      *output = buf;
      buf = NULL;
    }
  ret = size;

out:
  free (buf);
  if (ret < 0)
    errno = errn;
  return ret;
}
