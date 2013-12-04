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

#include "libgsystem.h"

#include "utils.h"
#include "daemon.h"
#include "auth.h"
#include "accounts.h"
#include "account.h"

#include <cockpit/cockpit.h>

typedef struct _AccountsClass AccountsClass;

struct _Accounts {
  CockpitAccountsSkeleton parent_instance;

  ActUserManager *um;
  GHashTable *act_user_to_account;

  GFileMonitor *etc_group_monitor;
};

struct _AccountsClass {
  CockpitAccountsSkeletonClass parent_class;
};

static void accounts_iface_init (CockpitAccountsIface *iface);

G_DEFINE_TYPE_WITH_CODE (Accounts, accounts, COCKPIT_TYPE_ACCOUNTS_SKELETON,
                         G_IMPLEMENT_INTERFACE (COCKPIT_TYPE_ACCOUNTS, accounts_iface_init));

static void
user_added (ActUserManager *um,
            ActUser *user,
            Accounts *accounts)
{
  if (act_user_is_system_account (user))
    return;

  GDBusObjectManagerServer *object_manager_server = daemon_get_object_manager (daemon_get ());

  CockpitAccount *acc = account_new ();
  account_update (ACCOUNT (acc), user);

  gs_free gchar *path =
    utils_generate_object_path ("/com/redhat/Cockpit/Accounts",
                                cockpit_account_get_user_name (acc));
  gs_unref_object CockpitObjectSkeleton *obj = cockpit_object_skeleton_new (path);
  cockpit_object_skeleton_set_account (obj, acc);
  g_dbus_object_manager_server_export_uniquely (object_manager_server,
                                                G_DBUS_OBJECT_SKELETON (obj));

  g_hash_table_insert (accounts->act_user_to_account, user, ACCOUNT(acc));
}

static void
user_removed (ActUserManager *um,
              ActUser *user,
              Accounts *accounts)
{
  GDBusObjectManagerServer *object_manager_server = daemon_get_object_manager (daemon_get ());

  Account *acc = g_hash_table_lookup (accounts->act_user_to_account, user);
  if (acc)
    {
      account_update (acc, NULL);
      g_dbus_object_manager_server_unexport (object_manager_server,
         g_dbus_object_get_object_path (g_dbus_interface_get_object (G_DBUS_INTERFACE (acc))));
      g_hash_table_remove (accounts->act_user_to_account, user);
    }
}

static void
user_changed (ActUserManager *um,
              ActUser *user,
              Accounts *accounts)
{
  Account *acc = g_hash_table_lookup (accounts->act_user_to_account, user);
  if (acc)
    account_update (acc, user);
}

static void
users_loaded (ActUserManager *manager,
              GParamSpec *pspec,
              Accounts *accounts)
{
  if (act_user_manager_no_service (manager))
    g_warning ("Can't contact accountsservice");

  GSList *list = act_user_manager_list_users (accounts->um);

  g_signal_connect (accounts->um, "user-changed", G_CALLBACK (user_changed), accounts);
  g_signal_connect (accounts->um, "user-is-logged-in-changed", G_CALLBACK (user_changed), accounts);
  g_signal_connect (accounts->um, "user-added", G_CALLBACK (user_added), accounts);
  g_signal_connect (accounts->um, "user-removed", G_CALLBACK (user_removed), accounts);

  for (GSList *l = list; l; l = l->next)
    {
      ActUser *user = l->data;
      user_added (accounts->um, user, accounts);
    }
  g_slist_free (list);
}

static void
accounts_update_users (Accounts *accounts)
{
  GHashTableIter iter;
  gpointer key, value;

  g_hash_table_iter_init (&iter, accounts->act_user_to_account);
  while (g_hash_table_iter_next (&iter, &key, &value))
    {
      ActUser *user = key;
      Account *acc = value;
      account_update (acc, user);
    }
}

static void
on_etc_group_changed (GFileMonitor *monitor,
                      GFile *file,
                      GFile *other_file,
                      GFileMonitorEvent *event,
                      gpointer user_data)
{
  Accounts *accounts = user_data;
  accounts_update_users (accounts);
}

static void
accounts_finalize (GObject *object)
{
  Accounts *accounts = ACCOUNTS (object);
  g_hash_table_unref (accounts->act_user_to_account);

  g_clear_object (&accounts->etc_group_monitor);

  if (G_OBJECT_CLASS (accounts_parent_class)->finalize != NULL)
    G_OBJECT_CLASS (accounts_parent_class)->finalize (object);
}

static void
accounts_init (Accounts *accounts)
{
  accounts->act_user_to_account = g_hash_table_new_full (g_direct_hash,
                                                         g_direct_equal,
                                                         NULL,
                                                         g_object_unref);
  accounts->um = act_user_manager_get_default ();

  gboolean loaded;
  g_object_get (accounts->um, "is-loaded", &loaded, NULL);
  if (loaded)
    users_loaded (accounts->um, NULL, accounts);
  else
    g_signal_connect (accounts->um, "notify::is-loaded", G_CALLBACK (users_loaded), accounts);

  gs_unref_object GFile *etc_group = g_file_new_for_path ("/etc/group");
  accounts->etc_group_monitor = g_file_monitor (etc_group, G_FILE_MONITOR_NONE, NULL, NULL);
  if (accounts->etc_group_monitor)
    g_signal_connect (accounts->etc_group_monitor, "changed",
                      G_CALLBACK (on_etc_group_changed), accounts);

  /* A "role" is a POSIX group plus localized descriptions.
     Eventually, this will be configurable by dropping files into a
     directory, but for now we just hard code some to get started.
  */

  GVariantBuilder roles_builder;
  g_variant_builder_init (&roles_builder, G_VARIANT_TYPE ("a(ss)"));
  g_variant_builder_add (&roles_builder, "(ss)",
                         COCKPIT_ROLE_ADMIN, "Server Administrator");
  g_variant_builder_add (&roles_builder, "(ss)",
                         COCKPIT_ROLE_USER_ADMIN, "User Account Administrator");
  g_variant_builder_add (&roles_builder, "(ss)",
                         COCKPIT_ROLE_REALM_ADMIN, "Realm Administrator");
  g_variant_builder_add (&roles_builder, "(ss)",
                         COCKPIT_ROLE_STORAGE_ADMIN, "Storage Administrator");
  cockpit_accounts_set_roles (COCKPIT_ACCOUNTS (accounts), g_variant_builder_end (&roles_builder));
}

static gboolean
accounts_authorize_method (GDBusInterfaceSkeleton *interface,
                           GDBusMethodInvocation *invocation)
{
  return daemon_authorize_method (daemon_get (), invocation);
}

static void
accounts_class_init (AccountsClass *klass)
{
  GObjectClass *gobject_class;
  GDBusInterfaceSkeletonClass *skeleton_class;

  gobject_class = G_OBJECT_CLASS (klass);
  gobject_class->finalize = accounts_finalize;

  skeleton_class = G_DBUS_INTERFACE_SKELETON_CLASS (klass);
  skeleton_class->g_authorize_method = accounts_authorize_method;
}

CockpitAccounts *
accounts_new (void)
{
  return COCKPIT_ACCOUNTS (g_object_new (TYPE_ACCOUNTS, NULL));
}

typedef struct {
  CockpitAccounts *object;
  GDBusMethodInvocation *invocation;
  gchar *password;
  gboolean locked;
} CallData;

static void
create_account_done (ActUserManager *manager,
                     GAsyncResult *res,
                     CallData *data)
{
  CockpitAccounts *object = data->object;
  GDBusMethodInvocation *invocation = data->invocation;
  gs_free gchar *password = data->password;
  gboolean locked = data->locked;
  g_free (data);

  GError *error = NULL;
  ActUser *user = act_user_manager_create_user_finish (manager, res, &error);
  if (user == NULL)
    {
      g_dbus_method_invocation_return_error (invocation,
                                             COCKPIT_ERROR, COCKPIT_ERROR_FAILED,
                                             "Failed to create user account: %s", error->message);
      g_error_free (error);
      return;
    }

  if (password && *password)
    {
      act_user_set_password_mode (user, ACT_USER_PASSWORD_MODE_REGULAR);
      act_user_set_password (user, password, "");
    }

  act_user_set_locked (user, locked);

  cockpit_accounts_complete_create_account (object, invocation);
}

static gboolean
handle_create_account (CockpitAccounts *object,
                       GDBusMethodInvocation *invocation,
                       const gchar *arg_user_name,
                       const gchar *arg_real_name,
                       const gchar *arg_password,
                       gboolean arg_locked)
{
  Accounts *accounts = ACCOUNTS (object);

  if (!auth_check_sender_role (invocation, COCKPIT_ROLE_USER_ADMIN))
    return TRUE;

  CallData *data = g_new0 (CallData, 1);
  data->object = object;
  data->invocation = invocation;
  data->password = g_strdup (arg_password);
  data->locked = arg_locked;

  act_user_manager_create_user_async (accounts->um,
                                      arg_user_name,
                                      arg_real_name,
                                      ACT_USER_ACCOUNT_TYPE_STANDARD,
                                      NULL,
                                      (GAsyncReadyCallback)create_account_done,
                                      data);
  return TRUE;
}

static void
accounts_iface_init (CockpitAccountsIface *iface)
{
  iface->handle_create_account = handle_create_account;
}
