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

#include "server.h"

#include <assert.h>
#include <err.h>
#include <errno.h>
#include <netinet/in.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/epoll.h>
#include <sys/param.h>
#include <sys/socket.h>
#include <sys/timerfd.h>
#include <sys/types.h>
#include <unistd.h>

#include "connection.h"
#include "utils.h"

/* cockpit-tls TCP server state (singleton) */
static struct {
  /* only used from main thread */
  bool initialized;
  int first_listener;
  int last_listener;
  int epollfd;

  /* rw, protected by mutex */
  pthread_mutex_t connection_mutex;
  unsigned int connection_count;
  int idle_timerfd;
  struct itimerspec idle_timeout;
} server;

/**
 * check_sd_listen_pid: Verify that systemd-activated socket is for us
 *
 * See sd_listen_fds(3).
 */
static bool
check_sd_listen_pid (void)
{
  const char *pid_str = secure_getenv ("LISTEN_PID");
  long pid;
  char *endptr = NULL;

  if (!pid_str)
    {
      warnx ("$LISTEN_PID not set, not accepting socket activation");
      return false;
    }

  pid = strtol (pid_str, &endptr, 10);
  if (pid <= 0 || *endptr != '\0')
    errx (EXIT_FAILURE, "$LISTEN_PID contains invalid value '%s'", pid_str);
  if ((pid_t) pid != getpid ())
    {
      warnx ("$LISTEN_PID %li is not for us, ignoring", pid);
      return false;
    }

  return true;
}

static void *
server_connection_thread_start_routine (void *data)
{
  int fd = (uintptr_t) data;

  connection_thread_main (fd);

  /* teardown */
  {
    pthread_mutex_lock (&server.connection_mutex);

    server.connection_count--;

    debug (CONNECTION, "Server.connection_count decreased to %i", server.connection_count);

    if (server.connection_count == 0 && server.idle_timerfd != -1)
      {
        debug (CONNECTION, "  -> setting idle timeout");
        timerfd_settime (server.idle_timerfd, 0, &server.idle_timeout, NULL);
      }

    pthread_mutex_unlock (&server.connection_mutex);
  }

  return NULL;
}

/**
 * handle_accept: Handle event on listening fd
 *
 * I. e. accepting new connections
 */
static void
handle_accept (int listen_fd)
{
  int fd;
  pthread_attr_t attr;
  pthread_t thread;

  debug (CONNECTION, "epoll_wait event on server listen fd %i", listen_fd);

  /* accept and create new connection */
  fd = accept4 (listen_fd, NULL, NULL, SOCK_CLOEXEC);
  if (fd < 0)
    {
      if (errno != EINTR)
        warn ("failed to accept connection");
      return;
    }

  debug (CONNECTION, "New connection accepted, fd %i", fd);

  {
    pthread_mutex_lock (&server.connection_mutex);

    if (server.connection_count == 0 && server.idle_timerfd != -1)
      {
        const struct itimerspec zero = { { 0 }, };
        debug (CONNECTION, "  -> clearing idle timeout.");
        timerfd_settime (server.idle_timerfd, 0, &zero, NULL);
      }

    server.connection_count++;

    debug (CONNECTION, "  -> server.connection_count is now %i", server.connection_count);

    pthread_mutex_unlock (&server.connection_mutex);
  }

  pthread_attr_init (&attr);
  pthread_attr_setdetachstate (&attr, PTHREAD_CREATE_DETACHED);

  int r = pthread_create (&thread, &attr,
                          server_connection_thread_start_routine,
                          (void *) (uintptr_t) fd);

  if (r != 0)
    {
      errno = r;
      warn ("pthread_create() failed.  dropping connection");
      close (fd);
    }

  pthread_attr_destroy (&attr);
}

/***********************************
 *
 * Public API
 *
 ***********************************/

/**
 * server_init: Initialize cockpit TLS proxy server
 *
 * There is only one instance of this. Trying to initialize it more than once
 * is an error.
 *
 * @wsinstance_sockdir: Path to cockpit-wsinstance sockets directory
 * @cert_session_dir: Path to store session certificates
 * @idle_timeout: When positive, stop server after given number of seconds with
 *                no connections
 * @port: Port to listen to; ignored when the listening socket is handed over
 *        through the systemd socket activation protocol
 */
void
server_init (const char *wsinstance_sockdir,
             const char *cert_session_dir,
             int idle_timeout,
             uint16_t port)
{
  const char *env_listen_fds;
  struct epoll_event ev = { .events = EPOLLIN };

  assert (!server.initialized);
  server.initialized = true;
  server.idle_timerfd = -1;

  connection_set_directories (wsinstance_sockdir, cert_session_dir);

  pthread_mutex_init (&server.connection_mutex, NULL);

  /* systemd socket activated? */
  env_listen_fds = secure_getenv ("LISTEN_FDS");
  if (env_listen_fds && check_sd_listen_pid ())
    {
      char *endptr = NULL;
      unsigned long n = strtoul (env_listen_fds, &endptr, 10);

      if (n < 1 || n > INT_MAX || *endptr != '\0')
        errx (EXIT_FAILURE, "Invalid $LISTEN_FDS value '%s'", env_listen_fds);

      server.first_listener = SD_LISTEN_FDS_START;
      server.last_listener = SD_LISTEN_FDS_START + (n - 1);
    }
  else
    {
      struct sockaddr_in sa_serv;
      int optval = 1;

      /* Listen to our port; on the command line and our API we just support one */
      server.first_listener = socket (AF_INET, SOCK_STREAM | SOCK_CLOEXEC, 0);
      if (server.first_listener < 0)
        err (EXIT_FAILURE, "failed to create server listening fd");
      server.last_listener = server.first_listener;

      memset (&sa_serv, '\0', sizeof (sa_serv));
      sa_serv.sin_family = AF_INET;
      sa_serv.sin_addr.s_addr = INADDR_ANY;
      sa_serv.sin_port = htons (port);

      if (setsockopt (server.first_listener, SOL_SOCKET, SO_REUSEADDR, (void *) &optval, sizeof (int)) < 0)
        err (EXIT_FAILURE, "failed to set socket option");
      if (bind (server.first_listener, (struct sockaddr *) &sa_serv, sizeof (sa_serv)) < 0)
        err (EXIT_FAILURE, "failed to bind to port %hu", port);
      if (listen (server.first_listener, 1024) < 0)
        err (EXIT_FAILURE, "failed to listen to server port");
      debug (SERVER, "Server ready. Listening on port %hu, fd %i", port, server.first_listener);
    }

  /* epoll the listening fds */
  server.epollfd = epoll_create1 (EPOLL_CLOEXEC);
  if (server.epollfd < 0)
    err (EXIT_FAILURE, "Failed to create epoll fd");
  for (int fd = server.first_listener; fd <= server.last_listener; fd++)
    {
      ev.data.fd = fd;
      if (epoll_ctl (server.epollfd, EPOLL_CTL_ADD, fd, &ev) < 0)
        err (EXIT_FAILURE, "Failed to epoll server listening fd");
    }

  /* we use timerfd for idle timeout.  epoll that too. */
  if (idle_timeout > 0)
    {
      server.idle_timerfd = timerfd_create (CLOCK_MONOTONIC, TFD_CLOEXEC);
      if (server.idle_timerfd == -1)
        err (EXIT_FAILURE, "Failed to create timerfd");

      server.idle_timeout.it_value.tv_sec = idle_timeout;
      if (timerfd_settime (server.idle_timerfd, 0, &server.idle_timeout, NULL) != 0)
        err (EXIT_FAILURE, "Failed to set timerfd");

      ev.data.fd = server.idle_timerfd;
      if (epoll_ctl (server.epollfd, EPOLL_CTL_ADD, server.idle_timerfd, &ev) < 0)
        err (EXIT_FAILURE, "Failed to epoll idle timerfd");
    }
}

int
server_get_listener (void)
{
  assert (server.first_listener == server.last_listener);
  return server.first_listener;
}

/**
 * server_cleanup: Free all resources to the cockpit TLS proxy server
 *
 * There is only one instance of this. Trying to free it more than once
 * is an error.
 */
void
server_cleanup (void)
{
  assert (server.initialized);
  assert (server.connection_count == 0);

  if (server.idle_timerfd != -1)
    close (server.idle_timerfd);

  for (int fd = server.first_listener; fd <= server.last_listener; fd++)
    close (fd);

  close (server.epollfd);

  pthread_mutex_destroy (&server.connection_mutex);

  connection_cleanup ();

  memset (&server, 0, sizeof server);
}

/**
 * server_poll_event: Wait for and process one event
 *
 * @timeout: number of milliseconds to wait for an event to happen; after that,
 * the function will return false. -1 will to block until an event occurs.
 *
 * This can be an event on a listening socket, or the idle timeout if no
 * clients are connected.
 *
 * Returns: false on timeout, true if some (other) event was handled.
 */
bool
server_poll_event (int timeout)
{
  int ret;
  struct epoll_event ev;

  assert (server.initialized);

  ret = epoll_wait (server.epollfd, &ev, 1, timeout);
  if (ret == 0)
    return false; /* hit timeout */

  if (ret == 1)
    {
      int fd = ev.data.fd;

      if (fd == server.idle_timerfd)
        {
          /* hit the idle timeout */
          debug (SERVER, "server_poll_event(): idle timer elapsed, returning immediately");
          return false;
        }

      assert (server.first_listener <= fd && fd <= server.last_listener);

      handle_accept (fd);
    }
  else if (errno != EINTR)
    err (EXIT_FAILURE, "Failed to epoll_wait");

  return true; /* did something */
}

/**
 * server_run: Server main loop
 *
 * Returns if the server reached the idle timeout, otherwise runs forever.
 */
void
server_run (void)
{
  while (server_poll_event (-1))
    ;
}

unsigned
server_num_connections (void)
{
  unsigned count;

  pthread_mutex_lock (&server.connection_mutex);
  count = server.connection_count;
  pthread_mutex_unlock (&server.connection_mutex);

  return count;
}
