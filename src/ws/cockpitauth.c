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

#include "cockpitauth.h"

#include "cockpitws.h"

#include "websocket/websocket.h"

#include "common/cockpitauthorize.h"
#include "common/cockpitconf.h"
#include "common/cockpiterror.h"
#include "common/cockpithex.h"
#include "common/cockpitlog.h"
#include "common/cockpitjson.h"
#include "common/cockpitmemory.h"
#include "common/cockpitpipe.h"
#include "common/cockpitpipetransport.h"
#include "common/cockpitsystem.h"
#include "common/cockpitunixfd.h"
#include "common/cockpitwebserver.h"

#include <security/pam_appl.h>

#include <sys/socket.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <errno.h>

#define ACTION_SSH "remote-login-ssh"
#define ACTION_NONE "none"

/* Some tunables that can be set from tests */
const gchar *cockpit_ws_session_program =
    PACKAGE_LIBEXEC_DIR "/cockpit-session";

const gchar *cockpit_ws_ssh_program =
    PACKAGE_LIBEXEC_DIR "/cockpit-ssh";

/* Timeout of authenticated session when no connections */
guint cockpit_ws_service_idle = 15;

/* Timeout of everything when noone is connected */
guint cockpit_ws_process_idle = 90;

/* The amount of time a spawned process has to complete authentication */
guint cockpit_ws_auth_process_timeout = 30;
guint cockpit_ws_auth_response_timeout = 60;

/* Maximum number of pending authentication requests */
const gchar *cockpit_ws_max_startups = NULL;

static guint max_startups = 10;

static guint sig__idling = 0;

/* Tristate tracking whether gssapi works properly */
static gint gssapi_available = -1;

G_DEFINE_TYPE (CockpitAuth, cockpit_auth, G_TYPE_OBJECT)

typedef struct {
  gint refs;
  gchar *name;

  gchar *cookie;
  CockpitAuth *auth;

  CockpitWebService *service;
  gboolean initialized;
  guint timeout_tag;
  gulong idling_sig;
  gulong destroy_sig;

  /* Used during authentication */
  CockpitTransport *transport;
  gulong control_sig;
  gulong close_sig;

  guint client_timeout;
  guint authorize_timeout;

  /* An open /login request from client */
  GSimpleAsyncResult *result;

  /* An authorization header from client */
  gchar *authorization;

  /* An authorize challenge from session */
  JsonObject *authorize;

  /* The conversation in progress */
  gchar *conversation;
} CockpitSession;

static void
cockpit_session_reset (gpointer data)
{
  CockpitSession *session = data;
  GSimpleAsyncResult *result;
  char *conversation;
  CockpitAuth *self;
  char *cookie;

  if (session->result)
    {
      result = session->result;
      session->result = NULL;
      g_simple_async_result_complete (result);
      g_object_unref (result);
    }

  if (session->authorization)
    {
      cockpit_memory_clear (session->authorization, -1);
      g_free (session->authorization);
      session->authorization = NULL;
    }

  conversation = session->conversation;
  session->conversation = NULL;
  cookie = session->cookie;
  session->cookie = NULL;
  self = session->auth;

  /* No accessing session after this point */

  if (cookie)
    {
      g_hash_table_remove (self->sessions, cookie);
      g_free (cookie);
    }

  if (conversation)
    {
      g_hash_table_remove (self->conversations, conversation);
      g_free (conversation);
    }
}

static CockpitSession *
cockpit_session_ref (CockpitSession *session)
{
  session->refs++;
  return session;
}

static void
on_web_service_gone (gpointer data,
                     GObject *where_the_object_was)
{
  CockpitSession *session = data;
  session->service = NULL;
  cockpit_session_reset (session);
}

static void
cockpit_session_unref (gpointer data)
{
  CockpitSession *session = data;
  CockpitCreds *creds;
  GObject *object;

  session->refs--;
  if (session->refs > 0)
    return;

  cockpit_session_reset (data);

  g_free (session->name);
  g_free (session->cookie);

  if (session->authorize)
    json_object_unref (session->authorize);

  if (session->transport)
    {
      if (session->control_sig)
        g_signal_handler_disconnect (session->transport, session->control_sig);
      if (session->close_sig)
        g_signal_handler_disconnect (session->transport, session->close_sig);
      g_object_unref (session->transport);
    }

  if (session->service)
    {
      creds = cockpit_web_service_get_creds (session->service);
      object = G_OBJECT (session->service);
      session->service = NULL;
      if (creds)
        cockpit_creds_poison (creds);
      if (session->idling_sig)
        g_signal_handler_disconnect (object, session->idling_sig);
      if (session->destroy_sig)
        g_signal_handler_disconnect (object, session->destroy_sig);
      g_object_weak_unref (object, on_web_service_gone, session);
      g_object_run_dispose (object);
      g_object_unref (object);
    }

  if (session->timeout_tag)
    g_source_remove (session->timeout_tag);

  g_free (session);
}

static void
byte_array_clear_and_free (gpointer data)
{
  GByteArray *buffer = data;
  cockpit_memory_clear (buffer->data, buffer->len);
  g_byte_array_free (buffer, TRUE);
}

static void
cockpit_auth_finalize (GObject *object)
{
  CockpitAuth *self = COCKPIT_AUTH (object);
  if (self->timeout_tag)
    g_source_remove (self->timeout_tag);
  g_bytes_unref (self->key);
  g_hash_table_remove_all (self->sessions);
  g_hash_table_remove_all (self->conversations);
  g_hash_table_destroy (self->sessions);
  g_hash_table_destroy (self->conversations);
  G_OBJECT_CLASS (cockpit_auth_parent_class)->finalize (object);
}

static gboolean
on_process_timeout (gpointer data)
{
  CockpitAuth *self = COCKPIT_AUTH (data);

  self->timeout_tag = 0;
  if (g_hash_table_size (self->sessions) == 0)
    {
      g_debug ("auth is idle");
      g_signal_emit (self, sig__idling, 0);
    }

  return FALSE;
}

static void
cockpit_auth_init (CockpitAuth *self)
{
  static const gsize key_len = 128;
  gpointer key;

  key = cockpit_authorize_nonce (key_len);
  if (!key)
    g_error ("couldn't read random key, startup aborted");

  self->key = g_bytes_new_take (key, key_len);

  self->sessions = g_hash_table_new_full (g_str_hash, g_str_equal,
                                          NULL, cockpit_session_unref);

  self->conversations = g_hash_table_new_full (g_str_hash, g_str_equal,
                                               NULL, cockpit_session_unref);

  self->timeout_tag = g_timeout_add_seconds (cockpit_ws_process_idle,
                                             on_process_timeout, self);

  self->startups = 0;
  self->max_startups = max_startups;
  self->max_startups_begin = max_startups;
  self->max_startups_rate = 100;
}

gchar *
cockpit_auth_nonce (CockpitAuth *self)
{
  const guchar *key;
  gsize len;
  guint64 seed;

  seed = self->nonce_seed++;
  key = g_bytes_get_data (self->key, &len);
  return g_compute_hmac_for_data (G_CHECKSUM_SHA256, key, len,
                                  (guchar *)&seed, sizeof (seed));
}

static gchar *
get_remote_address (GIOStream *io)
{
  GSocketAddress *remote = NULL;
  GSocketConnection *connection = NULL;
  GIOStream *base;
  gchar *result = NULL;

  if (G_IS_TLS_CONNECTION (io))
    {
      g_object_get (io, "base-io-stream", &base, NULL);
      if (G_IS_SOCKET_CONNECTION (base))
        connection = g_object_ref (base);
      g_object_unref (base);
    }
  else if (G_IS_SOCKET_CONNECTION (io))
    {
      connection = g_object_ref (io);
    }

  if (connection)
    remote = g_socket_connection_get_remote_address (connection, NULL);
  if (remote && G_IS_INET_SOCKET_ADDRESS (remote))
    result = g_inet_address_to_string (g_inet_socket_address_get_address (G_INET_SOCKET_ADDRESS (remote)));

  if (remote)
    g_object_unref (remote);
  if (connection)
    g_object_unref (connection);

  return result;
}

gchar *
cockpit_auth_steal_authorization (GHashTable *headers,
                                  GIOStream *connection,
                                  gchar **ret_type,
                                  gchar **ret_conversation)
{
  char *type = NULL;
  gchar *ret = NULL;
  gchar *line;
  gpointer key;

  g_assert (headers != NULL);
  g_assert (ret_conversation != NULL);
  g_assert (ret_type != NULL);

  /* Avoid copying as it can contain passwords */
  if (g_hash_table_lookup_extended (headers, "Authorization", &key, (gpointer *)&line))
    {
      g_hash_table_steal (headers, "Authorization");
      g_free (key);
    }
  else
    {
      /*
       * If we don't yet know that Negotiate authentication is possible
       * or not, then we ask our session to try to do Negotiate auth
       * but without any input data.
       */
      if (gssapi_available != 0)
        line = g_strdup ("Negotiate");
      else
        return NULL;
    }

  /* Dig out the authorization type */
  if (!cockpit_authorize_type (line, &type))
    goto out;

  /* If this is a conversation, get that part out too */
  if (g_str_equal (type, "x-conversation"))
    {
      if (!cockpit_authorize_subject (line, ret_conversation))
        goto out;
    }

  /*
   * So for negotiate authentication, conversation happens on a
   * single connection. Yes that's right, GSSAPI, NTLM, and all
   * those nice mechanisms are keep-alive based, not HTTP request based.
   */
  else if (g_str_equal (type, "negotiate"))
    {
      /* Resume an already running conversation? */
      if (ret_conversation && connection)
        *ret_conversation = g_strdup (g_object_get_data (G_OBJECT (connection), type));
    }


  if (ret_type)
    {
      *ret_type = type;
      type = NULL;
    }

  ret = line;
  line = NULL;

out:
  g_free (line);
  g_free (type);
  return ret;
}

static const gchar *
type_option (const gchar *type,
             const gchar *option,
             const gchar *default_str)
{
  if (type && cockpit_conf_string (type, option))
    return cockpit_conf_string (type, option);

  return default_str;
}

static guint
timeout_option (const gchar *name,
                const gchar *type,
                guint default_value)
{
  return cockpit_conf_guint (type, name, default_value,
                             MAX_AUTH_TIMEOUT, MIN_AUTH_TIMEOUT);
}

static const gchar *
application_parse_host (const gchar *application)
{
  const gchar *prefix = "cockpit+=";
  gint len = strlen (prefix);

  g_return_val_if_fail (application != NULL, NULL);

  if (g_str_has_prefix (application, prefix) && application[len] != '\0')
    return application + len;
  else
    return NULL;
}

static gchar *
application_cookie_name (const gchar *application)
{
  const gchar *host = application_parse_host (application);
  gchar *cookie_name = NULL;

  if (host)
      cookie_name = g_strdup_printf ("machine-cockpit+%s", host);
  else
      cookie_name = g_strdup (application);

  return cookie_name;
}

/* Struct for adding tty later */
typedef struct {
  int io;
} ChildData;

static void
session_child_setup (gpointer data)
{
  ChildData *child = data;

  if (dup2 (child->io, 0) < 0 || dup2 (child->io, 1) < 0)
    {
      g_printerr ("couldn't set child stdin/stout file descriptors\n");
      _exit (127);
    }

  close (child->io);

  if (cockpit_unix_fd_close_all (3, -1) < 0)
    {
      g_printerr ("couldn't close file descriptors: %m\n");
      _exit (127);
    }
}

static CockpitTransport *
session_start_process (const gchar **argv,
                       const gchar **env)
{
  CockpitTransport *transport = NULL;
  CockpitPipe *pipe = NULL;
  GError *error = NULL;
  ChildData child;
  gboolean ret;
  GPid pid = 0;
  int fds[2];

  g_debug ("spawning %s", argv[0]);

  /* The main stdin/stdout for the socket ... both are read/writable */
  if (socketpair (PF_LOCAL, SOCK_STREAM, 0, fds) < 0)
    {
      g_warning ("couldn't create loopback socket: %s", g_strerror (errno));
      return NULL;
    }

  child.io = fds[0];
  ret = g_spawn_async_with_pipes (NULL, (gchar **)argv, (gchar **)env,
                                  G_SPAWN_DO_NOT_REAP_CHILD | G_SPAWN_LEAVE_DESCRIPTORS_OPEN,
                                  session_child_setup, &child,
                                  &pid, NULL, NULL, NULL, &error);

  close (fds[0]);

  if (!ret)
    {
      g_message ("couldn't launch cockpit session: %s: %s", argv[0], error->message);
      g_error_free (error);
      close (fds[1]);
      return NULL;
    }

  pipe = g_object_new (COCKPIT_TYPE_PIPE,
                       "in-fd", fds[1],
                       "out-fd", fds[1],
                       "pid", pid,
                       "name", argv[0],
                       NULL);

  transport = cockpit_pipe_transport_new (pipe);
  g_object_unref (pipe);

  return transport;
}

static void
send_authorize_reply (CockpitTransport *transport,
                      const gchar *cookie,
                      const gchar *authorization)
{
  const gchar *fields[] = {
    "command", "authorize",
    "cookie", cookie,
    "response", authorization,
    NULL
  };

  GBytes *payload;
  const gchar *delim;
  GByteArray *buffer;
  JsonNode *node;
  gchar *encoded;
  gsize length;
  guint i;

  buffer = g_byte_array_new ();
  for (i = 0; fields[i] != NULL; i++)
    {
      if (i % 2 == 0)
        delim = buffer->len == 0 ? "{" : ",";
      else
        delim = ":";
      g_byte_array_append (buffer, (guchar *)delim, 1);

      node = json_node_init_string (json_node_new (JSON_NODE_VALUE), fields[i]);
      encoded = cockpit_json_write (node, &length);
      g_byte_array_append (buffer, (guchar *)encoded, length);
      cockpit_memory_clear ((guchar *)json_node_get_string (node), -1);
      json_node_free (node);
      g_free (encoded);
    }

  g_byte_array_append (buffer, (guchar *)"}", 1);
  payload = g_bytes_new_with_free_func (buffer->data, buffer->len,
                                        byte_array_clear_and_free, buffer);

  cockpit_transport_send (transport, NULL, payload);
  g_bytes_unref (payload);
}

static gboolean
reply_authorize_challenge (CockpitSession *session)
{
  const gchar *challenge = NULL;
  char *authorize_type = NULL;
  char *authorization_type = NULL;
  const gchar *cookie = NULL;
  const gchar *response = NULL;
  JsonObject *login_data = NULL;
  gboolean ret = FALSE;

  if (!session->authorize)
    goto out;

  if (!cockpit_json_get_string (session->authorize, "cookie", NULL, &cookie) ||
      !cockpit_json_get_string (session->authorize, "challenge", NULL, &challenge) ||
      !cockpit_json_get_string (session->authorize, "response", NULL, &response))
    goto out;

  if (response && !cookie)
    {
      cockpit_memory_clear (session->authorization, -1);
      g_free (session->authorization);
      session->authorization = g_strdup (response);
      ret = TRUE;
      goto out;
    }

  if (!challenge || !cookie)
    goto out;

  if (!cockpit_authorize_type (challenge, &authorize_type))
    goto out;

  /* Handle prompting for login data */
  if (g_str_equal (authorize_type, "x-login-data"))
    {
      if (cockpit_json_get_object (session->authorize, "login-data", NULL, &login_data) && login_data)
        cockpit_creds_set_login_data (cockpit_web_service_get_creds (session->service), login_data);
      ret = TRUE;
      goto out;
    }

  if (!session->authorization)
    goto out;

  if (cockpit_authorize_type (session->authorization, &authorization_type) &&
      (g_str_equal (authorize_type, "*") || g_str_equal (authorize_type, authorization_type)))
    {
      send_authorize_reply (session->transport, cookie, session->authorization);
      cockpit_memory_clear (session->authorization, -1);
      g_free (session->authorization);
      session->authorization = NULL;
      ret = TRUE;
    }

out:
  free (authorize_type);
  free (authorization_type);
  return ret;
}

static gboolean
on_authorize_timeout (gpointer data)
{
  CockpitSession *session = data;
  CockpitTransport *transport = cockpit_web_service_get_transport (session->service);
  session->timeout_tag = 0;
  g_message ("%s: session timed out during authentication", session->name);
  cockpit_transport_close (transport, "timeout");
  return FALSE;
}

static void
reset_authorize_timeout (CockpitSession *session,
                         gboolean waiting_for_client)
{
  guint seconds = waiting_for_client ? session->client_timeout : session->authorize_timeout;
  if (session->timeout_tag)
    g_source_remove (session->timeout_tag);
  session->timeout_tag = g_timeout_add_seconds (seconds, on_authorize_timeout, session);
}

static void
propagate_problem_to_error (CockpitSession *session,
                            JsonObject *options,
                            const gchar *problem,
                            const gchar *message,
                            GError **error)
{
  char *type = NULL;
  const char *pw_result = NULL;
  JsonObject *auth_results = NULL;

  g_return_if_fail (error != NULL);

  if (g_str_equal (problem, "authentication-unavailable") &&
      cockpit_authorize_type (session->authorization, &type) &&
      g_str_equal (type, "negotiate"))
    {
      g_debug ("%s: negotiate authentication not available", session->name);
      g_set_error (error, COCKPIT_ERROR, COCKPIT_ERROR_AUTHENTICATION_FAILED,
                   "Negotiate authentication not available");
      gssapi_available = 0;
    }
  else if (g_str_equal (problem, "authentication-failed") ||
           g_str_equal (problem, "authentication-unavailable"))
    {
        cockpit_json_get_object (options, "auth-method-results", NULL, &auth_results);
        if (auth_results)
          {
            cockpit_json_get_string (auth_results, "password", NULL, &pw_result);
            if (!pw_result || g_strcmp0 (pw_result, "no-server-support") == 0)
              {
                g_clear_error (error);
                g_set_error (error, COCKPIT_ERROR,
                             COCKPIT_ERROR_AUTHENTICATION_FAILED,
                             "Authentication failed: authentication-not-supported");
              }
          }

        if (*error == NULL)
          {
            g_debug ("%s: %s %s", session->name, problem, message);
            g_set_error (error, COCKPIT_ERROR, COCKPIT_ERROR_AUTHENTICATION_FAILED,
                         "Authentication failed");
          }
    }
  else if (g_str_equal (problem, "no-host") ||
           g_str_equal (problem, "invalid-hostkey") ||
           g_str_equal (problem, "unknown-hostkey") ||
           g_str_equal (problem, "unknown-host") ||
           g_str_equal (problem, "terminated"))
    {
      g_debug ("%s: %s", session->name, problem);
      g_set_error (error, COCKPIT_ERROR, COCKPIT_ERROR_AUTHENTICATION_FAILED,
                   "Authentication failed: %s", problem);
    }
  else if (g_str_equal (problem, "access-denied"))
    {
      g_debug ("permission denied %s", message);
      g_set_error_literal (error, COCKPIT_ERROR, COCKPIT_ERROR_PERMISSION_DENIED,
                           message ? message : "Permission denied");
    }
  else
    {
      g_debug ("%s: errored %s: %s", session->name, problem, message);
      if (message)
        {
          g_set_error (error, COCKPIT_ERROR, COCKPIT_ERROR_FAILED,
                       "Authentication failed: %s: %s", problem, message);
        }
      else
        {
          g_set_error (error, COCKPIT_ERROR, COCKPIT_ERROR_FAILED,
                       "Authentication failed: %s", problem);
        }

    }

  free (type);
}

static gboolean
on_transport_control (CockpitTransport *transport,
                      const char *command,
                      const gchar *channel,
                      JsonObject *options,
                      GBytes *payload,
                      gpointer user_data)
{
  CockpitSession *session = user_data;
  const gchar *problem = NULL;
  const gchar *message = NULL;
  GSimpleAsyncResult *result;
  GError *error = NULL;
  gboolean ret = TRUE;

  if (g_str_equal (command, "init"))
    {
      g_debug ("session initialized");
      g_signal_handler_disconnect (session->transport, session->control_sig);
      g_signal_handler_disconnect (session->transport, session->close_sig);
      session->control_sig = session->close_sig = 0;
      session->initialized = TRUE;

      if (cockpit_json_get_string (options, "problem", NULL, &problem) && problem)
        {
          if (!cockpit_json_get_string (options, "message", NULL, &message))
            message = NULL;
          propagate_problem_to_error (session, options, problem, message, &error);
          if (session->result)
            {
              g_simple_async_result_take_error (session->result, error);
            }
          else
            {
              g_message ("ignoring failure from session process: %s", error->message);
              g_error_free (error);
            }
        }

      ret = FALSE; /* Let this message be handled elsewhere */
    }
  else if (g_str_equal (command, "authorize"))
    {
      const gchar *challenge;

      /* handle x-host-key challenge */
      if (cockpit_json_get_string (options, "challenge", NULL, &challenge) && g_strcmp0 (challenge, "x-host-key") == 0)
        {
          const gchar *cookie;
          g_return_val_if_fail (cockpit_json_get_string (options, "cookie", NULL, &cookie), FALSE);

          /* return a negative answer; we handle unknown hosts interactively, or want to fail on them */
          g_debug ("received x-host-key authorize challenge");
          send_authorize_reply (session->transport, cookie, "");
          return TRUE;
        }

      /* handle login ("*") challenge */
      g_debug ("received authorize challenge");
      if (session->authorize)
        json_object_unref (session->authorize);
      session->authorize = json_object_ref (options);

      if (reply_authorize_challenge (session))
        return TRUE;
    }
  else
    {
      g_message ("unexpected \"%s\" control message from session before \"init\"", command);
      cockpit_transport_close (transport, "protocol-error");
    }

  if (session->result)
    {
      result = session->result;
      session->result = NULL;
      g_simple_async_result_complete (result);
      g_object_unref (result);
    }

  return ret;
}

static void
on_transport_closed (CockpitTransport *transport,
                     const gchar *problem,
                     gpointer user_data)
{
  CockpitSession *session = user_data;
  GSimpleAsyncResult *result;
  CockpitPipe *pipe;
  GError *error = NULL;
  gint status = 0;

  if (g_strcmp0 (problem, "timeout") == 0)
    {
      g_message ("%s: authentication timed out", session->name);
      g_set_error (&error, COCKPIT_ERROR, COCKPIT_ERROR_FAILED,
                   "Authentication failed: Timeout");
    }
  else if (!session->initialized)
    {
      pipe = cockpit_pipe_transport_get_pipe (COCKPIT_PIPE_TRANSPORT (transport));
      if (cockpit_pipe_get_pid (pipe, NULL))
        status = cockpit_pipe_exit_status (pipe);
      g_debug ("%s: authentication process exited: %d", session->name, status);
      if (problem)
        {
          g_set_error (&error, COCKPIT_ERROR, COCKPIT_ERROR_FAILED,
                       "Internal error in login process");
        }
      else
        {
          g_set_error (&error, COCKPIT_ERROR, COCKPIT_ERROR_AUTHENTICATION_FAILED,
                       "Authentication failed");
        }
    }

  if (!error)
    {
      g_message ("%s: authentication process failed", session->name);
      g_set_error (&error, COCKPIT_ERROR, COCKPIT_ERROR_FAILED,
                   "Authentication internal error");
    }

  if (session->result)
    {
      result = session->result;
      session->result = NULL;
      g_simple_async_result_take_error (result, error);
      g_simple_async_result_complete (result);
      g_object_unref (result);
    }
  else
    {
      g_message ("ignoring failure from session process: %s", error->message);
      cockpit_session_reset (session);
      g_error_free (error);
    }
}

static CockpitCreds *
build_session_credentials (CockpitAuth *self,
                           GIOStream *connection,
                           GHashTable *headers,
                           const char *application,
                           const char *type,
                           const char *authorization)
{
  CockpitCreds *creds;
  const gchar *authorized;

  char *user = NULL;
  char *raw = NULL;

  GBytes *password = NULL;
  gchar *remote_peer = NULL;
  gchar *csrf_token = NULL;

  /* Prepare various credentials */
  if (g_strcmp0 (type, "basic") == 0)
    {
      raw = cockpit_authorize_parse_basic (authorization, &user);

      /* If "password" is in the X-Authorize header, we can keep the password for use */
      authorized = g_hash_table_lookup (headers, "X-Authorize");
      if (!authorized)
        authorized = "";
      if (strstr (authorized, "password") && raw)
        {
          password = g_bytes_new_take (raw, strlen (raw));
          raw = NULL;
        }
    }

  remote_peer = get_remote_address (connection);
  csrf_token = cockpit_auth_nonce (self);

  creds = cockpit_creds_new (application,
                             COCKPIT_CRED_USER, user,
                             COCKPIT_CRED_PASSWORD, password,
                             COCKPIT_CRED_RHOST, remote_peer,
                             COCKPIT_CRED_CSRF_TOKEN, csrf_token,
                             NULL);

  g_free (remote_peer);
  if (raw)
    {
      cockpit_memory_clear (raw, strlen (raw));
      free (raw);
    }
  g_free (csrf_token);
  if (password)
    g_bytes_unref (password);
  free (user);

  return creds;
}

static gboolean
on_session_timeout (gpointer data)
{
  CockpitSession *session = data;

  session->timeout_tag = 0;

  if (!session->service || cockpit_web_service_get_idling (session->service))
    {
      g_info ("session timed out");
      cockpit_session_reset (session);
    }

  return FALSE;
}

static void
on_web_service_idling (CockpitWebService *service,
                       gpointer data)
{
  CockpitSession *session = data;

  if (session->timeout_tag)
    g_source_remove (session->timeout_tag);

  g_debug ("session is idle");

  /*
   * The minimum amount of time before a request uses this new web service,
   * otherwise it will just go away.
   */
  session->timeout_tag = g_timeout_add_seconds (cockpit_ws_service_idle,
                                                on_session_timeout,
                                                session);

  /*
   * Also reset the timer which checks whether anything is going on in the
   * entire process or not.
   */
  if (session->auth->timeout_tag)
    g_source_remove (session->auth->timeout_tag);

  session->auth->timeout_tag = g_timeout_add_seconds (cockpit_ws_process_idle,
                                                      on_process_timeout, session->auth);
}

static void
on_web_service_destroy (CockpitWebService *service,
                        gpointer data)
{
  on_web_service_idling (service, data);
  cockpit_session_reset (data);
}

static CockpitSession *
cockpit_session_create (CockpitAuth *self,
                        GIOStream *connection,
                        GHashTable *headers,
                        const gchar *type,
                        const gchar *authorization,
                        const gchar *application,
                        GError **error)
{
  CockpitTransport *transport = NULL;
  CockpitSession *session = NULL;
  CockpitCreds *creds = NULL;

  const gchar *host;
  const gchar *action;
  const gchar *command;
  const gchar *section;
  const gchar *program_default;

  gchar **env = g_get_environ ();

  const gchar *argv[] = {
    "command",
    "host",
     NULL,
  };

  host = application_parse_host (application);
  action = type_option (type, "action", "localhost");
  if (g_strcmp0 (action, ACTION_NONE) == 0)
    {
      g_set_error (error, COCKPIT_ERROR, COCKPIT_ERROR_AUTHENTICATION_FAILED,
                   "Authentication disabled");
      goto out;
    }

  /* These are the credentials we'll carry around for this session */
  creds = build_session_credentials (self, connection, headers,
                                     application, type, authorization);

  if (host)
    section = COCKPIT_CONF_SSH_SECTION;
  else if (self->login_loopback && g_strcmp0 (type, "basic") == 0)
    section = COCKPIT_CONF_SSH_SECTION;
  else if (g_strcmp0 (action, ACTION_SSH) == 0)
    section = COCKPIT_CONF_SSH_SECTION;
  else
    section = type;

  if (g_strcmp0 (section, COCKPIT_CONF_SSH_SECTION) == 0)
    {
      if (!host)
        host = type_option (COCKPIT_CONF_SSH_SECTION, "host", "127.0.0.1");

      program_default = cockpit_ws_ssh_program;
    }
  else
    {
      program_default = cockpit_ws_session_program;
    }

  command = type_option (section, "command", program_default);

  if (cockpit_creds_get_rhost (creds))
    {
      env = g_environ_setenv (env, "COCKPIT_REMOTE_PEER",
                              cockpit_creds_get_rhost (creds),
                              TRUE);
    }

  argv[0] = command;
  argv[1] = host ? host : "localhost";

  transport = session_start_process (argv, (const gchar **)env);
  if (!transport)
    {
      g_set_error (error, COCKPIT_ERROR, COCKPIT_ERROR_FAILED,
                   "Authentication failed to start");
      goto out;
    }

  session = g_new0 (CockpitSession, 1);
  session->refs = 1;
  session->name = g_path_get_basename (argv[0]);
  session->auth = self;

  session->service = cockpit_web_service_new (creds, transport);

  session->idling_sig = g_signal_connect (session->service, "idling",
                                          G_CALLBACK (on_web_service_idling), session);
  session->destroy_sig = g_signal_connect (session->service, "destroy",
                                           G_CALLBACK (on_web_service_destroy), session);

  g_object_weak_ref (G_OBJECT (session->service), on_web_service_gone, session);

  session->transport = g_object_ref (transport);
  session->control_sig = g_signal_connect (transport, "control", G_CALLBACK (on_transport_control), session);
  session->close_sig = g_signal_connect (transport, "closed", G_CALLBACK (on_transport_closed), session);

  /* How long to wait for the auth process to send some data */
  session->authorize_timeout = timeout_option ("timeout", section, cockpit_ws_auth_process_timeout);

  /* How long to wait for a response from the client to a auth prompt */
  session->client_timeout = timeout_option ("response-timeout", section, cockpit_ws_auth_response_timeout);

out:
  g_strfreev (env);
  if (creds)
    cockpit_creds_unref (creds);
  if (transport)
    g_object_unref (transport);

  return session;
}

static gboolean
build_authorize_challenge (CockpitAuth *self,
                           JsonObject *authorize,
                           GIOStream *connection,
                           GHashTable *headers,
                           JsonObject **body,
                           gchar **conversation)
{
  const gchar *challenge = NULL;
  gchar *type = NULL;
  JsonObject *object;
  GList *l, *names;

  if (!cockpit_json_get_string (authorize, "challenge", NULL, &challenge) ||
      !cockpit_authorize_type (challenge, &type))
    {
      g_message ("invalid \"challenge\" field in \"authorize\" message");
      return FALSE;
    }

  g_hash_table_replace (headers, g_strdup ("WWW-Authenticate"), g_strdup (challenge));
  *conversation = NULL;

  if (g_str_equal (type, "negotiate"))
    {
      gssapi_available = 1;
      *conversation = cockpit_auth_nonce (self);
      if (connection)
        g_object_set_data_full (G_OBJECT (connection), "negotiate", g_strdup (*conversation), g_free);
    }
  else if (g_str_equal (type, "x-conversation"))
    {
      cockpit_authorize_subject (challenge, conversation);
    }

  object = json_object_new ();
  names = json_object_get_members (authorize);
  for (l = names; l != NULL; l = g_list_next (l))
    {
      if (!g_str_equal (l->data, "challenge") && !g_str_equal (l->data, "cookie"))
        json_object_set_member (object, l->data, json_object_dup_member (authorize, l->data));
    }
  if (body)
    *body = object;

  g_list_free (names);
  g_free (type);
  return TRUE;
}

static void
authorize_logger (const char *data)
{
  g_message ("%s", data);
}

static void
cockpit_auth_class_init (CockpitAuthClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);

  gobject_class->finalize = cockpit_auth_finalize;

  sig__idling = g_signal_new ("idling", COCKPIT_TYPE_AUTH, G_SIGNAL_RUN_FIRST,
                              0, NULL, NULL, NULL, G_TYPE_NONE, 0);

  cockpit_authorize_logger (authorize_logger, 0);
}

static char *
base64_decode_string (const char *enc)
{
  if (enc == NULL)
    return NULL;

  char *dec = g_strdup (enc);
  gsize len;
  g_base64_decode_inplace (dec, &len);
  dec[len] = '\0';
  return dec;
}

static CockpitSession *
session_for_headers (CockpitAuth *self,
                     const gchar *path,
                     GHashTable *in_headers)
{
  gchar *cookie = NULL;
  gchar *raw = NULL;
  const char *prefix = "v=2;k=";
  CockpitSession *ret = NULL;
  gchar *application;
  gchar *cookie_name = NULL;

  g_return_val_if_fail (self != NULL, FALSE);
  g_return_val_if_fail (in_headers != NULL, FALSE);

  application = cockpit_auth_parse_application (path, NULL);
  if (!application)
    return NULL;

  cookie_name = application_cookie_name (application);
  raw = cockpit_web_server_parse_cookie (in_headers, cookie_name);
  if (raw)
    {
      cookie = base64_decode_string (raw);
      if (cookie != NULL)
        {
          if (g_str_has_prefix (cookie, prefix))
            ret = g_hash_table_lookup (self->sessions, cookie);
          else
            g_debug ("invalid or unsupported cookie: %s", cookie);
          g_free (cookie);
        }
      g_free (raw);
    }

  g_free (application);
  g_free (cookie_name);
  return ret;
}

CockpitWebService *
cockpit_auth_check_cookie (CockpitAuth *self,
                           const gchar *path,
                           GHashTable *in_headers)
{
  CockpitSession *session;
  CockpitCreds *creds;

  session = session_for_headers (self, path, in_headers);
  if (session)
    {
      creds = cockpit_web_service_get_creds (session->service);
      g_debug ("received %s credential cookie for session",
               cockpit_creds_get_application (creds));
      return g_object_ref (session->service);
    }
  else
    {
      g_debug ("received unknown/invalid credential cookie");
      return NULL;
    }
}

/*
 * returns TRUE if auth can proceed, FALSE otherwise.
 * dropping starts at connection max_startups_begin with a probability
 * of (max_startups_rate/100). the probability increases linearly until
 * all connections are dropped for startups > max_startups
 */

static gboolean
can_start_auth (CockpitAuth *self)
{
  int p, r;

  /* 0 means unlimited */
  if (self->max_startups == 0)
    return TRUE;

  /* Under soft limit */
  if (self->startups <= self->max_startups_begin)
    return TRUE;

  /* Over hard limit */
  if (self->startups > self->max_startups)
    return FALSE;

  /* If rate is 100, soft limit is hard limit */
  if (self->max_startups_rate == 100)
    return FALSE;

  p = 100 - self->max_startups_rate;
  p *= self->startups - self->max_startups_begin;
  p /= self->max_startups - self->max_startups_begin;
  p += self->max_startups_rate;
  r = g_random_int_range (0, 100);

  g_debug ("calculating if auth can start: (%u:%u:%u): p %d, r %d",
           self->max_startups_begin, self->max_startups_rate,
           self->max_startups, p, r);
  return (r < p) ? FALSE : TRUE;
}

void
cockpit_auth_login_async (CockpitAuth *self,
                          const gchar *path,
                          GIOStream *connection,
                          GHashTable *headers,
                          GAsyncReadyCallback callback,
                          gpointer user_data)
{
  GSimpleAsyncResult *result = NULL;
  CockpitSession *session;
  GError *error = NULL;
  gchar *type = NULL;
  gchar *conversation = NULL;
  gchar *authorization = NULL;
  gchar *application = NULL;

  g_return_if_fail (path != NULL);
  g_return_if_fail (headers != NULL);

  self->startups++;

  result = g_simple_async_result_new (G_OBJECT (self), callback, user_data,
                                      cockpit_auth_login_async);

  if (!can_start_auth (self))
    {
      g_message ("Request dropped; too many startup connections: %u", self->startups);
      g_simple_async_result_set_error (result, COCKPIT_ERROR, COCKPIT_ERROR_FAILED,
                                       "Connection closed by host");
      g_simple_async_result_complete_in_idle (result);
      goto out;
    }

  application = cockpit_auth_parse_application (path, NULL);
  authorization = cockpit_auth_steal_authorization (headers, connection, &type, &conversation);

  if (!application || !authorization)
    {
      g_simple_async_result_set_error (result, COCKPIT_ERROR, COCKPIT_ERROR_AUTHENTICATION_FAILED,
                                       "Authentication required");
      g_simple_async_result_complete_in_idle (result);
      goto out;
    }

  if (conversation)
    {
      session = g_hash_table_lookup (self->conversations, conversation);
      if (!session)
        {
          g_simple_async_result_set_error (result, COCKPIT_ERROR, COCKPIT_ERROR_AUTHENTICATION_FAILED,
                                           "Invalid conversation token");
          g_simple_async_result_complete_in_idle (result);
          goto out;
        }

      g_simple_async_result_set_op_res_gpointer (result, cockpit_session_ref (session), cockpit_session_unref);
    }
  else
    {
      session = cockpit_session_create (self, connection, headers, type, authorization, application, &error);
      if (!session)
        {
          g_simple_async_result_take_error (result, error);
          g_simple_async_result_complete_in_idle (result);
          goto out;
        }
      g_simple_async_result_set_op_res_gpointer (result, session, cockpit_session_unref);
    }

  cockpit_session_reset (session);
  session->result = g_object_ref (result);

  session->authorization = authorization;
  authorization = NULL;

  if (conversation && !reply_authorize_challenge (session))
    {
      g_simple_async_result_set_error (result, COCKPIT_ERROR, COCKPIT_ERROR_AUTHENTICATION_FAILED,
                                       "Invalid conversation reply");
      g_simple_async_result_complete_in_idle (result);
      goto out;
    }

  reset_authorize_timeout (session, FALSE);

out:
  g_free (type);
  g_free (application);
  g_free (conversation);

  if (authorization)
    {
      cockpit_memory_clear (authorization, -1);
      g_free (authorization);
    }

  g_object_unref (result);
}

JsonObject *
cockpit_auth_login_finish (CockpitAuth *self,
                           GAsyncResult *result,
                           GIOStream *connection,
                           GHashTable *headers,
                           GError **error)
{
  JsonObject *body = NULL;
  CockpitCreds *creds = NULL;
  CockpitSession *session = NULL;
  gboolean force_secure;
  gchar *cookie_name;
  gchar *cookie_b64;
  gchar *header;
  gchar *id;

  g_return_val_if_fail (g_simple_async_result_is_valid (result, G_OBJECT (self),
                        cockpit_auth_login_async), NULL);

  g_object_ref (result);
  session = g_simple_async_result_get_op_res_gpointer (G_SIMPLE_ASYNC_RESULT (result));

  if (g_simple_async_result_propagate_error (G_SIMPLE_ASYNC_RESULT (result), error))
    goto out;

  g_return_val_if_fail (session != NULL, NULL);
  g_return_val_if_fail (session->result == NULL, NULL);

  cockpit_session_reset (session);

  if (session->authorize)
    {
      if (build_authorize_challenge (self, session->authorize, connection,
                                     headers, &body, &session->conversation))
        {
          if (session->conversation)
            {
              reset_authorize_timeout (session, TRUE);
              g_hash_table_replace (self->conversations, session->conversation, cockpit_session_ref (session));
            }
        }
    }

  if (session->initialized)
    {
      /* Start off in the idling state, and begin a timeout during which caller must do something else */
      on_web_service_idling (session->service, session);
      creds = cockpit_web_service_get_creds (session->service);

      id = cockpit_auth_nonce (self);
      session->cookie = g_strdup_printf ("v=2;k=%s", id);
      g_hash_table_insert (self->sessions, session->cookie, cockpit_session_ref (session));
      g_free (id);

      if (headers)
        {
          force_secure = connection ? !G_IS_SOCKET_CONNECTION (connection) : TRUE;
          cookie_name = application_cookie_name (cockpit_creds_get_application (creds));
          cookie_b64 = g_base64_encode ((guint8 *)session->cookie, strlen (session->cookie));
          header = g_strdup_printf ("%s=%s; Path=/; %s HttpOnly",
                                    cookie_name, cookie_b64,
                                    force_secure ? " Secure;" : "");
          g_free (cookie_b64);
          g_free (cookie_name);
          g_hash_table_insert (headers, g_strdup ("Set-Cookie"), header);
        }

      if (body)
        json_object_unref (body);
      body = cockpit_creds_to_json (creds);
    }
  else
    {
      g_set_error (error, COCKPIT_ERROR, COCKPIT_ERROR_AUTHENTICATION_FAILED,
                   "Authentication failed");
    }

out:
  self->startups--;
  g_object_unref (result);

  /* Successful login */
  if (creds)
    g_info ("logged in user session");

  return body;
}

CockpitAuth *
cockpit_auth_new (gboolean login_loopback)
{
  CockpitAuth *self = g_object_new (COCKPIT_TYPE_AUTH, NULL);
  const gchar *max_startups_conf;
  gint count = 0;

  self->login_loopback = login_loopback;

  if (cockpit_ws_max_startups == NULL)
    max_startups_conf = cockpit_conf_string ("WebService", "MaxStartups");
  else
    max_startups_conf = cockpit_ws_max_startups;

  self->max_startups = max_startups;
  self->max_startups_begin = max_startups;
  self->max_startups_rate = 100;

  if (max_startups_conf)
    {
      count = sscanf (max_startups_conf, "%u:%u:%u",
                      &self->max_startups_begin,
                      &self->max_startups_rate,
                      &self->max_startups);

      /* If all three numbers are not given use the
       * first as a hard limit */
      if (count == 1 || count == 2)
        {
          self->max_startups = self->max_startups_begin;
          self->max_startups_rate = 100;
        }

      if (count < 1 || count > 3 ||
          self->max_startups_begin > self->max_startups ||
          self->max_startups_rate > 100 || self->max_startups_rate < 1)
        {
          g_warning ("Illegal MaxStartups spec: %s. Reverting to defaults", max_startups_conf);
          self->max_startups = max_startups;
          self->max_startups_begin = max_startups;
          self->max_startups_rate = 100;
        }
    }

  return self;
}

gchar *
cockpit_auth_parse_application (const gchar *path,
                                gboolean *is_host)
{
  const gchar *pos;
  gchar *tmp = NULL;
  gchar *val = NULL;

  g_return_val_if_fail (path != NULL, NULL);
  g_return_val_if_fail (path[0] == '/', NULL);

  path += 1;

  /* We are being embedded as a specific application */
  if (g_str_has_prefix (path, "cockpit+") && path[8] != '\0')
    {
      pos = strchr (path, '/');
      if (pos)
        val = g_strndup (path, pos - path);
      else
        val =  g_strdup (path);
    }
  else if (path[0] == '=' && path[1] != '\0')
    {
      pos = strchr (path, '/');
      if (pos)
        {
          tmp = g_strndup (path, pos - path);
          val = g_strdup_printf ("cockpit+%s", tmp);
        }
      else
        {
          val = g_strdup_printf ("cockpit+%s", path);
        }

    }
  else
    {
      val = g_strdup ("cockpit");
    }

  if (is_host)
    *is_host = application_parse_host (val) != NULL;

  g_free (tmp);
  return val;
}

gchar *
cockpit_auth_empty_cookie_value (const gchar *path)
{
  gchar *application = cockpit_auth_parse_application (path, NULL);
  gchar *cookie = application_cookie_name (application);

  gchar *cookie_line = g_strdup_printf ("%s=deleted; PATH=/", cookie);

  g_free (application);
  g_free (cookie);

  return cookie_line;
}
