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
#include "cockpit/cockpitjson.h"
#include "cockpit/cockpitpipetransport.h"

#include "cockpitws.h"
#include "cockpitsshtransport.h"

#include <gsystem-local-alloc.h>

#include "websocket/websocket.h"

/* Some tunables that can be set from tests */
const gchar *cockpit_ws_session_program =
    PACKAGE_LIBEXEC_DIR "/cockpit-session";

const gchar *cockpit_ws_agent_program =
    PACKAGE_LIBEXEC_DIR "/cockpit-agent";

const gchar *cockpit_ws_known_hosts =
    PACKAGE_LOCALSTATE_DIR "/lib/cockpit/known_hosts";

gint cockpit_ws_specific_ssh_port = 0;

/* ----------------------------------------------------------------------------
 * CockpitSession
 */

/* The session timeout when no channels */
#define TIMEOUT 30

typedef struct
{
  gchar *host;
  gchar *user;
} CockpitHostUser;

typedef struct
{
  CockpitHostUser key;
  GArray *channels;
  CockpitTransport *transport;
  gboolean sent_eof;
  guint timeout;
} CockpitSession;

typedef struct
{
  GHashTable *by_host_user;
  GHashTable *by_channel;
  GHashTable *by_transport;
} CockpitSessions;

static guint
host_user_hash (gconstpointer v)
{
  const CockpitHostUser *hu = v;
  return g_str_hash (hu->host) ^ g_str_hash (hu->user);
}

static gboolean
host_user_equal (gconstpointer v1,
                 gconstpointer v2)
{
  const CockpitHostUser *hu1 = v1;
  const CockpitHostUser *hu2 = v2;
  return g_str_equal (hu1->host, hu2->host) &&
         g_str_equal (hu1->user, hu2->user);
}

/* Should only called as a hash table GDestroyNotify */
static void
cockpit_session_free (gpointer data)
{
  CockpitSession *session = data;

  g_debug ("%s: freeing session", session->key.host);

  if (session->timeout)
    g_source_remove (session->timeout);
  g_array_free (session->channels, TRUE);
  g_object_unref (session->transport);
  g_free (session->key.host);
  g_free (session->key.user);
  g_free (session);
}

static void
cockpit_sessions_init (CockpitSessions *sessions)
{
  sessions->by_channel = g_hash_table_new (g_direct_hash, g_direct_equal);
  sessions->by_host_user = g_hash_table_new (host_user_hash, host_user_equal);

  /* This owns the session */
  sessions->by_transport = g_hash_table_new_full (g_direct_hash, g_direct_equal,
                                                  NULL, cockpit_session_free);
}

inline static CockpitSession *
cockpit_session_by_channel (CockpitSessions *sessions,
                            guint channel)
{
  return g_hash_table_lookup (sessions->by_channel, GUINT_TO_POINTER (channel));
}

inline static CockpitSession *
cockpit_session_by_transport (CockpitSessions *sessions,
                              CockpitTransport *transport)
{
  return g_hash_table_lookup (sessions->by_transport, transport);
}

inline static CockpitSession *
cockpit_session_by_host_user (CockpitSessions *sessions,
                              const gchar *host,
                              const gchar *user)
{
  const CockpitHostUser hu = { (gchar *)host, (gchar *)user };
  return g_hash_table_lookup (sessions->by_host_user, &hu);
}

static gboolean
on_timeout_cleanup_session (gpointer user_data)
{
  CockpitSession *session = user_data;

  session->timeout = 0;
  if (session->channels->len == 0)
    {
      /*
       * This should cause the transport to immediately be closed
       * and on_session_closed() will react and remove it from
       * the main session lookup tables.
       */
      g_debug ("%s: session timed out without channels", session->key.host);
      cockpit_transport_close (session->transport, "timeout");
    }
  return FALSE;
}

static void
cockpit_session_remove_channel (CockpitSessions *sessions,
                                CockpitSession *session,
                                guint channel)
{
  guint i;

  g_hash_table_remove (sessions->by_channel, GUINT_TO_POINTER (channel));

  for (i = 0; i < session->channels->len; i++)
    {
      if (g_array_index (session->channels, guint, i) == channel)
        g_array_remove_index_fast (session->channels, i++);
    }

  if (session->channels->len == 0)
    {
      /*
       * Close sessions that are no longer in use after N seconds
       * of them being that way.
       */
      g_debug ("%s: removed last channel %u for session", session->key.host, channel);
      session->timeout = g_timeout_add_seconds (TIMEOUT, on_timeout_cleanup_session, session);
    }
  else
    {
      g_debug ("%s: removed channel %u for session", session->key.host, channel);
    }
}

static void
cockpit_session_add_channel (CockpitSessions *sessions,
                             CockpitSession *session,
                             guint channel)
{
  g_hash_table_insert (sessions->by_channel, GUINT_TO_POINTER (channel), session);
  g_array_append_val (session->channels, channel);

  g_debug ("%s: added channel %u to session", session->key.host, channel);

  if (session->timeout)
    {
      g_source_remove (session->timeout);
      session->timeout = 0;
    }
}

static CockpitSession *
cockpit_session_track (CockpitSessions *sessions,
                       const gchar *host,
                       const gchar *user,
                       CockpitTransport *transport)
{
  CockpitSession *session;

  g_debug ("%s: new session", host);

  session = g_new0 (CockpitSession, 1);
  session->channels = g_array_sized_new (FALSE, TRUE, sizeof (guint), 2);
  session->transport = g_object_ref (transport);
  session->key.host = g_strdup (host);
  session->key.user = g_strdup (user);

  g_hash_table_insert (sessions->by_host_user, &session->key, session);

  /* This owns the session */
  g_hash_table_insert (sessions->by_transport, transport, session);

  return session;
}

static void
cockpit_session_destroy (CockpitSessions *sessions,
                         CockpitSession *session)
{
  guint channel;
  guint i;

  g_debug ("%s: destroy session", session->key.host);

  for (i = 0; i < session->channels->len; i++)
    {
      channel = g_array_index (session->channels, guint, i);
      g_hash_table_remove (sessions->by_channel, GUINT_TO_POINTER (channel));
    }

  g_hash_table_remove (sessions->by_host_user, &session->key);

  /* This owns the session */
  g_hash_table_remove (sessions->by_transport, session->transport);
}

static void
cockpit_sessions_cleanup (CockpitSessions *sessions)
{
  g_hash_table_destroy (sessions->by_channel);
  g_hash_table_destroy (sessions->by_host_user);
  g_hash_table_destroy (sessions->by_transport);
}

/* ----------------------------------------------------------------------------
 * Web Socket Routing
 */

typedef struct
{
  WebSocketConnection      *web_socket;
  GSocketConnection        *connection;
  CockpitCreds             *authenticated;
  const gchar              *user;
  gchar                    *rhost;
  gint                      rport;

  CockpitSessions sessions;
  gboolean closing;
  GBytes *control_prefix;

  GMainContext            *main_context;
} WebSocketData;

static void
web_socket_data_free (WebSocketData   *data)
{
  cockpit_sessions_cleanup (&data->sessions);
  g_object_unref (data->web_socket);
  g_bytes_unref (data->control_prefix);
  if (data->authenticated)
    cockpit_creds_unref (data->authenticated);
  g_free (data->rhost);
  g_free (data);
}

static void
report_close_with_extra (WebSocketData *data,
                         guint channel,
                         const gchar *reason,
                         const gchar *extra)
{
  GBytes *message;
  GString *json;

  json = g_string_new ("{\"command\": \"close\"");
  if (channel != 0)
    g_string_append_printf (json, ", \"channel\": %u", channel);
  g_string_append_printf (json, ", \"reason\": \"%s\"", reason ? reason : "");
  if (extra)
    g_string_append_printf (json, ", %s", extra);
  g_string_append (json, "}");

  message = g_string_free_to_bytes (json);
  if (web_socket_connection_get_ready_state (data->web_socket) == WEB_SOCKET_STATE_OPEN)
    web_socket_connection_send (data->web_socket, WEB_SOCKET_DATA_TEXT, data->control_prefix, message);
  g_bytes_unref (message);
}

static void
report_close (WebSocketData *data,
              guint channel,
              const gchar *reason)
{
  report_close_with_extra (data, channel, reason, NULL);
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
               CockpitSession *session,
               guint channel,
               JsonObject *options)
{
  cockpit_session_remove_channel (&data->sessions, session, channel);
  return TRUE;
}

static void
dispatch_outbound_command (WebSocketData *data,
                           CockpitTransport *source,
                           GBytes *payload)
{
  CockpitSession *session = NULL;
  const gchar *command;
  guint channel;
  JsonObject *options;
  gboolean valid = FALSE;
  gboolean forward = TRUE;

  if (cockpit_transport_parse_command (payload, &command, &channel, &options))
    {
      /*
       * To prevent one host from messing with another, outbound commands
       * must have a channel, and it must match one of the channels opened
       * to that particular session.
       */
      session = cockpit_session_by_channel (&data->sessions, channel);
      if (!session)
        {
          g_warning ("Channel does not exist: %u", channel);
          valid = FALSE;
        }
      else if (session->transport != source)
        {
          g_warning ("Received a command with wrong channel from session");
          valid = FALSE;
        }
      else if (g_strcmp0 (command, "close") == 0)
        valid = process_close (data, session, channel, options);
      else if (g_strcmp0 (command, "ping") == 0)
        {
          valid = TRUE;
          forward = FALSE;
        }
      else
        valid = TRUE; /* forward other messages */
    }

  if (valid && !session->sent_eof)
    {
      if (forward && web_socket_connection_get_ready_state (data->web_socket) == WEB_SOCKET_STATE_OPEN)
        web_socket_connection_send (data->web_socket, WEB_SOCKET_DATA_TEXT, data->control_prefix, payload);
    }
  else
    {
      outbound_protocol_error (data, source);
    }

  json_object_unref (options);
}

static gboolean
on_session_recv (CockpitTransport *transport,
                 guint channel,
                 GBytes *payload,
                 gpointer user_data)
{
  WebSocketData *data = user_data;
  CockpitSession *session;
  gchar *string;
  GBytes *prefix;

  if (channel == 0)
    {
      dispatch_outbound_command (data, transport, payload);
      return TRUE;
    }

  session = cockpit_session_by_channel (&data->sessions, channel);
  if (session == NULL)
    {
      g_warning ("Rceived message with unknown channel from session");
      outbound_protocol_error (data, transport);
      return FALSE;
    }
  else if (session->transport != transport)
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
  CockpitSession *session;
  CockpitSshTransport *ssh;
  gchar *extra = NULL;
  guint i;

  session = cockpit_session_by_transport (&data->sessions, transport);
  if (session != NULL)
    {
      if (g_strcmp0 (problem, "unknown-hostkey") == 0 &&
          COCKPIT_IS_SSH_TRANSPORT (transport))
        {
          ssh = COCKPIT_SSH_TRANSPORT (transport);
          extra = g_strdup_printf ("\"host-key\": \"%s\", \"host-fingerprint\": \"%s\"",
                                   cockpit_ssh_transport_get_host_key (ssh),
                                   cockpit_ssh_transport_get_host_fingerprint (ssh));
        }

      for (i = 0; i < session->channels->len; i++)
        report_close_with_extra (data, g_array_index (session->channels, guint, i), problem, extra);

      g_free (extra);
      cockpit_session_destroy (&data->sessions, session);
    }
}

static gboolean
process_open (WebSocketData *data,
              guint channel,
              JsonObject *options)
{
  CockpitSession *session;
  CockpitTransport *transport;
  CockpitCreds *creds;
  CockpitPipe *pipe;
  const gchar *specific_user;
  const gchar *password;
  const gchar *user;
  const gchar *host;
  const gchar *host_key;

  if (data->closing)
    {
      g_debug ("Ignoring open command during while web socket is closing");
      return TRUE;
    }

  if (cockpit_session_by_channel (&data->sessions, channel))
    {
      g_warning ("Cannot open a channel with the same number as another channel");
      return FALSE;
    }

  if (!cockpit_json_get_string (options, "host", "localhost", &host))
    host = "localhost";

  if (cockpit_json_get_string (options, "user", NULL, &specific_user) && specific_user)
    {
      if (!cockpit_json_get_string (options, "password", NULL, &password))
        password = NULL;
      creds = NULL;
      user = specific_user;
    }
  else
    {
      creds = data->authenticated;
      user = cockpit_creds_get_user (data->authenticated);
    }

  if (!cockpit_json_get_string (options, "host-key", NULL, &host_key))
    host_key = NULL;

  session = cockpit_session_by_host_user (&data->sessions, host, user);
  if (!session)
    {
      /* Used during testing */
      if (g_strcmp0 (host, "localhost") == 0)
        {
          if (cockpit_ws_specific_ssh_port != 0)
            host = "127.0.0.1";
        }

      if (g_strcmp0 (host, "localhost") == 0)
        {
          const gchar *argv_session[] =
            { cockpit_ws_session_program,
              user, data->rhost, cockpit_ws_agent_program, NULL };
          const gchar *argv_local[] =
            { cockpit_ws_agent_program, NULL, };
          gchar login[256];
          const gchar **argv;

          /*
           * If we're already in the right session, then skip cockpit-session.
           * This is used when testing, or running as your own user.
           *
           * This doesn't apply if this code is running as a service, or otherwise
           * unassociated from a terminal, we get a non-zero return value from
           * getlogin_r() in that case.
           */
          if (getlogin_r (login, sizeof (login)) == 0 &&
              g_str_equal (login, user))
            {
              argv = argv_local;
            }
          else
            {
              argv = argv_session;
            }

          /* Any failures happen asyncronously */
          pipe = cockpit_pipe_spawn (argv, NULL, NULL);
          transport = cockpit_pipe_transport_new (pipe);
          g_object_unref (pipe);
        }
      else
        {
          if (creds)
            cockpit_creds_ref (creds);
          else
            creds = cockpit_creds_new_password (user, password);
          transport = g_object_new (COCKPIT_TYPE_SSH_TRANSPORT,
                                    "host", host,
                                    "port", cockpit_ws_specific_ssh_port,
                                    "command", cockpit_ws_agent_program,
                                    "creds", creds,
                                    "known-hosts", cockpit_ws_known_hosts,
                                    "host-key", host_key,
                                    NULL);
          cockpit_creds_unref (creds);
        }

      g_signal_connect (transport, "recv", G_CALLBACK (on_session_recv), data);
      g_signal_connect (transport, "closed", G_CALLBACK (on_session_closed), data);
      session = cockpit_session_track (&data->sessions, host, user, transport);
      g_object_unref (transport);
    }

  cockpit_session_add_channel (&data->sessions, session, channel);
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
  gboolean forward = TRUE;
  CockpitSession *session;
  GHashTableIter iter;

  if (cockpit_transport_parse_command (payload, &command, &channel, &options))
    {
      if (g_strcmp0 (command, "open") == 0)
        valid = process_open (data, channel, options);
      else if (g_strcmp0 (command, "close") == 0)
        valid = TRUE;
      else if (g_strcmp0 (command, "ping") == 0)
        {
          valid = TRUE;
          forward = FALSE;
        }
      else
        valid = TRUE; /* forward other messages */
    }

  if (!valid)
    {
      inbound_protocol_error (data);
    }

  else if (forward && channel == 0)
    {
      /* Control messages without a channel get sent to all sessions */
      g_hash_table_iter_init (&iter, data->sessions.by_transport);
      while (g_hash_table_iter_next (&iter, NULL, (gpointer *)&session))
        {
          if (!session->sent_eof)
            cockpit_transport_send (session->transport, 0, payload);
        }
    }
  else if (forward)
    {
      /* Control messages with a channel get forward to that session */
      session = cockpit_session_by_channel (&data->sessions, channel);
      if (session)
        {
          if (!session->sent_eof)
            cockpit_transport_send (session->transport, 0, payload);
        }
      else
        g_debug ("Dropping control message with unknown channel: %u", channel);
    }

  json_object_unref (options);
}

static void
on_web_socket_message (WebSocketConnection *web_socket,
                       WebSocketDataType type,
                       GBytes *message,
                       WebSocketData *data)
{
  CockpitSession *session;
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
  else if (!data->closing)
    {
      session = cockpit_session_by_channel (&data->sessions, channel);
      if (session)
        {
          if (!session->sent_eof)
            cockpit_transport_send (session->transport, channel, payload);
        }
      else
        {
          g_debug ("Received message for unknown channel: %u", channel);
        }
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
  g_message ("%s", error->message);
}

static gboolean
on_web_socket_closing (WebSocketConnection *web_socket,
                       WebSocketData *data)
{
  CockpitSession *session;
  GHashTableIter iter;
  gint sent = 0;

  g_debug ("web socket closing");

  if (!data->closing)
    {
      data->closing = TRUE;
      g_hash_table_iter_init (&iter, data->sessions.by_transport);
      while (g_hash_table_iter_next (&iter, NULL, (gpointer *)&session))
        {
          session->sent_eof = TRUE;
          cockpit_transport_close (session->transport, NULL);
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
  if (G_IS_SOCKET_CONNECTION (io_stream))
    data->connection = g_object_ref (io_stream);
  else if (G_IS_TLS_CONNECTION (io_stream))
    {
      GIOStream *base;
      g_object_get (io_stream, "base-io-stream", &base, NULL);
      if (G_IS_SOCKET_CONNECTION (base))
        data->connection = g_object_ref (base);
    }

  data->control_prefix = g_bytes_new_static ("0\n", 2);
  cockpit_sessions_init (&data->sessions);

  data->authenticated = cockpit_auth_check_headers (auth, headers, NULL);
  if (data->authenticated)
    data->user = cockpit_creds_get_user (data->authenticated);

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
