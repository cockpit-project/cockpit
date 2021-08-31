/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013 Red Hat, Inc.
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

#include "cockpitcertificate.h"

#include "common/cockpitwebcertificate.h"

gchar *
cockpit_certificate_locate_gerror (GError **error)
{
  gchar *error_str = NULL;
  gchar *path = cockpit_certificate_locate (false, &error_str);
  if (error_str)
    {
      g_set_error_literal (error, G_IO_ERROR, G_IO_ERROR_NOT_FOUND, error_str);
      g_free (error_str);
    }
  return path;
}

gchar *
cockpit_certificate_locate_selfsign_ca ()
{
  g_autofree gchar *cert_path = NULL;
  g_autofree gchar *base = NULL;
  gchar *ca_path = NULL;

  cert_path = cockpit_certificate_locate_gerror (NULL);
  if (cert_path)
    {
      base = g_path_get_basename (cert_path);
      if (g_strcmp0 (base, "0-self-signed.cert") == 0)
        {
          g_autofree gchar *dir = g_path_get_dirname (cert_path);
          ca_path = g_build_filename (dir, "0-self-signed-ca.pem", NULL);
          if (!g_file_test (ca_path, G_FILE_TEST_EXISTS))
            {
              g_free (ca_path);
              ca_path = NULL;
            }
        }
    }

  return ca_path;
}

static gint
tls_certificate_count (GTlsCertificate *cert)
{
  gint count = 0;

  while (cert != NULL)
    {
      cert = g_tls_certificate_get_issuer (cert);
      count++;
    }

  return count;
}

GTlsCertificate *
cockpit_certificate_load (const gchar *cert_path,
                          GError **error)
{
  int r;
  g_autofree gchar *key_path = cockpit_certificate_key_path (cert_path);
  GTlsCertificate *cert;
  GError *key_error = NULL;

  /* check if we have a separate .key file */
  cert = g_tls_certificate_new_from_files (cert_path, key_path, &key_error);
  if (cert)
    {
      g_debug ("loaded separate cert %s and key %s", cert_path, key_path);
    }
  else if (g_error_matches (key_error, G_FILE_ERROR, G_FILE_ERROR_NOENT))
    {
      /* combined cert+key file */
      g_autofree gchar *certs = NULL;
      g_autofree gchar *key = NULL;
      g_autofree gchar *combined = NULL;

      g_debug ("%s does not exist, falling back to combined certificate", key_path);
      g_clear_error (&key_error);

      r = cockpit_certificate_parse (cert_path, &certs, &key);
      if (r < 0)
        {
          g_set_error (error, G_IO_ERROR, g_io_error_from_errno (-r), "Failed to load %s: %s", cert_path, g_strerror (-r));
          return NULL;
        }

      /* Gio only has constructors for parsing certs and key from one string, so combine them */
      combined = g_strconcat (certs, key, NULL);
      cert = g_tls_certificate_new_from_pem (combined, -1, error);
    }
  else
    {
      g_propagate_error (error, key_error);
    }

  if (cert == NULL)
    g_prefix_error (error, "%s: ", cert_path);
  else
    g_debug ("loaded %d certificates from %s", tls_certificate_count (cert), cert_path);
  return cert;
}
