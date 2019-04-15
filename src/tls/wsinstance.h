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
#include <sys/un.h>

#include <gnutls/gnutls.h>

enum WsInstanceMode { WS_INSTANCE_HTTP, WS_INSTANCE_HTTP_REDIRECT, WS_INSTANCE_HTTPS };

/* a single cockpit-ws child process */
typedef struct WsInstance {
  gnutls_datum_t peer_cert;      /* DER format */
  gnutls_datum_t peer_cert_info; /* human readable string */
  struct sockaddr_un socket;
  pid_t pid;
  struct WsInstance *next;
} WsInstance;

WsInstance* ws_instance_new (const char *ws_path,
                             enum WsInstanceMode mode,
                             const gnutls_datum_t *client_cert_der,
                             const char *state_dir);
void ws_instance_free (WsInstance *ws);
bool ws_instance_has_peer_cert (WsInstance *ws, const gnutls_datum_t *der);
