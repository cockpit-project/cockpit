/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013-2014 Red Hat, Inc.
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

#include "cockpitwebservice.h"

#include <string.h>

#include <json-glib/json-glib.h>
#include <gio/gunixinputstream.h>
#include <gio/gunixoutputstream.h>

#include <cockpit/cockpit.h>
#include "cockpit/cockpitjson.h"
#include "cockpit/cockpitpipetransport.h"

#include "cockpitsshtransport.h"

#include <gsystem-local-alloc.h>

#include "websocket/websocket.h"

#include "reauthorize/reauthorize.h"

/* Some tunables that can be set from tests */
const gchar *cockpit_ws_session_program =
    PACKAGE_LIBEXEC_DIR "/cockpit-session";

const gchar *cockpit_ws_agent_program =
    PACKAGE_LIBEXEC_DIR "/cockpit-agent";

const gchar *cockpit_ws_known_hosts =
    PACKAGE_LOCALSTATE_DIR "/lib/cockpit/known_hosts";

const gchar *cockpit_ws_default_host_header =
    "0.0.0.0:0"; /* Must be something invalid */

gint cockpit_ws_specific_ssh_port = 0;

guint cockpit_ws_ping_interval = 5;

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
  GHashTable *channels;
  CockpitTransport *transport;
  gboolean sent_eof;
  guint timeout;
  CockpitCreds *creds;
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
  g_hash_table_unref (session->channels);
  g_object_unref (session->transport);
  g_free (session->key.host);
  g_free (session->key.user);
  g_free (session);
}

static void
cockpit_sessions_init (CockpitSessions *sessions)
{
  sessions->by_channel = g_hash_table_new (g_str_hash, g_str_equal);
  sessions->by_host_user = g_hash_table_new (host_user_hash, host_user_equal);

  /* This owns the session */
  sessions->by_transport = g_hash_table_new_full (g_direct_hash, g_direct_equal,
                                                  NULL, cockpit_session_free);
}

inline static CockpitSession *
cockpit_session_by_channel (CockpitSessions *sessions,
                            const gchar *channel)
{
  return g_hash_table_lookup (sessions->by_channel, channel);
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
  if (g_hash_table_size (session->channels) == 0)
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
                                const gchar *channel)
{
  g_hash_table_remove (sessions->by_channel, channel);
  g_hash_table_remove (session->channels, channel);

  if (g_hash_table_size (session->channels) == 0)
    {
      /*
       * Close sessions that are no longer in use after N seconds
       * of them being that way.
       */
      g_debug ("%s: removed last channel %s for session", session->key.host, channel);
      session->timeout = g_timeout_add_seconds (TIMEOUT, on_timeout_cleanup_session, session);
    }
  else
    {
      g_debug ("%s: removed channel %s for session", session->key.host, channel);
    }
}

static void
cockpit_session_add_channel (CockpitSessions *sessions,
                             CockpitSession *session,
                             const gchar *channel)
{
  gchar *chan;

  chan = g_strdup (channel);
  g_hash_table_insert (sessions->by_channel, chan, session);
  g_hash_table_add (session->channels, chan);

  g_debug ("%s: added channel %s to session", session->key.host, channel);

  if (session->timeout)
    {
      g_source_remove (session->timeout);
      session->timeout = 0;
    }
}

static CockpitSession *
cockpit_session_track (CockpitSessions *sessions,
                       const gchar *host,
                       CockpitCreds *creds,
                       CockpitTransport *transport)
{
  CockpitSession *session;

  g_debug ("%s: new session", host);

  session = g_new0 (CockpitSession, 1);
  session->channels = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, NULL);
  session->transport = g_object_ref (transport);
  session->key.host = g_strdup (host);
  session->key.user = g_strdup (cockpit_creds_get_user (creds));
  session->creds = cockpit_creds_ref (creds);

  g_hash_table_insert (sessions->by_host_user, &session->key, session);

  /* This owns the session */
  g_hash_table_insert (sessions->by_transport, transport, session);

  return session;
}

static void
cockpit_session_destroy (CockpitSessions *sessions,
                         CockpitSession *session)
{
  GHashTableIter iter;
  const gchar *chan;

  g_debug ("%s: destroy session", session->key.host);

  g_hash_table_iter_init (&iter, session->channels);
  while (g_hash_table_iter_next (&iter, (gpointer *)&chan, NULL))
    g_hash_table_remove (sessions->by_channel, chan);
  g_hash_table_remove_all (session->channels);

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

struct _CockpitWebService {
  GObject parent;

  WebSocketConnection      *web_socket;
  GSocketConnection        *connection;
  CockpitAuth              *auth;
  CockpitCreds             *authenticated;

  CockpitSessions sessions;
  gboolean closing;
  GBytes *control_prefix;
  guint ping_timeout;
};

typedef struct {
  GObjectClass parent;
} CockpitWebServiceClass;

G_DEFINE_TYPE (CockpitWebService, cockpit_web_service, G_TYPE_OBJECT);

static void
cockpit_web_service_finalize (GObject *object)
{
  CockpitWebService *self = COCKPIT_WEB_SERVICE (object);

  cockpit_sessions_cleanup (&self->sessions);
  g_object_unref (self->web_socket);
  g_bytes_unref (self->control_prefix);
  g_object_unref (self->auth);
  if (self->authenticated)
    cockpit_creds_unref (self->authenticated);
  if (self->ping_timeout)
    g_source_remove (self->ping_timeout);

  G_OBJECT_CLASS (cockpit_web_service_parent_class)->finalize (object);
}

static void
report_close_options (CockpitWebService *self,
                      ...) G_GNUC_NULL_TERMINATED;

static void
report_close_options (CockpitWebService *self,
                      ...)
{
  JsonObject *object;
  GBytes *message;
  const gchar *name;
  const gchar *value;
  va_list va;

  object = json_object_new ();
  json_object_set_string_member (object, "command", "close");

  va_start (va, self);
  for (;;)
    {
      name = va_arg (va, const gchar *);
      if (!name)
        break;
      value = va_arg (va, const gchar *);
      if (value)
        json_object_set_string_member (object, name, value);
    }
  va_end (va);

  message = cockpit_json_write_bytes (object);
  json_object_unref (object);

  if (web_socket_connection_get_ready_state (self->web_socket) == WEB_SOCKET_STATE_OPEN)
    web_socket_connection_send (self->web_socket, WEB_SOCKET_DATA_TEXT, self->control_prefix, message);
  g_bytes_unref (message);
}

static void
report_close (CockpitWebService *self,
              const gchar *channel,
              const gchar *reason)
{
  report_close_options (self,
                        "channel", channel,
                        "reason", reason,
                        NULL);
}

static void
outbound_protocol_error (CockpitWebService *self,
                         CockpitTransport *session)
{
  cockpit_transport_close (session, "protocol-error");
}

static gboolean
process_close (CockpitWebService *self,
               CockpitSession *session,
               const gchar *channel,
               JsonObject *options)
{
  cockpit_session_remove_channel (&self->sessions, session, channel);
  return TRUE;
}

static gboolean
process_authorize (CockpitWebService *self,
                   CockpitSession *session,
                   JsonObject *options)
{
  JsonObject *object = NULL;
  GBytes *bytes = NULL;
  const gchar *host;
  char *user = NULL;
  char *type = NULL;
  char *response = NULL;
  const gchar *challenge;
  const gchar *password;
  gboolean ret = FALSE;
  gint64 cookie;
  int rc;

  host = session->key.host;

  if (!cockpit_json_get_string (options, "challenge", NULL, &challenge) ||
      !cockpit_json_get_int (options, "cookie", 0, &cookie) ||
      challenge == NULL ||
      reauthorize_type (challenge, &type) < 0 ||
      reauthorize_user (challenge, &user) < 0)
    {
      g_warning ("%s: received invalid authorize command", host);
      goto out;
    }

  if (!g_str_equal (cockpit_creds_get_user (session->creds), user))
    {
      g_warning ("%s: received authorize command for wrong user: %s", host, user);
    }
  else if (g_str_equal (type, "crypt1"))
    {
      password = cockpit_creds_get_password (session->creds);
      if (!password)
        {
          g_debug ("%s: received authorize crypt1 challenge, but no password to reauthenticate", host);
        }
      else
        {
          rc = reauthorize_crypt1 (challenge, password, &response);
          if (rc < 0)
            g_warning ("%s: failed to reauthorize crypt1 challenge", host);
        }
    }

  /*
   * TODO: So the missing piece is that something needs to unauthorize
   * the user. This needs to be coordinated with the web service.
   *
   * For now we assume that since this is an admin tool, as long as the
   * user has it open, he/she is authorized.
   */

  object = json_object_new ();
  json_object_set_string_member (object, "command", "authorize");
  json_object_set_int_member (object, "cookie", cookie);
  json_object_set_string_member (object, "response", response ? response : "");
  bytes = cockpit_json_write_bytes (object);

  if (!session->sent_eof)
    cockpit_transport_send (session->transport, 0, bytes);
  ret = TRUE;

out:
  if (bytes)
    g_bytes_unref (bytes);
  if (object)
    json_object_unref (object);
  free (user);
  free (type);
  free (response);
  return ret;
}

static void
dispatch_outbound_command (CockpitWebService *self,
                           CockpitTransport *source,
                           GBytes *payload)
{
  CockpitSession *session = NULL;
  const gchar *command;
  const gchar *channel;
  JsonObject *options;
  gboolean valid = FALSE;
  gboolean forward = TRUE;

  if (cockpit_transport_parse_command (payload, &command, &channel, &options))
    {
      if (!channel)
        {
          forward = FALSE;
          session = cockpit_session_by_transport (&self->sessions, source);
          if (!session)
            {
              g_critical ("received control command for transport that isn't present");
              valid = FALSE;
            }
          else if (g_strcmp0 (command, "authorize") == 0)
            {
              valid = process_authorize (self, session, options);
            }
          else if (g_strcmp0 (command, "ping") == 0)
            {
              valid = TRUE;
            }
          else
            {
              g_warning ("received a '%s' control command without a channel", command);
              valid = FALSE;
            }
        }
      else
        {
          /*
           * To prevent one host from messing with another, outbound commands
           * must have a channel, and it must match one of the channels opened
           * to that particular session.
           */
          session = cockpit_session_by_channel (&self->sessions, channel);
          if (!session)
            {
              g_warning ("Channel does not exist: %s", channel);
              valid = FALSE;
            }
          else if (session->transport != source)
            {
              g_warning ("Received a command with wrong channel from session");
              valid = FALSE;
            }
          else if (g_strcmp0 (command, "close") == 0)
            {
              valid = process_close (self, session, channel, options);
            }
          else
            {
              g_debug ("forwarding a '%s' control command", command);
              valid = TRUE; /* forward other messages */
            }
        }
    }

  if (valid && !session->sent_eof)
    {
      if (forward && web_socket_connection_get_ready_state (self->web_socket) == WEB_SOCKET_STATE_OPEN)
        web_socket_connection_send (self->web_socket, WEB_SOCKET_DATA_TEXT, self->control_prefix, payload);
    }
  else
    {
      outbound_protocol_error (self, source);
    }

  json_object_unref (options);
}

static gboolean
on_session_recv (CockpitTransport *transport,
                 const gchar *channel,
                 GBytes *payload,
                 gpointer user_data)
{
  CockpitWebService *self = user_data;
  CockpitSession *session;
  gchar *string;
  GBytes *prefix;

  if (channel == 0)
    {
      dispatch_outbound_command (self, transport, payload);
      return TRUE;
    }

  session = cockpit_session_by_channel (&self->sessions, channel);
  if (session == NULL)
    {
      g_warning ("Rceived message with unknown channel from session");
      outbound_protocol_error (self, transport);
      return FALSE;
    }
  else if (session->transport != transport)
    {
      g_warning ("Received message with wrong channel from session");
      outbound_protocol_error (self, transport);
      return FALSE;
    }

  if (web_socket_connection_get_ready_state (self->web_socket) == WEB_SOCKET_STATE_OPEN)
    {
      string = g_strdup_printf ("%s\n", channel);
      prefix = g_bytes_new_take (string, strlen (string));
      web_socket_connection_send (self->web_socket, WEB_SOCKET_DATA_TEXT, prefix, payload);
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
  CockpitWebService *self = user_data;
  const gchar *channel = NULL;
  CockpitSession *session;
  CockpitSshTransport *ssh;
  GHashTableIter iter;
  const gchar *key = NULL;
  const gchar *fp = NULL;

  session = cockpit_session_by_transport (&self->sessions, transport);
  if (session != NULL)
    {
      if (g_strcmp0 (problem, "unknown-hostkey") == 0 &&
          COCKPIT_IS_SSH_TRANSPORT (transport))
        {
          ssh = COCKPIT_SSH_TRANSPORT (transport);
          key = cockpit_ssh_transport_get_host_key (ssh);
          fp = cockpit_ssh_transport_get_host_fingerprint (ssh);
        }

      g_hash_table_iter_init (&iter, session->channels);
      while (g_hash_table_iter_next (&iter, (gpointer *)&channel, NULL))
        {
          report_close_options (self,
                                "channel", channel,
                                "reason", problem,
                                "host-key", key,
                                "host-fingerprint", fp,
                                NULL);
        }

      cockpit_session_destroy (&self->sessions, session);
    }
}

static gboolean
process_open (CockpitWebService *self,
              const gchar *channel,
              JsonObject *options)
{
  CockpitSession *session;
  CockpitTransport *transport;
  CockpitCreds *creds;
  CockpitPipe *pipe;
  const gchar *specific_user;
  const gchar *password;
  const gchar *host;
  const gchar *host_key;
  const gchar *rhost;

  if (self->closing)
    {
      g_debug ("Ignoring open command during while web socket is closing");
      return TRUE;
    }

  if (cockpit_session_by_channel (&self->sessions, channel))
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
      creds = cockpit_creds_new (specific_user,
                                 COCKPIT_CRED_PASSWORD, password,
                                 COCKPIT_CRED_RHOST, cockpit_creds_get_rhost (self->authenticated),
                                 NULL);
    }
  else
    {
      creds = cockpit_creds_ref (self->authenticated);
    }

  if (!cockpit_json_get_string (options, "host-key", NULL, &host_key))
    host_key = NULL;

  session = cockpit_session_by_host_user (&self->sessions, host,
                                          cockpit_creds_get_user (creds));
  if (!session)
    {
      /* Used during testing */
      if (g_strcmp0 (host, "localhost") == 0)
        {
          if (cockpit_ws_specific_ssh_port != 0)
            host = "127.0.0.1";
        }

      rhost = cockpit_creds_get_rhost (creds);
      if (rhost == NULL)
        rhost = "<unknown>";

      if (g_strcmp0 (host, "localhost") == 0)
        {
          /* Any failures happen asyncronously */
          pipe = cockpit_auth_start_session (self->auth, self->authenticated);
          transport = cockpit_pipe_transport_new (pipe);
          g_object_unref (pipe);
        }
      else
        {
          transport = g_object_new (COCKPIT_TYPE_SSH_TRANSPORT,
                                    "host", host,
                                    "port", cockpit_ws_specific_ssh_port,
                                    "command", cockpit_ws_agent_program,
                                    "creds", creds,
                                    "known-hosts", cockpit_ws_known_hosts,
                                    "host-key", host_key,
                                    NULL);
        }

      g_signal_connect (transport, "recv", G_CALLBACK (on_session_recv), self);
      g_signal_connect (transport, "closed", G_CALLBACK (on_session_closed), self);
      session = cockpit_session_track (&self->sessions, host, creds, transport);
      g_object_unref (transport);
    }

  cockpit_creds_unref (creds);
  cockpit_session_add_channel (&self->sessions, session, channel);
  return TRUE;
}


static void
inbound_protocol_error (CockpitWebService *self)
{
  if (web_socket_connection_get_ready_state (self->web_socket) == WEB_SOCKET_STATE_OPEN)
    {
      report_close (self, 0, "protocol-error");
      web_socket_connection_close (self->web_socket, WEB_SOCKET_CLOSE_SERVER_ERROR, "protocol-error");
    }
}

static void
dispatch_inbound_command (CockpitWebService *self,
                          GBytes *payload)
{
  const gchar *command;
  const gchar *channel;
  JsonObject *options;
  gboolean valid = FALSE;
  gboolean forward = TRUE;
  CockpitSession *session;
  GHashTableIter iter;

  if (cockpit_transport_parse_command (payload, &command, &channel, &options))
    {
      if (g_strcmp0 (command, "open") == 0)
        valid = process_open (self, channel, options);
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
      inbound_protocol_error (self);
    }

  else if (forward && channel == 0)
    {
      /* Control messages without a channel get sent to all sessions */
      g_hash_table_iter_init (&iter, self->sessions.by_transport);
      while (g_hash_table_iter_next (&iter, NULL, (gpointer *)&session))
        {
          if (!session->sent_eof)
            cockpit_transport_send (session->transport, 0, payload);
        }
    }
  else if (forward)
    {
      /* Control messages with a channel get forward to that session */
      session = cockpit_session_by_channel (&self->sessions, channel);
      if (session)
        {
          if (!session->sent_eof)
            cockpit_transport_send (session->transport, 0, payload);
        }
      else
        g_debug ("Dropping control message with unknown channel: %s", channel);
    }

  json_object_unref (options);
}

static void
on_web_socket_message (WebSocketConnection *web_socket,
                       WebSocketDataType type,
                       GBytes *message,
                       CockpitWebService *self)
{
  CockpitSession *session;
  gchar *channel;
  GBytes *payload;

  payload = cockpit_transport_parse_frame (message, &channel);
  if (!payload)
    return;

  /* A control channel command */
  if (!channel)
    {
      dispatch_inbound_command (self, payload);
    }

  /* An actual payload message */
  else if (!self->closing)
    {
      session = cockpit_session_by_channel (&self->sessions, channel);
      if (session)
        {
          if (!session->sent_eof)
            cockpit_transport_send (session->transport, channel, payload);
        }
      else
        {
          g_debug ("Received message for unknown channel: %s", channel);
        }
    }

  g_free (channel);
  g_bytes_unref (payload);
}

static void
on_web_socket_open (WebSocketConnection *web_socket,
                    CockpitWebService *self)
{
  /* We send auth errors as regular messages after establishing the
     connection because the WebSocket API doesn't let us see the HTTP
     status code.  We can't just use 'close' control frames to return a
     meaningful status code, but the old protocol doesn't have them.
  */
  if (!self->authenticated)
    {
      g_info ("Closing unauthenticated connection");
      report_close (self, 0, "no-session");
      web_socket_connection_close (web_socket,
                                   WEB_SOCKET_CLOSE_GOING_AWAY,
                                   "not-authenticated");
    }
  else
    {
      g_info ("New connection from %s for %s",
              cockpit_creds_get_rhost (self->authenticated),
              cockpit_creds_get_user (self->authenticated));
      g_signal_connect (web_socket, "message",
                        G_CALLBACK (on_web_socket_message), self);
    }
}

static void
on_web_socket_error (WebSocketConnection *web_socket,
                     GError *error,
                     CockpitWebService *self)
{
  g_message ("%s", error->message);
}

static gboolean
on_web_socket_closing (WebSocketConnection *web_socket,
                       CockpitWebService *self)
{
  CockpitSession *session;
  GHashTableIter iter;
  gint sent = 0;

  g_debug ("web socket closing");

  if (!self->closing)
    {
      self->closing = TRUE;
      g_hash_table_iter_init (&iter, self->sessions.by_transport);
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
                     CockpitWebService *self)
{
  if (self->authenticated)
    {
      g_info ("Connection from %s for %s closed",
              cockpit_creds_get_rhost (self->authenticated),
              cockpit_creds_get_user (self->authenticated));
    }

  /*
   * We were holding a reference while the web socket was open.
   * Now close down, and allow anything remaining to finalize.
   */
  g_object_unref (self);
}

static gboolean
on_ping_time (gpointer user_data)
{
  CockpitWebService *self = user_data;
  GBytes *message;
  const gchar *json;

  if (web_socket_connection_get_ready_state (self->web_socket) == WEB_SOCKET_STATE_OPEN)
    {
      json = g_strdup_printf ("{\"command\": \"ping\"}");
      message = g_bytes_new_static (json, strlen (json));
      web_socket_connection_send (self->web_socket, WEB_SOCKET_DATA_TEXT, self->control_prefix, message);
      g_bytes_unref (message);
    }

  return TRUE;
}

static void
cockpit_web_service_init (CockpitWebService *self)
{
  self->control_prefix = g_bytes_new_static ("\n", 1);
  cockpit_sessions_init (&self->sessions);
}

static void
cockpit_web_service_class_init (CockpitWebServiceClass *klass)
{
  GObjectClass *object_class = G_OBJECT_CLASS (klass);

  object_class->finalize = cockpit_web_service_finalize;
}

/**
 * cockpit_web_service_socket:
 * @io_stream: the stream to talk on
 * @headers: optional headers already parsed
 * @input_buffer: optional bytes already parsed after headers
 * @auth: authentication object
 * @creds: credentials of user or NULL for failed auth
 *
 * Creates a new web service to serve a web socket on the given
 * stream. Holds an extra reference to itself until its done, so
 * you can safely unref the returned service.
 *
 * Returns: (transfer full): the service, unref when no longer needed
 */
CockpitWebService *
cockpit_web_service_socket (GIOStream *io_stream,
                            GHashTable *headers,
                            GByteArray *input_buffer,
                            CockpitAuth *auth,
                            CockpitCreds *creds)
{
  const gchar *protocols[] = { "cockpit1", NULL };
  CockpitWebService *self;
  const gchar *host = NULL;
  gboolean secure;
  gchar *origin;
  gchar *url;

  self = g_object_new (COCKPIT_TYPE_WEB_SERVICE, NULL);

  if (G_IS_SOCKET_CONNECTION (io_stream))
    self->connection = g_object_ref (io_stream);
  else if (G_IS_TLS_CONNECTION (io_stream))
    {
      GIOStream *base;
      g_object_get (io_stream, "base-io-stream", &base, NULL);
      if (G_IS_SOCKET_CONNECTION (base))
        self->connection = g_object_ref (base);
    }

  self->auth = g_object_ref (auth);
  if (creds)
    self->authenticated = cockpit_creds_ref (creds);

  if (headers)
    host = g_hash_table_lookup (headers, "Host");
  if (!host)
    host = cockpit_ws_default_host_header;

  secure = G_IS_TLS_CONNECTION (io_stream);

  url = g_strdup_printf ("%s://%s/socket", secure ? "wss" : "ws",
                         host ? host : "localhost");
  origin = g_strdup_printf ("%s://%s", secure ? "https" : "http", host);

  self->web_socket = web_socket_server_new_for_stream (url, origin, protocols,
                                                       io_stream, headers,
                                                       input_buffer);

  g_free (origin);
  g_free (url);

  /* Matching unref in on_web_socket_close() */
  g_object_ref (self);

  g_signal_connect (self->web_socket, "open", G_CALLBACK (on_web_socket_open), self);
  g_signal_connect (self->web_socket, "closing", G_CALLBACK (on_web_socket_closing), self);
  g_signal_connect (self->web_socket, "close", G_CALLBACK (on_web_socket_close), self);
  g_signal_connect (self->web_socket, "error", G_CALLBACK (on_web_socket_error), self);

  self->ping_timeout = g_timeout_add_seconds (cockpit_ws_ping_interval, on_ping_time, self);

  return self;
}
