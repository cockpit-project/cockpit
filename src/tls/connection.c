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

#include "connection.h"

#include <assert.h>
#include <err.h>
#include <errno.h>
#include <netinet/in.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/epoll.h>
#include <sys/param.h>
#include <sys/poll.h>
#include <sys/socket.h>
#include <sys/timerfd.h>
#include <sys/types.h>
#include <sys/uio.h>
#include <sys/un.h>
#include <unistd.h>

#include <gnutls/gnutls.h>
#include <gnutls/x509.h>

#include <common/cockpitmemory.h>
#include <common/cockpitwebcertificate.h>
#include "utils.h"

/* cockpit-tls TCP server state (singleton) */
static struct {
  gnutls_certificate_request_t request_mode;
  gnutls_certificate_credentials_t x509_cred;
  const char *wsinstance_sockdir;
} parameters;

typedef struct
{
  char buffer[16u << 10]; /* 16KiB */
  unsigned start, end;
  bool eof, shut_rd, shut_wr;
#ifdef DEBUG
  const char *name;
#endif
} Buffer;


/* TLS certificate → https ws instance socket name map */
typedef struct HTTPSInstance {
  gnutls_datum_t peer_cert;
  char socket_name[30];
  struct HTTPSInstance *next;
} HTTPSInstance;

static pthread_mutex_t https_instances_mutex = PTHREAD_MUTEX_INITIALIZER;
static HTTPSInstance *https_instances;


/* a single TCP connection between the client (browser) and cockpit-tls */
typedef struct {
  int client_fd;
  int ws_fd;

  gnutls_session_t tls;

  Buffer client_to_ws_buffer;
  Buffer ws_to_client_buffer;
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
  assert (end - start >= 0);

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
                    int     fd)
{
  struct iovec iov[2];
  ssize_t s;

  debug (BUFFER, "buffer_write_to_fd (%s/0x%x/0x%x, %i)", self->name, self->start, self->end, fd);

  struct msghdr msg = { .msg_iov = iov };
  msg.msg_iovlen = get_iovecs (iov, 2, self->buffer, self->start, self->end);
  if (msg.msg_iovlen)
    {
      do
        s = sendmsg (fd, &msg, MSG_NOSIGNAL | MSG_DONTWAIT);
      while (s == -1 && errno == EINTR);

      debug (BUFFER, "  sendmsg returns %zi %s", s, (s == -1) ? strerror (errno) : "");

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
  //debug ("buffer_read_from_fd (%s/0x%x/0x%x, %i)", self->name, self->start, self->end, fd);

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

  //debug ("  readv returns %zi %s", s, (s == -1) ? strerror (errno) : "");

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

  //debug ("buffer_write_to_tls (%s/0x%x/0x%x, %p)", self->name, self->start, self->end, tls);

  if (get_iovecs (&iov, 1, self->buffer, self->start, self->end))
    {
      do
        s = gnutls_record_send (tls, iov.iov_base, iov.iov_len);
      while (s == GNUTLS_E_INTERRUPTED);

      //debug ("  gnutls_record_send returns %zi %s", s, (s < 0) ? gnutls_strerror (-s) : "");

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

  //debug ("buffer_read_from_tls (%s/0x%x/0x%x, %p)", self->name, self->start, self->end, tls);

  if (buffer_needs_shut_rd (self))
    {
      //gnutls_bye (tls, GNUTLS_SHUT_RD);
      shutdown (gnutls_transport_get_int (tls), SHUT_RD);
      buffer_shut_rd (self);
      return;
    }

  int iovcnt = get_iovecs (&iov, 1, self->buffer, self->end, self->start + BUFFER_SIZE);
  assert (iovcnt == 1);

  do
    s = gnutls_record_recv (tls, iov.iov_base, iov.iov_len);
  while (s == GNUTLS_E_INTERRUPTED);

  //debug ("  gnutls_record_recv returns %zi %s", s, (s < 0) ? gnutls_strerror (-s) : "");

  if (s <= 0)
    {
      if (s != GNUTLS_E_AGAIN)
        buffer_epipe (self);
    }
  else
    self->end += s;

  assert (buffer_valid (self));
}

/**
 * https_instance_new: Create a new cockpit-ws instance for given peer certificate
 */
static HTTPSInstance*
https_instance_new (const gnutls_datum_t *der)
{
  struct sockaddr_un factory_sockaddr = { .sun_family = AF_UNIX };
  size_t len;
  int r;
  int fd;
  HTTPSInstance *inst;

  r = snprintf (factory_sockaddr.sun_path, sizeof factory_sockaddr.sun_path,
                "%s/https-factory.sock", parameters.wsinstance_sockdir);
  assert (r < sizeof factory_sockaddr.sun_path);

  /* connect to factory */
  fd = socket (AF_UNIX, SOCK_STREAM, 0);
  if (fd < 0)
    {
      warn ("https_instance_new: failed to create socket");
      return NULL;
    }
  if (connect (fd, (struct sockaddr *) &factory_sockaddr, sizeof factory_sockaddr) < 0)
  {
    warn ("https_instance_new: failed to connect to https factory socket");
    return NULL;
  }

  inst = callocx (1, sizeof (HTTPSInstance));

  /* read instance socket name until EOF */
  for (len = 0; len < sizeof inst->socket_name;) {
      r = read (fd, inst->socket_name + len, (sizeof inst->socket_name) - len);
      if (r < 0 && errno == EINTR)
        continue;
      if (r == 0) /* EOF */
        break;
      len += r;
  }
  close (fd);

  if (r < 0 || len == 0 || len >= sizeof inst->socket_name)
  {
    if (r < 0)
      warn ("https_instance_new: failed to read instance socket name from factory");
    else if (len == 0)
      warnx ("https_instance_new: https instance factory did not send a socket name");
    else
      errx (EXIT_FAILURE, "https_instance_new: https instance factory sent too long socket name (max %zu bytes)", sizeof inst->socket_name);
    free (inst);
    return NULL;
  }

  /* clone DER certificate */
  if (der)
    {
      inst->peer_cert.size = der->size;
      inst->peer_cert.data = mallocx (inst->peer_cert.size);
      memcpy (inst->peer_cert.data, der->data, inst->peer_cert.size);
    }

  return inst;
}

/**
 * https_instance_has_peer_cert: Check if that instance is for a given GnuTLS DER client certificate
 *
 * Returns true if either this ws instance has no client certificate and der is
 * %NULL or empty, or if both certificates are identical. Otherwise returns false.
 */
static bool
https_instance_has_peer_cert (HTTPSInstance *inst, const gnutls_datum_t *der)
{
  if (!der)
    return inst->peer_cert.size == 0;
  if (inst->peer_cert.size != der->size)
    return false;
  return memcmp (inst->peer_cert.data, der->data, der->size) == 0;
}


/**
 * connection_ws_socket_name: Get cockpit-ws socket name for this connection
 *
 * Every client certificate gets its own cockpit-ws instance for better
 * isolation, plus one instance for "no certificate". For plain http there's
 * two more instances for without and with TLS redirection.
 */
static const char*
connection_ws_socket_name (Connection *self)
{
  const gnutls_datum_t *peer_der;
  HTTPSInstance *https_instance;

  if (parameters.x509_cred == NULL)
    {
      assert (!self->tls);
      return "http.sock";
    }
  if (!self->tls)
    return "http-redirect.sock";

  /* https */

  pthread_mutex_lock (&https_instances_mutex);

  /* find existing ws instance for this peer cert; note that these will never go away on the systemd side during
   * cockpit-tls' lifetime -- even if cockpit-ws idles out, it will go back to socket activation and get re-spawned on
   * demand. So we don't need to bother with cleaning up the list. */
  peer_der = gnutls_certificate_get_peers (self->tls, NULL);
  for (https_instance = https_instances; https_instance; https_instance = https_instance->next)
    if (https_instance_has_peer_cert (https_instance, peer_der))
      {
        debug (CONNECTION, "connection_ws_socket_name https: peer certificate handled by existing ws instance %s", https_instance->socket_name);
        break;
      }

  /* none? create a new one */
  if (!https_instance)
    {
      https_instance = https_instance_new (peer_der);
      if (https_instance)
        {
          debug (CONNECTION, "ws_socket_name https: created new ws instance %s for new peer certificate", https_instance->socket_name);
          https_instance->next = https_instances;
          https_instances = https_instance;
        }
    }

  pthread_mutex_unlock (&https_instances_mutex);

  return https_instance ? https_instance->socket_name : NULL;
}


/**
 * connection_init_ws: Connect to a cockpit-ws instance for a new Connection
 */
static bool
connection_init_ws (Connection *self)
{
  struct sockaddr_un sockaddr = { .sun_family = AF_UNIX };
  const char *sockname = connection_ws_socket_name (self);
  int r;

  if (!sockname)
    return false;

  r = snprintf (sockaddr.sun_path, sizeof sockaddr.sun_path,
                "%s/%s", parameters.wsinstance_sockdir,
                sockname);
  assert (r < sizeof sockaddr.sun_path);

  debug (CONNECTION, "connection_init_ws: attempting to connect to socket %s", sockaddr.sun_path);

  /* connect to ws instance */
  self->ws_fd = socket (AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
  if (self->ws_fd < 0)
    {
      warn ("failed to create cockpit-ws client socket");
      return false;
    }

  if (connect (self->ws_fd, (struct sockaddr *) &sockaddr, sizeof sockaddr) < 0)
    {
      /* cockpit-ws crashed? */
      warn ("failed to connect to cockpit-ws");
      return false;
    }

  debug (CONNECTION, "  connected.");

  return true;
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
    err (1, "poll() failed on client connection");

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

      if (parameters.x509_cred == NULL)
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

      ret = gnutls_credentials_set (self->tls, GNUTLS_CRD_CERTIFICATE, parameters.x509_cred);
      if (ret != GNUTLS_E_SUCCESS)
        {
          warnx ("gnutls_credentials_set failed: %s", gnutls_strerror (ret));
          return false;
        }

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
          err (1, "poll failed");
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
            buffer_write_to_fd (&self->ws_to_client_buffer, self->client_fd);
        }

      if (ws_revents & POLLIN)
        buffer_read_from_fd (&self->ws_to_client_buffer, self->ws_fd);

      if (ws_revents & POLLOUT)
        buffer_write_to_fd (&self->client_to_ws_buffer, self->ws_fd);
    }
}

void
connection_thread_main (int fd)
{
  Connection self = { .client_fd = fd, .ws_fd = -1 };

  assert (!buffer_can_write (&self.client_to_ws_buffer));
  assert (!buffer_can_write (&self.ws_to_client_buffer));
  assert (!self.tls);

#ifdef DEBUG
  self.client_to_ws_buffer.name = "client-to-ws";
  self.ws_to_client_buffer.name = "ws-to-client";
#endif

  debug (CONNECTION, "New thread for fd %i", fd);

  if (connection_handshake (&self) && connection_init_ws (&self))
    connection_thread_loop (&self);

  debug (CONNECTION, "Thread for fd %i is going to exit now", fd);

  if (self.tls)
    /* XXX: bye? */
    gnutls_deinit (self.tls);

  if (self.client_fd != -1)
    close (self.client_fd);

  if (self.ws_fd != -1)
    close (self.ws_fd);
}

/**
 * verify_peer_certificate: Custom client certificate validation function
 *
 * cockpit-tls ignores CA/trusted owner and leaves that to e. g. sssd. But
 * validate the other properties such as expiry, unsafe algorithms, etc.
 * This combination cannot be done with gnutls_session_set_verify_cert().
 */
static int
verify_peer_certificate (gnutls_session_t session)
{
  unsigned status;
  int ret;

  do
    ret = gnutls_certificate_verify_peers2 (session, &status);
  while (ret == GNUTLS_E_INTERRUPTED);

  if (ret == 0)
    {
      /* ignore CA/trusted owner and leave that to e. g. sssd */
      status &= ~(GNUTLS_CERT_INVALID | GNUTLS_CERT_SIGNER_NOT_FOUND | GNUTLS_CERT_SIGNER_NOT_CA);
      if (status != 0)
        {
          gnutls_datum_t msg;
          ret = gnutls_certificate_verification_status_print (status, gnutls_certificate_type_get (session), &msg, 0);
          if (ret != GNUTLS_E_SUCCESS)
            errx (1, "Failed to print verification status: %s", gnutls_strerror (ret));
          warnx ("Invalid TLS peer certificate: %s", msg.data);
          gnutls_free (msg.data);
#ifdef GNUTLS_E_CERTIFICATE_VERIFICATION_ERROR
          return GNUTLS_E_CERTIFICATE_VERIFICATION_ERROR;
#else  /* fallback for GnuTLS < 3.4.4 */
          return GNUTLS_E_CERTIFICATE_ERROR;
#endif
        }
    }
  else if (ret != GNUTLS_E_NO_CERTIFICATE_FOUND)
    {
      warnx ("Verifying TLS peer failed: %s", gnutls_strerror (ret));
      return ret;
    }

  return GNUTLS_E_SUCCESS;
}

static int
set_x509_key_from_combined_file (gnutls_certificate_credentials_t x509_cred,
                                 const char *filename)
{
  gnutls_datum_t cert, key;
  int r;

  r = cockpit_certificate_parse (filename, (char**) &cert.data, (char**) &key.data);
  if (r < 0)
    errx (1,  "Invalid server certificate+key file %s: %s", filename, strerror (-r));
  cert.size = strlen ((char*) cert.data);
  key.size = strlen ((char*) key.data);
  r = gnutls_certificate_set_x509_key_mem (parameters.x509_cred, &cert, &key, GNUTLS_X509_FMT_PEM);
  free (cert.data);
  free (key.data);

  return r;
}

/**
 * connection_crypto_init: Initialise TLS support
 *
 * This should be called after server_init() in order to enable TLS
 * support for connections. If this function is not called, the server
 * will only be able to handle http requests.
 *
 * @certfile: Server TLS certificate file; cannot be %NULL
 * @keyfile: Server TLS key file; if the key is merged into @certfile, set this
 *           to %NULL.
 * @request_mode: Whether to ask for client certificates
 */
void
connection_crypto_init (const char *certfile,
                        const char *keyfile,
                        gnutls_certificate_request_t request_mode)
{
  int ret;

  assert (certfile != NULL);
  assert (parameters.x509_cred == NULL);

  ret = gnutls_certificate_allocate_credentials (&parameters.x509_cred);
  if (ret != GNUTLS_E_SUCCESS)
    errx (1, "gnutls_certificate_allocate_credentials failed: %s", gnutls_strerror (ret));

  if (keyfile)
    ret = gnutls_certificate_set_x509_key_file (parameters.x509_cred, certfile, keyfile, GNUTLS_X509_FMT_PEM);
  else
    ret = set_x509_key_from_combined_file (parameters.x509_cred, certfile);

  if (ret != GNUTLS_E_SUCCESS)
    errx (1, "Failed to initialize server certificate: %s", gnutls_strerror (ret));

  gnutls_certificate_set_verify_function (parameters.x509_cred, verify_peer_certificate);

#if GNUTLS_VERSION_NUMBER >= 0x030506 && GNUTLS_VERSION_NUMBER <= 0x030600
  /* only available since GnuTLS 3.5.6, and deprecated in 3.6 */
  gnutls_certificate_set_known_dh_params (parameters.x509_cred, GNUTLS_SEC_PARAM_MEDIUM);
#endif

  parameters.request_mode = request_mode;
}

void
connection_set_wsinstance_sockdir (const char *wsinstance_sockdir)
{
  assert (parameters.wsinstance_sockdir == NULL);
  assert (wsinstance_sockdir != NULL);

  parameters.wsinstance_sockdir = wsinstance_sockdir;
}

void
connection_cleanup (void)
{
  assert (parameters.wsinstance_sockdir != NULL);

  parameters.wsinstance_sockdir = NULL;

  if (parameters.x509_cred)
    {
      gnutls_certificate_free_credentials (parameters.x509_cred);
      parameters.x509_cred = NULL;
    }

  while (https_instances)
    {
      HTTPSInstance *i = https_instances;
      https_instances = i->next;
      gnutls_free (i->peer_cert.data);
      free (i);
    }
}
