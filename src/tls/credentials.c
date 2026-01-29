/*
 * Copyright (C) 2019 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#include "config.h"

#include "credentials.h"

#include <assert.h>
#include <err.h>
#include <stdlib.h>
#include <string.h>

#include <gnutls/x509.h>

#include "common/cockpitmemory.h"
#include "common/cockpitwebcertificate.h"

#include "utils.h"

struct _Credentials
{
  gnutls_certificate_credentials_t creds;
  int ref_count;
};

static Credentials *
credentials_new (gnutls_certificate_credentials_t creds)
{
  Credentials *self = mallocx (sizeof (Credentials));
  self->creds = creds;
  self->ref_count = 1;

  return self;
}

Credentials *
credentials_ref (Credentials *self)
{
  self->ref_count++;

  return self;
}

void
credentials_unref (Credentials *self)
{
  if (--self->ref_count == 0)
    {
      gnutls_certificate_free_credentials (self->creds);
      free (self);
    }
}

gnutls_certificate_credentials_t
credentials_get (Credentials *self)
{
  return self->creds;
}

Credentials *
credentials_load (const char *certificate_filename,
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

  return credentials_new (creds);
}
