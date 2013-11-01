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

#include <string.h>
#include <stdio.h>
#include <act/act.h>
#include <glib.h>
#include <glib/gstdio.h>

#include "libgsystem.h"

#include "daemon.h"
#include "auth.h"
#include "account.h"

#include <cockpit/cockpit.h>

typedef struct _AccountClass AccountClass;

struct _Account
{
  CockpitAccountSkeleton parent_instance;

  ActUser *u;
};

struct _AccountClass
{
  CockpitAccountSkeletonClass parent_class;
};

static void account_iface_init (CockpitAccountIface *iface);

G_DEFINE_TYPE_WITH_CODE (Account, account, COCKPIT_TYPE_ACCOUNT_SKELETON,
                         G_IMPLEMENT_INTERFACE (COCKPIT_TYPE_ACCOUNT, account_iface_init));

static void
account_finalize (GObject *object)
{
  if (G_OBJECT_CLASS (account_parent_class)->finalize != NULL)
    G_OBJECT_CLASS (account_parent_class)->finalize (object);
}

static void
account_init (Account *account)
{
}

static void
account_constructed (GObject *_object)
{
  if (G_OBJECT_CLASS (account_parent_class)->constructed != NULL)
    G_OBJECT_CLASS (account_parent_class)->constructed (_object);
}

static void
account_class_init (AccountClass *klass)
{
  GObjectClass *gobject_class;

  gobject_class = G_OBJECT_CLASS (klass);
  gobject_class->finalize     = account_finalize;
  gobject_class->constructed  = account_constructed;
}

CockpitAccount *
account_new ()
{
  return COCKPIT_ACCOUNT (g_object_new (TYPE_ACCOUNT, NULL));
}

void
account_update (Account *acc,
                ActUser *user)
{
  acc->u = user;
  if (user)
    {
      cockpit_account_set_user_name (COCKPIT_ACCOUNT (acc), act_user_get_user_name (user));
      cockpit_account_set_real_name (COCKPIT_ACCOUNT (acc), act_user_get_real_name (user));
      cockpit_account_set_locked (COCKPIT_ACCOUNT (acc), act_user_get_locked (user));
      cockpit_account_set_last_login (COCKPIT_ACCOUNT (acc), act_user_get_login_time (user));
      cockpit_account_set_logged_in (COCKPIT_ACCOUNT (acc), act_user_is_logged_in_anywhere (user));
      cockpit_account_set_groups (COCKPIT_ACCOUNT (acc), act_user_get_groups (user));
      cockpit_account_emit_changed (COCKPIT_ACCOUNT (acc));
    }
}

static gboolean
account_auth_check (CockpitAccount *object,
                    GDBusMethodInvocation *invocation,
                    Account *acc)
{
  uid_t peer;
  if (!daemon_get_sender_uid (daemon_get (), invocation, &peer))
    return FALSE;
  if (acc->u && act_user_get_uid (acc->u) == peer)
    return TRUE;
  if (!auth_check_uid_role (invocation, peer, COCKPIT_ROLE_USER_ADMIN))
    return FALSE;
  return TRUE;
}

static gboolean
handle_get_icon_data_url (CockpitAccount *object,
                          GDBusMethodInvocation *invocation)
{
  Account *acc = ACCOUNT (object);
  gs_free gchar *raw_data = NULL;
  gsize raw_size;
  gs_free gchar *base64_data = NULL;
  gs_free gchar *data = NULL;

  if (acc->u == NULL)
    goto out;

  const gchar *icon_file = act_user_get_icon_file (acc->u);
  if (icon_file == NULL)
    goto out;

  if (!g_file_get_contents (icon_file, &raw_data, &raw_size, NULL))
    goto out;

  base64_data = g_base64_encode ((guchar *)raw_data, raw_size);
  data = g_strdup_printf ("data:image/png;base64,%s", base64_data);

out:
  cockpit_account_complete_get_icon_data_url (object, invocation, data? data : "");
  return TRUE;
}

static gboolean
handle_set_icon_data_url (CockpitAccount *object,
                          GDBusMethodInvocation *invocation,
                          const gchar *arg_data)
{
  GError *error = NULL;
  Account *acc = ACCOUNT (object);

  if (!account_auth_check (object, invocation, acc))
    return TRUE;

  if (acc->u)
    {
      const gchar *base64_data = strstr (arg_data, "base64,");
      if (base64_data == NULL)
        goto out;

      base64_data += strlen ("base64,");

      gsize raw_size;
      gs_free gchar *raw_data = (gchar *)g_base64_decode (base64_data, &raw_size);

      gs_unref_object GFileIOStream *tmp_stream = NULL;
      gs_unref_object GFile *tmp_file = g_file_new_tmp ("cockpit-user-icon-XXXXXX", &tmp_stream, &error);

      if (tmp_file == NULL)
        goto out;

      GOutputStream *out = g_io_stream_get_output_stream (G_IO_STREAM (tmp_stream));
      if (!g_output_stream_write_all (out, raw_data, raw_size, NULL, NULL, &error))
        goto out;

      if (!g_io_stream_close (G_IO_STREAM (tmp_stream), NULL, &error))
        goto out;

      gs_free gchar *tmp_path = g_file_get_path (tmp_file);
      act_user_set_icon_file (acc->u, tmp_path);
      g_file_delete (tmp_file, NULL, NULL);
    }

out:
  if (error)
    {
      g_dbus_method_invocation_return_error (invocation,
                                             COCKPIT_ERROR, COCKPIT_ERROR_FAILED,
                                             "%s", error->message);
      g_clear_error (&error);
    }
  else
    cockpit_account_complete_set_icon_data_url (object, invocation);
  return TRUE;
}

static gboolean
handle_set_real_name (CockpitAccount *object,
                      GDBusMethodInvocation *invocation,
                      const gchar *arg_value)
{
  Account *acc = ACCOUNT (object);

  if (!account_auth_check (object, invocation, acc))
    return TRUE;

  if (acc->u)
    act_user_set_real_name (acc->u, arg_value);

  cockpit_account_complete_set_real_name (object, invocation);
  return TRUE;
}

static gboolean
handle_set_password (CockpitAccount *object,
                     GDBusMethodInvocation *invocation,
                     const gchar *arg_password)
{
  Account *acc = ACCOUNT (object);

  if (!account_auth_check (object, invocation, acc))
    return TRUE;

  if (acc->u)
    {
      act_user_set_password_mode (acc->u, ACT_USER_PASSWORD_MODE_REGULAR);
      act_user_set_password (acc->u, arg_password, "");
    }

  cockpit_account_complete_set_password (object, invocation);
  return TRUE;
}

static gboolean
handle_set_locked (CockpitAccount *object,
                   GDBusMethodInvocation *invocation,
                   gboolean arg_locked)
{
  Account *acc = ACCOUNT (object);

  if (!auth_check_sender_role (invocation, COCKPIT_ROLE_USER_ADMIN))
    return TRUE;

  if (acc->u)
    act_user_set_locked (acc->u, arg_locked);

  cockpit_account_complete_set_locked (object, invocation);
  return TRUE;
}

static gboolean
handle_change_groups (CockpitAccount *object,
                      GDBusMethodInvocation *invocation,
                      const gchar *const *arg_add,
                      const gchar *const *arg_remove)
{
  Account *acc = ACCOUNT (object);

  if (!auth_check_sender_role (invocation, COCKPIT_ROLE_USER_ADMIN))
    return TRUE;

  if (acc->u)
    act_user_change_groups (acc->u, arg_add, arg_remove);

  cockpit_account_complete_change_groups (object, invocation);
  return TRUE;
}

typedef struct {
  CockpitAccount *object;
  GDBusMethodInvocation *invocation;
} CallData;

static void
delete_account_done (ActUserManager *manager,
                     GAsyncResult *res,
                     CallData *data)
{
  CockpitAccount *object = data->object;
  GDBusMethodInvocation *invocation = data->invocation;
  g_free (data);

  GError *error = NULL;
  gboolean success = act_user_manager_delete_user_finish (manager, res, &error);
  if (!success)
    {
      g_dbus_method_invocation_return_error (invocation,
                                             COCKPIT_ERROR, COCKPIT_ERROR_FAILED,
                                             "Failed to delete user account: %s", error->message);
      g_error_free (error);
      return;
    }

  cockpit_account_complete_delete (object, invocation);
}

static gboolean
handle_delete (CockpitAccount *object,
               GDBusMethodInvocation *invocation,
               gboolean remove_files)
{
  Account *acc = ACCOUNT (object);

  if (!auth_check_sender_role (invocation, COCKPIT_ROLE_USER_ADMIN))
    return TRUE;

  if (acc->u)
    {
      CallData *data = g_new0 (CallData, 1);
      data->object = object;
      data->invocation = invocation;

      act_user_manager_delete_user_async (act_user_manager_get_default (),
                                          acc->u,
                                          remove_files,
                                          NULL,
                                          (GAsyncReadyCallback)delete_account_done,
                                          data);
      return TRUE;
    }

  cockpit_account_complete_delete (object, invocation);
  return TRUE;
}

static gboolean
handle_kill_sessions (CockpitAccount *object,
                      GDBusMethodInvocation *invocation)
{
  Account *acc = ACCOUNT (object);
  GError *error = NULL;

  if (!auth_check_sender_role (invocation, COCKPIT_ROLE_USER_ADMIN))
    return TRUE;

  if (acc->u)
    {
      gs_unref_object GDBusConnection *bus = g_bus_get_sync (G_BUS_TYPE_SYSTEM,
                                                             NULL,
                                                             &error);
      if (bus == NULL)
        goto out;

      gs_unref_variant GVariant *result =
        g_dbus_connection_call_sync (bus,
                                     "org.freedesktop.login1",
                                     "/org/freedesktop/login1",
                                     "org.freedesktop.login1.Manager",
                                     "KillUser",
                                     g_variant_new ("(ui)",
                                                    act_user_get_uid (acc->u),
                                                    SIGTERM),
                                     NULL,
                                     0,
                                     -1,
                                     NULL,
                                     &error);
    }

out:
  if (error)
    {
      g_dbus_method_invocation_return_error (invocation,
                                             COCKPIT_ERROR, COCKPIT_ERROR_FAILED,
                                             "Failed to kill sessions: %s", error->message);
      g_error_free (error);
    }
  else
    cockpit_account_complete_kill_sessions (object, invocation);

  return TRUE;
}

static void
account_iface_init (CockpitAccountIface *iface)
{
  iface->handle_get_icon_data_url = handle_get_icon_data_url;
  iface->handle_set_icon_data_url = handle_set_icon_data_url;
  iface->handle_set_real_name = handle_set_real_name;
  iface->handle_set_password = handle_set_password;
  iface->handle_set_locked = handle_set_locked;
  iface->handle_change_groups = handle_change_groups;
  iface->handle_delete = handle_delete;
  iface->handle_kill_sessions = handle_kill_sessions;
}
