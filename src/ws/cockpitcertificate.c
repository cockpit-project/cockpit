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

#include "common/cockpitconf.h"
#include "common/cockpitlog.h"
#include "common/cockpitmemory.h"
#include "common/cockpitwebcertificate.h"

#include <glib/gstdio.h>
#include <glib/gi18n.h>

#include <errno.h>
#include <string.h>

static gchar *
get_common_name (void)
{
  int ret;
  gchar *hostname = NULL;
  gchar *cn = NULL;

  hostname = g_malloc (HOST_NAME_MAX + 1);
  if (!hostname)
    return NULL;

  ret = gethostname (hostname, HOST_NAME_MAX);
  if (ret < 0 || g_str_equal (hostname, ""))
    cn = g_strdup ("localhost");
  else
    cn = g_strdup (hostname);

  g_free (hostname);
  return cn;
}

static gchar *
get_machine_id (void)
{
  static const char HEX[] = "0123456789abcdef";
  gchar *content;
  gchar *machine_id = NULL;

  if (g_file_get_contents ("/etc/machine-id", &content, NULL, NULL))
    machine_id = g_strstrip (g_strcanon (content, HEX, ' '));

  return machine_id;
}

static gchar *
generate_subject (void)
{
  gchar *cn;
  gchar *machine_id;
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

  cn = get_common_name ();

  machine_id = get_machine_id ();
  if (machine_id && !g_str_equal (machine_id, ""))
    {
      subject = g_strdup_printf ("/O=%s/CN=%s",
                                 machine_id, cn);
    }
  else
    {
      subject = g_strdup_printf ("/CN=%s", cn);
    }

  g_free (cn);
  g_free (machine_id);
  return subject;
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

static gboolean
openssl_make_dummy_cert (const gchar *key_file,
                         const gchar *out_file,
                         GError **error)
{
  gboolean ret = FALSE;
  gint exit_status;
  gchar *stderr_str = NULL;
  gchar *command_line = NULL;
  gchar *ssl_config = NULL;
  gchar *subject = generate_subject ();

  /* make config file with subjectAltName for localhost and our tests */
  ssl_config = create_temp_file (g_get_tmp_dir (), "ssl.conf.XXXXXX", error);
  if (!ssl_config)
      return FALSE;
  if (!g_file_set_contents (ssl_config,
              "[ req ]\n"
              "req_extensions = v3_req\n"
              "extensions = v3_req\n"
              "distinguished_name = req_distinguished_name\n"
              "[ req_distinguished_name ]\n"
              "[ v3_req ]\n"
              "subjectAltName=IP:127.0.0.1,DNS:localhost\n",
              -1, error))
      return FALSE;

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
    "-config", ssl_config,
    "-extensions", "v3_req",
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
  if (ssl_config)
    g_unlink (ssl_config);
  g_free (ssl_config);
  g_free (stderr_str);
  g_free (command_line);
  g_free (subject);
  return ret;
}

static gboolean
sscg_make_dummy_cert (const gchar *key_file,
                      const gchar *cert_file,
                      const gchar *ca_file,
                      GError **error)
{
  gboolean ret = FALSE;
  gint exit_status;
  gchar *stderr_str = NULL;
  gchar *command_line = NULL;
  gchar *cn = get_common_name ();
  gchar *machine_id = get_machine_id ();
  gchar *org;

  if (machine_id)
    org = machine_id;
  else
    org = "";

  const gchar *argv[] = {
    "sscg", "--quiet",
    "--lifetime", "3650",
    "--key-strength", "2048",
    "--cert-key-file", key_file,
    "--cert-file", cert_file,
    "--ca-file", ca_file,
    "--hostname", cn,
    "--organization", org,
    "--subject-alt-name", "localhost",
    "--subject-alt-name", "IP:127.0.0.1/255.255.255.255",
    NULL
  };

  command_line = g_strjoinv (" ", (gchar **)argv);
  g_info ("Generating temporary certificate using: %s", command_line);

  if (!g_spawn_sync (NULL, (gchar **)argv, NULL, G_SPAWN_SEARCH_PATH, NULL, NULL,
                     NULL, &stderr_str, &exit_status, error) ||
      !g_spawn_check_exit_status (exit_status, error))
    {
      /* Failure of SSCG is non-fatal */
      g_info ("Error generating temporary dummy cert using sscg, "
              "falling back to openssl");
      g_clear_error (error);
      goto out;
    }

  ret = TRUE;

out:
  g_free (stderr_str);
  g_free (command_line);
  g_free (machine_id);
  g_free (cn);
  return ret;
}

gchar *
cockpit_certificate_create_selfsigned (GError **error)
{
  gchar *dir = NULL;
  gchar *cert_path = NULL;
  gchar *ca_path = NULL;
  gchar *tmp_key = NULL;
  gchar *tmp_pem = NULL;
  gchar *cert_data = NULL;
  gchar *pem_data = NULL;
  gchar *key_data = NULL;
  gchar *ret = NULL;

  dir = g_build_filename (cockpit_conf_get_dirs ()[0], "cockpit", "ws-certs.d", NULL);
  cert_path = g_build_filename (dir, "0-self-signed.cert", NULL);

  /* Create the CA cert with a .pem suffix so it's not automatically loaded */
  ca_path = g_build_filename (dir, "0-self-signed-ca.pem", NULL);

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

  /* First, try to create a private CA and certificate using SSCG */
  if (sscg_make_dummy_cert (cert_path, cert_path, ca_path, error))
    {
      /* Creation with SSCG succeeded, so we are done now */
      ret = cert_path;
      cert_path = NULL;
      goto out;
    }
  g_clear_error (error);

  /* Fall back to using the openssl CLI */

  tmp_key = create_temp_file (dir, "0-self-signed.XXXXXX.tmp", error);
  if (!tmp_key)
    goto out;
  tmp_pem = create_temp_file (dir, "0-self-signed.XXXXXX.tmp", error);
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
  g_free (ca_path);
  cockpit_memory_clear (key_data, -1);
  g_free (key_data);
  g_free (pem_data);
  cockpit_memory_clear (cert_data, -1);
  g_free (cert_data);
  if (tmp_key)
    g_unlink (tmp_key);
  if (tmp_pem)
    g_unlink (tmp_pem);
  g_free (tmp_key);
  g_free (tmp_pem);
  g_free (dir);
  return ret;
}

gchar *
cockpit_certificate_locate_gerror (GError **error)
{
  gchar *error_str = NULL;
  gchar *path = cockpit_certificate_locate (&error_str);
  if (error_str)
    {
      g_set_error_literal (error, G_IO_ERROR, G_IO_ERROR_NOT_FOUND, error_str);
      g_free (error_str);
    }
  return path;
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
  g_autofree gchar *certs = NULL;
  g_autofree gchar *key = NULL;
  g_autofree gchar *combined = NULL;
  GTlsCertificate *cert;

  r = cockpit_certificate_parse (cert_path, &certs, &key);
  if (r < 0)
    {
      g_set_error (error, G_IO_ERROR, g_io_error_from_errno (-r), "Failed to load %s: %s", cert_path, g_strerror (-r));
      return NULL;
    }

  /* Gio only has constructors for parsing certs and key from one string, so combine them */
  combined = g_strconcat (certs, key, NULL);
  cert = g_tls_certificate_new_from_pem (combined, -1, error);
  if (cert == NULL)
    g_prefix_error (error, "%s: ", cert_path);
  else
    g_debug ("loaded %d certificates from %s", tls_certificate_count (cert), cert_path);
  return cert;
}
