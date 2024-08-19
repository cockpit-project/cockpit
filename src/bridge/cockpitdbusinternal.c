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

#include "common/cockpitsocket.h"
#include "cockpitdbusinternal.h"

static GDBusConnection *the_server = NULL;
static GDBusConnection *the_client = NULL;
const gchar *the_name = NULL;

GDBusConnection *
cockpit_dbus_internal_client (void)
{
  g_return_val_if_fail (the_client != NULL, NULL);
  return g_object_ref (the_client);
}

const gchar *
cockpit_dbus_internal_name (void)
{
  return the_name;
}

GDBusConnection *
cockpit_dbus_internal_server (void)
{
  g_return_val_if_fail (the_server != NULL, NULL);
  return g_object_ref (the_server);
}

static void
on_complete_get_result (GObject *source,
                        GAsyncResult *result,
                        gpointer user_data)
{
  GAsyncResult **ret = user_data;
  g_assert (*ret == NULL);
  *ret = g_object_ref (result);
}

void
cockpit_dbus_internal_startup (gboolean interact)
{
  GAsyncResult *rclient = NULL;
  GAsyncResult *rserver = NULL;
  GError *error = NULL;
  gchar *guid;

  /*
   * When in interactive mode, we allow poking and prodding our internal
   * DBus interface. Therefore be on the session bus instead of peer-to-peer.
   */
  if (interact)
    {
      the_server = g_bus_get_sync (G_BUS_TYPE_SESSION, NULL, &error);
      if (the_server)
        {
          the_name = g_dbus_connection_get_unique_name (the_server);
          the_client = g_object_ref (the_server);
          return;
        }
      else
        {
          g_message ("couldn't connect to session bus: %s", error->message);
          g_clear_error (&error);
        }
    }

  g_autoptr(GIOStream) one, two;
  cockpit_socket_streampair (&one, &two);

  guid = g_dbus_generate_guid ();
  g_dbus_connection_new (one, guid,
                         G_DBUS_CONNECTION_FLAGS_AUTHENTICATION_SERVER |
                         G_DBUS_CONNECTION_FLAGS_AUTHENTICATION_ALLOW_ANONYMOUS,
                         NULL, NULL, on_complete_get_result, &rserver);

  g_dbus_connection_new (two, NULL, G_DBUS_CONNECTION_FLAGS_AUTHENTICATION_CLIENT,
                         NULL, NULL, on_complete_get_result, &rclient);

  while (!rserver || !rclient)
    g_main_context_iteration (NULL, TRUE);

  the_server = g_dbus_connection_new_finish (rserver, &error);
  if (the_server == NULL)
    {
      g_warning ("couldn't create internal connection: %s", error->message);
      g_clear_error (&error);
    }

  the_client = g_dbus_connection_new_finish (rclient, &error);
  if (the_client == NULL)
    {
      g_warning ("couldn't create internal connection: %s", error->message);
      g_clear_error (&error);
    }

  g_object_unref (rclient);
  g_object_unref (rserver);
  g_free (guid);
}

void
cockpit_dbus_internal_cleanup (void)
{
  g_clear_object (&the_client);
  g_clear_object (&the_server);
}
