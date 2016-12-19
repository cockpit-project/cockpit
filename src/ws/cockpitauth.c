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

#include "cockpitauthoptions.h"
#include "cockpitauthprocess.h"
#include "cockpitsshtransport.h"
#include "cockpitws.h"

#include "websocket/websocket.h"

#include "common/cockpitconf.h"
#include "common/cockpiterror.h"
#include "common/cockpithex.h"
#include "common/cockpitlog.h"
#include "common/cockpitjson.h"
#include "common/cockpitmemory.h"
#include "common/cockpitpipe.h"
#include "common/cockpitpipetransport.h"
#include "common/cockpitsystem.h"
#include "common/cockpitwebserver.h"

#include <security/pam_appl.h>

#include <sys/socket.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <errno.h>

#define ACTION_SSH "remote-login-ssh"
#define ACTION_NONE "none"
#define LOGIN_REPLY_HEADER "X-Conversation"

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

/* Used by test to overide known hosts */
const gchar *cockpit_ws_known_hosts = NULL;

G_DEFINE_TYPE (CockpitAuth, cockpit_auth, G_TYPE_OBJECT)

typedef struct {
  gchar *cookie;
  CockpitAuth *auth;
  CockpitCreds *creds;
  CockpitWebService *service;
  guint timeout_tag;
  gulong idling_sig;
  gulong destroy_sig;
} CockpitAuthenticated;

static void
cockpit_authenticated_destroy (CockpitAuthenticated *authenticated)
{
  CockpitAuth *self = authenticated->auth;
  g_hash_table_remove (self->authenticated, authenticated->cookie);
}

static void
on_web_service_gone (gpointer data,
                     GObject *where_the_object_was)
{
  CockpitAuthenticated *authenticated = data;
  authenticated->service = NULL;
  cockpit_authenticated_destroy (authenticated);
}

static void
cockpit_authenticated_free (gpointer data)
{
  CockpitAuthenticated *authenticated = data;
  GObject *object;

  if (authenticated->timeout_tag)
    g_source_remove (authenticated->timeout_tag);

  g_free (authenticated->cookie);
  cockpit_creds_poison (authenticated->creds);
  cockpit_creds_unref (authenticated->creds);

  if (authenticated->service)
    {
      if (authenticated->idling_sig)
        g_signal_handler_disconnect (authenticated->service, authenticated->idling_sig);
      if (authenticated->destroy_sig)
        g_signal_handler_disconnect (authenticated->service, authenticated->destroy_sig);
      object = G_OBJECT (authenticated->service);
      g_object_weak_unref (object, on_web_service_gone, authenticated);
      g_object_run_dispose (object);
      g_object_unref (authenticated->service);
    }

  g_free (authenticated);
}

typedef struct {
  CockpitAuthProcess *auth_process;
  gchar *conversation;
  gchar *response_data;
  gchar *remote_peer;
  gchar *application;

  gboolean is_ssh;

  GSimpleAsyncResult *pending_result;
  GBytes *authorization;

  const gchar *auth_type;
  gboolean authorize_password;

  gint refs;

} AuthData;

static void
auth_data_free (gpointer data)
{
  AuthData *ad = data;

  g_return_if_fail (ad->pending_result == NULL);

  if (ad->auth_process) {
    g_signal_handlers_disconnect_by_data (ad->auth_process, ad);
    g_object_unref (ad->auth_process);
  }

  if (ad->authorization)
    g_bytes_unref (ad->authorization);

  g_free (ad->application);
  g_free (ad->remote_peer);
  g_free (ad->conversation);
  g_free (ad->response_data);

  g_free (ad);
}

static void
auth_data_add_pending_result (AuthData *data,
                              GSimpleAsyncResult *result)
{
  g_return_if_fail (data->pending_result == NULL);
  data->pending_result = g_object_ref (result);
}

static void
auth_data_complete_result (AuthData *data,
                           GError *error)
{
  if (data->pending_result)
    {
      if (error)
        g_simple_async_result_set_from_error (data->pending_result, error);

      g_simple_async_result_complete_in_idle (data->pending_result);

      g_object_unref (data->pending_result);
      data->pending_result = NULL;
    }
  else if (error)
    {
      g_message ("Dropped authentication error: %s no pending request to respond to", error->message);
    }
  else
    {
      g_message ("Dropped authentication result, no pending request to respond to");
    }
}

static AuthData *
auth_data_ref (AuthData *data)
{
  g_return_val_if_fail (data != NULL, NULL);
  data->refs++;
  return data;
}

static void
auth_data_unref (gpointer data)
{
  AuthData *d = data;
  g_return_if_fail (data != NULL);
  d->refs--;
  if (d->refs == 0)
    auth_data_free (data);
}

static void
cockpit_auth_finalize (GObject *object)
{
  CockpitAuth *self = COCKPIT_AUTH (object);
  if (self->timeout_tag)
    g_source_remove (self->timeout_tag);
  g_bytes_unref (self->key);
  g_hash_table_destroy (self->authenticated);
  g_hash_table_destroy (self->authentication_pending);
  G_OBJECT_CLASS (cockpit_auth_parent_class)->finalize (object);
}

static gboolean
on_process_timeout (gpointer data)
{
  CockpitAuth *self = COCKPIT_AUTH (data);

  self->timeout_tag = 0;
  if (g_hash_table_size (self->authenticated) == 0 &&
      g_hash_table_size (self->authentication_pending) == 0)
    {
      g_debug ("web service is idle");
      g_signal_emit (self, sig__idling, 0);
    }

  return FALSE;
}

static void
cockpit_auth_init (CockpitAuth *self)
{
  self->key = cockpit_system_random_nonce (128);
  if (!self->key)
    g_error ("couldn't read random key, startup aborted");

  self->authenticated = g_hash_table_new_full (g_str_hash, g_str_equal,
                                               NULL, cockpit_authenticated_free);

  self->authentication_pending = g_hash_table_new_full (g_str_hash, g_str_equal,
                                                        NULL, auth_data_unref);

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

static void
purge_auth_conversation (CockpitAuthProcess *auth_process,
               GError *error,
               const gchar *problem,
               gpointer user_data)
{
  CockpitAuth *self = user_data;
  const gchar *id = cockpit_auth_process_get_conversation (auth_process);
  g_hash_table_remove (self->authentication_pending, id);
}

static void
cockpit_auth_prepare_login_reply (CockpitAuth *self,
                                  JsonObject *prompt_data,
                                  GHashTable *headers,
                                  AuthData *ad)
{
  const gchar *prompt;
  gchar *encoded_data = NULL;

  g_return_if_fail (ad->pending_result == NULL);

  // Will fail if prompt is not present
  prompt = json_object_get_string_member (prompt_data, "prompt");
  encoded_data = g_base64_encode ((guint8 *)prompt, strlen (prompt));

  g_hash_table_replace (headers, g_strdup ("WWW-Authenticate"),
                        g_strdup_printf ("%s %s %s", LOGIN_REPLY_HEADER,
                                         ad->conversation, encoded_data));

  g_hash_table_insert (self->authentication_pending, ad->conversation, auth_data_ref (ad));

  json_object_remove_member (prompt_data, "prompt");
  g_free (encoded_data);
}

static inline gchar *
str_skip (gchar *v,
          gchar c)
{
  while (v[0] == c)
    v++;
  return v;
}

static void
clear_free_authorization (gpointer data)
{
  cockpit_secclear (data, strlen (data));
  g_free (data);
}

static GBytes *
parse_basic_auth_password (GBytes *input,
                           gchar **user)
{
  const gchar *password;
  const gchar *data;

  data = g_bytes_get_data (input, NULL);

  /* password is null terminated, see below */
  password = strchr (data, ':');
  if (password != NULL)
    {
      if (user)
        *user = g_strndup (data, password - data);
      password++;
    }
  else
    {
      return NULL;
    }

  return g_bytes_new_with_free_func (password, strlen (password),
                                     (GDestroyNotify)g_bytes_unref,
                                     g_bytes_ref (input));
}

GBytes *
cockpit_auth_steal_authorization (GHashTable *headers,
                                  GIOStream *connection,
                                  const gchar **ret_type,
                                  const gchar **ret_conversation)
{
  gchar *conversation = NULL;
  gchar *type = NULL;
  GBytes *base;
  GBytes *ret;
  gchar *line;
  gsize length;
  gchar *next;
  gsize len;
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
      if (gssapi_available == -1)
        line = g_strdup ("Negotiate");
      else
        return NULL;
    }

  length = strlen (line);

  /* Find and normalize the type */
  type = str_skip (line, ' ');
  for (next = type; *next != ' ' && *next != '\0'; next++)
    *next = g_ascii_tolower (*next);

  /* Split the string at the type line */
  if (*next != '\0')
    {
      *(next++) = '\0';
      next = str_skip (next, ' ');
    }

  /* If this is a conversation, get that part out too */
  if (g_str_equal (type, "x-conversation"))
    {
      conversation = next;
      next = strchr (conversation, ' ');
      if (next)
        *(next++) = '\0';
      else
        next = conversation + strlen (conversation);
    }

  /*
   * So for negotiate authentication, conversation happens on a
   * single connection. Yes that's right, GSSAPI, NTLM, and all
   * those nice mechanisms are keep-alive based, not HTTP request based.
   */
  else if (g_str_equal (type, "negotiate"))
    {
      /* Resume an already running conversation? */
      if (connection)
        conversation = g_object_get_data (G_OBJECT (connection), type);
    }

  if (strlen (next) > 0 && (conversation ||
      g_str_equal (type, "basic") ||
      g_str_equal (type, "negotiate")))
    {
      g_base64_decode_inplace (next, &len);
      next[len] = '\0';
    }
  else
    {
      len = strlen(next);
    }

  /*
   * We keep everything allocated in place without copying due to
   * password data and make sure to clear it when freed.
   */
  base = g_bytes_new_with_free_func (line, length, clear_free_authorization, line);
  *ret_type = type;
  *ret_conversation = conversation;
  ret = g_bytes_new_from_bytes (base, next - line, len);
  g_bytes_unref (base);
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

/* ------------------------------------------------------------------------
 *  Login by spawning a new command
 */

static gchar *
build_gssapi_output_header (JsonObject *results)
{
  gchar *encoded;
  const gchar *output = NULL;
  gchar *value = NULL;
  gpointer data;
  gsize length;

  if (results)
    {
      if (!cockpit_json_get_string (results, "gssapi-output", NULL, &output))
        {
          g_warning ("received invalid gssapi-output field");
          goto out;
        }
    }

  if (!output)
    goto out;

  /* We've received indication from the bridge that GSSAPI is supported */
  gssapi_available = 1;

  data = cockpit_hex_decode (output, &length);
  if (!data)
    {
      g_warning ("received invalid gssapi-output field");
      goto out;
    }
  if (length)
    {
      encoded = g_base64_encode (data, length);
      value = g_strdup_printf ("Negotiate %s", encoded);
      g_free (encoded);
    }
  g_free (data);

out:
  return value;
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

static CockpitCreds *
create_creds_for_spawn_authenticated (CockpitAuth *self,
                                      const gchar *user,
                                      AuthData *ad,
                                      JsonObject *results,
                                      const gchar *raw_data)
{
  GBytes *password = NULL;
  const gchar *gssapi_creds = NULL;
  CockpitCreds *creds = NULL;
  gchar *csrf_token;

  /*
   * Dig the password out of the authorization header, rather than having
   * passing it back and forth possibly leaking it.
   */

  if (ad->authorize_password && g_str_equal (ad->auth_type, "basic"))
    password = parse_basic_auth_password (ad->authorization, NULL);

  if (!cockpit_json_get_string (results, "gssapi-creds", NULL, &gssapi_creds))
    {
      g_warning ("received bad gssapi-creds");
      gssapi_creds = NULL;
    }

  csrf_token = cockpit_auth_nonce (self);

  creds = cockpit_creds_new (user,
                             ad->application,
                             COCKPIT_CRED_LOGIN_DATA, raw_data,
                             COCKPIT_CRED_PASSWORD, password,
                             COCKPIT_CRED_RHOST, ad->remote_peer,
                             COCKPIT_CRED_GSSAPI, gssapi_creds,
                             COCKPIT_CRED_CSRF_TOKEN, csrf_token,
                             NULL);

  if (password)
    g_bytes_unref (password);

  g_free (csrf_token);
  return creds;
}

static CockpitCreds *
parse_cockpit_spawn_results (CockpitAuth *self,
                             AuthData *ad,
                             GHashTable *headers,
                             GIOStream *connection,
                             JsonObject **prompt_data,
                             gchar **gssapi_header,
                             GError **error)
{
  CockpitCreds *creds = NULL;
  JsonObject *results = NULL;
  JsonObject *auth_results = NULL;
  const gchar *pw_result = NULL;
  const gchar *user;
  const gchar *error_str;

  g_assert (prompt_data != NULL);
  g_assert (gssapi_header != NULL);

  results = cockpit_auth_process_parse_result (ad->auth_process,
                                               ad->response_data,
                                               error);
  if (results)
    {
      user = cockpit_auth_process_get_authenticated_user (ad->auth_process, results,
                                                          prompt_data, error);
      if (user)
        {
          creds = create_creds_for_spawn_authenticated (self, user, ad,
                                                        results,
                                                        ad->response_data);
        }
      else
        {
          cockpit_json_get_string (results, "error", NULL, &error_str);
          if (g_strcmp0 (error_str, "authentication-unavailable") == 0 &&
              g_str_equal (ad->auth_type, "negotiate") &&
              !ad->is_ssh)
            {
              /* The session told us that GSSAPI is not available */
              gssapi_available = 0;
              g_debug ("negotiate auth is not available, disabling");
              g_clear_error (error);
              g_set_error (error, COCKPIT_ERROR, COCKPIT_ERROR_AUTHENTICATION_FAILED,
                           "Negotiate authentication not available");
            }
          else if (ad->is_ssh && g_strcmp0 (error_str, "authentication-failed") == 0)
            {
              cockpit_json_get_object (results, "auth-method-results", NULL, &auth_results);
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
            }
          else if (g_strcmp0 (error_str, "terminated") == 0)
            {
              g_clear_error (error);
              g_set_error (error, COCKPIT_ERROR,
                           COCKPIT_ERROR_AUTHENTICATION_FAILED,
                           "Authentication failed: terminated");
            }
        }

      *gssapi_header = build_gssapi_output_header (results);
      json_object_unref (results);
    }

  return creds;
}

static void
on_auth_process_message (CockpitAuthProcess *auth_process,
                         GBytes *message,
                         gpointer user_data)
{
  AuthData *ad = user_data;
  gsize len;

  len = g_bytes_get_size (message);
  g_return_if_fail (ad->response_data == NULL);
  ad->response_data = g_strndup (g_bytes_get_data (message, NULL), len);
  auth_data_complete_result (ad, NULL);
}

static void
on_auth_process_close (CockpitAuthProcess *auth_process,
                       GError *error,
                       const gchar *problem,
                       gpointer user_data)
{
  AuthData *ad = user_data;
  /* Only report errors */
  if (error || ad->pending_result)
    auth_data_complete_result (ad, error);
}

static void
cockpit_auth_resume_async (CockpitAuth *self,
                           const gchar *conversation,
                           GBytes *input,
                           GSimpleAsyncResult *task)
{
  AuthData *ad = NULL;

  ad = g_hash_table_lookup (self->authentication_pending, conversation);
  if (!ad)
    {
      g_simple_async_result_set_error (task, COCKPIT_ERROR,
                                       COCKPIT_ERROR_AUTHENTICATION_FAILED,
                                       "Invalid conversation token");
      g_simple_async_result_complete_in_idle (task);
    }
  else
    {
      g_simple_async_result_set_op_res_gpointer (task, auth_data_ref (ad), auth_data_unref);
      g_hash_table_remove (self->authentication_pending, conversation);
      auth_data_add_pending_result (ad, task);
      cockpit_auth_process_write_auth_bytes (ad->auth_process, input);
    }
}

static gboolean
start_auth_process (CockpitAuth *self,
                    AuthData *ad,
                    GBytes *input,
                    const gchar *section,
                    const gchar *host,
                    const gchar **argv,
                    const gchar **env)
{
  GError *error = NULL;

  guint pipe_timeout;
  guint idle_timeout;
  guint wanted_fd;

  /* How long to wait for the auth process to send some data */
  pipe_timeout = timeout_option ("timeout", section, cockpit_ws_auth_process_timeout);
  /* How long to wait for a response from the client to a auth prompt */
  idle_timeout = timeout_option ("response-timeout", section,
                                 cockpit_ws_auth_response_timeout);
  /* The wanted authfd for this command, default is 3 */
  wanted_fd = cockpit_conf_guint (section, "authFD", 3, 1024, 3);

  ad->auth_process = g_object_new (COCKPIT_TYPE_AUTH_PROCESS,
                                   "pipe-timeout", pipe_timeout,
                                   "idle-timeout", idle_timeout,
                                   "conversation", ad->conversation,
                                   "logname", argv[0],
                                   "name", host ? host : "localhost",
                                   "wanted-auth-fd", wanted_fd,
                                   NULL);

  if (cockpit_auth_process_start (ad->auth_process, argv,
                                  (const gchar **) env,
                                  -1, FALSE, &error))
    {
      g_signal_connect (ad->auth_process, "message",
                        G_CALLBACK (on_auth_process_message),
                        ad);
      g_signal_connect (ad->auth_process, "close",
                        G_CALLBACK (on_auth_process_close),
                        ad);
      g_signal_connect (ad->auth_process, "close",
                        G_CALLBACK (purge_auth_conversation),
                        self);
      cockpit_auth_process_write_auth_bytes (ad->auth_process, input);
      return TRUE;
    }
  else
    {
      g_warning ("failed to start %s: %s", argv[0], error->message);
      g_error_free (error);
      return FALSE;
    }
}

static void
cockpit_auth_spawn_login_async (CockpitAuth *self,
                                const gchar *path,
                                GIOStream *connection,
                                GHashTable *headers,
                                GAsyncReadyCallback callback,
                                gpointer user_data)
{
  GSimpleAsyncResult *result;
  AuthData *ad = NULL;
  CockpitAuthOptions *options = NULL;
  CockpitSshOptions *ssh_options = NULL;
  GBytes *authorization = NULL;

  const gchar *action;
  const gchar *section;
  const gchar *type;
  const gchar *program_default;
  const gchar *host;
  const gchar *command;
  const gchar *conversation;
  const gchar *authorized;

  gchar *application = NULL;
  gchar *remote_peer = get_remote_address (connection);

  const gchar *argv[] = {
    "command",
    "host",
     NULL,
  };

  gchar **env = g_get_environ ();

  result = g_simple_async_result_new (G_OBJECT (self), callback, user_data,
                                      cockpit_auth_spawn_login_async);

  application = cockpit_auth_parse_application (path, NULL);
  authorization = cockpit_auth_steal_authorization (headers, connection,
                                                    &type, &conversation);

  if (!application || !authorization)
    {
      g_simple_async_result_set_error (result, COCKPIT_ERROR, COCKPIT_ERROR_AUTHENTICATION_FAILED,
                                       "Authentication required");
      g_simple_async_result_complete_in_idle (result);
      goto out;
    }

  if (conversation)
    {
      cockpit_auth_resume_async (self, conversation, authorization, result);
      goto out;
    }

  host = application_parse_host (application);
  action = type_option (type, "action", "localhost");
  if (g_strcmp0 (action, ACTION_NONE) == 0)
    {
      g_simple_async_result_set_error (result, COCKPIT_ERROR, COCKPIT_ERROR_AUTHENTICATION_FAILED,
                                       "Authentication disabled");
      g_simple_async_result_complete_in_idle (result);
      goto out;
    }

  if (host)
    section = SSH_SECTION;
  else if (self->login_loopback && g_strcmp0 (type, "basic") == 0)
    section = SSH_SECTION;
  else if (g_strcmp0 (action, ACTION_SSH) == 0)
    section = SSH_SECTION;
  else
    section = type;

  ad = g_new0 (AuthData, 1);
  ad->refs = 1;
  ad->conversation = cockpit_auth_nonce (self);
  ad->pending_result = NULL;
  ad->response_data = NULL;
  ad->remote_peer = g_strdup (remote_peer);
  ad->auth_type = type;
  ad->authorization = g_bytes_ref (authorization);
  ad->application = g_strdup (application);

  /* Hang onto the password in credentials if requested */
  authorized = g_hash_table_lookup (headers, "X-Authorize");
  if (!authorized)
    authorized = "";
  ad->authorize_password = (strstr (authorized, "password") != NULL);

  if (g_strcmp0 (section, SSH_SECTION) == 0)
    {
      ad->is_ssh = TRUE;

      ssh_options = g_new0 (CockpitSshOptions, 1);
      ssh_options->supports_hostkey_prompt = TRUE;
      ssh_options->knownhosts_file = cockpit_ws_known_hosts;

      if (!host)
        {
          host = type_option (SSH_SECTION, "host", "127.0.0.1");
          ssh_options->ignore_hostkey = TRUE;
        }
      program_default = cockpit_ws_ssh_program;
      env = cockpit_ssh_options_to_env (ssh_options, env);
    }
  else
    {
      program_default = cockpit_ws_session_program;
    }

  command = type_option (section, "command", program_default);

  options = g_new0 (CockpitAuthOptions, 1);
  options->remote_peer = ad->remote_peer;
  options->auth_type = ad->auth_type;
  env = cockpit_auth_options_to_env (options, env);

  argv[0] = command;
  argv[1] = host ? host : "localhost";

  g_simple_async_result_set_op_res_gpointer (result,
                                             auth_data_ref (ad), auth_data_unref);
  if (start_auth_process (self, ad, authorization,
                           section, host,
                           argv, (const gchar **)env))
    {
      auth_data_add_pending_result (ad, result);
    }
  else
    {
      g_simple_async_result_set_error (result, COCKPIT_ERROR, COCKPIT_ERROR_FAILED,
                                       "Internal error starting %s", argv[0]);
      g_simple_async_result_complete_in_idle (result);
    }

out:
  g_free (application);
  g_strfreev (env);
  g_free (options);
  g_free (ssh_options);

  if (ad)
    auth_data_unref (ad);

  if (authorization)
    g_bytes_unref (authorization);

  g_object_unref (result);
}

static CockpitCreds *
cockpit_auth_spawn_login_finish (CockpitAuth *self,
                                 GAsyncResult *result,
                                 GIOStream *connection,
                                 GHashTable *headers,
                                 JsonObject **prompt_data,
                                 CockpitTransport **transport,
                                 GError **error)
{
  CockpitCreds *creds;
  CockpitPipe *pipe = NULL;
  gchar *gssapi_header = NULL;
  AuthData *ad;

  g_return_val_if_fail (g_simple_async_result_is_valid (result, G_OBJECT (self),
                        cockpit_auth_spawn_login_async), NULL);

  if (g_simple_async_result_propagate_error (G_SIMPLE_ASYNC_RESULT (result), error))
    return NULL;

  ad = g_simple_async_result_get_op_res_gpointer (G_SIMPLE_ASYNC_RESULT (result));

  creds = parse_cockpit_spawn_results (self, ad, headers, connection,
                                       prompt_data, &gssapi_header, error);

  if (gssapi_header)
    {
      g_hash_table_replace (headers, g_strdup ("WWW-Authenticate"), gssapi_header);
      g_debug ("gssapi: WWW-Authenticate: %s", gssapi_header);
    }
  else if (gssapi_available > 0)
    {
      g_hash_table_replace (headers, g_strdup ("WWW-Authenticate"), g_strdup ("Negotiate"));
    }

  if (creds)
    {
      if (transport)
        {
          pipe = cockpit_auth_process_claim_as_pipe (ad->auth_process);
          *transport = cockpit_pipe_transport_new (pipe);
          g_object_unref (pipe);
        }
    }
  else
    {
      if (prompt_data && *prompt_data)
        {
          cockpit_auth_prepare_login_reply (self, *prompt_data, headers, ad);
        }
      else if (gssapi_header)
        {
          g_hash_table_insert (self->authentication_pending, ad->conversation, auth_data_ref (ad));
          g_object_set_data_full (G_OBJECT (connection), "negotiate",
                                  g_strdup (ad->conversation), g_free);
        }
      else
        {
          if (connection)
            g_object_set_data (G_OBJECT (connection), "negotiate", NULL);
          cockpit_auth_process_terminate (ad->auth_process);
        }
    }

  g_free (ad->response_data);
  ad->response_data = NULL;

  return creds;
}

/* ---------------------------------------------------------------------- */

static void
cockpit_auth_class_init (CockpitAuthClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);

  gobject_class->finalize = cockpit_auth_finalize;

  klass->login_async = cockpit_auth_spawn_login_async;
  klass->login_finish = cockpit_auth_spawn_login_finish;

  sig__idling = g_signal_new ("idling", COCKPIT_TYPE_AUTH, G_SIGNAL_RUN_FIRST,
                              0, NULL, NULL, NULL, G_TYPE_NONE, 0);
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

static CockpitAuthenticated *
authenticated_for_headers (CockpitAuth *self,
                           const gchar *path,
                           GHashTable *in_headers)
{
  gchar *cookie = NULL;
  gchar *raw = NULL;
  const char *prefix = "v=2;k=";
  CockpitAuthenticated *ret = NULL;
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
            ret = g_hash_table_lookup (self->authenticated, cookie);
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
  CockpitAuthenticated *authenticated;

  authenticated = authenticated_for_headers (self, path, in_headers);
  if (authenticated)
    {
      g_debug ("received %s credential cookie for user '%s'",
               cockpit_creds_get_application (authenticated->creds),
               cockpit_creds_get_user (authenticated->creds));
      return g_object_ref (authenticated->service);
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
  CockpitAuthClass *klass = COCKPIT_AUTH_GET_CLASS (self);
  GSimpleAsyncResult *result = NULL;

  g_return_if_fail (klass->login_async != NULL);

  self->startups++;
  if (can_start_auth (self))
    {
      klass->login_async (self, path, connection, headers, callback, user_data);
    }
  else
    {
      g_message ("Request dropped; too many startup connections: %u", self->startups);
      result = g_simple_async_result_new_error (G_OBJECT (self), callback, user_data,
                                                COCKPIT_ERROR, COCKPIT_ERROR_FAILED,
                                               "Connection closed by host");
      g_simple_async_result_complete_in_idle (result);
    }

  if (result)
    g_object_unref (result);
}

static gboolean
on_authenticated_timeout (gpointer data)
{
  CockpitAuthenticated *authenticated = data;
  CockpitAuth *self = authenticated->auth;

  authenticated->timeout_tag = 0;

  if (cockpit_web_service_get_idling (authenticated->service))
    {
      g_info ("%s: timed out", cockpit_creds_get_user (authenticated->creds));
      g_hash_table_remove (self->authenticated, authenticated->cookie);
    }

  return FALSE;
}

static void
on_web_service_idling (CockpitWebService *service,
                       gpointer data)
{
  CockpitAuthenticated *authenticated = data;

  if (authenticated->timeout_tag)
    g_source_remove (authenticated->timeout_tag);

  g_debug ("%s: login is idle", cockpit_creds_get_user (authenticated->creds));

  /*
   * The minimum amount of time before a request uses this new web service,
   * otherwise it will just go away.
   */
  authenticated->timeout_tag = g_timeout_add_seconds (cockpit_ws_service_idle,
                                                      on_authenticated_timeout,
                                                      authenticated);

  /*
   * Also reset the timer which checks whether anything is going on in the
   * entire process or not.
   */
  if (authenticated->auth->timeout_tag)
    g_source_remove (authenticated->auth->timeout_tag);

  authenticated->auth->timeout_tag = g_timeout_add_seconds (cockpit_ws_process_idle,
                                                            on_process_timeout, authenticated->auth);
}

static void
on_web_service_destroy (CockpitWebService *service,
                        gpointer data)
{
  on_web_service_idling (service, data);
  cockpit_authenticated_destroy (data);
}

JsonObject *
cockpit_auth_login_finish (CockpitAuth *self,
                           GAsyncResult *result,
                           GIOStream *connection,
                           GHashTable *out_headers,
                           GError **error)
{
  CockpitAuthClass *klass = COCKPIT_AUTH_GET_CLASS (self);
  CockpitAuthenticated *authenticated;
  CockpitTransport *transport = NULL;
  JsonObject *prompt_data = NULL;
  CockpitCreds *creds;
  gchar *cookie_b64 = NULL;
  gchar *cookie_name = NULL;
  gchar *header;
  gchar *id;
  gboolean force_secure = TRUE;

  g_return_val_if_fail (klass->login_finish != NULL, FALSE);
  creds = klass->login_finish (self, result, connection, out_headers,
                               &prompt_data, &transport, error);
  self->startups--;

  if (creds == NULL)
    return prompt_data;

  id = cockpit_auth_nonce (self);
  authenticated = g_new0 (CockpitAuthenticated, 1);
  authenticated->cookie = g_strdup_printf ("v=2;k=%s", id);
  authenticated->creds = creds;
  authenticated->service = cockpit_web_service_new (creds, transport);
  authenticated->auth = self;

  authenticated->idling_sig = g_signal_connect (authenticated->service, "idling",
                                                G_CALLBACK (on_web_service_idling), authenticated);
  authenticated->destroy_sig = g_signal_connect (authenticated->service, "destroy",
                                                G_CALLBACK (on_web_service_destroy), authenticated);

  if (transport)
    g_object_unref (transport);

  g_object_weak_ref (G_OBJECT (authenticated->service),
                     on_web_service_gone, authenticated);

  /* Start off in the idling state, and begin a timeout during which caller must do something else */
  on_web_service_idling (authenticated->service, authenticated);

  g_hash_table_insert (self->authenticated, authenticated->cookie, authenticated);

  g_debug ("sending %s credential id '%s' for user '%s'", id,
           cockpit_creds_get_application (creds),
           cockpit_creds_get_user (creds));

  g_free (id);

  if (out_headers)
    {
      force_secure = connection ? !G_IS_SOCKET_CONNECTION (connection) : TRUE;
      cookie_name = application_cookie_name (cockpit_creds_get_application (creds));
      cookie_b64 = g_base64_encode ((guint8 *)authenticated->cookie, strlen (authenticated->cookie));
      header = g_strdup_printf ("%s=%s; Path=/; %s HttpOnly",
                                cookie_name, cookie_b64,
                                force_secure ? " Secure;" : "");
      g_free (cookie_b64);
      g_free (cookie_name);
      g_hash_table_insert (out_headers, g_strdup ("Set-Cookie"), header);
    }

  g_info ("logged in user: %s", cockpit_creds_get_user (authenticated->creds));

  return cockpit_creds_to_json (creds);
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
