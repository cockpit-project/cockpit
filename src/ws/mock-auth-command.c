/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
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

#include <err.h>
#include <errno.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <stdio.h>

#define AUTH_FD 3
#define EX 127

static char *
read_seqpacket_message (int fd)
{
  char *buf = NULL;
  int r;

  buf = realloc (buf, MAX_AUTH_BUFFER + 1);
  if (!buf)
    errx (EX, "couldn't allocate memory for data");

  /* Assume only one successful read needed
   * since this is a SOCK_SEQPACKET over AF_UNIX
   */
  for (;;)
    {
      r = read (fd, buf, MAX_AUTH_BUFFER);
      if (r < 0)
        {
          if (errno == EAGAIN)
            continue;

          err (EX, "couldn't read data");
        }
      else
        {
          break;
        }
    }

  if (r == 0) {
    free (buf);
    return NULL;
  }

  buf = realloc (buf, r + 1);
  if (!buf)
    errx (EX, "couldn't reallocate memory for data");

  buf[r] = '\0';
  return buf;
}

static void
write_resp (int fd,
            const char *data)
{
  int r;
  for (;;)
    {
      r = write (fd, data, strlen (data));
      if (r < 0)
        {
          if (errno == EAGAIN)
            continue;

          err (EX, "couldn't write auth data");
        }
      else
        {
          break;
        }
    }
}

int
main (int argc,
      char **argv)
{
  int success = 0;
  char *data = NULL;

  data = read_seqpacket_message (AUTH_FD);
  if (strcmp (data, "failslow") == 0)
    {
      sleep (2);
      write_resp (AUTH_FD, "{ \"error\": \"authentication-failed\" }");
    }
  else if (strcmp (data, "fail") == 0)
    {
      write_resp (AUTH_FD, "{ \"error\": \"authentication-failed\" }");
    }
  else if (strcmp (data, "denied") == 0)
    {
      write_resp (AUTH_FD, "{ \"error\": \"permission-denied\" }");
    }
  else if (strcmp (data, "success") == 0)
    {
      write_resp (AUTH_FD, "{\"user\": \"me\" }");
      success = 1;
    }
  else if (strcmp (data, "success-with-data") == 0)
    {
      write_resp (AUTH_FD, "{\"user\": \"me\", \"login-data\": { \"login\": \"data\"} }");
      success = 1;
    }
  else if (strcmp (data, "two-step") == 0)
    {
      free(data);
      write_resp (AUTH_FD, "{\"prompt\": \"type two\" }");
      data = read_seqpacket_message (AUTH_FD);
      if (!data || strcmp (data, "two") != 0)
        {
          write_resp (AUTH_FD, "{ \"error\": \"authentication-failed\" }");
        }
      else
        {
          write_resp (AUTH_FD, "{\"user\": \"me\" }");
          success = 1;
        }
    }
  else if (strcmp (data, "three-step") == 0)
    {
      free(data);
      write_resp (AUTH_FD, "{\"prompt\": \"type two\" }");
      data = read_seqpacket_message (AUTH_FD);
      if (!data || strcmp (data, "two") != 0)
        {
          write_resp (AUTH_FD, "{ \"error\": \"authentication-failed\" }");
          goto out;
        }

      write_resp (AUTH_FD, "{\"prompt\": \"type three\" }");
      free(data);
      data = read_seqpacket_message (AUTH_FD);
      if (!data || strcmp (data, "three") != 0)
        {
          write_resp (AUTH_FD, "{ \"error\": \"authentication-failed\" }");
        }
      else
        {
          write_resp (AUTH_FD, "{\"user\": \"me\" }");
          success = 1;
        }
      success = 1;
    }
  else if (strcmp (data, "success-bad-data") == 0)
    {
      write_resp (AUTH_FD, "{\"user\": \"me\", \"login-data\": \"bad\" }");
      success = 1;
    }
  else if (strcmp (data, "no-user") == 0)
    {
      write_resp (AUTH_FD, "{ }");
    }
  else if (strcmp (data, "with-error") == 0)
    {
      write_resp (AUTH_FD, "{ \"error\": \"unknown\", \"message\": \"detail for error\" }");
    }
  else if (strcmp (data, "with-error") == 0)
    {
      write_resp (AUTH_FD, "{ \"error\": \"unknown\", \"message\": \"detail for error\" }");
    }
  else if (strcmp (data, "too-slow") == 0)
    {
      sleep (10);
      write_resp (AUTH_FD, "{\"user\": \"me\", \"login-data\": { \"login\": \"data\"} }");
      success = 1;
    }

out:
  close(AUTH_FD);

  if (success)
    execlp ("cat", "cat", NULL);
}
