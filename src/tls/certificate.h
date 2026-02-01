/*
 * Copyright (C) 2021 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#pragma once

#include <gnutls/gnutls.h>

typedef struct _Certificate Certificate;

Certificate *
certificate_ref (Certificate *self);

void
certificate_unref (Certificate *self);

gnutls_certificate_credentials_t
certificate_get_credentials (Certificate *self);

Certificate *
certificate_load (const char *certificate_filename,
                  const char *key_filename);
