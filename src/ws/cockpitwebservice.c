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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

#include "config.h"

#include "cockpitwebservice.h"

#include "cockpitcompat.h"
#include "cockpitws.h"

#include <string.h>

#include <json-glib/json-glib.h>
#include <gio/gunixinputstream.h>
#include <gio/gunixoutputstream.h>

#include "common/cockpitauthorize.h"
#include "common/cockpitconf.h"
#include "common/cockpithex.h"
#include "common/cockpitjson.h"
#include "common/cockpitmemory.h"
#include "common/cockpitsystem.h"
#include "common/cockpitwebresponse.h"
#include "common/cockpitwebserver.h"

#include "websocket/websocket.h"


#include <stdlib.h>

guint cockpit_ws_ping_interval = 5;

/* ----------------------------------------------------------------------------
 * Web Socket Info
 */

typedef struct {
  gchar *id;
  WebSocketConnection *connection;
  GHashTable *channels;
  JsonObject *init_received;
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
  if (socket->init_received)
    json_object_unref (socket->init_received);
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

  /* This owns the socket */
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
cockpit_sockets_close (CockpitSockets *sockets,
                       const gchar *problem)
{
  GHashTableIter iter;
  CockpitSocket *socket;

  if (!problem)
    problem = "terminated";

  g_hash_table_iter_init (&iter, sockets->by_connection);
  while (g_hash_table_iter_next (&iter, NULL, (gpointer *)&socket))
    {
      if (web_socket_connection_get_ready_state (socket->connection) < WEB_SOCKET_STATE_CLOSING)
        web_socket_connection_close (socket->connection, WEB_SOCKET_CLOSE_GOING_AWAY, problem);
    }
}

static void
cockpit_sockets_cleanup (CockpitSockets *sockets)
{
  g_hash_table_destroy (sockets->by_connection);
  g_hash_table_destroy (sockets->by_channel);
}

/* ----------------------------------------------------------------------------
 * Web Socket Routing
 */

struct _CockpitWebService {
  GObject parent;

  gchar *id;

  CockpitCreds *creds;
  CockpitSockets sockets;
  gboolean closing;
  GBytes *control_prefix;
  guint ping_timeout;
  gint callers;
  guint next_internal_id;

  CockpitTransport *transport;
  JsonObject *init_received;
  gulong control_sig;
  gulong recv_sig;
  gulong closed_sig;
  gboolean sent_done;
  guint credentials_timeout;

  GHashTable *checksum_by_host;
  GHashTable *host_by_checksum;
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
  gboolean emit = FALSE;

  if (self->control_sig)
    g_signal_handler_disconnect (self->transport, self->control_sig);
  self->control_sig = 0;

  if (self->recv_sig)
    g_signal_handler_disconnect (self->transport, self->recv_sig);
  self->recv_sig = 0;

  if (self->closed_sig)
    g_signal_handler_disconnect (self->transport, self->closed_sig);
  self->closed_sig = 0;

  if (self->credentials_timeout)
    g_source_remove (self->credentials_timeout);
  self->credentials_timeout = 0;

  if (!self->sent_done)
    {
      self->sent_done = TRUE;
      cockpit_transport_close (self->transport, NULL);
    }

  if (!self->closing)
    {
      g_debug ("web service closing");
      emit = TRUE;
    }
  self->closing = TRUE;

  cockpit_sockets_close (&self->sockets, NULL);

  if (emit)
    g_signal_emit (self, sig_destroy, 0);

  G_OBJECT_CLASS (cockpit_web_service_parent_class)->dispose (object);
}

static void
cockpit_web_service_finalize (GObject *object)
{
  CockpitWebService *self = COCKPIT_WEB_SERVICE (object);

  cockpit_sockets_cleanup (&self->sockets);

  if (self->transport)
    g_object_unref (self->transport);
  if (self->init_received)
    json_object_unref (self->init_received);

  g_bytes_unref (self->control_prefix);
  cockpit_creds_unref (self->creds);
  if (self->ping_timeout)
    g_source_remove (self->ping_timeout);

  g_hash_table_destroy (self->host_by_checksum);
  g_hash_table_destroy (self->checksum_by_host);
  g_free (self->id);

  G_OBJECT_CLASS (cockpit_web_service_parent_class)->finalize (object);
}

gchar *
cockpit_web_service_unique_channel (CockpitWebService *self)
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
               const gchar *channel)
{
  if (socket)
    cockpit_socket_remove_channel (&self->sockets, socket, channel);

  return TRUE;
}

static gboolean
process_and_relay_close (CockpitWebService *self,
                         CockpitSocket *socket,
                         const gchar *channel,
                         GBytes *payload)
{
  gboolean valid;

  valid = process_close (self, socket, channel);
  if (valid && !self->sent_done)
    cockpit_transport_send (self->transport, NULL, payload);

  return valid;
}

static gboolean
process_kill (CockpitWebService *self,
              CockpitSocket *socket,
              JsonObject *options,
              GBytes *payload)
{
  if (!self->sent_done)
    cockpit_transport_send (self->transport, NULL, payload);

  return TRUE;
}

static gboolean
process_ping (CockpitWebService *self,
              CockpitSocket *socket,
              JsonObject *options)
{
  GBytes *payload;

  /* Respond to a ping without a channel, by saying "pong" */
  json_object_set_string_member (options, "command", "pong");
  payload = cockpit_json_write_bytes (options);
  if (web_socket_connection_get_ready_state (socket->connection) == WEB_SOCKET_STATE_OPEN)
    web_socket_connection_send (socket->connection, WEB_SOCKET_DATA_TEXT, self->control_prefix, payload);
  g_bytes_unref (payload);

  return TRUE;
}

static void
clear_and_free_string (gpointer data)
{
  cockpit_memory_clear (data, -1);
  free (data);
}

static gboolean
process_socket_authorize (CockpitWebService *self,
                          CockpitSocket *socket,
                          const gchar *channel,
                          JsonObject *options,
                          GBytes *payload)
{
  const gchar *response = NULL;
  gboolean ret = FALSE;
  GBytes *bytes = NULL;
  char *password = NULL;
  char *user = NULL;
  char *type = NULL;
  gpointer data;
  gsize length;

  if (!cockpit_json_get_string (options, "response", NULL, &response))
    {
      g_warning ("%s: received invalid \"response\" field in authorize command", socket->id);
      goto out;
    }

  ret = TRUE;
  if (response)
    {
      if (!cockpit_authorize_type (response, &type) || !g_str_equal (type, "basic"))
        goto out;

      password = cockpit_authorize_parse_basic (response, &user);
      if (password && !user)
        {
          cockpit_memory_clear (password, -1);
          free (password);
          password = NULL;
        }
    }
  else
    {
      goto out;
    }

  if (password == NULL)
    {
      bytes = NULL;
    }
  else
    {
      bytes = g_bytes_new_with_free_func (password, strlen (password),
                                          clear_and_free_string, password);
      password = NULL;
    }

  cockpit_creds_set_user (self->creds, user);
  cockpit_creds_set_password (self->creds, bytes);

  /* Clear out the payload memory */
  data = (gpointer)g_bytes_get_data (payload, &length);
  cockpit_memory_clear (data, length);

out:
  free (type);
  free (user);
  if (bytes)
    g_bytes_unref (bytes);
  return ret;
}

static gboolean
authorize_check_user (CockpitCreds *creds,
                      const char *challenge)
{
  char *subject = NULL;
  gboolean ret = FALSE;
  const gchar *user;

  if (!cockpit_authorize_subject (challenge, &subject))
    goto out;

  if (!subject || g_str_equal (subject, ""))
    {
      ret = TRUE;
    }
  else
    {
      user = cockpit_creds_get_user (creds);
      if (user == NULL)
        {
          ret = TRUE;
        }
      else
        {
          char *encoded = cockpit_hex_encode (user, -1);
          ret = g_str_equal (encoded, subject);
          free (encoded);

          /* domain users are often case insensitive, while NSS/Linux converts them to the canonical lower-case form;
           * accept the lower-case form of the creds user as well */
          if (!ret)
            {
              gchar *user_lower = g_ascii_strdown (user, -1);
              encoded = cockpit_hex_encode (user_lower, -1);
              free (user_lower);
              ret = g_str_equal (encoded, subject);
              free (encoded);
            }
        }
    }

out:
  free (subject);
  return ret;
}

static gboolean
process_transport_authorize (CockpitWebService *self,
                             CockpitTransport *transport,
                             JsonObject *options)
{
  const gchar *cookie = NULL;
  GBytes *payload;
  char *type = NULL;
  char *alloc = NULL;
  const char *response = NULL;
  const gchar *challenge;
  const gchar *password;
  const gchar *host;
  GBytes *data;

  if (!cockpit_json_get_string (options, "challenge", NULL, &challenge) ||
      !cockpit_json_get_string (options, "cookie", NULL, &cookie) ||
      !cockpit_json_get_string (options, "host", NULL, &host))
    {
      g_warning ("received invalid authorize command");
      return FALSE;
    }

  if (!challenge || !cookie)
    {
      g_message ("unsupported or unknown authorize command");
      return FALSE;
    }

  if (!cockpit_authorize_type (challenge, &type))
    {
      g_message ("received invalid authorize challenge command");
    }
  else if (g_str_equal (type, "plain1") ||
           g_str_equal (type, "crypt1") ||
           g_str_equal (type, "basic"))
    {
      data = cockpit_creds_get_password (self->creds);
      if (!data)
        {
          g_info ("%s: received \"authorize\" %s \"challenge\", but no password", host, type);
        }
      else if (!g_str_equal ("basic", type) && !authorize_check_user (self->creds, challenge))
        {
          g_info ("received \"authorize\" %s \"challenge\", but for wrong user", type);
        }
      else
        {
          password = g_bytes_get_data (data, NULL);
          if (g_str_equal (type, "crypt1"))
            {
              alloc = cockpit_compat_reply_crypt1 (challenge, password);
              if (alloc)
                response = alloc;
              else
                g_message ("failed to \"authorize\" crypt1 \"challenge\"");
            }
          else if (g_str_equal (type, "basic"))
            {
              alloc = cockpit_authorize_build_basic (cockpit_creds_get_user (self->creds), password);
              response = alloc;
            }
          else
            {
              response = password;
            }
        }
    }

  if (cookie && !self->sent_done)
    {
      payload = cockpit_transport_build_control ("command", "authorize",
                                                 "cookie", cookie,
                                                 "response", response ? response : "",
                                                 "host", host,
                                                 NULL);
      cockpit_transport_send (transport, NULL, payload);
      g_bytes_unref (payload);
    }

  free (type);
  free (alloc);
  return TRUE;
}

static gboolean
poison_creds (gpointer user_data)
{
  CockpitWebService *self = user_data;
  cockpit_creds_poison (self->creds);
  self->credentials_timeout = 0;
  return G_SOURCE_REMOVE;
}

static const gchar *
process_transport_init (CockpitWebService *self,
                        CockpitTransport *transport,
                        JsonObject *options)
{
  JsonObject *object;
  JsonObject *capabilities;
  gboolean explicit_superuser_capability = FALSE;
  GBytes *payload;
  gint64 version;

  if (!cockpit_json_get_int (options, "version", -1, &version))
    {
      g_warning ("invalid version field in init message");
      return "protocol-error";
    }

  if (version == 1)
    {
      g_debug ("received init message");
      if (self->init_received)
        json_object_unref (self->init_received);
      self->init_received = json_object_ref (options);

      if (cockpit_json_get_object (options, "capabilities", NULL, &capabilities) && capabilities)
        {
          if (!cockpit_json_get_bool (capabilities, "explicit-superuser", FALSE, &explicit_superuser_capability))
            g_warning ("invalued 'explicit-superuser' value in init message");
        }

      /* If the bridge has the explicit-superuser capability, it will
         send a "superuser-init-done" message once any authorization
         is over.  We will poisen our credentials at that time.

         For a bridge without the explicit-superuser capability, we
         keep the credentials for two minutes after receiving an
         "init" message.
      */

      self->credentials_timeout = g_timeout_add (2*60*1000, poison_creds, self);

      /* Always send an init message down the new transport */
      object = cockpit_transport_build_json ("command", "init", NULL);
      json_object_set_int_member (object, "version", 1);
      json_object_set_string_member (object, "host", "localhost");

      if (explicit_superuser_capability)
        {
          const gchar *superuser = getenv("COCKPIT_SUPERUSER") ?: cockpit_creds_get_superuser (self->creds);
          if (superuser && *superuser && !g_str_equal (superuser, "none"))
            {
              JsonObject *superuser_options;

              superuser_options = json_object_new ();
              json_object_set_string_member (superuser_options, "id", superuser);
              json_object_set_object_member (object, "superuser", superuser_options);
            }
          else
            {
              json_object_set_boolean_member (object, "superuser", FALSE);
              cockpit_creds_poison (self->creds);
            }
        }

      payload = cockpit_json_write_bytes (object);
      json_object_unref (object);
      cockpit_transport_send (transport, NULL, payload);
      g_bytes_unref (payload);
    }
  else
    {
      g_message ("unsupported version of cockpit protocol: %" G_GINT64_FORMAT, version);
      return "not-supported";
    }

  return NULL;
}

static gboolean
on_transport_control (CockpitTransport *transport,
                      const gchar *command,
                      const gchar *channel,
                      JsonObject *options,
                      GBytes *payload,
                      gpointer user_data)
{
  const gchar *problem = "protocol-error";
  CockpitWebService *self = user_data;
  CockpitSocket *socket = NULL;
  gboolean valid = FALSE;
  gboolean forward;

  if (!channel)
    {
      if (g_strcmp0 (command, "init") == 0)
        {
          problem = process_transport_init (self, transport, options);
          valid = (problem == NULL);
        }
      else if (!self->init_received)
        {
          g_message ("bridge did not send 'init' message first");
          valid = FALSE;
        }
      else if (g_strcmp0 (command, "authorize") == 0)
        {
          valid = process_transport_authorize (self, transport, options);
        }
      else if (g_strcmp0 (command, "superuser-init-done") == 0)
        {
          cockpit_creds_poison (self->creds);
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

      if (g_strcmp0 (command, "close") == 0)
        {
          valid = process_close (self, socket, channel);
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
on_transport_recv (CockpitTransport *transport,
                   const gchar *channel,
                   GBytes *payload,
                   gpointer user_data)
{
  CockpitWebService *self = user_data;
  WebSocketDataType data_type;
  CockpitSocket *socket;
  gchar *string;
  GBytes *prefix;

  if (!channel)
    return FALSE;

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
on_transport_closed (CockpitTransport *transport,
                     const gchar *problem,
                     gpointer user_data)
{
  CockpitWebService *self = user_data;

  /* Close all sockets */
  cockpit_sockets_close (&self->sockets, problem);

  /* Dispose web service */
  g_object_run_dispose (G_OBJECT (self));
}

gboolean
cockpit_web_service_parse_binary (JsonObject *options,
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

gboolean
cockpit_web_service_parse_external (JsonObject *options,
                                    const gchar **content_type,
                                    const gchar **content_encoding,
                                    const gchar **content_disposition,
                                    const gchar ***protocols)
{
  JsonObject *external;
  const gchar *value;
  JsonNode *node;

  g_return_val_if_fail (options != NULL, FALSE);

  if (!cockpit_json_get_string (options, "channel", NULL, &value) || value != NULL)
    {
      g_message ("don't specify \"channel\" on external channel");
      return FALSE;
    }
  if (!cockpit_json_get_string (options, "command", NULL, &value) || value != NULL)
    {
      g_message ("don't specify \"command\" on external channel");
      return FALSE;
    }

  node = json_object_get_member (options, "external");
  if (node == NULL)
    {
      if (content_disposition)
        *content_disposition = NULL;
      if (content_type)
        *content_type = NULL;
      if (content_encoding)
        *content_encoding = NULL;
      if (protocols)
        *protocols = NULL;
      return TRUE;
    }

  if (!JSON_NODE_HOLDS_OBJECT (node))
    {
      g_message ("invalid \"external\" option");
      return FALSE;
    }

  external = json_node_get_object (node);

  if (!cockpit_json_get_string (external, "content-disposition", NULL, &value) ||
      (value && !cockpit_web_response_is_header_value (value)))
    {
      g_message ("invalid \"content-disposition\" external option");
      return FALSE;
    }
  if (content_disposition)
    *content_disposition = value;

  if (!cockpit_json_get_string (external, "content-type", NULL, &value) ||
      (value && !cockpit_web_response_is_header_value (value)))
    {
      g_message ("invalid \"content-type\" external option");
      return FALSE;
    }
  if (content_type)
    *content_type = value;

  if (!cockpit_json_get_string (external, "content-encoding", NULL, &value) ||
      (value && !cockpit_web_response_is_header_value (value)))
    {
      g_message ("invalid \"content-encoding\" external option");
      return FALSE;
    }
  if (content_encoding)
    *content_encoding = value;

  if (!cockpit_json_get_strv (external, "protocols", NULL, protocols))
    {
      g_message ("invalid \"protocols\" external option");
      return FALSE;
    }

  return TRUE;
}

static gboolean
process_and_relay_open (CockpitWebService *self,
                        CockpitSocket *socket,
                        const gchar *channel,
                        JsonObject *options)
{
  WebSocketDataType data_type = WEB_SOCKET_DATA_TEXT;
  GBytes *payload;

  if (self->closing)
    {
      g_debug ("Ignoring open command while web socket is closing");
      return TRUE;
    }

  if (channel == NULL)
    {
      g_warning ("open command is missing the 'channel' field");
      return FALSE;
    }

  if (cockpit_socket_lookup_by_channel (&self->sockets, channel))
    {
      g_warning ("cannot open a channel %s with the same id as another channel", channel);
      return FALSE;
    }

  if (!cockpit_web_service_parse_binary (options, &data_type))
    return FALSE;

  if (socket)
    cockpit_socket_add_channel (&self->sockets, socket, channel, data_type);

  if (!self->sent_done)
    {
      payload = cockpit_json_write_bytes (options);
      cockpit_transport_send (self->transport, NULL, payload);
      g_bytes_unref (payload);
    }

  return TRUE;
}

static void
process_logout (CockpitWebService *self,
                JsonObject *options)
{
  /* Makes the credentials unusable */
  cockpit_creds_poison (self->creds);

  /* Destroys our web service, disconnects everything */
  g_info ("Logging out session %s", self->id);
  g_object_run_dispose (G_OBJECT (self));
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
      if (socket->init_received)
        json_object_unref (socket->init_received);
      socket->init_received = json_object_ref (options);
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
      payload = cockpit_transport_build_control ("command", "close", "problem", problem, NULL);
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
  else if (g_strcmp0 (command, "authorize") == 0)
    {
      valid = process_socket_authorize (self, socket, channel, options, payload);
    }
  else if (g_strcmp0 (command, "logout") == 0)
    {
      process_logout (self, options);
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
      valid = process_kill (self, socket, options, payload);
    }
  else if (!channel && g_strcmp0 (command, "ping") == 0)
    {
      valid = process_ping (self, socket, options);
    }
  else if (channel)
    {
      /* Relay anything with a channel by default */
      if (!self->sent_done)
        cockpit_transport_send (self->transport, NULL, payload);
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
  CockpitSocket *socket;
  g_autofree gchar *channel = NULL;

  socket = cockpit_socket_lookup_by_connection (&self->sockets, connection);
  g_return_if_fail (socket != NULL);

  g_autoptr(GBytes) payload = cockpit_transport_parse_frame (message, &channel);
  if (!payload)
    return;

  /* A control channel command */
  if (!channel)
    dispatch_inbound_command (self, socket, payload);

  /* An actual payload message */
  else if (!self->closing)
    {
      if (!self->sent_done)
        cockpit_transport_send (self->transport, channel, payload);
    }
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

  if (cockpit_creds_get_rhost (self->creds))
    g_info ("New connection to session %s from %s", self->id, cockpit_creds_get_rhost (self->creds));
  else
    g_info ("New connection to session %s", self->id);

  socket = cockpit_socket_lookup_by_connection (&self->sockets, connection);
  g_return_if_fail (socket != NULL);

  object = json_object_new ();
  json_object_set_string_member (object, "command", "init");
  json_object_set_int_member (object, "version", 1);
  json_object_set_string_member (object, "channel-seed", socket->id);
  json_object_set_string_member (object, "host", "localhost");
  json_object_set_string_member (object, "csrf-token", cockpit_creds_get_csrf_token (self->creds));

  capabilities = json_array_new ();
  json_array_add_string_element (capabilities, "multi");
  json_array_add_string_element (capabilities, "credentials");
  json_array_add_string_element (capabilities, "binary");
  json_object_set_array_member (object, "capabilities", capabilities);

  info = json_object_new ();
  json_object_set_string_member (info, "version", PACKAGE_VERSION);
  json_object_set_object_member (object, "system", info);

  command = cockpit_json_write_bytes (object);
  json_object_unref (object);

  web_socket_connection_send (connection, WEB_SOCKET_DATA_TEXT, self->control_prefix, command);
  g_bytes_unref (command);

  g_signal_connect (connection, "message",
                    G_CALLBACK (on_web_socket_message), self);
}

static gboolean
on_web_socket_closing (WebSocketConnection *connection,
                       CockpitWebService *self)
{
  CockpitSocket *socket;
  GHashTable *snapshot;
  GHashTableIter iter;
  const gchar *channel;
  GBytes *payload;

  g_debug ("web socket closing");

  if (self->sent_done)
    return TRUE;

  /* Close any channels that were opened by this web socket */
  snapshot = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, NULL);
  socket = cockpit_socket_lookup_by_connection (&self->sockets, connection);
  if (socket)
    {
      g_hash_table_iter_init (&iter, socket->channels);
      while (g_hash_table_iter_next (&iter, (gpointer *)&channel, NULL))
        {
          g_hash_table_add (snapshot, g_strdup (channel));
        }
    }

  g_hash_table_iter_init (&iter, snapshot);
  while (g_hash_table_iter_next (&iter, (gpointer *)&channel, NULL))
    {
      payload = cockpit_transport_build_control ("command", "close",
                                                 "channel", channel,
                                                 "problem", "disconnected",
                                                 NULL);
      cockpit_transport_send (self->transport, NULL, payload);
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

  if (cockpit_creds_get_rhost (self->creds))
    g_info ("Connection from %s to session %s closed", cockpit_creds_get_rhost (self->creds), self->id);
  else
    g_info ("Connection to session %s closed", self->id);

  g_signal_handlers_disconnect_by_func (connection, on_web_socket_open, self);
  g_signal_handlers_disconnect_by_func (connection, on_web_socket_closing, self);
  g_signal_handlers_disconnect_by_func (connection, on_web_socket_close, self);

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

  payload = cockpit_transport_build_control ("command", "ping", NULL);

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
  cockpit_sockets_init (&self->sockets);
  self->ping_timeout = g_timeout_add_seconds (cockpit_ws_ping_interval, on_ping_time, self);
  self->host_by_checksum = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, g_free);
  self->checksum_by_host = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, g_free);
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
 * @transport: an new cockpit transport that has not yet
 * sent an init message.
 *
 * Creates a new web service to serve web sockets and pass
 * messages to the given bridge.
 *
 * Returns: (transfer full): the new web service
 */
CockpitWebService *
cockpit_web_service_new (CockpitCreds *creds,
                         CockpitTransport *transport)
{
  CockpitWebService *self;

  g_return_val_if_fail (creds != NULL, NULL);
  g_return_val_if_fail (transport != NULL, NULL);

  self = g_object_new (COCKPIT_TYPE_WEB_SERVICE, NULL);
  self->creds = cockpit_creds_ref (creds);
  self->transport = g_object_ref (transport);

  self->control_sig = g_signal_connect_after (self->transport, "control", G_CALLBACK (on_transport_control), self);
  self->recv_sig = g_signal_connect_after (self->transport, "recv", G_CALLBACK (on_transport_recv), self);
  self->closed_sig = g_signal_connect_after (self->transport, "closed", G_CALLBACK (on_transport_closed), self);

  return self;
}

WebSocketConnection *
cockpit_web_service_create_socket (const gchar **protocols,
                                   CockpitWebRequest *request)
{
  WebSocketConnection *connection;
  const gchar * const *origins;
  gchar *allocated = NULL;
  gchar *origin = NULL;
  gchar *defaults[2];
  gboolean is_https;
  gchar *url;

  const gchar *host = cockpit_web_request_get_host (request);
  const gchar *protocol = cockpit_web_request_get_protocol (request);
  g_debug("cockpit_web_service_create_socket: host %s, protocol %s", host, protocol);
  is_https = g_str_equal (protocol, "https") == 0;

  url = g_strdup_printf ("%s://%s%s",
                         is_https ? "wss" : "ws",
                         host ? host : "localhost",
                         cockpit_web_request_get_path (request));

  origins = cockpit_conf_strv ("WebService", "Origins", ' ');
  if (origins == NULL)
    {
      origin = g_strdup_printf ("%s://%s", protocol, host);
      defaults[0] = origin;
      defaults[1] = NULL;
      origins = (const gchar **)defaults;
    }

  connection = web_socket_server_new_for_stream (url, origins, protocols,
                                                 cockpit_web_request_get_io_stream (request),
                                                 cockpit_web_request_get_headers (request),
                                                 cockpit_web_request_get_buffer (request));
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
 * @for_tls_proxy: Assume that the Browser is making TLS connections that are terminated
 *                 in a reverse proxy in front of cockpit-ws
 *
 * Serves the WebSocket on the given web service. Holds an extra
 * reference to the web service until the socket is closed.
 */
void
cockpit_web_service_socket (CockpitWebService *self,
                            CockpitWebRequest *request)
{
  const gchar *protocols[] = { "cockpit1", NULL };
  WebSocketConnection *connection;

  connection = cockpit_web_service_create_socket (protocols, request);

  g_signal_connect (connection, "open", G_CALLBACK (on_web_socket_open), self);
  g_signal_connect (connection, "closing", G_CALLBACK (on_web_socket_closing), self);
  g_signal_connect (connection, "close", G_CALLBACK (on_web_socket_close), self);

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
 * cockpit_web_service_get_id:
 * @self: the service
 *
 * Returns: The id of this service, for logging.
 */
const gchar *
cockpit_web_service_get_id (CockpitWebService *self)
{
  g_return_val_if_fail (COCKPIT_IS_WEB_SERVICE (self), NULL);
  return self->id;
}

/**
 * cockpit_web_service_set_id:
 * @self: the service
 * @id: the id
 */
void
cockpit_web_service_set_id (CockpitWebService *self,
                            const gchar *id)
{
  g_return_if_fail (COCKPIT_IS_WEB_SERVICE (self));
  if (!self->id)
    self->id = g_strdup (id);
}

/**
 * cockpit_web_service_disconnect:
 * @self: the service
 *
 * Close all sockets that are running in this web
 * service.
 */
void
cockpit_web_service_disconnect (CockpitWebService *self)
{
  g_object_run_dispose (G_OBJECT (self));
}

gboolean
cockpit_web_service_get_idling (CockpitWebService *self)
{
  g_return_val_if_fail (COCKPIT_IS_WEB_SERVICE (self), TRUE);
  return (self->callers == 0);
}

CockpitTransport *
cockpit_web_service_get_transport (CockpitWebService *self)
{
  g_return_val_if_fail (COCKPIT_IS_WEB_SERVICE (self), NULL);
  return self->transport;
}

JsonObject *
cockpit_web_service_get_init (CockpitWebService *self)
{
  g_return_val_if_fail (COCKPIT_IS_WEB_SERVICE (self), NULL);
  return self->init_received;
}

const gchar *
cockpit_web_service_get_host (CockpitWebService *self,
                              const gchar *checksum)
{
  return g_hash_table_lookup (self->host_by_checksum, checksum);
}

const gchar *
cockpit_web_service_get_checksum (CockpitWebService *self,
                                  const gchar *host)
{
  return g_hash_table_lookup (self->checksum_by_host, host);
}

void
cockpit_web_service_set_host_checksum (CockpitWebService *self,
                                       const gchar *host,
                                       const gchar *checksum)
{
  const gchar *old_checksum = g_hash_table_lookup (self->checksum_by_host, host);
  const gchar *old_host = g_hash_table_lookup (self->host_by_checksum, checksum);

  if (g_strcmp0 (checksum, old_checksum) == 0)
    return;

  if (old_checksum)
    g_hash_table_remove (self->host_by_checksum, old_checksum);

  /* Only replace checksum if the old one wasn't localhost */
  if (g_strcmp0 (old_host, "localhost") != 0)
    g_hash_table_replace (self->host_by_checksum, g_strdup (checksum), g_strdup (host));

  g_hash_table_replace (self->checksum_by_host, g_strdup (host), g_strdup (checksum));
}
