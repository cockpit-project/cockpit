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

#include <err.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

#include "common/cockpitmemory.h"

#include "utils.h"

Connection *
connection_new (int client_fd)
{
  Connection *con;

  con = callocx (1, sizeof (Connection));
  con->client_fd = client_fd;

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
