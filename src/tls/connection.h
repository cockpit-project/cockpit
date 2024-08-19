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

#pragma once

#include <stdbool.h>
#include <stdint.h>

#include <gnutls/gnutls.h>

/* init/teardown */
void
connection_set_directories (const char *wsinstance_sockdir,
                            const char *runtime_directory);

void
connection_crypto_init (const char *certificate_filename,
                        const char *key_filename,
                        bool allow_unencrypted,
                        gnutls_certificate_request_t request_mode);

void
connection_cleanup (void);

/* handle a new connection */
void
connection_thread_main (int fd);
