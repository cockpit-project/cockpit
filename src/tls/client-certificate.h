/*
 * Copyright (C) 2021 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#pragma once

#include <gnutls/gnutls.h>
#include <stdbool.h>

int
client_certificate_verify (gnutls_session_t session);

bool
client_certificate_accept (gnutls_session_t   session,
                           int                dirfd,
                           char             **out_wsinstance,
                           char             **out_filename);

void
client_certificate_unlink_and_free (int   dirfd,
                                    char *filename);
