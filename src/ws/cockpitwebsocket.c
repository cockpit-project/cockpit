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
  gchar                    *target_host;
  gint                      specific_port;
  gchar                    *specific_user;
  gchar                    *specific_password;
  gchar                    *agent_program;
  gchar                    *user;
  gchar                    *password;
  gchar                    *rhost;
  gint                      rport;

  CockpitTransport        *session;
  gboolean                 eof_to_session;

  GMainContext            *main_context;
} WebSocketData;

static void
web_socket_data_free (WebSocketData   *data)
{
  g_clear_object (&data->session);
  g_object_unref (data->web_socket);
  g_free (data->target_host);
  g_free (data->agent_program);
  g_free (data->user);
  g_free (data->rhost);
  g_free (data->specific_user);
  g_free (data->specific_password);
  g_free (data);
}

static void
send_error (WebSocketData *data,
            const gchar *command)
{
  gchar *json = g_strdup_printf ("{\"command\": \"error\", \"data\": \"%s\"}", command);
  GBytes *message = g_bytes_new_take (json, strlen (json));
  if (web_socket_connection_get_ready_state (data->web_socket) == WEB_SOCKET_STATE_OPEN)
    web_socket_connection_send (data->web_socket, WEB_SOCKET_DATA_TEXT, message);
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

static gboolean
on_session_recv (CockpitTransport *transport,
                 guint channel,
                 GBytes *payload,
                 gpointer user_data)
{
  WebSocketData *data = user_data;

  if (web_socket_connection_get_ready_state (data->web_socket) == WEB_SOCKET_STATE_OPEN)
    {
      web_socket_connection_send (data->web_socket, WEB_SOCKET_DATA_TEXT, payload);
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

  g_object_unref (data->session);
  data->session = NULL;

  if (web_socket_connection_get_ready_state (data->web_socket) < WEB_SOCKET_STATE_CLOSING)
    {
      if (problem)
        {
          send_error (data, problem);
          web_socket_connection_close (data->web_socket, WEB_SOCKET_CLOSE_SERVER_ERROR, problem);
        }
      else
        {
          web_socket_connection_close (data->web_socket, WEB_SOCKET_CLOSE_NORMAL, NULL);
        }
    }
}

static void
on_web_socket_message (WebSocketConnection *web_socket,
                       WebSocketDataType type,
                       GBytes *message,
                       WebSocketData *data)
{
  if (!data->session)
    {
      GError *error = NULL;
      gsize msg_len;
      gconstpointer msg_data;

      msg_data = g_bytes_get_data (message, &msg_len);

      if (msg_len > 0)
        {
          const gchar *userpass = msg_data;
          gsize len = msg_len;
          const gchar *sep = strchr (userpass, '\n');

          if (sep == NULL)
            data->specific_user = g_strndup (userpass, len);
          else
            {
              data->specific_user = g_strndup (userpass, sep - userpass);
              data->specific_password = g_strndup (sep + 1,
                                                   len - (sep - userpass) - 1);
            }
        }

      data->session = cockpit_fd_transport_spawn (data->target_host, data->specific_port, data->agent_program,
                                                  data->specific_user ? data->specific_user : data->user,
                                                  data->specific_password ? data->specific_password : data->password,
                                                  data->rhost, data->specific_user != NULL, &error);
      if (data->session)
        {
          g_signal_connect (data->session, "recv", G_CALLBACK (on_session_recv), data);
          g_signal_connect (data->session, "closed", G_CALLBACK (on_session_closed), data);
        }
      else
        {
          g_warning ("Failed to set up session: %s", error->message);
          g_clear_error (&error);

          send_error (data, "internal-error");
          web_socket_connection_close (web_socket,
                                       WEB_SOCKET_CLOSE_SERVER_ERROR,
                                       "transport-failed");
        }
    }
  else
    {
      /* TODO: Zero channel number until later */
      if (!data->eof_to_session)
        cockpit_transport_send (data->session, 0, message);
    }
}

static void
on_web_socket_open (WebSocketConnection *web_socket,
                    WebSocketData *data)
{
  get_remote_address (data->connection, &(data->rhost), &(data->rport));
  g_info ("New connection from %s:%d for %s%s%s", data->rhost, data->rport,
          data->user ? data->user : "", data->user ? "@" : "", data->target_host);

  /* We send auth errors as regular messages after establishing the
     connection because the WebSocket API doesn't let us see the HTTP
     status code.  We can't just use 'close' control frames to return a
     meaningful status code, but the old protocol doesn't have them.
  */
  if (!data->authenticated)
    {
      send_error (data, "no-session");
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
  g_debug ("web socket closing");

  /* Session is still around */
  if (data->session)
    {
      /*
       * Here we send an EOF to the session, and expect that the child
       * process will be ready for reaping soon.
       */
      if (!data->eof_to_session)
        {
          data->eof_to_session = TRUE;
          cockpit_transport_close (data->session, NULL);
        }

      /* Can't close web socket yet, transport 'closed' signal will do it */
      return FALSE;
    }

  /* Let the socket close */
  return TRUE;
}

static void
on_web_socket_close (WebSocketConnection *web_socket,
                     WebSocketData *data)
{
  g_info ("Connection from %s:%d for %s@%s closed", data->rhost, data->rport, data->user, data->target_host);
}

void
cockpit_web_socket_serve_dbus (CockpitWebServer *server,
                               const gchar *target_host,
                               guint16 specific_port,
                               const gchar *agent_program,
                               GIOStream *io_stream,
                               GHashTable *headers,
                               GByteArray *input_buffer,
                               CockpitAuth *auth)
{
  const gchar *protocols[] = { "cockpit1", NULL };
  WebSocketData *data;
  gchar *url;

  data = g_new0 (WebSocketData, 1);
  data->target_host = g_strdup (target_host);
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

  data->authenticated = cockpit_auth_check_headers (auth, headers,
                                                 &(data->user), &(data->password));

  /* TODO: We need to validate Host throughout */
  url = g_strdup_printf ("%s://host-not-yet-used/socket/%s",
                         G_IS_TLS_CONNECTION (io_stream) ? "wss" : "ws",
                         target_host);

  data->main_context = g_main_context_new ();
  g_main_context_push_thread_default (data->main_context);

  data->web_socket = web_socket_server_new_for_stream (url, NULL, protocols,
                                                       io_stream, headers,
                                                       input_buffer);

  g_free (url);

  g_signal_connect (data->web_socket, "open", G_CALLBACK (on_web_socket_open), data);
  g_signal_connect (data->web_socket, "closing", G_CALLBACK (on_web_socket_closing), data);
  g_signal_connect (data->web_socket, "close", G_CALLBACK (on_web_socket_close), data);
  g_signal_connect (data->web_socket, "error", G_CALLBACK (on_web_socket_error), data);

  while (web_socket_connection_get_ready_state (data->web_socket) != WEB_SOCKET_STATE_CLOSED)
    g_main_context_iteration (data->main_context, TRUE);

  g_main_context_pop_thread_default (data->main_context);
  g_main_context_unref (data->main_context);

  web_socket_data_free (data);
}
