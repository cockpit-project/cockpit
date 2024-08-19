/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2020 Red Hat, Inc.
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
#include <fcntl.h>
#include <unistd.h>

#include "cockpitwebcertificate.h"

#include "cockpitsystem.h"

#include "testlib/cockpittest.h"

static void
do_locate_test (int dirfd, const char *certname, const char *expected_path, const char *expected_error)
{
  char *error = NULL;
  gchar *path;

  if (certname)
    {
      int fd = openat (dirfd, certname, O_CREAT | O_WRONLY, 0666);
      g_assert_cmpint (fd, >=, 0);
      close (fd);
    }

  path = cockpit_certificate_locate (false, &error);

  if (expected_path)
    cockpit_assert_strmatch (path, expected_path);
  else
    g_assert_cmpstr (path, ==, NULL);

  if (expected_error)
    cockpit_assert_strmatch (error, expected_error);
  else
    g_assert_cmpstr (error, ==, NULL);

  g_free (error);
  g_free (path);
  if (certname)
    g_assert_cmpint (unlinkat (dirfd, certname, 0), ==, 0);
}

static void
test_locate (void)
{
  g_autofree gchar *workdir = g_strdup ("/tmp/test-cockpit-webcertificate.XXXXXX");
  g_autofree gchar *cert_dir = NULL;
  int cert_dir_fd;

  g_assert (g_mkdtemp (workdir) == workdir);
  cockpit_setenv_check ("XDG_CONFIG_DIRS", workdir, TRUE);

  /* nonexisting dir, nothing found */
  do_locate_test (-1, NULL, NULL, "No certificate found in dir: */ws-certs.d");

  /* empty dir, nothing found */
  cert_dir = g_build_filename (workdir, "cockpit", "ws-certs.d", NULL);
  g_assert_cmpint (g_mkdir_with_parents (cert_dir, 0777), ==, 0);
  do_locate_test (-1, NULL, NULL, "No certificate found in dir: */ws-certs.d");

  /* one unrelated file */
  cert_dir_fd = open (cert_dir, O_PATH);
  g_assert_cmpint (cert_dir_fd, >=, 0);
  do_locate_test (cert_dir_fd, "noise.zrt", NULL, "No certificate found in dir: */ws-certs.d");

  /* one good file */
  do_locate_test (cert_dir_fd, "01-first.cert", "*/cockpit/ws-certs.d/01-first.cert", NULL);

  /* asciibetically last one wins */
  do_locate_test (cert_dir_fd, "50-better.cert", "*/cockpit/ws-certs.d/50-better.cert", NULL);

  /* *.crt works, too */
  do_locate_test (cert_dir_fd, "60-best.crt", "*/cockpit/ws-certs.d/60-best.crt", NULL);

  close (cert_dir_fd);
  g_unsetenv ("XDG_CONFIG_DIRS");
  rmdir (cert_dir);
  rmdir (workdir);
}

static void
test_keypath (void)
{
  char *path;

  path = cockpit_certificate_key_path ("/etc/cockpit/ws-certs.d/50-good.cert");
  g_assert_cmpstr (path, ==, "/etc/cockpit/ws-certs.d/50-good.key");
  g_free (path);
  path = cockpit_certificate_key_path ("a.cert");
  g_assert_cmpstr (path, ==, "a.key");
  g_free (path);
  path = cockpit_certificate_key_path ("a.crt");
  g_assert_cmpstr (path, ==, "a.key");
  g_free (path);
}

int
main (int argc,
      char *argv[])
{
  cockpit_test_init (&argc, &argv);

  g_test_add_func ("/webcertificate/locate", test_locate);
  g_test_add_func ("/webcertificate/keypath", test_keypath);

  return g_test_run ();
}
