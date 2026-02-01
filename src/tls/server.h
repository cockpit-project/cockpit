/*
 * Copyright (C) 2019 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#pragma once

#include <stdbool.h>
#include <stdint.h>

#include <gnutls/gnutls.h>

void
server_init (const char *wsinstance_sockdir,
             const char *cert_session_dir,
             int idle_timeout,
             uint16_t port);

void
server_run (void);

void
server_cleanup (void);

int
server_get_listener (void);

/* these are for unit tests only */
bool
server_poll_event (int timeout);

unsigned
server_num_connections (void);
