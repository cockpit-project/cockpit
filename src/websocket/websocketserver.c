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

#include "websocketserver.h"
#include "websocketprivate.h"

#include <string.h>

enum {
  PROP_0,
  PROP_ORIGINS,
  PROP_PROTOCOLS,
  PROP_REQUEST_HEADERS,
  PROP_INPUT_BUFFER,
};

struct _WebSocketServer
{
  WebSocketConnection parent;

  gboolean protocol_chosen;
  gchar **allowed_origins;
  gchar **allowed_protocols;
  GHashTable *request_headers;
};

struct _WebSocketServerClass
{
  WebSocketConnectionClass parent;
};

G_DEFINE_TYPE (WebSocketServer, web_socket_server, WEB_SOCKET_TYPE_CONNECTION);

static void
web_socket_server_init (WebSocketServer *self)
{

}

static void
respond_handshake_forbidden (WebSocketConnection *conn)
{
  GError *error;

  const gchar *bad_request = "HTTP/1.1 403 Forbidden\r\n"
                             "Connection: close\r\n"
                             "\r\n"
                             "<html><head><title>403 Forbidden</title></head>\r\n"
                             "<body>Received invalid WebSocket request</body></html>\r\n";

  _web_socket_connection_queue (conn, WEB_SOCKET_QUEUE_URGENT | WEB_SOCKET_QUEUE_LAST,
                                g_strdup (bad_request), strlen (bad_request), 0);
  g_debug ("queued: forbidden request response");

  error = g_error_new_literal (WEB_SOCKET_ERROR,
                               WEB_SOCKET_CLOSE_PROTOCOL,
                               "Received invalid handshake request from the client");
  _web_socket_connection_error (conn, error);
}

static void
respond_handshake_bad (WebSocketConnection *conn)
{
  GError *error;

  const gchar *bad_request = "HTTP/1.1 400 Bad Request\r\n"
                             "Connection: close\r\n"
                             "\r\n"
                             "<html><head><title>400 Bad Request</title></head>\r\n"
                             "<body>Received invalid WebSocket request</body></html>\r\n";

  _web_socket_connection_queue (conn, WEB_SOCKET_QUEUE_URGENT | WEB_SOCKET_QUEUE_LAST,
                                g_strdup (bad_request), strlen (bad_request), 0);
  g_debug ("queued: bad request response");

  error = g_error_new_literal (WEB_SOCKET_ERROR,
                               WEB_SOCKET_CLOSE_PROTOCOL,
                               "Received invalid handshake request from the client");
  _web_socket_connection_error (conn, error);
}

gchar *
_web_socket_complete_accept_key_rfc6455 (const gchar *key)
{
  gsize digest_len = 20;
  guchar digest[digest_len];
  GChecksum *checksum;

  checksum = g_checksum_new (G_CHECKSUM_SHA1);
  g_return_val_if_fail (checksum != NULL, NULL);

  g_checksum_update (checksum, (guchar *)key, -1);

  /* magic from: http://tools.ietf.org/html/draft-ietf-hybi-thewebsocketprotocol-17 */
  g_checksum_update (checksum, (guchar *)"258EAFA5-E914-47DA-95CA-C5AB0DC85B11", -1);

  g_checksum_get_digest (checksum, digest, &digest_len);
  g_checksum_free (checksum);

  g_assert (digest_len == 20);

  return g_base64_encode (digest, digest_len);
}

static gboolean
validate_rfc6455_websocket_key (const gchar *key)
{
  /* The key must be 16 bytes base64 encoded */
  guchar *decoded;
  gsize length, len;
  len = strlen (key);
  if (len == 0 || len > 1024)
    return FALSE;
  decoded = g_base64_decode (key, &length);
  if (!decoded)
    return FALSE;
  g_free (decoded);
  return length == 16;
}

static gboolean
respond_handshake_rfc6455 (WebSocketServer *self,
                           WebSocketConnection *conn,
                           GHashTable *headers)
{
  const gchar *protocol;
  const gchar *origin;
  const gchar *host;
  gchar *accept_key;
  gchar *key;
  GString *handshake;
  gsize len;
  guint i;

  if (!_web_socket_util_header_equals (headers, "Upgrade", "websocket") ||
      !_web_socket_util_header_contains (headers, "Connection", "upgrade") ||
      !_web_socket_util_header_equals (headers, "Sec-WebSocket-Version", "13") ||
      !_web_socket_connection_choose_protocol (conn, (const gchar **)self->allowed_protocols,
                                               g_hash_table_lookup (headers, "Sec-WebSocket-Protocol")))
    {
      respond_handshake_bad (conn);
      return FALSE;
    }

  self->protocol_chosen = TRUE;

  key = g_hash_table_lookup (headers, "Sec-WebSocket-Key");
  if (key == NULL)
    {
      g_message ("received missing Sec-WebSocket-Key header");
      respond_handshake_bad (conn);
      return FALSE;
    }
  if (!validate_rfc6455_websocket_key (key))
    {
      g_message ("received invalid Sec-WebSocket-Key header: %s", key);
      respond_handshake_bad (conn);
      return FALSE;
    }

  host = g_hash_table_lookup (headers, "Host");
  if (host == NULL)
    {
      g_message ("received request without Host");
      respond_handshake_bad (conn);
      return FALSE;
    }

  if (self->allowed_origins)
    {
      origin = g_hash_table_lookup (headers, "Origin");
      if (!origin)
        {
          g_message ("received request without Origin");
          respond_handshake_forbidden (conn);
          return FALSE;
        }
      for (i = 0; self->allowed_origins[i] != NULL; i++)
        {
          if (g_ascii_strcasecmp (origin, self->allowed_origins[i]) == 0)
            break;
        }
      if (self->allowed_origins[i] == NULL)
        {
          g_message ("received request from bad Origin: %s", origin);
          respond_handshake_forbidden (conn);
          return FALSE;
        }
    }

  accept_key = _web_socket_complete_accept_key_rfc6455 (key);

  handshake = g_string_new ("");
  g_string_printf (handshake, "HTTP/1.1 101 Switching Protocols\r\n"
                              "Upgrade: websocket\r\n"
                              "Connection: Upgrade\r\n"
                              "Sec-WebSocket-Accept: %s\r\n",
                              (gchar *)accept_key);

  g_free (accept_key);

  protocol = web_socket_connection_get_protocol (conn);
  if (protocol)
    g_string_append_printf (handshake, "Sec-WebSocket-Protocol: %s\r\n", protocol);

  g_string_append (handshake, "\r\n");

  len = handshake->len;
  _web_socket_connection_queue (conn, WEB_SOCKET_QUEUE_URGENT,
                                g_string_free (handshake, FALSE), len, 0);
  g_debug ("queued response to rfc6455 handshake");

  return TRUE;
}

static gboolean
parse_handshake_request (WebSocketServer *self,
                         WebSocketConnection *conn,
                         GByteArray *incoming)
{
  GHashTable *headers;
  g_autofree gchar *method = NULL;
  g_autofree gchar *resource = NULL;
  gboolean valid;
  gssize in1, in2;
  gssize consumed;
  const gchar *url;

  /* Headers already passed from caller */
  if (self->request_headers)
    {
      headers = self->request_headers;
      self->request_headers = NULL;
      method = g_strdup ("GET");

      url = web_socket_connection_get_url (conn);
      if (!_web_socket_util_parse_url (url, NULL, NULL, &resource, NULL))
        resource = g_strdup ("/");

      consumed = 0;
    }
  else
    {
      /* Parse the handshake response received from the server */
      in1 = web_socket_util_parse_req_line ((const gchar *)incoming->data,
                                            incoming->len, &method, &resource);
      if (in1 < 0)
        {
          g_message ("received invalid request line");
          respond_handshake_bad (conn);
        }
      else if (in1 == 0)
        g_debug ("waiting for more handshake data");
      if (in1 <= 0)
        return FALSE;

      /* Read in the handshake request from the client */
      in2 = web_socket_util_parse_headers ((const gchar *)incoming->data + in1,
                                           incoming->len - in1, &headers);

      if (in2 < 0)
        {
          g_message ("received invalid response headers");
          respond_handshake_bad (conn);
        }
      else if (in2 == 0)
        g_debug ("waiting for more handshake data");
      if (in2 <= 0)
        return FALSE;

      consumed = in1 + in2;
    }

  if (!g_str_equal (method, "GET"))
    {
      g_message ("received unexpected method: %s %s", method, resource);
      valid = FALSE;
    }
  else
    {
      valid = respond_handshake_rfc6455 (self, conn, headers);
    }

  if (valid)
    {
      /* Handshake is successful */
      g_debug ("open: responded to handshake");
    }

  if (consumed > 0)
    g_byte_array_remove_range (incoming, 0, consumed);
  g_hash_table_unref (headers);

  return valid;
}

static gboolean
web_socket_server_handshake (WebSocketConnection *conn,
                             GByteArray *incoming)
{
  WebSocketServer *self = WEB_SOCKET_SERVER (conn);
  return parse_handshake_request (self, conn, incoming);
}

static void
web_socket_server_constructed (GObject *object)
{
  WebSocketConnection *conn = WEB_SOCKET_CONNECTION (object);
  GIOStream *io_stream;

  G_OBJECT_CLASS (web_socket_server_parent_class)->constructed (object);

  io_stream = web_socket_connection_get_io_stream (conn);
  if (io_stream == NULL)
    {
      g_critical ("server-side WebSocketConnection must be created "
                  "with a io-stream property");
    }
}

static void
web_socket_server_set_property (GObject *object,
                                guint prop_id,
                                const GValue *value,
                                GParamSpec *pspec)
{
  WebSocketServer *self = WEB_SOCKET_SERVER (object);

  switch (prop_id)
    {
    case PROP_ORIGINS:
      g_return_if_fail (self->allowed_origins == FALSE);
      self->allowed_origins = g_value_dup_boxed (value);
      break;

    case PROP_PROTOCOLS:
      g_return_if_fail (self->protocol_chosen == FALSE);
      g_strfreev (self->allowed_protocols);
      self->allowed_protocols = g_value_dup_boxed (value);
      break;

    case PROP_REQUEST_HEADERS:
      g_return_if_fail (self->request_headers == NULL);
      self->request_headers = g_value_dup_boxed (value);
      break;

    case PROP_INPUT_BUFFER:
      _web_socket_connection_take_incoming (WEB_SOCKET_CONNECTION (self),
                                            g_value_dup_boxed (value));
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;

    }
}

static void
web_socket_server_finalize (GObject *object)
{
  WebSocketServer *self = WEB_SOCKET_SERVER (object);

  g_strfreev (self->allowed_origins);
  g_strfreev (self->allowed_protocols);
  if (self->request_headers)
    g_hash_table_unref (self->request_headers);

  G_OBJECT_CLASS (web_socket_server_parent_class)->finalize (object);
}

static void
web_socket_server_class_init (WebSocketServerClass *klass)
{
  WebSocketConnectionClass *conn_class = WEB_SOCKET_CONNECTION_CLASS (klass);
  GObjectClass *object_class = G_OBJECT_CLASS (klass);

  object_class->constructed = web_socket_server_constructed;
  object_class->set_property = web_socket_server_set_property;
  object_class->finalize = web_socket_server_finalize;

  conn_class->server_behavior = TRUE;
  conn_class->handshake = web_socket_server_handshake;

  /**
   * WebSocketServer:origins:
   *
   * The allowed origins to receive client requests from.
   */
  g_object_class_install_property (object_class, PROP_ORIGINS,
                                   g_param_spec_boxed ("origins", "Possible Origins", "The possible HTTP origins", G_TYPE_STRV,
                                                        G_PARAM_WRITABLE | G_PARAM_STATIC_STRINGS));
  /**
   * WebSocketServer:protocols:
   *
   * The allowed protocols to negotiate with the client.
   */
  g_object_class_install_property (object_class, PROP_PROTOCOLS,
                                   g_param_spec_boxed ("protocols", "Possible Protocol", "The possible WebSocket protocols", G_TYPE_STRV,
                                                        G_PARAM_WRITABLE | G_PARAM_STATIC_STRINGS));

  /**
   * WebSocketServer:request-headers:
   *
   * If headers have already been parsed, passed in here.
   */
  g_object_class_install_property (object_class, PROP_REQUEST_HEADERS,
                                   g_param_spec_boxed ("request-headers", "Request Headers", "Already parsed headers", G_TYPE_HASH_TABLE,
                                                        G_PARAM_WRITABLE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));

  /**
   * WebSocketServer:input-buffer:
   *
   * When specifying a #WebSocketConnection:io-stream during construction,
   * if you've already read bytes (ie: containing an HTTP header) out of the
   * input stream, then you must pass in a buffer containing those initial bytes,
   * so the WebSocket can consume them.
   *
   * This is usually only useful for WebSocket server connections. See
   * web_socket_server_new_for_stream()
   */
  g_object_class_install_property (object_class, PROP_INPUT_BUFFER,
                                   g_param_spec_boxed ("input-buffer", "Input buffer", "Input buffer with seed data", G_TYPE_BYTE_ARRAY,
                                                       G_PARAM_WRITABLE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));

}

/**
 * web_socket_server_new_for_stream:
 * @url: the url address of the WebSocket
 * @origins: (allow-none): the origin to expect the client to report
 * @protocols: (allow-none): possible protocols for the client to
 * @io_stream: the IO stream to communicate over
 * @request_headers: (allow-none): already parsed headers, or %NULL
 * @input_buffer: (allow-none): initial bytes already read from the input stream, or %NULL
 *
 * Create a new server side WebSocket connection to communicate with a client.
 *
 * Since callers may have already read some bytes from the inputstream (ie:
 * the HTTP header Request-Line) those bytes should be included in the
 * @input_buffer argument so that the WebSocket can consume them.
 *
 * If @protocols are specified then these are used to negotiate a protocol
 * with the client.
 *
 * The input and output streams of the @io_stream must be pollable.
 *
 * If the input stream on the @io_stream has already been read, those
 * read bytes should be passed in the @input_buffer byte array.
 *
 * In addition if the HTTP headers have already been parsed, they should be
 * passed in using the @request_headers hash table. This should be a hash table
 * setup for case-insensitive lookups, as created by web_socket_util_new_headers().
 * When passing in headers, fill in @input_buffer with any of the HTTP body
 * read from the input stream (ie: after the \r\n\r\n).
 *
 * Returns: (transfer full): a new WebSocket
 */
WebSocketConnection *
web_socket_server_new_for_stream (const gchar *url,
                                  const gchar * const *origins,
                                  const gchar * const *protocols,
                                  GIOStream *io_stream,
                                  GHashTable *request_headers,
                                  GByteArray *input_buffer)
{
  return g_object_new (WEB_SOCKET_TYPE_SERVER,
                       "url", url,
                       "origins", origins,
                       "protocols", protocols,
                       "io-stream", io_stream,
                       "request-headers", request_headers,
                       "input-buffer", input_buffer,
                       NULL);
}
