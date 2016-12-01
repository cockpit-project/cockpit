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

#include "remotectl.h"

#include "cockpitcertificate.h"

#include "common/cockpitconf.h"

#include <glib.h>
#include <glib/gstdio.h>

#include <sys/stat.h>
#include <sys/types.h>
#include <errno.h>
#include <grp.h>
#include <pwd.h>
#include <string.h>

static int
locate_certificate (void)
{
  GTlsCertificate *certificate = NULL;
  gchar *path = NULL;
  GError *error = NULL;
  int ret = 1;

  path = cockpit_certificate_locate (FALSE, &error);
  if (path != NULL)
    certificate = cockpit_certificate_load (path, &error);

  if (certificate)
    {
      g_print ("certificate: %s\n", path);
      g_object_unref (certificate);
      ret = 0;
    }
  else
    {
      g_message ("%s", error->message);
      g_error_free (error);
    }

  g_free (path);
  return ret;
}

static int
set_cert_attributes (const gchar *path,
                     const gchar *user,
                     const gchar *group,
                     const gchar *selinux)
{
  GError *error = NULL;
  struct passwd *pwd = NULL;
  struct group *gr = NULL;
  gint status = 0;
  mode_t mode;
  int ret = 1;

  const gchar *chcon_argv[] = {
    PATH_CHCON,
    "--type",
    selinux,
    "path-here",
    NULL
  };

  if (!user)
    user = "root";
  if (g_strcmp0 (group, "") == 0)
    group = NULL;

  /* Resolve the user and group */
  pwd = getpwnam (user);
  if (pwd == NULL)
    {
      g_message ("couldn't lookup user: %s: %s", user, g_strerror (errno));
      goto out;
    }
  if (group)
    {
      gr = getgrnam (group);
      if (gr == NULL)
        {
          g_message ("couldn't lookup group: %s: %s", group, g_strerror (errno));
          goto out;
        }
    }

  /* If group specified then group readable */
  mode = S_IRUSR | S_IWUSR;
  if (gr)
    mode |= S_IRGRP;
  if (chmod (path, mode) < 0)
    {
      g_message ("couldn't set certificate permissions: %s: %s", path, g_strerror (errno));
      goto out;
    }
  if (chown (path, pwd->pw_uid, gr ? gr->gr_gid : 0) < 0)
    {
      g_message ("couldn't set certificate ownership: %s: %s", path, g_strerror (errno));
      goto out;
    }

  if (g_strcmp0 (selinux, "") == 0)
    selinux = NULL;
  if (selinux)
    {
      chcon_argv[3] = path;
      g_spawn_sync (NULL, (gchar **)chcon_argv, NULL, G_SPAWN_DEFAULT, NULL, NULL, NULL, NULL, &status, &error);
      if (!error)
        g_spawn_check_exit_status (status, &error);
      if (error)
        {
          g_message ("couldn't change SELinux type context '%s' for certificate: %s: %s",
                     selinux, path, error->message);
          /* keep going, don't fail hard here */
        }
    }

  ret = 0;

out:
  g_clear_error (&error);
  return ret;
}

static int
ensure_certificate (const gchar *user,
                    const gchar *group,
                    const gchar *selinux)
{
  GError *error = NULL;
  GTlsCertificate *certificate = NULL;
  gchar *path = NULL;
  gint ret = 1;

  path = cockpit_certificate_locate (TRUE, &error);
  if (path != NULL)
    certificate = cockpit_certificate_load (path, &error);

  if (!certificate)
    {
      g_message ("%s", error->message);
      goto out;
    }

  ret = set_cert_attributes (path, user, group, selinux);

out:
  g_clear_object (&certificate);
  g_clear_error (&error);
  g_free (path);
  return ret;
}

static gint
cockpit_certificate_combine (gchar **pem_files,
                             const gchar *user,
                             const gchar *group,
                             const gchar *selinux)
{
  const gchar * const* dirs = cockpit_conf_get_dirs ();

  GError *error = NULL;
  GTlsCertificate *certificate = NULL;
  GString *combined = g_string_new ("");

  gchar *cert_dir = NULL;
  gchar *name = NULL;
  gchar *spot = NULL;

  gchar *target_name = NULL;
  gchar *target_path = NULL;

  gint ret = 1;
  gint i;

  cert_dir = g_build_filename (dirs[0], "cockpit", "ws-certs.d", NULL);
  if (g_mkdir_with_parents (cert_dir, 0700) != 0)
    {
      g_message ("Error creating directory %s: %m", cert_dir);
      goto out;
    }

  /* target file is named after the first file */
  name = g_path_get_basename (pem_files[0]);
  spot = strrchr (name, '.');
  if (spot != NULL)
    *spot = '\0';

  target_name = g_strdup_printf ("%s.cert", name);
  target_path = g_build_filename (cert_dir, target_name, NULL);

  for (i = 0; pem_files[i] != NULL; i++)
    {
      gchar *data = NULL;
      gsize length;
      gboolean success = g_file_get_contents (pem_files[i], &data, &length, &error);

      if (success)
        g_string_append_printf (combined, "%s\n", data);

      g_free (data);

      if (!success)
        goto out;
    }

  if (!g_file_set_contents (target_path, combined->str, combined->len, &error))
    goto out;

  g_debug ("Wrote to combined file %s", target_path);

  certificate = cockpit_certificate_load (target_path, &error);
  if (!certificate)
    {
      if (g_unlink (target_path) < 0)
        g_message ("Failed to delete invalid certificate %s: %m", target_path);
      goto out;
    }
  else
    {
      g_print ("generated combined certificate file: %s\n", target_path);
    }

  ret = set_cert_attributes (target_path, user, group, selinux);

out:
  if (error)
    {
      g_message ("Error combining PEM files: %s", error->message);
      g_clear_error (&error);
    }

  g_clear_object (&certificate);
  g_string_free (combined, TRUE);
  g_free (name);
  g_free (target_path);
  g_free (target_name);
  g_free (cert_dir);
  return ret;
}

int
cockpit_remotectl_certificate (int argc,
                               char *argv[])
{
  GOptionContext *context;
  GError *error = NULL;
  gboolean ensure = FALSE;
  gchar *selinux = NULL;
  gchar **pem_files = NULL;
  gchar *group = NULL;
  gchar *user = NULL;
  int ret = 1;

  const GOptionEntry options[] = {
    { "ensure", 0, 0, G_OPTION_ARG_NONE, &ensure,
      "Ensure that a certificate exists and can be loaded", NULL },
    { "user", 0, 0, G_OPTION_ARG_STRING, &user,
      "The unix user that should own the certificate", "name" },
    { "group", 0, 0, G_OPTION_ARG_STRING, &group,
      "The unix group that should read the certificate", "group" },
    { "selinux-type", 0, 0, G_OPTION_ARG_STRING, &selinux,
      "The SELinux security context type for the certificate", "selinux" },
    { G_OPTION_REMAINING, 0, 0, G_OPTION_ARG_FILENAME_ARRAY, &pem_files,
      "If provided the given files are combined into a single .cert file and placed in the correct location", "[PEM-FILES..]" },
    { NULL },
  };


  context = g_option_context_new (NULL);
  g_option_context_add_main_entries (context, options, NULL);
  g_option_context_set_help_enabled (context, TRUE);

  g_set_prgname ("remotectl certificate");
  if (!g_option_context_parse (context, &argc, &argv, &error))
    {
      g_message ("%s", error->message);
      ret = 2;
    }
  else
    {
      g_set_prgname ("remotectl");
      if (pem_files)
        ret = cockpit_certificate_combine (pem_files, user, group, selinux);
      else if (ensure)
        ret = ensure_certificate (user, group, selinux);
      else
        ret = locate_certificate ();
    }

  g_option_context_free (context);
  g_clear_error (&error);
  g_free (selinux);
  g_free (group);
  g_free (user);
  g_strfreev (pem_files);
  return ret;
}
