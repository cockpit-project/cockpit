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

#include <sys/types.h>
#include <sys/socket.h>

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
  struct iovec vec = { .iov_len = MAX_PACKET_SIZE, };
  struct msghdr msg;
  int r;

  vec.iov_base = malloc (vec.iov_len + 1);
  if (!vec.iov_base)
    errx (EX, "couldn't allocate memory for data");

  /* Assume only one successful read needed
   * since this is a SOCK_SEQPACKET over AF_UNIX
   */
  for (;;)
    {
      memset (&msg, 0, sizeof (msg));
      msg.msg_iov = &vec;
      msg.msg_iovlen = 1;
      r = recvmsg (fd, &msg, 0);
      if (r < 0)
        {
          if (errno == EAGAIN)
            continue;

          err (EX, "couldn't recv data");
        }
      else
        {
          break;
        }
    }

  ((char *)vec.iov_base)[r] = '\0';
  return vec.iov_base;
}

static void
write_resp (int fd,
            const char *data)
{
  int r;
  for (;;)
    {
      r = send (fd, data, strlen (data), 0);
      if (r < 0)
        {
          if (errno == EAGAIN)
            continue;

          err (EX, "couldn't send auth data");
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
  int fd = AUTH_FD;
  char *data = NULL;
  char *type = getenv ("COCKPIT_AUTH_MESSAGE_TYPE");

  if (type && strcmp (type, "testscheme-fd-4") == 0)
    fd = 4;

  data = read_seqpacket_message (fd);
  if (strcmp (data, "failslow") == 0)
    {
      sleep (2);
      write_resp (fd, "{ \"error\": \"authentication-failed\" }");
    }
  else if (strcmp (data, "fail") == 0)
    {
      write_resp (fd, "{ \"error\": \"authentication-failed\" }");
    }
  else if (strcmp (data, "not-supported") == 0)
    {
      write_resp (fd, "{ \"error\": \"authentication-failed\", \"auth-method-results\": { } }");
    }
  else if (strcmp (data, "ssh-fail") == 0)
    {
      write_resp (fd, "{ \"error\": \"authentication-failed\", \"auth-method-results\": { \"password\": \"denied\"} }");
    }
  else if (strcmp (data, "denied") == 0)
    {
      write_resp (fd, "{ \"error\": \"permission-denied\" }");
    }
  else if (strcmp (data, "success") == 0)
    {
      write_resp (fd, "{\"user\": \"me\" }");
      success = 1;
    }
  else if (strcmp (data, "ssh-remote-switch") == 0 &&
           strcmp (argv[1], "machine") == 0 &&
           strcmp (getenv ("COCKPIT_SSH_KNOWN_HOSTS_DATA"), "") == 0)
    {
      write_resp (fd, "{\"user\": \"me\" }");
      success = 1;
    }
  else if (strcmp (data, "ssh-alt-machine") == 0 &&
           strcmp (argv[1], "machine") == 0 &&
           strcmp (getenv ("COCKPIT_SSH_KNOWN_HOSTS_DATA"), "") == 0)
    {
      write_resp (fd, "{\"user\": \"me\" }");
      success = 1;
    }
  else if (strcmp (data, "ssh-alt-default") == 0 &&
           strcmp (argv[1], "default-host") == 0 &&
           strcmp (getenv ("COCKPIT_SSH_KNOWN_HOSTS_DATA"), "*") == 0)
    {
      write_resp (fd, "{\"user\": \"me\" }");
      success = 1;
    }
  else if (type && strcmp (type, "basic") == 0 &&
           strcmp (argv[1], "127.0.0.1") == 0 &&
           strcmp (getenv ("COCKPIT_SSH_KNOWN_HOSTS_DATA"), "*") == 0)
    {
      if (strcmp (data, "me:this is the password") == 0)
        {
          write_resp (fd, "{\"user\": \"me\" }");
          success = 1;
        }
      else
        {
          write_resp (fd, "{ \"error\": \"authentication-failed\", \"auth-method-results\": { \"password\": \"denied\"} }");
        }
    }
  else if (type && strcmp (type, "basic") == 0 &&
           strcmp (argv[1], "machine") == 0 &&
           strcmp (getenv ("COCKPIT_SSH_KNOWN_HOSTS_DATA"), "") == 0)
    {
      if (strcmp (data, "remote-user:this is the machine password") == 0)
        {
          write_resp (fd, "{\"user\": \"remote-user\" }");
          success = 1;
        }
      else
        {
          write_resp (fd, "{ \"error\": \"authentication-failed\", \"auth-method-results\": { \"password\": \"denied\"} }");
        }
    }
  else if (strcmp (data, "success-with-data") == 0)
    {
      write_resp (fd, "{\"user\": \"me\", \"login-data\": { \"login\": \"data\"} }");
      success = 1;
    }
  else if (strcmp (data, "two-step") == 0)
    {
      free(data);
      write_resp (fd, "{\"prompt\": \"type two\" }");
      data = read_seqpacket_message (fd);
      if (!data || strcmp (data, "two") != 0)
        {
          write_resp (fd, "{ \"error\": \"authentication-failed\" }");
        }
      else
        {
          write_resp (fd, "{\"user\": \"me\" }");
          success = 1;
        }
    }
  else if (strcmp (data, "three-step") == 0)
    {
      free(data);
      write_resp (fd, "{\"prompt\": \"type two\" }");
      data = read_seqpacket_message (fd);
      if (!data || strcmp (data, "two") != 0)
        {
          write_resp (fd, "{ \"error\": \"authentication-failed\" }");
          goto out;
        }

      write_resp (fd, "{\"prompt\": \"type three\" }");
      free(data);
      data = read_seqpacket_message (fd);
      if (!data || strcmp (data, "three") != 0)
        {
          write_resp (fd, "{ \"error\": \"authentication-failed\" }");
        }
      else
        {
          write_resp (fd, "{\"user\": \"me\" }");
          success = 1;
        }
      success = 1;
    }
  else if (strcmp (data, "success-bad-data") == 0)
    {
      write_resp (fd, "{\"user\": \"me\", \"login-data\": \"bad\" }");
      success = 1;
    }
  else if (strcmp (data, "no-user") == 0)
    {
      write_resp (fd, "{ }");
    }
  else if (strcmp (data, "with-error") == 0)
    {
      write_resp (fd, "{ \"error\": \"unknown\", \"message\": \"detail for error\" }");
    }
  else if (strcmp (data, "with-error") == 0)
    {
      write_resp (fd, "{ \"error\": \"unknown\", \"message\": \"detail for error\" }");
    }
  else if (strcmp (data, "too-slow") == 0)
    {
      sleep (10);
      write_resp (fd, "{\"user\": \"me\", \"login-data\": { \"login\": \"data\"} }");
      success = 1;
    }

out:
  close(fd);
  if (success)
    execlp ("cat", "cat", NULL);

}
