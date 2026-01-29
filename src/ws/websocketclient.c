/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013 Red Hat, Inc.
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

#include "websocketclient.h"
#include "websocketprivate.h"

#include <string.h>

enum {
  PROP_0,
  PROP_ORIGIN,
  PROP_PROTOCOLS,
};

struct _WebSocketClient
{
  WebSocketConnection parent;

  gboolean handshake_started;
  gchar *origin;
  gchar **possible_protocols;
  gpointer accept_key;
  GHashTable *include_headers;
  GHashTable *response_headers;
  GCancellable *cancellable;
  GSource *idle_start;
};

struct _WebSocketClientClass
{
  WebSocketConnectionClass parent;
};

G_DEFINE_TYPE (WebSocketClient, web_socket_client, WEB_SOCKET_TYPE_CONNECTION);

static void
web_socket_client_init (WebSocketClient *self)
{

}

static void
protocol_error_and_close (WebSocketConnection *conn)
{
  GError *error = g_error_new_literal (WEB_SOCKET_ERROR,
                                       WEB_SOCKET_CLOSE_PROTOCOL,
                                       "Received invalid WebSocket handshake from the server");
  _web_socket_connection_error_and_close (conn, error, TRUE);
}

static gboolean
verify_handshake_rfc6455 (WebSocketClient *self,
                          WebSocketConnection *conn,
                          GHashTable *headers)
{
  const gchar *value;

  /*
   * This is a client verifying a handshake response it's received
   * from the server.
   */

  if (!_web_socket_util_header_equals (headers, "Upgrade", "websocket") ||
      !_web_socket_util_header_contains (headers, "Connection", "upgrade") ||
      !_web_socket_connection_choose_protocol (conn, (const gchar **)self->possible_protocols,
                                               g_hash_table_lookup (headers, "Sec-Websocket-Protocol")) ||
      !_web_socket_util_header_empty (headers, "Sec-WebSocket-Extensions"))
    {
      protocol_error_and_close (conn);
      return FALSE;
    }

  /*
   * We filled in accept_key when we did a handshake request
   * earlier in request_handshake_rfc6455().
   */
  value = g_hash_table_lookup (headers, "Sec-WebSocket-Accept");
  if (value == NULL || self->accept_key == NULL ||
      g_ascii_strcasecmp (self->accept_key, value))
    {
      g_message ("received invalid or missing Sec-WebSocket-Accept header: %s", value);
      protocol_error_and_close (conn);
      return FALSE;
    }

  g_debug ("verified rfc6455 handshake");
  return TRUE;
}

static gboolean
parse_handshake_response (WebSocketClient *self,
                          WebSocketConnection *conn,
                          GByteArray *incoming)
{
  GHashTable *headers;
  gchar *reason;
  gboolean verified;
  guint status;
  GError *error = NULL;
  gssize in1, in2;
  gssize consumed;

  /* Parse the handshake response received from the server */
  in1 = web_socket_util_parse_status_line ((const gchar *)incoming->data,
                                           incoming->len, NULL, &status, &reason);
  if (in1 < 0)
    {
      g_message ("received invalid status line");
      protocol_error_and_close (conn);
    }
  else if (in1 == 0)
    g_debug ("waiting for more handshake data");
  if (in1 <= 0)
    return FALSE;

  in2 = web_socket_util_parse_headers ((const gchar *)incoming->data + in1,
                                       incoming->len - in1, &headers);
  if (in2 < 0)
    {
      g_message ("received invalid response headers");
      protocol_error_and_close (conn);
    }
  else if (in2 == 0)
    g_debug ("waiting for more handshake data");
  if (in2 <= 0)
    {
      g_free (reason);
      return FALSE;
    }

  consumed = in1 + in2;

  if (self->response_headers)
    g_hash_table_unref (self->response_headers);
  self->response_headers = headers;

  /*
   * TODO: We could handle the following codes here:
   *  401: authentication
   *  3xx: redirect
   */

  if (status == 101)
    {
      verified = verify_handshake_rfc6455 (self, conn, headers);
      if (verified)
        {
          /* Handshake is successful */
          g_debug ("open: handshake completed");
        }
    }
  else
    {
      verified = FALSE;
      g_message ("received unexpected status: %d %s", status, reason);
      if (reason == NULL)
        error = g_error_new (WEB_SOCKET_ERROR,
                             WEB_SOCKET_CLOSE_PROTOCOL,
                             "Handshake failed: %u", status);
      else
        error = g_error_new (WEB_SOCKET_ERROR,
                             WEB_SOCKET_CLOSE_PROTOCOL,
                             "%s", reason);
      _web_socket_connection_error_and_close (conn, error, FALSE);
    }

  g_free (reason);
  if (consumed > 0)
    g_byte_array_remove_range (incoming, 0, consumed);
  return verified;
}

static void
include_custom_headers (WebSocketClient *self,
                        GString *handshake)
{
  GHashTableIter iter;
  gpointer name;
  gpointer value;

  if (!self->include_headers)
    return;

  g_hash_table_iter_init (&iter, self->include_headers);
  while (g_hash_table_iter_next (&iter, &name, &value))
    {
      if (value == NULL)
        continue;
      g_debug ("including custom header: %s: %s", (gchar *)name, (gchar *)value);
      g_string_append_printf (handshake, "%s: %s\r\n",
                              (gchar *)name, (gchar *)value);
    }
}

static void
request_handshake_rfc6455 (WebSocketClient *self,
                           WebSocketConnection *conn,
                           const gchar *host,
                           const gchar *path)
{
  gchar *key;
  gchar *protocols;
  GString *handshake;
  guint32 raw[4];
  gsize len;

  raw[0] = g_random_int ();
  raw[1] = g_random_int ();
  raw[2] = g_random_int ();
  raw[3] = g_random_int ();
  G_STATIC_ASSERT (sizeof (raw) == 16);
  key = g_base64_encode ((const guchar *)raw, sizeof (raw));

  /* Save this for verify_handshake_rfc6455() */
  g_free (self->accept_key);
  self->accept_key = _web_socket_complete_accept_key_rfc6455 (key);

  handshake = g_string_new ("");
  g_string_printf (handshake, "GET %s HTTP/1.1\r\n"
                              "Host: %s\r\n"
                              "Upgrade: websocket\r\n"
                              "Connection: Upgrade\r\n"
                              "Sec-WebSocket-Key: %s\r\n"
                              "Sec-WebSocket-Version: 13\r\n",
                              path, host, key);

  /* RFC 6454 talks about 'null' */
  g_string_append_printf (handshake, "Origin: %s\r\n", self->origin ? self->origin : "null");

  if (self->possible_protocols)
    {
      protocols = g_strjoinv (", ", self->possible_protocols);
      g_string_append_printf (handshake, "Sec-WebSocket-Protocol: %s\r\n", protocols);
      g_free (protocols);
    }

  include_custom_headers (self, handshake);
  g_string_append (handshake, "\r\n");

  g_free (key);

  len = handshake->len;
  _web_socket_connection_queue (conn, WEB_SOCKET_QUEUE_URGENT,
                                g_string_free (handshake, FALSE), len, 0);
  g_debug ("queued rfc6455 handshake request");
}

static void
request_handshake (WebSocketClient *self,
                   WebSocketConnection *conn)
{
  GError *error = NULL;
  const gchar *url;
  gchar *host;
  gchar *path;

  self->handshake_started = TRUE;

  url = web_socket_connection_get_url (conn);
  if (!_web_socket_util_parse_url (url, NULL, &host, &path, &error))
    {
      _web_socket_connection_error_and_close (conn, error, TRUE);
      return;
    }

  request_handshake_rfc6455 (self, conn, host, path);

  g_free (host);
  g_free (path);
}

static gpointer
on_idle_do_handshake (gpointer user_data)
{
  WebSocketClient *self = WEB_SOCKET_CLIENT (user_data);
  WebSocketConnection *conn = WEB_SOCKET_CONNECTION (user_data);
  g_source_unref (self->idle_start);
  self->idle_start = NULL;
  request_handshake (self, conn);
  return FALSE;
}

static void
on_connect_to_uri (GObject *source,
                   GAsyncResult *result,
                   gpointer user_data)
{
  WebSocketClient *self = WEB_SOCKET_CLIENT (user_data);
  WebSocketConnection *conn = WEB_SOCKET_CONNECTION (user_data);
  GSocketConnection *connection;
  GError *error = NULL;

  connection = g_socket_client_connect_to_uri_finish (G_SOCKET_CLIENT (source),
                                                      result, &error);

  if (error == NULL)
    {
      _web_socket_connection_take_io_stream (conn, G_IO_STREAM (connection));
      request_handshake (self, conn);
    }
  else if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_CANCELLED))
    {
      g_error_free (error);
    }
  else
    {
      _web_socket_connection_error_and_close (conn, error, TRUE);
    }

  g_object_unref (self);
}

static void
web_socket_client_constructed (GObject *object)
{
  WebSocketClient *self = WEB_SOCKET_CLIENT (object);
  WebSocketConnection *conn = WEB_SOCKET_CONNECTION (object);
  GSocketClient *client;
  const gchar *url;
  guint16 default_port;
  gchar *scheme;

  G_OBJECT_CLASS (web_socket_client_parent_class)->constructed (object);

  if (web_socket_connection_get_io_stream (conn))
    {
      /* Start handshake from the main context */
      self->idle_start = g_idle_source_new ();
      g_source_set_priority (self->idle_start, G_PRIORITY_HIGH);
      g_source_set_callback (self->idle_start, (GSourceFunc)on_idle_do_handshake,
                             self, NULL);
      g_source_attach (self->idle_start, _web_socket_connection_get_main_context (conn));
    }
  else
    {
      client = g_socket_client_new ();
      self->cancellable = g_cancellable_new ();

      url = web_socket_connection_get_url (WEB_SOCKET_CONNECTION (self));
      scheme = g_uri_parse_scheme (url);
      if (scheme && (g_str_equal (scheme, "wss") || g_str_equal (scheme, "https")))
        {
          g_socket_client_set_tls (client, TRUE);
          default_port = 443;
        }
      else
        {
          default_port = 80;
        }
      g_free (scheme);

      g_socket_client_connect_to_uri_async (client, url, default_port,
                                            self->cancellable, on_connect_to_uri,
                                            g_object_ref (self));
      g_object_unref (client);
    }
}

static gboolean
web_socket_client_handshake (WebSocketConnection *conn,
                             GByteArray *incoming)
{
  WebSocketClient *self = WEB_SOCKET_CLIENT (conn);
  return parse_handshake_response (self, conn, incoming);
}

static void
web_socket_client_set_property (GObject *object,
                                guint prop_id,
                                const GValue *value,
                                GParamSpec *pspec)
{
  WebSocketClient *self = WEB_SOCKET_CLIENT (object);

  switch (prop_id)
    {
    case PROP_ORIGIN:
      g_return_if_fail (self->origin == NULL);
      self->origin = g_value_dup_string (value);
      break;

    case PROP_PROTOCOLS:
      g_return_if_fail (self->handshake_started == FALSE);
      g_strfreev (self->possible_protocols);
      self->possible_protocols = g_value_dup_boxed (value);
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
web_socket_client_close (WebSocketConnection *conn)
{
  WebSocketClient *self = WEB_SOCKET_CLIENT (conn);

  if (self->cancellable)
    g_cancellable_cancel (self->cancellable);
  if (self->idle_start)
    {
      g_source_destroy (self->idle_start);
      g_source_unref (self->idle_start);
    }
}

static void
web_socket_client_finalize (GObject *object)
{
  WebSocketClient *self = WEB_SOCKET_CLIENT (object);

  g_strfreev (self->possible_protocols);
  g_free (self->origin);
  g_free (self->accept_key);
  if (self->include_headers)
    g_hash_table_unref (self->include_headers);
  if (self->response_headers)
    g_hash_table_unref (self->response_headers);
  if (self->cancellable)
    g_object_unref (self->cancellable);
  g_assert (self->idle_start == NULL);

  G_OBJECT_CLASS (web_socket_client_parent_class)->finalize (object);
}

static void
web_socket_client_class_init (WebSocketClientClass *klass)
{
  WebSocketConnectionClass *conn_class = WEB_SOCKET_CONNECTION_CLASS (klass);
  GObjectClass *object_class = G_OBJECT_CLASS (klass);

  object_class->constructed = web_socket_client_constructed;
  object_class->set_property = web_socket_client_set_property;
  object_class->finalize = web_socket_client_finalize;

  conn_class->server_behavior = FALSE;
  conn_class->handshake = web_socket_client_handshake;
  conn_class->close = web_socket_client_close;

  /**
   * WebSocketClient:origin:
   *
   * The WebSocket origin. Client WebSockets will send this to the server. If
   * set on a server, then only clients with the matching origin will be accepted.
   */
  g_object_class_install_property (object_class, PROP_ORIGIN,
                                   g_param_spec_string ("origin", "Origin", "The WebSocket origin", NULL,
                                                        G_PARAM_WRITABLE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));

  /**
   * WebSocketClient:protocols:
   *
   * The possible protocols to negotiate with the peer.
   */
  g_object_class_install_property (object_class, PROP_PROTOCOLS,
                                   g_param_spec_boxed ("protocols", "Protocol", "The desired WebSocket protocols", G_TYPE_STRV,
                                                        G_PARAM_WRITABLE | G_PARAM_STATIC_STRINGS));
}

/**
 * web_socket_client_new:
 * @url: the url address of the WebSocket
 * @origin: (allow-none): the origin to report to server
 * @protocols: (allow-none): possible protocols to negotiate
 *
 * Create a new client side WebSocket connection to communicate with a server.
 *
 * The WebSocket will establish a connection to the server using HTTP
 * or HTTPS at the address specified in the @url.
 *
 * If @protocols are specified then these are used to negotiate a protocol
 * with the client.
 *
 * Returns: (transfer full): a new WebSocket
 */
WebSocketConnection *
web_socket_client_new (const gchar *url,
                       const gchar *origin,
                       const gchar **protocols)
{
  return g_object_new (WEB_SOCKET_TYPE_CLIENT,
                       "url", url,
                       "origin", origin,
                       "protocols", protocols,
                       NULL);
}

/**
 * web_socket_client_new_for_stream:
 * @url: the url address of the WebSocket
 * @origin: (allow-none): the origin to report to server
 * @protocols: (allow-none): possible protocols to negotiate
 * @io_stream: the IO stream to communicate over
 *
 * Create a new client side WebSocket connection to communicate with a server.
 *
 * Use this function if you've already opened up a IO stream to the server
 * and now wish to communicate over it. The input and output streams of the
 * @io_stream must be pollable.
 *
 * If @protocols are specified then these are used to negotiate a protocol
 * with the client.
 *
 * Returns: (transfer full): a new WebSocket
 */
WebSocketConnection *
web_socket_client_new_for_stream (const gchar *url,
                                  const gchar *origin,
                                  const gchar **protocols,
                                  GIOStream *io_stream)
{
  return g_object_new (WEB_SOCKET_TYPE_CLIENT,
                       "url", url,
                       "origin", origin,
                       "protocols", protocols,
                       "io-stream", io_stream,
                       NULL);
}

/**
 * web_socket_client_include_header:
 * @self: the client
 * @name: the header name
 * @value: the header value
 *
 * Add an HTTP header (eg: for authentication) to the
 * HTTP request.
 */
void
web_socket_client_include_header (WebSocketClient *self,
                                  const gchar *name,
                                  const gchar *value)
{
  g_return_if_fail (WEB_SOCKET_IS_CLIENT (self));
  g_return_if_fail (self->handshake_started == FALSE);

  if (!self->include_headers)
      self->include_headers = web_socket_util_new_headers ();
  g_hash_table_insert (self->include_headers,
                       g_strdup (name), g_strdup (value));
}

GHashTable *
web_socket_client_get_headers (WebSocketClient *self)
{
  g_return_val_if_fail (WEB_SOCKET_IS_CLIENT (self), NULL);
  return self->response_headers;
}
