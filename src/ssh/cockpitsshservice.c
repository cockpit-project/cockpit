/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
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

#include "common/cockpitjson.h"
#include "common/cockpitlog.h"
#include "common/cockpitmemory.h"

#include "cockpitsshtransport.h"
#include "cockpitsshservice.h"

#include <stdlib.h>

/* Some tunables that can be set from tests */
gint cockpit_ssh_specific_port = 0;

gint cockpit_ssh_session_timeout = 30;

const gchar *cockpit_ssh_known_hosts = NULL;
const gchar *cockpit_ssh_bridge_program = NULL;
/* ----------------------------------------------------------------------------
 * CockpitSession
 */

typedef struct
{
  gchar *host;

  gboolean private;
  GHashTable *channels;
  GHashTable *authorizes;
  CockpitTransport *transport;
  gboolean sent_done;
  guint timeout;

  gboolean init_received;
  gulong control_sig;
  gulong recv_sig;
  gulong closed_sig;

  /* Until we get an "init" message we don't send stuff with channels */
  GQueue *frozen;
  gint thawing;

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

  if (session->frozen)
    g_queue_free_full (session->frozen, g_free);
  if (session->timeout)
    g_source_remove (session->timeout);
  g_hash_table_unref (session->channels);
  g_hash_table_unref (session->authorizes);
  if (session->control_sig)
    g_signal_handler_disconnect (session->transport, session->control_sig);
  if (session->recv_sig)
    g_signal_handler_disconnect (session->transport, session->recv_sig);
  if (session->closed_sig)
    g_signal_handler_disconnect (session->transport, session->closed_sig);
  g_object_unref (session->transport);

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

  /*
   * Close sessions that are no longer in use after N seconds
   * of them being that way. Private sessions obviously get closed
   * right away.
   */
  if (g_hash_table_size (session->channels) == 0)
    {
      if (session->private)
        {
          g_debug ("%s: private session had its channel %s close", session->host, channel);
          cockpit_transport_close (session->transport, "done");
        }
      else
        {
          g_debug ("%s: removed last channel %s for session", session->host, channel);
          session->timeout = g_timeout_add_seconds (cockpit_ssh_session_timeout,
                                                    on_timeout_cleanup_session, session);
        }
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
  CockpitSession *cur = NULL;
  gchar *chan;

  cur = cockpit_session_by_channel (sessions, channel);
  if (cur && cur == session)
    return;

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
                       CockpitTransport *transport)
{
  CockpitSession *session;

  g_debug ("%s: new session", host);

  session = g_new0 (CockpitSession, 1);
  session->channels = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, NULL);
  session->authorizes = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, NULL);
  session->transport = g_object_ref (transport);
  session->host = g_strdup (host);
  session->private = private;

  if (!private)
    g_hash_table_insert (sessions->by_host, session->host, session);

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

  g_debug ("%s: destroy session", session->host);

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

struct _CockpitSshService {
  GObject parent;

  CockpitSessions sessions;
  CockpitTransport *transport;

  gulong control_sig;
  gulong recv_sig;
  gulong closed_sig;

  const gchar *command;
  const gchar *username;
  gboolean init_received;
};

typedef struct {
  GObjectClass parent;
} CockpitSshServiceClass;

G_DEFINE_TYPE (CockpitSshService, cockpit_ssh_service, G_TYPE_OBJECT);

enum {
  PROP_0,
  PROP_TRANSPORT,
};

static void
cockpit_ssh_service_transport_close (CockpitSshService *self,
                                     const gchar *problem)
{
  if (!self->transport)
    return;

  if (self->control_sig)
    g_signal_handler_disconnect (self->transport, self->control_sig);
  if (self->recv_sig)
    g_signal_handler_disconnect (self->transport, self->recv_sig);
  if (self->closed_sig)
    g_signal_handler_disconnect (self->transport, self->closed_sig);

  cockpit_transport_close (self->transport, problem);
  g_object_unref (self->transport);
  self->transport = NULL;
}

static void
cockpit_ssh_service_dispose (GObject *object)
{
  CockpitSshService *self = COCKPIT_SSH_SERVICE (object);
  CockpitSession *session;
  GHashTableIter iter;

  g_hash_table_iter_init (&iter, self->sessions.by_transport);
  while (g_hash_table_iter_next (&iter, NULL, (gpointer *)&session))
    {
      if (!session->sent_done)
        {
          session->sent_done = TRUE;
          cockpit_transport_close (session->transport, NULL);
        }
    }

  if (self->transport)
    cockpit_ssh_service_transport_close (self, NULL);

  G_OBJECT_CLASS (cockpit_ssh_service_parent_class)->dispose (object);
}

static void
cockpit_ssh_service_finalize (GObject *object)
{
  CockpitSshService *self = COCKPIT_SSH_SERVICE (object);

  cockpit_sessions_cleanup (&self->sessions);
  G_OBJECT_CLASS (cockpit_ssh_service_parent_class)->finalize (object);
}

static void
outbound_protocol_error (CockpitSshService *self,
                         CockpitTransport *transport,
                         const gchar *problem)
{
  if (problem == NULL)
    problem = "protocol-error";

  cockpit_transport_close (transport, problem);
}

static gboolean
relay_control_message (CockpitSshService *self,
                       CockpitSession *session,
                       const gchar *channel,
                       GBytes *payload)
{
  if (!session->init_received)
    {
      if (!session->frozen)
        session->frozen = g_queue_new ();
      g_queue_push_tail (session->frozen, g_strdup (channel));
      cockpit_transport_freeze (self->transport, channel);
      cockpit_transport_emit_recv (self->transport, NULL, payload);
      return FALSE;
    }
  else if (!session->sent_done)
    {
      cockpit_transport_send (session->transport, NULL, payload);
    }

  /* Even if we drop it on the floor */
  return TRUE;
}

static gboolean
process_and_relay_close (CockpitSshService *self,
                         const gchar *channel,
                         GBytes *payload)
{
  CockpitSession *session;
  session = cockpit_session_by_channel (&self->sessions, channel);
  if (session)
    {
      if (relay_control_message (self, session, channel, payload))
        cockpit_session_remove_channel (&self->sessions, session, channel);
    }

  return TRUE;
}

static gboolean
process_kill (CockpitSshService *self,
              JsonObject *options,
              GBytes *payload)
{
  CockpitSession *session;
  const gchar *host;

  if (!cockpit_json_get_string (options, "host", NULL, &host))
    {
      g_warning ("received invalid kill command");
      return FALSE;
    }

  if (host)
    {
      session = cockpit_session_by_host (&self->sessions, host);
      cockpit_transport_close (session->transport, "terminated");
    }
  else
    {
      g_warning ("received invalid kill command for cockpit-ssh");
    }
  return TRUE;
}

static const gchar *
process_session_init (CockpitSshService *self,
                      CockpitSession *session,
                      JsonObject *options)
{
  const gchar *checksum;
  JsonObject *object;
  GBytes *command;
  gint64 version;
  GQueue *frozen;
  GList *l;

  if (!cockpit_json_get_int (options, "version", -1, &version))
    {
      g_warning ("invalid version field in init message");
      return "protocol-error";
    }

  if (version == 1)
    {
      g_debug ("%s: received init message", session->host);
      session->init_received = TRUE;
      g_object_set_data_full (G_OBJECT (session->transport), "init",
                              json_object_ref (options),
                              (GDestroyNotify) json_object_unref);
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

  /* Always send an init message down the new transport */
  object = cockpit_transport_build_json ("command", "init", NULL);
  json_object_set_int_member (object, "version", 1);
  json_object_set_string_member (object, "host", session->host);
  command = cockpit_json_write_bytes (object);
  json_object_unref (object);
  cockpit_transport_send (session->transport, NULL, command);
  g_bytes_unref (command);

  if (session->frozen)
    {
      frozen = session->frozen;
      session->frozen = NULL;
      session->thawing++;
      for (l = frozen->head; l != NULL; l = g_list_next (l))
        {
          cockpit_transport_thaw (self->transport, l->data);
        }
      g_queue_free_full (frozen, g_free);
      session->frozen = NULL;
      session->thawing--;
    }

  return NULL;
}

static gboolean
process_session_authorize (CockpitSshService *self,
                           CockpitSession *session,
                           JsonObject *options,
                           GBytes *payload)
{
  const gchar *cookie;

  /* Authorize messages get forwarded even without an "init" */
  if (!cockpit_json_get_string (options, "cookie", NULL, &cookie) || cookie == NULL)
    {
      g_message ("%s: received \"authorize\" request without a valid cookie", session->host);
    }
  else
    {
      /* Note that we don't wait for "init" or freeze these */
      g_hash_table_add (session->authorizes, g_strdup (cookie));
    }

  return TRUE;
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
  CockpitSshService *self = user_data;
  CockpitSession *session = NULL;
  gboolean valid = FALSE;
  gboolean forward = FALSE;

  if (!channel)
    {
      session = cockpit_session_by_transport (&self->sessions, transport);
      if (!session)
        {
          g_critical ("received control command for transport that isn't present");
          valid = FALSE;
        }
      else if (g_strcmp0 (command, "authorize") == 0)
        {
          forward = valid = process_session_authorize (self, session, options, payload);
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
          cockpit_session_remove_channel (&self->sessions, session, channel);
          valid = TRUE;
        }
      else
        {
          valid = TRUE;
        }

    }

  if (!valid)
    outbound_protocol_error (self, transport, problem);
  else if (forward && self->transport)
    cockpit_transport_send (self->transport, NULL, payload);

  return TRUE; /* handled */
}

static gboolean
on_session_recv (CockpitTransport *transport,
                 const gchar *channel,
                 GBytes *payload,
                 gpointer user_data)
{
  CockpitSshService *self = user_data;
  CockpitSession *session;

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

  /* Forward the message */
  if (self->transport)
    {
      cockpit_transport_send (self->transport, channel, payload);
      return TRUE;
    }
  return FALSE;
}

static void
on_session_closed (CockpitTransport *transport,
                   const gchar *problem,
                   gpointer user_data)
{
  CockpitSshService *self = user_data;
  const gchar *channel = NULL;
  CockpitSession *session;
  CockpitSshTransport *ssh = NULL;
  GHashTableIter iter;
  const gchar *key = NULL;
  const gchar *fp = NULL;
  GBytes *payload;
  JsonObject *object = NULL;

  JsonObject *auth_json = NULL; // owned by ssh transport

  session = cockpit_session_by_transport (&self->sessions, transport);
  if (session != NULL)
    {
      ssh = COCKPIT_SSH_TRANSPORT (transport);
      auth_json = cockpit_ssh_transport_get_auth_method_results (ssh);

      if ((g_strcmp0 (problem, "unknown-hostkey") == 0 ||
           g_strcmp0 (problem, "invalid-hostkey") == 0))
        {
          key = cockpit_ssh_transport_get_host_key (ssh);
          fp = cockpit_ssh_transport_get_host_fingerprint (ssh);
        }

      g_hash_table_iter_init (&iter, session->channels);
      while (g_hash_table_iter_next (&iter, (gpointer *)&channel, NULL))
        {
          object = cockpit_transport_build_json ("command", "close",
                                                 "channel", channel,
                                                 "problem", problem,
                                                 "host-key", key,
                                                 "host-fingerprint", fp,
                                                 NULL);

          if (auth_json != NULL)
            {
               /* take a ref so we can resue when closing multiple channels */
               json_object_ref (auth_json);
               json_object_set_object_member (object,
                                              "auth-method-results",
                                              auth_json);
            }

            payload = cockpit_json_write_bytes (object);
            json_object_unref (object);
            cockpit_transport_send (self->transport, NULL, payload);
            g_bytes_unref (payload);
        }

      cockpit_session_destroy (&self->sessions, session);

    }
}


static void
on_transport_closed (CockpitTransport *transport,
                     const gchar *problem,
                     gpointer user_data)
{
  CockpitSshService *self = user_data;
  cockpit_ssh_service_transport_close (self, problem);
}

static gboolean
on_transport_recv (CockpitTransport *transport,
                   const gchar *channel,
                   GBytes *payload,
                   gpointer user_data)
{
  CockpitSshService *self = user_data;
  CockpitSession *session = cockpit_session_by_channel (&self->sessions, channel);
  if (session)
    {
      if (!session->sent_done)
        cockpit_transport_send (session->transport, channel, payload);
    }
  else
    {
      g_debug ("received message for unknown channel %s", channel);
    }

  return TRUE;
}

static const gchar *
process_transport_init (CockpitSshService *self,
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
      g_debug ("received transport init message");
      self->init_received = TRUE;
      return NULL;
    }
  else
    {
      g_message ("received unsupported version of cockpit protocol: %"
                 G_GINT64_FORMAT, version);
      return "not-supported";
    }
}

static void
parse_host (const gchar *host,
            gchar **hostname,
            gchar **username,
            gint *port)
{
  gchar *user_arg = NULL;
  gchar *host_arg = NULL;
  gchar *tmp = NULL;
  gchar *end = NULL;

  guint port_num = cockpit_ssh_specific_port;
  guint64 tmp_num;

  gsize host_offset = 0;
  gsize host_length = strlen (host);

  tmp = strrchr (host, '@');
  if (tmp)
    {
      if (tmp[0] != host[0])
      {
        user_arg = g_strndup (host, tmp - host);
        host_offset = strlen (user_arg) + 1;
        host_length = host_length - host_offset;
      }
      else
        {
          g_message ("ignoring blank user in %s", host);
        }
    }

  tmp = strrchr (host, ':');
  if (tmp)
    {
      tmp_num = g_ascii_strtoull (tmp + 1, &end, 10);
      if (end[0] == '\0' && tmp_num < G_MAXUSHORT)
        {
          port_num = (guint) tmp_num;
          host_length = host_length - strlen (tmp);
        }
      else
        {
          g_message ("ignoring invalid port in %s", host);
        }
    }

  host_arg = g_strndup (host + host_offset, host_length);
  /* Overide hostname for tests */
  if (cockpit_ssh_specific_port != 0 &&
      g_strcmp0 (host_arg, "localhost") == 0)
    {
      *hostname = g_strdup ("127.0.0.1");
    }
  else
    {
      *hostname = g_strdup (host_arg);
    }

  *username = g_strdup (user_arg);
  *port = port_num;

  g_free (host_arg);
  g_free (user_arg);
}

static CockpitSession *
lookup_or_open_session (CockpitSshService *self,
                        JsonObject *options)
{
  CockpitSession *session = NULL;
  CockpitTransport *transport;
  gchar *hostname = NULL;
  gchar *username = NULL;
  gint port;

  const gchar *host_key = NULL;
  const gchar *host = NULL;
  const gchar *sharable = NULL;
  const gchar *password;
  const gchar *specific_user;
  gboolean private = FALSE;

  if (!cockpit_json_get_string (options, "host", "localhost", &host))
    host = "localhost";
  if (host == NULL || g_strcmp0 (host, "") == 0)
    host = "localhost";

  if (!cockpit_json_get_string (options, "password", NULL, &password))
    password = NULL;

  if (cockpit_json_get_string (options, "user", NULL, &specific_user))
    {
      if (g_strcmp0 (specific_user, "") == 0)
        specific_user = NULL;
    }

  if (!cockpit_json_get_string (options, "host-key", NULL, &host_key))
    host_key = NULL;

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
  if (!cockpit_json_get_string (options, "session", NULL, &sharable))
    sharable = NULL;
  if (!sharable)
    {
      /* Fallback to older ways of indicating this */
      if (specific_user || host_key)
        private = TRUE;
      if (private && !cockpit_json_get_bool (options, "temp-session", TRUE, &private))
        private = TRUE;
    }
  else if (g_str_equal (sharable, "private"))
    {
      private = TRUE;
    }

  if (!private)
    session = cockpit_session_by_host (&self->sessions, host);

  if (!session)
    {
      parse_host (host, &hostname, &username, &port);
      if (!specific_user && !username)
        specific_user = self->username;

      /* TODO: BACKWARDS SSH KEY COMPAT? */
      transport = g_object_new (COCKPIT_TYPE_SSH_TRANSPORT,
                                "host", hostname,
                                "port", port,
                                "command", cockpit_ssh_bridge_program,
                                "user", specific_user ? specific_user : username,
                                "password", password,
                                "known-hosts", cockpit_ssh_known_hosts,
                                "host-key", host_key,
                                NULL);

      session = cockpit_session_track (&self->sessions, host, private, transport);
      session->control_sig = g_signal_connect_after (transport, "control", G_CALLBACK (on_session_control), self);
      session->recv_sig = g_signal_connect_after (transport, "recv", G_CALLBACK (on_session_recv), self);
      session->closed_sig = g_signal_connect_after (transport, "closed", G_CALLBACK (on_session_closed), self);

      g_object_unref (transport);

      g_free (hostname);
      g_free (username);
    }

  json_object_remove_member (options, "host");
  json_object_remove_member (options, "user");
  json_object_remove_member (options, "password");
  json_object_remove_member (options, "host-key");
  json_object_remove_member (options, "temp-session");

  return session;
}

static gboolean
process_and_relay_open (CockpitSshService *self,
                        const gchar *channel,
                        JsonObject *options)
{
  CockpitSession *session = NULL;
  GBytes *payload;

  if (!self->transport)
    {
      g_debug ("Ignoring open command while ssh service is closing");
      return TRUE;
    }

  /* During unfreezing we get a replay of channel messages */
  session = cockpit_session_by_channel (&self->sessions, channel);
  if (session && session->thawing == 0)
    {
      g_warning ("cannot open a channel %s with the same id as another channel", channel);
      return FALSE;
    }
  else if (!session)
    {
      session = lookup_or_open_session (self, options);
    }

  payload = cockpit_json_write_bytes (options);
  cockpit_session_add_channel (&self->sessions, session, channel);
  relay_control_message (self, session, channel, payload);
  g_bytes_unref (payload);

  return TRUE;
}

static gboolean
process_transport_authorize (CockpitSshService *service,
                             const gchar *channel,
                             JsonObject *options,
                             GBytes *payload)
{
  CockpitSession *session;
  GHashTableIter iter;
  const gchar *cookie;
  gpointer value;

  if (!cockpit_json_get_string (options, "cookie", NULL, &cookie) || cookie == NULL)
    {
      g_message ("received \"authorize\" reply without a valid cookie");
      return FALSE;
    }
  else
    {
      g_hash_table_iter_init (&iter, service->sessions.by_transport);
      while (g_hash_table_iter_next (&iter, NULL, &value))
        {
          session = value;
          if (g_hash_table_remove (session->authorizes, cookie))
            {
              if (!session->sent_done)
                cockpit_transport_send (session->transport, NULL, payload);
              return TRUE;
            }
        }
    }

  return FALSE;
}


static gboolean
on_transport_control (CockpitTransport *transport,
                      const gchar *command,
                      const gchar *channel,
                      JsonObject *options,
                      GBytes *payload,
                      gpointer user_data)
{
  CockpitSession *session = NULL;
  CockpitSshService *self = user_data;
  const gchar *problem;

  if (g_strcmp0 (command, "init") == 0)
    {
      problem = process_transport_init (self, options);
      if (problem)
        outbound_protocol_error (self, self->transport, problem);
      goto out;
    }

  if (!self->init_received)
    {
      g_message ("did not receive 'init' message first");
      outbound_protocol_error (self, self->transport, "protocol-error");
      goto out;
    }

  if (g_strcmp0 (command, "open") == 0)
    {
      process_and_relay_open (self, channel, options);
    }
  else if (g_strcmp0 (command, "authorize") == 0)
    {
      process_transport_authorize (self, channel, options, payload);
    }
  else if (g_strcmp0 (command, "close") == 0)
    {
      if (channel == NULL)
        {
          g_warning ("got close command without a channel");
        }
      else
        {
          process_and_relay_close (self, channel, payload);
        }
    }
  else if (g_strcmp0 (command, "kill") == 0)
    {
      process_kill (self, options, payload);
    }
  else if (channel)
    {
      /* Relay anything with a channel by default */
      session = cockpit_session_by_channel (&self->sessions, channel);
      if (session)
        relay_control_message (self, session, channel, payload);
      else
        g_debug ("dropping control message with unknown channel %s", channel);
    }

out:
  return TRUE;
}

static void
cockpit_ssh_service_init (CockpitSshService *self)
{
  cockpit_sessions_init (&self->sessions);
}

static void
cockpit_ssh_service_set_property (GObject *obj,
                                  guint prop_id,
                                  const GValue *value,
                                  GParamSpec *pspec)
{
  CockpitSshService *self = COCKPIT_SSH_SERVICE (obj);

  switch (prop_id)
    {
    case PROP_TRANSPORT:
      self->transport = g_value_dup_object (value);
      break;
    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (obj, prop_id, pspec);
      break;
    }
}

static void
cockpit_ssh_service_constructed (GObject *object)
{
  CockpitSshService *self = COCKPIT_SSH_SERVICE (object);
  JsonObject *json = NULL;
  GBytes *bytes = NULL;

  G_OBJECT_CLASS (cockpit_ssh_service_parent_class)->constructed (object);

  self->username = g_get_user_name ();
  self->control_sig = g_signal_connect_after (self->transport, "control", G_CALLBACK (on_transport_control), self);
  self->recv_sig = g_signal_connect_after (self->transport, "recv", G_CALLBACK (on_transport_recv), self);
  self->closed_sig = g_signal_connect_after (self->transport, "closed", G_CALLBACK (on_transport_closed), self);

  json = json_object_new ();
  json_object_set_string_member (json, "command", "init");
  json_object_set_int_member (json, "version", 1);

  bytes = cockpit_json_write_bytes (json);
  json_object_unref (json);
  cockpit_transport_send (self->transport, NULL, bytes);
  g_bytes_unref (bytes);
}

static void
cockpit_ssh_service_class_init (CockpitSshServiceClass *klass)
{
  GObjectClass *object_class = G_OBJECT_CLASS (klass);
  object_class->dispose = cockpit_ssh_service_dispose;
  object_class->finalize = cockpit_ssh_service_finalize;
  object_class->constructed = cockpit_ssh_service_constructed;
  object_class->set_property = cockpit_ssh_service_set_property;


  g_object_class_install_property (object_class, PROP_TRANSPORT,
                                   g_param_spec_object ("transport", "transport", "transport",
                                                        COCKPIT_TYPE_TRANSPORT,
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY |
                                                        G_PARAM_STATIC_STRINGS));
}

CockpitSshService *
cockpit_ssh_service_new (CockpitTransport *transport)
{
  CockpitSshService *self = NULL;
  g_return_val_if_fail (transport != NULL, NULL);

  self = g_object_new (COCKPIT_TYPE_SSH_SERVICE, "transport", transport, NULL);
  return self;
}
