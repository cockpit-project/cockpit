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

CockpitConnectable *
cockpit_connectable_ref (CockpitConnectable *connectable)
{
  g_return_val_if_fail (connectable != NULL, NULL);

  if (connectable->refs <= 0)
    {
      connectable = g_memdup (connectable, sizeof (CockpitConnectable));
      g_object_ref (connectable->address);
      if (connectable->tls_cert)
        g_object_ref (connectable->tls_cert);
      if (connectable->tls_database)
        g_object_ref (connectable->tls_database);
      connectable->name = g_strdup (connectable->name ? connectable->name : "connect");
      connectable->refs = 1;
    }
  else
    {
      connectable->refs++;
    }

  return connectable;
}

void
cockpit_connectable_unref (gpointer data)
{
  CockpitConnectable *connectable = data;

  g_return_if_fail (connectable != NULL);
  g_return_if_fail (connectable->refs > 0);

  if (--connectable->refs == 0)
    {
      if (connectable->tls_cert)
        g_object_unref (connectable->tls_cert);
      if (connectable->tls_database)
        g_object_unref (connectable->tls_database);
      g_object_unref (connectable->address);
      g_free (connectable->name);
      g_free (connectable);
    }
}

typedef struct {
  CockpitConnectable *connectable;
  GSocketAddressEnumerator *enumerator;
  GCancellable *cancellable;
  GIOStream *io;
  GError *error;
} ConnectStream;

static void
connect_stream_free (gpointer data)
{
  ConnectStream *cs = data;
  if (cs->connectable)
    cockpit_connectable_unref (cs->connectable);
  if (cs->cancellable)
    g_object_unref (cs->cancellable);
  g_object_unref (cs->enumerator);
  g_clear_error (&cs->error);
  if (cs->io)
    g_object_unref (cs->io);
  g_free (cs);
}

static void
on_address_next (GObject *object,
                 GAsyncResult *result,
                 gpointer user_data);

static void
on_socket_connect (GObject *object,
                   GAsyncResult *result,
                   gpointer user_data)
{
  GSimpleAsyncResult *simple = G_SIMPLE_ASYNC_RESULT (user_data);
  ConnectStream *cs = g_simple_async_result_get_op_res_gpointer (simple);
  CockpitConnectable *connectable = cs->connectable;
  GError *error = NULL;

  g_socket_connection_connect_finish (G_SOCKET_CONNECTION (object), result, &error);

  g_debug ("%s: connected", connectable->name);

  if (error)
    {
      g_debug ("%s: couldn't connect: %s", connectable->name, error->message);
      g_clear_error (&cs->error);
      cs->error = error;

      g_socket_address_enumerator_next_async (cs->enumerator, cs->cancellable,
                                              on_address_next, g_object_ref (simple));
    }
  else
    {
      g_debug ("%s: connected", connectable->name);

      if (connectable->tls)
        {
          cs->io = g_tls_client_connection_new (G_IO_STREAM (object), NULL, &error);
          if (cs->io)
            {
              g_debug ("%s: tls handshake", connectable->name);

              g_tls_client_connection_set_validation_flags (G_TLS_CLIENT_CONNECTION (cs->io),
                                                            connectable->tls_flags);

              if (connectable->tls_cert)
                g_tls_connection_set_certificate (G_TLS_CONNECTION (cs->io), connectable->tls_cert);
              if (connectable->tls_database)
                g_tls_connection_set_database (G_TLS_CONNECTION (cs->io), connectable->tls_database);

              /* We track data end the same way we do for HTTP */
              g_tls_connection_set_require_close_notify (G_TLS_CONNECTION (cs->io), FALSE);
            }

          else if (error)
            {
              g_debug ("%s: couldn't open tls connection: %s", connectable->name, error->message);
              g_clear_error (&cs->error);
              cs->error = error;
            }
        }
      else
        {
          cs->io = g_object_ref (object);
        }

      g_simple_async_result_complete (simple);
    }

  g_object_unref (object);
  g_object_unref (simple);
}

static void
on_address_next (GObject *object,
                 GAsyncResult *result,
                 gpointer user_data)
{
  GSimpleAsyncResult *simple = G_SIMPLE_ASYNC_RESULT (user_data);
  ConnectStream *cs = g_simple_async_result_get_op_res_gpointer (simple);
  CockpitConnectable *connectable = cs->connectable;
  GSocketConnection *connection;
  GSocketAddress *address;
  GError *error = NULL;
  GSocket *sock;

  address = g_socket_address_enumerator_next_finish (G_SOCKET_ADDRESS_ENUMERATOR (object),
                                                     result, &error);

  if (error)
    {
      g_debug ("%s: couldn't resolve: %s", connectable->name, error->message);
      g_clear_error (&cs->error);
      cs->error = error;
      g_simple_async_result_complete (simple);
    }
  else if (address)
    {
      sock = g_socket_new (g_socket_address_get_family (address), G_SOCKET_TYPE_STREAM, 0, &error);
      if (sock)
        {
          g_socket_set_blocking (sock, FALSE);

          connection = g_socket_connection_factory_create_connection (sock);
          g_object_unref (sock);

          g_socket_connection_connect_async (connection, address, cs->cancellable,
                                             on_socket_connect, g_object_ref (simple));
        }

      if (error)
        {
          g_debug ("%s: couldn't open socket: %s", connectable->name, error->message);
          g_clear_error (&cs->error);
          cs->error = error;
          g_simple_async_result_complete (simple);
        }
      g_object_unref (address);
    }
  else
    {
      if (!cs->error)
          g_message ("%s: no addresses found", connectable->name);
      g_simple_async_result_complete (simple);
    }

  g_object_unref (simple);
}

void
cockpit_connect_stream (GSocketConnectable *address,
                        GCancellable *cancellable,
                        GAsyncReadyCallback callback,
                        gpointer user_data)
{
  CockpitConnectable connectable = { .address = address };

  g_return_if_fail (G_IS_SOCKET_CONNECTABLE (address));
  g_return_if_fail (!cancellable || G_IS_CANCELLABLE (cancellable));

  cockpit_connect_stream_full (&connectable, cancellable, callback, user_data);
}

void
cockpit_connect_stream_full (CockpitConnectable *connectable,
                             GCancellable *cancellable,
                             GAsyncReadyCallback callback,
                             gpointer user_data)
{
  GSimpleAsyncResult *simple;
  ConnectStream *cs;

  g_return_if_fail (connectable != NULL);
  g_return_if_fail (G_IS_SOCKET_CONNECTABLE (connectable->address));
  g_return_if_fail (!cancellable || G_IS_CANCELLABLE (cancellable));

  simple = g_simple_async_result_new (NULL, callback, user_data, cockpit_connect_stream);
  cs = g_new0 (ConnectStream, 1);
  cs->connectable = cockpit_connectable_ref (connectable);
  cs->cancellable = cancellable ? g_object_ref (cancellable) : NULL;
  cs->enumerator = g_socket_connectable_enumerate (connectable->address);
  g_simple_async_result_set_op_res_gpointer (simple, cs, connect_stream_free);

  g_socket_address_enumerator_next_async (cs->enumerator, NULL,
                                          on_address_next, g_object_ref (simple));

  g_object_unref (simple);
}

GIOStream *
cockpit_connect_stream_finish (GAsyncResult *result,
                               GError **error)
{
  GSimpleAsyncResult *simple;
  ConnectStream *cs;

  g_return_val_if_fail (g_simple_async_result_is_valid (result, NULL, cockpit_connect_stream), NULL);

  simple = G_SIMPLE_ASYNC_RESULT (result);
  cs = g_simple_async_result_get_op_res_gpointer (simple);

  if (cs->io)
    {
      return g_object_ref (cs->io);
    }
  else if (cs->error)
    {
      g_propagate_error (error, cs->error);
      cs->error = NULL;
      return NULL;
    }
  else
    {
      g_set_error (error, G_IO_ERROR, G_IO_ERROR_HOST_NOT_FOUND, "No addresses found");
      return NULL;
    }
}
