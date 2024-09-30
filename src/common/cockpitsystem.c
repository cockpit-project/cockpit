/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
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

#include "cockpitsystem.h"

#include <glib/gstdio.h>

#include <systemd/sd-login.h>

#include <sys/types.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

/* Used to override from tests */
const gchar *cockpit_system_proc_base = "/proc";

static const gchar *os_release_fields[] = {
  "NAME",
  "VERSION",
  "ID",
  "VERSION_ID",
  "PRETTY_NAME",
  "VARIANT",
  "VARIANT_ID",
  "CPE_NAME",
  "DOCUMENTATION_URL",
  NULL
};

const gchar **
cockpit_system_os_release_fields (void)
{
  return os_release_fields;
}

GHashTable *
cockpit_system_load_os_release (void)
{
  GError *error = NULL;
  GHashTable *result = NULL;
  gchar *contents = NULL;
  gsize len;
  gchar **lines = NULL;
  guint n;
  gchar *line, *val;

  g_file_get_contents ("/etc/os-release", &contents, &len, &error);

  if (g_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_NOENT))
    {
      g_clear_error (&error);
      g_file_get_contents ("/usr/lib/os-release", &contents, &len, &error);
    }

  if (error)
    {
      g_message ("error loading contents of os-release: %s", error->message);
      goto out;
    }

  result = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, NULL);

  lines = g_strsplit (contents, "\n", -1);
  for (n = 0; lines != NULL && lines[n] != NULL; n++)
    {
      line = lines[n];
      val = strchr (line, '=');

      if (val)
        {
          *val = '\0';
          val++;

          /* Remove quotes from value */
          len = strlen (val);
          if (len && val[0] == '\"' && val[len - 1] == '\"')
            {
              val[len - 1] = '\0';
              val++;
            }

          g_hash_table_replace (result, line, val);
        }
      else
        {
          g_free (line);
        }
    }

 out:
  g_clear_error (&error);
  g_free (lines);
  g_free (contents);

  return result;
}

char *
cockpit_system_session_id (void)
{
  char *session_id;
  pid_t pid;
  int res;

  pid = getppid ();
  res = sd_pid_get_session (pid, &session_id);
  if (res == 0)
    {
      return session_id;
    }
  else
    {
      if (res != -ENODATA && res != -ENXIO)
        g_message ("could not look up session id for bridge process: %u: %s", pid, g_strerror (-res));
      return NULL;
    }
}

void
cockpit_setenv_check (const char *variable,
                      const char *value,
                      gboolean overwrite)
{
  if (!g_setenv (variable, value, overwrite))
    g_error("could not set $%s to %s", variable, value);
}
