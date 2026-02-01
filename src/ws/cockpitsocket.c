/*
 * Copyright (C) 2021 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#include "config.h"

/* This gets logged as part of the (more verbose) protocol logging */
#ifdef G_LOG_DOMAIN
#undef G_LOG_DOMAIN
#endif
#define G_LOG_DOMAIN "cockpit-protocol"

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
