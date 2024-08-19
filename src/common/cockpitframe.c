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

#include "cockpitframe.h"

#include <assert.h>
#include <errno.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define MAX_FRAME_SIZE_BYTES 8

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
      if (i >= MAX_FRAME_SIZE_BYTES || (char)(input[i]) < '0' || (char)(input[i]) > '9')
        break;
      size *= 10;
      size += (char)(input[i]) - '0';
    }

  /* Want more data */
  if (i == length)
    return 0;

  /* Improperly formatted if any of the following cases:
   *   - no digits read
   *   - digits not followed by newline
   *   - size had a leading zero
   */
  if (size == 0 || input[i] != '\n' || input[0] == '0')
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

/* read_exactly:
 * @fd: a blocking file descriptor
 * @buffer: where to read to
 * @required_size: the exact number of bytes to read
 * @was_eof: if EOF was encountered
 *
 * Reads exactly @required_size bytes from @fd into @buffer.  If the
 * correct number of bytes are read, then %TRUE is returned.
 *
 * On failure, returns %FALSE.  If the failure was due to an underlying
 * read error, then this error will be stored into errno.  If the
 * failure was due to an incorrect number of bytes being read, then
 * errno will be set to %EBADMSG.
 *
 * The only permitted exception is if @was_eof is non-%NULL.  In that
 * case, if exactly 0 bytes are read from @fd (ie: EOF at the start of
 * the message) then @was_eof will be set to %TRUE and the call will
 * return successfully.  Otherwise, @was_eof will be set to %FALSE on
 * successful completion.
 *
 * If the required number of bytes couldn't be read, then any number of
 * bytes may have been read from @fd.  The only reasonable thing to do
 * at this point is to treat the connection as broken, and close @fd.
 * In particular, this is why @fd should never be non-blocking.
 */
static bool
read_exactly (int fd,
              unsigned char *buffer,
              size_t required_size,
              bool *was_eof)
{
  size_t offset = 0;

  while (offset < required_size)
    {
      ssize_t n = read (fd, buffer + offset, required_size - offset);
      if (n == -1)
        {
          if (errno == EINTR)
            continue;

          if (errno != ECONNRESET)
            return false;

          /* ECONNRESET is treated as EOF */
          n = 0;
        }

      if (n == 0)
        {
          if (was_eof != NULL && offset == 0)
            {
              *was_eof = true;
              return true;
            }

          errno = EBADMSG;
          return false;
        }

      offset += n;
    }

  if (was_eof)
    *was_eof = false;

  return true;
}

ssize_t
cockpit_frame_read (int fd,
                    unsigned char **output)
{
  /* We first need to read the size of the frame, followed by the
   * content of the frame.  We want to do this efficiently as possible,
   * while avoiding to read() more than the frame (since we can't put
   * bytes back).  MSG_PEEK is also not always available, since we're
   * often talking to a pipe.
   *
   * Fortunately, we have a reasonable approach for this.
   *
   * Empty frames are invalid (cockpit_frame_parse() rejects size == 0),
   * so the smallest possible frame has a length of at least 3: the
   * single-digit size, the newline, then the single byte of body.
   * Therefore it's always safe to read 3 bytes ("the initial read").
   *
   * Conveniently, reading three bytes is also always enough to tell us
   * how many bytes it's safe to read in order to determine the size of
   * the frame:
   *
   *   - if we read a digit or two, followed by a newline, then we
   *     already know the size of the entire frame
   *
   *   - if we read three digits, we know that the frame body is at
   *     least 100 bytes long.  Since the maximum size of the length
   *     field is 8 (+1 for newline), we can safely read this entire
   *     amount.
   *
   *   - if we get something other than digits or newlines, it's an
   *     error
   */
  size_t n_read = 3;
  unsigned char headerbuf[MAX_FRAME_SIZE_BYTES + 1];
  bool eof;

  if (!read_exactly (fd, headerbuf, n_read, &eof))
    return -1;

  if (eof)
    {
      if (output)
        *output = NULL;
      return 0;
    }

  size_t n_consumed;
  ssize_t size = cockpit_frame_parse (headerbuf, n_read, &n_consumed);
  if (size == 0)
    {
      /* cockpit_frame_parse() asked to read more data.  As explained
       * above, it's safe to read the rest of the buffer now (6 bytes).
       * This should always result in a defined (non-zero) result.
       */
      if (!read_exactly (fd, headerbuf + n_read, sizeof headerbuf - n_read, NULL))
        return -1;

      n_read = sizeof headerbuf;
      size = cockpit_frame_parse (headerbuf, n_read, &n_consumed);
      assert (size != 0);
    }

  if (size == -1)
    {
      errno = EBADMSG;
      return -1;
    }

  /* We now have size equal to the number of bytes we need to return. */
  unsigned char *buffer = malloc (size);
  if (buffer == NULL)
    return -1; /* ENOMEM */

  /* Copy the non-consumed bytes from the header (might be zero) */
  size_t bytes_from_header = n_read - n_consumed;
  memcpy (buffer, headerbuf + n_consumed, bytes_from_header);

  /* Get the rest of the body (might be zero) */
  if (!read_exactly (fd, buffer + bytes_from_header, size - bytes_from_header, NULL))
    {
      free (buffer);
      return -1;
    }

  if (output)
    *output = buffer;
  else
    free (buffer);

  return size;
}
