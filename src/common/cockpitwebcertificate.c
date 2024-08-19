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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
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
 * @error must be a pointer to a `char *` originally containing %NULL.
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

  assert (error != NULL);
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

  if (!missing_ok)
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
