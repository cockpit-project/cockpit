/*
 * Copyright (C) 2019 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#include "config.h"

#include <err.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

#include "socket-io.h"

int
main (int argc,
      char **argv)
{
  const char *wsinstance_sockdir = "/run/cockpit/wsinstance";
  int dirfd;
  char result[20];
  int fd;

  if (argc != 2 && argc != 3)
    errx (EXIT_FAILURE, "usage: ./wsinstance-start [instanceid] [wsinstance_sockdir]");

  if (argc == 3)
    wsinstance_sockdir = argv[2];

  dirfd = open (wsinstance_sockdir, O_PATH | O_DIRECTORY | O_CLOEXEC);
  if (dirfd == -1)
    err (EXIT_FAILURE, "Couldn't open wsinstance_sockdir %s", wsinstance_sockdir);

  fd = socket (AF_UNIX, SOCK_STREAM, 0);
  if (fd == -1)
    err (EXIT_FAILURE, "Couldn't create AF_UNIX socket");

  if (af_unix_connectat (fd, dirfd, "https-factory.sock"))
    err (EXIT_FAILURE, "Couldn't connect to factory socket");

  if (!send_all (fd, argv[1], strlen (argv[1]), 50 * 1000000))
    errx (EXIT_FAILURE, "Couldn't send instance name");

  if (!recv_alnum (fd, result, sizeof result, 30 * 1000000))
    errx (EXIT_FAILURE, "Failed to receive result");

  printf ("%s\n", result);

  close (dirfd);
  close (fd);

  return 0;
}
