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
#include <stdint.h>


enum ClientCertMode { CERT_NONE, CERT_REQUEST };

//struct Server;
//typedef struct Server Server;

void server_init (const char *ws_path,
                  uint16_t port,
                  const char *certfile,
                  const char* keyfile,
                  enum ClientCertMode);
void server_cleanup (void);
bool server_poll_event (int timeout);
void server_run (int idle_timeout);
void server_remove_ws (pid_t ws_pid);

/* these are for unit tests only */
unsigned server_num_connections (void);
unsigned server_num_ws (void);
size_t server_get_ws_pids (pid_t* pids, size_t pids_length);
