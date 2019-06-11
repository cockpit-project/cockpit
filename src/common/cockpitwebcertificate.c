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
#define PEM_PKCS8_PRIVKEY_HEADER   "-----BEGIN PRIVATE KEY-----"
#define PEM_PKCS8_PRIVKEY_FOOTER   "-----END PRIVATE KEY-----"

static int
filter_cert (const struct dirent *entry)
{
  /* check if entry ends with .cert */
  const char *suffix = ".cert";
  int diff = strlen (entry->d_name) - strlen (suffix);
  return diff > 0 && strcmp (entry->d_name + diff, suffix) == 0;
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
  free (certs);
  return ret;
}

char *
cockpit_certificate_locate (char **error)
{
  const char * const *dirs = cockpit_conf_get_dirs ();

  *error = NULL;

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

  asprintfx (error, "No certificate found in dir: %s/cockpit/ws-certs.d", dirs[0]);
  return NULL;
}

/** cockpit_certificate_parse:
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
      start = strstr (data, PEM_PKCS8_PRIVKEY_HEADER);
      if (start)
        footer = PEM_PKCS8_PRIVKEY_FOOTER;
      else
        {
          ret = -ENOKEY;
          goto out;
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
