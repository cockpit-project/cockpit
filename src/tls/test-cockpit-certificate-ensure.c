/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2021 Red Hat, Inc.
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

#include "common/cockpitsystem.h"
#include "testlib/cockpittest.h"

#include <fcntl.h>
#include <glib.h>
#include <sys/stat.h>

#include "common/cockpithacks-glib.h"

#define CERTIFICATE_HELPER  BUILDDIR "/cockpit-certificate-ensure"

typedef struct {
  GSubprocessLauncher *launcher;

  gchar *config_dir;
  int config_dir_fd;

  char *runtime_dir;
  int runtime_dir_fd;
} Fixture;

typedef struct {
  const gchar **files;

  const gchar *check_stdout;
  const gchar *check_stderr;
  int check_exit;

  const gchar *copy_stdout;
  const gchar *copy_stderr;
  int copy_exit;
  const gchar *key_source;
  const gchar *cert_source;
} TestCase;

static void
delete_all_files (int         fd,
                  const char *path)
{
  int dirfd = openat (fd, path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  g_assert_no_errno (dirfd);
  DIR *dirp = fdopendir (dirfd); /* owns dirfd */

  const struct dirent *entry;
  while ((entry = readdir (dirp)))
    if (entry->d_name[0] != '.')
      {
        int r = unlinkat (dirfd, entry->d_name, 0);
        g_assert_no_errno (r);
      }

  closedir (dirp);
}

static void
fixture_teardown (Fixture       *self,
                  gconstpointer  data)
{
  g_clear_object (&self->launcher);

  delete_all_files (self->config_dir_fd, "cockpit/ws-certs.d");

  int r = unlinkat (self->config_dir_fd, "cockpit/ws-certs.d", AT_REMOVEDIR);
  g_assert_no_errno (r);

  r = unlinkat (self->config_dir_fd, "cockpit", AT_REMOVEDIR);
  g_assert_no_errno (r);

  r = rmdir (self->config_dir);
  g_assert_no_errno (r);

  close (self->config_dir_fd);
  g_free (self->config_dir);

  /* "server/" is only created for successful copy */
  if (faccessat (self->runtime_dir_fd, "server", F_OK, 0) == 0)
    {
      delete_all_files (self->runtime_dir_fd, "server");

      r = unlinkat (self->runtime_dir_fd, "server", AT_REMOVEDIR);
      g_assert_no_errno (r);
    }

  r = rmdir (self->runtime_dir);
  g_assert_no_errno (r);

  close (self->runtime_dir_fd);
  free (self->runtime_dir);
}

static void
fixture_setup (Fixture *self,
               gconstpointer data)
{
  const TestCase *tc = data;
  g_autoptr(GError) error = NULL;

  /* runtime dir */
  self->runtime_dir = g_dir_make_tmp ("cockpit-test-runtime.XXXXXX", &error);
  g_assert_no_error (error);

  self->runtime_dir_fd = open (self->runtime_dir, O_PATH | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  g_assert_no_errno (self->runtime_dir_fd);

  /* config dir */
  self->config_dir = g_dir_make_tmp ("cockpit-test-config.XXXXXX", &error);
  g_assert_no_error (error);

  self->config_dir_fd = open (self->config_dir, O_PATH | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  g_assert_no_errno (self->config_dir_fd);

  int r = mkdirat (self->config_dir_fd, "cockpit", 0700);
  g_assert_no_errno (r);

  r = mkdirat (self->config_dir_fd, "cockpit/ws-certs.d", 0700);
  g_assert_no_errno (r);

  /* populate ws-certs.d */
  for (int i = 0; tc->files[i]; i++)
    {
      g_autofree gchar *linkname = g_strconcat ("cockpit/ws-certs.d", strrchr (tc->files[i], '/'), NULL);
      r = symlinkat (tc->files[i], self->config_dir_fd, linkname);
      g_assert_no_errno (r);
    }

  /* launcher */
  self->launcher = g_subprocess_launcher_new (G_SUBPROCESS_FLAGS_STDOUT_PIPE | G_SUBPROCESS_FLAGS_STDERR_PIPE);
  g_subprocess_launcher_setenv (self->launcher, "XDG_CONFIG_DIRS", self->config_dir, TRUE);
  g_subprocess_launcher_setenv (self->launcher, "RUNTIME_DIRECTORY", self->runtime_dir, TRUE);
}

static void
test_check (Fixture *fixture,
            gconstpointer data)
{
  const TestCase *tc = data;
  g_autoptr(GError) error = NULL;

  g_autoptr(GSubprocess) helper = g_subprocess_launcher_spawn (fixture->launcher, &error,
                                                               CERTIFICATE_HELPER, "--check", NULL);
  g_assert_no_error (error);

  g_autofree gchar *stdout_str = NULL;
  g_autofree gchar *stderr_str = NULL;
  gboolean result = g_subprocess_communicate_utf8 (helper, NULL, NULL, &stdout_str, &stderr_str, &error);
  g_assert_no_error (error);
  g_assert (result);

  g_assert (g_subprocess_get_if_exited (helper));

  cockpit_assert_strmatch (stdout_str, tc->check_stdout);
  cockpit_assert_strmatch (stderr_str, tc->check_stderr);
  g_assert_cmpint (g_subprocess_get_exit_status (helper), ==, tc->check_exit);
}

static gchar *
areadlinkat (int         dirfd,
             const char *filename)
{
  char buffer[PATH_MAX];
  ssize_t s = readlinkat (dirfd, filename, buffer, sizeof buffer);
  g_assert_cmpint (s, <, sizeof buffer);
  if (s == -1 && errno == ENOENT)
    s = 0; /* results in returning empty string */
  else
    g_assert_no_errno (s);
  buffer[s] = '\0';
  return g_strdup (buffer);
}

static void
append_file_to_string (GString *string,
                       const gchar *filename)
{
  g_autoptr(GError) error = NULL;
  g_autofree gchar *content = NULL;
  gsize size;

  g_file_get_contents (filename, &content, &size, &error);
  g_assert_no_error (error);

  g_string_append_len (string, content, size);
}

static void
test_copy (Fixture *fixture,
           gconstpointer data)
{
  const TestCase *tc = data;
  g_autoptr(GError) error = NULL;

  g_autoptr(GSubprocess) helper = g_subprocess_launcher_spawn (fixture->launcher, &error,
                                                               CERTIFICATE_HELPER, "--for-cockpit-tls", NULL);
  g_assert_no_error (error);

  g_autofree gchar *stdout_str = NULL;
  g_autofree gchar *stderr_str = NULL;
  gboolean result = g_subprocess_communicate_utf8 (helper, NULL, NULL, &stdout_str, &stderr_str, &error);
  g_assert_no_error (error);
  g_assert (result);

  g_assert (g_subprocess_get_if_exited (helper));

  cockpit_assert_strmatch (stdout_str, tc->copy_stdout);
  cockpit_assert_strmatch (stderr_str, tc->copy_stderr);
  g_assert_cmpint (g_subprocess_get_exit_status (helper), ==, tc->copy_exit);

  g_autofree gchar *cert_source = areadlinkat (fixture->runtime_dir_fd, "server/cert.source");
  cockpit_assert_strmatch (cert_source, tc->cert_source);

  g_autofree gchar *key_source = areadlinkat (fixture->runtime_dir_fd, "server/key.source");
  cockpit_assert_strmatch (key_source, tc->key_source);

  if (tc->copy_exit == EXIT_SUCCESS)
    {
      /* Check to make sure the input is the same as the output */
      g_autoptr(GString) input_data = g_string_new (NULL);
      append_file_to_string (input_data, cert_source);
      if (!g_str_equal (key_source, cert_source))
        append_file_to_string (input_data, key_source);
      g_autoptr(GTlsCertificate) input = g_tls_certificate_new_from_pem (input_data->str, input_data->len, &error);
      g_assert_no_error (error);

      g_autofree gchar *certfile = g_build_filename (fixture->runtime_dir, "server", "cert", NULL);
      g_autofree gchar *keyfile = g_build_filename (fixture->runtime_dir, "server", "key", NULL);
      g_autoptr(GTlsCertificate) output = g_tls_certificate_new_from_files (certfile, keyfile, &error);
#if !GLIB_CHECK_VERSION(2,58,0)
      /* Older GLib (RHEL 8) doesn't know how to find EC private keys */
      if (error &&
          strstr (error->message, "No PEM-encoded private key found") &&
          strstr (input_data->str, "BEGIN EC PRIVATE KEY"))
        {
          g_test_skip ("EC private keys unsupported");
          return;
        }
#endif
      g_assert_no_error (error);

       /* NB: doesn't check key, and there's no way to read it back :( */
      g_assert (g_tls_certificate_is_same (input, output));
    }
}

const gchar *no_files[] = { NULL };
const gchar *good_rsa_files[] = { SRCDIR "/test/data/mock-server.crt",
                                  SRCDIR "/test/data/mock-server.key", NULL };
const gchar *good_ecc_files[] = { SRCDIR "/src/ws/mock-ecc.crt",
                                  SRCDIR "/src/ws/mock-ecc.key", NULL };
const gchar *bad_files[] = { SRCDIR "/bad", NULL };
const gchar *bad_files2[] = { SRCDIR "/test/data/mock-server.crt", SRCDIR "/bad2", NULL };
const gchar *invalid_files1[] = { SRCDIR "/src/ws/mock-config/cockpit/cockpit.conf",
                                  SRCDIR "/src/ws/mock-config/cockpit/cockpit-alt.conf", NULL };
const gchar *invalid_files2[] = { SRCDIR "/test/data/mock-server.crt",
                                  SRCDIR "/test/data/mock-client.crt", NULL };
const gchar *invalid_files3[] = { SRCDIR "/test/data/mock-client.key", NULL };

static const TestCase case_good_rsa_file = {
  .files = good_rsa_files,

  .check_stdout = "Would use */mock-server.crt*",
  .check_stderr = "",
  .check_exit = EXIT_SUCCESS,

  .copy_stdout = "",
  .copy_stderr = "",
  .copy_exit = EXIT_SUCCESS,
  .cert_source = "*/cockpit/ws-certs.d/mock-server.crt",
  .key_source = "*/cockpit/ws-certs.d/mock-server.key",
};

static const TestCase case_good_ecc_file = {
  .files = good_ecc_files,

  .check_stdout = "Would use */mock-ecc.crt*",
  .check_stderr = "",
  .check_exit = EXIT_SUCCESS,

  .copy_stdout = "",
  .copy_stderr = "",
  .copy_exit = EXIT_SUCCESS,
  .cert_source = "*/cockpit/ws-certs.d/mock-ecc.crt",
  .key_source = "*/cockpit/ws-certs.d/mock-ecc.key",
};

static const TestCase case_bad_file = {
  .files = bad_files,

  .check_stdout = "Unable to find*Would create*",
  .check_stderr = "",
  .check_exit = EXIT_FAILURE
};

static const TestCase case_bad_file2 = {
  .files = bad_files2,

  .check_stdout = "",
  .check_stderr = "*open*mock-server.key*No such file*",
  .check_exit = EXIT_FAILURE,

  .copy_stdout = "",
  .copy_stderr = "*open*mock-server.key*No such file*",
  .copy_exit = EXIT_FAILURE,
};

static const TestCase case_invalid1 = {
  .files = invalid_files1,

  .check_stdout = "Unable to find*Would create*",
  .check_stderr = "",
  .check_exit = EXIT_FAILURE
};

static const TestCase case_invalid2 = {
  .files = invalid_files2,

  .check_stdout = "",
  .check_stderr = "*open*mock-server.key*No such file*",
  .check_exit = EXIT_FAILURE,

  .copy_stdout = "",
  .copy_stderr = "*open*mock-server.key*No such file*",
  .copy_exit = EXIT_FAILURE,
};

static const TestCase case_invalid3 = {
  .files = invalid_files3,

  .check_stdout = "Unable to find*Would create*",
  .check_stderr = "",
  .check_exit = EXIT_FAILURE
};

static const TestCase case_create = {
  .files = no_files,

  .check_stdout = "Unable to find*Would create*",
  .check_stderr = "",
  .check_exit = EXIT_FAILURE
};

static const TestCase case_invalid_validity = {
  .files = (const gchar *[]) { SRCDIR "/test/data/100years/0-self-signed.cert",
                               SRCDIR "/test/data/100years/0-self-signed.key",
                               NULL },
  .check_stdout = "Found*self-signed*but it needs to be reissued*",
  .check_stderr = "",
  .check_exit = EXIT_FAILURE
};

static const TestCase case_expired = {
  .files = (const gchar *[]) { SRCDIR "/test/data/expired/0-self-signed.cert",
                               SRCDIR "/test/data/expired/0-self-signed.key",
                               NULL },
  .check_stdout = "Found*self-signed*but it needs to be reissued*",
  .check_stderr = "",
  .check_exit = EXIT_FAILURE
};

static const TestCase case_mismatched = {
  .files = (const gchar *[]) { SRCDIR "/test/data/expired/0-self-signed.cert",
                               SRCDIR "/test/data/100years/0-self-signed.key",
                               NULL },
  .check_stdout = "",
  .check_stderr = "*certificate and the given key do not match*",
  .check_exit = EXIT_FAILURE,

  .copy_stdout = "",
  .copy_stderr = "*certificate and the given key do not match*",
  .copy_exit = EXIT_FAILURE,
  .cert_source = "",
  .key_source = ""
};

static const TestCase expired_not_selfsign = {
  .files = (const gchar *[]) { SRCDIR "/test/data/expired/1.cert",
                               SRCDIR "/test/data/expired/1.key",
                               NULL },
  .check_stdout = "Would use*1.cert*",
  .check_stderr = "",
  .check_exit = EXIT_SUCCESS,

  .copy_stdout = "",
  .copy_stderr = "",
  .copy_exit = EXIT_SUCCESS,
  .cert_source = "*/cockpit/ws-certs.d/1.cert",
  .key_source = "*/cockpit/ws-certs.d/1.key",
};

static const TestCase expired_combined = {
  .files = (const gchar *[]) { SRCDIR "/test/data/expired/combined.cert",
                               NULL },
  .check_stdout = "",
  .check_stderr = "*merged certificate and key files are unsupported*",
  .check_exit = EXIT_FAILURE,

  .copy_stdout = "",
  .copy_stderr = "*merged certificate and key files are deprecated*",
  .copy_exit = EXIT_SUCCESS,
  .key_source = "*/cockpit/ws-certs.d/combined.cert",
  .cert_source = "*/cockpit/ws-certs.d/combined.cert"
};

static const TestCase many_files = {
  .files = (const gchar *[]) { SRCDIR "/test/data/expired/0-self-signed.cert",
                               SRCDIR "/test/data/expired/0-self-signed.key",
                               SRCDIR "/test/data/expired/1.cert",
                               SRCDIR "/test/data/expired/1.key",
                               SRCDIR "/test/data/expired/combined.cert",
                               NULL },
  .check_stdout = "",
  .check_stderr = "*merged certificate and key files are unsupported*",
  .check_exit = EXIT_FAILURE,

  .copy_stdout = "",
  .copy_stderr = "*merged certificate and key files are deprecated*",
  .copy_exit = EXIT_SUCCESS,
  .key_source = "*/cockpit/ws-certs.d/combined.cert",
  .cert_source = "*/cockpit/ws-certs.d/combined.cert"
};

int
main (int argc,
      char *argv[])
{
  cockpit_test_init (&argc, &argv);

  g_test_add ("/cockpit-certificate-ensure/check/good-rsa",
              Fixture, &case_good_rsa_file, fixture_setup, test_check, fixture_teardown);
  g_test_add ("/cockpit-certificate-ensure/copy/good-rsa",
              Fixture, &case_good_rsa_file, fixture_setup, test_copy, fixture_teardown);
  g_test_add ("/cockpit-certificate-ensure/check/good-ecc",
              Fixture, &case_good_ecc_file, fixture_setup, test_check, fixture_teardown);
  g_test_add ("/cockpit-certificate-ensure/copy/good-ecc",
              Fixture, &case_good_ecc_file, fixture_setup, test_copy, fixture_teardown);
  g_test_add ("/cockpit-certificate-ensure/bad-file",
              Fixture, &case_bad_file, fixture_setup, test_check, fixture_teardown);
  g_test_add ("/cockpit-certificate-ensure/bad-file2",
              Fixture, &case_bad_file2, fixture_setup, test_check, fixture_teardown);
  g_test_add ("/cockpit-certificate-ensure/not-valid",
              Fixture, &case_invalid1, fixture_setup, test_check, fixture_teardown);
  g_test_add ("/cockpit-certificate-ensure/no-key",
              Fixture, &case_invalid2, fixture_setup, test_check, fixture_teardown);
  g_test_add ("/cockpit-certificate-ensure/no-cert",
              Fixture, &case_invalid3, fixture_setup, test_check, fixture_teardown);
  g_test_add ("/cockpit-certificate-ensure/create",
              Fixture, &case_create, fixture_setup, test_check, fixture_teardown);

  g_test_add ("/cockpit-certificate-ensure/invalid-validity",
              Fixture, &case_invalid_validity, fixture_setup, test_check, fixture_teardown);
  g_test_add ("/cockpit-certificate-ensure/expired",
              Fixture, &case_expired, fixture_setup, test_check, fixture_teardown);
  g_test_add ("/cockpit-certificate-ensure/check/mismatched",
              Fixture, &case_mismatched, fixture_setup, test_check, fixture_teardown);
  g_test_add ("/cockpit-certificate-ensure/copy/mismatched",
              Fixture, &case_mismatched, fixture_setup, test_copy, fixture_teardown);

  g_test_add ("/cockpit-certificate-ensure/check/expired-not-self-signed",
              Fixture, &expired_not_selfsign, fixture_setup, test_check, fixture_teardown);
  g_test_add ("/cockpit-certificate-ensure/copy/expired-not-self-signed",
              Fixture, &expired_not_selfsign, fixture_setup, test_copy, fixture_teardown);

  g_test_add ("/cockpit-certificate-ensure/check/expired-combined",
              Fixture, &expired_combined, fixture_setup, test_check, fixture_teardown);
  g_test_add ("/cockpit-certificate-ensure/copy/expired-combined",
              Fixture, &expired_combined, fixture_setup, test_copy, fixture_teardown);

  g_test_add ("/cockpit-certificate-ensure/check/many-files",
              Fixture, &many_files, fixture_setup, test_check, fixture_teardown);
  g_test_add ("/cockpit-certificate-ensure/copy/many-files",
              Fixture, &many_files, fixture_setup, test_copy, fixture_teardown);

  return g_test_run ();
}
