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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

#include "config.h"

#include "cockpitconnect.h"

#include "common/cockpitloopback.h"
#include "testlib/cockpittest.h"
#include "testlib/mock-transport.h"

#include <glib.h>
#include <glib-unix.h>
#include <glib/gstdio.h>
#include <gio/gunixsocketaddress.h>
#include <gio/gunixinputstream.h>
#include <gio/gunixoutputstream.h>

#include <sys/uio.h>
#include <string.h>

extern const gchar *cockpit_bridge_local_address;

/* ----------------------------------------------------------------------------
 * Mock
 */

static GType mock_echo_channel_get_type (void) G_GNUC_CONST;

typedef struct {
    CockpitChannel parent;
    gboolean close_called;
} MockEchoChannel;

typedef CockpitChannelClass MockEchoChannelClass;

G_DEFINE_TYPE (MockEchoChannel, mock_echo_channel, COCKPIT_TYPE_CHANNEL);

static void
mock_echo_channel_recv (CockpitChannel *channel,
                        GBytes *message)
{
  cockpit_channel_send (channel, message, FALSE);
}

static gboolean
mock_echo_channel_control (CockpitChannel *channel,
                           const gchar *command,
                           JsonObject *options)
{
  cockpit_channel_control (channel, command, options);
  return TRUE;
}

static void
mock_echo_channel_close (CockpitChannel *channel,
                         const gchar *problem)
{
  MockEchoChannel *self = (MockEchoChannel *)channel;
  self->close_called = TRUE;
  COCKPIT_CHANNEL_CLASS (mock_echo_channel_parent_class)->close (channel, problem);
}

static void
mock_echo_channel_init (MockEchoChannel *self)
{

}

static void
mock_echo_channel_class_init (MockEchoChannelClass *klass)
{
  CockpitChannelClass *channel_class = COCKPIT_CHANNEL_CLASS (klass);
  channel_class->recv = mock_echo_channel_recv;
  channel_class->control = mock_echo_channel_control;
  channel_class->close = mock_echo_channel_close;
}

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
      g_test_skip ("no loopback for ipv6 found");
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
      g_test_skip ("running as root");
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

  unlink (unix_path);
  g_free (unix_path);
  close (fd);
}

static void
test_parse_port (void)
{
  JsonObject *options;
  MockTransport *transport;
  CockpitChannel *channel;
  CockpitConnectable *connectable;
  GSocketAddress *address;
  GInetAddress *expected_ip;
  GInetAddress *got_ip; // owned by address
  gchar *name = NULL;

  expected_ip = g_inet_address_new_from_string (cockpit_bridge_local_address);

  options = json_object_new ();
  json_object_set_int_member (options, "port", 8090);
  transport = g_object_new (mock_transport_get_type (), NULL);

  channel = g_object_new (mock_echo_channel_get_type (),
                          "transport", transport,
                          "id", "55",
                          "options", options,
                          NULL);
  json_object_unref (options);
  connectable = cockpit_connect_parse_stream (channel);
  g_assert (connectable != NULL);

  address = cockpit_connect_parse_address (channel, &name);

  g_assert (g_socket_address_get_family (address) == G_SOCKET_FAMILY_IPV4);
  g_assert_cmpint (g_inet_socket_address_get_port ((GInetSocketAddress *)address),
                   ==, 8090);
  got_ip = g_inet_socket_address_get_address ((GInetSocketAddress *)address);
  g_assert (g_inet_address_equal (got_ip, expected_ip));

  g_assert_cmpint (connectable->local, ==, TRUE);

  g_object_unref (channel);
  cockpit_connectable_unref (connectable);
  g_object_unref (transport);
  g_object_unref (address);
  g_object_unref (expected_ip);
  g_free (name);
  cockpit_assert_expected ();
}

static void
test_parse_address (void)
{
  JsonObject *options;
  MockTransport *transport;
  CockpitChannel *channel;
  CockpitConnectable *connectable;
  GSocketAddress *address;
  GInetAddress *expected_ip;
  GInetAddress *got_ip; // owned by address
  gchar *name = NULL;

  expected_ip = g_inet_address_new_from_string ("10.1.1.1");

  options = json_object_new ();
  json_object_set_string_member (options, "address", "10.1.1.1");
  json_object_set_int_member (options, "port", 8090);
  transport = g_object_new (mock_transport_get_type (), NULL);

  channel = g_object_new (mock_echo_channel_get_type (),
                          "transport", transport,
                          "id", "55",
                          "options", options,
                          NULL);
  json_object_unref (options);
  connectable = cockpit_connect_parse_stream (channel);
  g_assert (connectable != NULL);

  address = cockpit_connect_parse_address (channel, &name);

  g_assert (g_socket_address_get_family (address) == G_SOCKET_FAMILY_IPV4);
  g_assert_cmpint (g_inet_socket_address_get_port ((GInetSocketAddress *)address),
                   ==, 8090);
  got_ip = g_inet_socket_address_get_address ((GInetSocketAddress *)address);
  g_assert (g_inet_address_equal (got_ip, expected_ip));

  g_assert_cmpint (connectable->local, ==, FALSE);

  g_object_unref (channel);
  cockpit_connectable_unref (connectable);
  g_object_unref (transport);
  g_object_unref (address);
  g_object_unref (expected_ip);
  g_free (name);
  cockpit_assert_expected ();
}

int
main (int argc,
      char *argv[])
{
  cockpit_bridge_local_address = "127.0.0.1";

  cockpit_test_init (&argc, &argv);

  g_test_add ("/connect/simple", TestConnect, NULL,
              setup_connect, test_connect, teardown_connect);
  g_test_add ("/connect/loopback-ipv4", TestConnect, GINT_TO_POINTER (G_SOCKET_FAMILY_IPV4),
              setup_connect, test_connect_loopback, teardown_connect);
  g_test_add ("/connect/loopback-ipv6", TestConnect, GINT_TO_POINTER (G_SOCKET_FAMILY_IPV6),
              setup_connect, test_connect_loopback, teardown_connect);

  g_test_add_func ("/connect/not-found", test_fail_not_found);
  g_test_add_func ("/connect/access-denied", test_fail_access_denied);

  g_test_add_func ("/channel/parse-port", test_parse_port);
  g_test_add_func ("/channel/parse-address", test_parse_address);

  return g_test_run ();
}
