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

#include "common/cockpitmemfdread.h"

#include "cockpitdbusinternal.h"

#include <errno.h>
#include <fcntl.h>
#include <stdlib.h>
#include <sys/stat.h>

#define INTROSPECTION_BLOB \
  "<node>" \
    "<interface name='cockpit.LoginMessages'>" \
      "<method name='Get'>" \
        "<arg name='messages' type='s' direction='out'/>" \
      "</method>" \
      "<method name='Dismiss'/>" \
    "</interface>" \
  "</node>"

static gchar *login_messages;

static void
login_messages_method_call (GDBusConnection       *connection,
                            const gchar           *sender,
                            const gchar           *object_path,
                            const gchar           *interface_name,
                            const gchar           *method_name,
                            GVariant              *parameters,
                            GDBusMethodInvocation *invocation,
                            gpointer               user_data)
{
  if (g_str_equal (method_name, "Get"))
    {
      g_dbus_method_invocation_return_value (invocation,
                                             g_variant_new ("(s)", login_messages ?: "{}"));
    }
  else if (g_str_equal (method_name, "Dismiss"))
    {
      g_free (login_messages);
      login_messages = NULL;

      g_dbus_method_invocation_return_value (invocation, NULL);
    }
  else
    g_assert_not_reached ();
}

void
cockpit_dbus_login_messages_startup (void)
{
  static const GDBusInterfaceVTable vtable = {
    .method_call = login_messages_method_call
  };

  g_autoptr(GError) error = NULL;

  /* If we fail to read the messages, log the failure, but otherwise
   * continue to register the service.  We'll return '{}' in that case.
   */
  if (!cockpit_memfd_read_from_envvar (&login_messages, "COCKPIT_LOGIN_MESSAGES_MEMFD", &error))
    {
      g_warning ("Unable to read login messages data: %s", error->message);
      g_clear_error (&error);
    }

  g_autoptr(GDBusConnection) connection = cockpit_dbus_internal_server ();
  g_return_if_fail (connection != NULL);

  g_autoptr(GDBusNodeInfo) node = g_dbus_node_info_new_for_xml (INTROSPECTION_BLOB, &error);
  g_assert_no_error (error);
  GDBusInterfaceInfo *iface = g_dbus_node_info_lookup_interface (node, "cockpit.LoginMessages");
  g_assert (iface != NULL);

  g_dbus_connection_register_object (connection, "/LoginMessages", iface, &vtable, NULL, NULL, &error);
  g_assert_no_error (error);
}
