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

#include "websocket.h"
#include "websocketprivate.h"

#include "common/cockpitflow.h"

#include <string.h>

/*
 * SECTION:websocketconnection
 * @title: WebSocketConnection
 * @short_description: A WebSocket connection
 *
 * A #WebSocketConnection is a WebSocket connection to a peer. This API is modeled
 * after the W3C API for interacting with WebSockets.
 *
 * Use the #WebSocketClient or #WebSocketServer derived classes on the
 * appropriate sides. As a client, to connect to a Websocket server, use the
 * web_socket_client_new() function. To handle a WebSocket connection from
 * a client, you can use the web_socket_server_new_for_stream() function.
 *
 * The #WebSocketConnection:ready-state property will indicate the state of the
 * connection. You can only send messages once the connection is in the
 * %WEB_SOCKET_STATE_OPEN state. The #WebSocketConnection::open signal will fire
 * when transitioning to this state.
 *
 * Use web_socket_connection_send() to send a message to the peer. When a
 * message is received the #WebSocketConnection::message signal will fire.
 *
 * The web_socket_connection_close() function will perform an orderly close
 * of the connection. The #WebSocketConnection::close signal will fire once
 * the connection closes, whether it was initiated by this side or the peer.
 *
 * Connect to the #WebSocketConnection::closing signal to detect when either
 * peer begins closing the connection. You can prevent closure of this side
 * by returning %FALSE from the signal handler. You should in that case
 * call the web_socket_connection_close() function at a later time to complete
 * the close.
 */

/**
 * WebSocketConnection:
 *
 * An abstract base class representing a WebSocket connection. Use
 * instances of the derived #WebSocketClient or #WebSocketServer classes.
 */

/**
 * WebSocketConnectionClass:
 * @server_behavior: set by #WebSocketServer to %TRUE
 * @handshake: used by derived classes to handle received HTTP handshake
 * @open: default handler for the #WebSocketConnection::open signal
 * @message: default handler for the #WebSocketConnection::message signal
 * @error: default handler for the #WebSocketConnection::error signal
 * @closing: the default handler for the #WebSocketConnection:closing signal
 * @close: default handler for the #WebSocketConnection::close signal
 *
 * The abstract base class for #WebSocketConnection
 */

enum {
  PROP_0,
  PROP_URL,
  PROP_PROTOCOL,
  PROP_READY_STATE,
  PROP_BUFFERED_AMOUNT,
  PROP_IO_STREAM,
};

enum {
  OPEN,
  MESSAGE,
  ERROR,
  CLOSING,
  CLOSE,
  NUM_SIGNALS
};

static guint signals[NUM_SIGNALS] = { 0, };

typedef struct {
  GBytes *data;
  gboolean last;
  gsize sent;
  gsize amount;
} Frame;

typedef struct
{
  /* FALSE if client, TRUE if server */
  gboolean server_side;

  /*
   * On the client this is the url we connect to,
   * on the server, the one the socket lives at
   */
  gchar *url;
  gchar *chosen_protocol;

  GSource *start_idle;
  gboolean handshake_done;

  gushort peer_close_code;
  gchar *peer_close_data;
  gboolean close_sent;
  gboolean close_received;
  gboolean dirty_close;
  GSource *close_timeout;

  GMainContext *main_context;

  GIOStream *io_stream;
  gboolean io_open;
  gboolean io_closed;

  GPollableInputStream *input;
  GSource *input_source;
  GByteArray *incoming;

  GPollableOutputStream *output;
  GSource *output_source;
  gsize output_queued;
  GQueue outgoing;

  /* Current message being assembled */
  guint8 message_opcode;
  GByteArray *message_data;

  /* Pressure which throttles input on this web socket */
  CockpitFlow *pressure;
  gulong pressure_sig;
} WebSocketConnectionPrivate;

#define MAX_PAYLOAD   128 * 1024

/* The queue size above which we consider applying back pressure */
#define QUEUE_PRESSURE       1UL * 1024UL * 1024UL /* 1 megabyte */

static void    web_socket_connection_flow_iface_init        (CockpitFlowInterface *iface);

G_DEFINE_ABSTRACT_TYPE_WITH_CODE (WebSocketConnection, web_socket_connection, G_TYPE_OBJECT,
                                  G_ADD_PRIVATE(WebSocketConnection)
                                  G_IMPLEMENT_INTERFACE (COCKPIT_TYPE_FLOW, web_socket_connection_flow_iface_init));

#define GET_PRIV(self) ((WebSocketConnectionPrivate *) web_socket_connection_get_instance_private(self))

static void
frame_free (gpointer data)
{
  Frame *frame = data;
  if (frame)
    {
      g_bytes_unref (frame->data);
      g_slice_free (Frame, frame);
    }
}

static void
web_socket_connection_init (WebSocketConnection *self)
{
  WebSocketConnectionPrivate *pv = web_socket_connection_get_instance_private (self);

  g_queue_init (&pv->outgoing);
  pv->main_context = g_main_context_ref_thread_default ();
}

static void
on_iostream_closed (GObject *source,
                    GAsyncResult *result,
                    gpointer user_data)
{
  WebSocketConnection *self = user_data;
  WebSocketConnectionPrivate *pv = web_socket_connection_get_instance_private (self);
  GError *error = NULL;
  gboolean unused;

  /* We treat connection as closed even if close fails */
  pv->io_closed = TRUE;
  g_io_stream_close_finish (pv->io_stream, result, &error);

  if (error)
    {
      g_message ("error closing web socket stream: %s", error->message);
      if (!pv->dirty_close)
        g_signal_emit (self, signals[ERROR], 0, error, &unused);
      pv->dirty_close = TRUE;
      g_error_free (error);
    }

  g_assert (web_socket_connection_get_ready_state (self) == WEB_SOCKET_STATE_CLOSED);
  g_debug ("closed: completed io stream close");
  g_signal_emit (self, signals[CLOSE], 0);

  g_object_unref (self);
}

static void
stop_input (WebSocketConnection *self)
{
  WebSocketConnectionPrivate *pv = web_socket_connection_get_instance_private (self);

  if (pv->input_source)
    {
      g_debug ("stopping input source");
      g_source_destroy (pv->input_source);
      g_source_unref (pv->input_source);
      pv->input_source = NULL;
    }
}

static void
stop_output (WebSocketConnection *self)
{
  WebSocketConnectionPrivate *pv = web_socket_connection_get_instance_private (self);

  if (pv->output_source)
    {
      g_debug ("stopping output source");
      g_source_destroy (pv->output_source);
      g_source_unref (pv->output_source);
      pv->output_source = NULL;
    }
}

static void
close_io_stop_timeout (WebSocketConnection *self)
{
  WebSocketConnectionPrivate *pv = web_socket_connection_get_instance_private (self);

  if (pv->close_timeout)
    {
      g_source_destroy (pv->close_timeout);
      g_source_unref (pv->close_timeout);
      pv->close_timeout = NULL;
    }

  if (pv->start_idle)
    {
      g_source_destroy (pv->start_idle);
      g_source_unref (pv->start_idle);
      pv->start_idle = NULL;
    }
}

static void
close_io_stream (WebSocketConnection *self)
{
  WebSocketConnectionPrivate *pv = web_socket_connection_get_instance_private (self);

  close_io_stop_timeout (self);

  /* Close a connection that's not yet open */
  if (!pv->io_stream && !pv->io_closed)
    {
      pv->io_closed = TRUE;
      g_assert (web_socket_connection_get_ready_state (self) == WEB_SOCKET_STATE_CLOSED);
      g_debug ("closed: no stream was opened");
      g_signal_emit (self, signals[CLOSE], 0);
    }

  /* Close an open stream, which is not yet close_async'ing */
  else if (pv->io_open)
    {
      stop_input (self);
      stop_output (self);
      pv->io_open = FALSE;
      g_debug ("closing io stream");
      g_io_stream_close_async (pv->io_stream, G_PRIORITY_DEFAULT,
                               NULL, on_iostream_closed, g_object_ref (self));
    }

  g_object_notify (G_OBJECT (self), "ready-state");
}

static void
shutdown_wr_io_stream (WebSocketConnection *self)
{
  WebSocketConnectionPrivate *pv = web_socket_connection_get_instance_private (self);
  GSocket *socket;
  GError *error = NULL;

  stop_output (self);

  if (G_IS_SOCKET_CONNECTION (pv->io_stream))
    {
      socket = g_socket_connection_get_socket (G_SOCKET_CONNECTION (pv->io_stream));
      g_socket_shutdown (socket, FALSE, TRUE, &error);
      if (error != NULL)
        {
          g_message ("error shutting down io stream: %s", error->message);
          g_error_free (error);
        }
    }

  g_object_notify (G_OBJECT (self), "ready-state");
}

static gboolean
on_timeout_close_io (gpointer user_data)
{
  WebSocketConnection *self = WEB_SOCKET_CONNECTION (user_data);
  WebSocketConnectionPrivate *pv = web_socket_connection_get_instance_private (self);

  pv->close_timeout = 0;
  g_message ("peer did not close io when expected");

  close_io_stream (self);

  return FALSE;
}

static void
close_io_after_timeout (WebSocketConnection *self)
{
  WebSocketConnectionPrivate *pv = web_socket_connection_get_instance_private (self);
  const gint timeout = 5;

  if (pv->close_timeout)
    return;

  g_debug ("waiting %d seconds for peer to close io", timeout);
  pv->close_timeout = g_timeout_source_new_seconds (timeout);
  g_source_set_callback (pv->close_timeout, on_timeout_close_io, self, NULL);
  g_source_attach (pv->close_timeout, pv->main_context);
}

static void
xor_with_mask_rfc6455 (const guint8 *mask,
                       guint8 *data,
                       gsize len)
{
  g_assert (mask != NULL);
  g_assert (data != NULL);

  /* Do the masking */
  for (gsize n = 0; n < len; n++)
    data[n] ^= mask[n & 3];
}

static void
send_prefixed_message_rfc6455 (WebSocketConnection *self,
                               WebSocketQueueFlags flags,
                               guint8 opcode,
                               const guint8 *prefix,
                               gsize prefix_len,
                               const guint8 *payload,
                               gsize payload_len)
{
  gsize amount;
  GByteArray *bytes;
  gsize frame_len;
  guint8 *outer;
  guint8 *mask = 0;
  guint8 *at;
  gsize len;
  guint64 size;

  len = payload_len + prefix_len;
  amount = len;

  bytes = g_byte_array_sized_new (14 + len);
  outer = bytes->data;
  outer[0] = 0x80 | opcode;

  /* If control message, truncate payload */
  if (opcode & 0x08)
    {
      if (len > 125)
        {
          g_warning ("Truncating WebSocket control message payload");
          if (prefix_len > 125)
              prefix_len = 125;
          payload_len = 125 - prefix_len;
          len = 125;
        }

      /* Buffered amount of bytes is zero for control messages */
      amount = 0;
    }

  size = len;
  if (size < 126)
    {
      outer[1] = (0xFF & size); /* mask | 7-bit-len */
      bytes->len = 2;
    }
  else if (size < 65536)
    {
      outer[1] = 126; /* mask | 16-bit-len */
      outer[2] = (size >> 8) & 0xFF;
      outer[3] = (size >> 0) & 0xFF;
      bytes->len = 4;
    }
  else
    {
      outer[1] = 127; /* mask | 64-bit-len */
      outer[2] = (size >> 56) & 0xFF;
      outer[3] = (size >> 48) & 0xFF;
      outer[4] = (size >> 40) & 0xFF;
      outer[5] = (size >> 32) & 0xFF;
      outer[6] = (size >> 24) & 0xFF;
      outer[7] = (size >> 16) & 0xFF;
      outer[8] = (size >> 8) & 0xFF;
      outer[9] = (size >> 0) & 0xFF;
      bytes->len = 10;
    }

  /*
   * The server side doesn't need to mask, so we don't. There's
   * probably a client somewhere that's not expecting it.
   */
  const gboolean is_client_side = !GET_PRIV(self)->server_side;
  if (is_client_side)
    {
      guint32 rand = g_random_int ();
      outer[1] |= 0x80;
      mask = outer + bytes->len;
      memcpy (mask, &rand, sizeof (guint32));
      bytes->len += 4;
    }

  at = bytes->data + bytes->len;
  g_byte_array_append (bytes, prefix, prefix_len);
  g_byte_array_append (bytes, payload, payload_len);

  if (is_client_side)
    xor_with_mask_rfc6455 (mask, at, len);

  frame_len = bytes->len;
  _web_socket_connection_queue (self, flags, g_byte_array_free (bytes, FALSE),
                                frame_len, amount);
  g_debug ("queued rfc6455 %d frame of len %u", (gint)opcode, (guint)frame_len);
}

static void
send_message_rfc6455 (WebSocketConnection *self,
                      WebSocketQueueFlags flags,
                      guint8 opcode,
                      const guint8 *payload,
                      gsize payload_len)
{
  return send_prefixed_message_rfc6455 (self, flags, opcode, NULL, 0, payload, payload_len);
}

static void
send_close_rfc6455 (WebSocketConnection *self,
                    WebSocketQueueFlags flags,
                    gushort code,
                    const gchar *reason)
{
  /* Note that send_message truncates as expected */
  gchar buffer[128];
  gsize len = 0;

  if (code != 0)
    {
      buffer[len++] = code >> 8;
      buffer[len++] = code & 0xFF;
      if (reason)
        len += g_strlcpy (buffer + len, reason, sizeof (buffer) - len);
    }

  send_message_rfc6455 (self, flags, 0x08, (guint8 *)buffer, len);
  GET_PRIV(self)->close_sent = TRUE;
}

gboolean
_web_socket_connection_error (WebSocketConnection *self,
                              GError *error)
{
  gboolean unused;

  if (web_socket_connection_get_ready_state (self) != WEB_SOCKET_STATE_CLOSED)
    {
      if (error)
        {
          GET_PRIV(self)->dirty_close = TRUE;
          g_signal_emit (self, signals[ERROR], 0, error, &unused);
        }

      g_error_free (error);
      return TRUE;
    }

  g_error_free (error);
  return FALSE;
}

void
_web_socket_connection_error_and_close (WebSocketConnection *self,
                                        GError *error,
                                        gboolean prejudice)
{
  gboolean ignore = FALSE;
  gushort code;

  if (error && error->domain == WEB_SOCKET_ERROR)
    code = error->code;
  else
    code = WEB_SOCKET_CLOSE_GOING_AWAY;

  if (!GET_PRIV(self)->server_side && error && error->domain == G_TLS_ERROR)
    {
      GET_PRIV(self)->peer_close_code = WEB_SOCKET_CLOSE_TLS_HANDSHAKE;
      if (g_error_matches (error, G_TLS_ERROR, G_TLS_ERROR_NOT_TLS) ||
          g_error_matches (error, G_TLS_ERROR, G_TLS_ERROR_MISC))
        {
          GET_PRIV(self)->peer_close_data = g_strdup ("protocol-error");
        }
      else if (g_error_matches (error, G_TLS_ERROR, G_TLS_ERROR_BAD_CERTIFICATE))
        {
          GET_PRIV(self)->peer_close_data = g_strdup ("unknown-hostkey");
        }
    }

  if (!_web_socket_connection_error (self, error))
    return;

  if (!GET_PRIV(self)->handshake_done)
    prejudice = TRUE;

  /* If already closing, so just ignore this stuff */
  switch (web_socket_connection_get_ready_state (self))
    {
    case WEB_SOCKET_STATE_CLOSED:
      ignore = TRUE;
      break;
    case WEB_SOCKET_STATE_CLOSING:
      ignore = !prejudice;
      break;
    default:
      break;
    }

  if (ignore)
    {
      g_debug ("already closing/closed, ignoring error");
    }
  else if (prejudice)
    {
      g_debug ("forcing close due to error");
      close_io_stream (self);
    }
  else
    {
      g_debug ("requesting close due to error");
      send_close_rfc6455 (self, WEB_SOCKET_QUEUE_URGENT | WEB_SOCKET_QUEUE_LAST, code, NULL);
    }
}

static void
protocol_error_and_close_full (WebSocketConnection *self,
                               gboolean prejudice)
{
  GError *error = g_error_new_literal (WEB_SOCKET_ERROR,
                                       WEB_SOCKET_CLOSE_PROTOCOL,
                                       GET_PRIV(self)->server_side ?
                                           "Received invalid WebSocket response from the server" :
                                           "Received invalid WebSocket response from the client");
  _web_socket_connection_error_and_close (self, error, prejudice);
}

static void
protocol_error_and_close (WebSocketConnection *self)
{
  protocol_error_and_close_full (self, FALSE);
}

static void
bad_data_error_and_close (WebSocketConnection *self)
{
  GError *error = g_error_new_literal (WEB_SOCKET_ERROR,
                                       WEB_SOCKET_CLOSE_BAD_DATA,
                                       GET_PRIV(self)->server_side ?
                                           "Received invalid WebSocket data from the server" :
                                           "Received invalid WebSocket data from the client");
  _web_socket_connection_error_and_close (self, error, FALSE);
}

static void
too_big_error_and_close (WebSocketConnection *self,
                         gsize payload_len)
{
  GError *error = g_error_new_literal (WEB_SOCKET_ERROR,
                                       WEB_SOCKET_CLOSE_TOO_BIG,
                                       GET_PRIV(self)->server_side ?
                                           "Received extremely large WebSocket data from the server" :
                                           "Received extremely large WebSocket data from the client");
  g_message ("%s is trying to frame of size %" G_GSIZE_FORMAT " or greater, but max supported size is 128KiB",
             GET_PRIV(self)->server_side ? "server" : "client", payload_len);
  _web_socket_connection_error_and_close (self, error, TRUE);

  /* The input is in an invalid state now */
  stop_input (self);
}

static gboolean
web_socket_connection_default_error (WebSocketConnection *connection,
                                     GError *error)
{
  if (g_error_matches (error, G_TLS_ERROR, G_TLS_ERROR_EOF))
    g_debug ("web socket error: %s", error->message);
  else
    g_message ("%s", error->message);
  return TRUE;
}

static gboolean
web_socket_connection_default_closing (WebSocketConnection *self)
{
  return TRUE;
}

static void
receive_close_rfc6455 (WebSocketConnection *self,
                       const guint8 *data,
                       gsize len)
{
  WebSocketConnectionPrivate *pv = web_socket_connection_get_instance_private (self);

  pv->peer_close_code = 0;
  g_free (pv->peer_close_data);
  pv->peer_close_data = NULL;
  pv->close_received = TRUE;

  /* Store the code/data payload */
  if (len >= 2)
    {
      pv->peer_close_code = (guint16)data[0] << 8 | data[1];
    }
  if (len > 2)
    {
      data += 2;
      len -= 2;
      if (g_utf8_validate ((gchar *)data, len, NULL))
        pv->peer_close_data = g_strndup ((gchar *)data, len);
      else
        g_message ("received non-UTF8 close data: %d '%.*s' %d", (int)len, (int)len, (gchar *)data, (int)data[0]);
    }

  /* Once we receive close response on server, close immediately */
  if (pv->close_sent)
    {
      shutdown_wr_io_stream (self);
      if (pv->server_side)
          close_io_stream (self);
    }

  else
    {
      /* Send back the response */
      web_socket_connection_close (self, pv->peer_close_code, NULL);
    }
}

static void
receive_ping_rfc6455 (WebSocketConnection *self,
                      const guint8 *data,
                      gsize len)
{
  /* Send back a pong with same data */
  g_debug ("received ping, responding");
  send_message_rfc6455 (self, WEB_SOCKET_QUEUE_URGENT, 0x0A, data, len);
}

static void
process_contents_rfc6455 (WebSocketConnection *self,
                          gboolean control,
                          gboolean fin,
                          guint8 opcode,
                          gconstpointer payload,
                          gsize payload_len)
{
  WebSocketConnectionPrivate *pv = web_socket_connection_get_instance_private (self);
  GBytes *message;

  if (control)
    {
      /* Control frames must never be fragmented */
      if (!fin)
        {
          g_message ("received fragmented control frame");
          protocol_error_and_close (self);
          return;
        }

      g_debug ("received control frame %d with %d payload", (int)opcode, (int)payload_len);

      switch (opcode)
        {
        case 0x08:
          receive_close_rfc6455 (self, payload, payload_len);
          break;
        case 0x09:
          receive_ping_rfc6455 (self, payload, payload_len);
          break;
        case 0x0A:
          break;
        default:
          g_message ("received unsupported control frame: %d", (gint)opcode);
          break;
        }
    }

  else if (pv->close_received)
    {
      g_message ("received message after close was received");
    }

  /* A message frame */
  else
    {
      /* Initial fragment of a message */
      if (!fin && opcode)
        {
          if (pv->message_data)
            {
              g_message ("received out of order initial message fragment");
              protocol_error_and_close (self);
              return;
            }
          g_debug ("received initial fragment frame %d with %d payload", (int)opcode, (int)payload_len);
        }

      /* Middle fragment of a message */
      else if (!fin && !opcode)
        {
          if (!pv->message_data)
            {
              g_message ("received out of order middle message fragment");
              protocol_error_and_close (self);
              return;
            }
          g_debug ("received middle fragment frame with %d payload", (int)payload_len);
        }

      /* Last fragment of a message */
      else if (fin && !opcode)
        {
          if (!pv->message_data)
            {
              g_message ("received out of order ending message fragment");
              protocol_error_and_close (self);
              return;
            }
          g_debug ("received last fragment frame with %d payload", (int)payload_len);
        }

      /* An unfragmented message */
      else
        {
          g_assert (opcode != 0);
          if (pv->message_data)
            {
              g_message ("received unfragmented message when fragment was expected");
              protocol_error_and_close (self);
              return;
            }
          g_debug ("received frame %d with %d payload", (int)opcode, (int)payload_len);
        }

      if (opcode)
        {
          pv->message_opcode = opcode;
          pv->message_data = g_byte_array_sized_new (payload_len);
        }

      switch (pv->message_opcode)
        {
        case 0x01:
          if (!g_utf8_validate ((gchar *)payload, payload_len, NULL))
            {
              g_message ("received invalid non-UTF8 text data");

              /* Discard the entire message */
              g_byte_array_unref (pv->message_data);
              pv->message_data = NULL;
              pv->message_opcode = 0;

              bad_data_error_and_close (self);
              return;
            }
          /* fall through */
        case 0x02:
          g_byte_array_append (pv->message_data, payload, payload_len);
          break;
        default:
          g_debug ("received unknown data frame: %d", (gint)opcode);
          break;
        }

      /* Actually deliver the message? */
      if (fin)
        {
          /* Always null terminate, as a convenience */
          g_byte_array_append (pv->message_data, (guchar *)"\0", 1);

          /* But don't include the null terminator in the byte count */
          pv->message_data->len--;

          opcode = pv->message_opcode;
          message = g_byte_array_free_to_bytes (pv->message_data);
          pv->message_data = NULL;
          pv->message_opcode = 0;
          g_debug ("message: delivering %d with %d length",
                   (int)opcode, (int)g_bytes_get_size (message));
          g_signal_emit (self, signals[MESSAGE], 0, (int)opcode, message);
          g_bytes_unref (message);
        }
    }
}

static gboolean
process_frame_rfc6455 (WebSocketConnection *self)
{
  guint8 *header;
  guint8 *payload;
  guint64 payload_len;
  guint8 *mask;
  gboolean fin;
  gboolean control;
  gboolean masked;
  guint8 opcode;
  gsize len;
  gsize at;

  len = GET_PRIV(self)->incoming->len;
  if (len < 2)
    return FALSE; /* need more data */

  header = GET_PRIV(self)->incoming->data;
  fin = ((header[0] & 0x80) != 0);
  control = header[0] & 0x08;
  opcode = header[0] & 0x0f;
  masked = ((header[1] & 0x80) != 0);

  switch (header[1] & 0x7f)
    {
    case 126:
      at = 4;
      if (len < at)
        return FALSE; /* need more data */
      payload_len = ((guint16)header[2] << 8) |
                    ((guint16)header[3] << 0);
      break;
    case 127:
      at = 10;
      if (len < at)
        return FALSE; /* need more data */
      payload_len = ((guint64)header[2] << 56) |
                    ((guint64)header[3] << 48) |
                    ((guint64)header[4] << 40) |
                    ((guint64)header[5] << 32) |
                    ((guint64)header[6] << 24) |
                    ((guint64)header[7] << 16) |
                    ((guint64)header[8] << 8) |
                    ((guint64)header[9] << 0);
      break;
    default:
      payload_len = header[1] & 0x7f;
      at = 2;
      break;
    }

  /* Safety valve */
  if (payload_len >= MAX_PAYLOAD)
    {
      too_big_error_and_close (self, payload_len);
      return FALSE;
    }

  if (len < at + payload_len)
    return FALSE; /* need more data */

  payload = header + at;

  if (masked)
    {
      mask = header + at;
      payload += 4;
      at += 4;

      if (len < at + payload_len)
        return FALSE; /* need more data */

      xor_with_mask_rfc6455 (mask, payload, payload_len);
    }

  /*
   * Note that now that we've unmasked, we've modified the buffer, we can
   * only return below via discarding or processing the message
   */
  process_contents_rfc6455 (self, control, fin, opcode, payload, payload_len);

  /* Move past the parsed frame */
  g_byte_array_remove_range (GET_PRIV(self)->incoming, 0, at + payload_len);
  return TRUE;
}

static void
process_incoming (WebSocketConnection *self)
{
  WebSocketConnectionPrivate *pv = web_socket_connection_get_instance_private (self);
  WebSocketConnectionClass *klass;
  gboolean more;

  if (!pv->handshake_done)
    {
      klass = WEB_SOCKET_CONNECTION_GET_CLASS (self);
      g_assert (klass->handshake != NULL);
      if ((klass->handshake) (self, pv->incoming))
        {
          pv->handshake_done = TRUE;
          g_object_notify (G_OBJECT (self), "ready-state");
          g_signal_emit (self, signals[OPEN], 0);
        }
    }

  if (pv->handshake_done)
    {
      do
        {
          more = process_frame_rfc6455 (self);
        }
      while (more);
    }
}

static gboolean
on_web_socket_input (GObject *pollable_stream,
                     gpointer user_data)
{
  WebSocketConnection *self = WEB_SOCKET_CONNECTION (user_data);
  WebSocketConnectionPrivate *pv = web_socket_connection_get_instance_private (self);
  GError *error = NULL;
  gboolean end = FALSE;
  gssize count;
  gsize len;

  do
    {
      len = pv->incoming->len;
      g_byte_array_set_size (pv->incoming, len + 1024);

      count = g_pollable_input_stream_read_nonblocking (pv->input,
                                                        pv->incoming->data + len,
                                                        1024, NULL, &error);

      if (count < 0)
        {
          if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_WOULD_BLOCK))
            {
              g_error_free (error);
              count = 0;
            }
          else
            {
              _web_socket_connection_error_and_close (self, error, TRUE);
              return TRUE;
            }
        }
      else if (count == 0)
        {
          end = TRUE;
        }

      pv->incoming->len = len + count;
    }
  while (count > 0);

  process_incoming (self);

  if (end)
    {
      if (!pv->close_sent || !pv->close_received)
        {
          pv->dirty_close = TRUE;
          g_message ("connection unexpectedly closed by peer");
        }
      else
        {
          g_debug ("peer has closed socket");
        }

      close_io_stream (self);
    }

  return TRUE;
}

static void
start_input (WebSocketConnection *self)
{
  WebSocketConnectionPrivate *pv = web_socket_connection_get_instance_private (self);

  g_debug ("starting input source");
  pv->input_source = g_pollable_input_stream_create_source (pv->input, NULL);
  g_source_set_callback (pv->input_source, (GSourceFunc)on_web_socket_input, self, NULL);
  g_source_attach (pv->input_source, pv->main_context);
}

static gboolean
on_web_socket_output (GObject *pollable_stream,
                      gpointer user_data)
{
  WebSocketConnection *self = WEB_SOCKET_CONNECTION (user_data);
  WebSocketConnectionPrivate *pv = web_socket_connection_get_instance_private (self);
  const guint8 *data;
  GError *error = NULL;
  gsize before;
  Frame *frame;
  gssize count;
  gsize len;

  frame = g_queue_peek_head (&pv->outgoing);

  /* No more frames to send */
  if (frame == NULL)
    {
      stop_output (self);
      return TRUE;
    }

  data = g_bytes_get_data (frame->data, &len);
  g_assert (len > 0);
  g_assert (len > frame->sent);

  count = g_pollable_output_stream_write_nonblocking (pv->output,
                                                      data + frame->sent,
                                                      len - frame->sent,
                                                      NULL, &error);

  if (count < 0)
    {
      if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_WOULD_BLOCK))
        {
          g_clear_error (&error);
          count = 0;
        }
      else
        {
          _web_socket_connection_error_and_close (self, error, TRUE);
          return FALSE;
        }
    }

  before = pv->output_queued;

  frame->sent += count;
  if (frame->sent >= len)
    {
      g_debug ("sent frame");
      g_queue_pop_head (&pv->outgoing);
      g_assert (len <= pv->output_queued);
      pv->output_queued -= len;

      if (frame->last)
        {
          if (pv->server_side)
            {
              close_io_stream (self);
            }
          else
            {
              shutdown_wr_io_stream (self);
              close_io_after_timeout (self);
            }
        }
      frame_free (frame);
    }

  /*
   * If we're controlling another flow, turn off back pressure when
   * our output buffer size becomes less than the low mark.
   */
  if (before >= QUEUE_PRESSURE && GET_PRIV(self)->output_queued < QUEUE_PRESSURE)
    cockpit_flow_emit_pressure (COCKPIT_FLOW (self), FALSE);

  return TRUE;
}

static void
start_output (WebSocketConnection *self)
{
  WebSocketConnectionPrivate *pv = web_socket_connection_get_instance_private (self);

  if (pv->output_source)
    return;

  g_debug ("starting output source");
  pv->output_source = g_pollable_output_stream_create_source (pv->output, NULL);
  g_source_set_callback (pv->output_source, (GSourceFunc)on_web_socket_output, self, NULL);
  g_source_attach (pv->output_source, pv->main_context);
}

void
_web_socket_connection_queue (WebSocketConnection *self,
                              WebSocketQueueFlags flags,
                              gpointer data,
                              gsize len,
                              gsize amount)
{
  WebSocketConnectionPrivate *pv = web_socket_connection_get_instance_private (self);
  gsize before;
  Frame *frame;
  Frame *prev;

  g_return_if_fail (WEB_SOCKET_IS_CONNECTION (self));
  g_return_if_fail (pv->close_sent == FALSE);
  g_return_if_fail (data != NULL);
  g_return_if_fail (len > 0);

  frame = g_slice_new0 (Frame);
  frame->data = g_bytes_new_take (data, len);
  frame->amount = amount;
  frame->last = (flags & WEB_SOCKET_QUEUE_LAST) ? TRUE : FALSE;

  /* If urgent put at front of queue */
  if (flags & WEB_SOCKET_QUEUE_URGENT)
    {
      /* But we can't interrupt a message already partially sent */
      prev = g_queue_pop_head (&pv->outgoing);
      if (prev == NULL)
        {
          g_queue_push_head (&pv->outgoing, frame);
        }
      else if (prev->sent > 0)
        {
          g_queue_push_head (&pv->outgoing, frame);
          g_queue_push_head (&pv->outgoing, prev);
        }
      else
        {
          g_queue_push_head (&pv->outgoing, prev);
          g_queue_push_head (&pv->outgoing, frame);
        }
    }
  else
    {
      g_queue_push_tail (&pv->outgoing, frame);
    }

  before = pv->output_queued;
  g_return_if_fail (G_MAXSIZE - len > pv->output_queued);
  pv->output_queued += len;

  /*
   * If we have two much data queued, and are controlling another flow
   * tell it to stop sending data, each time we cross over the high bound.
   */
  if (before < QUEUE_PRESSURE && GET_PRIV(self)->output_queued >= QUEUE_PRESSURE)
    cockpit_flow_emit_pressure (COCKPIT_FLOW (self), TRUE);

  start_output (self);
}

static gboolean
check_streams (WebSocketConnection *self)
{
  WebSocketConnectionPrivate *pv = web_socket_connection_get_instance_private (self);

  if (!pv->input || !g_pollable_input_stream_can_poll (pv->input))
    {
      g_critical ("WebSocket input stream is invalid or cannot poll");
      return FALSE;
    }

  if (!pv->output || !g_pollable_output_stream_can_poll (pv->output))
    {
      g_critical ("WebSocket output stream is invalid or cannot poll");
      return FALSE;
    }

  return TRUE;
}

void
_web_socket_connection_take_incoming (WebSocketConnection *self,
                                      GByteArray *input_buffer)
{
  g_return_if_fail (WEB_SOCKET_IS_CONNECTION (self));

  g_return_if_fail (GET_PRIV(self)->incoming == NULL);
  GET_PRIV(self)->incoming = input_buffer;
}

static gboolean
on_idle_start_input (gpointer user_data)
{
  WebSocketConnection *self = WEB_SOCKET_CONNECTION (user_data);

  g_source_unref (GET_PRIV(self)->start_idle);
  GET_PRIV(self)->start_idle = NULL;

  if (check_streams (self))
    {
      start_input (self);
      process_incoming (self);
    }

  return FALSE;
}

void
_web_socket_connection_take_io_stream (WebSocketConnection *self,
                                       GIOStream *io_stream)
{
  WebSocketConnectionPrivate *pv = web_socket_connection_get_instance_private (self);
  GInputStream *is;
  GOutputStream *os;

  g_return_if_fail (WEB_SOCKET_IS_CONNECTION (self));
  g_return_if_fail (G_IS_IO_STREAM (io_stream));

  g_return_if_fail (pv->io_stream == NULL);
  pv->io_stream = io_stream;

  is = g_io_stream_get_input_stream (io_stream);
  os = g_io_stream_get_output_stream (io_stream);

  if (G_IS_POLLABLE_INPUT_STREAM (is))
    pv->input = G_POLLABLE_INPUT_STREAM (is);
  if (G_IS_POLLABLE_OUTPUT_STREAM (os))
    pv->output = G_POLLABLE_OUTPUT_STREAM (os);

  pv->io_open = TRUE;
  g_object_notify (G_OBJECT (self), "io-stream");

  /* Start handshake from the main context */
  pv->start_idle = g_idle_source_new ();
  g_source_set_priority (pv->start_idle, G_PRIORITY_HIGH);
  g_source_set_callback (pv->start_idle, (GSourceFunc)on_idle_start_input,
                         g_object_ref (self), g_object_unref);
  g_source_attach (pv->start_idle, pv->main_context);
}

static void
web_socket_connection_constructed (GObject *object)
{
  WebSocketConnection *self = WEB_SOCKET_CONNECTION (object);
  WebSocketConnectionPrivate *pv = web_socket_connection_get_instance_private (self);
  WebSocketConnectionClass *klass;

  G_OBJECT_CLASS (web_socket_connection_parent_class)->constructed (object);

  /*
   * Here we choose a side to be based on our derived class. The handshake
   * is different on either client/server side, as is the expectation of
   * how to mask data.
   */
  klass = WEB_SOCKET_CONNECTION_GET_CLASS (self);
  pv->server_side = klass->server_behavior;

  if (!pv->incoming)
    pv->incoming = g_byte_array_sized_new (1024);
}

static void
web_socket_connection_get_property (GObject *object,
                                    guint prop_id,
                                    GValue *value,
                                    GParamSpec *pspec)
{
  WebSocketConnection *self = WEB_SOCKET_CONNECTION (object);

  switch (prop_id)
    {
    case PROP_URL:
      g_value_set_string (value, web_socket_connection_get_url (self));
      break;

    case PROP_PROTOCOL:
      g_value_set_string (value, web_socket_connection_get_protocol (self));
      break;

    case PROP_READY_STATE:
      g_value_set_int (value, web_socket_connection_get_ready_state (self));
      break;

    case PROP_BUFFERED_AMOUNT:
      g_value_set_ulong (value, web_socket_connection_get_buffered_amount (self));
      break;

    case PROP_IO_STREAM:
      g_value_set_object (value, web_socket_connection_get_io_stream (self));
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
web_socket_connection_set_property (GObject *object,
                                    guint prop_id,
                                    const GValue *value,
                                    GParamSpec *pspec)
{
  WebSocketConnection *self = WEB_SOCKET_CONNECTION (object);
  WebSocketConnectionPrivate *pv = web_socket_connection_get_instance_private (self);
  GIOStream *io_stream;

  switch (prop_id)
    {
    case PROP_URL:
      g_return_if_fail (pv->url == NULL);
      pv->url = g_value_dup_string (value);
      break;

    case PROP_IO_STREAM:
      g_return_if_fail (pv->io_stream == NULL);
      io_stream = g_value_dup_object (value);
      if (io_stream)
        _web_socket_connection_take_io_stream (self, io_stream);
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
web_socket_connection_dispose (GObject *object)
{
  WebSocketConnection *self = WEB_SOCKET_CONNECTION (object);

  GET_PRIV(self)->dirty_close = TRUE;
  close_io_stream (self);

  cockpit_flow_throttle (COCKPIT_FLOW (self), NULL);
  g_assert (GET_PRIV(self)->pressure == NULL);

  G_OBJECT_CLASS (web_socket_connection_parent_class)->dispose (object);
}

static void
web_socket_connection_finalize (GObject *object)
{
  WebSocketConnection *self = WEB_SOCKET_CONNECTION (object);
  WebSocketConnectionPrivate *pv = web_socket_connection_get_instance_private (self);

  g_free (pv->url);
  g_free (pv->chosen_protocol);
  g_free (pv->peer_close_data);

  g_main_context_unref (pv->main_context);

  if (pv->incoming)
    g_byte_array_free (pv->incoming, TRUE);
  while (!g_queue_is_empty (&pv->outgoing))
    frame_free (g_queue_pop_head (&pv->outgoing));
  pv->output_queued = 0;

  g_clear_object (&pv->io_stream);
  g_assert (!pv->input_source);
  g_assert (!pv->output_source);
  g_assert (!pv->io_open);
  g_assert (pv->io_closed);
  g_assert (!pv->close_timeout);

  if (pv->start_idle)
    g_source_unref (pv->start_idle);
  if (pv->message_data)
    g_byte_array_free (pv->message_data, TRUE);

  G_OBJECT_CLASS (web_socket_connection_parent_class)->finalize (object);
}

static void
web_socket_connection_class_init (WebSocketConnectionClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);

  gobject_class->constructed = web_socket_connection_constructed;
  gobject_class->get_property = web_socket_connection_get_property;
  gobject_class->set_property = web_socket_connection_set_property;
  gobject_class->dispose = web_socket_connection_dispose;
  gobject_class->finalize = web_socket_connection_finalize;

  /**
   * WebSocketConnection:url:
   *
   * The URL of the WebSocket.
   *
   * For servers this represents the address of the WebSocket, and
   * for clients it is the address connected to. This is required
   * as a construct property.
   */
  g_object_class_install_property (gobject_class, PROP_URL,
                                   g_param_spec_string ("url", "URL", "The WebSocket URL", NULL,
                                                        G_PARAM_READWRITE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));

  /**
   * WebSocketConnection:protocol:
   *
   * The chosen protocol. Only becomes valid after the #WebSocketConnection:open
   * signal has been fired, and when we are in the %WEB_SOCKET_STATE_OPEN state.
   *
   * May be NULL if neither peer cares about protocols.
   */
  g_object_class_install_property (gobject_class, PROP_PROTOCOL,
                                   g_param_spec_string ("protocol", "Protocol", "The chosen WebSocket protocol", NULL,
                                                        G_PARAM_READABLE | G_PARAM_STATIC_STRINGS));

  /**
   * WebSocketConnection:ready-state:
   *
   * The current state of the WebSocket.
   */
  g_object_class_install_property (gobject_class, PROP_READY_STATE,
                                   g_param_spec_int ("ready-state", "Ready state", "Ready state ",
                                                     WEB_SOCKET_STATE_CONNECTING, WEB_SOCKET_STATE_CLOSED, WEB_SOCKET_STATE_CONNECTING,
                                                     G_PARAM_READABLE | G_PARAM_STATIC_STRINGS));

  /**
   * WebSocketConnection:buffered-amount:
   *
   * This represents caller provided data passed into the
   * web_socket_connection_send() function, which has been queued but not
   * yet been sent.
   */
  g_object_class_install_property (gobject_class, PROP_BUFFERED_AMOUNT,
                                   g_param_spec_ulong ("buffered-amount", "Buffered amount", "Outstanding amount of data buffered",
                                                       0, G_MAXULONG, 0,
                                                       G_PARAM_READABLE | G_PARAM_STATIC_STRINGS));

  /**
   * WebSocketConnection:io-stream:
   *
   * The underlying IO stream the WebSocket is communicating over. For servers
   * this must be specified as a construct property. For clients, this may be
   * specified, if you have a stream that you've already connected to.
   *
   * The input and output streams must be pollable streams.
   */
  g_object_class_install_property (gobject_class, PROP_IO_STREAM,
                                   g_param_spec_object ("io-stream", "IO Stream", "Underlying io stream", G_TYPE_IO_STREAM,
                                                        G_PARAM_READWRITE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));

  /**
   * WebSocketConnection::open:
   * @self: the WebSocket
   *
   * Emitted when the connection opens and is ready for communication.
   *
   * This will be emitted at most once. But if the connection fails during
   * connecting, then this signal will not be emitted.
   */
  signals[OPEN] = g_signal_new ("open",
                                WEB_SOCKET_TYPE_CONNECTION,
                                G_SIGNAL_RUN_FIRST,
                                G_STRUCT_OFFSET (WebSocketConnectionClass, open),
                                NULL, NULL, g_cclosure_marshal_generic,
                                G_TYPE_NONE, 0);

  /**
   * WebSocketConnection::message:
   * @self: the WebSocket
   * @type: the type of message contents
   * @message: the message data
   *
   * Emitted when we receive a message from the peer.
   *
   * As a convenience, the @message data will always be null-terminated, but
   * the null-terminator will not be included in the length count.
   * This signal may emitted multiple times.
   */
  signals[MESSAGE] = g_signal_new ("message",
                                   WEB_SOCKET_TYPE_CONNECTION,
                                   G_SIGNAL_RUN_FIRST,
                                   G_STRUCT_OFFSET (WebSocketConnectionClass, message),
                                   NULL, NULL, g_cclosure_marshal_generic,
                                   G_TYPE_NONE, 2, G_TYPE_INT, G_TYPE_BYTES);

  /**
   * WebSocketConnection::error:
   * @self: the WebSocket
   * @error: the error that occurred
   *
   * Emitted when an error occurred on the WebSocket. This may be fired
   * multiple times. Fatal errors will be followed by the #WebSocketConnection::close
   * signal being emitted.
   */
  signals[ERROR] = g_signal_new ("error",
                                 WEB_SOCKET_TYPE_CONNECTION,
                                 G_SIGNAL_RUN_LAST,
                                 G_STRUCT_OFFSET (WebSocketConnectionClass, error),
                                 g_signal_accumulator_true_handled, NULL,
                                 g_cclosure_marshal_generic,
                                 G_TYPE_BOOLEAN, 1, G_TYPE_ERROR);

  /**
   * WebSocketConnection::closing:
   * @self: the WebSocket
   *
   * This signal will be emitted during an orderly close
   */
  signals[CLOSING] = g_signal_new ("closing",
                                   WEB_SOCKET_TYPE_CONNECTION,
                                   G_SIGNAL_RUN_LAST,
                                   G_STRUCT_OFFSET (WebSocketConnectionClass, closing),
                                   g_signal_accumulator_true_handled, NULL, g_cclosure_marshal_generic,
                                   G_TYPE_BOOLEAN, 0);

  klass->error = web_socket_connection_default_error;
  klass->closing = web_socket_connection_default_closing;

  /**
   * WebSocketConnection::close:
   * @self: the WebSocket
   *
   * Emitted when the connection has completely closed, either due to an
   * orderly close from the peer, one initiated via web_socket_connection_close()
   * or a fatal error condition that caused a close.
   *
   * This signal will be emitted once.
   */
  signals[CLOSE] = g_signal_new ("close",
                                 WEB_SOCKET_TYPE_CONNECTION,
                                 G_SIGNAL_RUN_FIRST,
                                 G_STRUCT_OFFSET (WebSocketConnectionClass, close),
                                 NULL, NULL, g_cclosure_marshal_generic,
                                 G_TYPE_NONE, 0);
}

/**
 * web_socket_connection_get_url:
 * @self: the WebSocket
 *
 * Get the URL of the WebSocket.
 *
 * For servers this represents the address of the WebSocket, and
 * for clients it is the address connected to.
 *
 * Returns: the URL
 */
const gchar *
web_socket_connection_get_url (WebSocketConnection *self)
{
  g_return_val_if_fail (WEB_SOCKET_IS_CONNECTION (self), NULL);
  return GET_PRIV(self)->url;
}

/**
 * web_socket_connection_get_protocol:
 * @self: the WebSocket
 *
 * Get the protocol chosen via negotiation with the peer.
 *
 * A list of possible protocols is provided when creating a #WebSocketClient
 * or #WebSocketServer, and one is negotiated during the handshake.
 *
 * This will be %NULL until the WebSocket is in the %WEB_SOCKET_STATE_OPEN
 * state.
 *
 * Returns: the chosen protocol or %NULL
 */
const gchar *
web_socket_connection_get_protocol (WebSocketConnection *self)
{
  g_return_val_if_fail (WEB_SOCKET_IS_CONNECTION (self), NULL);
  return GET_PRIV(self)->chosen_protocol;
}

/**
 * web_socket_connection_get_ready_state:
 * @self: the WebSocket
 *
 * Get the current state of the WebSocket.
 *
 * Returns: the state
 */
WebSocketState
web_socket_connection_get_ready_state (WebSocketConnection *self)
{
  g_return_val_if_fail (WEB_SOCKET_IS_CONNECTION (self), 0);

  if (GET_PRIV(self)->io_closed)
    return WEB_SOCKET_STATE_CLOSED;
  else if ((GET_PRIV(self)->io_stream && !GET_PRIV(self)->io_open) || GET_PRIV(self)->close_sent)
    return WEB_SOCKET_STATE_CLOSING;
  else if (GET_PRIV(self)->handshake_done)
    return WEB_SOCKET_STATE_OPEN;
  else
    return WEB_SOCKET_STATE_CONNECTING;
}

/**
 * web_socket_connection_get_buffered_amount:
 * @self: the WebSocket
 *
 * Get the amount of buffered data not yet sent.
 *
 * This represents caller provided data passed into the
 * web_socket_connection_send() function.
 *
 * Returns: the amount of buffered data
 */
gsize
web_socket_connection_get_buffered_amount (WebSocketConnection *self)
{
  gsize amount = 0;
  Frame *frame;
  GList *l;

  g_return_val_if_fail (WEB_SOCKET_IS_CONNECTION (self), 0);

  for (l = GET_PRIV(self)->outgoing.head; l != NULL; l = g_list_next (l))
    {
      frame = l->data;
      amount += frame->amount;
    }

  return amount;
}

/**
 * web_socket_connection_get_io_stream:
 * @self: the WebSocket
 *
 * Get the IO stream the WebSocket is communicating over.
 *
 * Returns: (transfer none): the amount of buffered data
 */
GIOStream *
web_socket_connection_get_io_stream (WebSocketConnection *self)
{
  g_return_val_if_fail (WEB_SOCKET_IS_CONNECTION (self), NULL);
  return GET_PRIV(self)->io_stream;
}

/**
 * web_socket_connection_get_close_code:
 * @self: the WebSocket
 *
 * Get the close code received from the WebSocket peer.
 *
 * This only becomes valid once the WebSocket is in the
 * %WEB_SOCKET_STATE_CLOSED state. The value will often be in the
 * #WebSocketCloseCodes enumeration, but may also be an application
 * defined close code.
 *
 * Returns: the close code or zero.
 */
gushort
web_socket_connection_get_close_code (WebSocketConnection *self)
{
  g_return_val_if_fail (WEB_SOCKET_IS_CONNECTION (self), 0);
  return GET_PRIV(self)->peer_close_code;
}

/**
 * web_socket_connection_get_close_data:
 * @self: the WebSocket
 *
 * Get the close data received from the WebSocket peer.
 *
 * This only becomes valid once the WebSocket is in the
 * %WEB_SOCKET_STATE_CLOSED state. The data may be freed once
 * the main loop is run, so copy it if you need to keep it around.
 *
 * Returns: the close data or %NULL
 */
const gchar *
web_socket_connection_get_close_data (WebSocketConnection *self)
{
  g_return_val_if_fail (WEB_SOCKET_IS_CONNECTION (self), NULL);
  return GET_PRIV(self)->peer_close_data;
}

/**
 * web_socket_connection_send:
 * @self: the WebSocket
 * @type: the data type of message
 * @prefix: (allow-none): an optional prefix prepended to the message
 * @message: the message contents
 *
 * Send a message to the peer.
 *
 * The @type parameter describes whether this is a binary or text message.
 * If a text message then the contents must be UTF-8 valid.
 *
 * The message is queued to be sent and will be sent when the main loop
 * is run.
 *
 * The optional @prefix can be a canned header to be prefixed to the message.
 * It can be specified as a separate argument for efficiency.
 */
void
web_socket_connection_send (WebSocketConnection *self,
                            WebSocketDataType type,
                            GBytes *prefix,
                            GBytes *message)
{
  gconstpointer pref = NULL;
  gsize prefix_len = 0;
  gconstpointer payload;
  gsize payload_len;
  guint8 opcode;

  g_return_if_fail (WEB_SOCKET_IS_CONNECTION (self));
  g_return_if_fail (message != NULL);

  if (web_socket_connection_get_ready_state (self) != WEB_SOCKET_STATE_OPEN)
    {
      g_critical ("Can only send messages when WebSocket is open");
      return;
    }

  if (prefix)
      pref = g_bytes_get_data (prefix, &prefix_len);
  payload = g_bytes_get_data (message, &payload_len);

  switch (type)
    {
    case WEB_SOCKET_DATA_TEXT:
      opcode = 0x01;
      if (!g_utf8_validate (pref, prefix_len, NULL) ||
          !g_utf8_validate (payload, payload_len, NULL))
        {
          g_critical ("invalid non-UTF8 @data passed as text to web_socket_connection_send()");
          return;
        }
      break;
    case WEB_SOCKET_DATA_BINARY:
      opcode = 0x02;
      break;
    default:
      g_critical ("invalid @type argument for web_socket_connection_send()");
      return;
    }

  send_prefixed_message_rfc6455 (self, WEB_SOCKET_QUEUE_NORMAL, opcode,
                                 pref, prefix_len, payload, payload_len);

  g_object_notify (G_OBJECT (self), "buffered-amount");
}

/**
 * web_socket_connection_close:
 * @self: the WebSocket
 * @code: close code
 * @data: (allow-none): close data
 *
 * Close the connection in an orderly fashion.
 *
 * Note that until the #WebSocketConnection::close signal fires, the connection
 * is not yet completely closed. The close message is not even sent until the
 * main loop runs.
 *
 * The @code and @data are sent to the peer along with the close request.
 * Note that the @data must be UTF-8 valid.
 */
void
web_socket_connection_close (WebSocketConnection *self,
                             gushort code,
                             const gchar *data)
{
  WebSocketQueueFlags flags;
  gboolean handled = FALSE;

  g_return_if_fail (WEB_SOCKET_IS_CONNECTION (self));
  g_return_if_fail (!GET_PRIV(self)->close_sent);

  g_signal_emit (self, signals[CLOSING], 0, &handled);
  if (!handled)
    return;

  if (GET_PRIV(self)->close_received)
    g_debug ("responding to close request");

  if (GET_PRIV(self)->handshake_done)
    {
      flags = 0;
      if (GET_PRIV(self)->server_side && GET_PRIV(self)->close_received)
        flags |= WEB_SOCKET_QUEUE_LAST;
      send_close_rfc6455 (self, flags, code, data);
      close_io_after_timeout (self);
    }
  else
    {
      close_io_stream (self);
    }
}

static void
on_throttle_pressure (GObject *object,
                      gboolean throttle,
                      gpointer user_data)
{
  WebSocketConnection *self = WEB_SOCKET_CONNECTION (user_data);
  if (throttle)
    {
      if (GET_PRIV(self)->io_open && GET_PRIV(self)->input_source != NULL)
        {
          g_debug ("applying back pressure in web socket");
          stop_input (self);
        }
    }
  else
    {
      if (GET_PRIV(self)->io_open && GET_PRIV(self)->input_source == NULL)
        {
          g_debug ("relieving back pressure in web socket");
          start_input (self);
        }
    }
}

static void
web_socket_connection_throttle (CockpitFlow *flow,
                                CockpitFlow *controlling)
{
  WebSocketConnection *self = WEB_SOCKET_CONNECTION (flow);

  if (GET_PRIV(self)->pressure)
    {
      g_signal_handler_disconnect (GET_PRIV(self)->pressure, GET_PRIV(self)->pressure_sig);
      g_object_remove_weak_pointer (G_OBJECT (GET_PRIV(self)->pressure), (gpointer *)&GET_PRIV(self)->pressure);
      GET_PRIV(self)->pressure = NULL;
    }

  if (controlling)
    {
      GET_PRIV(self)->pressure = controlling;
      g_object_add_weak_pointer (G_OBJECT (GET_PRIV(self)->pressure), (gpointer *)&GET_PRIV(self)->pressure);
      GET_PRIV(self)->pressure_sig = g_signal_connect (controlling, "pressure", G_CALLBACK (on_throttle_pressure), self);
    }
}

gboolean
_web_socket_connection_choose_protocol (WebSocketConnection *self,
                                        const gchar **protocols,
                                        const gchar *value)
{
  WebSocketConnectionPrivate *pv = web_socket_connection_get_instance_private (self);
  gboolean chosen = FALSE;
  gchar **values;
  gint i, j;

  g_free (pv->chosen_protocol);
  pv->chosen_protocol = NULL;

  /* Automatically select one */
  if (!value)
    {
      if (protocols)
        {
          pv->chosen_protocol = g_strdup (protocols[0]);
          g_debug ("automatically selected protocol: %s", pv->chosen_protocol);
        }
      g_object_notify (G_OBJECT (self), "protocol");
      return TRUE;
    }

  /* Choose one from what client/server agree on */
  if (!g_str_is_ascii (value))
    {
      /* splitting into words by comma might interfere with multi-byte characters,
       * and they are invalid here anyway */
      g_message ("received invalid Sec-WebSocket-Protocol, must be ASCII: %s", value);
      return FALSE;
    }
  values = g_strsplit_set (value, ", ", -1);

  /* Accept any protocol */
  if (!protocols)
    {
      pv->chosen_protocol = g_strdup (values[0]);
      g_debug ("automatically selected protocol: %s", pv->chosen_protocol);
      chosen = TRUE;
    }

  for (j = 0; !chosen && values[j] != NULL; j++)
    {
      for (i = 0; protocols[i] != NULL; i++)
        {
          if (g_str_equal (protocols[i], values[j]))
            {
              pv->chosen_protocol = g_strdup (values[j]);
              g_debug ("agreed on protocol: %s", pv->chosen_protocol);
              chosen = TRUE;
            }
        }
    }
  g_strfreev (values);

  if (chosen)
      g_object_notify (G_OBJECT (self), "protocol");
  else
      g_message ("received invalid or unsupported Sec-WebSocket-Protocol: %s", value);

  return chosen;
}

GMainContext *
_web_socket_connection_get_main_context (WebSocketConnection *self)
{
  g_return_val_if_fail (WEB_SOCKET_IS_CONNECTION (self), NULL);
  return GET_PRIV(self)->main_context;
}

static void
web_socket_connection_flow_iface_init (CockpitFlowInterface *iface)
{
  iface->throttle = web_socket_connection_throttle;
}

