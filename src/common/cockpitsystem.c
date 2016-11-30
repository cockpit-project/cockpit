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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

#include "cockpitsystem.h"

#include <glib/gstdio.h>

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

GBytes *
cockpit_system_random_nonce (gsize length)
{
  GByteArray *key;
  gint fd;
  gint read_bytes;
  gint read_result;

  fd = g_open ("/dev/urandom", O_RDONLY, 0);
  if (fd < 0)
    return NULL;

  key = g_byte_array_new ();
  g_byte_array_set_size (key, length);
  read_bytes = 0;
  do
    {
      errno = 0;
      read_result = read (fd, key->data + read_bytes, key->len - read_bytes);
      if (read_result <= 0)
        {
          if (errno == EAGAIN || errno == EINTR)
              continue;
          break;
        }
      read_bytes += read_result;
    }
  while (read_bytes < key->len);
  close (fd);

  if (read_bytes < length)
    {
      g_byte_array_free (key, TRUE);
      return NULL;
    }
  else
    {
      return g_byte_array_free_to_bytes (key);
    }
}

guint64
cockpit_system_process_start_time (void)
{
  GError *error = NULL;
  gchar *filename = NULL;
  gchar *contents = NULL;
  gchar **tokens = NULL;
  gchar *endp = NULL;
  size_t length;
  guint num_tokens;
  gchar *p;

  guint64 start_time = 0;

  filename = g_strdup_printf ("%s/%d/stat", cockpit_system_proc_base, getpid ());
  if (!g_file_get_contents (filename, &contents, &length, &error))
    {
      g_warning ("couldn't read start time: %s", error->message);
      goto out;
    }

  /*
   * Start time is the token at index 19 after the '(process name)' entry - since only this
   * field can contain the ')' character, search backwards for this
   */
  p = strrchr (contents, ')');
  if (p == NULL)
    {
      g_warning ("error parsing stat command: %s", filename);
      goto out;
    }
  p += 2; /* skip ') ' */
  if (p - contents >= (int) length)
    {
      g_warning ("error parsing stat command: %s", filename);
      goto out;
    }

  tokens = g_strsplit (p, " ", 0);
  num_tokens = g_strv_length (tokens);
  if (num_tokens < 20)
    {
      g_warning ("error parsing stat tokens: %s", filename);
      goto out;
    }

  start_time = g_ascii_strtoull (tokens[19], &endp, 10);
  if (!endp || endp == tokens[19] || *endp)
    {
      start_time = 0;
      g_warning ("error parsing start time: %s'", filename);
      goto out;
    }

out:
  if (error)
    g_error_free (error);
  g_strfreev (tokens);
  g_free (filename);
  g_free (contents);

  return start_time;
}
