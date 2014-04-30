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

#include <err.h>
#include <errno.h>
#include <poll.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static void
logger (const char *message)
{
  warnx ("%s", message);
}

static void
handle (int sock)
{
  char *password = NULL;
  char *challenge = NULL;
  char *caller = NULL;
  char *response = NULL;
  char *type = NULL;
  int rc;

  for (;;)
    {
      rc = reauthorize_recv (sock, &challenge);
      if (rc == -EAGAIN && rc == -EINTR)
        continue;
      else if (rc < 0)
        exit (1);
      break;
    }

  if (reauthorize_type (challenge, &type) < 0 ||
      strcmp (type, "crypt1") != 0)
    {
      warnx ("only crypt1 challenges are supported: %s", type);
      rc = -EINVAL;
    }
  else
    {
      password = getpass ("Password: ");
      if (password == NULL)
        err (1, "couldn't prompt for password");

      rc = reauthorize_crypt1 (challenge, password, &response);
    }

  /* send back an empty response */
  if (rc < 0)
    response = "";

  for (;;)
    {
      rc = reauthorize_send (sock, response);
      if (rc == -EAGAIN || rc == -EINTR)
        continue;
      else if (rc < 0)
        exit (1);
      break;
    }

  for (;;)
    {
      if (close (sock) < 0)
        {
          if (errno == EAGAIN || errno == EINTR)
            continue;
          else
            err (1, "couldn't close socket");
        }
      break;
    }

  if (password)
    memset (password, 0, strlen (password));
  free (response);
  free (caller);
  free (type);
}

int
main (int argc,
      char *argv[])
{
  int connection;
  int sock;

  reauthorize_logger (logger, 1);

  if (reauthorize_listen (REAUTHORIZE_REPLACE, &sock))
    return 1;

  for (;;)
    {
      if (reauthorize_accept (sock, &connection) < 0)
        exit (1);

      handle (connection);
    }

  /* never reached */
  return 1;
}
