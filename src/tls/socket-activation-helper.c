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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */
#include "config.h"

#include <assert.h>
#include <err.h>
#include <errno.h>
#include <fcntl.h>
#include <pthread.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/poll.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <unistd.h>

#include "socket-io.h"
#include "testing.h"
#include "utils.h"

#define MAX_COCKPIT_WS_ARGS 5

static struct instance_type
{
  const char *sockname;
  const char *argv[MAX_COCKPIT_WS_ARGS];
} instance_types[] = {
  {"https-factory.sock", {}}, /* treated specially */
  /* support up to 2 ws instances (+1 special); increase this if the unit test needs more */
  {"https@" SHA256_NIL ".sock", {"--for-tls-proxy", "--port=0"}},
  {"https@" CLIENT_CERT_FINGERPRINT ".sock", {"--for-tls-proxy", "--port=0"}},
  {"https@" ALTERNATE_FINGERPRINT ".sock", {}}, /* treated specially */
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

      if (duped_fd != SD_LISTEN_FDS_START)
        {
          if (dup2 (duped_fd, SD_LISTEN_FDS_START) < 0)
            err (EXIT_FAILURE, "dup2() failed");
          assert (close (duped_fd) == 0);
        }

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

/* keep this in sync with src/ws/cockpit-wsinstance-https-factory@.service.in */
/* this is blocking! if this program ever stops being an unit-test only thing
* and gets used in production, rewrite as proper child process */
static void
handle_https_factory (int listen_fd)
{
  int fd = accept4 (listen_fd, NULL, NULL, SOCK_CLOEXEC);
  char instance[WSINSTANCE_MAX];
  const char *result;

  debug (HELPER, "connection to https-factory.sock:");

  if (fd < 0)
    err (EXIT_FAILURE, "accept connection to https-factory.sock");

  debug (HELPER, "  -> reading instance name... ");
  if (!recv_alnum (fd, instance, sizeof instance, 10 * 1000000))
    errx (EXIT_FAILURE, "failed to read instance name");

  debug (HELPER, "  -> success: '%s'", instance);
  if (strcmp (instance, SHA256_NIL) == 0) /* we check this value from the tests */
    result = "done";
  else
    result = "fail";

  debug (HELPER, "  -> sending reply '%s'", result);
  if (!send_all (fd, result, strlen (result), 10 * 1000000))
    errx (EXIT_FAILURE, "failed to write https-factory.sock response");
  debug (HELPER, "  -> done.");

  close (fd);
}

static void *
handle_alternate_thread (void *fd_as_ptr)
{
  int fd = (intptr_t) fd_as_ptr;
  ssize_t s;
  char b;

  do
    s = write (fd, "hello", 5);
  while (s == -1 && errno == EINTR);
  assert (s == 5);


  do
    s = read (fd, &b, 1);
  while (s == -1 && errno == EINTR);
  assert (s == 0);

  close (fd);

  return NULL;
}

static void
handle_alternate (int listen_fd)
{
  int fd = accept4 (listen_fd, NULL, NULL, SOCK_CLOEXEC);
  pthread_attr_t attr;
  pthread_t thread;

  /* This is used from a testcase which spins up a whole bunch of
   * parallel connections, so we need to handle this asynchronously.
   * Use threads.
   */
  pthread_attr_init (&attr);
  pthread_attr_setdetachstate (&attr, PTHREAD_CREATE_DETACHED);
  pthread_create (&thread, &attr, handle_alternate_thread, (void *) (intptr_t) fd);
  pthread_attr_destroy (&attr);
}

int
main (int argc, char *argv[])
{
  if (argc != 3)
    errx (EXIT_FAILURE, "Usage: socket-activation-helper $WS_PATH $SOCKETS_DIR");

  const char *ws_path = argv[1];
  const char *socket_dir = argv[2];
  int socket_dir_fd = open (socket_dir, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  if (socket_dir_fd < 0)
    err (EXIT_FAILURE, "failed to open %s", socket_dir);

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
      int listen_fd;

      if (unlinkat (socket_dir_fd, instance_types[i].sockname, 0) < 0 && errno != ENOENT)
        err (EXIT_FAILURE, "unlink() failed");

      /* create a listening socket for each cockpit-ws mode */
      listen_fd = socket (AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
      if (listen_fd < 0)
        err (EXIT_FAILURE, "socket() failed");

      if (af_unix_bindat (listen_fd, socket_dir_fd, instance_types[i].sockname) < 0)
        err (EXIT_FAILURE, "%s/%s: bind() failed", socket_dir, instance_types[i].sockname);

      if (listen (listen_fd, 32) < 0)
        err (EXIT_FAILURE, "%s/%s: listen() failed", socket_dir, instance_types[i].sockname);

      ws_pollfds[i].fd = listen_fd;
      ws_pollfds[i].events = POLLIN;
    }

  /* signal the unit test that we are ready to connect */
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
                  /* is this the https factory? */
                  if (strstr (instance_types[i].sockname, "factory"))
                    {
                      debug (HELPER, "got POLLIN on fd %i https factory", ws_pollfds[i].fd);
                      handle_https_factory (ws_pollfds[i].fd);
                      continue;
                    }
                  else if (strstr (instance_types[i].sockname, ALTERNATE_FINGERPRINT))
                    {
                      debug (HELPER, "got POLLIN on fd %i alternate cert socket", ws_pollfds[i].fd);
                      handle_alternate (ws_pollfds[i].fd);
                      continue;
                    }

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
