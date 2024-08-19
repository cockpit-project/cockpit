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

#include "connection.h"

#include <arpa/inet.h>
#include <assert.h>
#include <err.h>
#include <errno.h>
#include <fcntl.h>
#include <net/if.h>
#include <netinet/in.h>
#include <poll.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/epoll.h>
#include <sys/param.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/timerfd.h>
#include <sys/types.h>
#include <sys/uio.h>
#include <unistd.h>

#include <gnutls/gnutls.h>
#include <gnutls/x509.h>

#include <common/cockpitfdpassing.h>
#include <common/cockpitjsonprint.h>
#include <common/cockpitmemory.h>
#include <common/cockpitwebcertificate.h>

#include "certificate.h"
#include "client-certificate.h"
#include "httpredirect.h"
#include "socket-io.h"
#include "utils.h"

/* cockpit-tls TCP server state (singleton) */
static struct {
  gnutls_certificate_request_t request_mode;
  Certificate *certificate;
  bool require_https;
  int wsinstance_sockdir;
  int cert_session_dir;
} parameters = {
  .wsinstance_sockdir = -1,
  .cert_session_dir = -1
};

typedef struct
{
  char buffer[16u << 10]; /* 16KiB */
  unsigned start, end;
  bool eof, shut_rd, shut_wr;
#ifdef DEBUG
  const char *name;
#endif
} Buffer;

/* a single TCP connection between the client (browser) and cockpit-tls */
typedef struct {
  int client_fd;
  int ws_fd;

  gnutls_session_t tls;

  Buffer client_to_ws_buffer;
  Buffer ws_to_client_buffer;

  char *client_cert_filename;
  char *wsinstance;
  int metadata_fd;
} Connection;

#define BUFFER_SIZE (sizeof ((Buffer *) 0)->buffer)
#define BUFFER_MASK (BUFFER_SIZE - 1)

static_assert (!(BUFFER_SIZE & BUFFER_MASK), "buffer size not a power of 2");
static_assert ((typeof (((Buffer *) 0)->start)) BUFFER_SIZE, "buffer is too big");


static inline bool
buffer_full (Buffer *self)
{
  return self->end - self->start == BUFFER_SIZE;
}

static inline bool
buffer_empty (Buffer *self)
{
  return self->end == self->start;
}

static inline bool
buffer_can_read (Buffer *self)
{
  return !self->shut_rd && !buffer_full (self);
}

static inline bool
buffer_can_write (Buffer *self)
{
  return !self->shut_wr && !buffer_empty (self);
}

static inline bool
buffer_needs_shut_rd (Buffer *self)
{
  return self->eof && !self->shut_rd;
}

static inline bool
buffer_needs_shut_wr (Buffer *self)
{
  return self->eof && buffer_empty (self) && !self->shut_wr;
}

static inline bool
buffer_alive (Buffer *self)
{
  return !self->shut_rd || !self->shut_wr;
}

static void
buffer_shut_rd (Buffer *self)
{
  self->shut_rd = true;
}

static void
buffer_shut_wr (Buffer *self)
{
  self->shut_wr = true;
}

static void
buffer_eof (Buffer *self)
{
  self->eof = true;
}

static void
buffer_epipe (Buffer *self)
{
  self->start = self->end;
  self->eof = true;
}

static inline bool
buffer_valid (Buffer *self)
{
  return self->end - self->start <= BUFFER_SIZE;
}

static short
calculate_events (Buffer *reader,
                  Buffer *writer)
{
  return buffer_can_read (reader) * POLLIN | buffer_can_write (writer) * POLLOUT;
}

static short
calculate_revents (Buffer *reader,
                   Buffer *writer)
{
  return buffer_needs_shut_rd (reader) * POLLIN | buffer_needs_shut_wr (writer) * POLLOUT;
}

static int
get_iovecs (struct iovec *iov,
            int           iov_length,
            char         *buffer,
            unsigned      start,
            unsigned      end)
{
  int i = 0;

  debug (IOVEC, "  get_iovecs (%p, %i, %p, 0x%x, 0x%x)", iov, iov_length, buffer, start, end);
  assert (end - start <= BUFFER_SIZE);

  for (i = 0; i < iov_length && start != end; i++)
    {
      unsigned start_offset = start & BUFFER_MASK;

      iov[i].iov_base = &buffer[start_offset];
      iov[i].iov_len = MIN(BUFFER_SIZE - start_offset, end - start);
      start += iov[i].iov_len;

      debug (IOVEC, "    iov[%i] = { 0x%zx, 0x%zx };  start = 0x%x;", i,
             ((char *) iov[i].iov_base - buffer), iov[i].iov_len, start);
    }

  debug (IOVEC, "    return %i;", i);

  return i;
}

static void
buffer_write_to_fd (Buffer *self,
                    int     fd,
                    int    *fd_to_send)
{
  struct iovec iov[2];
  ssize_t s;

  debug (BUFFER, "buffer_write_to_fd (%s/0x%x/0x%x, %i)", self->name, self->start, self->end, fd);

  struct msghdr msg = { .msg_iov = iov };
  msg.msg_iovlen = get_iovecs (iov, 2, self->buffer, self->start, self->end);

  if (msg.msg_iovlen)
    {
      struct cmsghdr cmsg[2];

      if (fd_to_send && *fd_to_send != -1)
        cockpit_socket_msghdr_add_fd (&msg, cmsg, sizeof cmsg, *fd_to_send);

      do
        s = sendmsg (fd, &msg, MSG_NOSIGNAL | MSG_DONTWAIT);
      while (s == -1 && errno == EINTR);

      debug (BUFFER, "  sendmsg returns %zi %s", s, (s == -1) ? strerror (errno) : "");

      if (fd_to_send && *fd_to_send != -1 && s != -1)
        {
          close (*fd_to_send);
          *fd_to_send = -1;
        }

      if (s == -1)
        {
          if (errno != EAGAIN)
            /* Includes the expected case of EPIPE */
            buffer_epipe (self);
        }
      else
        self->start += s;
    }

  if (buffer_needs_shut_wr (self))
    {
      shutdown (fd, SHUT_WR);
      buffer_shut_wr (self);
    }

  assert (buffer_valid (self));
}

static void
buffer_read_from_fd (Buffer *self,
                     int     fd)
{
  debug (BUFFER, "buffer_read_from_fd (%s/0x%x/0x%x, %i)", self->name, self->start, self->end, fd);

  if (buffer_needs_shut_rd (self))
    {
      shutdown (fd, SHUT_RD);
      buffer_shut_rd (self);
      return;
    }

  struct iovec iov[2];
  ssize_t s;
  int iovcnt = get_iovecs (iov, 2, self->buffer, self->end, self->start + BUFFER_SIZE);
  assert (iovcnt > 0);

  do
    s = readv (fd, iov, iovcnt);
  while (s == -1 && errno == EINTR);

  debug (BUFFER, "  readv returns %zi %s", s, (s == -1) ? strerror (errno) : "");

  if (s == -1)
    {
      if (errno != EAGAIN)
        buffer_eof (self);
    }
  else if (s == 0)
    buffer_eof (self);
  else
    self->end += s;

  assert (buffer_valid (self));
}

static void
buffer_write_to_tls (Buffer           *self,
                     gnutls_session_t  tls)
{
  struct iovec iov;
  ssize_t s;

  debug (BUFFER, "buffer_write_to_tls (%s/0x%x/0x%x, %p)", self->name, self->start, self->end, tls);

  if (get_iovecs (&iov, 1, self->buffer, self->start, self->end))
    {
      do
        s = gnutls_record_send (tls, iov.iov_base, iov.iov_len);
      while (s == GNUTLS_E_INTERRUPTED);

      debug (BUFFER, "  gnutls_record_send returns %zi %s", s, (s < 0) ? gnutls_strerror (-s) : "");

      if (s < 0)
        {
          if (s != GNUTLS_E_AGAIN)
            buffer_epipe (self);
        }
      else
        self->start += s;
    }

  if (buffer_needs_shut_wr (self))
    {
      gnutls_bye (tls, GNUTLS_SHUT_WR);
      buffer_shut_wr (self);
    }

  assert (buffer_valid (self));
}

static void
buffer_read_from_tls (Buffer           *self,
                      gnutls_session_t  tls)
{
  struct iovec iov;
  ssize_t s;

  debug (BUFFER, "buffer_read_from_tls (%s/0x%x/0x%x, %p)", self->name, self->start, self->end, tls);

  if (buffer_needs_shut_rd (self))
    {
      /* There's not GNUTLS_SHUT_RD, so do the shutdown() on the
       * underlying fd.
       */
      shutdown (gnutls_transport_get_int (tls), SHUT_RD);
      buffer_shut_rd (self);
      return;
    }

  int iovcnt = get_iovecs (&iov, 1, self->buffer, self->end, self->start + BUFFER_SIZE);
  assert (iovcnt == 1);

  do
    s = gnutls_record_recv (tls, iov.iov_base, iov.iov_len);
  while (s == GNUTLS_E_INTERRUPTED);

  debug (BUFFER, "  gnutls_record_recv returns %zi %s", s, (s < 0) ? gnutls_strerror (-s) : "");

  if (s <= 0)
    {
      if (s != GNUTLS_E_AGAIN)
        buffer_epipe (self);
    }
  else
    self->end += s;

  assert (buffer_valid (self));
}

static bool
request_dynamic_wsinstance (const char *fingerprint)
{
  bool status = false;
  char reply[20];
  int fd;

  debug (CONNECTION, "requesting dynamic wsinstance for %s:\n", fingerprint);

  fd = socket (AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
  if (fd == -1)
    {
      warn ("socket() failed");
      goto out;
    }

  debug (CONNECTION, "  -> connecting to https-factory.sock");
  if (af_unix_connectat (fd, parameters.wsinstance_sockdir, "https-factory.sock") != 0)
    {
      warn ("connect(https-factory.sock) failed");
      goto out;
    }

  /* send the fingerprint */
  debug (CONNECTION, "  -> success; sending fingerprint...");
  if (!send_all (fd, fingerprint, strlen (fingerprint), 5 * 1000000))
    goto out;

  debug (CONNECTION, "  -> success; waiting for reply...");

  /* wait for the systemd job status reply */
  if (!recv_alnum (fd, reply, sizeof reply, 30 * 1000000))
    goto out;

  debug (CONNECTION, "  -> got reply '%s'...", reply);
  status = strcmp (reply, "done") == 0;

out:
  debug (CONNECTION, "  -> %s.", status ? "success" : "fail");

  if (fd != -1)
    close (fd);

  return status;
}

static bool
connection_connect_to_dynamic_wsinstance (Connection *self)
{
  char sockname[80];
  int r;

  assert (self->tls != NULL);

  r = snprintf (sockname, sizeof sockname, "https@%s.sock", self->wsinstance);
  assert (0 < r && r < sizeof sockname);

  debug (CONNECTION, "Connecting to dynamic https instance %s...", sockname);

  /* fast path: the socket already exists, so we can just connect to it */
  if (af_unix_connectat (self->ws_fd, parameters.wsinstance_sockdir, sockname) == 0)
    return true;

  if (errno != ENOENT && errno != ECONNREFUSED)
    warn ("connect(%s) failed on the first attempt", sockname);

  debug (CONNECTION, "  -> failed (%m).  Requesting activation.");
  /* otherwise, ask for the instance to be started */
  if (!request_dynamic_wsinstance (self->wsinstance))
    return false;

  /* ... and try one more time. */
  debug (CONNECTION, "  -> trying again");
  if (af_unix_connectat (self->ws_fd, parameters.wsinstance_sockdir, sockname) != 0)
    {
      warn ("connect(%s) failed on the second attempt", sockname);
      return false;
    }

  /* otherwise, we're now connected */
  debug (CONNECTION, "  -> success!");
  return true;
}

static bool
connection_is_to_localhost (Connection *self)
{
  struct sockaddr_storage address;
  socklen_t address_len = sizeof address;

  /* NB: We check our own socket name, not the peer.  That lets us find
   * out if the connection was made to 127.0.0.1, or some other address.
   *
   * In the case that the client connects to 127.0.0.2, for example, the
   * peer socket is still 127.0.0.1.
   */
  if (getsockname (self->client_fd, (struct sockaddr *) &address, &address_len) != 0)
    return false;

  switch (address.ss_family)
    {
    case AF_UNIX:
      return true;

    case AF_INET:
        {
          struct in_addr *addr4 = &((struct sockaddr_in *) &address)->sin_addr;
          return addr4->s_addr == htonl (INADDR_LOOPBACK);
        }

    case AF_INET6:
        {
          struct in6_addr *addr6 = &((struct sockaddr_in6 *) &address)->sin6_addr;

          /* Need to handle both ::ffff:127.0.0.1 as well as ::1
           * This is ugly, but there doesn't seem to be a better (static) way... */
          const struct in6_addr v4_loopback = { { { 0,0,0,0,0,0,0,0,0,0,0xff,0xff,127,0,0,1 } } };
          return IN6_IS_ADDR_LOOPBACK (addr6) || IN6_ARE_ADDR_EQUAL(addr6, &v4_loopback);
        }

    default:
      return false;
    }
}

static bool
connection_connect_to_wsinstance (Connection *self)
{
  if (self->tls == NULL && parameters.require_https && !connection_is_to_localhost (self))
    {
      /* server is expecting https connections */
      self->ws_fd = http_redirect_connect ();
      if (self->ws_fd == -1)
        {
          warn ("failed to connect to httpredirect");
          return false;
        }

      return true;
    }

  self->ws_fd = socket (AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
  if (self->ws_fd == -1)
    {
      warn ("failed to create cockpit-ws client socket");
      return false;
    }

  if (self->tls == NULL)
    {
      /* server is expecting http connections, or localhost is exempt */
      if (af_unix_connectat (self->ws_fd, parameters.wsinstance_sockdir, "http.sock") != 0)
        {
          warn ("connect(http.sock) failed");
          return false;
        }

      return true;
    }
  else
    return connection_connect_to_dynamic_wsinstance (self);
}

/**
 * connection_handshake: Handle first event on client fd
 *
 * Check the very first byte of a new connection to tell apart TLS from plain
 * HTTP. Initialize TLS.
 */
static bool
connection_handshake (Connection *self)
{
  char b;
  int ret;

  assert (self->ws_fd == -1);

  /* Wait for up to 30 seconds to receive the first byte before shutting
   * down the connection.
   */
  struct pollfd pfd = { .fd = self->client_fd, .events = POLLIN };
  do
    ret = poll (&pfd, 1, 30000); /* timeout is wrong on syscall restart, but it's fine */
  while (ret == -1 && errno == EINTR);

  if (ret < 0)
    err (EXIT_FAILURE, "poll() failed on client connection");

  if (ret == 0)
    {
      debug (CONNECTION, "client sent no data in 30 seconds, dropping connection.");
      return false;
    }

  /* peek the first byte and see if it's a TLS connection (starting with 22).
     We can assume that there is some data to read, as this is called in response
     to an epoll event. */
  ret = recv (self->client_fd, &b, 1, MSG_PEEK);

  if (ret < 0)
    {
      debug (CONNECTION, "could not read first byte: %s", strerror (errno));
      return false;
    }

  if (ret == 0) /* EOF */
    {
      debug (CONNECTION, "client disconnected without sending any data");
      return false;
    }

  if (b == 22)
    {
      debug (CONNECTION, "first byte is %i, initializing TLS", (int) b);

      if (parameters.certificate == NULL)
        {
          warnx ("got TLS connection, but our server does not have a certificate/key; refusing");
          return false;
        }

      ret = gnutls_init (&self->tls, GNUTLS_SERVER | GNUTLS_NO_SIGNAL);
      if (ret != GNUTLS_E_SUCCESS)
        {
          warnx ("gnutls_init failed: %s", gnutls_strerror (ret));
          return false;
        }

      ret = gnutls_set_default_priority (self->tls);
      if (ret != GNUTLS_E_SUCCESS)
        {
          warnx ("gnutls_set_default_priority failed: %s", gnutls_strerror (ret));
          return false;
        }

      ret = gnutls_credentials_set (self->tls, GNUTLS_CRD_CERTIFICATE,
                                    certificate_get_credentials (parameters.certificate));
      if (ret != GNUTLS_E_SUCCESS)
        {
          warnx ("gnutls_credentials_set failed: %s", gnutls_strerror (ret));
          return false;
        }

      gnutls_session_set_verify_function (self->tls, client_certificate_verify);
      gnutls_certificate_server_set_request (self->tls, parameters.request_mode);
      gnutls_handshake_set_timeout (self->tls, GNUTLS_DEFAULT_HANDSHAKE_TIMEOUT);
      gnutls_transport_set_int (self->tls, self->client_fd);

      debug (CONNECTION, "TLS is initialised; doing handshake");

      do
        ret = gnutls_handshake (self->tls);
      while (ret == GNUTLS_E_INTERRUPTED);

      if (ret != GNUTLS_E_SUCCESS)
        {
          warnx ("gnutls_handshake failed: %s", gnutls_strerror (ret));
          return false;
        }

      debug (CONNECTION, "TLS handshake completed");

      if (!client_certificate_accept (self->tls, parameters.cert_session_dir,
                                      &self->wsinstance, &self->client_cert_filename))
        return false;
    }

  return true;
}

static void
connection_thread_loop (Connection *self)
{
  while (buffer_alive (&self->client_to_ws_buffer) || buffer_alive (&self->ws_to_client_buffer))
    {
      short client_events, ws_events;
      short client_revents, ws_revents;
      int n_ready;

      client_events = calculate_events (&self->client_to_ws_buffer, &self->ws_to_client_buffer);
      ws_events = calculate_events (&self->ws_to_client_buffer, &self->client_to_ws_buffer);
      client_revents = calculate_revents (&self->client_to_ws_buffer, &self->ws_to_client_buffer);
      ws_revents = calculate_revents (&self->ws_to_client_buffer, &self->client_to_ws_buffer);

      if (self->tls && buffer_can_read (&self->client_to_ws_buffer))
        client_revents |= POLLIN * gnutls_record_check_pending (self->tls);

      debug (POLL, "poll | client %d/x%x/x%x | ws %d/x%x/x%x |",
             self->client_fd, client_events, client_revents,
             self->ws_fd, ws_events, ws_revents);

      do
        {
          /* don't poll for no events, we'd spin in a POLLHUP loop otherwise */
          struct pollfd fds[] = { { client_events ? self->client_fd : -1, client_events },
                                  { ws_events ? self->ws_fd : -1, ws_events }};

          n_ready = poll (fds, N_ELEMENTS (fds), (client_revents | ws_revents) ? 0 : -1);

          client_revents |= fds[0].revents;
          ws_revents |= fds[1].revents;
        }
      while (n_ready == -1 && errno == EINTR);

      if (n_ready == -1)
        {
          if (errno == EINVAL) /* ran out of fds */
            return;
          err (EXIT_FAILURE, "poll failed");
        }

      debug (POLL, "poll result %i | client %d/x%x | ws %d/x%x |", n_ready,
             self->client_fd, client_revents, self->ws_fd, ws_revents);

      if (self->tls)
        {
          if (client_revents & POLLIN)
            buffer_read_from_tls (&self->client_to_ws_buffer, self->tls);

          if (client_revents & POLLOUT)
            buffer_write_to_tls (&self->ws_to_client_buffer, self->tls);
        }
      else
        {
          if (client_revents & POLLIN)
            buffer_read_from_fd (&self->client_to_ws_buffer, self->client_fd);

          if (client_revents & POLLOUT)
            buffer_write_to_fd (&self->ws_to_client_buffer, self->client_fd, NULL);
        }

      if (ws_revents & POLLIN)
        buffer_read_from_fd (&self->ws_to_client_buffer, self->ws_fd);

      if (ws_revents & POLLOUT)
        buffer_write_to_fd (&self->client_to_ws_buffer, self->ws_fd, &self->metadata_fd);
    }
}

static bool
connection_create_metadata (Connection *self)
{
  struct sockaddr_storage addr;
  socklen_t addrsize = sizeof addr;
  if (getpeername (self->client_fd, (struct sockaddr *) &addr, &addrsize))
    {
      debug (CONNECTION, "getpeername(%i) failed: %m.  Disconnecting.", self->client_fd);
      return false;
    }

  /* maximum we're going to see */
  char ip[INET6_ADDRSTRLEN + 1 + IF_NAMESIZE + 1];
  in_port_t port;

  switch (addr.ss_family)
    {
    case AF_INET:
      {
        struct sockaddr_in *in_addr = (struct sockaddr_in *) &addr;

        port = in_addr->sin_port;
        const char *r = inet_ntop (AF_INET, &in_addr->sin_addr, ip, sizeof ip);
        assert (r != NULL);
      }
      break;

    case AF_INET6:
      {
        struct sockaddr_in6 *in6_addr = (struct sockaddr_in6 *) &addr;

        port = in6_addr->sin6_port;
        const char *r = inet_ntop (AF_INET6, &in6_addr->sin6_addr, ip, sizeof ip);
        assert (r != NULL);

        if (in6_addr->sin6_scope_id)
          {
            size_t iplen = strlen (ip);

            ip[iplen++] = '%';

            assert (IF_NAMESIZE < sizeof ip - iplen);
            if (!if_indextoname (in6_addr->sin6_scope_id, ip + iplen))
              {
                /* fallback: just write the index */
                int r = snprintf (ip + iplen, IF_NAMESIZE, "%u", in6_addr->sin6_scope_id);
                assert (r < IF_NAMESIZE);
              }

            /* both snprintf() and if_indextoname() will have added a nul. */
          }
      }
      break;

    case AF_UNIX:
      /* only used in testing */
      ip[0] = '\0';
      port = 0;
      break;

    default:
      debug (CONNECTION, "Connection fd %i had unknown peer address family %d.  Disconnecting.",
             self->client_fd, (int) addr.ss_family);
      return false;
    }

  debug (CONNECTION, "Connection fd %i is from %s:%d", self->client_fd, ip, port);

  FILE *stream = cockpit_json_print_open_memfd ("cockpit-tls metadata", 1);

  cockpit_json_print_string_property (stream, "origin-ip", ip, -1);
  cockpit_json_print_integer_property (stream, "origin-port", port);

  if (self->client_cert_filename)
    cockpit_json_print_string_property (stream, "client-certificate", self->client_cert_filename, -1);

  self->metadata_fd = cockpit_json_print_finish_memfd (&stream);

  return true;
}

void
connection_thread_main (int fd)
{
  Connection self = { .client_fd = fd, .ws_fd = -1, .metadata_fd = -1 };

  assert (!buffer_can_write (&self.client_to_ws_buffer));
  assert (!buffer_can_write (&self.ws_to_client_buffer));
  assert (!self.tls);

#ifdef DEBUG
  self.client_to_ws_buffer.name = "client-to-ws";
  self.ws_to_client_buffer.name = "ws-to-client";
#endif

  debug (CONNECTION, "New thread for fd %i", fd);

  if (connection_handshake (&self) &&
      connection_create_metadata (&self) &&
      connection_connect_to_wsinstance (&self))
    connection_thread_loop (&self);

  debug (CONNECTION, "Thread for fd %i is going to exit now", fd);

  free (self.wsinstance);

  if (self.client_cert_filename)
    client_certificate_unlink_and_free (parameters.cert_session_dir, self.client_cert_filename);

  if (self.tls)
    gnutls_deinit (self.tls);

  if (self.client_fd != -1)
    close (self.client_fd);

  if (self.ws_fd != -1)
    close (self.ws_fd);

  if (self.metadata_fd != -1)
    close (self.metadata_fd);
}

/**
 * connection_crypto_init: Initialise TLS support
 *
 * This should be called after server_init() in order to enable TLS
 * support for connections. If this function is not called, the server
 * will only be able to handle http requests.
 *
 * The certificate file must either contain the key as well, or end with
 * "*.crt" or "*.cert" and have a corresponding "*.key" file.
 *
 * @certfile: Server TLS certificate file; cannot be %NULL
 * @request_mode: Whether to ask for client certificates
 */
void
connection_crypto_init (const char *certificate_filename,
                        const char *key_filename,
                        bool allow_unencrypted,
                        gnutls_certificate_request_t request_mode)
{
  parameters.certificate = certificate_load (certificate_filename, key_filename);
  parameters.request_mode = request_mode;
  /* If we aren't called, then require_https is false */
  parameters.require_https = !allow_unencrypted;
}

void
connection_set_directories (const char *wsinstance_sockdir,
                            const char *runtime_directory)
{
  assert (parameters.wsinstance_sockdir == -1);
  assert (parameters.cert_session_dir == -1);

  assert (wsinstance_sockdir != NULL);
  assert (runtime_directory != NULL);

  parameters.wsinstance_sockdir = open (wsinstance_sockdir, O_PATH | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (parameters.wsinstance_sockdir == -1)
    err (EXIT_FAILURE, "Unable to open wsinstance sockdir %s", wsinstance_sockdir);

  int runtimedir_fd = open (runtime_directory, O_PATH | O_DIRECTORY | O_NOFOLLOW);
  if (runtimedir_fd == -1)
    err (EXIT_FAILURE, "Unable to open runtime directory %s", runtime_directory);

  if (mkdirat (runtimedir_fd, "clients", 0700) != 0)
    err (EXIT_FAILURE, "mkdir: %s/clients", runtime_directory);

  parameters.cert_session_dir = openat (runtimedir_fd, "clients", O_PATH | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (parameters.cert_session_dir == -1)
    err (EXIT_FAILURE, "Unable to open certificate directory %s/clients", runtime_directory);

  close (runtimedir_fd);
}

void
connection_cleanup (void)
{
  assert (parameters.wsinstance_sockdir != -1);
  assert (parameters.cert_session_dir != -1);

  if (parameters.certificate)
    {
      certificate_unref (parameters.certificate);
      parameters.certificate = NULL;
    }

  parameters.require_https = false;

  close (parameters.cert_session_dir);
  parameters.cert_session_dir = -1;

  close (parameters.wsinstance_sockdir);
  parameters.wsinstance_sockdir = -1;
}
