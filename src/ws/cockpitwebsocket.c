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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

#include "config.h"

#include <string.h>

#include <json-glib/json-glib.h>
#include <gio/gunixinputstream.h>
#include <gio/gunixoutputstream.h>

#include <cockpit/cockpit.h>

#include "cockpitws.h"
#include "gsystem-local-alloc.h"

#include "websocket/websocket.h"

/* ---------------------------------------------------------------------------------------------------- */

typedef struct
{
  WebSocketConnection      *web_socket;
  GSocketConnection        *connection;
  gboolean                  authenticated;
  gint                      specific_port;
  gchar                    *agent_program;
  gchar                    *user;
  gchar                    *password;
  gchar                    *rhost;
  gint                      rport;

  JsonParser *parser;
  GHashTable *channels;    /* channel -> session */
  GHashTable *sessions;    /* session -> channel */
  gboolean eof_to_session;
  GBytes *control_prefix;

  GMainContext            *main_context;
} WebSocketData;

static void
web_socket_data_free (WebSocketData   *data)
{
  g_hash_table_unref (data->channels);
  g_hash_table_unref (data->sessions);
  g_object_unref (data->parser);
  g_object_unref (data->web_socket);
  g_bytes_unref (data->control_prefix);
  g_free (data->agent_program);
  g_free (data->user);
  g_free (data->password);
  g_free (data->rhost);
  g_free (data);
}

static void
report_close (WebSocketData *data,
              guint channel,
              const gchar *reason)
{
  GBytes *message;
  gchar *json;

  if (reason == NULL)
    reason = "";
  if (channel == 0)
    json = g_strdup_printf ("{\"command\": \"close\", \"reason\": \"%s\"}", reason);
  else
    json = g_strdup_printf ("{\"command\": \"close\", \"channel\": %u, \"reason\": \"%s\"}", channel, reason);

  message = g_bytes_new_take (json, strlen (json));
  if (web_socket_connection_get_ready_state (data->web_socket) == WEB_SOCKET_STATE_OPEN)
    web_socket_connection_send (data->web_socket, WEB_SOCKET_DATA_TEXT, data->control_prefix, message);
  g_bytes_unref (message);
}

static void
get_remote_address (GSocketConnection *connection,
                    gchar **rhost_out,
                    gint *rport_out)
{
  gs_unref_object GSocketAddress *remote = NULL;
  if (connection)
    remote = g_socket_connection_get_remote_address (connection, NULL);
  if (remote && G_IS_INET_SOCKET_ADDRESS (remote))
    {
      *rhost_out =
        g_inet_address_to_string (g_inet_socket_address_get_address (G_INET_SOCKET_ADDRESS (remote)));
      *rport_out =
        g_inet_socket_address_get_port (G_INET_SOCKET_ADDRESS (remote));
    }
  else
    {
      *rhost_out = g_strdup ("<unknown>");
      *rport_out = 0;
    }
}

static void
outbound_protocol_error (WebSocketData *data,
                         CockpitTransport *session)
{
  cockpit_transport_close (session, "protocol-error");
}

static gboolean
process_close (WebSocketData *data,
               guint channel,
               JsonObject *options)
{
  CockpitTransport *session;

  session = g_hash_table_lookup (data->channels, GUINT_TO_POINTER (channel));
  if (!session)
    {
      g_warning ("Closing a channel that doesn't exist: %u", channel);
      return FALSE;
    }

  /* TODO: Right now closing a channel means closing the session */
  cockpit_transport_close (session, NULL);
  return TRUE;
}

static void
dispatch_outbound_command (WebSocketData *data,
                           CockpitTransport *source,
                           GBytes *payload)
{
  const gchar *command;
  guint channel;
  JsonObject *options;
  gboolean valid = FALSE;

  if (cockpit_transport_parse_command (data->parser, payload,
                                       &command, &channel, &options))
    {
      /*
       * To prevent one host from messing with another, outbound commands
       * must have a channel, and it must match one of the channels opened
       * to that particular session.
       */
      if (channel == 0 || g_hash_table_lookup (data->channels, GUINT_TO_POINTER (channel)) != source)
        {
          g_warning ("Received a command with wrong channel from session");
          valid = FALSE;
        }
      else if (g_strcmp0 (command, "close") == 0)
        valid = process_close (data, channel, options);
      else if (g_strcmp0 (command, "ping") == 0)
        return; /* drop pings */
      else
        valid = TRUE; /* forward other messages */
    }

  if (valid && !data->eof_to_session)
    {
      if (web_socket_connection_get_ready_state (data->web_socket) == WEB_SOCKET_STATE_OPEN)
        web_socket_connection_send (data->web_socket, WEB_SOCKET_DATA_TEXT, data->control_prefix, payload);
    }
  else
    {
      outbound_protocol_error (data, source);
    }
}

static gboolean
on_session_recv (CockpitTransport *transport,
                 guint channel,
                 GBytes *payload,
                 gpointer user_data)
{
  WebSocketData *data = user_data;
  CockpitTransport *session;
  gchar *string;
  GBytes *prefix;

  if (channel == 0)
    {
      dispatch_outbound_command (data, transport, payload);
      return TRUE;
    }

  session = g_hash_table_lookup (data->channels, GUINT_TO_POINTER (channel));
  if (session == NULL)
    {
      g_warning ("Rceived message with unknown channel from session");
      outbound_protocol_error (data, transport);
      return FALSE;
    }
  else if (session != transport)
    {
      g_warning ("Received message with wrong channel from session");
      outbound_protocol_error (data, transport);
      return FALSE;
    }

  if (web_socket_connection_get_ready_state (data->web_socket) == WEB_SOCKET_STATE_OPEN)
    {
      string = g_strdup_printf ("%u\n", channel);
      prefix = g_bytes_new_take (string, strlen (string));
      web_socket_connection_send (data->web_socket, WEB_SOCKET_DATA_TEXT, prefix, payload);
      g_bytes_unref (prefix);
      return TRUE;
    }

  return FALSE;
}

static void
on_session_closed (CockpitTransport *transport,
                   const gchar *problem,
                   gpointer user_data)
{
  WebSocketData *data = user_data;
  guint channel;

  channel = GPOINTER_TO_UINT (g_hash_table_lookup (data->sessions, transport));
  if (channel != 0)
    {
      g_hash_table_remove (data->channels, GUINT_TO_POINTER (channel));
      g_hash_table_remove (data->sessions, transport);
      report_close (data, channel, problem);
    }
}

static gboolean
process_open (WebSocketData *data,
              guint channel,
              JsonObject *options)
{
  CockpitTransport *session;
  const gchar *specific_user = NULL;
  const gchar *password = NULL;
  const gchar *host = NULL;
  const gchar *user = NULL;
  JsonNode *node;
  GError *error = NULL;

  if (data->eof_to_session)
    {
      g_debug ("Ignoring open command during while web socket is closing");
      return TRUE;
    }

  if (g_hash_table_lookup (data->channels, GUINT_TO_POINTER (channel)))
    {
      g_warning ("Cannot open a channel with the same number as another channel");
      return FALSE;
    }

  node = json_object_get_member (options, "host");
  if (node && json_node_get_value_type (node) == G_TYPE_STRING)
    host = json_node_get_string (node);
  if (!host)
    host = "localhost";

  node = json_object_get_member (options, "user");
  if (node && json_node_get_value_type (node) == G_TYPE_STRING)
    user = specific_user = json_node_get_string (node);
  if (!user)
    user = data->user;

  /* Figure out the password to use */
  password = NULL;
  if (specific_user)
    {
      node = json_object_get_member (options, "password");
      if (node && json_node_get_value_type (node) == G_TYPE_STRING)
        password = json_node_get_string (node);
    }
  if (!password)
    password = data->password;

  /* TODO: For now one session per channel. eventually we want on one session per host/user */
  session = cockpit_fd_transport_spawn (host, data->specific_port, data->agent_program,
                                        user, password, data->rhost,
                                        specific_user != NULL, &error);

  if (session)
    {
      g_signal_connect (session, "recv", G_CALLBACK (on_session_recv), data);
      g_signal_connect (session, "closed", G_CALLBACK (on_session_closed), data);
      g_hash_table_insert (data->channels, GUINT_TO_POINTER (channel), g_object_ref (session));
      g_hash_table_insert (data->sessions, g_object_ref (session), GUINT_TO_POINTER (channel));
      g_object_unref (session);
    }
  else
    {
      g_warning ("Failed to set up session: %s", error->message);
      g_clear_error (&error);
      report_close (data, channel, "internal-error");
    }

  return TRUE;
}


static void
inbound_protocol_error (WebSocketData *data)
{
  if (web_socket_connection_get_ready_state (data->web_socket) == WEB_SOCKET_STATE_OPEN)
    {
      report_close (data, 0, "protocol-error");
      web_socket_connection_close (data->web_socket, WEB_SOCKET_CLOSE_SERVER_ERROR, "protocol-error");
    }
}

static void
dispatch_inbound_command (WebSocketData *data,
                          GBytes *payload)
{
  const gchar *command;
  guint channel;
  JsonObject *options;
  gboolean valid = FALSE;
  CockpitTransport *session;
  GHashTableIter iter;

  if (cockpit_transport_parse_command (data->parser, payload,
                                       &command, &channel, &options))
    {
      if (g_strcmp0 (command, "open") == 0)
        valid = process_open (data, channel, options);
      else if (g_strcmp0 (command, "close") == 0)
        valid = TRUE;
      else if (g_strcmp0 (command, "ping") == 0)
        return; /* drop pings */
      else
        valid = TRUE; /* forward other messages */
    }

  if (!valid)
    {
      inbound_protocol_error (data);
    }

  else if (channel == 0)
    {
      /* Control messages without a channel get sent to all sessions */
      g_hash_table_iter_init (&iter, data->sessions);
      while (g_hash_table_iter_next (&iter, NULL, (gpointer *)&session))
        cockpit_transport_send (session, 0, payload);
    }
  else
    {
      /* Control messages with a channel get forward to that session */
      session = g_hash_table_lookup (data->channels, GUINT_TO_POINTER (channel));
      if (session)
        cockpit_transport_send (session, 0, payload);
      else
        g_debug ("Dropping control message with unknown channel: %u", channel);
    }
}

static void
on_web_socket_message (WebSocketConnection *web_socket,
                       WebSocketDataType type,
                       GBytes *message,
                       WebSocketData *data)
{
  CockpitTransport *session;
  guint channel;
  GBytes *payload;

  payload = cockpit_transport_parse_frame (message, &channel);
  if (!payload)
    return;

  /* A control channel command */
  if (channel == 0)
    {
      dispatch_inbound_command (data, payload);
    }

  /* An actual payload message */
  else if (!data->eof_to_session)
    {
      session = g_hash_table_lookup (data->channels, GUINT_TO_POINTER (channel));
      if (session)
        cockpit_transport_send (session, channel, payload);
      else
        g_message ("Received message for unknown channel: %u", channel);
    }

  g_bytes_unref (payload);
}

static void
on_web_socket_open (WebSocketConnection *web_socket,
                    WebSocketData *data)
{
  get_remote_address (data->connection, &(data->rhost), &(data->rport));
  g_info ("New connection from %s:%d for %s", data->rhost, data->rport,
          data->user ? data->user : "");

  /* We send auth errors as regular messages after establishing the
     connection because the WebSocket API doesn't let us see the HTTP
     status code.  We can't just use 'close' control frames to return a
     meaningful status code, but the old protocol doesn't have them.
  */
  if (!data->authenticated)
    {
      report_close (data, 0, "no-session");
      web_socket_connection_close (web_socket,
                                   WEB_SOCKET_CLOSE_GOING_AWAY,
                                   "not-authenticated");
    }
  else
    g_signal_connect (web_socket, "message",
                      G_CALLBACK (on_web_socket_message), data);
}

static void
on_web_socket_error (WebSocketConnection *web_socket,
                     GError *error,
                     WebSocketData *data)
{
  g_warning ("%s", error->message);
}

static gboolean
on_web_socket_closing (WebSocketConnection *web_socket,
                       WebSocketData *data)
{
  CockpitTransport *session;
  GHashTableIter iter;
  gint sent = 0;

  g_debug ("web socket closing");

  if (!data->eof_to_session)
    {
      data->eof_to_session = TRUE;
      g_hash_table_iter_init (&iter, data->channels);
      while (g_hash_table_iter_next (&iter, NULL, (gpointer *)&session))
        {
          cockpit_transport_close (session, NULL);
          sent++;
        }
    }

  /*
   * If no sessions, we can close immediately. If we closed some sessions
   * they should have their 'closed' signals fired, in which case we'll
   * close the web socket from there
   */
  return sent == 0;
}

static void
on_web_socket_close (WebSocketConnection *web_socket,
                     WebSocketData *data)
{
  g_info ("Connection from %s:%d for %s closed",data->rhost, data->rport, data->user);
}

static gboolean
on_ping_time (gpointer user_data)
{
  WebSocketData *data = user_data;
  GBytes *message;
  const gchar *json;

  if (web_socket_connection_get_ready_state (data->web_socket) == WEB_SOCKET_STATE_OPEN)
    {
      json = g_strdup_printf ("{\"command\": \"ping\"}");
      message = g_bytes_new_static (json, strlen (json));
      web_socket_connection_send (data->web_socket, WEB_SOCKET_DATA_TEXT, data->control_prefix, message);
      g_bytes_unref (message);
    }

  return TRUE;
}

void
cockpit_web_socket_serve_dbus (CockpitWebServer *server,
                               guint16 specific_port,
                               const gchar *agent_program,
                               GIOStream *io_stream,
                               GHashTable *headers,
                               GByteArray *input_buffer,
                               CockpitAuth *auth)
{
  const gchar *protocols[] = { "cockpit1", NULL };
  WebSocketData *data;
  guint ping_id;
  gchar *url;

  data = g_new0 (WebSocketData, 1);
  data->specific_port = specific_port;
  data->agent_program = g_strdup (agent_program);
  if (G_IS_SOCKET_CONNECTION (io_stream))
    data->connection = g_object_ref (io_stream);
  else if (G_IS_TLS_CONNECTION (io_stream))
    {
      GIOStream *base;
      g_object_get (io_stream, "base-io-stream", &base, NULL);
      if (G_IS_SOCKET_CONNECTION (base))
        data->connection = g_object_ref (base);
    }

  data->parser = json_parser_new ();
  data->control_prefix = g_bytes_new_static ("0\n", 2);
  data->sessions = g_hash_table_new_full (g_direct_hash, g_direct_equal, g_object_unref, NULL);
  data->channels = g_hash_table_new_full (g_direct_hash, g_direct_equal, NULL, g_object_unref);

  data->authenticated = cockpit_auth_check_headers (auth, headers,
                                                 &(data->user), &(data->password));

  /* TODO: We need to validate Host throughout */
  url = g_strdup_printf ("%s://host-not-yet-used/socket",
                         G_IS_TLS_CONNECTION (io_stream) ? "wss" : "ws");

  data->main_context = g_main_context_new ();
  g_main_context_push_thread_default (data->main_context);

  /* TODO: This is just an arbitrary channel for now */
  data->web_socket = web_socket_server_new_for_stream (url, NULL, protocols,
                                                       io_stream, headers,
                                                       input_buffer);

  g_free (url);

  g_signal_connect (data->web_socket, "open", G_CALLBACK (on_web_socket_open), data);
  g_signal_connect (data->web_socket, "closing", G_CALLBACK (on_web_socket_closing), data);
  g_signal_connect (data->web_socket, "close", G_CALLBACK (on_web_socket_close), data);
  g_signal_connect (data->web_socket, "error", G_CALLBACK (on_web_socket_error), data);
  ping_id = g_timeout_add (5000, on_ping_time, data);

  while (web_socket_connection_get_ready_state (data->web_socket) != WEB_SOCKET_STATE_CLOSED)
    g_main_context_iteration (data->main_context, TRUE);

  g_source_remove (ping_id);
  g_main_context_pop_thread_default (data->main_context);
  g_main_context_unref (data->main_context);

  web_socket_data_free (data);
}
