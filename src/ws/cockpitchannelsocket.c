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

#include "cockpitchannelsocket.h"

#include "websocket/websocket.h"

#include <string.h>

typedef struct {
  gchar *channel;

  /* The WebSocket side of things */
  WebSocketConnection *socket;
  WebSocketDataType data_type;
  gulong socket_open;
  gulong socket_message;
  gulong socket_close;

  /* The bridge side of things */
  CockpitTransport *transport;
  JsonObject *open;
  gulong transport_recv;
  gulong transport_control;
  gulong transport_closed;
} CockpitChannelSocket;

static void     cockpit_channel_socket_close     (CockpitChannelSocket *socket,
                                                  const gchar *problem);

static gboolean
on_transport_recv (CockpitTransport *transport,
                   const gchar *channel,
                   GBytes *payload,
                   CockpitChannelSocket *chock)
{
  if (channel && g_str_equal (channel, chock->channel))
    {
      if (web_socket_connection_get_ready_state (chock->socket) == WEB_SOCKET_STATE_OPEN)
          web_socket_connection_send (chock->socket, chock->data_type, NULL, payload);
      return TRUE;
    }

  return FALSE;
}

static gboolean
on_transport_control (CockpitTransport *transport,
                      const char *command,
                      const gchar *channel,
                      JsonObject *options,
                      GBytes *payload,
                      CockpitChannelSocket *chock)
{
  const gchar *problem;

  if (channel && g_str_equal (channel, chock->channel))
    {
      if (g_str_equal (command, "close"))
        {
          if (!cockpit_json_get_string (options, "problem", NULL, &problem))
            problem = NULL;
          cockpit_channel_socket_close (chock, problem);
        }

      /* Any other control message for this channel is discarded */
      return TRUE;
    }

  return FALSE;
}

static void
on_transport_closed (CockpitTransport *transport,
                     const gchar *problem,
                     CockpitChannelSocket *chock)
{
  cockpit_channel_socket_close (chock, problem);
}

static void
cockpit_channel_socket_close (CockpitChannelSocket *chock,
                              const gchar *problem)
{
  gushort code;

  g_free (chock->channel);

  g_signal_handler_disconnect (chock->transport, chock->transport_recv);
  g_signal_handler_disconnect (chock->transport, chock->transport_control);
  g_signal_handler_disconnect (chock->transport, chock->transport_closed);
  json_object_unref (chock->open);
  g_object_unref (chock->transport);

  g_signal_handler_disconnect (chock->socket, chock->socket_open);
  g_signal_handler_disconnect (chock->socket, chock->socket_message);
  g_signal_handler_disconnect (chock->socket, chock->socket_close);
  if (web_socket_connection_get_ready_state (chock->socket) < WEB_SOCKET_STATE_CLOSING)
    {
      if (problem)
        code = WEB_SOCKET_CLOSE_GOING_AWAY;
      else
        code = WEB_SOCKET_CLOSE_NORMAL;
      web_socket_connection_close (chock->socket, code, problem);
    }
  g_object_unref (chock->socket);

  g_free (chock);
}

static void
on_socket_open (WebSocketConnection *connection,
                CockpitChannelSocket *chock)
{
  GBytes *payload;

  /*
   * Actually open the channel. We wait until the WebSocket is open
   * before doing this, so we don't receive messages from the bridge
   * before the websocket is open.
   */

  payload = cockpit_json_write_bytes (chock->open);
  cockpit_transport_send (chock->transport, NULL, payload);
  g_bytes_unref (payload);
}

static void
on_socket_message (WebSocketConnection *connection,
                   WebSocketDataType type,
                   GBytes *payload,
                   CockpitChannelSocket *chock)
{
  cockpit_transport_send (chock->transport, chock->channel, payload);
}

static void
on_socket_close (WebSocketConnection *connection,
                 CockpitChannelSocket *chock)
{
  const gchar *problem = NULL;
  GBytes *payload;
  gushort code;

  code = web_socket_connection_get_close_code (chock->socket);
  if (code == WEB_SOCKET_CLOSE_NORMAL)
    {
      payload = cockpit_transport_build_control ("command", "done", "channel", chock->channel, NULL);
      cockpit_transport_send (chock->transport, NULL, payload);
      g_bytes_unref (payload);
    }
  else
    {
      problem = web_socket_connection_get_close_data (chock->socket);
      if (problem == NULL)
        problem = "disconnected";
    }

  payload = cockpit_transport_build_control ("command", "close", "channel", chock->channel, "problem", problem, NULL);
  cockpit_transport_send (chock->transport, NULL, payload);
  g_bytes_unref (payload);

  cockpit_channel_socket_close (chock, problem);
}

void
cockpit_channel_socket_open (CockpitWebService *self,
                             const gchar *path,
                             const gchar *escaped,
                             GIOStream *io_stream,
                             GHashTable *headers,
                             GByteArray *input_buffer)
{
  CockpitChannelSocket *chock = NULL;
  const gchar *array[] = { NULL, NULL };
  CockpitWebResponse *response;
  WebSocketDataType data_type;
  const gchar **protocols;
  const gchar *protocol;
  JsonObject *open = NULL;
  GBytes *bytes = NULL;
  const gchar *channel;
  gchar *data;

  data = g_uri_unescape_string (escaped, "/");
  if (data == NULL)
    {
      g_warning ("invalid sideband query string");
      goto out;
    }

  bytes = g_bytes_new_take (data, strlen (data));
  if (!cockpit_transport_parse_command (bytes, NULL, &channel, &open))
    {
      g_warning ("invalid sideband command");
      goto out;
    }

  if (channel != NULL)
    {
      g_warning ("should not specify \"channel\" in sideband command: %s", channel);
      goto out;
    }

  if (!cockpit_json_get_string (open, "protocol", NULL, &protocol))
    {
      g_warning ("invalid sideband \"protocol\" option");
      goto out;
    }
  else if (protocol)
    {
      array[0] = protocol;
      protocols = array;
    }
  else
    {
      protocols = NULL;
    }

  json_object_set_string_member (open, "command", "open");

  if (!cockpit_web_service_parse_binary (open, &data_type))
    goto out;

  chock = g_new0 (CockpitChannelSocket, 1);
  chock->channel = cockpit_web_service_unique_channel (self);
  json_object_set_string_member (open, "channel", chock->channel);
  chock->open = json_object_ref (open);
  chock->data_type = data_type;

  chock->socket = cockpit_web_service_create_socket (protocols, path, escaped,
                                                     io_stream, headers, input_buffer);
  chock->socket_open = g_signal_connect (chock->socket, "open", G_CALLBACK (on_socket_open), chock);
  chock->socket_message = g_signal_connect (chock->socket, "message", G_CALLBACK (on_socket_message), chock);
  chock->socket_close = g_signal_connect (chock->socket, "close", G_CALLBACK (on_socket_close), chock);

  chock->transport = cockpit_web_service_ensure_transport (self, open);
  chock->transport_recv = g_signal_connect (chock->transport, "recv", G_CALLBACK (on_transport_recv), chock);
  chock->transport_control = g_signal_connect (chock->transport, "control", G_CALLBACK (on_transport_control), chock);
  chock->transport_closed = g_signal_connect (chock->transport, "closed", G_CALLBACK (on_transport_closed), chock);

  open = NULL;

out:
  if (bytes)
    g_bytes_unref (bytes);
  if (open)
    json_object_unref (open);

  if (!chock)
    {
      /* If above failed, then send back a 'Bad Request' response */
      response = cockpit_web_response_new (io_stream, path, NULL, headers);
      cockpit_web_response_error (response, 400, NULL, NULL);
      g_object_unref (response);
    }
}
