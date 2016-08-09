/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2014 Red Hat, Inc.
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

#include "common/cockpitpipe.h"

#include <glib/gi18n.h>

#include <sys/types.h>
#include <errno.h>
#include <grp.h>
#include <pwd.h>
#include <shadow.h>
#include <stdio.h>

const gchar *cockpit_bridge_path_passwd = "/etc/passwd";
const gchar *cockpit_bridge_path_group = "/etc/group";
const gchar *cockpit_bridge_path_shadow = "/etc/shadow";

const gchar *cockpit_bridge_path_newusers = PATH_NEWUSERS;
const gchar *cockpit_bridge_path_chpasswd = PATH_CHPASSWD;
const gchar *cockpit_bridge_path_usermod = PATH_USERMOD;

#ifdef HAVE_NEWUSERS_CRYPT_METHOD
gboolean cockpit_bridge_have_newusers_crypt_method = TRUE;
#else
gboolean cockpit_bridge_have_newusers_crypt_method = FALSE;
#endif

static GVariant *
setup_get_property (GDBusConnection *connection,
                    const gchar *sender,
                    const gchar *object_path,
                    const gchar *interface_name,
                    const gchar *property_name,
                    GError **error,
                    gpointer user_data)
{
  const gchar *mechanisms[] = { "passwd1", NULL, };
  g_return_val_if_fail (g_str_equal (property_name, "Mechanisms"), NULL);
  return g_variant_new_strv (mechanisms, -1);
}

static GDBusPropertyInfo setup_mechanisms_property = {
  -1, "Mechanisms", "as", G_DBUS_PROPERTY_INFO_FLAGS_READABLE, NULL
};

static GDBusPropertyInfo *setup_properties[] = {
    &setup_mechanisms_property,
    NULL
};

static gboolean
fgetpwent_callback (void (* callback) (struct passwd *, gpointer),
                    gpointer user_data)
{
  struct passwd pwb;
  struct passwd *pw;
  gchar *buffer;
  gsize buflen;
  FILE *fp;
  int ret;

  fp = fopen (cockpit_bridge_path_passwd, "r");
  if (fp == NULL)
    {
      g_message ("unable to open %s: %s", cockpit_bridge_path_passwd, g_strerror (errno));
      return FALSE;
    }

  buflen = 16 * 1024;
  buffer = g_malloc (buflen);

  for (;;)
    {
      ret = fgetpwent_r (fp, &pwb, buffer, buflen, &pw);
      if (ret == 0)
        {
          callback (pw, user_data);
        }
      else
        {
          g_free (buffer);
          fclose (fp);
          return (ret == ENOENT);
        }
    }
}

static gboolean
fgetspent_callback (void (* callback) (struct spwd *, gpointer),
                    gpointer user_data)
{
  struct spwd spb;
  struct spwd *sp;
  gchar *buffer;
  gsize buflen;
  FILE *fp;
  int ret;

  fp = fopen (cockpit_bridge_path_shadow, "r");
  if (fp == NULL)
    {
      g_message ("unable to open %s: %s", cockpit_bridge_path_shadow, g_strerror (errno));
      return FALSE;
    }

  buflen = 16 * 1024;
  buffer = g_malloc (buflen);

  for (;;)
    {
      ret = fgetspent_r (fp, &spb, buffer, buflen, &sp);
      if (ret == 0)
        {
          callback (sp, user_data);
        }
      else
        {
          g_free (buffer);
          fclose (fp);
          return (ret == ENOENT);
        }
    }
}

static gboolean
fgetgrent_callback (void (* callback) (struct group *, gpointer),
                    gpointer user_data)
{
  struct group grb;
  struct group *gr;
  gchar *buffer;
  gsize buflen;
  FILE *fp;
  int ret;

  fp = fopen (cockpit_bridge_path_group, "r");
  if (fp == NULL)
    {
      g_message ("unable to open %s: %s", cockpit_bridge_path_group, g_strerror (errno));
      return FALSE;
    }

  buflen = 16 * 1024;
  buffer = g_malloc (buflen);

  for (;;)
    {
      ret = fgetgrent_r (fp, &grb, buffer, buflen, &gr);
      if (ret == 0)
        {
          callback (gr, user_data);
        }
      else
        {
          g_free (buffer);
          fclose (fp);
          return (ret == ENOENT);
        }
    }
}

static gboolean
is_system_uid (int uid)
{
  /* We could make this read from login.defs */
  return (uid != 0 && uid < 1000);
}

static void
add_name_to_array (struct passwd *pw,
                   gpointer user_data)
{
  if (!is_system_uid (pw->pw_uid))
    g_ptr_array_add (user_data, g_strdup (pw->pw_name));
}

static void
add_group_to_array (struct group *gr,
                    gpointer user_data)
{
  g_ptr_array_add (user_data, g_strdup (gr->gr_name));
}

static void
setup_prepare_passwd1 (GVariant *parameters,
                       GDBusMethodInvocation *invocation)
{
  const gchar *mechanism;
  GPtrArray *names;
  GPtrArray *groups;
  GVariant *result = NULL;

  g_variant_get (parameters, "(&s)", &mechanism);
  names = g_ptr_array_new_with_free_func (g_free);
  groups = g_ptr_array_new_with_free_func (g_free);

  if (!g_str_equal (mechanism, "passwd1"))
    {
      g_message ("unsupported setup mechanism: %s", mechanism);
      g_dbus_method_invocation_return_error (invocation, G_DBUS_ERROR, G_DBUS_ERROR_NOT_SUPPORTED,
                                             N_("Unsupported setup mechanism"));
    }
  else if (fgetpwent_callback (add_name_to_array, names) &&
           fgetgrent_callback (add_group_to_array, groups))
    {
      /* We don't need to prepare anything */
      result = g_variant_new ("(@as@as)",
                              g_variant_new_strv ((const gchar * const *)names->pdata, names->len),
                              g_variant_new_strv ((const gchar * const *)groups->pdata, groups->len));
      g_dbus_method_invocation_return_value (invocation, g_variant_new ("(v)", result));
    }
  else
    {
      g_dbus_method_invocation_return_error (invocation, G_DBUS_ERROR, G_DBUS_ERROR_FAILED,
                                             N_("Couldn't list users"));
    }

  g_ptr_array_free (groups, TRUE);
  g_ptr_array_free (names, TRUE);
}

typedef struct {
  GHashTable *gids;          /* Group IDs to name mapping */
  GHashTable *members;       /* Information about membership */

  GHashTable *users;         /* Information about loaded users */

  GPtrArray *pwdata;        /* Results */
} TransferAdmin1;

static void
filter_and_load_group (struct group *gr,
                       gpointer user_data)
{
  TransferAdmin1 *context = user_data;
  GHashTable *table;
  gint j;

  g_hash_table_insert (context->gids, GINT_TO_POINTER (gr->gr_gid), g_strdup (gr->gr_name));

  table = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, NULL);
  for (j = 0; gr->gr_mem[j] != NULL; j++)
    g_hash_table_add (table, g_strdup (gr->gr_mem[j]));
  g_hash_table_insert (context->members, g_strdup (gr->gr_name), table);
}

static void
filter_and_load_user (struct passwd *pw,
                      gpointer user_data)
{
  TransferAdmin1 *context = user_data;
  GHashTable *table;
  gchar *group;

  g_return_if_fail (pw->pw_name != NULL);

  if (!is_system_uid (pw->pw_uid))
    {
      g_hash_table_insert (context->users, g_strdup (pw->pw_name),
                           g_strdup_printf ("%s:%s:%s", pw->pw_gecos, pw->pw_dir, pw->pw_shell));

      group = g_hash_table_lookup (context->gids, GINT_TO_POINTER (pw->pw_gid));
      if (group)
        {
          table = g_hash_table_lookup (context->members, group);
          if (table)
            g_hash_table_add (table, g_strdup (pw->pw_name));
        }
    }
}

static void
filter_and_add_passwd (struct spwd *sp,
                       gpointer user_data)
{
  TransferAdmin1 *context = user_data;
  gchar *gecos_dir_shell;

  gecos_dir_shell = g_hash_table_lookup (context->users, sp->sp_namp);
  if (gecos_dir_shell && sp->sp_pwdp && strlen (sp->sp_pwdp) >= 4)
    {
      g_ptr_array_add (context->pwdata,
                       g_strdup_printf ("%s:%s:::%s", sp->sp_namp, sp->sp_pwdp, gecos_dir_shell));

      /* Remove this one, so we can track which ones we didn't transfer */
      g_hash_table_remove (context->users, sp->sp_namp);
    }
}

static void
build_group_lines (GHashTable *membership,
                   GHashTable *exclude,
                   GPtrArray *lines)
{
  GHashTableIter giter, miter;
  gpointer name;
  gpointer user;
  gpointer table;
  GString *memlist;
  gboolean first;

  /* Build the group listing */
  g_hash_table_iter_init (&giter, membership);
  while (g_hash_table_iter_next (&giter, &name, &table))
    {
      memlist = g_string_new ("");
      g_string_append_printf (memlist, "%s:::", (gchar *)name);

      first = TRUE;
      g_hash_table_iter_init (&miter, table);
      while (g_hash_table_iter_next (&miter, &user, NULL))
        {
          if (g_hash_table_lookup (exclude, user))
            continue;
          if (!first)
            g_string_append_c (memlist, ',');
          first = FALSE;
          g_string_append (memlist, user);
        }
      g_ptr_array_add (lines, g_string_free (memlist, FALSE));
    }
}

static void
setup_transfer_passwd1 (GVariant *parameters,
                       GDBusMethodInvocation *invocation)
{
  TransferAdmin1 *context = NULL;
  const gchar *mechanism;
  GVariant *prepared;
  GVariant *result;
  GPtrArray *grdata;

  g_variant_get (parameters, "(&sv)", &mechanism, &prepared);

  if (!g_str_equal (mechanism, "passwd1"))
    {
      g_message ("unsupported setup mechanism: %s", mechanism);
      g_dbus_method_invocation_return_error (invocation, G_DBUS_ERROR, G_DBUS_ERROR_NOT_SUPPORTED,
                                             N_("Unsupported setup mechanism"));
      goto out;
    }
  if (!g_variant_is_of_type (prepared, G_VARIANT_TYPE ("(asas)")))
    {
      g_dbus_method_invocation_return_error (invocation, G_DBUS_ERROR, G_DBUS_ERROR_INVALID_ARGS,
                                             N_("Bad data passed for passwd1 mechanism"));
      goto out;
    }

  context = g_new0 (TransferAdmin1, 1);
  context->members = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, (GDestroyNotify)g_hash_table_unref);
  context->gids = g_hash_table_new_full (g_direct_hash, g_direct_equal, NULL, g_free);
  context->users = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, g_free);
  context->pwdata = g_ptr_array_new_with_free_func (g_free);

  if (!fgetgrent_callback (filter_and_load_group, context) ||
      !fgetpwent_callback (filter_and_load_user, context) ||
      !fgetspent_callback (filter_and_add_passwd, context))
    {
      g_dbus_method_invocation_return_error (invocation, G_DBUS_ERROR, G_DBUS_ERROR_FAILED,
                                             N_("Couldn't load user data"));
    }
  else
    {
      /* Build the group listing, excluding any remaining users */
      grdata = g_ptr_array_new_with_free_func (g_free);
      build_group_lines (context->members, context->users, grdata);

      result = g_variant_new ("(@as@as)",
                     g_variant_new_strv ((const gchar *const *)context->pwdata->pdata, context->pwdata->len),
                     g_variant_new_strv ((const gchar *const *)grdata->pdata, grdata->len));

      g_ptr_array_free (grdata, TRUE);
      g_dbus_method_invocation_return_value (invocation, g_variant_new ("(v)", result));
    }

out:
  if (context)
    {
      g_hash_table_unref (context->members);
      g_hash_table_unref (context->gids);
      g_hash_table_unref (context->users);
      g_ptr_array_free (context->pwdata, TRUE);
      g_free (context);
    }
  g_variant_unref (prepared);
}

typedef struct {
  GDBusMethodInvocation *invocation;
  GBytes *chpasswd;
  GHashTable *usermod;
} CommitAdmin1;

static void
commit_passwd1_free (gpointer data)
{
  CommitAdmin1 *context = data;
  g_bytes_unref (context->chpasswd);
  g_object_unref (context->invocation);
  g_hash_table_unref (context->usermod);
  g_free (context);
}

static gboolean
check_pipe_exit_status (CockpitPipe *pipe,
                        const gchar *problem,
                        const gchar *prefix)
{
  GError *error = NULL;
  gint status;

  if (problem == NULL ||
      g_str_equal (problem, "internal-error"))
    {
      status = cockpit_pipe_exit_status (pipe);
      if (!g_spawn_check_exit_status (status, &error))
        {
          g_message ("%s: %s", prefix, error->message);
          g_error_free (error);
          return FALSE;
        }
    }
  else if (problem)
    {
      g_message ("%s: %s", prefix, problem);
      return FALSE;
    }

  return TRUE;
}

static void
perform_usermod (CommitAdmin1 *context);

static void
on_usermod_close (CockpitPipe *pipe,
                  const gchar *problem,
                  gpointer user_data)
{
  CommitAdmin1 *context = user_data;

  if (!check_pipe_exit_status (pipe, problem, "couldn't run usermod command"))
    {
      g_dbus_method_invocation_return_error (context->invocation, G_DBUS_ERROR, G_DBUS_ERROR_FAILED,
                                             N_("Couldn't change user groups"));
      commit_passwd1_free (context);
    }
  else
    {
      perform_usermod (context);
    }

  g_object_unref (pipe);
}

static void
perform_usermod (CommitAdmin1 *context)
{
  CockpitPipe *pipe;
  GHashTableIter iter;
  gpointer name;
  gpointer grouplist;

  const gchar *argv[] = { cockpit_bridge_path_usermod, "xx", "--append", "--group", "yy", NULL };

  g_hash_table_iter_init (&iter, context->usermod);
  if (g_hash_table_iter_next (&iter, &name, &grouplist))
    {
      argv[1] = (gchar *)name;
      argv[4] = ((GString *)grouplist)->str;

      g_debug ("adding user '%s' to groups: %s", argv[1], argv[4]);

      pipe = cockpit_pipe_spawn (argv, NULL, NULL, COCKPIT_PIPE_FLAGS_NONE);
      g_hash_table_iter_remove (&iter);

      g_signal_connect (pipe, "close", G_CALLBACK (on_usermod_close), context);
      cockpit_pipe_close (pipe, NULL);
    }
  else
    {
      /* All done, success */
      g_dbus_method_invocation_return_value (context->invocation, NULL);
      commit_passwd1_free (context);
    }
}

static void
on_chpasswd_close (CockpitPipe *pipe,
                   const gchar *problem,
                   gpointer user_data)
{
  CommitAdmin1 *context = user_data;

  if (!check_pipe_exit_status (pipe, problem, "couldn't run chpasswd command"))
    {
      g_dbus_method_invocation_return_error (context->invocation, G_DBUS_ERROR, G_DBUS_ERROR_FAILED,
                                             N_("Couldn't change user password"));
      commit_passwd1_free (context);
    }
  else
    {
      perform_usermod (context);
    }

  g_object_unref (pipe);
}

static void
on_newusers_close (CockpitPipe *pipe,
                   const gchar *problem,
                   gpointer user_data)
{
  CommitAdmin1 *context = user_data;
  CockpitPipe *next;

  const gchar *argv[] = { cockpit_bridge_path_chpasswd, "--encrypted", NULL };

  if (!check_pipe_exit_status (pipe, problem, "couldn't run newusers command"))
    {
      g_dbus_method_invocation_return_error (context->invocation, G_DBUS_ERROR, G_DBUS_ERROR_FAILED,
                                             N_("Couldn't create new users"));
      commit_passwd1_free (context);
    }
  else
    {
      g_debug ("batch changing user passwords");

      next = cockpit_pipe_spawn (argv, NULL, NULL, COCKPIT_PIPE_FLAGS_NONE);
      g_signal_connect (next, "close", G_CALLBACK (on_chpasswd_close), context);
      cockpit_pipe_write (next, context->chpasswd);
      cockpit_pipe_close (next, NULL);
    }

  g_object_unref (pipe);
}

static void
add_name_to_hashtable (struct passwd *pw,
                       gpointer user_data)
{
  g_hash_table_add (user_data, g_strdup (pw->pw_name));
}

static void
add_group_to_hashtable (struct group *gr,
                       gpointer user_data)
{
  g_hash_table_add (user_data, g_strdup (gr->gr_name));
}

static void
string_free (gpointer data)
{
  g_string_free (data, TRUE);
}

static void
setup_commit_passwd1 (GVariant *parameters,
                     GDBusMethodInvocation *invocation)
{
  const gchar *mechanism;
  GVariant *transferred = NULL;
  const gchar **lines;
  GHashTable *users = NULL;
  GHashTable *groups = NULL;
  GString *chpasswd = NULL;
  GString *newusers = NULL;
  CommitAdmin1 *context;
  CockpitPipe *pipe;
  gsize length, i, j;
  gchar **parts;
  GBytes *bytes;
  GVariant *pwdata = NULL;
  GVariant *grdata = NULL;
  GHashTable *usermod;
  gchar **memlist;
  GString *string;
  gboolean user_exists;

  /* We are getting crypted passwords so we need to use
   * --crypt-method=NONE with newusers and chpasswd so that the string
   * is installed unchanged.  Unfortunately, newusers might or might
   * not support the --crypt-method option, depending on whether it
   * was compiled with or without PAM.  When the option is missing, we
   * fix up the password afterwards via chpasswd.
   *
   * However, newusers needs some valid password to create new users.
   * Thus, we need a good random string that passes all password
   * quality criteria, and we just use the crpyted password for that.
   */

  const gchar *argv[] = { cockpit_bridge_path_newusers, "--crypt-method=NONE", NULL };
  if (!cockpit_bridge_have_newusers_crypt_method)
    argv[1] = NULL;

  g_variant_get (parameters, "(&sv)", &mechanism, &transferred);

  if (!g_str_equal (mechanism, "passwd1"))
    {
      g_message ("unsupported setup mechanism: %s", mechanism);
      g_dbus_method_invocation_return_error (invocation, G_DBUS_ERROR, G_DBUS_ERROR_NOT_SUPPORTED,
                                             N_("Unsupported setup mechanism"));
      goto out;
    }
  if (!g_variant_is_of_type (transferred, G_VARIANT_TYPE ("(asas)")))
    {
      g_dbus_method_invocation_return_error (invocation, G_DBUS_ERROR, G_DBUS_ERROR_INVALID_ARGS,
                                             N_("Bad data passed for passwd1 mechanism"));
      goto out;
    }

  users = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, NULL);
  groups = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, NULL);

  if (!fgetpwent_callback (add_name_to_hashtable, users) ||
      !fgetgrent_callback (add_group_to_hashtable, groups))
    {
      g_dbus_method_invocation_return_error (invocation, G_DBUS_ERROR, G_DBUS_ERROR_FAILED,
                                             N_("Couldn't list local users"));
      goto out;
    }

  g_debug ("starting setup synchronization");

  g_variant_get (transferred, "(@as@as)", &pwdata, &grdata);

  chpasswd = g_string_new ("");
  newusers = g_string_new ("");
  usermod = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, string_free);

  lines = g_variant_get_strv (pwdata, &length);
  for (i = 0; i < length; i++)
    {
      parts = g_strsplit(lines[i], ":", 3);

      user_exists = (g_hash_table_lookup (users, parts[0]) != NULL);

      if (!user_exists)
        {
          g_string_append (newusers, lines[i]);
          g_string_append_c (newusers, '\n');
        }

      if (user_exists || !cockpit_bridge_have_newusers_crypt_method)
        {
          g_string_append_printf (chpasswd, "%s:%s\n", parts[0], parts[1]);
        }

      g_strfreev (parts);
    }

  g_free (lines);

  lines = g_variant_get_strv (grdata, &length);
  for (i = 0; i < length; i++)
    {
      parts = g_strsplit(lines[i], ":", 4);
      if (g_hash_table_lookup (groups, parts[0]))
        {
          memlist = g_strsplit (parts[3], ",", -1);
          for (j = 0; memlist[j] != NULL; j++)
            {
              string = g_hash_table_lookup (usermod, memlist[j]);
              if (!string)
                {
                  string = g_string_new ("");
                  g_hash_table_insert (usermod, g_strdup (memlist[j]), string);
                }
              if (string->len > 0)
                g_string_append_c (string, ',');
              g_string_append (string, parts[0]);
            }
          g_strfreev (memlist);
        }
      g_strfreev (parts);
    }
  g_free (lines);

  context = g_new0 (CommitAdmin1, 1);
  context->invocation = g_object_ref (invocation);
  context->chpasswd = g_string_free_to_bytes (chpasswd);
  context->usermod = usermod;

  g_debug ("batch creating new users");

  bytes = g_string_free_to_bytes (newusers);
  pipe = cockpit_pipe_spawn (argv, NULL, NULL, COCKPIT_PIPE_FLAGS_NONE);
  g_signal_connect (pipe, "close", G_CALLBACK (on_newusers_close), context);
  cockpit_pipe_write (pipe, bytes);
  cockpit_pipe_close (pipe, NULL);
  g_bytes_unref (bytes);

out:
  if (users)
    g_hash_table_unref (users);
  if (groups)
    g_hash_table_unref (groups);
  if (pwdata)
    g_variant_unref (pwdata);
  if (grdata)
    g_variant_unref (grdata);
  g_variant_unref (transferred);
}

static void
setup_method_call (GDBusConnection *connection,
                   const gchar *sender,
                   const gchar *object_path,
                   const gchar *interface_name,
                   const gchar *method_name,
                   GVariant *parameters,
                   GDBusMethodInvocation *invocation,
                   gpointer user_data)
{
  if (g_str_equal (method_name, "Prepare"))
    setup_prepare_passwd1 (parameters, invocation);
  else if (g_str_equal (method_name, "Commit"))
    setup_commit_passwd1 (parameters, invocation);
  else if (g_str_equal (method_name, "Transfer"))
    setup_transfer_passwd1 (parameters, invocation);
  else
    g_return_if_reached ();
}

static GDBusArgInfo setup_mechanism_arg = {
  -1, "mechanism", "s", NULL
};

static GDBusArgInfo setup_data_arg = {
  -1, "data", "v", NULL
};

static GDBusArgInfo *setup_mechanism_args[] = {
  &setup_mechanism_arg,
  NULL
};

static GDBusArgInfo *setup_data_args[] = {
  &setup_data_arg,
  NULL
};

static GDBusArgInfo *setup_mechanism_data_args[] = {
  &setup_mechanism_arg,
  &setup_data_arg,
  NULL
};

static GDBusMethodInfo setup_prepare_method = {
  -1, "Prepare", setup_mechanism_args, setup_data_args, NULL
};

static GDBusMethodInfo setup_transfer_method = {
  -1, "Transfer", setup_mechanism_data_args, setup_data_args, NULL
};

static GDBusMethodInfo setup_commit_method = {
  -1, "Commit", setup_mechanism_data_args, NULL, NULL
};

static GDBusMethodInfo *setup_methods[] = {
  &setup_prepare_method,
  &setup_transfer_method,
  &setup_commit_method,
  NULL,
};

static GDBusInterfaceInfo setup_interface = {
  -1, "cockpit.Setup", setup_methods, NULL, setup_properties, NULL
};

static GDBusInterfaceVTable setup_vtable = {
  .method_call = setup_method_call,
  .get_property = setup_get_property,
};

void
cockpit_dbus_setup_startup (void)
{
  GDBusConnection *connection;
  GError *error = NULL;

  connection = cockpit_dbus_internal_server ();
  g_return_if_fail (connection != NULL);

  g_dbus_connection_register_object (connection, "/setup", &setup_interface,
                                     &setup_vtable, NULL, NULL, &error);

  if (error != NULL)
    {
      g_critical ("couldn't register setup object: %s", error->message);
      g_error_free (error);
    }

  g_object_unref (connection);
}
