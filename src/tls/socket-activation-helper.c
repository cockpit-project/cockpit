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
#define _GNU_SOURCE 1

#include <stdio.h>
#include <stdbool.h>
#include <unistd.h>
#include <sys/poll.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <stdlib.h>
#include <sys/un.h>
#include <errno.h>
#include <err.h>
#include <assert.h>
#include <fcntl.h>

#include "utils.h"

#define MAX_COCKPIT_WS_ARGS 5

static struct instance_type
{
  const char *sockname;
  const char *argv[MAX_COCKPIT_WS_ARGS];
} instance_types[] = {
  {"https.sock", {"--for-tls-proxy", "--port=0"}},
  {"http-redirect.sock", {"--proxy-tls-redirect", "--no-tls", "--port=0"}},
  {"http.sock", {"--no-tls", "--port", "0"}},
};

static int socket_to_pid[N_ELEMENTS (instance_types)];
static struct pollfd ws_pollfds[N_ELEMENTS (instance_types)];

volatile sig_atomic_t terminated = 0;

static void
term (int signum)
{
  debug (HELPER, "SIGTERM received");
  terminated = 1;
}


static void
handle_cockpit_ws_exited (int sigid)
{
  pid_t pid;
  debug (HELPER, "SIGCHLD received");
  while ((pid = waitpid (-1, NULL, WNOHANG)) > 0)
    {
      bool found = false;
      debug (HELPER, "SIGCHLD received for pid %u", pid);
      for (size_t i = 0; i < N_ELEMENTS (instance_types); i++)
        {
          if (pid == socket_to_pid[i])
            {
              debug (HELPER, "-> ws instance type %zu, cleaning up reference", i);
              ws_pollfds[i].events = POLLIN;
              socket_to_pid[i] = 0;
              found = true;
              break;
            }
        }

      /* This can only be reached in case cockpit-ws exited fast and the parent
       * process did not manage to insert its PID into the array
       */
      if (!found)
        warnx ("Could not find the process in socket_to_pid array");
    }

  if (pid < 0 && errno != ECHILD)
    err (EXIT_FAILURE, "waitpid failed");
}

static pid_t
spawn_cockpit_ws (const char *ws_path, int fd,
                  const char **cockpit_ws_args)
{
  pid_t pid = fork ();

  if (pid == -1)
    {
      err (EXIT_FAILURE, "fork() failed");
    }
  else if (pid > 0)
    {
      debug (HELPER, "spawned cockpit-ws instance pid %u", pid);
      return pid;
    }
  else
    {
      const char *args[MAX_COCKPIT_WS_ARGS + 1] = { ws_path };
      int res;
      int duped_fd;
      char pid_str[10];

      /* pass the socket to ws like systemd activation does, see sd_listen_fds(3) */
      /* fd is CLOEXEC, so dup2 on our first fd 3 will be a no-op; force duping */
      duped_fd = dup (fd);
      if (duped_fd < 0)
        err (EXIT_FAILURE, "dup() failed");
      if (dup2 (duped_fd, SD_LISTEN_FDS_START) < 0)
        err (EXIT_FAILURE, "dup2() failed");
      assert (close (duped_fd) == 0);

      setenv ("LISTEN_FDS", "1", 1);
      res = snprintf (pid_str, sizeof (pid_str), "%i", getpid ());
      assert (res < sizeof (pid_str));
      setenv ("LISTEN_PID", pid_str, 1);

      for (int i = 0; cockpit_ws_args[i] != NULL; i++)
        args[i + 1] = cockpit_ws_args[i];

      execv (ws_path, (char **) args);

      err (EXIT_FAILURE, "spawning cockpit-ws instance failed");
    }
}

int
main (int argc, char *argv[])
{
  int res;

  if (argc != 3)
    errx (EXIT_FAILURE, "Usage: socket-activation-helper $WS_PATH $SOCKETS_DIR");

  const char *ws_path = argv[1];
  const char *socket_dir = argv[2];

  for (size_t i = 0; i < N_ELEMENTS (instance_types); i++)
    ws_pollfds[i].fd = -1;

  /* Set up signal handler for when cockpit-ws has exited */
  struct sigaction sa;
  sigemptyset (&sa.sa_mask);
  sa.sa_flags = 0;
  sa.sa_handler = handle_cockpit_ws_exited;
  sigaction (SIGCHLD, &sa, NULL);

  /* clean up ws child processes on SIGTERM */
  sa.sa_handler = term;
  sigaction (SIGTERM, &sa, NULL);

  for (size_t i = 0; i < N_ELEMENTS (instance_types); i++)
    {
      struct sockaddr_un addr = {
        .sun_family = AF_UNIX
      };
      int listen_fd;

      socket_to_pid[i] = 0;

      res = snprintf (addr.sun_path, sizeof (addr.sun_path), "%s/%s", socket_dir, instance_types[i].sockname);
      assert (res < sizeof (addr.sun_path));

      if (unlink (addr.sun_path) < 0 && errno != ENOENT)
        err (EXIT_FAILURE, "unlink() failed");

      /* create a listening socket for each cockpit-ws mode */
      listen_fd = socket (AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
      if (listen_fd < 0)
        err (EXIT_FAILURE, "socket() failed");

      if (bind (listen_fd, (struct sockaddr *) &addr, sizeof addr) < 0)
        err (EXIT_FAILURE, "%s: bind() failed", addr.sun_path);

      if (listen (listen_fd, 32) < 0)
        err (EXIT_FAILURE, "%s: listen() failed", addr.sun_path);

      ws_pollfds[i].fd = listen_fd;
      ws_pollfds[i].events = POLLIN;
    }

  /* signal the unit test that we are ready to connect */
  int socket_dir_fd = open (socket_dir, O_RDONLY | O_DIRECTORY);
  if (socket_dir_fd < 0)
    err (EXIT_FAILURE, "failed to open %s", socket_dir);
  int fd = openat (socket_dir_fd, "ready", O_CREAT | O_WRONLY | O_EXCL, 0666);
  if (fd < 0)
    err (EXIT_FAILURE, "failed to create %s/stamp", socket_dir);
  close (fd);
  close (socket_dir_fd);

  /* Loop waiting for incoming connects on any of the connected sockets. */
  while (!terminated)
    {
      int rv = poll (ws_pollfds, N_ELEMENTS (instance_types), -1);

      if (rv == -1)
        {
          if (errno == EINTR)
            continue;
          err (EXIT_FAILURE, "poll() failed");
        }
      else
        {
          debug (HELPER, "got %i poll() events", rv);
          for (size_t i = 0; i < N_ELEMENTS (instance_types); i++)
            {
              if (ws_pollfds[i].revents == POLLIN)
                {
                  ws_pollfds[i].events = 0;
                  debug (HELPER, "got POLLIN on fd %i, spawning ws for %s",
                          ws_pollfds[i].fd, instance_types[i].sockname);
                  socket_to_pid[i] = spawn_cockpit_ws (ws_path, ws_pollfds[i].fd,
                                                       instance_types[i].argv);
                }
            }
        }
    }

  debug (HELPER, "exiting, cleaning up cockpit-ws children");
  for (size_t i = 0; i < N_ELEMENTS (socket_to_pid); i++)
    if (socket_to_pid[i] > 0)
      kill (socket_to_pid[i], SIGTERM);

  return EXIT_SUCCESS;
}
