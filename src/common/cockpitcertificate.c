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
#include "cockpitlog.h"
#include "cockpitmemory.h"

#include <glib/gstdio.h>

#include <errno.h>

static gchar *
generate_subject (void)
{
  static const char HEX[] = "0123456789abcdef";
  gchar *content;
  gchar *subject;

  /*
   * HACK: We have to use a unique value in DN because otherwise
   * firefox hangs.
   *
   * https://bugzilla.redhat.com/show_bug.cgi?id=1204670
   *
   * In addition we have to generate the certificate with CA:TRUE
   * because old versions of NSS refuse to process self-signed
   * certificates if that's not the case.
   *
   */

  if (g_file_get_contents ("/etc/machine-id", &content, NULL, NULL))
    {
      subject = g_strdup_printf ("/O=%s/CN=localhost",
                                 g_strstrip (g_strcanon (content, HEX, ' ')));
      g_free (content);
    }
  else
    {
      subject = g_strdup ("/CN=localhost");
    }

  return subject;
}

static gboolean
openssl_make_dummy_cert (const gchar *key_file,
                         const gchar *out_file,
                         GError **error)
{
  gboolean ret = FALSE;
  gint exit_status;
  gchar *stderr_str = NULL;
  gchar *command_line = NULL;
  gchar *subject = generate_subject ();

  const gchar *argv[] = {
    "openssl",
    "req", "-x509",
    "-days", "36500",
    "-newkey", "rsa:2048",
    "-keyout", key_file,
    "-keyform", "PEM",
    "-nodes",
    "-out", out_file,
    "-outform", "PEM",
    "-subj", subject,
    NULL
  };

  command_line = g_strjoinv (" ", (gchar **)argv);
  g_info ("Generating temporary certificate using: %s", command_line);

  if (!g_spawn_sync (NULL, (gchar **)argv, NULL, G_SPAWN_SEARCH_PATH, NULL, NULL,
                     NULL, &stderr_str, &exit_status, error) ||
      !g_spawn_check_exit_status (exit_status, error))
    {
      g_warning ("%s", stderr_str);
      g_prefix_error (error, "Error generating temporary self-signed dummy cert using openssl: ");
      goto out;
    }

  ret = TRUE;

out:
  g_free (stderr_str);
  g_free (command_line);
  g_free (subject);
  return ret;
}

static gchar *
create_temp_file (const gchar *directory,
                  const gchar *templ,
                  GError **error)
{
  gchar *path;
  gint fd;

  path = g_build_filename (directory, templ, NULL);
  fd = g_mkstemp (path);
  if (fd < 0)
    {
      g_set_error (error, G_FILE_ERROR,
                   g_file_error_from_errno (errno),
                   "Couldn't create temporary file: %s: %m", path);
      g_free (path);
      return NULL;
    }

  close (fd);
  return path;
}

static gchar *
generate_temp_cert (GError **error)
{
  const gchar *dir = PACKAGE_SYSCONF_DIR "/cockpit/ws-certs.d";
  gchar *cert_path = NULL;
  gchar *tmp_key = NULL;
  gchar *tmp_pem = NULL;
  gchar *cert_data = NULL;
  gchar *pem_data = NULL;
  gchar *key_data = NULL;
  gchar *ret = NULL;

  cert_path = g_strdup_printf ("%s/~self-signed.cert", dir);

  /* Generate self-signed cert, if it does not exist */
  if (g_file_test (cert_path, G_FILE_TEST_EXISTS))
    {
      ret = cert_path;
      cert_path = NULL;
      goto out;
    }

  if (g_mkdir_with_parents (dir, 0700) != 0)
    {
      g_set_error (error,
                   G_IO_ERROR,
                   G_IO_ERROR_FAILED,
                   "Error creating directory `%s': %m",
                   dir);
      goto out;
    }

  tmp_key = create_temp_file (dir, "~self-signed.XXXXXX.tmp", error);
  if (!tmp_key)
    goto out;
  tmp_pem = create_temp_file (dir, "~self-signed.XXXXXX.tmp", error);
  if (!tmp_pem)
    goto out;
  if (!openssl_make_dummy_cert (tmp_key, tmp_pem, error))
    goto out;
  if (!g_file_get_contents (tmp_key, &key_data, NULL, error))
    goto out;
  if (!g_file_get_contents (tmp_pem, &pem_data, NULL, error))
    goto out;

  cert_data = g_strdup_printf ("%s\n%s\n", pem_data, key_data);
  if (!g_file_set_contents (cert_path, cert_data, -1, error))
    goto out;

  ret = cert_path;
  cert_path = NULL;

out:
  g_free (cert_path);
  cockpit_secclear (key_data, -1);
  g_free (key_data);
  g_free (pem_data);
  cockpit_secclear (cert_data, -1);
  g_free (cert_data);
  if (tmp_key)
    g_unlink (tmp_key);
  if (tmp_pem)
    g_unlink (tmp_pem);
  g_free (tmp_key);
  g_free (tmp_pem);
  return ret;
}

static gint
ptr_strcmp (const gchar **a,
            const gchar **b)
{
  return g_strcmp0 (*a, *b);
}

static gchar *
load_cert_from_dir (const gchar *dir_name,
                    GError **error)
{
  gchar *ret = NULL;
  GDir *dir;
  const gchar *name;
  GPtrArray *p;

  p = g_ptr_array_new ();

  dir = g_dir_open (dir_name, 0, error);
  if (dir == NULL)
    goto out;

  while ((name = g_dir_read_name (dir)) != NULL)
    {
      if (!g_str_has_suffix (name, ".cert"))
        continue;
      g_ptr_array_add (p, g_strdup_printf ("%s/%s", dir_name, name));
    }

  g_ptr_array_sort (p, (GCompareFunc)ptr_strcmp);

  if (p->len > 0)
    {
      ret = p->pdata[p->len - 1];
      p->pdata[p->len - 1] = NULL;
    }

out:
  if (dir != NULL)
    g_dir_close (dir);
  g_ptr_array_foreach (p, (GFunc)g_free, NULL);
  g_ptr_array_free (p, TRUE);
  return ret;
}

gchar *
cockpit_certificate_locate (gboolean create_if_necessary,
                            GError **error)
{
  gchar *cert_path = NULL;
  const gchar *cert_dir = PACKAGE_SYSCONF_DIR "/cockpit/ws-certs.d";
  GError *local_error;

  local_error = NULL;
  cert_path = load_cert_from_dir (cert_dir, &local_error);
  if (local_error != NULL)
    {
      g_propagate_prefixed_error (error, local_error,
                                  "Error loading certificates from %s: ",
                                  cert_dir);
      return NULL;
    }

  /* Could be there's no certicate at all, so cert_path can indeed be
   * NULL. If so, use (and possibly generate) a temporary self-signed
   * certificate
   */
  if (cert_path == NULL)
    {
      if (create_if_necessary)
        {
          cert_path = generate_temp_cert (error);
        }
      else
        {
          g_set_error (error, G_IO_ERROR, G_IO_ERROR_NOT_FOUND,
                       "No certificate found in dir: %s", cert_dir);
        }
    }

  return cert_path;
}

GTlsCertificate *
cockpit_certificate_load (const gchar *cert_path,
                          GError **error)
{
  GTlsCertificate *cert;

  cert = g_tls_certificate_new_from_file (cert_path, error);
  if (cert == NULL)
    g_prefix_error (error, "%s: ", cert_path);
  return cert;
}
