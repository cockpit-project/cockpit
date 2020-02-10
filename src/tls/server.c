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

/* for secure_getenv () */
#define _GNU_SOURCE

#ifdef HAVE_CONFIG_H
#include <config.h>
#endif

#include <assert.h>
#include <err.h>
#include <errno.h>
#include <signal.h>
#include <stdlib.h>
#include <unistd.h>
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/types.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/epoll.h>
#include <sys/wait.h>

#include <gnutls/gnutls.h>
#include <gnutls/x509.h>

#include <common/cockpitmemory.h>
#include <common/cockpitwebcertificate.h>
#include "utils.h"
#include "wsinstance.h"
#include "connection.h"

#include "server.h"

/* cockpit-tls TCP server state (singleton) */
static struct {
  bool initialized;
  const char *ws_path;
  const char *state_dir;
  enum ClientCertMode client_cert_mode;
  int listen_fd;
  gnutls_certificate_credentials_t x509_cred;
  gnutls_priority_t priority_cache;
  Connection *connections;
  WsInstance *wss;      /* cockpit-ws instances, one for each client certificate */
  WsInstance *ws_notls; /* cockpit-ws instance for unencrypted HTTP */
  int epollfd;
  struct sigaction old_sigchld;
} server;

/***********************************
 *
 * Helper functions
 *
 ***********************************/

#define RETRY(rval, cmd) \
        do { \
                rval = cmd; \
        } while(rval < 0  && errno == EINTR)
#define TLS_RETRY(rval, cmd) \
        do { \
                rval = cmd; \
        } while(rval == GNUTLS_E_INTERRUPTED)
#define TLS_RETRY_BLOCK(rval, cmd) \
        do { \
                rval = cmd; \
        } while(rval == GNUTLS_E_AGAIN || rval == GNUTLS_E_INTERRUPTED)

static void
handle_sigchld (int signal)
{
  /* we can't use SA_SIGINFO and si_pid, as multiple queued SIGCHLDs get merged
   * into one handler call, see signal(7); mop up all children */
  debug ("got SIGCHLD");
  for (;;)
    {
      int status;
      pid_t pid = waitpid (-1, &status, WNOHANG);
      if (pid <= 0)
        break;

      debug ("pid %u exited with status %x", pid, status);
      server_remove_ws (pid);
    }
}

/* This needs to be used in functions changing server.connections and
 * server.wss, so that these get modified without interference from SIGCHLD
 * handler */
static void block_sigchld (bool block)
{
  static sigset_t set;
  static bool set_inited;

  /* lazy initialization */
  if (!set_inited)
    {
      if (sigemptyset (&set) < 0 || sigaddset (&set, SIGCHLD) < 0)
        err (1, "failed to initialize SIGCHLD sigset");
      set_inited = true;
    }

  if (sigprocmask (block ? SIG_BLOCK : SIG_UNBLOCK, &set, NULL) < 0)
    err (1, "failed to block SIGCHLD signal");
}

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
  if (pid <= 0 || !endptr || *endptr != '\0')
    errx (1, "$LISTEN_PID contains invalid value '%s'", pid_str);
  if ((pid_t) pid != getpid ())
    {
      warnx ("$LISTEN_PID %li is not for us, ignoring", pid);
      return false;
    }

  return true;
}

/**
 * remove_connection: stop tracking and clean up connection(s)
 *
 * Remove all #Connections which either have the given @fd (client or ws), or
 * the given #WsInstance. This happens when encountering EOF or SIGCHLD.
 *
 * @fd: file descriptor from client (browser) or ws connection, or ≤ 0 for "unspecified"
 * @ws: If given, all connections related to this #WsInstance get removed
 */
static void
remove_connection (int fd, WsInstance *ws)
{
  Connection *c, *cprev;
  bool found = false;

  block_sigchld (true);
  for (c = server.connections, cprev = NULL; c; )
    {
      Connection *cnext = c->next;

      if ( (fd > 0 && (c->client_fd == fd || c->ws_fd == fd)) || (ws && c->ws == ws) )
        {
          /* stop polling it */
          if (epoll_ctl (server.epollfd, EPOLL_CTL_DEL, c->client_fd, NULL) < 0)
            err (1, "Failed to remove epoll connection fd");
          if (c->ws_fd)
            {
              if (epoll_ctl (server.epollfd, EPOLL_CTL_DEL, c->ws_fd, NULL) < 0)
                err (1, "Failed to remove epoll connection ws fd");
            }

          /* remove connection from our list */
          if (cprev == NULL) /* first connection */
            server.connections = c->next;
          else
            cprev->next = c->next;

          connection_free (c);
          found = true;
        }
      else
        cprev = c;

      c = cnext;
    }
  block_sigchld (false);

  if (!found)
    debug ("remove_connection: fd %i or ws %s not found in connections", fd, ws ? ws->socket.sun_path : "(unset)");
}

/**
 * connection_init_ws: Find or launch a cockpit-ws instance for a new Connection
 *
 * Find the responsible cockpit-ws instance for a new server connection, i. e.
 * by connection type (https/http) and client-side certificate. If none exists,
 * create one. Set server.wss or server.ws_notls.
 */
static void
connection_init_ws (Connection *c)
{
  int fd;
  const gnutls_datum_t *peer_der = NULL;
  WsInstance *ws = NULL;
  bool ws_add_tls = false;
  bool ws_add_notls = false;
  struct epoll_event ev = { .events = EPOLLIN };

  if (c->is_tls)
    {
      peer_der = gnutls_certificate_get_peers (c->session, NULL);

      /* find existing ws server for this peer cert */
      block_sigchld (true);
      for (ws = server.wss; ws; ws = ws->next)
        if (ws_instance_has_peer_cert (ws, peer_der))
          break;
      block_sigchld (false);

      if (!ws)
        {
          ws = ws_instance_new (server.ws_path, WS_INSTANCE_HTTPS, peer_der, server.state_dir);
          ws_add_tls = true;
        }
    }
  else
    {
      ws = server.ws_notls;
      if (!ws)
        {
          debug ("initializing no-TLS cockpit-ws instance");
          ws = ws_instance_new (server.ws_path,
                                server.x509_cred ? WS_INSTANCE_HTTP_REDIRECT : WS_INSTANCE_HTTP,
                                NULL, server.state_dir);
          ws_add_notls = true;
        }
    }

  debug ("connection_init_ws: assigned ws %s", ws->socket.sun_path);

  /* connect to ws instance */
  fd = socket (AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
  if (fd < 0)
    err (1, "failed to create cockpit-ws client socket");
  if (connect (fd, (struct sockaddr *) &ws->socket, sizeof (ws->socket)) < 0)
    {
      /* cockpit-ws crashed? */
      warn ("failed to connect to cockpit-ws");
      ws_instance_free (ws);
      return;
    }

  /* connected, so it's valid; add it to our ws list */
  if (ws_add_tls)
    {
      block_sigchld (true);
      ws->next = server.wss;
      server.wss = ws;
      block_sigchld (false);
    }
  if (ws_add_notls)
    server.ws_notls = ws;

  /* epoll the fd */
  ev.data.ptr = &c->buf_ws;
  if (epoll_ctl (server.epollfd, EPOLL_CTL_ADD, fd, &ev) < 0)
    err (1, "Failed to epoll cockpit-ws client fd");

  c->ws_fd = fd;
  c->ws = ws;
}

/**
 * handle_accept: Handle event on listening fd
 *
 * I. e. accepting new connections
 */
static void
handle_accept (void)
{
  int fd;
  Connection *con;
  struct epoll_event ev = { .events = EPOLLIN };

  debug ("epoll_wait event on server listen fd %i", server.listen_fd);

  /* accept and create new connection */
  fd = accept4 (server.listen_fd, NULL, NULL, SOCK_CLOEXEC);
  if (fd < 0)
    {
      if (errno == EINTR)
        return;
      err (1, "failed to accept connection");
    }
  con = connection_new (fd);

  /* epoll the connection fd */
  ev.data.ptr = &con->buf_client;
  if (epoll_ctl (server.epollfd, EPOLL_CTL_ADD, fd, &ev) < 0)
    err (1, "Failed to epoll connection fd");

  /* add to our Connections list */
  block_sigchld (true);
  con->next = server.connections;
  server.connections = con;
  block_sigchld (false);
}

/**
 * handle_connection_data_first: Handle first event on client fd
 *
 * Check the very first byte of a new connection to tell apart TLS from plain
 * HTTP. Initialize TLS and the ws instance.
 */
static void
handle_connection_data_first (Connection *con)
{
  char b;
  int ret;

  assert (!con->ws);

  /* peek the first byte and see if it's a TLS connection (starting with 22).
     We can assume that there is some data to read, as this is called in response
     to an epoll event. */
  ret = recv (con->client_fd, &b, 1, MSG_PEEK);
  if (ret < 0)
    err (1, "failed to peek first byte");
  if (ret == 0) /* EOF */
    {
      debug ("client disconnected without sending any data");
      remove_connection (con->client_fd, NULL);
      return;
    }

  if (b == 22)
    {
      gnutls_session_t session;

      debug ("first byte is %i, initializing TLS", (int) b);

      if (!server.x509_cred)
        {
          warnx ("got TLS connection, but our server does not have a certificate/key; refusing");
          remove_connection (con->client_fd, NULL);
          return;
        }

      gnutls_check (gnutls_init (&session, GNUTLS_SERVER));
      gnutls_check (gnutls_priority_set (session, server.priority_cache));
      gnutls_check (gnutls_credentials_set (session, GNUTLS_CRD_CERTIFICATE, server.x509_cred));

      gnutls_certificate_server_set_request (
          session,
          (server.client_cert_mode == CERT_REQUEST) ? GNUTLS_CERT_REQUEST : GNUTLS_CERT_IGNORE);
      gnutls_handshake_set_timeout (session, GNUTLS_DEFAULT_HANDSHAKE_TIMEOUT);

      gnutls_transport_set_int (session, con->client_fd);

      TLS_RETRY_BLOCK (ret, gnutls_handshake (session));
      if (ret < 0)
        {
          warnx ("TLS handshake failed: %s", gnutls_strerror (ret));
          remove_connection (con->client_fd, NULL);
          return;
        }

      debug ("TLS handshake completed");

      connection_set_tls_session (con, session);
    }

  connection_init_ws (con);
  if (!con->ws)
    remove_connection (con->client_fd, NULL);
}

/**
 * handle_connection_data: Handle event on client or ws fd
 *
 * We want to avoid any interpretation of data to avoid vulnerabilities, so for
 * the most part this just means shovelling data between the client and ws. The
 * only exception is the very first byte of a new connection, to tell apart TLS
 * from plain HTTP (handled by handle_connection_data_first).
 */
static void
handle_connection_data (struct ConnectionBuffer *buf)
{
  Connection *con = buf->connection;
  DataSource src = buf == &con->buf_client ? CLIENT : WS;
  ConnectionResult r;

  assert (con);
  debug ("%s connection fd %i has data from %s; ws %s",
         con->is_tls ? "TLS" : "unencrypted", con->client_fd,
         src == WS ? "ws" : "client",
         con->ws ? con->ws->socket.sun_path : "uninitialized");

  /* first data on a new connection; determine if TLS, init TLS, and assign a ws */
  if (!con->ws)
    {
      assert (src == CLIENT);
      handle_connection_data_first (con);
      return;
    }

  do
    {
      r = connection_read (con, src);
    } while (r == RETRY);
  if (r == SUCCESS)
    {
      do
        {
          r = connection_write (con, src);
        } while (r == RETRY || r == PARTIAL);
    }

  if (r != SUCCESS)
    remove_connection (con->client_fd, NULL);
}

static void
handle_hangup (struct ConnectionBuffer *buf)
{
  Connection *con = buf->connection;
  int fd = buf == &con->buf_client ? con->client_fd : con->ws_fd;
  debug ("hangup on fd %i", fd);
  assert (fd != server.listen_fd);
  remove_connection (fd, NULL);
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
 * @ws_path: Path to cockpit-ws binary
 * @port: Port to listen to; ignored when the listening socket is handed over
 *        through the systemd socket activation protocol
 * @certfile: Server TLS certificate file; if %NULL, TLS is not supported.
 * @keyfile: Server TLS key file; if the key is merged into @certfile, set this
 *           to %NULL.
 * @client_cert_mode: Whether to ask for client certificates
 */
void
server_init (const char *ws_path,
             uint16_t port,
             const char *certfile,
             const char* keyfile,
             enum ClientCertMode client_cert_mode)
{
  int ret;
  const char *listen_fds;
  struct epoll_event ev = { .events = EPOLLIN };
  const struct sigaction child_action = {
    .sa_handler = handle_sigchld,
    .sa_flags = SA_NOCLDSTOP
  };

  assert (!server.initialized);

  server.ws_path = ws_path;
  server.client_cert_mode = client_cert_mode;

  /* Initialize state dir for ws instances; $RUNTIME_DIRECTORY is set by systemd's RuntimeDirectory=, or by tests */
  server.state_dir = secure_getenv ("RUNTIME_DIRECTORY");
  if (!server.state_dir)
    err (1, "$RUNTIME_DIRECTORY environment variable must be set to a private directory");

  /* Initialize TLS */
  if (certfile)
    {
      gnutls_check (gnutls_certificate_allocate_credentials (&server.x509_cred));

      if (keyfile)
        {
          ret = gnutls_certificate_set_x509_key_file (server.x509_cred, certfile, keyfile, GNUTLS_X509_FMT_PEM);
        }
      else
        {
          /* without keyfile, certfile must include the key */
          gnutls_datum_t cert, key;
          int r;

          r = cockpit_certificate_parse (certfile, (char**) &cert.data, (char**) &key.data);
          if (r < 0)
            errx (1,  "Invalid server certificate+key file %s: %s", certfile, strerror (-r));
          cert.size = strlen ((char*) cert.data);
          key.size = strlen ((char*) key.data);
          ret = gnutls_certificate_set_x509_key_mem (server.x509_cred, &cert, &key, GNUTLS_X509_FMT_PEM);
          free (cert.data);
          free (key.data);
        }
      if (ret != GNUTLS_E_SUCCESS)
        errx (1, "Failed to initialize server certificate: %s", gnutls_strerror (ret));
      gnutls_check (gnutls_priority_init (&server.priority_cache, NULL, NULL));

#if GNUTLS_VERSION_NUMBER >= 0x030506 && GNUTLS_VERSION_NUMBER <= 0x030600
      /* only available since GnuTLS 3.5.6, and deprecated in 3.6 */
      gnutls_certificate_set_known_dh_params (server.x509_cred, GNUTLS_SEC_PARAM_MEDIUM);
#endif
    }

  /* systemd socket activated? */
  listen_fds = secure_getenv ("LISTEN_FDS");
  if (listen_fds && check_sd_listen_pid ())
    {
      if (strcmp (listen_fds, "1") != 0)
        errx (1, "This program can only accept exactly one socket from systemd, but got passed %s", listen_fds);
      server.listen_fd = SD_LISTEN_FDS_START;
      debug ("Server ready. Listening to systemd activated socket fd %i", server.listen_fd);
    }
  else
    {
      struct sockaddr_in sa_serv;
      int optval = 1;

      /* Listen to our port */
      server.listen_fd = socket (AF_INET, SOCK_STREAM | SOCK_CLOEXEC, 0);
      if (server.listen_fd < 0)
        err (1, "failed to create server listening fd");

      memset (&sa_serv, '\0', sizeof (sa_serv));
      sa_serv.sin_family = AF_INET;
      sa_serv.sin_addr.s_addr = INADDR_ANY;
      sa_serv.sin_port = htons (port);

      if (setsockopt (server.listen_fd, SOL_SOCKET, SO_REUSEADDR, (void *) &optval, sizeof (int)) < 0)
        err (1, "failed to set socket option");
      if (bind (server.listen_fd, (struct sockaddr *) &sa_serv, sizeof (sa_serv)) < 0)
        err (1, "failed to bind to port %hu", port);
      if (listen (server.listen_fd, 1024) < 0)
        err (1, "failed to listen to server port");
      debug ("Server ready. Listening on port %hu, fd %i", port, server.listen_fd);
    }

  /* epoll the listening fd */
  server.epollfd = epoll_create1 (EPOLL_CLOEXEC);
  if (server.epollfd < 0)
    err (1, "Failed to create epoll fd");
  ev.data.fd = server.listen_fd;
  if (epoll_ctl (server.epollfd, EPOLL_CTL_ADD, server.listen_fd, &ev) < 0)
    err (1, "Failed to epoll server listening fd");

  /* track cockpit-ws children */
  if (sigaction (SIGCHLD, &child_action, &server.old_sigchld) < 0)
      err (1, "Failed to set up SIGCHLD handler");

  server.initialized = true;
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
  close (server.epollfd);
  close (server.listen_fd);

  assert (server.initialized);

  block_sigchld (true);
  if (sigaction (SIGCHLD, &server.old_sigchld, NULL) < 0)
      err (1, "Failed to reset SIGCHLD handler");
  block_sigchld (false);

  for (Connection *c = server.connections; c; )
    {
      Connection *cnext = c->next;
      connection_free (c);
      c = cnext;
    }

  for (WsInstance *ws = server.wss; ws; )
    {
      WsInstance *wsnext = ws->next;
      ws_instance_free (ws);
      ws = wsnext;
    }
  if (server.ws_notls)
    ws_instance_free (server.ws_notls);

  if (server.x509_cred)
    {
      gnutls_certificate_free_credentials (server.x509_cred);
      gnutls_priority_deinit (server.priority_cache);
    }

  memset (&server, 0, sizeof (server));
}

/**
 * server_poll_event: Wait for and process one event
 *
 * @timeout: number of milliseconds to wait for an event to happen; after that,
 * the function will return 0. -1 will to block forever
 *
 * This can be any event on the listening socket, on connected client sockets,
 * or from cockpit-ws children.
 *
 * Returns: false on timeout, true if some event was handled.
 */
bool
server_poll_event (int timeout)
{
  int ret;
  struct epoll_event ev;

  assert (server.initialized);

  ret = epoll_wait (server.epollfd, &ev, 1, timeout);
  if (ret < 0)
    {
      if (errno == EINTR)
        return true;
      err (1, "Failed to epoll_wait");
    }
  else if (ret > 0)
    {
      if (ev.data.fd == server.listen_fd)
        handle_accept ();
      else if (ev.events & EPOLLIN)
        handle_connection_data (ev.data.ptr);
      /* this ought to be handled by recv() == 0 (EOF) already, but make sure
       * we clean up hanged up connections */
      else if (ev.events & EPOLLHUP)
        handle_hangup (ev.data.ptr);
      return true;
    }

  return false;
}

/**
 * server_run: Server main loop
 *
 * @idle_timeout: If > 0, the timeout in milliseconds after which #server_run()
 *                returns -- i. e. no events happened in that time and there are
 *                no connections.
 *
 * Returns if the server reached the idle timeout, otherwise runs forever.
 */
void
server_run (int idle_timeout)
{
  for (;;) {
    if (!server_poll_event (idle_timeout) && idle_timeout > 0)
      {
        if (server_num_connections () == 0)
          {
            debug ("reached idle time and no existing connections");
            break;
          }

        debug ("server_poll_event reached idle time, but there are existing connections");
      }
  }
}

/**
 * server_remove_ws: Clean up #WsInstance
 *
 * This should be called in response to a SIGCHLD signal, i. e. when a
 * cockpit-ws terminates. This also terminates and cleans up all Connections
 * from this cockpit-ws instance.
 */
void
server_remove_ws (pid_t ws_pid)
{
  WsInstance *ws = NULL;

  assert (server.initialized);

  /* find the WsInstance of that pid */
  if (server.ws_notls && server.ws_notls->pid == ws_pid)
    {
      ws = server.ws_notls;
      server.ws_notls = NULL;
    }
  else
    {
      WsInstance *wsprev = NULL;
      for (ws = server.wss; ws; wsprev = ws, ws = ws->next)
        {
          if (ws->pid == ws_pid)
            {
              if (wsprev == NULL) /* first ws */
                server.wss = ws->next;
              else
                wsprev->next = ws->next;
              break;
            }
        }
    }

  if (!ws)
    {
      warnx ("server_remove_ws: pid %u not found in our ws instances", ws_pid);
      return;
    }

  debug ("server_remove_ws: pid %u is ws %s", ws_pid, ws->socket.sun_path);

  remove_connection (-1, ws);
  ws_instance_free (ws);
}

unsigned
server_num_connections (void)
{
  unsigned count = 0;

  for (Connection *c = server.connections; c; c = c->next)
    count++;
  return count;
}

unsigned
server_num_ws (void)
{
  unsigned count = 0;

  for (WsInstance *ws = server.wss; ws; ws = ws->next)
    count++;
  if (server.ws_notls)
    count++;
  return count;
}

size_t
server_get_ws_pids (pid_t* pids, size_t pids_length)
{
  size_t num = 0;
  if (server.ws_notls)
    {
      assert (pids_length > num);
      pids[num++] = server.ws_notls->pid;
    }

  for (WsInstance *ws = server.wss; ws; ws = ws->next)
    {
      assert (pids_length > num);
      pids[num++] = ws->pid;
    }

  return num;
}
