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

#include "connection.h"

#include <assert.h>
#include <err.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/socket.h>

#include "common/cockpitmemory.h"

#include "utils.h"

Connection *
connection_new (int client_fd)
{
  Connection *con;

  con = callocx (1, sizeof (Connection));
  con->client_fd = client_fd;
  con->buf_client.connection = con;
  con->buf_ws.connection = con;

  debug ("new connection on fd %i", con->client_fd);
  return con;
}

void
connection_set_tls_session (Connection *c, gnutls_session_t session)
{
  c->session = session;
  c->is_tls = true;
}

void
connection_free (Connection *c)
{
  debug ("freeing %s connection to client_fd %i ws_fd %i", c->is_tls ? "TLS" : "unencrypted", c->client_fd, c->ws_fd);

  /* do not wait for the peer to close the connection. */
  if (c->is_tls)
    gnutls_deinit (c->session);

  close (c->client_fd);
  if (c->ws_fd)
    close (c->ws_fd);

  free (c);
}

/**
 * connection_read; Read a data block from source
 *
 * Buffer must be empty for this.
 * Returns SUCCESS, CLOSED, FATAL, or RETRY.
 */
ConnectionResult
connection_read (Connection *c, DataSource source)
{
  int r;
  struct ConnectionBuffer *buf = source == CLIENT ? &c->buf_client : &c->buf_ws;
  int fd = source == CLIENT ? c->client_fd : c->ws_fd;

  assert (buf->length == 0);
  assert (buf->offset == 0);

  if (c->is_tls && source == CLIENT)
    {
      r = gnutls_record_recv (c->session, buf->data, sizeof (buf->data));
      if (r == 0)
        {
          debug ("client fd %i closed the TLS connection", fd);
          do
            {
              r = gnutls_bye (c->session, GNUTLS_SHUT_WR);
            } while (r == GNUTLS_E_AGAIN || r == GNUTLS_E_INTERRUPTED);
          return CLOSED;
        }
      if (r < 0)
        {
          if (r == GNUTLS_E_AGAIN || r == GNUTLS_E_INTERRUPTED)
            {
              debug ("reading from client fd %i TLS connection: %s; RETRY", fd, gnutls_strerror (r));
              return RETRY;
            }
          warnx ("reading from client fd %i TLS connection failed: %s", fd, gnutls_strerror (r));
          return FATAL;
        }
      debug ("read %i bytes from client fd %i TLS connection", r, fd);
    }
  else
    {
      r = recv (fd, buf->data, sizeof (buf->data), MSG_DONTWAIT);
      if (r == 0)
      {
        debug ("fd %i has closed the connection", fd);
        return CLOSED;
      }
      if (r < 0)
        {
          if (errno == EAGAIN || errno == EINTR)
            {
              debug ("reading from fd %i: %m; RETRY", fd);
              return RETRY;
            }
          warn ("reading from fd %i failed", fd);
          return FATAL;
        }
      debug ("read %i bytes from fd %i", r, fd);
    }

  buf->length = r;
  return SUCCESS;
}

/**
 * connection_write: Write a previously read data block from source to the
 * other peer
 *
 * Buffer must be non-empty for this. This may do a partial write, in which
 * case multiple calls are necessary.
 * Returns SUCCESS, PARTIAL, FATAL, or RETRY.
 */
ConnectionResult
connection_write (Connection *c, DataSource source)
{
  int r;
  ssize_t size;
  struct ConnectionBuffer *buf = source == CLIENT ? &c->buf_client : &c->buf_ws;
  /* write the buffer to the *other* peer */
  int fd = source == CLIENT ? c->ws_fd : c->client_fd;

  assert (buf->length > 0);
  assert (buf->offset < buf->length);
  size = buf->length - buf->offset;

  if (c->is_tls && source == WS)
    {
      r = gnutls_record_send (c->session, buf->data + buf->offset, size);
      if (r == 0) /* Should Not Happen™, as data_size > 0 */
        return FATAL;
      if (r < 0)
        {
          if (r == GNUTLS_E_AGAIN || r == GNUTLS_E_INTERRUPTED)
            {
              debug ("writing to client fd %i TLS connection: %s; RETRY", fd, gnutls_strerror (r));
              return RETRY;
            }
          warnx ("writing to client fd %i TLS connection failed: %s", fd, gnutls_strerror (r));
          return FATAL;
        }

      debug ("wrote %i bytes out of %zi to TLS connection client fd %i", r, size, fd);
    }
  else
  {
    r = send (fd, buf->data + buf->offset, size, 0);
    if (r == 0) /* Should Not Happen™, as data_size > 0 */
      return FATAL;
    if (r < 0)
      {
        if (errno == EAGAIN || errno == EINTR)
          {
            debug ("writing to fd %i: %m; RETRY", fd);
            return RETRY;
          }
        warn ("writing to fd %i failed", fd);
        return FATAL;
      }
    debug ("wrote %i bytes out of %zi to fd %i", r, size, fd);
  }

  assert (r <= size);
  buf->offset += r;
  if (buf->offset < buf->length)
    return PARTIAL;

  /* all written, reset indexes */
  buf->offset = buf->length = 0;
  return SUCCESS;
}
