/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
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

#include "remotectl.h"

#include "common/cockpittest.h"

#include <glib.h>
#include <glib/gstdio.h>

#include <errno.h>
#include <stdlib.h>
#include <string.h>
#include <grp.h>

const gchar *config_dir = BUILDDIR "/test-configdir";

static gchar *openssl_path = NULL;
static gchar *sscg_path = NULL;

typedef struct {
  gint ret;
  gchar *cert_dir;
} TestCase;

typedef struct {
  const gchar **files;
  const gchar *expected_message;
  const gchar *preinstall;
  gboolean readonly_dir;
  gboolean ensure;
  gboolean needs_openssl;
} TestFixture;

static void
delete_all (TestCase *tc)
{
  GDir *dir = NULL;
  GError *error = NULL;
  gchar *parent = NULL;
  const gchar *name;

  dir = g_dir_open (tc->cert_dir, 0, &error);
  if (!dir)
    goto out;

  while ((name = g_dir_read_name (dir)) != NULL)
    {
      gchar *path = g_build_filename (tc->cert_dir, name, NULL);
      g_unlink (path);
      g_free (path);
    }

  g_rmdir (tc->cert_dir);
  parent = g_path_get_dirname (tc->cert_dir);
  g_rmdir (parent);
  g_rmdir (config_dir);

out:
  if (dir)
    g_dir_close (dir);
  g_clear_error (&error);
  g_free (parent);
}

static void
setup (TestCase *tc,
       gconstpointer data)
{
  GPtrArray *ptr = g_ptr_array_new ();
  const TestFixture *fix = data;
  const gchar *old_val = g_getenv ("XDG_CONFIG_DIRS");
  gint i;
  struct group *gr;

  g_setenv ("XDG_CONFIG_DIRS", config_dir, TRUE);
  tc->cert_dir = g_build_filename (config_dir, "cockpit", "ws-certs.d", NULL);

  /* make sure we start clean */
  delete_all(tc);

  if (fix->readonly_dir)
    {
      g_assert (g_mkdir_with_parents (tc->cert_dir, 0755) == 0);
      g_assert (g_chmod (tc->cert_dir, 0555) == 0);
    }

  if (fix->needs_openssl && !openssl_path)
    return;

  if (fix->preinstall)
    {
      GError *error = NULL;
      g_autofree gchar *contents = NULL;
      g_autofree gchar *dest = g_build_filename (tc->cert_dir, "1.crt", NULL);

      g_assert (g_mkdir_with_parents (tc->cert_dir, 0755) == 0);
      g_file_get_contents (fix->preinstall, &contents, NULL, &error);
      g_assert_no_error (error);
      g_assert (contents);
      g_file_set_contents (dest, contents, -1, &error);
      g_assert_no_error (error);
    }

  g_ptr_array_add (ptr, "certificate");
  if (fix->ensure)
    {
      cockpit_expect_info ("Generating temporary certificate*");
      cockpit_expect_possible_log (G_LOG_DOMAIN, G_LOG_LEVEL_INFO, "Error generating temporary dummy cert using sscg, falling back to openssl*");
      g_ptr_array_add (ptr, "--ensure");
    }
  g_ptr_array_add (ptr, "--user");
  g_ptr_array_add (ptr, (gchar *) g_get_user_name ());

  /* determine user's primary group; we require that it exists for the tests */
  gr = getgrgid (getgid ());
  g_assert (gr);
  g_ptr_array_add (ptr, "--group");
  g_ptr_array_add (ptr, gr->gr_name);

  for (i = 0; fix->files[i] != NULL; i++)
    g_ptr_array_add (ptr, (gchar *) fix->files[i]);

  if (fix->expected_message)
    cockpit_expect_message (fix->expected_message);

  tc->ret = cockpit_remotectl_certificate (ptr->len, (gchar **) ptr->pdata);

  g_ptr_array_free (ptr, TRUE);
  if (old_val)
    g_setenv ("XDG_CONFIG_DIRS", old_val, TRUE);
  else
    g_unsetenv ("XDG_CONFIG_DIRS");
}

static void
teardown (TestCase *tc,
          gconstpointer data)
{
  delete_all(tc);
  cockpit_assert_expected ();
  g_free (tc->cert_dir);
}


static void
test_success (TestCase *test,
              gconstpointer data)
{
  g_assert_cmpint (test->ret, ==, 0);
}

static void
test_valid_selfsigned (TestCase *test,
                       gconstpointer data)
{
  GError *error = NULL;
  g_autoptr(GDir) dir = NULL;
  const gchar *fname;
  g_autofree gchar *path = NULL;
  g_autoptr(GTlsCertificate) certificate = NULL;

  if (!openssl_path)
    {
      g_test_skip ("openssl not available");
      return;
    }

  g_assert_cmpint (test->ret, ==, 0);
  dir = g_dir_open (test->cert_dir, 0, &error);
  g_assert_no_error (error);
  fname = g_dir_read_name (dir);
  if (sscg_path)
    {
      /* sscg creates a certificate signed by a self-signed CA; files can be in any order */
      if (strcmp (fname, "0-self-signed-ca.pem") == 0)
        fname = g_dir_read_name (dir);
      else
        g_assert_cmpstr (g_dir_read_name (dir), ==, "0-self-signed-ca.pem");
    }

  g_assert_cmpstr (fname, ==, "0-self-signed.cert");
  /* no further file created */
  g_assert_null (g_dir_read_name (dir));

  /* should be a valid certificate */
  path = g_build_filename (test->cert_dir, fname, NULL);
  certificate = g_tls_certificate_new_from_file (path, &error);
  g_assert_no_error (error);
  /* set cert as its own CA, as it's self-signed */
  g_assert_cmpint (g_tls_certificate_verify (certificate, NULL, certificate), ==, 0);
}

static void
test_refresh_expired (TestCase *test,
                      gconstpointer data)
{
  GError *error = NULL;
  g_autofree gchar *oldpath = g_build_filename (test->cert_dir, "alice-expired.cert", NULL);
  g_autofree gchar *selfsigned_path = g_build_filename (test->cert_dir, "0-self-signed.cert", NULL);
  g_autoptr(GTlsCertificate) certificate = NULL;
  char *argv[] = { "certificate", "--user", (gchar *) g_get_user_name (), "--ensure", NULL };
  int ret;

  if (!openssl_path)
    {
      g_test_skip ("openssl not available");
      return;
    }

  /* The call in setup() just created a combined certificate out of alice-expired.
   * Rename it to pretend it was a self-signed one */
  g_assert_cmpint (g_rename (oldpath, selfsigned_path), ==, 0);

  /* sanity check: cert should be expired */
  certificate = g_tls_certificate_new_from_file (selfsigned_path, &error);
  g_assert_no_error (error);
  g_assert_cmpint (g_tls_certificate_verify (certificate, NULL, certificate), ==, G_TLS_CERTIFICATE_EXPIRED);

  /* call with --ensure again, refreshes the cert */
  ret = cockpit_remotectl_certificate (4, argv);
  g_assert_cmpint (ret, ==, 0);

  /* now it's a valid certificate again */
  test_valid_selfsigned (test, data);
}

static void
test_keep_custom_expired (TestCase *test,
                          gconstpointer data)
{
  GError *error = NULL;
  g_autofree gchar *path = g_build_filename (test->cert_dir, "alice-expired.cert", NULL);
  g_autofree gchar *orig_content = NULL;
  g_autofree gchar *new_content = NULL;
  char *argv[] = { "certificate", "--user", (gchar *) g_get_user_name (), "--ensure", NULL };
  int ret;

  /* The call in setup() just created a combined certificate out of alice-expired */
  g_file_get_contents (path, &orig_content, NULL, &error);
  g_assert_no_error (error);

  /* call with --ensure again; this is a custom certificate, should *not* be touched */
  ret = cockpit_remotectl_certificate (4, argv);
  g_assert_cmpint (ret, ==, 0);
  g_file_get_contents (path, &new_content, NULL, &error);
  g_assert_no_error (error);
  g_assert_cmpstr (orig_content, ==, new_content);
}

static void
test_failure (TestCase *test,
              gconstpointer data)
{
  GDir *dir = NULL;
  GError *error = NULL;

  g_assert_cmpint (test->ret, ==, 1);
  dir = g_dir_open (test->cert_dir, 0, &error);
  g_assert_null (error);
  g_assert_null (g_dir_read_name (dir));
  g_dir_close (dir);
}

const gchar *no_files[] = { NULL };
const gchar *good_rsa_files[] = { SRCDIR "/src/bridge/mock-server.crt",
                                  SRCDIR "/src/bridge/mock-server.key", NULL };
const gchar *good_ecc_files[] = { SRCDIR "/src/ws/mock-ecc.crt",
                                  SRCDIR "/src/ws/mock-ecc.key", NULL };
const gchar *bad_files[] = { "bad", NULL };
const gchar *bad_files2[] = { SRCDIR "/src/bridge/mock-server.crt", "bad2", NULL };
const gchar *invalid_files1[] = { SRCDIR "/src/ws/mock-config/cockpit/cockpit.conf",
                                  SRCDIR "/src/ws/mock-config/cockpit/cockpit-alt.conf", NULL };
const gchar *invalid_files2[] = { SRCDIR "/src/bridge/mock-server.crt",
                                  SRCDIR "/src/bridge/mock-client.crt", NULL };
const gchar *invalid_files3[] = { SRCDIR "/src/bridge/mock-client.key", NULL };
const gchar *expired_files[] = { SRCDIR "/src/tls/ca/alice-expired.pem",
                                 SRCDIR "/src/tls/ca/alice.key", NULL };

/* test both possible orders in combined files: certs|key and key|certs */
#define combined_key_first SRCDIR "/src/ws/mock-combined.crt"
#define combined_key_last SRCDIR "/test/verify/files/cert-chain.cert"

static const TestFixture fixture_good_rsa_file = {
  .expected_message = NULL,
  .files = good_rsa_files
};

static const TestFixture fixture_good_ecc_file = {
  .expected_message = NULL,
  .files = good_ecc_files
};

static const TestFixture fixture_bad_file = {
  .expected_message = "*Failed to open file *bad*: No such file or directory",
  .files = bad_files
};

static const TestFixture fixture_bad_file2 = {
  .expected_message = "*Failed to open file *bad2*: No such file or directory",
  .files = bad_files2
};

static const TestFixture fixture_invalid1= {
  .expected_message = "*: Required key not available",
  .files = invalid_files1
};

static const TestFixture fixture_invalid2 = {
  .expected_message = "*: Required key not available",
  .files = invalid_files2
};

static const TestFixture fixture_invalid3 = {
  .expected_message = "*: No PEM-encoded certificate found",
  .files = invalid_files3
};

static const TestFixture fixture_create = {
  .files = no_files,
  .ensure = TRUE,
  .needs_openssl = TRUE,
};

static const TestFixture fixture_expired = {
  .files = expired_files,
};

static const TestFixture fixture_create_no_permission = {
  .expected_message = "Couldn't create temporary file*Permission denied",
  .files = no_files,
  .readonly_dir = TRUE,
  .ensure = TRUE
};

static const TestFixture fixture_preinstall_combined_key_first = {
    .preinstall = combined_key_first,
    .files = no_files,
};

static const TestFixture fixture_preinstall_combined_key_last = {
    .preinstall = combined_key_last,
    .files = no_files,
};

int
main (int argc,
      char *argv[])
{
  cockpit_test_init (&argc, &argv);

  openssl_path = g_find_program_in_path ("openssl");
  sscg_path = g_find_program_in_path ("sscg");

  g_test_add ("/remotectl-certificate/combine-good-rsa", TestCase, &fixture_good_rsa_file,
              setup, test_success, teardown);
  g_test_add ("/remotectl-certificate/combine-good-ecc", TestCase, &fixture_good_ecc_file,
              setup, test_success, teardown);
  g_test_add ("/remotectl-certificate/combine-bad-file", TestCase, &fixture_bad_file,
              setup, test_failure, teardown);
  g_test_add ("/remotectl-certificate/combine-bad-file2", TestCase, &fixture_bad_file2,
              setup, test_failure, teardown);
  g_test_add ("/remotectl-certificate/combine-not-valid", TestCase, &fixture_invalid1,
              setup, test_failure, teardown);
  g_test_add ("/remotectl-certificate/combine-no-key", TestCase, &fixture_invalid2,
              setup, test_failure, teardown);
  g_test_add ("/remotectl-certificate/combine-no-cert", TestCase, &fixture_invalid3,
              setup, test_failure, teardown);
  g_test_add ("/remotectl-certificate/create", TestCase, &fixture_create,
              setup, test_valid_selfsigned, teardown);
  g_test_add ("/remotectl-certificate/create-no-permission", TestCase, &fixture_create_no_permission,
              setup, test_failure, teardown);
  g_test_add ("/remotectl-certificate/refresh-expired", TestCase, &fixture_expired,
              setup, test_refresh_expired, teardown);
  g_test_add ("/remotectl-certificate/keep-custom-expired", TestCase, &fixture_expired,
              setup, test_keep_custom_expired, teardown);
  g_test_add ("/remotectl-certificate/load-combined-key-first", TestCase, &fixture_preinstall_combined_key_first,
              setup, test_success, teardown);
  g_test_add ("/remotectl-certificate/load-combined-key-last", TestCase, &fixture_preinstall_combined_key_last,
              setup, test_success, teardown);
  return g_test_run ();
}
