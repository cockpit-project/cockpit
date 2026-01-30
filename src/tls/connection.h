/*
 * Copyright (C) 2019 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
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
connection_crypto_init (int cert_dirfd,
                        bool allow_unencrypted,
                        gnutls_certificate_request_t request_mode);

void
connection_cleanup (void);

/* handle a new connection */
void
connection_thread_main (int fd);
