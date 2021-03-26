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

#include "config.h"

#include <assert.h>
#include <dirent.h>
#include <errno.h>
#include <err.h>
#include <fcntl.h>
#include <limits.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#include "common/cockpitconf.h"
#include "common/cockpitmemory.h"
#include "common/cockpitwebcertificate.h"

#define PEM_PKCS1_PRIVKEY_HEADER   "-----BEGIN RSA PRIVATE KEY-----"
#define PEM_PKCS1_PRIVKEY_FOOTER   "-----END RSA PRIVATE KEY-----"
/* this is slightly asymmetrical -- paraemters and private key occur in the same file */
#define PEM_PKCS1_ECCKEY_HEADER   "-----BEGIN EC PARAMETERS-----"
#define PEM_PKCS1_ECCKEY_FOOTER   "-----END EC PRIVATE KEY-----"
#define PEM_PKCS8_PRIVKEY_HEADER   "-----BEGIN PRIVATE KEY-----"
#define PEM_PKCS8_PRIVKEY_FOOTER   "-----END PRIVATE KEY-----"

static int
filter_cert (const struct dirent *entry)
{
  int len = strlen (entry->d_name);

  /* check if entry ends with .crt or .cert */
  return (len > 4 && strcmp (entry->d_name + len - 4, ".crt") == 0) ||
         (len > 5 && strcmp (entry->d_name + len - 5, ".cert") == 0);
}

static char *
load_cert_from_dir (const char *dir_name,
                    char **error)
{
  struct dirent **certs;
  int n;
  char *ret = NULL;

  n = scandir (dir_name, &certs, filter_cert, alphasort);
  if (n < 0)
    {
      if (errno != ENOENT)
        asprintfx (error, "Error loading certificates from %s: %m", dir_name);
      return NULL;
    }

  if (n > 0)
    asprintfx (&ret, "%s/%s", dir_name, certs[n-1]->d_name);
  while (n--)
    free (certs[n]);
  free (certs);
  return ret;
}

/**
 * cockpit_certificate_locate:
 * @missing_ok: if "no certificate" is a valid result
 * @error: a pointer to a place to store an error string
 *
 * Find Cockpit web server certificate in $XDG_CONFIG_DIRS/cockpit/ws-certs.d/.
 * The asciibetically latest *.crt or *.cert file wins.
 *
 * Return certificate path on success, or %NULL if none is found or
 * another error occurs (such as a permissions problem, etc).
 *
 * @error must be a pointer to a `char *` originally containining %NULL.
 * It will be set to the error message in case of errors, and %NULL will
 * be returned.  If the error is "no certificate was found" and
 * @missing_ok is %TRUE then %NULL will be returned, but @error will be
 * left unset.
 */
char *
cockpit_certificate_locate (bool missing_ok,
                            char **error)
{
  const char * const *dirs = cockpit_conf_get_dirs ();

  assert (*error == NULL);

  for (int i = 0; dirs[i]; i++)
    {
      char *cert_dir;
      char *cert_path;

      asprintfx (&cert_dir, "%s/cockpit/ws-certs.d", dirs[i]);
      cert_path = load_cert_from_dir (cert_dir, error);
      free (cert_dir);

      if (*error != NULL)
        return NULL;

      if (cert_path)
        return cert_path;
    }

  if (error && !missing_ok)
    asprintfx (error, "No certificate found in dir: %s/cockpit/ws-certs.d", dirs[0]);

  return NULL;
}

/**
 * cockpit_certificate_key_path:
 *
 * Return key file path for given certfile, i. e. replace ".crt" or ".cert"
 * suffix with ".key". Invalid names exit the program. All usages of this
 * function in our code control the file name, so that should not happen.
 */
char *
cockpit_certificate_key_path (const char *certfile)
{
  int len = strlen (certfile);
  char *keypath = NULL;

  /* .cert suffix case: chop off suffix, append ".key" */
  if (len > 5 && strcmp (certfile + len - 5, ".cert") == 0)
    asprintfx (&keypath, "%.*s.key", len - 5, certfile);
  /* *.crt suffix case */
  else if (len > 4 && strcmp (certfile + len - 4, ".crt") == 0)
    asprintfx (&keypath, "%.*s.key", len - 4, certfile);
  else
    errx (EXIT_FAILURE, "internal error: invalid certificate file name: %s", certfile);

  return keypath;
}

/**
 * cockpit_certificate_parse:
 *
 * Load the ws certificate file, and split it into the private key and
 * certificates PEM strings.
 *
 * Return 0 on success, or -errno on failure. This can be an error from open()
 * or read(), or ENOKEY if private key is missing.
 */
int
cockpit_certificate_parse (const char *file, char **cert, char **key)
{
  int fd = -1;
  char *data = NULL;
  ssize_t r;
  int ret = 0;
  const char *start, *end, *footer;
  struct stat buf;

  /* load the entire file */
  fd = open (file, O_RDONLY);
  if (fd < 0)
    return -errno;

  if (fstat (fd, &buf) < 0)
    {
      ret = -errno;
      goto out;
    }

  if (!S_ISREG (buf.st_mode))
    {
      ret = -EBADF;
      goto out;
    }

  if (buf.st_size >= SSIZE_MAX)
    {
      ret = -ENOMEM;
      goto out;
    }

  data = mallocx (buf.st_size + 1);

  do
    {
      r = read (fd, data, buf.st_size);
    }
  while (r < 0 && errno == EINTR);

  if (r < 0)
    {
      ret = -errno;
      goto out;
    }

  close (fd);
  fd = -1;

  assert (r <= buf.st_size);
  data[r] = '\0';

  *cert = NULL;
  *key = NULL;

  /* find the private key; we ignore/reject encrypted private keys */
  start = strstr (data, PEM_PKCS1_PRIVKEY_HEADER);
  if (start)
    footer = PEM_PKCS1_PRIVKEY_FOOTER;
  else
    {
      start = strstr (data, PEM_PKCS1_ECCKEY_HEADER);
      if (start)
        footer = PEM_PKCS1_ECCKEY_FOOTER;
      else
        {
          start = strstr (data, PEM_PKCS8_PRIVKEY_HEADER);
          if (start)
            footer = PEM_PKCS8_PRIVKEY_FOOTER;
          else
            {
              ret = -ENOKEY;
              goto out;
            }
        }
    }

  end = strstr (start, footer);
  if (!end)
    {
      ret = -ENOKEY;
      goto out;
    }
  end += strlen (footer);
  while (*end == '\r' || *end == '\n')
    end++;

  /* cut out the private key */
  *key = strndupx (start, end - start);

  /* everything else before and after is the public key */
  asprintfx(cert, "%.*s%s", (int) (start - data), data, end);

out:
  if (fd >= 0)
    close (fd);
  free (data);
  return ret;
}
