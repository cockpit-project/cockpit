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

#include "cockpitdbusinternal.h"

#include "common/cockpittest.h"

#include <gio/gio.h>
#include <glib/gstdio.h>

extern const gchar *cockpit_bridge_path_passwd;
extern const gchar *cockpit_bridge_path_group;
extern const gchar *cockpit_bridge_path_shadow;
extern const gchar *cockpit_bridge_path_newusers;
extern const gchar *cockpit_bridge_path_chpasswd;
extern const gchar *cockpit_bridge_path_usermod;
extern gboolean     cockpit_bridge_have_newusers_crypt_method;

typedef struct {
  GDBusConnection *connection;
} TestCase;

static void
setup (TestCase *tc,
       gconstpointer unused)
{
  cockpit_dbus_internal_startup (FALSE);

  cockpit_dbus_setup_startup ();
  while (g_main_context_iteration (NULL, FALSE));

  tc->connection = cockpit_dbus_internal_client();
}

static void
teardown (TestCase *tc,
          gconstpointer unused)
{
  cockpit_assert_expected ();
  g_object_unref (tc->connection);
  cockpit_dbus_internal_cleanup ();
}

static void
on_complete_get_result (GObject *source,
                        GAsyncResult *result,
                        gpointer user_data)
{
  GAsyncResult **ret = user_data;
  g_assert (ret != NULL);
  g_assert (*ret == NULL);
  *ret = g_object_ref (result);
}

static GVariant *
dbus_call_with_main_loop (TestCase *tc,
                          const gchar *object_path,
                          const gchar *interface_name,
                          const gchar *method_name,
                          GVariant *parameters,
                          const GVariantType *reply_type,
                          GError **error)
{
  GAsyncResult *result = NULL;
  GVariant *retval;

  g_dbus_connection_call (tc->connection, NULL, object_path,
                          interface_name, method_name, parameters,
                          reply_type, G_DBUS_CALL_FLAGS_NONE, -1,
                          NULL, on_complete_get_result, &result);

  while (result == NULL)
    g_main_context_iteration (NULL, TRUE);

  retval = g_dbus_connection_call_finish (tc->connection, result, error);
  g_object_unref (result);

  return retval;
}

static void
test_get_properties (TestCase *tc,
                     gconstpointer unused)
{
  GVariant *retval;
  GError *error = NULL;
  gchar *string;

  retval = dbus_call_with_main_loop (tc, "/setup", "org.freedesktop.DBus.Properties", "GetAll",
                                     g_variant_new ("(s)", "cockpit.Setup"),
                                     G_VARIANT_TYPE ("(a{sv})"), &error);

  g_assert_no_error (error);
  string = g_variant_print (retval, FALSE);
  g_assert_cmpstr ("({'Mechanisms': <['passwd1']>},)", ==, string);
  g_free (string);
  g_variant_unref (retval);
}

static void
test_prepare_passwd1 (TestCase *tc,
                      gconstpointer unused)
{
  GVariant *retval;
  GError *error = NULL;
  gchar *string;

  cockpit_bridge_path_passwd = SRCDIR "/src/bridge/mock-setup/remote-passwd";
  cockpit_bridge_path_group = SRCDIR "/src/bridge/mock-setup/remote-group";

  retval = dbus_call_with_main_loop (tc, "/setup", "cockpit.Setup", "Prepare",
                                     g_variant_new ("(s)", "passwd1"),
                                     G_VARIANT_TYPE ("(v)"), &error);

  g_assert_no_error (error);
  string = g_variant_print (retval, FALSE);
  g_assert_cmpstr (string, ==, "(<(['root', 'janice', 'scruffy'], ['root', 'wheel', 'docker'])>,)");
  g_free (string);
  g_variant_unref (retval);
}

static void
test_prepare_unsupported (TestCase *tc,
                          gconstpointer unused)
{
  GVariant *retval;
  GError *error = NULL;

  retval = dbus_call_with_main_loop (tc, "/setup", "cockpit.Setup", "Prepare",
                                     g_variant_new ("(s)", "blah"),
                                     G_VARIANT_TYPE ("(v)"), &error);

  g_assert_error (error, G_DBUS_ERROR, G_DBUS_ERROR_NOT_SUPPORTED);
  g_assert (retval == NULL);
  g_error_free (error);
}

static void
test_prepare_fail (TestCase *tc,
                   gconstpointer unused)
{
  GVariant *retval;
  GError *error = NULL;

  cockpit_bridge_path_passwd = SRCDIR "/src/bridge/mock-setup/non-existant";

  cockpit_expect_message ("unable to open*");

  retval = dbus_call_with_main_loop (tc, "/setup", "cockpit.Setup", "Prepare",
                                     g_variant_new ("(s)", "passwd1"),
                                     G_VARIANT_TYPE ("(v)"), &error);

  g_assert_error (error, G_DBUS_ERROR, G_DBUS_ERROR_FAILED);
  g_assert (retval == NULL);
  g_error_free (error);
}

static void
test_transfer_passwd1 (TestCase *tc,
                      gconstpointer unused)
{
  GVariant *retval;
  GVariant *prepared;
  GError *error = NULL;
  gchar *string;

  const gchar *empty[] = { NULL };

  cockpit_bridge_path_passwd = SRCDIR "/src/bridge/mock-setup/local-passwd";
  cockpit_bridge_path_group = SRCDIR "/src/bridge/mock-setup/local-group";
  cockpit_bridge_path_shadow = SRCDIR "/src/bridge/mock-setup/local-shadow";

  prepared = g_variant_new ("(@as@as)", g_variant_new_strv (empty, -1), g_variant_new_strv (empty, -1));
  retval = dbus_call_with_main_loop (tc, "/setup", "cockpit.Setup", "Transfer",
                                     g_variant_new ("(sv)", "passwd1", prepared),
                                     G_VARIANT_TYPE ("(v)"), &error);

  g_assert_no_error (error);
  string = g_variant_print (retval, FALSE);
  g_assert_cmpstr (string, ==, "(<(['root:$6$RBjDivsC$mlwBspq8QVmDe92lS/uVFiCHnw69KO.v7BQ69TE50CUMx6AKwfOZJ9gjU0y846UkQt9NrLlChu6j0z9V2//0b/:::Root:/root:/bin/bash', 'scruffy:$6$kiB.xr6x$xDzRjU5dHnwqds7Vs1iRe7NWKRI2AvK38DbGF2DIOfI9MtqHL.hDwL6GhBxEyliTGQi3FyEVR0y2pG6xuEGJ81:::Scruffy the Janitor:/home/scruffy:/bin/bash', 'hermes:$6$vK.Xvf4y$8PI2sHG7VVexATp2uyqHyhqRMeCisGL0Zer2fs.Suy4Q.eg9OWCoPGIeSDbxhOLvpfQKGorAaQIRLuVJH5uUO.:::Hermes Conrad:/home/hermes:/bin/sh'], ['docker:::hermes', 'wheel:::scruffy,hermes', 'root:::root'])>,)");
  g_free (string);
  g_variant_unref (retval);
}

static void
test_transfer_unsupported (TestCase *tc,
                           gconstpointer unused)
{
  GVariant *retval;
  GVariant *prepared;
  GError *error = NULL;

  const gchar *users[] = { "janice", "scruffy", NULL };

  prepared = g_variant_new_strv (users, -1);
  retval = dbus_call_with_main_loop (tc, "/setup", "cockpit.Setup", "Transfer",
                                     g_variant_new ("(sv)", "blah", prepared),
                                     G_VARIANT_TYPE ("(v)"), &error);

  g_assert_error (error, G_DBUS_ERROR, G_DBUS_ERROR_NOT_SUPPORTED);
  g_assert (retval == NULL);
  g_error_free (error);
}

static void
test_transfer_bad (TestCase *tc,
                           gconstpointer unused)
{
  GVariant *retval;
  GVariant *prepared;
  GError *error = NULL;

  prepared = g_variant_new_string ("blah");
  retval = dbus_call_with_main_loop (tc, "/setup", "cockpit.Setup", "Transfer",
                                     g_variant_new ("(sv)", "passwd1", prepared),
                                     G_VARIANT_TYPE ("(v)"), &error);

  g_assert_error (error, G_DBUS_ERROR, G_DBUS_ERROR_INVALID_ARGS);
  g_assert (retval == NULL);
  g_error_free (error);
}

static void
test_transfer_fail (TestCase *tc,
                    gconstpointer unused)
{
  GVariant *retval;
  GVariant *prepared;
  GError *error = NULL;

  const gchar *empty[] = { NULL };

  cockpit_bridge_path_passwd = SRCDIR "/src/bridge/mock-setup/non-existant";

  cockpit_expect_message ("unable to open*");

  prepared = g_variant_new ("(@as@as)", g_variant_new_strv (empty, -1), g_variant_new_strv (empty, -1));
  retval = dbus_call_with_main_loop (tc, "/setup", "cockpit.Setup", "Transfer",
                                     g_variant_new ("(sv)", "passwd1", prepared),
                                     G_VARIANT_TYPE ("(v)"), &error);

  g_assert_error (error, G_DBUS_ERROR, G_DBUS_ERROR_FAILED);
  g_assert (retval == NULL);
  g_error_free (error);
}

static const gchar *passwd_data[] = {
  "root:$6$RBjDivsC$mlwBspq8QVmDe92lS/uVFiCHnw69KO.v7BQ69TE50CUMx6AKwfOZJ9gjU0y846UkQt9NrLlChu6j0z9V2//0b/:::Root:/root:/bin/bash",
  "scruffy:$6$kiB.xr6x$xDzRjU5dHnwqds7Vs1iRe7NWKRI2AvK38DbGF2DIOfI9MtqHL.hDwL6GhBxEyliTGQi3FyEVR0y2pG6xuEGJ81:::Scruffy the Janitor:/home/scruffy:/bin/bash",
  "hermes:$6$vK.Xvf4y$8PI2sHG7VVexATp2uyqHyhqRMeCisGL0Zer2fs.Suy4Q.eg9OWCoPGIeSDbxhOLvpfQKGorAaQIRLuVJH5uUO.:::Hermes Conrad:/home/hermes:/bin/sh']>,)",
  NULL
};

static const gchar *group_data[] = {
  "wheel:::hermes,scruffy",
  "root:::root",
  "unsupported:::hermes,scruffy",
  "docker:::hermes",
  NULL
};

static void
test_commit_passwd1 (TestCase *tc,
                     gconstpointer unused)
{
  GVariant *retval;
  GVariant *transferred;
  GError *error = NULL;
  gchar *directory;
  gchar *string;
  gchar *contents;

  cockpit_bridge_path_passwd = SRCDIR "/src/bridge/mock-setup/remote-passwd";
  cockpit_bridge_path_newusers = SRCDIR "/src/bridge/mock-setup/newusers";
  cockpit_bridge_path_chpasswd = SRCDIR "/src/bridge/mock-setup/chpasswd";
  cockpit_bridge_path_usermod = SRCDIR "/src/bridge/mock-setup/usermod";
  cockpit_bridge_have_newusers_crypt_method = TRUE;

  directory = g_strdup ("/tmp/test-cockpit-setup.XXXXXX");
  directory = g_mkdtemp (directory);
  g_assert (directory != NULL);

  g_setenv ("MOCK_OUTPUT", directory, TRUE);

  transferred = g_variant_new ("(@as@as)",
                               g_variant_new_strv (passwd_data, -1),
                               g_variant_new_strv (group_data, -1));
  retval = dbus_call_with_main_loop (tc, "/setup", "cockpit.Setup", "Commit",
                                     g_variant_new ("(sv)", "passwd1", transferred),
                                     G_VARIANT_TYPE ("()"), &error);

  g_assert_no_error (error);
  string = g_variant_print (retval, FALSE);
  g_assert_cmpstr (string, ==, "()");
  g_free (string);
  g_variant_unref (retval);

  string = g_build_filename (directory, "newusers", NULL);
  g_assert (g_file_get_contents (string, &contents, NULL, NULL));
  g_assert_cmpstr (contents, ==, "hermes:$6$vK.Xvf4y$8PI2sHG7VVexATp2uyqHyhqRMeCisGL0Zer2fs.Suy4Q.eg9OWCoPGIeSDbxhOLvpfQKGorAaQIRLuVJH5uUO.:::Hermes Conrad:/home/hermes:/bin/sh']>,)\n");
  g_free (contents);
  g_assert (g_unlink (string) >= 0);
  g_free (string);

  string = g_build_filename (directory, "chpasswd", NULL);
  g_assert (g_file_get_contents (string, &contents, NULL, NULL));
  g_assert_cmpstr (contents, ==, "root:$6$RBjDivsC$mlwBspq8QVmDe92lS/uVFiCHnw69KO.v7BQ69TE50CUMx6AKwfOZJ9gjU0y846UkQt9NrLlChu6j0z9V2//0b/\nscruffy:$6$kiB.xr6x$xDzRjU5dHnwqds7Vs1iRe7NWKRI2AvK38DbGF2DIOfI9MtqHL.hDwL6GhBxEyliTGQi3FyEVR0y2pG6xuEGJ81\n");
  g_free (contents);
  g_assert (g_unlink (string) >= 0);
  g_free (string);

  string = g_build_filename (directory, "usermod", NULL);
  g_assert (g_file_get_contents (string, &contents, NULL, NULL));
  g_assert_cmpstr (contents, ==, "hermes --append --group wheel,docker\nroot --append --group root\nscruffy --append --group wheel\n");
  g_free (contents);
  g_assert (g_unlink (string) >= 0);
  g_free (string);

  g_assert (g_rmdir (directory) >= 0);
  g_free (directory);
}

static void
test_commit_passwd1_no_crypt_method (TestCase *tc,
                                     gconstpointer unused)
{
  GVariant *retval;
  GVariant *transferred;
  GError *error = NULL;
  gchar *directory;
  gchar *string;
  gchar *contents;

  /* Same as test_commit_passwd1, but the new password for hermes will
   * be set via chpasswd.
   */

  cockpit_bridge_path_passwd = SRCDIR "/src/bridge/mock-setup/remote-passwd";
  cockpit_bridge_path_newusers = SRCDIR "/src/bridge/mock-setup/newusers";
  cockpit_bridge_path_chpasswd = SRCDIR "/src/bridge/mock-setup/chpasswd";
  cockpit_bridge_path_usermod = SRCDIR "/src/bridge/mock-setup/usermod";
  cockpit_bridge_have_newusers_crypt_method = FALSE;

  directory = g_strdup ("/tmp/test-cockpit-setup.XXXXXX");
  directory = g_mkdtemp (directory);
  g_assert (directory != NULL);

  g_setenv ("MOCK_OUTPUT", directory, TRUE);

  transferred = g_variant_new ("(@as@as)",
                               g_variant_new_strv (passwd_data, -1),
                               g_variant_new_strv (group_data, -1));
  retval = dbus_call_with_main_loop (tc, "/setup", "cockpit.Setup", "Commit",
                                     g_variant_new ("(sv)", "passwd1", transferred),
                                     G_VARIANT_TYPE ("()"), &error);

  g_assert_no_error (error);
  string = g_variant_print (retval, FALSE);
  g_assert_cmpstr (string, ==, "()");
  g_free (string);
  g_variant_unref (retval);

  string = g_build_filename (directory, "newusers", NULL);
  g_assert (g_file_get_contents (string, &contents, NULL, NULL));
  g_assert_cmpstr (contents, ==, "hermes:$6$vK.Xvf4y$8PI2sHG7VVexATp2uyqHyhqRMeCisGL0Zer2fs.Suy4Q.eg9OWCoPGIeSDbxhOLvpfQKGorAaQIRLuVJH5uUO.:::Hermes Conrad:/home/hermes:/bin/sh']>,)\n");
  g_free (contents);
  g_assert (g_unlink (string) >= 0);
  g_free (string);

  string = g_build_filename (directory, "chpasswd", NULL);
  g_assert (g_file_get_contents (string, &contents, NULL, NULL));
  g_assert_cmpstr (contents, ==, "root:$6$RBjDivsC$mlwBspq8QVmDe92lS/uVFiCHnw69KO.v7BQ69TE50CUMx6AKwfOZJ9gjU0y846UkQt9NrLlChu6j0z9V2//0b/\nscruffy:$6$kiB.xr6x$xDzRjU5dHnwqds7Vs1iRe7NWKRI2AvK38DbGF2DIOfI9MtqHL.hDwL6GhBxEyliTGQi3FyEVR0y2pG6xuEGJ81\nhermes:$6$vK.Xvf4y$8PI2sHG7VVexATp2uyqHyhqRMeCisGL0Zer2fs.Suy4Q.eg9OWCoPGIeSDbxhOLvpfQKGorAaQIRLuVJH5uUO.\n");
  g_free (contents);
  g_assert (g_unlink (string) >= 0);
  g_free (string);

  string = g_build_filename (directory, "usermod", NULL);
  g_assert (g_file_get_contents (string, &contents, NULL, NULL));
  g_assert_cmpstr (contents, ==, "hermes --append --group wheel,docker\nroot --append --group root\nscruffy --append --group wheel\n");
  g_free (contents);
  g_assert (g_unlink (string) >= 0);
  g_free (string);

  g_assert (g_rmdir (directory) >= 0);
  g_free (directory);
}

static void
test_commit_fail_newusers (TestCase *tc,
                           gconstpointer unused)
{
  GVariant *retval;
  GVariant *transferred;
  GError *error = NULL;
  gchar *directory;

  cockpit_expect_message ("couldn't run newusers command*");

  cockpit_bridge_path_passwd = SRCDIR "/src/bridge/mock-setup/remote-passwd";
  cockpit_bridge_path_newusers = "/bin/false";
  cockpit_bridge_path_chpasswd = SRCDIR "/src/bridge/mock-setup/chpasswd";

  directory = g_strdup ("/tmp/test-cockpit-setup.XXXXXX");
  directory = g_mkdtemp (directory);
  g_assert (directory != NULL);

  g_setenv ("MOCK_OUTPUT", directory, TRUE);

  transferred = g_variant_new ("(@as@as)",
                               g_variant_new_strv (passwd_data, -1),
                               g_variant_new_strv (group_data, -1));
  retval = dbus_call_with_main_loop (tc, "/setup", "cockpit.Setup", "Commit",
                                     g_variant_new ("(sv)", "passwd1", transferred),
                                     G_VARIANT_TYPE ("()"), &error);

  g_assert_error (error, G_DBUS_ERROR, G_DBUS_ERROR_FAILED);
  g_assert (retval == NULL);
  g_error_free (error);

  g_assert (g_rmdir (directory) >= 0);
  g_free (directory);
}

static void
test_commit_fail_chpasswd (TestCase *tc,
                           gconstpointer unused)
{
  GVariant *retval;
  GVariant *transferred;
  GError *error = NULL;
  gchar *directory;
  gchar *string;

  cockpit_expect_message ("couldn't run chpasswd command*");

  cockpit_bridge_path_passwd = SRCDIR "/src/bridge/mock-setup/remote-passwd";
  cockpit_bridge_path_chpasswd = "/bin/false";
  cockpit_bridge_path_newusers = SRCDIR "/src/bridge/mock-setup/newusers";
  cockpit_bridge_have_newusers_crypt_method = TRUE;

  directory = g_strdup ("/tmp/test-cockpit-setup.XXXXXX");
  directory = g_mkdtemp (directory);
  g_assert (directory != NULL);

  g_setenv ("MOCK_OUTPUT", directory, TRUE);

  transferred = g_variant_new ("(@as@as)",
                               g_variant_new_strv (passwd_data, -1),
                               g_variant_new_strv (group_data, -1));
  retval = dbus_call_with_main_loop (tc, "/setup", "cockpit.Setup", "Commit",
                                     g_variant_new ("(sv)", "passwd1", transferred),
                                     G_VARIANT_TYPE ("()"), &error);

  g_assert_error (error, G_DBUS_ERROR, G_DBUS_ERROR_FAILED);
  g_assert (retval == NULL);
  g_error_free (error);

  string = g_build_filename (directory, "newusers", NULL);
  g_unlink (string);
  g_free (string);

  g_assert (g_rmdir (directory) >= 0);
  g_free (directory);
}


static void
test_commit_unsupported (TestCase *tc,
                         gconstpointer unused)
{
  GVariant *retval;
  GVariant *transferred;
  GError *error = NULL;

  const gchar *data[] = { "one", "two", NULL };

  transferred = g_variant_new_strv (data, -1);
  retval = dbus_call_with_main_loop (tc, "/setup", "cockpit.Setup", "Commit",
                                     g_variant_new ("(sv)", "blah", transferred),
                                     G_VARIANT_TYPE ("(v)"), &error);

  g_assert_error (error, G_DBUS_ERROR, G_DBUS_ERROR_NOT_SUPPORTED);
  g_assert (retval == NULL);
  g_error_free (error);
}

static void
test_commit_bad (TestCase *tc,
                 gconstpointer unused)
{
  GVariant *retval;
  GVariant *transferred;
  GError *error = NULL;

  transferred = g_variant_new_string ("blah");
  retval = dbus_call_with_main_loop (tc, "/setup", "cockpit.Setup", "Commit",
                                     g_variant_new ("(sv)", "passwd1", transferred),
                                     G_VARIANT_TYPE ("()"), &error);

  g_assert_error (error, G_DBUS_ERROR, G_DBUS_ERROR_INVALID_ARGS);
  g_assert (retval == NULL);
  g_error_free (error);
}

static void
test_commit_fail_passwd (TestCase *tc,
                         gconstpointer unused)
{
  GVariant *retval;
  GVariant *transferred;
  GError *error = NULL;

  const gchar *empty[] = { NULL };

  cockpit_bridge_path_passwd = SRCDIR "/src/bridge/mock-setup/non-existant";

  cockpit_expect_message ("unable to open*");

  transferred = g_variant_new ("(@as@as)", g_variant_new_strv (empty, -1), g_variant_new_strv (empty, -1));
  retval = dbus_call_with_main_loop (tc, "/setup", "cockpit.Setup", "Commit",
                                     g_variant_new ("(sv)", "passwd1", transferred),
                                     G_VARIANT_TYPE ("(v)"), &error);

  g_assert_error (error, G_DBUS_ERROR, G_DBUS_ERROR_FAILED);
  g_assert (retval == NULL);
  g_error_free (error);
}

int
main (int argc,
      char *argv[])
{
  cockpit_test_init (&argc, &argv);

  g_test_add ("/setup/get-properties", TestCase, NULL,
              setup, test_get_properties, teardown);

  g_test_add ("/setup/prepare/passwd1", TestCase, NULL,
              setup, test_prepare_passwd1, teardown);
  g_test_add ("/setup/prepare/unsupported", TestCase, NULL,
              setup, test_prepare_unsupported, teardown);
  g_test_add ("/setup/prepare/fail", TestCase, NULL,
              setup, test_prepare_fail, teardown);

  g_test_add ("/setup/transfer/passwd1", TestCase, NULL,
              setup, test_transfer_passwd1, teardown);
  g_test_add ("/setup/transfer/unsupported", TestCase, NULL,
              setup, test_transfer_unsupported, teardown);
  g_test_add ("/setup/transfer/bad", TestCase, NULL,
              setup, test_transfer_bad, teardown);
  g_test_add ("/setup/transfer/fail", TestCase, NULL,
              setup, test_transfer_fail, teardown);

  g_test_add ("/setup/commit/passwd1", TestCase, NULL,
              setup, test_commit_passwd1, teardown);
  g_test_add ("/setup/commit/passwd1-no-crypt-method", TestCase, NULL,
              setup, test_commit_passwd1_no_crypt_method, teardown);
  g_test_add ("/setup/commit/unsupported", TestCase, NULL,
              setup, test_commit_unsupported, teardown);
  g_test_add ("/setup/commit/bad", TestCase, NULL,
              setup, test_commit_bad, teardown);
  g_test_add ("/setup/commit/fail-passwd", TestCase, NULL,
              setup, test_commit_fail_passwd, teardown);
  g_test_add ("/setup/commit/fail-newusers", TestCase, NULL,
              setup, test_commit_fail_newusers, teardown);
  g_test_add ("/setup/commit/fail-chpasswd", TestCase, NULL,
              setup, test_commit_fail_chpasswd, teardown);

  return g_test_run ();
}
