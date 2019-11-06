/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2019 Red Hat, Inc.
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

#ifdef HAVE_CONFIG_H
#include <config.h>
#endif

#include <err.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>

#include "socket-io.h"

int
main (int argc,
      char **argv)
{
  const char *wsinstance_sockdir = "/run/cockpit/wsinstance";
  struct sockaddr_un addr;
  char result[20];
  int fd;

  if (argc != 2 && argc != 3)
    errx (EXIT_FAILURE, "usage: ./wsinstance-start [instanceid] [wsinstance_sockdir]");

  if (argc == 3)
    wsinstance_sockdir = argv[2];

  fd = socket (AF_UNIX, SOCK_STREAM, 0);
  if (fd == -1)
    err (EXIT_FAILURE, "Couldn't create AF_UNIX socket");

  sockaddr_printf (&addr, "%s/https-factory.sock", wsinstance_sockdir);

  if (connect (fd, (struct sockaddr *) &addr, sizeof addr) != 0)
    err (EXIT_FAILURE, "Couldn't connect to factory socket");

  if (!send_all (fd, argv[1], strlen (argv[1]), 50 * 1000000))
    errx (EXIT_FAILURE, "Couldn't send instance name");

  if (!recv_alnum (fd, result, sizeof result, 30 * 1000000))
    errx (EXIT_FAILURE, "Failed to receive result");

  printf ("%s\n", result);

  return 0;
}
