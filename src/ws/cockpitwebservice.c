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

#include "common/cockpitconf.h"
#include "common/cockpitjson.h"
#include "common/cockpitlog.h"
#include "common/cockpitpipetransport.h"
#include "common/cockpitwebinject.h"
#include "common/cockpitwebresponse.h"
#include "common/cockpitwebserver.h"

#include "cockpitauth.h"
#include "cockpitws.h"

#include "cockpitsshagent.h"
#include "cockpitsshtransport.h"

#include "websocket/websocket.h"

#include "reauthorize/reauthorize.h"

#include <stdlib.h>

/* Some tunables that can be set from tests */
const gchar *cockpit_ws_session_program =
    PACKAGE_LIBEXEC_DIR "/cockpit-session";

const gchar *cockpit_ws_bridge_program = NULL;

const gchar *cockpit_ws_known_hosts =
    PACKAGE_LOCALSTATE_DIR "/lib/cockpit/known_hosts";

const gchar *cockpit_ws_default_host_header =
    "0.0.0.0:0"; /* Must be something invalid */

gint cockpit_ws_specific_ssh_port = 0;

guint cockpit_ws_ping_interval = 5;

gint cockpit_ws_session_timeout = 30;

static JsonObject * build_json    (const gchar *name, ...) G_GNUC_NULL_TERMINATED;

static GBytes *     build_control (const gchar *name, ...) G_GNUC_NULL_TERMINATED;

/* ----------------------------------------------------------------------------
 * CockpitSession
 */

typedef struct
{
  gchar *host;
  gboolean primary;
  gboolean private;
  GHashTable *channels;
  CockpitTransport *transport;
  gboolean sent_done;
  guint timeout;
  CockpitCreds *creds;
  gboolean init_received;
  gulong control_sig;
  gulong recv_sig;
  gulong closed_sig;
  gchar *checksum;
} CockpitSession;

typedef struct
{
  GHashTable *by_host;
  GHashTable *by_channel;
  GHashTable *by_transport;
} CockpitSessions;

/* Should only called as a hash table GDestroyNotify */
static void
cockpit_session_free (gpointer data)
{
  CockpitSession *session = data;

  g_debug ("%s: freeing session", session->host);

  if (session->timeout)
    g_source_remove (session->timeout);
  g_hash_table_unref (session->channels);
  if (session->control_sig)
    g_signal_handler_disconnect (session->transport, session->control_sig);
  if (session->recv_sig)
    g_signal_handler_disconnect (session->transport, session->recv_sig);
  if (session->closed_sig)
    g_signal_handler_disconnect (session->transport, session->closed_sig);
  g_object_unref (session->transport);
  cockpit_creds_unref (session->creds);
  g_free (session->checksum);
  g_free (session->host);
  g_free (session);
}

static void
cockpit_sessions_init (CockpitSessions *sessions)
{
  sessions->by_channel = g_hash_table_new (g_str_hash, g_str_equal);
  sessions->by_host = g_hash_table_new (g_str_hash, g_str_equal);

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
cockpit_session_by_host (CockpitSessions *sessions,
                         const gchar *host)
{
  return g_hash_table_lookup (sessions->by_host, host);
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
      g_debug ("%s: session timed out without channels", session->host);
      cockpit_transport_close (session->transport, "timeout");
    }

  return FALSE;
}

static void
cockpit_session_remove_channel (CockpitSessions *sessions,
                                CockpitSession *session,
                                const gchar *channel)
{
  g_debug ("%s: remove channel %s for session", session->host, channel);

  g_hash_table_remove (sessions->by_channel, channel);
  g_hash_table_remove (session->channels, channel);

  if (g_hash_table_size (session->channels) == 0 && !session->primary)
    {
      /*
       * Close sessions that are no longer in use after N seconds
       * of them being that way.
       */
      g_debug ("%s: removed last channel %s for session", session->host, channel);
      session->timeout = g_timeout_add_seconds (cockpit_ws_session_timeout,
                                                on_timeout_cleanup_session, session);
    }
  else
    {
      g_debug ("%s: removed channel %s for session", session->host, channel);
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

  g_debug ("%s: added channel %s to session", session->host, channel);

  if (session->timeout)
    {
      g_source_remove (session->timeout);
      session->timeout = 0;
    }
}

static CockpitSession *
cockpit_session_track (CockpitSessions *sessions,
                       const gchar *host,
                       gboolean private,
                       CockpitCreds *creds,
                       CockpitTransport *transport)
{
  CockpitSession *session;
  JsonObject *object;
  GBytes *command;

  g_debug ("%s: new session", host);

  session = g_new0 (CockpitSession, 1);
  session->channels = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, NULL);
  session->transport = g_object_ref (transport);
  session->host = g_strdup (host);
  session->private = private;
  session->creds = cockpit_creds_ref (creds);

  if (!private)
    g_hash_table_insert (sessions->by_host, session->host, session);

  /* This owns the session */
  g_hash_table_insert (sessions->by_transport, transport, session);

  /* Always send an init message down the new transport */
  object = build_json ("command", "init", NULL);
  json_object_set_int_member (object, "version", 1);
  json_object_set_string_member (object, "host", host);
  command = cockpit_json_write_bytes (object);
  json_object_unref (object);

  cockpit_transport_send (transport, NULL, command);
  g_bytes_unref (command);

  return session;
}

static void
cockpit_session_destroy (CockpitSessions *sessions,
                         CockpitSession *session)
{
  GHashTableIter iter;
  const gchar *chan;

  g_debug ("%s: destroy %ssession", session->host, session->primary ? "primary " : "");

  g_hash_table_iter_init (&iter, session->channels);
  while (g_hash_table_iter_next (&iter, (gpointer *)&chan, NULL))
    g_hash_table_remove (sessions->by_channel, chan);
  g_hash_table_remove_all (session->channels);

  if (!session->private)
    g_hash_table_remove (sessions->by_host, session->host);

  /* This owns the session */
  g_hash_table_remove (sessions->by_transport, session->transport);
}

static void
cockpit_sessions_cleanup (CockpitSessions *sessions)
{
  g_hash_table_destroy (sessions->by_channel);
  g_hash_table_destroy (sessions->by_host);
  g_hash_table_destroy (sessions->by_transport);
}

/* ----------------------------------------------------------------------------
 * Web Socket Info
 */

typedef struct {
  gchar *id;
  WebSocketConnection *connection;
  GHashTable *channels;
  gboolean init_received;
} CockpitSocket;

typedef struct {
  GHashTable *by_channel;
  GHashTable *by_connection;
  guint next_socket_id;
} CockpitSockets;

static void
cockpit_socket_free (gpointer data)
{
  CockpitSocket *socket = data;
  g_hash_table_unref (socket->channels);
  g_object_unref (socket->connection);
  g_free (socket->id);
  g_free (socket);
}

static void
cockpit_sockets_init (CockpitSockets *sockets)
{
  sockets->next_socket_id = 1;

  sockets->by_channel = g_hash_table_new (g_str_hash, g_str_equal);

  /* This owns the socket */
  sockets->by_connection = g_hash_table_new_full (g_direct_hash, g_direct_equal,
                                                  NULL, cockpit_socket_free);
}

inline static CockpitSocket *
cockpit_socket_lookup_by_connection (CockpitSockets *sockets,
                                     WebSocketConnection *connection)
{
  return g_hash_table_lookup (sockets->by_connection, connection);
}

inline static CockpitSocket *
cockpit_socket_lookup_by_channel (CockpitSockets *sockets,
                                  const gchar *channel)
{
  return g_hash_table_lookup (sockets->by_channel, channel);
}

static void
cockpit_socket_remove_channel (CockpitSockets *sockets,
                               CockpitSocket *socket,
                               const gchar *channel)
{
  g_debug ("%s remove channel %s for socket", socket->id, channel);
  g_hash_table_remove (sockets->by_channel, channel);
  g_hash_table_remove (socket->channels, channel);
}

static void
cockpit_socket_add_channel (CockpitSockets *sockets,
                            CockpitSocket *socket,
                            const gchar *channel,
                            WebSocketDataType data_type)
{
  gchar *chan;

  chan = g_strdup (channel);
  g_hash_table_insert (sockets->by_channel, chan, socket);
  g_hash_table_replace (socket->channels, chan, GINT_TO_POINTER (data_type));

  g_debug ("%s added channel %s to socket", socket->id, channel);
}

static CockpitSocket *
cockpit_socket_track (CockpitSockets *sockets,
                      WebSocketConnection *connection)
{
  CockpitSocket *socket;

  socket = g_new0 (CockpitSocket, 1);
  socket->id = g_strdup_printf ("%u:", sockets->next_socket_id++);
  socket->connection = g_object_ref (connection);
  socket->channels = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, NULL);

  g_debug ("%s new socket", socket->id);

  /* This owns the session */
  g_hash_table_insert (sockets->by_connection, connection, socket);

  return socket;
}

static void
cockpit_socket_destroy (CockpitSockets *sockets,
                        CockpitSocket *socket)
{
  GHashTableIter iter;
  const gchar *chan;

  g_debug ("%s destroy socket", socket->id);

  g_hash_table_iter_init (&iter, socket->channels);
  while (g_hash_table_iter_next (&iter, (gpointer *)&chan, NULL))
    g_hash_table_remove (sockets->by_channel, chan);
  g_hash_table_remove_all (socket->channels);

  /* This owns the socket */
  g_hash_table_remove (sockets->by_connection, socket->connection);
}

static void
cockpit_sockets_cleanup (CockpitSockets *sockets)
{
  g_hash_table_destroy (sockets->by_connection);
  g_hash_table_destroy (sockets->by_channel);
}

/* ----------------------------------------------------------------------------
 * Sideband Info
 */

typedef struct {
  gchar *channel;
  WebSocketConnection *connection;
  WebSocketDataType data_type;
  JsonObject *options;
  gulong open_sig;
  gulong message_sig;
  gulong close_sig;
} CockpitSideband;

typedef struct {
  GHashTable *by_channel;
  GHashTable *by_connection;
} CockpitSidebands;

static void
cockpit_sideband_free (gpointer data)
{
  CockpitSideband *sideband = data;
  g_free (sideband->channel);
  if (sideband->connection)
    {
      if (sideband->open_sig)
        g_signal_handler_disconnect (sideband->connection, sideband->open_sig);
      if (sideband->message_sig)
        g_signal_handler_disconnect (sideband->connection, sideband->message_sig);
      if (sideband->close_sig)
        g_signal_handler_disconnect (sideband->connection, sideband->close_sig);
      g_object_unref (sideband->connection);
    }
  json_object_unref (sideband->options);
  g_free (sideband);
}

static void
cockpit_sidebands_init (CockpitSidebands *sidebands)
{
  /* This owns the sideband */
  sidebands->by_channel = g_hash_table_new_full (g_str_hash, g_str_equal,
                                                 NULL, cockpit_sideband_free);
  sidebands->by_connection = g_hash_table_new (g_direct_hash, g_direct_equal);
}

static CockpitSideband *
cockpit_sideband_track (CockpitSidebands *sidebands,
                        const gchar *channel,
                        WebSocketConnection *connection)
{
  CockpitSideband *sideband;

  sideband = g_new0 (CockpitSideband, 1);
  sideband->channel = g_strdup (channel);
  sideband->connection = g_object_ref (connection);

  g_debug ("%s new sideband", channel);

  /* This owns the sideband */
  g_hash_table_insert (sidebands->by_channel, sideband->channel, sideband);
  g_hash_table_insert (sidebands->by_connection, connection, sideband);

  return sideband;
}

inline static CockpitSideband *
cockpit_sideband_by_channel (CockpitSidebands *sidebands,
                             const gchar *channel)
{
  return g_hash_table_lookup (sidebands->by_channel, channel);
}

inline static CockpitSideband *
cockpit_sideband_by_connection (CockpitSidebands *sidebands,
                                WebSocketConnection *connection)
{
  return g_hash_table_lookup (sidebands->by_connection, connection);
}

static void
cockpit_sideband_destroy (CockpitSidebands *sidebands,
                          CockpitSideband *sideband,
                          const gchar *reason)
{
  g_debug ("%s destroy sideband", sideband->channel);

  if (sideband->connection)
    {
      if (web_socket_connection_get_ready_state (sideband->connection) < WEB_SOCKET_STATE_CLOSING)
        web_socket_connection_close (sideband->connection, WEB_SOCKET_CLOSE_GOING_AWAY, reason);
    }

  g_hash_table_remove (sidebands->by_connection, sideband->connection);

  /* This owns the sideband */
  g_hash_table_remove (sidebands->by_channel, sideband->channel);
}

static void
cockpit_sidebands_cleanup (CockpitSidebands *sidebands)
{
  g_hash_table_destroy (sidebands->by_connection);
  g_hash_table_destroy (sidebands->by_channel);
}

/* ----------------------------------------------------------------------------
 * Web Socket Routing
 */

struct _CockpitWebService {
  GObject parent;

  CockpitCreds *creds;
  CockpitSockets sockets;
  CockpitSessions sessions;
  CockpitSidebands sidebands;
  gboolean closing;
  GBytes *control_prefix;
  guint ping_timeout;
  gint callers;
  guint next_internal_id;
  GHashTable *channel_groups;
};

typedef struct {
  GObjectClass parent;
} CockpitWebServiceClass;

static guint sig_idling = 0;
static guint sig_destroy = 0;

G_DEFINE_TYPE (CockpitWebService, cockpit_web_service, G_TYPE_OBJECT);

static void
cockpit_web_service_dispose (GObject *object)
{
  CockpitWebService *self = COCKPIT_WEB_SERVICE (object);
  CockpitSocket *socket;
  CockpitSession *session;
  CockpitSideband *sideband;
  GHashTableIter iter;
  gboolean emit = FALSE;

  if (!self->closing)
    {
      g_debug ("web service closing");
      emit = TRUE;
    }
  self->closing = TRUE;

  g_hash_table_iter_init (&iter, self->sidebands.by_connection);
  while (g_hash_table_iter_next (&iter, NULL, (gpointer *)&sideband))
    {
      if (web_socket_connection_get_ready_state (sideband->connection) < WEB_SOCKET_STATE_CLOSING)
        web_socket_connection_close (sideband->connection, WEB_SOCKET_CLOSE_GOING_AWAY, "terminated");
    }

  g_hash_table_iter_init (&iter, self->sockets.by_connection);
  while (g_hash_table_iter_next (&iter, NULL, (gpointer *)&socket))
    {
      if (web_socket_connection_get_ready_state (socket->connection) < WEB_SOCKET_STATE_CLOSING)
        web_socket_connection_close (socket->connection, WEB_SOCKET_CLOSE_GOING_AWAY, "terminated");
    }

  g_hash_table_iter_init (&iter, self->sessions.by_transport);
  while (g_hash_table_iter_next (&iter, NULL, (gpointer *)&session))
    {
      if (!session->sent_done)
        {
          session->sent_done = TRUE;
          cockpit_transport_close (session->transport, NULL);
        }
    }

  if (emit)
    g_signal_emit (self, sig_destroy, 0);

  G_OBJECT_CLASS (cockpit_web_service_parent_class)->dispose (object);
}

static void
cockpit_web_service_finalize (GObject *object)
{
  CockpitWebService *self = COCKPIT_WEB_SERVICE (object);

  cockpit_sidebands_cleanup (&self->sidebands);
  cockpit_sessions_cleanup (&self->sessions);
  cockpit_sockets_cleanup (&self->sockets);
  g_bytes_unref (self->control_prefix);
  cockpit_creds_unref (self->creds);
  if (self->ping_timeout)
    g_source_remove (self->ping_timeout);
  g_hash_table_destroy (self->channel_groups);

  G_OBJECT_CLASS (cockpit_web_service_parent_class)->finalize (object);
}

static JsonObject *
build_json_va (const gchar *name,
               va_list va)
{
  JsonObject *object;
  const gchar *value;

  object = json_object_new ();

  while (name)
    {
      value = va_arg (va, const gchar *);
      if (value)
        json_object_set_string_member (object, name, value);
      name = va_arg (va, const gchar *);
    }

  return object;
}

static JsonObject *
build_json (const gchar *name,
            ...)
{
  JsonObject *object;
  va_list va;

  va_start (va, name);
  object = build_json_va (name, va);
  va_end (va);

  return object;
}

static GBytes *
build_control (const gchar *name,
               ...)
{
  JsonObject *object;
  GBytes *message;
  va_list va;

  va_start (va, name);
  object = build_json_va (name, va);
  va_end (va);

  message = cockpit_json_write_bytes (object);
  json_object_unref (object);
  return message;
}

static gchar *
generate_channel_id (CockpitWebService *self)
{
  return g_strdup_printf ("0:%d", self->next_internal_id++);
}

static void
caller_begin (CockpitWebService *self)
{
  g_object_ref (self);
  self->callers++;
}

static void
caller_end (CockpitWebService *self)
{
  g_return_if_fail (self->callers > 0);
  self->callers--;
  if (self->callers == 0)
    g_signal_emit (self, sig_idling, 0);
  g_object_unref (self);
}

static void
outbound_protocol_error (CockpitWebService *self,
                         CockpitTransport *transport,
                         const gchar *problem)
{
  if (problem == NULL)
    problem = "protocol-error";
  cockpit_transport_close (transport, problem);
}

static gboolean
process_close (CockpitWebService *self,
               CockpitSocket *socket,
               CockpitSession *session,
               const gchar *channel)
{
  CockpitSideband *sideband;

  /* Close the sideband if it's still open */
  sideband = cockpit_sideband_by_channel (&self->sidebands, channel);
  if (sideband)
    cockpit_sideband_destroy (&self->sidebands, sideband, "closed");

  if (session)
    cockpit_session_remove_channel (&self->sessions, session, channel);
  if (socket)
    cockpit_socket_remove_channel (&self->sockets, socket, channel);
  g_hash_table_remove (self->channel_groups, channel);

  return TRUE;
}

static gboolean
process_and_relay_close (CockpitWebService *self,
                         CockpitSocket *socket,
                         const gchar *channel,
                         GBytes *payload)
{
  CockpitSession *session;
  gboolean valid;

  session = cockpit_session_by_channel (&self->sessions, channel);
  valid = process_close (self, socket, session, channel);
  if (valid && session && !session->sent_done)
    cockpit_transport_send (session->transport, NULL, payload);

  return valid;
}

static gboolean
process_kill (CockpitWebService *self,
              CockpitSocket *socket,
              JsonObject *options)
{
  CockpitSession *session;
  GHashTableIter iter;
  gpointer channel;
  const gchar *host;
  const gchar *group;
  GBytes *payload;
  GList *list, *l;

  if (!cockpit_json_get_string (options, "host", NULL, &host) ||
      !cockpit_json_get_string (options, "group", NULL, &group))
    {
      g_warning ("%s: received invalid kill command", socket->id);
      return FALSE;
    }

  list = NULL;
  g_hash_table_iter_init (&iter, socket->channels);
  while (g_hash_table_iter_next (&iter, &channel, NULL))
    {
      if (host)
        {
          session = cockpit_session_by_channel (&self->sessions, channel);
          if (!session || !g_str_equal (host, session->host))
            continue;
        }
      if (group)
        {
          if (g_strcmp0 (g_hash_table_lookup (self->channel_groups, channel), group) != 0)
            continue;
        }

      list = g_list_prepend (list, g_strdup (channel));
    }

  for (l = list; l != NULL; l = g_list_next (l))
    {
      channel = l->data;

      g_debug ("%s killing channel: %s", socket->id, (gchar *)channel);

      /* Send a close message to both parties */
      payload = build_control ("command", "close", "channel", (gchar *)channel, "problem", "terminated", NULL);
      g_warn_if_fail (process_and_relay_close (self, socket, channel, payload));
      if (web_socket_connection_get_ready_state (socket->connection) == WEB_SOCKET_STATE_OPEN)
        {
              web_socket_connection_send (socket->connection,
                                          WEB_SOCKET_DATA_TEXT,
                                          self->control_prefix,
                                          payload);
        }

      g_bytes_unref (payload);

      g_free (channel);
    }

  g_list_free (list);
  return TRUE;
}

static gboolean
process_authorize (CockpitWebService *self,
                   CockpitSession *session,
                   JsonObject *options)
{
  const gchar *cookie = NULL;
  GBytes *payload;
  const gchar *host;
  char *user = NULL;
  char *type = NULL;
  char *response = NULL;
  const gchar *challenge;
  const gchar *password;
  gboolean ret = FALSE;
  int rc;

  host = session->host;

  if (!cockpit_json_get_string (options, "challenge", NULL, &challenge) ||
      !cockpit_json_get_string (options, "cookie", NULL, &cookie) ||
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

  if (!session->sent_done)
    {
      payload = build_control ("command", "authorize",
                               "cookie", cookie,
                               "response", response ? response : "",
                               NULL);
      cockpit_transport_send (session->transport, NULL, payload);
      g_bytes_unref (payload);
    }
  ret = TRUE;

out:
  free (user);
  free (type);
  free (response);
  return ret;
}

static const gchar *
process_session_init (CockpitWebService *self,
                      CockpitSession *session,
                      JsonObject *options)
{
  const gchar *checksum;
  gint64 version;

  if (!cockpit_json_get_int (options, "version", -1, &version))
    {
      g_warning ("invalid version field in init message");
      return "protocol-error";
    }

  if (version == 1)
    {
      g_debug ("%s: received init message", session->host);
      session->init_received = TRUE;
    }
  else
    {
      g_message ("%s: unsupported version of cockpit protocol: %" G_GINT64_FORMAT,
                 session->host, version);
      return "not-supported";
    }

  if (!cockpit_json_get_string (options, "checksum", NULL, &checksum))
    checksum = NULL;

  g_free (session->checksum);
  session->checksum = g_strdup (checksum);

  return NULL;
}

static gboolean
on_session_control (CockpitTransport *transport,
                    const gchar *command,
                    const gchar *channel,
                    JsonObject *options,
                    GBytes *payload,
                    gpointer user_data)
{
  const gchar *problem = "protocol-error";
  CockpitWebService *self = user_data;
  CockpitSession *session = NULL;
  CockpitSocket *socket = NULL;
  gboolean valid = FALSE;
  gboolean forward;

  if (!channel)
    {
      session = cockpit_session_by_transport (&self->sessions, transport);
      if (!session)
        {
          g_critical ("received control command for transport that isn't present");
          valid = FALSE;
        }
      else if (g_strcmp0 (command, "init") == 0)
        {
          problem = process_session_init (self, session, options);
          valid = (problem == NULL);
        }
      else if (!session->init_received)
        {
          g_message ("%s: did not send 'init' message first", session->host);
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
          g_debug ("received a %s unknown control command", command);
          valid = TRUE;
        }
    }
  else
    {
      socket = cockpit_socket_lookup_by_channel (&self->sockets, channel);

      /* Usually all control messages with a channel are forwarded */
      forward = TRUE;

      /*
       * To prevent one host from messing with another, outbound commands
       * must have a channel, and it must match one of the channels opened
       * to that particular session.
       */
      session = cockpit_session_by_channel (&self->sessions, channel);
      if (!session)
        {
          /* This is not an error, since closing can race between the endpoints */
          g_debug ("channel %s does not exist", channel);
          forward = FALSE;
          valid = TRUE;
        }
      else if (session->transport != transport)
        {
          g_warning ("received a command with wrong channel %s from session", channel);
          valid = FALSE;
        }
      else if (g_strcmp0 (command, "close") == 0)
        {
          valid = process_close (self, socket, session, channel);
        }
      else
        {
          valid = TRUE;
        }

      if (forward)
        {
          /* Forward this message to the right websocket */
          if (socket && web_socket_connection_get_ready_state (socket->connection) == WEB_SOCKET_STATE_OPEN)
            {
              web_socket_connection_send (socket->connection, WEB_SOCKET_DATA_TEXT,
                                          self->control_prefix, payload);
            }
        }
    }

  if (!valid)
    {
      outbound_protocol_error (self, transport, problem);
    }

  return TRUE; /* handled */
}

static gboolean
on_session_recv (CockpitTransport *transport,
                 const gchar *channel,
                 GBytes *payload,
                 gpointer user_data)
{
  CockpitWebService *self = user_data;
  WebSocketDataType data_type;
  CockpitSideband *sideband;
  CockpitSession *session;
  CockpitSocket *socket;
  gchar *string;
  GBytes *prefix;

  if (!channel)
    return FALSE;

  session = cockpit_session_by_channel (&self->sessions, channel);
  if (session == NULL)
    {
      /* This is not an error since channel closing can race */
      g_debug ("dropping message with unknown channel %s from session", channel);
      return FALSE;
    }
  else if (session->transport != transport)
    {
      g_warning ("received message with wrong channel %s from session", channel);
      outbound_protocol_error (self, transport, NULL);
      return FALSE;
    }

  /* If this is a sideband, then send the message there */
  sideband = cockpit_sideband_by_channel (&self->sidebands, channel);
  if (sideband)
    {
      g_return_val_if_fail (sideband->connection != NULL, FALSE);
      if (web_socket_connection_get_ready_state (sideband->connection) == WEB_SOCKET_STATE_OPEN)
        {
          web_socket_connection_send (sideband->connection, sideband->data_type, NULL, payload);
          return TRUE;
        }
      return FALSE;
    }

  /* Forward the message to the right socket */
  socket = cockpit_socket_lookup_by_channel (&self->sockets, channel);
  if (socket && web_socket_connection_get_ready_state (socket->connection) == WEB_SOCKET_STATE_OPEN)
    {
      string = g_strdup_printf ("%s\n", channel);
      prefix = g_bytes_new_take (string, strlen (string));
      data_type = GPOINTER_TO_INT (g_hash_table_lookup (socket->channels, channel));
      web_socket_connection_send (socket->connection, data_type, prefix, payload);
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
  CockpitSocket *socket;
  CockpitSideband *sideband;
  const gchar *key = NULL;
  const gchar *fp = NULL;
  GBytes *payload;
  gboolean primary;

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
          sideband = cockpit_sideband_by_channel (&self->sidebands, channel);
          if (sideband)
            cockpit_sideband_destroy (&self->sidebands, sideband, problem);

          socket = cockpit_socket_lookup_by_channel (&self->sockets, channel);
          if (socket)
            {
              if (web_socket_connection_get_ready_state (socket->connection) == WEB_SOCKET_STATE_OPEN)
                {
                  payload = build_control ("command", "close",
                                           "channel", channel,
                                           "problem", problem,
                                           "host-key", key,
                                           "host-fingerprint", fp,
                                           NULL);
                  web_socket_connection_send (socket->connection, WEB_SOCKET_DATA_TEXT,
                                              self->control_prefix, payload);
                  g_bytes_unref (payload);
                }
            }
        }

      primary = session->primary;
      cockpit_session_destroy (&self->sessions, session);

      /* If this is the primary session, log the user out */
      if (primary)
        g_object_run_dispose (G_OBJECT (self));
    }
}

static CockpitSession *
lookup_or_open_session_for_host (CockpitWebService *self,
                                 const gchar *host,
                                 const gchar *host_key,
                                 CockpitCreds *creds,
                                 gboolean private)
{
  CockpitSession *session = NULL;
  CockpitSshAgent *agent = NULL;
  CockpitTransport *transport;
  const gchar *hostname;

  if (host == NULL || g_strcmp0 (host, "") == 0)
    host = "localhost";

  if (!private)
    session = cockpit_session_by_host (&self->sessions, host);
  if (!session)
    {
      /* Used during testing */
      hostname = host;
      if (g_strcmp0 (host, "localhost") == 0)
        {
          if (cockpit_ws_specific_ssh_port != 0)
            hostname = "127.0.0.1";
        }
      else
        {
          CockpitSession *local = cockpit_session_by_host (&self->sessions,
                                                           "localhost");
          if (local->transport)
            {
                gchar *next_id = generate_channel_id (self);
                gchar *channel_id = g_strdup_printf ("ssh-agent%s",
                                                     next_id);
                agent = cockpit_ssh_agent_new (local->transport,
                                               hostname,
                                               channel_id);
                g_free (channel_id);
                g_free (next_id);
            }
        }

      transport = g_object_new (COCKPIT_TYPE_SSH_TRANSPORT,
                                "host", hostname,
                                "port", cockpit_ws_specific_ssh_port,
                                "command", cockpit_ws_bridge_program,
                                "creds", creds,
                                "known-hosts", cockpit_ws_known_hosts,
                                "host-key", host_key,
                                "agent", agent,
                                NULL);

      session = cockpit_session_track (&self->sessions, host, private, creds, transport);
      session->control_sig = g_signal_connect_after (transport, "control", G_CALLBACK (on_session_control), self);
      session->recv_sig = g_signal_connect_after (transport, "recv", G_CALLBACK (on_session_recv), self);
      session->closed_sig = g_signal_connect_after (transport, "closed", G_CALLBACK (on_session_closed), self);
      g_object_unref (transport);

      if (agent)
        g_object_unref (agent);
    }

  return session;
}

static gboolean
parse_binary_type (JsonObject *options,
                   WebSocketDataType *data_type)
{
  const gchar *binary;

  if (!cockpit_json_get_string (options, "binary", NULL, &binary))
    {
      g_warning ("invalid \"binary\" option");
      return FALSE;
    }

  if (binary && g_str_equal (binary, "raw"))
    *data_type = WEB_SOCKET_DATA_BINARY;
  else
    *data_type = WEB_SOCKET_DATA_TEXT;
  return TRUE;
}

static gboolean
process_and_relay_open (CockpitWebService *self,
                        CockpitSocket *socket,
                        const gchar *channel,
                        JsonObject *options)
{
  WebSocketDataType data_type = WEB_SOCKET_DATA_TEXT;
  CockpitSession *session = NULL;
  CockpitCreds *creds;
  const gchar *specific_user;
  const gchar *password;
  const gchar *host;
  const gchar *host_key;
  const gchar *group;
  GBytes *payload;
  gboolean private;

  if (self->closing)
    {
      g_debug ("Ignoring open command while web socket is closing");
      return TRUE;
    }

  if (cockpit_session_by_channel (&self->sessions, channel))
    {
      g_warning ("cannot open a channel %s with the same id as another channel", channel);
      return FALSE;
    }

  if (!cockpit_json_get_string (options, "group", NULL, &group))
    {
      g_warning ("%s: received open command with invalid group", socket->id);
      return FALSE;
    }

  if (socket)
    {
      if (!parse_binary_type (options, &data_type))
        return FALSE;
    }

  if (!cockpit_json_get_string (options, "host", "localhost", &host))
    host = "localhost";

  /*
   * Some sessions shouldn't be shared by multiple channels, such as those that
   * explicitly specify a host-key or specific user.
   *
   * In the future we'd like to get away from having these sorts of channels, but
   * for now we force them to have their own session, started with those specific
   * arguments.
   *
   * This means the session doesn't show up in the by_host table.
   */
  private = FALSE;

  if (cockpit_json_get_string (options, "user", NULL, &specific_user) && specific_user && !g_str_equal (specific_user, ""))
    {
      if (!cockpit_json_get_string (options, "password", NULL, &password))
        password = NULL;
      creds = cockpit_creds_new (specific_user,
                                 cockpit_creds_get_application (self->creds),
                                 COCKPIT_CRED_PASSWORD, password,
                                 COCKPIT_CRED_RHOST, cockpit_creds_get_rhost (self->creds),
                                 NULL);

      /* A private session for this host */
      private = TRUE;
    }
  else
    {
      creds = cockpit_creds_ref (self->creds);
    }

  if (!cockpit_json_get_string (options, "host-key", NULL, &host_key))
    host_key = NULL;
  if (host_key)
    private = TRUE;

  session = lookup_or_open_session_for_host (self, host, host_key, creds, private);

  cockpit_creds_unref (creds);
  cockpit_session_add_channel (&self->sessions, session, channel);
  if (socket)
    cockpit_socket_add_channel (&self->sockets, socket, channel, data_type);
  if (group)
    g_hash_table_insert (self->channel_groups, g_strdup (channel), g_strdup (group));

  json_object_remove_member (options, "host");
  json_object_remove_member (options, "user");
  json_object_remove_member (options, "password");
  json_object_remove_member (options, "host-key");

  if (!session->sent_done)
    {
      payload = cockpit_json_write_bytes (options);
      cockpit_transport_send (session->transport, NULL, payload);
      g_bytes_unref (payload);
    }

  return TRUE;
}

static gboolean
process_logout (CockpitWebService *self,
                JsonObject *options)
{
  gboolean disconnect;

  if (!cockpit_json_get_bool (options, "disconnect", FALSE, &disconnect))
    {
      g_warning ("received 'logout' command with invalid 'disconnect' field");
      return FALSE;
    }

  /* Makes the credentials unusable */
  cockpit_creds_poison (self->creds);

  /* Destroys our web service, disconnects everything */
  if (disconnect)
    {
      g_info ("Logging out user %s from %s",
              cockpit_creds_get_user (self->creds),
              cockpit_creds_get_rhost (self->creds));
      g_object_run_dispose (G_OBJECT (self));
    }
  else
    {
      g_info ("Deauthorizing user %s",
              cockpit_creds_get_rhost (self->creds));
    }

  return TRUE;
}

static const gchar *
process_socket_init (CockpitWebService *self,
                     CockpitSocket *socket,
                     JsonObject *options)
{
  gint64 version;

  if (!cockpit_json_get_int (options, "version", -1, &version))
    {
      g_warning ("invalid version field in init message");
      return "protocol-error";
    }

  if (version == 1)
    {
      g_debug ("received web socket init message");
      socket->init_received = TRUE;
      return NULL;
    }
  else
    {
      g_message ("web socket used unsupported version of cockpit protocol: %"
                 G_GINT64_FORMAT, version);
      return "not-supported";
    }
}

static void
inbound_protocol_error (CockpitWebService *self,
                        WebSocketConnection *connection,
                        const gchar *problem)
{
  GBytes *payload;

  if (problem == NULL)
    problem = "protocol-error";

  if (web_socket_connection_get_ready_state (connection) == WEB_SOCKET_STATE_OPEN)
    {
      payload = build_control ("command", "close", "problem", problem, NULL);
      web_socket_connection_send (connection, WEB_SOCKET_DATA_TEXT, self->control_prefix, payload);
      g_bytes_unref (payload);
      web_socket_connection_close (connection, WEB_SOCKET_CLOSE_SERVER_ERROR, problem);
    }
}

static void
dispatch_inbound_command (CockpitWebService *self,
                          CockpitSocket *socket,
                          GBytes *payload)
{
  const gchar *problem = "protocol-error";
  const gchar *command;
  const gchar *channel;
  JsonObject *options = NULL;
  gboolean valid = FALSE;
  CockpitSession *session = NULL;
  GHashTableIter iter;

  valid = cockpit_transport_parse_command (payload, &command, &channel, &options);
  if (!valid)
    goto out;

  if (g_strcmp0 (command, "init") == 0)
    {
      problem = process_socket_init (self, socket, options);
      valid = (problem == NULL);
      goto out;
    }

  if (!socket->init_received)
    {
      g_message ("web socket did not send 'init' message first");
      valid = FALSE;
      goto out;
    }

  valid = TRUE;

  if (g_strcmp0 (command, "open") == 0)
    {
      valid = process_and_relay_open (self, socket, channel, options);
    }
  else if (g_strcmp0 (command, "logout") == 0)
    {
      valid = process_logout (self, options);
      if (valid)
        {
          /* logout is broadcast to everyone */
          g_hash_table_iter_init (&iter, self->sessions.by_transport);
          while (g_hash_table_iter_next (&iter, NULL, (gpointer *)&session))
            {
              if (!session->sent_done)
                cockpit_transport_send (session->transport, NULL, payload);
            }
        }
    }
  else if (g_strcmp0 (command, "close") == 0)
    {
      if (channel == NULL)
        {
          g_warning ("got close command without a channel");
          valid = FALSE;
        }
      else
        {
          valid = process_and_relay_close (self, socket, channel, payload);
        }
    }
  else if (g_strcmp0 (command, "kill") == 0)
    {
      /* This command is never forwarded */
      valid = process_kill (self, socket, options);
    }
  else if (channel)
    {
      /* Relay anything with a channel by default */
      session = cockpit_session_by_channel (&self->sessions, channel);
      if (session)
        {
          if (!session->sent_done)
            cockpit_transport_send (session->transport, NULL, payload);
        }
      else
        g_debug ("dropping control message with unknown channel %s", channel);
    }

out:
  if (!valid)
    inbound_protocol_error (self, socket->connection, problem);
  if (options)
    json_object_unref (options);
}

static void
on_web_socket_message (WebSocketConnection *connection,
                       WebSocketDataType type,
                       GBytes *message,
                       CockpitWebService *self)
{
  CockpitSession *session;
  CockpitSocket *socket;
  GBytes *payload;
  gchar *channel;

  socket = cockpit_socket_lookup_by_connection (&self->sockets, connection);
  g_return_if_fail (socket != NULL);

  payload = cockpit_transport_parse_frame (message, &channel);
  if (!payload)
    return;

  /* A control channel command */
  if (!channel)
    {
      dispatch_inbound_command (self, socket, payload);
    }

  /* An actual payload message */
  else if (!self->closing)
    {
      session = cockpit_session_by_channel (&self->sessions, channel);
      if (session)
        {
          if (!session->sent_done)
            cockpit_transport_send (session->transport, channel, payload);
        }
      else
        {
          g_debug ("received message for unknown channel %s", channel);
        }
    }

  g_free (channel);
  g_bytes_unref (payload);
}

static void
on_web_socket_open (WebSocketConnection *connection,
                    CockpitWebService *self)
{
  CockpitSocket *socket;
  JsonArray *capabilities;
  GBytes *command;
  JsonObject *object;
  JsonObject *info;

  g_info ("New connection from %s for %s",
          cockpit_creds_get_rhost (self->creds),
          cockpit_creds_get_user (self->creds));

  socket = cockpit_socket_lookup_by_connection (&self->sockets, connection);
  g_return_if_fail (socket != NULL);

  object = json_object_new ();
  json_object_set_string_member (object, "command", "init");
  json_object_set_int_member (object, "version", 1);
  json_object_set_string_member (object, "channel-seed", socket->id);
  json_object_set_string_member (object, "host", "localhost");
  if (web_socket_connection_get_flavor (connection) == WEB_SOCKET_FLAVOR_RFC6455)
    {
      capabilities = json_array_new ();
      json_array_add_string_element (capabilities, "binary");
      json_array_add_string_element (capabilities, "ssh");
      json_array_add_string_element (capabilities, "multi");
      json_object_set_array_member (object, "capabilities", capabilities);
    }

  info = json_object_new ();
  json_object_set_string_member (info, "version", PACKAGE_VERSION);
  json_object_set_string_member (info, "build", COCKPIT_BUILD_INFO);
  json_object_set_object_member (object, "system", info);

  command = cockpit_json_write_bytes (object);
  json_object_unref (object);

  web_socket_connection_send (connection, WEB_SOCKET_DATA_TEXT, self->control_prefix, command);
  g_bytes_unref (command);

  g_signal_connect (connection, "message",
                    G_CALLBACK (on_web_socket_message), self);
}

static void
on_web_socket_error (WebSocketConnection *connection,
                     GError *error,
                     gpointer unused)
{
  if (g_error_matches (error, G_TLS_ERROR, G_TLS_ERROR_EOF))
    g_debug ("web socket error: %s", error->message);
  else
    g_message ("%s", error->message);
}

static gboolean
on_web_socket_closing (WebSocketConnection *connection,
                       CockpitWebService *self)
{
  CockpitSideband *sideband;
  CockpitSession *session;
  CockpitSocket *socket;
  GHashTable *snapshot;
  GHashTableIter iter;
  const gchar *channel;
  GBytes *payload;

  g_debug ("web socket closing");

  /* Close any channels that were opened by this web socket */
  snapshot = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, NULL);
  g_hash_table_iter_init (&iter, self->sessions.by_channel);
  while (g_hash_table_iter_next (&iter, (gpointer *)&channel, (gpointer *)&session))
    {
      socket = cockpit_socket_lookup_by_channel (&self->sockets, channel);
      if (socket && socket->connection == connection)
        g_hash_table_insert (snapshot, g_strdup (channel), session);
    }

  g_hash_table_iter_init (&iter, snapshot);
  while (g_hash_table_iter_next (&iter, (gpointer *)&channel, (gpointer *)&session))
    {
      sideband = cockpit_sideband_by_channel (&self->sidebands, channel);
      if (sideband)
        cockpit_sideband_destroy (&self->sidebands, sideband, "disconnected");

      payload = build_control ("command", "close",
                               "channel", channel,
                               "problem", "disconnected",
                               NULL);
      cockpit_transport_send (session->transport, NULL, payload);
      g_bytes_unref (payload);
    }
  g_hash_table_destroy (snapshot);

  return TRUE;
}

static void
on_web_socket_close (WebSocketConnection *connection,
                     CockpitWebService *self)
{
  CockpitSocket *socket;

  g_info ("WebSocket from %s for %s closed",
          cockpit_creds_get_rhost (self->creds),
          cockpit_creds_get_user (self->creds));

  g_signal_handlers_disconnect_by_func (connection, on_web_socket_open, self);
  g_signal_handlers_disconnect_by_func (connection, on_web_socket_closing, self);
  g_signal_handlers_disconnect_by_func (connection, on_web_socket_close, self);
  g_signal_handlers_disconnect_by_func (connection, on_web_socket_error, self);

  socket = cockpit_socket_lookup_by_connection (&self->sockets, connection);
  g_return_if_fail (socket != NULL);

  cockpit_socket_destroy (&self->sockets, socket);

  caller_end (self);
}

static gboolean
on_ping_time (gpointer user_data)
{
  CockpitWebService *self = user_data;
  WebSocketConnection *connection;
  GHashTableIter iter;
  GBytes *payload;

  payload = build_control ("command", "ping", NULL);

  g_hash_table_iter_init (&iter, self->sockets.by_connection);
  while (g_hash_table_iter_next (&iter, (gpointer *)&connection, NULL))
    {
      if (web_socket_connection_get_ready_state (connection) == WEB_SOCKET_STATE_OPEN)
        web_socket_connection_send (connection, WEB_SOCKET_DATA_TEXT, self->control_prefix, payload);
    }

  g_bytes_unref (payload);
  return TRUE;
}

static void
cockpit_web_service_init (CockpitWebService *self)
{
  self->control_prefix = g_bytes_new_static ("\n", 1);
  cockpit_sessions_init (&self->sessions);
  cockpit_sockets_init (&self->sockets);
  cockpit_sidebands_init (&self->sidebands);
  self->ping_timeout = g_timeout_add_seconds (cockpit_ws_ping_interval, on_ping_time, self);
  self->channel_groups = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, g_free);
}

static void
cockpit_web_service_class_init (CockpitWebServiceClass *klass)
{
  GObjectClass *object_class = G_OBJECT_CLASS (klass);
  object_class->dispose = cockpit_web_service_dispose;
  object_class->finalize = cockpit_web_service_finalize;

  sig_idling = g_signal_new ("idling", COCKPIT_TYPE_WEB_SERVICE,
                             G_SIGNAL_RUN_LAST, 0, NULL, NULL, NULL,
                             G_TYPE_NONE, 0);
  sig_destroy = g_signal_new ("destroy", COCKPIT_TYPE_WEB_SERVICE,
                              G_SIGNAL_RUN_LAST, 0, NULL, NULL, NULL,
                              G_TYPE_NONE, 0);
}

/**
 * cockpit_web_service_new:
 * @creds: credentials of user
 * @session: optionally an open cockpit-session master process, or NULL
 *
 * Creates a new web service to serve web sockets and connect
 * to bridges for the given user.
 *
 * Returns: (transfer full): the new web service
 */
CockpitWebService *
cockpit_web_service_new (CockpitCreds *creds,
                         CockpitTransport *transport)
{
  CockpitWebService *self;
  CockpitSession *session;

  g_return_val_if_fail (creds != NULL, NULL);

  self = g_object_new (COCKPIT_TYPE_WEB_SERVICE, NULL);
  self->creds = cockpit_creds_ref (creds);

  if (transport)
    {
      /* Any failures happen asyncronously */
      session = cockpit_session_track (&self->sessions, "localhost", FALSE, creds, transport);
      session->control_sig = g_signal_connect_after (transport, "control", G_CALLBACK (on_session_control), self);
      session->recv_sig = g_signal_connect_after (transport, "recv", G_CALLBACK (on_session_recv), self);
      session->closed_sig = g_signal_connect_after (transport, "closed", G_CALLBACK (on_session_closed), self);
      session->primary = TRUE;
    }

  return self;
}

static WebSocketConnection *
create_web_socket_server_for_stream (const gchar **protocols,
                                     const gchar *path,
                                     const gchar *query,
                                     GIOStream *io_stream,
                                     GHashTable *headers,
                                     GByteArray *input_buffer)
{
  WebSocketConnection *connection;
  const gchar *host = NULL;
  const gchar **origins;
  gchar *allocated = NULL;
  gchar *origin = NULL;
  gchar *defaults[2];
  gboolean secure;
  gchar *url;

  g_return_val_if_fail (path != NULL, NULL);

  if (headers)
    host = g_hash_table_lookup (headers, "Host");
  if (!host)
    host = cockpit_ws_default_host_header;

  secure = G_IS_TLS_CONNECTION (io_stream);

  url = g_strdup_printf ("%s://%s%s%s%s",
                         secure ? "wss" : "ws",
                         host ? host : "localhost",
                         path,
                         query ? "?" : "",
                         query ? query : "");

  origins = cockpit_conf_strv ("WebService", "Origins", ' ');
  if (origins == NULL)
    {
      origin = g_strdup_printf ("%s://%s", secure ? "https" : "http", host);
      defaults[0] = origin;
      defaults[1] = NULL;
      origins = (const gchar **)defaults;
    }

  connection = web_socket_server_new_for_stream (url, origins, protocols,
                                                 io_stream, headers, input_buffer);
  g_free (allocated);
  g_free (url);
  g_free (origin);

  return connection;
}

/**
 * cockpit_web_service_socket:
 * @io_stream: the stream to talk on
 * @headers: optional headers already parsed
 * @input_buffer: optional bytes already parsed after headers
 * @auth: authentication object
 * @creds: credentials of user or NULL for failed auth
 *
 * Serves the WebSocket on the given web service. Holds an extra
 * reference to the web service until the socket is closed.
 */
void
cockpit_web_service_socket (CockpitWebService *self,
                            const gchar *path,
                            GIOStream *io_stream,
                            GHashTable *headers,
                            GByteArray *input_buffer)
{
  const gchar *protocols[] = { "cockpit1", NULL };
  WebSocketConnection *connection;

  connection = create_web_socket_server_for_stream (protocols, path,
                                                    NULL, io_stream, headers, input_buffer);

  g_signal_connect (connection, "open", G_CALLBACK (on_web_socket_open), self);
  g_signal_connect (connection, "closing", G_CALLBACK (on_web_socket_closing), self);
  g_signal_connect (connection, "close", G_CALLBACK (on_web_socket_close), self);
  g_signal_connect (connection, "error", G_CALLBACK (on_web_socket_error), NULL);

  cockpit_socket_track (&self->sockets, connection);
  g_object_unref (connection);

  caller_begin (self);
}



/**
 * cockpit_web_service_get_creds:
 * @self: the service
 *
 * Returns: (transfer none): the credentials for which this service was opened.
 */
CockpitCreds *
cockpit_web_service_get_creds (CockpitWebService *self)
{
  g_return_val_if_fail (COCKPIT_IS_WEB_SERVICE (self), NULL);
  return self->creds;
}

/**
 * cockpit_web_service_disconnect:
 * @self: the service
 *
 * Close all sessions and sockets that are running in this web
 * service.
 */
void
cockpit_web_service_disconnect (CockpitWebService *self)
{
  g_object_run_dispose (G_OBJECT (self));
}

static void
on_web_socket_noauth (WebSocketConnection *connection,
                      gpointer data)
{
  GBytes *payload;
  GBytes *prefix;

  g_debug ("closing unauthenticated web socket");

  payload = build_control ("command", "init", "problem", "no-session", NULL);
  prefix = g_bytes_new_static ("\n", 1);

  web_socket_connection_send (connection, WEB_SOCKET_DATA_TEXT, prefix, payload);
  web_socket_connection_close (connection, WEB_SOCKET_CLOSE_GOING_AWAY, "no-session");

  g_bytes_unref (prefix);
  g_bytes_unref (payload);
}

void
cockpit_web_service_noauth (GIOStream *io_stream,
                            const gchar *path,
                            GHashTable *headers,
                            GByteArray *input_buffer)
{
  WebSocketConnection *connection;
  gchar *application;

  application = cockpit_auth_parse_application (path);
  connection = create_web_socket_server_for_stream (NULL, application, NULL, io_stream,
                                                    headers, input_buffer);
  g_free (application);

  g_signal_connect (connection, "open", G_CALLBACK (on_web_socket_noauth), NULL);
  g_signal_connect (connection, "error", G_CALLBACK (on_web_socket_error), NULL);

  /* Unreferences connection when it closes */
  g_signal_connect (connection, "close", G_CALLBACK (g_object_unref), NULL);
}

static void
on_sideband_open (WebSocketConnection *connection,
                  CockpitWebService *self)
{
  CockpitSideband *sideband;

  /*
   * We delayed sending the "open" message for the sideband channel
   * earlier, since opening it would have caused the bridge to start
   * talking prematurely. So now we're ready to send it.
   */

  sideband = cockpit_sideband_by_connection (&self->sidebands, connection);
  g_return_if_fail (sideband != NULL);

  if (!process_and_relay_open (self, NULL, sideband->channel, sideband->options))
    {
      web_socket_connection_close (connection, WEB_SOCKET_CLOSE_SERVER_ERROR, "protocol-error");
      return;
    }
}

static void
on_sideband_message (WebSocketConnection *connection,
                     WebSocketDataType type,
                     GBytes *payload,
                     CockpitWebService *self)
{
  CockpitSideband *sideband;
  CockpitSession *session;

  sideband = cockpit_sideband_by_connection (&self->sidebands, connection);
  if (sideband)
    {
      session = cockpit_session_by_channel (&self->sessions, sideband->channel);
      if (session)
        {
          if (!session->sent_done)
            cockpit_transport_send (session->transport, sideband->channel, payload);
        }
      else
        {
          g_debug ("sideband message for unknown channel %s", sideband->channel);
        }
    }
}

static void
on_sideband_close (WebSocketConnection *connection,
                   CockpitWebService *self)
{
  CockpitSideband *sideband;
  CockpitSession *session;
  GBytes *payload;

  sideband = cockpit_sideband_by_connection (&self->sidebands, connection);
  if (sideband)
    {
      session = cockpit_session_by_channel (&self->sessions, sideband->channel);
      if (session && !session->sent_done)
        {
          payload = build_control ("command", "done", "channel", sideband->channel, NULL);
          cockpit_transport_send (session->transport, sideband->channel, payload);
          g_bytes_unref (payload);
        }
    }
}

static void
on_sideband_invalid (WebSocketConnection *connection,
                     gpointer unused)
{
  g_debug ("closing invalid web socket");
  web_socket_connection_close (connection, WEB_SOCKET_CLOSE_GOING_AWAY, "protocol-error");
}

void
cockpit_web_service_sideband (CockpitWebService *self,
                              const gchar *path,
                              const gchar *escaped,
                              GIOStream *io_stream,
                              GHashTable *headers,
                              GByteArray *input_buffer)
{
  WebSocketConnection *connection = NULL;
  CockpitSideband *sideband = NULL;
  const gchar *array[] = { NULL, NULL };
  WebSocketDataType data_type;
  const gchar **protocols;
  const gchar *protocol;
  JsonObject *options = NULL;
  const gchar *channel;
  GBytes *bytes = NULL;
  gchar *generated = NULL;
  gchar *data = NULL;

  data = g_uri_unescape_string (escaped, "/");
  if (data == NULL)
    {
      g_warning ("invalid sideband query string");
      goto out;
    }

  bytes = g_bytes_new_take (data, strlen (data));
  if (!cockpit_transport_parse_command (bytes, NULL, &channel, &options))
    {
      g_warning ("invalid sideband command");
      goto out;
    }

  if (channel != NULL)
    {
      g_warning ("should not specify \"channel\" in sideband command: %s", channel);
      goto out;
    }

  if (!cockpit_json_get_string (options, "protocol", NULL, &protocol))
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

  json_object_set_string_member (options, "command", "open");

  if (!parse_binary_type (options, &data_type))
    goto out;

  channel = generated = generate_channel_id (self);
  json_object_set_string_member (options, "channel", generated);

  connection = create_web_socket_server_for_stream (protocols, path, escaped,
                                                    io_stream, headers, input_buffer);

  sideband = cockpit_sideband_track (&self->sidebands, channel, connection);
  sideband->options = json_object_ref (options);
  sideband->data_type = data_type;

  sideband->open_sig = g_signal_connect (connection, "open", G_CALLBACK (on_sideband_open), self);
  sideband->message_sig = g_signal_connect (connection, "message", G_CALLBACK (on_sideband_message), self);
  sideband->close_sig = g_signal_connect (connection, "close", G_CALLBACK (on_sideband_close), self);
  g_signal_connect (connection, "error", G_CALLBACK (on_web_socket_error), NULL);

out:
  if (bytes)
    g_bytes_unref (bytes);
  if (options)
    json_object_unref (options);
  if (connection)
    g_object_unref (connection);
  g_free (generated);

  if (!sideband)
    {
      connection = create_web_socket_server_for_stream (NULL, path, escaped, io_stream,
                                                        headers, input_buffer);
      g_signal_connect (connection, "open", G_CALLBACK (on_sideband_invalid), "protocol-error");
      g_signal_connect (connection, "error", G_CALLBACK (on_web_socket_error), NULL);
      g_signal_connect (connection, "close", G_CALLBACK (g_object_unref), NULL);
    }
}

gboolean
cockpit_web_service_get_idling (CockpitWebService *self)
{
  g_return_val_if_fail (COCKPIT_IS_WEB_SERVICE (self), TRUE);
  return (self->callers == 0);
}

static gboolean
redirect_to_checksum_path (CockpitWebService *self,
                           CockpitWebResponse *response,
                           const gchar *checksum,
                           const gchar *path)
{
  gchar *location;
  const gchar *body;
  GBytes *bytes;
  gboolean ret;
  gsize length;

  location = g_strdup_printf ("/%s/$%s%s",
                              cockpit_creds_get_application (self->creds),
                              checksum, path);

  body = "<html><head><title>Temporary redirect</title></head>"
         "<body>Access via checksum</body></html>";

  length = strlen (body);
  cockpit_web_response_headers (response, 307, "Temporary Redirect", length,
                                "Content-Type", "text/html",
                                "Location", location,
                                NULL);
  g_free (location);

  bytes = g_bytes_new_static (body, length);
  ret = cockpit_web_response_queue (response, bytes);
  if (ret)
    cockpit_web_response_complete (response);
  g_bytes_unref (bytes);

  return ret;
}

typedef struct {
  const gchar *logname;
  CockpitWebResponse *response;
  CockpitTransport *transport;
  GHashTable *headers;
  gchar *base_path;
  gchar *channel;
  gulong recv_sig;
  gulong closed_sig;
  gulong control_sig;
  gboolean done;
  gpointer service;
} ResourceResponse;

static void
resource_response_done (ResourceResponse *rr,
                        const gchar *problem)
{
  CockpitWebResponding state;

  /* Ensure no more signals arrive about our response */
  g_signal_handler_disconnect (rr->transport, rr->recv_sig);
  g_signal_handler_disconnect (rr->transport, rr->closed_sig);
  g_signal_handler_disconnect (rr->transport, rr->control_sig);

  /* The web response should not yet be complete */
  state = cockpit_web_response_get_state (rr->response);

  if (problem == NULL)
    {
      if (state < COCKPIT_WEB_RESPONSE_COMPLETE)
        {
          g_message ("%s: invalid state while serving resource", rr->logname);
          cockpit_web_response_abort (rr->response);
        }
      else
        {
          g_debug ("%s: completed serving resource", rr->logname);
        }
    }
  else if (state == COCKPIT_WEB_RESPONSE_READY)
    {
      if (g_str_equal (problem, "not-found"))
        {
          g_debug ("%s: resource not found", rr->logname);
          cockpit_web_response_error (rr->response, 404, NULL, NULL);
        }
      else if (g_str_equal (problem, "no-host") ||
               g_str_equal (problem, "no-forwarding") ||
               g_str_equal (problem, "unknown-hostkey") ||
               g_str_equal (problem, "authentication-failed"))
        {
          g_debug ("%s: remote server unavailable: %s", rr->logname, problem);
          cockpit_web_response_error (rr->response, 502, NULL, NULL);
        }
      else
        {
          g_message ("%s: failed to retrieve resource: %s", rr->logname, problem);
          cockpit_web_response_error (rr->response, 500, NULL, NULL);
        }
    }
  else
    {
      g_message ("%s: failure while serving resource: %s", rr->logname, problem);
      cockpit_web_response_abort (rr->response);
    }

  if (rr->service)
    g_object_remove_weak_pointer (rr->service, &rr->service);

  g_object_unref (rr->response);
  g_object_unref (rr->transport);
  g_hash_table_unref (rr->headers);
  g_free (rr->base_path);
  g_free (rr->channel);
  g_free (rr);
}

static gboolean
on_resource_recv (CockpitTransport *transport,
                  const gchar *channel,
                  GBytes *payload,
                  gpointer user_data)
{
  ResourceResponse *rr = user_data;

  if (g_strcmp0 (channel, rr->channel) != 0)
    return FALSE;

  cockpit_web_response_queue (rr->response, payload);
  return TRUE;
}

static void
object_to_headers (JsonObject *object,
                   const gchar *header,
                   JsonNode *node,
                   gpointer user_data)
{
  GHashTable *headers = user_data;
  const gchar *value = json_node_get_string (node);

  g_return_if_fail (value != NULL);

  if (g_ascii_strcasecmp (header, "Content-Length") == 0 ||
      g_ascii_strcasecmp (header, "Connection") == 0)
    return;

  g_hash_table_insert (headers, g_strdup (header), g_strdup (value));
}

static gboolean
parse_http_headers (ResourceResponse *rr,
                    GBytes *payload,
                    gint *status,
                    gchar **reason)
{
  JsonObject *object = NULL;
  JsonObject *heads;
  GError *error = NULL;
  gboolean ret = FALSE;

  object = cockpit_json_parse_bytes (payload, &error);
  if (error)
    {
      g_warning ("%s: couldn't parse http-stream1 header payload: %s", rr->logname, error->message);
      g_error_free (error);
      goto out;
    }

  *status = json_object_get_int_member (object, "status");
  *reason = g_strdup (json_object_get_string_member (object, "reason"));

  heads = json_object_get_object_member (object, "headers");
  json_object_foreach_member (heads, object_to_headers, rr->headers);

  ret = TRUE;

out:
  if (object)
    json_object_unref (object);

  return ret;
}

static void
resource_inject (ResourceResponse *rr)
{
  static const gchar *marker = "<head>";
  CockpitSession *session;
  CockpitWebFilter *filter;
  CockpitWebService *self;
  GString *str;
  GBytes *tag;

  if (!rr->base_path || !rr->service)
    return;

  self = COCKPIT_WEB_SERVICE (rr->service);
  session = cockpit_session_by_transport (&self->sessions, rr->transport);
  if (!session)
    return;

  str = g_string_new ("");
  if (session->checksum)
    {
      g_string_printf (str, "\n    <base href=\"/%s/$%s%s\">",
                       cockpit_creds_get_application (self->creds),
                       session->checksum, rr->base_path);
    }
  else
    {
      g_string_printf (str, "\n    <base href=\"/%s/@%s%s\">",
                       cockpit_creds_get_application (self->creds),
                       session->host, rr->base_path);
    }

  tag = g_string_free_to_bytes (str);
  filter = cockpit_web_inject_new (marker, tag);
  g_bytes_unref (tag);

  cockpit_web_response_add_filter (rr->response, filter);
  g_object_unref (filter);
}

static gboolean
on_resource_recv_first (CockpitTransport *transport,
                        const gchar *channel,
                        GBytes *payload,
                        gpointer user_data)
{
  ResourceResponse *rr = user_data;
  gint status;
  gchar *reason;

  if (g_strcmp0 (channel, rr->channel) != 0)
    return FALSE;

  g_return_val_if_fail (cockpit_web_response_get_state (rr->response) == COCKPIT_WEB_RESPONSE_READY, FALSE);

  /* First response payload message is meta data, then switch to actual data */
  g_signal_handler_disconnect (transport, rr->recv_sig);
  rr->recv_sig = g_signal_connect (transport, "recv", G_CALLBACK (on_resource_recv), rr);

  if (parse_http_headers (rr, payload, &status, &reason))
    {
      resource_inject (rr);
      cockpit_web_response_headers_full (rr->response, status, reason, -1, rr->headers);
      g_free (reason);
    }
  else
    {
      cockpit_web_response_headers (rr->response, 500, "Internal Server", -1, NULL);
    }

  return TRUE;
}

static gboolean
on_resource_control (CockpitTransport *transport,
                     const gchar *command,
                     const gchar *channel,
                     JsonObject *options,
                     GBytes *message,
                     gpointer user_data)
{
  ResourceResponse *rr = user_data;
  const gchar *problem = NULL;

  if (g_strcmp0 (channel, rr->channel) != 0)
    return FALSE; /* not handled */

  if (g_str_equal (command, "done"))
    {
      cockpit_web_response_complete (rr->response);
      return TRUE;
    }
  else if (!g_str_equal (command, "close"))
    {
      g_message ("%s: received unknown command on resource channel: %s", rr->logname, command);
      return TRUE;
    }

  if (!cockpit_json_get_string (options, "problem", NULL, &problem))
    {
      g_message ("%s: received close command with invalid problem", rr->logname);
      problem = "unknown";
    }

  resource_response_done (rr, problem);
  return TRUE; /* handled */
}

static void
on_resource_closed (CockpitTransport *transport,
                    const gchar *problem,
                    gpointer user_data)
{
  ResourceResponse *rr = user_data;

  g_debug ("%s: transport closed while serving resource: %s", rr->logname, problem);

  if (problem == NULL)
    problem = "terminated";

  resource_response_done (rr, problem);
}

static ResourceResponse *
resource_response_new (CockpitWebService *self,
                       CockpitSession *session,
                       CockpitWebResponse *response,
                       const gchar *base_path)
{
  ResourceResponse *rr;

  rr = g_new0 (ResourceResponse, 1);
  rr->response = g_object_ref (response);
  rr->transport = g_object_ref (session->transport);
  rr->headers = cockpit_web_server_new_table ();
  rr->channel = generate_channel_id (self);
  rr->logname = cockpit_web_response_get_path (response);
  rr->base_path = g_strdup (base_path);

  rr->service = self;
  g_object_add_weak_pointer (rr->service, &rr->service);

  rr->recv_sig = g_signal_connect (rr->transport, "recv", G_CALLBACK (on_resource_recv_first), rr);
  rr->closed_sig = g_signal_connect (rr->transport, "closed", G_CALLBACK (on_resource_closed), rr);
  rr->control_sig = g_signal_connect (rr->transport, "control", G_CALLBACK (on_resource_control), rr);

  return rr;
}

void
cockpit_web_service_resource (CockpitWebService *self,
                              GHashTable *headers,
                              CockpitWebResponse *response,
                              const gchar *where,
                              const gchar *path)
{
  ResourceResponse *rr;
  CockpitSession *session = NULL;
  const gchar *base_path = NULL;
  const gchar *host = NULL;
  gchar *quoted_etag = NULL;
  gchar *package = NULL;
  gchar *val = NULL;
  gboolean handled = FALSE;
  GHashTableIter iter;
  GBytes *command;
  gchar **parts = NULL;
  JsonObject *object;
  JsonObject *heads;
  gpointer key;
  gpointer value;

  g_return_if_fail (COCKPIT_IS_WEB_SERVICE (self));
  g_return_if_fail (COCKPIT_IS_WEB_RESPONSE (response));
  g_return_if_fail (headers != NULL);
  g_return_if_fail (path != NULL);

  if (where == NULL)
    {
      host = "localhost";
    }
  else if (where[0] == '@')
    {
      host = where + 1;
    }
  else if (where[0] == '$')
    {
      quoted_etag = g_strdup_printf ("\"%s\"", where);

      if (g_strcmp0 (g_hash_table_lookup (headers, "If-None-Match"), where) == 0 ||
          g_strcmp0 (g_hash_table_lookup (headers, "If-None-Match"), quoted_etag) == 0)
        {
          cockpit_web_response_headers (response, 304, "Not Modified", 0, "ETag", quoted_etag, NULL);
          cockpit_web_response_complete (response);
          handled = TRUE;
          goto out;
        }

      /* Always check localhost first */
      session = g_hash_table_lookup (self->sessions.by_host, "localhost");
      if (session && session->checksum && g_str_equal (session->checksum, where + 1))
        host = session->host;

      if (!host)
        {
          g_hash_table_iter_init (&iter, self->sessions.by_transport);
          while (g_hash_table_iter_next (&iter, NULL, (gpointer *)&session))
            {
              if (session->checksum && g_str_equal (session->checksum, where + 1))
                {
                  host = session->host;
                  break;
                }
            }
        }

      if (!host)
        goto out;
    }
  else
    {
      goto out;
    }

  session = lookup_or_open_session_for_host (self, host, NULL, self->creds, FALSE);
  if (where)
    {
      /*
       * Maybe send back a redirect to the checksum url. We only do this if actually
       * accessing a file, and not a some sort of data like '/checksum', or a root path
       * like '/'
       */
      if (where[0] == '@' && session->checksum && strchr (path, '.'))
        {
          handled = redirect_to_checksum_path (self, response, session->checksum, path);
          goto out;
        }
    }
  else
    {
      base_path = path;
    }

  rr = resource_response_new (self, session, response, base_path);

  if (quoted_etag)
    {
      /*
       * If we have a checksum, then use it as an ETag. It is intentional that
       * a cockpit-bridge version could (in the future) override this.
       */
      g_hash_table_insert (rr->headers, g_strdup ("ETag"), quoted_etag);
      quoted_etag = NULL;
    }

  object = build_json ("command", "open",
                       "channel", rr->channel,
                       "payload", "http-stream1",
                       "internal", "packages",
                       "method", "GET",
                       "host", host,
                       "path", path,
                       "binary", "raw",
                       NULL);

  heads = json_object_new ();

  g_hash_table_iter_init (&iter, headers);
  while (g_hash_table_iter_next (&iter, &key, &value))
    {
      val = NULL;

      if (g_ascii_strcasecmp (key, "Host") == 0 ||
          g_ascii_strcasecmp (key, "Cookie") == 0 ||
          g_ascii_strcasecmp (key, "Referer") == 0 ||
          g_ascii_strcasecmp (key, "Connection") == 0 ||
          g_ascii_strcasecmp (key, "Pragma") == 0 ||
          g_ascii_strcasecmp (key, "Cache-Control") == 0 ||
          g_ascii_strcasecmp (key, "User-Agent") == 0 ||
          g_ascii_strcasecmp (key, "Accept-Charset") == 0 ||
          g_ascii_strcasecmp (key, "Accept-Ranges") == 0 ||
          g_ascii_strcasecmp (key, "Content-Length") == 0 ||
          g_ascii_strcasecmp (key, "Content-MD5") == 0 ||
          g_ascii_strcasecmp (key, "Content-Range") == 0 ||
          g_ascii_strcasecmp (key, "Range") == 0 ||
          g_ascii_strcasecmp (key, "TE") == 0 ||
          g_ascii_strcasecmp (key, "Trailer") == 0 ||
          g_ascii_strcasecmp (key, "Upgrade") == 0 ||
          g_ascii_strcasecmp (key, "Transfer-Encoding") == 0)
        continue;

      json_object_set_string_member (heads, key, value);
      g_free (val);
    }

  json_object_set_string_member (heads, "Host", session->host);
  json_object_set_object_member (object, "headers", heads);

  command = cockpit_json_write_bytes (object);
  json_object_unref (object);

  cockpit_transport_send (rr->transport, NULL, command);
  g_bytes_unref (command);

  object = build_json ("command", "done",
                       "channel", rr->channel,
                       NULL);

  command = cockpit_json_write_bytes (object);
  json_object_unref (object);

  cockpit_transport_send (rr->transport, NULL, command);
  g_bytes_unref (command);

  handled = TRUE;

out:
  g_strfreev (parts);
  g_free (quoted_etag);
  g_free (package);

  if (!handled)
    cockpit_web_response_error (response, 404, NULL, NULL);
}
