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

static int
set_x509_key_from_combined_file (gnutls_certificate_credentials_t x509_cred,
                                 const char *filename)
{
  gnutls_datum_t cert, key;
  int r;

  r = cockpit_certificate_parse (filename, (char**) &cert.data, (char**) &key.data);
  if (r < 0)
    errx (EXIT_FAILURE,  "Invalid server certificate+key file %s: %s", filename, strerror (-r
));
  cert.size = strlen ((char*) cert.data);
  key.size = strlen ((char*) key.data);
  r = gnutls_certificate_set_x509_key_mem (x509_cred, &cert, &key, GNUTLS_X509_FMT_PEM);
  free (cert.data);
  free (key.data);

  return r;
}

Certificate *
certificate_load (const char *filename)
{
  gnutls_certificate_credentials_t creds;
  int ret;

  debug (SERVER, "Using certificate %s", filename);

  char *keyfile;

  /* check if we have a separate key file */
  keyfile = cockpit_certificate_key_path (filename);
  assert (keyfile);

  ret = gnutls_certificate_allocate_credentials (&creds);
  assert (ret == GNUTLS_E_SUCCESS);

  ret = gnutls_certificate_set_x509_key_file (creds, filename, keyfile, GNUTLS_X509_FMT_PEM);

  /* if not, fall back to combined file */
  if (ret == GNUTLS_E_FILE_ERROR)
    {
      debug (CONNECTION, "connection_crypto_init: %s does not exist, falling back to combined cert+key", keyfile);
      ret = set_x509_key_from_combined_file (creds, filename);
    }

  if (ret != GNUTLS_E_SUCCESS)
    errx (EXIT_FAILURE, "Failed to initialize server certificate: %s", gnutls_strerror (ret));

  free (keyfile);

  return certificate_new (creds);
}
