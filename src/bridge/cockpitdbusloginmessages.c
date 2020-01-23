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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

#include "config.h"

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
login_messages_init (void)
{
  const gchar *cockpit_login_messages_memfd = g_getenv ("COCKPIT_LOGIN_MESSAGES_MEMFD");

  if (cockpit_login_messages_memfd == NULL)
    return;

  char *end;
  long value = strtol (cockpit_login_messages_memfd, &end, 10);
  if (*end || value < 0 || value >= INT_MAX)
    {
      g_warning ("Invalid value for COCKPIT_LOGIN_MESSAGES_MEMFD environment variable: %s",
                 cockpit_login_messages_memfd);
      return;
    }
  int fd = (int) value;
  g_unsetenv ("COCKPIT_LOGIN_MESSAGES_MEMFD");

  int seals = fcntl (fd, F_GET_SEALS);
  if (seals == -1)
    {
      g_warning ("Could not query seals on fd %d: not memfd?: %m", fd);
      goto out;
    }

  const guint expected_seals = F_SEAL_WRITE | F_SEAL_GROW | F_SEAL_SHRINK;
  if ((seals & expected_seals) != expected_seals)
    {
      g_warning ("memfd fd %d has incorrect seals set: %u (instead of %u)\n",
                 fd, seals & expected_seals, expected_seals);
      goto out;
    }

  struct stat buf;
  if (fstat (fd, &buf) != 0)
    {
      g_critical ("Failed to stat memfd %d: %m", fd);
      goto out;
    }

  if (buf.st_size < 1)
    {
      g_warning ("memfd %d must not be empty", fd);
      goto out;
    }

  login_messages = g_malloc (buf.st_size + 1);
  gssize s = pread (fd, login_messages, buf.st_size, 0);
  if (s != buf.st_size)
    {
      if (s < 0)
        g_critical ("Failed to read memfd %d: %m", fd);
      else
        g_critical ("Incomplete read on memfd %d: %zu of %zu bytes", fd, s, (gssize) buf.st_size);

      g_free (login_messages);
      login_messages = NULL;

      goto out;
    }

  login_messages[s] = '\0';

out:
  close (fd);
}

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

  login_messages_init ();

  g_autoptr(GError) error = NULL;

  g_autoptr(GDBusConnection) connection = cockpit_dbus_internal_server ();
  g_return_if_fail (connection != NULL);

  g_autoptr(GDBusNodeInfo) node = g_dbus_node_info_new_for_xml (INTROSPECTION_BLOB, &error);
  g_assert_no_error (error);
  GDBusInterfaceInfo *iface = g_dbus_node_info_lookup_interface (node, "cockpit.LoginMessages");
  g_assert (iface != NULL);

  g_dbus_connection_register_object (connection, "/LoginMessages", iface, &vtable, NULL, NULL, &error);
  g_assert_no_error (error);
}
