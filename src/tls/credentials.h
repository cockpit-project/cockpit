/*
 * Copyright (C) 2021 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#pragma once

#include <gnutls/gnutls.h>

typedef struct _Credentials Credentials;

Credentials *
credentials_ref (Credentials *self);

void
credentials_unref (Credentials *self);

gnutls_certificate_credentials_t
credentials_get (Credentials *self);

Credentials *
credentials_load (const char *certificate_filename,
                  const char *key_filename);
