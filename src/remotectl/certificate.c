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

#include "common/cockpitcertificate.h"

#include <glib.h>

#include <sys/stat.h>
#include <sys/types.h>
#include <errno.h>
#include <grp.h>
#include <pwd.h>

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
ensure_certificate (const gchar *user,
                    const gchar *group,
                    const gchar *selinux)
{
  struct passwd *pwd = NULL;
  struct group *gr = NULL;
  GTlsCertificate *certificate = NULL;
  GError *error = NULL;
  gchar *path = NULL;
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

  path = cockpit_certificate_locate (TRUE, &error);
  if (path != NULL)
    certificate = cockpit_certificate_load (path, &error);

  if (!certificate)
    {
      g_message ("%s", error->message);
      goto out;
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
          goto out;
        }
    }

  ret = 0;

out:
  g_clear_object (&certificate);
  g_clear_error (&error);
  g_free (path);
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
    { G_OPTION_REMAINING, 0, G_OPTION_FLAG_HIDDEN, G_OPTION_ARG_CALLBACK,
      cockpit_remotectl_no_arguments, NULL, NULL },
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
      if (ensure)
        ret = ensure_certificate (user, group, selinux);
      else
        ret = locate_certificate ();
    }

  g_option_context_free (context);
  g_clear_error (&error);
  g_free (selinux);
  g_free (group);
  g_free (user);
  return ret;
}
