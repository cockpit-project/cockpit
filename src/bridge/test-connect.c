/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
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

#include "cockpitconnect.h"

#include "common/cockpitloopback.h"
#include "common/cockpittest.h"
#include "common/mock-io-stream.h"

#include <glib.h>
#include <glib-unix.h>
#include <glib/gstdio.h>
#include <gio/gunixsocketaddress.h>
#include <gio/gunixinputstream.h>
#include <gio/gunixoutputstream.h>

#include <sys/uio.h>
#include <string.h>

/* ----------------------------------------------------------------------------
 * Mock
 */

/* ----------------------------------------------------------------------------
 * Tests
 */

typedef struct {
  GSocket *listen_sock;
  GSource *listen_source;
  GSocket *conn_sock;
  GSource *conn_source;
  GSocketAddress *address;
  gboolean skip_ipv6_loopback;
  guint16 port;
} TestConnect;

static void
on_ready_get_result (GObject *object,
                     GAsyncResult *result,
                     gpointer user_data)
{
  GAsyncResult **retval = user_data;
  g_assert (retval != NULL);
  g_assert (*retval == NULL);
  *retval = g_object_ref (result);
}

static gboolean
on_socket_input (GSocket *socket,
                 GIOCondition cond,
                 gpointer user_data)
{
  gchar buffer[1024];
  GError *error = NULL;
  gssize ret, wret;

  ret = g_socket_receive (socket, buffer, sizeof (buffer), NULL, &error);
  g_assert_no_error (error);

  if (ret == 0)
    {
      g_socket_shutdown (socket, FALSE, TRUE, &error);
      g_assert_no_error (error);
      return FALSE;
    }

  g_assert (ret > 0);
  wret = g_socket_send (socket, buffer, ret, NULL, &error);
  g_assert_no_error (error);
  g_assert (wret == ret);
  return TRUE;
}

static gboolean
on_socket_connection (GSocket *socket,
                      GIOCondition cond,
                      gpointer user_data)
{
  TestConnect *tc = user_data;
  GError *error = NULL;

  g_assert (tc->conn_source == NULL);
  tc->conn_sock = g_socket_accept (tc->listen_sock, NULL, &error);
  g_assert_no_error (error);

  tc->conn_source = g_socket_create_source (tc->conn_sock, G_IO_IN, NULL);
  g_source_set_callback (tc->conn_source, (GSourceFunc)on_socket_input, tc, NULL);
  g_source_attach (tc->conn_source, NULL);

  /* Only one connection */
  return FALSE;
}

static void
setup_connect (TestConnect *tc,
               gconstpointer data)
{
  GError *error = NULL;
  GInetAddress *inet;
  GSocketAddress *address;
  GSocketFamily family = GPOINTER_TO_INT (data);

  if (family == G_SOCKET_FAMILY_INVALID)
    family = G_SOCKET_FAMILY_IPV4;

  inet = g_inet_address_new_loopback (family);
  address = g_inet_socket_address_new (inet, 0);
  g_object_unref (inet);

  tc->listen_sock = g_socket_new (family, G_SOCKET_TYPE_STREAM,
                                  G_SOCKET_PROTOCOL_DEFAULT, &error);
  g_assert_no_error (error);

  g_socket_bind (tc->listen_sock, address, TRUE, &error);
  g_object_unref (address);

  if (error != NULL && family == G_SOCKET_FAMILY_IPV6)
    {
      /* Some test runners don't have IPv6 loopback, strangely enough */
      g_clear_error (&error);
      tc->skip_ipv6_loopback = TRUE;
      return;
    }

  g_assert_no_error (error);

  tc->address = g_socket_get_local_address (tc->listen_sock, &error);
  g_assert_no_error (error);

  tc->port = g_inet_socket_address_get_port (G_INET_SOCKET_ADDRESS (tc->address));

  g_socket_listen (tc->listen_sock, &error);
  g_assert_no_error (error);

  tc->listen_source = g_socket_create_source (tc->listen_sock, G_IO_IN, NULL);
  g_source_set_callback (tc->listen_source, (GSourceFunc)on_socket_connection, tc, NULL);
  g_source_attach (tc->listen_source, NULL);
}

static void
teardown_connect (TestConnect *tc,
                  gconstpointer data)
{
  if (tc->address)
    g_object_unref (tc->address);
  if (tc->conn_source)
    {
      g_source_destroy (tc->conn_source);
      g_source_unref (tc->conn_source);
    }
  if (tc->listen_source)
    {
      g_source_destroy (tc->listen_source);
      g_source_unref (tc->listen_source);
    }
  g_clear_object (&tc->listen_sock);
  g_clear_object (&tc->conn_sock);
}

static void
test_connect (TestConnect *tc,
              gconstpointer user_data)
{
  GAsyncResult *result = NULL;
  GError *error = NULL;
  GIOStream *io;

  cockpit_connect_stream (G_SOCKET_CONNECTABLE (tc->address), NULL, on_ready_get_result, &result);

  while (result == NULL)
    g_main_context_iteration (NULL, TRUE);
  g_assert (result != NULL);
  io = cockpit_connect_stream_finish (result, &error);
  g_assert_no_error (error);
  g_object_unref (result);
  g_assert (io != NULL);

  while (tc->conn_sock == NULL)
    g_main_context_iteration (NULL, TRUE);

  g_object_unref (io);
}

static void
test_connect_loopback (TestConnect *tc,
                       gconstpointer user_data)
{
  CockpitConnectable connectable = { 0 };
  GAsyncResult *result = NULL;
  GError *error = NULL;
  GIOStream *io;

  if (tc->skip_ipv6_loopback)
    {
      cockpit_test_skip ("no loopback for ipv6 found");
      return;
    }

  connectable.address = cockpit_loopback_new (tc->port);
  cockpit_connect_stream_full (&connectable, NULL, on_ready_get_result, &result);
  g_object_unref (connectable.address);

  while (result == NULL)
    g_main_context_iteration (NULL, TRUE);
  g_assert (result != NULL);
  io = cockpit_connect_stream_finish (result, &error);
  g_assert_no_error (error);
  g_object_unref (result);
  g_assert (io != NULL);

  while (tc->conn_sock == NULL)
    g_main_context_iteration (NULL, TRUE);

  g_object_unref (io);
}

static void
test_fail_not_found (void)
{
  GAsyncResult *result = NULL;
  GSocketAddress *address;
  GError *error = NULL;
  GIOStream *io;

  address = g_unix_socket_address_new ("/non-existent");
  cockpit_connect_stream (G_SOCKET_CONNECTABLE (address), NULL, on_ready_get_result, &result);
  g_object_unref (address);

  while (result == NULL)
    g_main_context_iteration (NULL, TRUE);
  g_assert (result != NULL);
  io = cockpit_connect_stream_finish (result, &error);
  g_object_unref (result);
  g_assert (io == NULL);

  g_assert_error (error, G_IO_ERROR, G_IO_ERROR_NOT_FOUND);
  g_error_free (error);
}

static void
test_fail_access_denied (void)
{
  GAsyncResult *result = NULL;
  GSocketAddress *address;
  GError *error = NULL;
  GIOStream *io;
  gchar *unix_path;
  gint fd;

  if (geteuid () == 0)
    {
      cockpit_test_skip ("running as root");
      return;
    }

  unix_path = g_strdup ("/tmp/cockpit-test-XXXXXX.sock");
  fd = g_mkstemp (unix_path);
  g_assert_cmpint (fd, >=, 0);

  address = g_unix_socket_address_new ("/non-existent");
  cockpit_connect_stream (G_SOCKET_CONNECTABLE (address), NULL, on_ready_get_result, &result);
  g_object_unref (address);

  while (result == NULL)
    g_main_context_iteration (NULL, TRUE);
  g_assert (result != NULL);
  io = cockpit_connect_stream_finish (result, &error);
  g_object_unref (result);
  g_assert (io == NULL);

  g_assert_error (error, G_IO_ERROR, G_IO_ERROR_NOT_FOUND);
  g_error_free (error);

  g_free (unix_path);
}

int
main (int argc,
      char *argv[])
{
  cockpit_test_init (&argc, &argv);

  g_test_add ("/connect/simple", TestConnect, NULL,
              setup_connect, test_connect, teardown_connect);
  g_test_add ("/connect/loopback-ipv4", TestConnect, GINT_TO_POINTER (G_SOCKET_FAMILY_IPV4),
              setup_connect, test_connect_loopback, teardown_connect);
  g_test_add ("/connect/loopback-ipv6", TestConnect, GINT_TO_POINTER (G_SOCKET_FAMILY_IPV6),
              setup_connect, test_connect_loopback, teardown_connect);

  g_test_add_func ("/connect/not-found", test_fail_not_found);
  g_test_add_func ("/connect/access-denied", test_fail_access_denied);

  return g_test_run ();
}
