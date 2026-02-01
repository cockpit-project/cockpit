/*
 * Copyright (C) 2019 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#include "config.h"

#include "certificate.h"

#include <assert.h>
#include <err.h>
#include <stdlib.h>
#include <string.h>

#include <gnutls/x509.h>

#include "common/cockpitmemory.h"
#include "common/cockpitwebcertificate.h"

#include "utils.h"

struct _Certificate
{
  gnutls_certificate_credentials_t creds;
  int ref_count;
};

static Certificate *
certificate_new (gnutls_certificate_credentials_t creds)
{
  Certificate *self = mallocx (sizeof (Certificate));
  self->creds = creds;
  self->ref_count = 1;

  return self;
}

Certificate *
certificate_ref (Certificate *self)
{
  self->ref_count++;

  return self;
}

void
certificate_unref (Certificate *self)
{
  if (--self->ref_count == 0)
    {
      gnutls_certificate_free_credentials (self->creds);
      free (self);
    }
}

gnutls_certificate_credentials_t
certificate_get_credentials (Certificate *self)
{
  return self->creds;
}

Certificate *
certificate_load (const char *certificate_filename,
                  const char *key_filename)
{
  gnutls_certificate_credentials_t creds;
  int ret;

  debug (SERVER, "Using certificate %s", certificate_filename);

  ret = gnutls_certificate_allocate_credentials (&creds);
  assert (ret == GNUTLS_E_SUCCESS);

  ret = gnutls_certificate_set_x509_key_file (creds,
                                              certificate_filename, key_filename,
                                              GNUTLS_X509_FMT_PEM);

  if (ret != GNUTLS_E_SUCCESS)
    errx (EXIT_FAILURE, "Failed to initialize server certificate: %s", gnutls_strerror (ret));

  return certificate_new (creds);
}
