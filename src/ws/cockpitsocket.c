/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2021 Red Hat, Inc.
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

#include "cockpitsocket.h"

#include <sys/socket.h>
#include <gio/gio.h>

/* _always_ takes ownership of fd, even in error case */
static gpointer
cockpit_socket_new_take_fd (int      fd,
                            GError **error)
{
  GSocket *socket = g_socket_new_from_fd (fd, error);
  if (socket == NULL)
    close (fd);

  return socket;
}

static gpointer
cockpit_socket_connection_new_take_fd (GType    expected_type,
                                       int      fd,
                                       GError **error)
{
  g_autoptr(GSocket) socket = cockpit_socket_new_take_fd (fd, error);
  if (socket == NULL)
    return NULL;

  g_autoptr(GSocketConnection) connection = g_socket_connection_factory_create_connection (socket);
  if (!G_TYPE_CHECK_INSTANCE_TYPE (connection, expected_type))
    {
      g_set_error (error, G_FILE_ERROR, G_FILE_ERROR_INVAL,
                   "connection has type %s, not %s as expected",
                   G_OBJECT_TYPE_NAME (connection), g_type_name (expected_type));
      return NULL;
    }

  return g_steal_pointer (&connection);
}

void
cockpit_socket_socketpair (GSocket **one,
                           GSocket **two)
{
  int sv[2];
  if (socketpair (AF_LOCAL, SOCK_STREAM, 0, sv))
    g_error ("socketpair(AF_LOCAL, SOCK_STREAM) failed: %m");

  g_autoptr(GError) error = NULL;
  *one = g_socket_new_from_fd (sv[0], &error);
  g_assert_no_error (error);

  *two = g_socket_new_from_fd (sv[1], &error);
  g_assert_no_error (error);
}

void
cockpit_socket_streampair (GIOStream **one,
                           GIOStream **two)
{
  int sv[2];
  if (socketpair (AF_LOCAL, SOCK_STREAM, 0, sv))
    g_error ("socketpair(AF_LOCAL, SOCK_STREAM) failed: %m");

  g_autoptr(GError) error = NULL;
  *one = cockpit_socket_connection_new_take_fd (G_TYPE_IO_STREAM, sv[0], &error);
  g_assert_no_error (error);

  *two = cockpit_socket_connection_new_take_fd (G_TYPE_IO_STREAM, sv[1], &error);
  g_assert_no_error (error);
}
