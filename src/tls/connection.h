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

#pragma once

#include <stdbool.h>

#include "wsinstance.h"

/* a single TCP connection between the client (browser) and cockpit-tls */
typedef struct Connection {
  int client_fd;
  bool is_tls;
  gnutls_session_t session;
  WsInstance *ws;
  int ws_fd;
  struct Connection *next;
} Connection;

Connection* connection_new (int client_fd);
void connection_set_tls_session (Connection *c, gnutls_session_t session);
void connection_free (Connection *c);
