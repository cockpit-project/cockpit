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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

#include "config.h"

#include "cockpitdbusinternal.h"

#include <sys/types.h>
#include <errno.h>
#include <grp.h>
#include <pwd.h>
#include <string.h>

static void
variant_table_sink (GHashTable *props,
                    const gchar *name,
                    GVariant *value)
{
  g_hash_table_insert (props, (gchar *)name, g_variant_ref_sink (value));
}

static void
populate_passwd_props (GHashTable *props,
                       struct passwd *pw)
{
  if (pw == NULL)
    {
      variant_table_sink (props, "Id", g_variant_new_int64 (geteuid ()));
      variant_table_sink (props, "Name", g_variant_new_string (""));
      variant_table_sink (props, "Full", g_variant_new_string (""));
      variant_table_sink (props, "Home", g_variant_new_string (""));
      variant_table_sink (props, "Shell", g_variant_new_string (""));
    }
  else
    {
      size_t n;
      gchar *full;

      n = strlen (pw->pw_gecos);
      while (n > 0 && pw->pw_gecos[n - 1] == ',')
        n--;
      full = g_strndup (pw->pw_gecos, n);

      variant_table_sink (props, "Id", g_variant_new_int64 (pw->pw_uid));
      variant_table_sink (props, "Name", g_variant_new_string (pw->pw_name));
      variant_table_sink (props, "Full", g_variant_new_string (full));
      variant_table_sink (props, "Home", g_variant_new_string (pw->pw_dir));
      variant_table_sink (props, "Shell", g_variant_new_string (pw->pw_shell));

      g_free (full);
    }
}

static void
populate_group_prop (GHashTable *props)
{
  struct group *gr;
  GPtrArray *array;
  gid_t *list = NULL;
  gid_t gid;
  int ret, i;

  gid = getegid ();

  ret = getgroups (0, NULL);
  if (ret > 0)
    {
      list = g_new (gid_t, ret);
      ret = getgroups (ret, list);
    }

  if (ret < 0)
    {
      g_warning ("couldn't load list of groups: %s", g_strerror (errno));
      ret = 0;
    }

  array = g_ptr_array_new ();

  gr = getgrgid (gid);
  if (gr == NULL)
    g_warning ("couldn't load group info for %d: %s", (int)gid, g_strerror (errno));
  else
    g_ptr_array_add (array, g_variant_new_string (gr->gr_name));

  for (i = 0; i < ret; i++)
    {
      if (list[i] == gid)
        continue;

      gr = getgrgid (list[i]);
      if (gr == NULL)
        {
          g_warning ("couldn't load group info for %d: %s", (int)gid, g_strerror (errno));
          continue;
        }

      g_ptr_array_add (array, g_variant_new_string (gr->gr_name));
    }

  variant_table_sink (props, "Groups", g_variant_new_array (G_VARIANT_TYPE_STRING,
                                                            (GVariant * const*)array->pdata,array->len));

  g_ptr_array_free (array, TRUE);
  g_free (list);
}

static GVariant *
user_get_property (GDBusConnection *connection,
                   const gchar *sender,
                   const gchar *object_path,
                   const gchar *interface_name,
                   const gchar *property_name,
                   GError **error,
                   gpointer user_data)
{
  GHashTable *props = user_data;

  if (!g_hash_table_lookup (props, "Groups"))
    populate_group_prop (props);

  GVariant *value = g_hash_table_lookup (props, property_name);
  g_return_val_if_fail (value != NULL, NULL);
  return g_variant_ref (value);
}

static GDBusPropertyInfo user_name_property = {
  -1, "Name", "s", G_DBUS_PROPERTY_INFO_FLAGS_READABLE, NULL
};

static GDBusPropertyInfo user_full_property = {
  -1, "Full", "s", G_DBUS_PROPERTY_INFO_FLAGS_READABLE, NULL
};

static GDBusPropertyInfo user_id_property = {
  -1, "Id", "x", G_DBUS_PROPERTY_INFO_FLAGS_READABLE, NULL
};

static GDBusPropertyInfo user_home_property = {
  -1, "Home", "s", G_DBUS_PROPERTY_INFO_FLAGS_READABLE, NULL
};

static GDBusPropertyInfo user_shell_property = {
  -1, "Shell", "s", G_DBUS_PROPERTY_INFO_FLAGS_READABLE, NULL
};

static GDBusPropertyInfo user_groups_property = {
  -1, "Groups", "as", G_DBUS_PROPERTY_INFO_FLAGS_READABLE, NULL
};

static GDBusPropertyInfo *user_properties[] = {
  &user_name_property,
  &user_full_property,
  &user_id_property,
  &user_shell_property,
  &user_home_property,
  &user_groups_property,
  NULL
};

static GDBusInterfaceInfo user_interface = {
  -1, "cockpit.User", NULL, NULL, user_properties, NULL
};

static GDBusInterfaceVTable user_vtable = {
  .get_property = user_get_property,
};

void
cockpit_dbus_user_startup (struct passwd *pwd)
{
  GDBusConnection *connection;
  GHashTable *props;
  GError *error = NULL;

  connection = cockpit_dbus_internal_server ();
  g_return_if_fail (connection != NULL);

  props = g_hash_table_new_full (g_str_hash, g_str_equal, NULL, (GDestroyNotify)g_variant_unref);
  populate_passwd_props (props, pwd);

  g_dbus_connection_register_object (connection, "/user", &user_interface,
                                     &user_vtable, props, (GDestroyNotify)g_hash_table_unref,
                                     &error);

  if (error != NULL)
    {
      g_critical ("couldn't register user object: %s", error->message);
      g_hash_table_unref (props);
      g_error_free (error);
    }

  g_object_unref (connection);
}
