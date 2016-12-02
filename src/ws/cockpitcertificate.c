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

#include <glib/gstdio.h>
#include <glib/gi18n.h>

#include <errno.h>
#include <string.h>

static gchar *
generate_subject (void)
{
  static const char HEX[] = "0123456789abcdef";
  gchar hostname[HOST_NAME_MAX + 1] = { 0, };
  gchar *content;
  gchar *subject;
  gchar *cn;
  int ret;


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

  ret = gethostname (hostname, sizeof (hostname));
  if (ret < 0 || g_str_equal (hostname, ""))
    cn = "localhost";
  else
    cn = hostname;

  if (g_file_get_contents ("/etc/machine-id", &content, NULL, NULL))
    {
      subject = g_strdup_printf ("/O=%s/CN=%s",
                                 g_strstrip (g_strcanon (content, HEX, ' ')), cn);
      g_free (content);
    }
  else
    {
      subject = g_strdup_printf ("/CN=%s", cn);
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
generate_temp_cert (const gchar *dir,
                    GError **error)
{
  gchar *cert_path = NULL;
  gchar *tmp_key = NULL;
  gchar *tmp_pem = NULL;
  gchar *cert_data = NULL;
  gchar *pem_data = NULL;
  gchar *key_data = NULL;
  gchar *ret = NULL;

  cert_path = g_build_filename (dir, "0-self-signed.cert", NULL);

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
  const gchar * const* dirs = cockpit_conf_get_dirs ();
  GError *local_error = NULL;
  gchar *cert_dir;
  gchar *cert_path;
  gint i;

  for (i = 0; dirs[i]; i++)
    {
      cert_dir = g_build_filename (dirs[i], "cockpit", "ws-certs.d", NULL);
      cert_path = load_cert_from_dir (cert_dir, &local_error);

      if (local_error != NULL)
        {
          g_propagate_prefixed_error (error, local_error,
                                      "Error loading certificates from %s: ",
                                      cert_dir);
          g_free (cert_dir);
          return NULL;
        }

      g_free (cert_dir);

      if (cert_path)
        return cert_path;
    }

  cert_dir = g_build_filename (dirs[0], "cockpit", "ws-certs.d", NULL);
  if (create_if_necessary)
    {
      cert_path = generate_temp_cert (cert_dir, error);
    }
  else
    {
      cert_path = NULL;
      g_set_error (error, G_IO_ERROR, G_IO_ERROR_NOT_FOUND,
                   "No certificate found in dir: %s", cert_dir);
    }
  g_free (cert_dir);

  return cert_path;
}

/*
 * When running on GLib earlier than 2.44 we have to do our own
 * certificate chain loading. This can be removed once we only
 * support GLib 2.44 and later.
 *
 * GIO - GLib Input, Output and Certificateing Library
 *
 * Copyright (C) 2010 Red Hat, Inc.
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 2 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General
 * Public License along with this library; if not, see <http://www.gnu.org/licenses/>.
 */

#define PEM_CERTIFICATE_HEADER     "-----BEGIN CERTIFICATE-----"
#define PEM_CERTIFICATE_FOOTER     "-----END CERTIFICATE-----"
#define PEM_PKCS1_PRIVKEY_HEADER   "-----BEGIN RSA PRIVATE KEY-----"
#define PEM_PKCS1_PRIVKEY_FOOTER   "-----END RSA PRIVATE KEY-----"
#define PEM_PKCS8_PRIVKEY_HEADER   "-----BEGIN PRIVATE KEY-----"
#define PEM_PKCS8_PRIVKEY_FOOTER   "-----END PRIVATE KEY-----"
#define PEM_PKCS8_ENCRYPTED_HEADER "-----BEGIN ENCRYPTED PRIVATE KEY-----"
#define PEM_PKCS8_ENCRYPTED_FOOTER "-----END ENCRYPTED PRIVATE KEY-----"

static gchar *
parse_private_key (const gchar *data,
                   gsize data_len,
                   gboolean required,
                   GError **error)
{
  const gchar *start, *end, *footer;

  start = g_strstr_len (data, data_len, PEM_PKCS1_PRIVKEY_HEADER);
  if (start)
    footer = PEM_PKCS1_PRIVKEY_FOOTER;
  else
    {
      start = g_strstr_len (data, data_len, PEM_PKCS8_PRIVKEY_HEADER);
      if (start)
        footer = PEM_PKCS8_PRIVKEY_FOOTER;
      else
        {
          start = g_strstr_len (data, data_len, PEM_PKCS8_ENCRYPTED_HEADER);
          if (start)
            {
              g_set_error_literal (error, G_TLS_ERROR, G_TLS_ERROR_BAD_CERTIFICATE,
                                   _("Cannot decrypt PEM-encoded private key"));
            }
          else if (required)
            {
              g_set_error_literal (error, G_TLS_ERROR, G_TLS_ERROR_BAD_CERTIFICATE,
                                   _("No PEM-encoded private key found"));
            }
          return NULL;
        }
    }

  end = g_strstr_len (start, data_len - (data - start), footer);
  if (!end)
    {
      g_set_error_literal (error, G_TLS_ERROR, G_TLS_ERROR_BAD_CERTIFICATE,
                           _("Could not parse PEM-encoded private key"));
      return NULL;
    }
  end += strlen (footer);
  while (*end == '\r' || *end == '\n')
    end++;

  return g_strndup (start, end - start);
}

static gchar *
parse_next_pem_certificate (const gchar **data,
                            const gchar *data_end,
                            gboolean required,
                            GError **error)
{
  const gchar *start, *end;

  start = g_strstr_len (*data, data_end - *data, PEM_CERTIFICATE_HEADER);
  if (!start)
    {
      if (required)
        {
          g_set_error_literal (error, G_TLS_ERROR, G_TLS_ERROR_BAD_CERTIFICATE,
                               _("No PEM-encoded certificate found"));
        }
      return NULL;
    }

  end = g_strstr_len (start, data_end - start, PEM_CERTIFICATE_FOOTER);
  if (!end)
    {
      g_set_error_literal (error, G_TLS_ERROR, G_TLS_ERROR_BAD_CERTIFICATE,
                           _("Could not parse PEM-encoded certificate"));
      return NULL;
    }
  end += strlen (PEM_CERTIFICATE_FOOTER);
  while (*end == '\r' || *end == '\n')
    end++;

  *data = end;

  return g_strndup (start, end - start);
}

static GSList *
parse_and_create_certificate_list (const gchar *data,
                                   gsize data_len,
                                   GError **error)
{
  GSList *first_pem_list = NULL, *pem_list = NULL;
  gchar *first_pem;
  const gchar *p, *end;

  p = data;
  end = p + data_len;

  /* Make sure we can load, at least, one certificate. */
  first_pem = parse_next_pem_certificate (&p, end, TRUE, error);
  if (!first_pem)
    return NULL;

  /* Create a list with a single element. If we load more certificates
   * below, we will concatenate the two lists at the end. */
  first_pem_list = g_slist_prepend (first_pem_list, first_pem);

  /* If we read one certificate successfully, let's see if we can read
   * some more. If not, we will simply return a list with the first one.
   */
  while (p && *p)
    {
      gchar *cert_pem;
      GError *error = NULL;

      cert_pem = parse_next_pem_certificate (&p, end, FALSE, &error);
      if (error)
        {
          g_slist_free_full (pem_list, g_free);
          g_error_free (error);
          return first_pem_list;
        }
      else if (!cert_pem)
        {
          break;
        }

      pem_list = g_slist_prepend (pem_list, cert_pem);
    }

  pem_list = g_slist_concat (pem_list, first_pem_list);

  return pem_list;
}

static GTlsCertificate *
tls_certificate_new_internal (const gchar *certificate_pem,
                              const gchar *private_key_pem,
                              GTlsCertificate *issuer,
                              GError **error)
{
  GObject *cert;
  GTlsBackend *backend;

  backend = g_tls_backend_get_default ();

  cert = g_initable_new (g_tls_backend_get_certificate_type (backend),
                         NULL, error,
                         "certificate-pem", certificate_pem,
                         "private-key-pem", private_key_pem,
                         "issuer", issuer,
                         NULL);

  return G_TLS_CERTIFICATE (cert);
}

static GTlsCertificate *
create_certificate_chain_from_list (GSList *pem_list,
                                    const gchar  *key_pem)
{
  GTlsCertificate *cert = NULL, *issuer = NULL, *root = NULL;
  GTlsCertificateFlags flags;
  GSList *pem;

  pem = pem_list;
  while (pem)
    {
      const gchar *key = NULL;

      /* Private key belongs only to the first certificate. */
      if (!pem->next)
        key = key_pem;

      /* We assume that the whole file is a certificate chain, so we use
       * each certificate as the issuer of the next one (list is in
       * reverse order).
       */
      issuer = cert;
      cert = tls_certificate_new_internal (pem->data, key, issuer, NULL);
      if (issuer)
        g_object_unref (issuer);

      if (!cert)
        return NULL;

      /* root will point to the last certificate in the file. */
      if (!root)
        root = cert;

      pem = g_slist_next (pem);
    }

  /* Verify that the certificates form a chain. (We don't care at this
   * point if there are other problems with it.)
   */
  flags = g_tls_certificate_verify (cert, NULL, root);
  if (flags & G_TLS_CERTIFICATE_UNKNOWN_CA)
    {
      /* It wasn't a chain, it's just a bunch of unrelated certs. */
      g_clear_object (&cert);
    }

  return cert;
}

static GTlsCertificate *
parse_and_create_certificate (const gchar *data,
                              gsize data_len,
                              const gchar *key_pem,
                              GError **error)

{
  GSList *pem_list;
  GTlsCertificate *cert;

  pem_list = parse_and_create_certificate_list (data, data_len, error);
  if (!pem_list)
    return NULL;

  /* We don't pass the error here because, if it fails, we still want to
   * load and return the first certificate.
   */
  cert = create_certificate_chain_from_list (pem_list, key_pem);
  if (!cert)
    {
      GSList *last = NULL;

      /* Get the first certificate (which is the last one as the list is
       * in reverse order).
       */
      last = g_slist_last (pem_list);

      cert = tls_certificate_new_internal (last->data, key_pem, NULL, error);
    }

  g_slist_free_full (pem_list, g_free);

  return cert;
}

static GTlsCertificate *
tls_certificate_new_from_pem  (const gchar *data,
                               gssize length,
                               GError **error)
{
  GError *child_error = NULL;
  gchar *key_pem;
  GTlsCertificate *cert;

  g_return_val_if_fail (data != NULL, NULL);
  g_return_val_if_fail (error == NULL || *error == NULL, NULL);

  if (length == -1)
    length = strlen (data);

  key_pem = parse_private_key (data, length, TRUE, &child_error);
  if (child_error != NULL)
    {
      g_propagate_error (error, child_error);
      return NULL;
    }

  cert = parse_and_create_certificate (data, length, key_pem, error);
  g_free (key_pem);

  return cert;
}

static GTlsCertificate *
tls_certificate_new_from_file (const gchar *file,
                               GError **error)
{
  GTlsCertificate *cert;
  gchar *contents;
  gsize length;

  if (!g_file_get_contents (file, &contents, &length, error))
    return NULL;

  cert = tls_certificate_new_from_pem (contents, length, error);
  g_free (contents);
  return cert;
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
  GTlsCertificate *cert;

  cert = tls_certificate_new_from_file (cert_path, error);
  if (cert == NULL)
    g_prefix_error (error, "%s: ", cert_path);
  else
    g_debug ("loaded %d certificates from %s", tls_certificate_count (cert), cert_path);
  return cert;
}
