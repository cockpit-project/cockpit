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

#include "cockpitwebsocketstream.h"

#include "cockpitconnect.h"
#include "cockpitstream.h"

#include "common/cockpitchannel.h"
#include "common/cockpitflow.h"
#include "common/cockpitjson.h"

#include "websocket/websocket.h"

#include <string.h>

/**
 * CockpitWebSocketStream:
 *
 * A #CockpitChannel that represents a WebSocket client
 *
 * The payload type for this channel is 'websocket-stream1'.
 */

#define COCKPIT_WEB_SOCKET_STREAM(o)    (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_WEB_SOCKET_STREAM, CockpitWebSocketStream))

typedef struct _CockpitWebSocketStream {
  CockpitChannel parent;

  /* The nickname for debugging and logging */
  gchar *url;
  gchar *origin;

  /* The connection */
  WebSocketConnection *client;
  gulong sig_open;
  gulong sig_message;
  gulong sig_closing;
  gulong sig_close;
  gulong sig_error;

  gboolean binary;
  gboolean closed;
  gushort last_error_code;

} CockpitWebSocketStream;

G_DEFINE_TYPE (CockpitWebSocketStream, cockpit_web_socket_stream, COCKPIT_TYPE_CHANNEL);

static void
cockpit_web_socket_stream_recv (CockpitChannel *channel,
                                GBytes *message)
{
  CockpitWebSocketStream *self = COCKPIT_WEB_SOCKET_STREAM (channel);
  WebSocketDataType type;
  WebSocketState state;

  /* Should never be called before cockpit_channel_ready() */
  g_return_if_fail (self->client != NULL);

  state = web_socket_connection_get_ready_state (self->client);
  g_return_if_fail (state >= WEB_SOCKET_STATE_OPEN);

  if (state == WEB_SOCKET_STATE_OPEN)
    {
      type = self->binary ? WEB_SOCKET_DATA_BINARY : WEB_SOCKET_DATA_TEXT;
      web_socket_connection_send (self->client, type, NULL, message);
    }
}

static gboolean
cockpit_web_socket_stream_control (CockpitChannel *channel,
                                   const gchar *command,
                                   JsonObject *options)
{
  CockpitWebSocketStream *self = COCKPIT_WEB_SOCKET_STREAM (channel);

  if (!g_str_equal (command, "done"))
    return FALSE;

  if (self->client && web_socket_connection_get_ready_state (self->client) == WEB_SOCKET_STATE_OPEN)
    web_socket_connection_close (self->client, WEB_SOCKET_CLOSE_NORMAL, "disconnected");

  return TRUE;
}

static void
cockpit_web_socket_stream_close (CockpitChannel *channel,
                                 const gchar *problem)
{
  CockpitWebSocketStream *self = COCKPIT_WEB_SOCKET_STREAM (channel);

  self->closed = TRUE;
  if (self->client && web_socket_connection_get_ready_state (self->client) < WEB_SOCKET_STATE_CLOSING)
    {
      if (problem)
        web_socket_connection_close (self->client, WEB_SOCKET_CLOSE_ABNORMAL, problem);
      else
        web_socket_connection_close (self->client, WEB_SOCKET_CLOSE_NORMAL, "disconnected");
    }
  COCKPIT_CHANNEL_CLASS (cockpit_web_socket_stream_parent_class)->close (channel, problem);
}

static void
cockpit_web_socket_stream_init (CockpitWebSocketStream *self)
{

}

static void
on_web_socket_open (WebSocketConnection *connection,
                    gpointer user_data)
{
  CockpitWebSocketStream *self = COCKPIT_WEB_SOCKET_STREAM (user_data);
  CockpitChannel *channel = COCKPIT_CHANNEL (user_data);
  JsonObject *object;
  JsonObject *headers;
  GHashTableIter iter;
  gpointer key, value;

  headers = json_object_new ();

  g_hash_table_iter_init (&iter, web_socket_client_get_headers (WEB_SOCKET_CLIENT (self->client)));
  while (g_hash_table_iter_next (&iter, &key, &value))
    json_object_set_string_member (headers, key, value);

  object = json_object_new ();
  json_object_set_object_member (object, "headers", headers);

  cockpit_channel_control (channel, "response", object);
  json_object_unref (object);

  cockpit_channel_ready (channel, NULL);
}

static void
on_web_socket_message (WebSocketConnection *connection,
                       WebSocketDataType type,
                       GBytes *message,
                       gpointer user_data)
{
  CockpitChannel *channel = COCKPIT_CHANNEL (user_data);
  cockpit_channel_send (channel, message, type == WEB_SOCKET_DATA_TEXT);
}

static gboolean
on_web_socket_closing (WebSocketConnection *connection,
                       gpointer user_data)
{
  CockpitChannel *channel = COCKPIT_CHANNEL (user_data);
  cockpit_channel_control (channel, "done", NULL);
  return TRUE;
}

static gboolean
on_web_socket_error (WebSocketConnection *ws,
                     GError *error,
                     gpointer user_data)
{
  CockpitWebSocketStream *self = COCKPIT_WEB_SOCKET_STREAM (user_data);
  self->last_error_code = 0;
  if (error && error->domain == WEB_SOCKET_ERROR)
    self->last_error_code = error->code;

  return TRUE;
}

static void
on_web_socket_close (WebSocketConnection *connection,
                     gpointer user_data)
{
  CockpitWebSocketStream *self = COCKPIT_WEB_SOCKET_STREAM (user_data);
  CockpitChannel *channel = COCKPIT_CHANNEL (user_data);
  const gchar *problem;
  gushort code;

  code = web_socket_connection_get_close_code (connection);
  problem = web_socket_connection_get_close_data (connection);

  if (code == WEB_SOCKET_CLOSE_NORMAL || code == WEB_SOCKET_CLOSE_GOING_AWAY)
    {
      problem = NULL;
    }
  else if (problem == NULL || !problem[0])
    {
      /* If we don't have a code but have a last error
       * use it's code */
      if (code == 0)
        code = self->last_error_code;

      switch (code)
        {
        case WEB_SOCKET_CLOSE_NO_STATUS:
        case WEB_SOCKET_CLOSE_ABNORMAL:
          problem = "disconnected";
          break;
        case WEB_SOCKET_CLOSE_PROTOCOL:
        case WEB_SOCKET_CLOSE_UNSUPPORTED_DATA:
        case WEB_SOCKET_CLOSE_BAD_DATA:
        case WEB_SOCKET_CLOSE_POLICY_VIOLATION:
        case WEB_SOCKET_CLOSE_TOO_BIG:
        case WEB_SOCKET_CLOSE_TLS_HANDSHAKE:
          problem = "protocol-error";
          break;
        case WEB_SOCKET_CLOSE_NO_EXTENSION:
          problem = "unsupported";
          break;
        default:
          problem = "internal-error";
          break;
        }
    }

  cockpit_channel_close (channel, problem);
}

static void
on_socket_connect (GObject *object,
                   GAsyncResult *result,
                   gpointer user_data)
{
  g_autoptr(CockpitWebSocketStream) self = user_data; /* capture the ref passed to the async op */
  CockpitChannel *channel = COCKPIT_CHANNEL (self);
  g_autofree const gchar **protocols = NULL;
  g_autoptr(GList) names = NULL;
  g_autoptr(GError) error = NULL;

  g_autoptr(GIOStream) io = cockpit_connect_stream_finish (result, &error);
  if (error)
    {
      const char *problem = cockpit_stream_problem (error, self->origin, "couldn't connect",
                                                    cockpit_channel_close_options (channel));
      cockpit_channel_close (channel, problem);
      return;
    }

  JsonObject *options = cockpit_channel_get_options (channel);

  if (!cockpit_json_get_strv (options, "protocols", NULL, &protocols))
    {
      cockpit_channel_fail (channel, "protocol-error",
                            "%s: invalid \"protocol\" value in WebSocket stream request", self->origin);
      return;
    }

  self->client = web_socket_client_new_for_stream (self->url, self->origin, protocols, io);

  JsonNode *node = json_object_get_member (options, "headers");
  if (node)
    {
      if (!JSON_NODE_HOLDS_OBJECT (node))
        {
          cockpit_channel_fail (channel, "protocol-error",
                                "%s: invalid \"headers\" field in WebSocket stream request", self->origin);
          return;
        }

      JsonObject *headers = json_node_get_object (node);
      names = json_object_get_members (headers);
      for (GList *l = names; l != NULL; l = g_list_next (l))
        {
          node = json_object_get_member (headers, l->data);
          if (!node || !JSON_NODE_HOLDS_VALUE (node) || json_node_get_value_type (node) != G_TYPE_STRING)
            {
              cockpit_channel_fail (channel, "protocol-error",
                                    "%s: invalid header value in WebSocket stream request: %s",
                                    self->origin, (gchar *)l->data);
              return;
            }
          const gchar *value = json_node_get_string (node);

          g_debug ("%s: sending header: %s %s", self->origin, (gchar *)l->data, value);
          web_socket_client_include_header (WEB_SOCKET_CLIENT (self->client), l->data, value);
        }
    }

  self->sig_open = g_signal_connect (self->client, "open", G_CALLBACK (on_web_socket_open), self);
  self->sig_message = g_signal_connect (self->client, "message", G_CALLBACK (on_web_socket_message), self);
  self->sig_closing = g_signal_connect (self->client, "closing", G_CALLBACK (on_web_socket_closing), self);
  self->sig_close = g_signal_connect (self->client, "close", G_CALLBACK (on_web_socket_close), self);
  self->sig_error = g_signal_connect (self->client, "error", G_CALLBACK (on_web_socket_error), self);

  /* Let the channel throttle the websocket's input flow*/
  cockpit_flow_throttle (COCKPIT_FLOW (self->client), COCKPIT_FLOW (self));

  /* Let the websocket throtlte the channel peer's output flow */
  cockpit_flow_throttle (COCKPIT_FLOW (channel), COCKPIT_FLOW (self->client));
}

static void
cockpit_web_socket_stream_prepare (CockpitChannel *channel)
{
  CockpitWebSocketStream *self = COCKPIT_WEB_SOCKET_STREAM (channel);
  CockpitConnectable *connectable = NULL;
  JsonObject *options;
  const gchar *path;

  COCKPIT_CHANNEL_CLASS (cockpit_web_socket_stream_parent_class)->prepare (channel);

  if (self->closed)
    goto out;

  connectable = cockpit_connect_parse_stream (channel);
  if (!connectable)
    goto out;

  options = cockpit_channel_get_options (channel);
  if (!cockpit_json_get_string (options, "path", NULL, &path))
    {
      cockpit_channel_fail (channel, "protocol-error",
                            "%s: bad \"path\" field in WebSocket stream request", self->origin);
      goto out;
    }
  else if (path == NULL || path[0] != '/')
    {
      cockpit_channel_fail (channel, "protocol-error",
                            "%s: invalid or missing \"path\" field in WebSocket stream request", self->origin);
      goto out;
    }

  self->url = g_strdup_printf ("%s://%s%s", connectable->tls ? "wss" : "ws", connectable->name, path);
  self->origin = g_strdup_printf ("%s://%s", connectable->tls ? "https" : "http", connectable->name);

  /* Parsed elsewhere */
  self->binary = json_object_has_member (options, "binary");

  cockpit_connect_stream_full (connectable, NULL, on_socket_connect, g_object_ref (self));

out:
  if (connectable)
    cockpit_connectable_unref (connectable);
}

static void
cockpit_web_socket_stream_dispose (GObject *object)
{
  CockpitWebSocketStream *self = COCKPIT_WEB_SOCKET_STREAM (object);

  if (self->client)
    {
      if (web_socket_connection_get_ready_state (self->client) < WEB_SOCKET_STATE_CLOSING)
        web_socket_connection_close (self->client, WEB_SOCKET_CLOSE_GOING_AWAY, "disconnected");
      g_signal_handler_disconnect (self->client, self->sig_open);
      g_signal_handler_disconnect (self->client, self->sig_message);
      g_signal_handler_disconnect (self->client, self->sig_closing);
      g_signal_handler_disconnect (self->client, self->sig_close);
      g_signal_handler_disconnect (self->client, self->sig_error);

      g_object_unref (self->client);
      self->client = NULL;
    }

  G_OBJECT_CLASS (cockpit_web_socket_stream_parent_class)->dispose (object);
}

static void
cockpit_web_socket_stream_finalize (GObject *object)
{
  CockpitWebSocketStream *self = COCKPIT_WEB_SOCKET_STREAM (object);

  g_free (self->url);
  g_free (self->origin);
  g_assert (self->client == NULL);

  G_OBJECT_CLASS (cockpit_web_socket_stream_parent_class)->finalize (object);
}

static void
cockpit_web_socket_stream_constructed (GObject *object)
{
  static const gchar *caps[] = { "tls-certificates", "address", NULL };
  G_OBJECT_CLASS (cockpit_web_socket_stream_parent_class)->constructed (object);
  g_object_set (object, "capabilities", &caps, NULL);
}

static void
cockpit_web_socket_stream_class_init (CockpitWebSocketStreamClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);
  CockpitChannelClass *channel_class = COCKPIT_CHANNEL_CLASS (klass);

  gobject_class->dispose = cockpit_web_socket_stream_dispose;
  gobject_class->finalize = cockpit_web_socket_stream_finalize;
  gobject_class->constructed = cockpit_web_socket_stream_constructed;

  channel_class->prepare = cockpit_web_socket_stream_prepare;
  channel_class->control = cockpit_web_socket_stream_control;
  channel_class->recv = cockpit_web_socket_stream_recv;
  channel_class->close = cockpit_web_socket_stream_close;
}
