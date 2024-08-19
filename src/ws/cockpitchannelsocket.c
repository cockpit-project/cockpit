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

#include "cockpitchannelsocket.h"

#include "common/cockpitchannel.h"
#include "common/cockpitflow.h"

#include "websocket/websocket.h"

#include <string.h>

#define COCKPIT_TYPE_CHANNEL_SOCKET  (cockpit_channel_socket_get_type ())
#define COCKPIT_CHANNEL_SOCKET(o)    (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_CHANNEL_SOCKET, CockpitChannelSocket))
#define COCKPIT_IS_CHANNEL_SOCKET(o) (G_TYPE_CHECK_INSTANCE_TYPE ((o), COCKPIT_TYPE_CHANNEL_SOCKET))

typedef struct {
  CockpitChannel parent;
  gboolean closed;

  /* The WebSocket side of things */
  WebSocketConnection *socket;
  WebSocketDataType data_type;
  gulong socket_open;
  gulong socket_message;
  gulong socket_close;
} CockpitChannelSocket;

typedef struct {
  CockpitChannelClass parent;
} CockpitChannelSocketClass;

GType              cockpit_channel_socket_get_type    (void);

G_DEFINE_TYPE (CockpitChannelSocket, cockpit_channel_socket, COCKPIT_TYPE_CHANNEL);

static void
cockpit_channel_socket_init (CockpitChannelSocket *self)
{

}

static void
cockpit_channel_socket_recv (CockpitChannel *channel,
                             GBytes *payload)
{
  CockpitChannelSocket *self = COCKPIT_CHANNEL_SOCKET (channel);

  if (web_socket_connection_get_ready_state (self->socket) == WEB_SOCKET_STATE_OPEN)
    web_socket_connection_send (self->socket, self->data_type, NULL, payload);
}

static void
cockpit_channel_socket_finalize (GObject *object)
{
  CockpitChannelSocket *self = COCKPIT_CHANNEL_SOCKET (object);

  g_signal_handler_disconnect (self->socket, self->socket_open);
  g_signal_handler_disconnect (self->socket, self->socket_message);
  g_signal_handler_disconnect (self->socket, self->socket_close);
  g_object_unref (self->socket);

  G_OBJECT_CLASS (cockpit_channel_socket_parent_class)->finalize (object);
}

static void
cockpit_channel_socket_close (CockpitChannel *channel,
                              const gchar *problem)
{
  CockpitChannelSocket *self = COCKPIT_CHANNEL_SOCKET (channel);
  gushort code;

  self->closed = TRUE;

  if (web_socket_connection_get_ready_state (self->socket) < WEB_SOCKET_STATE_CLOSING)
    {
      if (problem)
        code = WEB_SOCKET_CLOSE_GOING_AWAY;
      else
        code = WEB_SOCKET_CLOSE_NORMAL;
      web_socket_connection_close (self->socket, code, problem);
    }
}

static void
on_socket_open (WebSocketConnection *connection,
                gpointer user_data)
{
  CockpitChannel *channel = COCKPIT_CHANNEL (user_data);
  JsonObject *open;

  /*
   * Actually open the channel. We wait until the WebSocket is open
   * before doing this, so we don't receive messages from the bridge
   * before the websocket is open.
   */

  open = cockpit_channel_get_options (channel);
  cockpit_channel_control (channel, "open", open);

  /* Tell the channel we're ready */
  cockpit_channel_ready (channel, NULL);
}

static void
on_socket_message (WebSocketConnection *connection,
                   WebSocketDataType data_type,
                   GBytes *payload,
                   gpointer user_data)
{
  CockpitChannel *channel = COCKPIT_CHANNEL (user_data);
  cockpit_channel_send (channel, payload, data_type == WEB_SOCKET_DATA_TEXT);
}

static void
on_socket_close (WebSocketConnection *socket,
                 gpointer user_data)
{
  CockpitChannelSocket *self = COCKPIT_CHANNEL_SOCKET (user_data);
  CockpitChannel *channel = COCKPIT_CHANNEL (user_data);
  const gchar *problem = NULL;
  gushort code;

  if (self->closed)
    return;

  code = web_socket_connection_get_close_code (socket);
  if (code == WEB_SOCKET_CLOSE_NORMAL)
    {
      cockpit_channel_control (channel, "done", NULL);
    }
  else
    {
      problem = web_socket_connection_get_close_data (socket);
      if (problem == NULL)
        problem = "disconnected";
    }

  cockpit_channel_close (channel, problem);
}

static void
respond_with_error (CockpitWebRequest *request,
                    guint status,
                    const gchar *message)
{
  CockpitWebResponse *response;

  response = cockpit_web_request_respond (request);
  cockpit_web_response_error (response, status, NULL, "%s", message);
  g_object_unref (response);
}

static void
cockpit_channel_socket_class_init (CockpitChannelSocketClass *klass)
{
  CockpitChannelClass *channel_class = COCKPIT_CHANNEL_CLASS (klass);
  GObjectClass *object_class = G_OBJECT_CLASS (klass);

  object_class->finalize = cockpit_channel_socket_finalize;

  channel_class->recv = cockpit_channel_socket_recv;
  channel_class->close = cockpit_channel_socket_close;
}

void
cockpit_channel_socket_open (CockpitWebService *service,
                             JsonObject *open,
                             CockpitWebRequest *request)
{
  CockpitChannelSocket *self = NULL;
  WebSocketDataType data_type;
  CockpitTransport *transport;
  g_autofree const gchar **protocols = NULL;
  g_autofree gchar *id = NULL;

  if (!cockpit_web_service_parse_external (open, NULL, NULL, NULL, &protocols) ||
      !cockpit_web_service_parse_binary (open, &data_type))
    {
      respond_with_error (request, 400, "Bad channel request");
      return;
    }

  transport = cockpit_web_service_get_transport (service);
  if (!transport)
    {
      respond_with_error (request, 502, "Failed to open channel transport");
      return;
    }

  json_object_set_boolean_member (open, "flow-control", TRUE);

  id = cockpit_web_service_unique_channel (service);
  self = g_object_new (COCKPIT_TYPE_CHANNEL_SOCKET,
                       "transport", transport,
                       "options", open,
                       "id", id,
                       NULL);

  self->data_type = data_type;

  self->socket = cockpit_web_service_create_socket (protocols, request);
  self->socket_open = g_signal_connect (self->socket, "open", G_CALLBACK (on_socket_open), self);
  self->socket_message = g_signal_connect (self->socket, "message", G_CALLBACK (on_socket_message), self);
  self->socket_close = g_signal_connect (self->socket, "close", G_CALLBACK (on_socket_close), self);

  /* Unref when the channel closes */
  g_signal_connect_after (self, "closed", G_CALLBACK (g_object_unref), NULL);

  /* Tell the channel to throttle based on back pressure from socket */
  cockpit_flow_throttle (COCKPIT_FLOW (self), COCKPIT_FLOW (self->socket));

  /* Tell the socket peer's output to throttle based on back pressure */
  cockpit_flow_throttle (COCKPIT_FLOW (self->socket), COCKPIT_FLOW (self));
}
