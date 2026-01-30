/*
 * Copyright (C) 2019 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#include "config.h"

#include "credentials.h"

#include <assert.h>
#include <err.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

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

/* Load a file into a gnutls_datum_t.
 *
 * Returns true on success, false if the file doesn't exist.
 * Exits on any other failure.
 * On success, data->data must be freed with gnutls_free().
 */
static bool
load_file (int dirfd, const char *filename, gnutls_datum_t *data)
{
  int fd = openat (dirfd, filename, O_RDONLY | O_CLOEXEC | O_NOCTTY);
  if (fd < 0)
    {
      if (errno == ENOENT)
        return false;
      err (EXIT_FAILURE, "Failed to open '%s'", filename);
    }

  struct stat st;
  if (fstat (fd, &st) < 0)
    err (EXIT_FAILURE, "Failed to stat '%s'", filename);

  if (!S_ISREG (st.st_mode))
    errx (EXIT_FAILURE, "'%s' is not a regular file", filename);

  if (st.st_size <= 0)
    errx (EXIT_FAILURE, "'%s' is empty", filename);

  if (st.st_size > 640 * 1024)  /* ought to be enough for anybody! */
    errx (EXIT_FAILURE, "'%s' is too large", filename);

  size_t file_size = (size_t) st.st_size;

  unsigned char *buffer = mallocx (file_size + 1);
  if (buffer == NULL)
    errx (EXIT_FAILURE, "Failed to allocate memory for '%s'", filename);

  ssize_t n;
  do
    n = read (fd, buffer, file_size);
  while (n < 0 && errno == EINTR);

  if (n < 0)
    err (EXIT_FAILURE, "Failed to read '%s'", filename);

  if (n != (ssize_t) file_size)
    errx (EXIT_FAILURE, "Failed to read '%s': expected %zu bytes, got %zd", filename, file_size, n);

  close (fd);

  buffer[file_size] = '\0';

  data->data = buffer;
  data->size = (unsigned int) file_size;  /* <= 640k */

  return true;
}

Credentials *
credentials_load_directory (int dirfd)
{
  gnutls_certificate_credentials_t creds;
  int ret;

  ret = gnutls_certificate_allocate_credentials (&creds);
  assert (ret == GNUTLS_E_SUCCESS);

  Credentials *self = credentials_new(creds);

  /* Load files sequentially 0.{crt,key}, 1.{crt,key}, 2.{crt,key}, etc... */
  int i;
  for (i = 0; ; i++)
    {
      char crt_name[32];
      snprintf (crt_name, sizeof crt_name, "%d.crt", i);

      gnutls_datum_t crt_data;
      if (!load_file (dirfd, crt_name, &crt_data))
        break;

      debug (SERVER, "Adding certificate %s", cert_name);

      char key_name[32];
      snprintf (key_name, sizeof key_name, "%d.key", i);

      gnutls_datum_t key_data;
      if (!load_file (dirfd, key_name, &key_data))
        errx (EXIT_FAILURE, "Certificate '%s' exists but key '%s' is missing",
              crt_name, key_name);

      int ret = gnutls_certificate_set_x509_key_mem2 (self->creds,
                                                      &crt_data, &key_data,
                                                      GNUTLS_X509_FMT_PEM,
                                                      NULL, 0);
      if (ret < 0)
        errx (EXIT_FAILURE, "Failed to load keypair %s/%s: %s",
              crt_name, key_name, gnutls_strerror (ret));

      gnutls_memset (key_data.data, 0, key_data.size);
      free (key_data.data);
      free (crt_data.data);
    }

  if (i == 0)
    errx (EXIT_FAILURE, "No certificates found in directory");

  debug (SERVER, "Loaded %d certificate(s)", i);
  return self;
}
