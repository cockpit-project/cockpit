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

#include <dirent.h>
#include <errno.h>
#include <err.h>
#include <stdlib.h>
#include <string.h>

#include "common/cockpitconf.h"
#include "common/cockpitmemory.h"
#include "common/cockpitwebcertificate.h"

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
