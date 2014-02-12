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

#include <pwd.h>
#include <grp.h>

#include "gsystem-local-alloc.h"
#include "auth.h"
#include "daemon.h"

static struct passwd *
getpwuid_a (uid_t uid,
            int *errp)
{
  int err;
  long bufsize = sysconf (_SC_GETPW_R_SIZE_MAX);
  struct passwd *ret = NULL;
  struct passwd *buf;

  g_return_val_if_fail (bufsize >= 0, NULL);

  buf = malloc (sizeof(struct passwd) + bufsize);
  if (buf == NULL)
    err = ENOMEM;
  else
    err = getpwuid_r (uid, buf, (char *)(buf + 1), bufsize, &ret);

  if (ret == NULL)
    {
      free (buf);
      if (err == 0)
        err = ENOENT;
    }

  if (errp)
    *errp = err;
  return ret;
}

static struct group *
getgrnam_a (const gchar *group,
            int *errp)
{
  int err;
  long bufsize = sysconf (_SC_GETGR_R_SIZE_MAX);
  struct group *ret = NULL;
  struct group *buf;

  g_return_val_if_fail (bufsize >= 0, NULL);

  buf = malloc (sizeof(struct group) + bufsize);
  if (buf == NULL)
    err = ENOMEM;
  else
    err = getgrnam_r (group, buf, (char *)(buf + 1), bufsize, &ret);

  if (ret == NULL)
    {
      free (buf);
      if (err == 0)
        err = ENOENT;
    }

  if (errp)
    *errp = err;
  return ret;
}

static gid_t *
getgrouplist_a (const char *user,
                int gid,
                int *n_groupsp,
                int *errp)
{
  int err, n_groups;
  gid_t *buf;

  n_groups = 200;
  buf = malloc ((n_groups + 1) * sizeof (gid_t));
  if (buf == NULL)
    err = ENOMEM;
  else
    {
      // Super paranoid: The user might have been added to more groups
      // since the last call and thus getgrouplist can fail more than
      // once because of insufficent space.

      int tries = 0;
      err = 0;
      while (getgrouplist (user, gid, buf, &n_groups) == -1)
        {
          buf = realloc (buf, (n_groups + 1) * sizeof (gid_t));
          if (buf == NULL)
            {
              err = ENOMEM;
              break;
            }

          tries += 1;
          if (tries > 5)
            {
              err = EIO;
              break;
            }
        }

      if (err == 0)
        buf[n_groups] = (gid_t)-1;
      else
        {
          free (buf);
          buf = NULL;
        }
    }

  if (errp)
    *errp = err;
  if (n_groupsp)
    *n_groupsp = n_groups;
  return buf;
}

gboolean
auth_uid_is_wheel (uid_t uid)
{
  gs_free struct passwd *pw = getpwuid_a (uid, NULL);
  if (pw == NULL)
    return FALSE;

  gs_free struct group *gr = getgrnam_a ("wheel", NULL);
  if (gr == NULL)
    return FALSE;

  int n_groups;
  gs_free gid_t *gids = getgrouplist_a (pw->pw_name, pw->pw_gid, &n_groups, NULL);
  if (gids == NULL)
    return FALSE;

  for (int i = 0; i < n_groups; i++)
    if (gids[i] == gr->gr_gid)
      return TRUE;

  return FALSE;
}

gboolean
auth_check_uid_role (GDBusMethodInvocation *invocation,
                     uid_t uid,
                     const gchar *role)
{
  int err = 0;
  gs_free struct passwd *pw = NULL;
  gs_free struct group *wheel_gr = NULL;
  gs_free struct group *role_gr = NULL;
  gs_free gid_t *gids = NULL;

  if (uid == 0)
    return TRUE;

  pw = getpwuid_a (uid, &err);
  if (pw == NULL)
    goto error;

  wheel_gr = getgrnam_a ("wheel", NULL);
  role_gr = role ? getgrnam_a (role, NULL) : NULL;

  int n_groups;
  gids = getgrouplist_a (pw->pw_name, pw->pw_gid, &n_groups, &err);
  if (gids == NULL)
    goto error;

  for (int i = 0; i < n_groups; i++)
    if ((wheel_gr && gids[i] == wheel_gr->gr_gid)
        || (role_gr && gids[i] == role_gr->gr_gid))
      return TRUE;

error:
  if (err)
    g_dbus_method_invocation_return_error (invocation,
                                           COCKPIT_ERROR, COCKPIT_ERROR_FAILED,
                                           "%s", strerror(err));
  else
    g_dbus_method_invocation_return_error (invocation,
                                           G_DBUS_ERROR, G_DBUS_ERROR_ACCESS_DENIED,
                                           "Method %s.%s needs role '%s'",
                                           g_dbus_method_invocation_get_interface_name (invocation),
                                           g_dbus_method_invocation_get_method_name (invocation),
                                           role ? role : "wheel");
  return FALSE;
}

gboolean
auth_check_sender_role (GDBusMethodInvocation *invocation,
                        const gchar *role)
{
  uid_t peer;
  if (!daemon_get_sender_uid (daemon_get (), invocation, &peer))
    return FALSE;
  if (!auth_check_uid_role (invocation, peer, role))
    return FALSE;
  return TRUE;
}
