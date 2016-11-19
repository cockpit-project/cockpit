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

#define ACTION_SPAWN_HEADER "spawn-login-with-header"
#define ACTION_SPAWN_DECODE "spawn-login-with-decoded"
#define ACTION_SSH "remote-login-ssh"
#define ACTION_CONVERSATION "x-conversation"
#define LOGIN_REPLY_HEADER "X-Conversation"
#define ACTION_NONE "none"

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

static gboolean gssapi_not_avail = FALSE;

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
  gchar *id;
  gchar *response_data;
  GBytes *authorization;
  gchar *remote_peer;
  gchar *auth_type;
  gchar *application;

  GSimpleAsyncResult *pending_result;

  gint refs;
  gpointer tag;

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

  g_free (ad->auth_type);
  g_free (ad->application);
  g_free (ad->remote_peer);
  g_free (ad->id);
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

static void
purge_auth_id (CockpitAuthProcess *auth_process,
               GError *error,
               const gchar *problem,
               gpointer user_data)
{
  CockpitAuth *self = user_data;
  const gchar *id = cockpit_auth_process_get_id (auth_process);
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
                                         ad->id, encoded_data));

  g_hash_table_insert (self->authentication_pending, ad->id, auth_data_ref (ad));

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

static const gchar *
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

  return password;
}

/*
 * Returns the Authorization type from the headers
 * Does not modify the header hashtable.
 */
gchar *
cockpit_auth_parse_authorization_type (GHashTable *headers)
{
  gchar *line;
  gchar *type;
  gchar *next;
  gpointer key;
  gsize i;

  /* Avoid copying as it can contain passwords */
  if (!g_hash_table_lookup_extended (headers, "Authorization", &key, (gpointer *)&line))
    return NULL;

  line = str_skip (line, ' ');
  next = strchr (line, ' ');

  if (!next)
    return NULL;

  type = g_strndup (line, next - line);
  for (i = 0; type[i] != '\0'; i++)
    type[i] = g_ascii_tolower (type[i]);

  return type;
}

/*
 * Returns contents of Authorization header from the headers
 * Removes the Authorization header from the hashtable.
 */
GBytes *
cockpit_auth_parse_authorization (GHashTable *headers,
                                  gboolean base64_decode)
{
  gchar *line;
  gchar *next;
  gchar *contents;
  gsize length;
  gpointer key;

  /* Avoid copying as it can contain passwords */
  if (!g_hash_table_lookup_extended (headers, "Authorization", &key, (gpointer *)&line))
    return NULL;

  g_hash_table_steal (headers, "Authorization");
  g_free (key);

  line = str_skip (line, ' ');
  next = strchr (line, ' ');
  if (!next)
    {
      g_free (line);
      return NULL;
    }

  contents = str_skip (next, ' ');
  if (base64_decode)
    {
      if (g_base64_decode_inplace (contents, &length) == NULL)
        {
          g_free (line);
          return NULL;
        }

      /* Null terminate for convenience, but null count not included in GBytes */
      contents[length] = '\0';
    }
  else
    {
      length = strlen (contents);
    }

  /* Avoid copying by using the line directly */
  return g_bytes_new_with_free_func (contents, length, clear_free_authorization, line);
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

static void
build_gssapi_output_header (GHashTable *headers,
                            JsonObject *results)
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
          return;
        }
    }

  if (!output)
    return;

  data = cockpit_hex_decode (output, &length);
  if (!data)
    {
      g_warning ("received invalid gssapi-output field");
      return;
    }
  if (length)
    {
      encoded = g_base64_encode (data, length);
      value = g_strdup_printf ("Negotiate %s", encoded);
      g_free (encoded);
    }
  else
    {
      value = g_strdup ("Negotiate");
    }
  g_free (data);

  g_hash_table_replace (headers, g_strdup ("WWW-Authenticate"), value);
  g_debug ("gssapi: WWW-Authenticate: %s", value);
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
  const gchar *password = NULL;
  const gchar *gssapi_creds = NULL;
  CockpitCreds *creds = NULL;
  gchar *csrf_token;

  /*
   * Dig the password out of the authorization header, rather than having
   * passing it back and forth possibly leaking it.
   */

  if (g_str_equal (ad->auth_type, "basic") ||
      g_str_equal (ad->auth_type, SSH_SECTION))
    {
      password = parse_basic_auth_password (ad->authorization, NULL);
    }

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

  g_free (csrf_token);
  return creds;
}

static CockpitCreds *
parse_cockpit_spawn_results (CockpitAuth *self,
                             AuthData *ad,
                             GHashTable *headers,
                             JsonObject **prompt_data,
                             GError **error)
{
  CockpitCreds *creds = NULL;
  JsonObject *results = NULL;
  const gchar *user;
  const gchar *error_str;

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
      else if (g_str_equal (ad->auth_type, "negotiate") &&
               cockpit_json_get_string (results, "error", NULL, &error_str))
        {
          if (g_strcmp0 (error_str, "authentication-unavailable") == 0)
            {
              gssapi_not_avail = TRUE;
              g_debug ("negotiate auth is not available, disabling");
              g_clear_error (error);
              g_set_error (error, COCKPIT_ERROR, COCKPIT_ERROR_AUTHENTICATION_FAILED,
                           "Negotiate authentication not available");
            }
        }

      build_gssapi_output_header (headers, results);
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

static AuthData *
create_auth_data (CockpitAuth *self,
                  const gchar *name,
                  const gchar *application,
                  const gchar *type,
                  const gchar *remote_peer,
                  const gchar *logname,
                  GBytes *input)
{
  guint pipe_timeout;
  guint idle_timeout;
  guint wanted_fd;
  AuthData *ad = NULL;

  /* How long to wait for the auth process to send some data */
  pipe_timeout = timeout_option ("timeout", type, cockpit_ws_auth_process_timeout);
  /* How long to wait for a response from the client to a auth prompt */
  idle_timeout = timeout_option ("response-timeout", type,
                                 cockpit_ws_auth_response_timeout);
  /* The wanted authfd for this command, default is 3 */
  wanted_fd = cockpit_conf_guint (type, "authFD", 3, 1024, 3);

  ad = g_new0 (AuthData, 1);
  ad->refs = 1;
  ad->id = cockpit_auth_nonce (self);
  ad->pending_result = NULL;
  ad->response_data = NULL;
  ad->tag = NULL;
  ad->remote_peer = g_strdup (remote_peer);
  ad->auth_type = g_strdup (type);
  ad->authorization = g_bytes_ref (input);
  ad->application = g_strdup (application);

  ad->auth_process = g_object_new (COCKPIT_TYPE_AUTH_PROCESS,
                                   "pipe-timeout", pipe_timeout,
                                   "idle-timeout", idle_timeout,
                                   "id", ad->id,
                                   "logname", logname,
                                   "name", name,
                                   "wanted-auth-fd", wanted_fd,
                                   NULL);
  return ad;
}

static void
start_auth_process (CockpitAuth *self,
                    AuthData *ad,
                    GBytes *input,
                    GSimpleAsyncResult *result,
                    gpointer tag,
                    const gchar **argv,
                    const gchar **env)
{
  GError *error = NULL;

  g_simple_async_result_set_op_res_gpointer (result,
                                             auth_data_ref (ad), auth_data_unref);

  if (cockpit_auth_process_start (ad->auth_process, argv, env, -1, FALSE, &error))
    {
      auth_data_add_pending_result (ad, result);
      g_signal_connect (ad->auth_process, "message",
                        G_CALLBACK (on_auth_process_message),
                        ad);
      g_signal_connect (ad->auth_process, "close",
                        G_CALLBACK (on_auth_process_close),
                        ad);
      g_signal_connect (ad->auth_process, "close",
                        G_CALLBACK (purge_auth_id),
                        self);
      cockpit_auth_process_write_auth_bytes (ad->auth_process, input);
    }
  else
    {
      g_warning ("failed to start %s: %s", argv[0], error->message);
      g_error_free (error);

      g_simple_async_result_set_error (result, COCKPIT_ERROR, COCKPIT_ERROR_FAILED,
                                       "Internal error starting %s", argv[0]);
      g_simple_async_result_complete_in_idle (result);
    }
}

static void
cockpit_auth_spawn_login_async (CockpitAuth *self,
                                const gchar *application,
                                const gchar *type,
                                gboolean decode_header,
                                GHashTable *headers,
                                const gchar *remote_peer,
                                GAsyncReadyCallback callback,
                                gpointer user_data)
{
  GSimpleAsyncResult *result;
  GBytes *input = NULL;
  AuthData *ad = NULL;
  const gchar *command;

  const gchar *argv[] = {
      "command",
      type,
      remote_peer ? remote_peer : "",
      NULL,
  };

  result = g_simple_async_result_new (G_OBJECT (self), callback, user_data,
                                      cockpit_auth_spawn_login_async);

  command = type_option (type, "command", cockpit_ws_session_program);

  input = cockpit_auth_parse_authorization (headers, decode_header);
  if (!input && !gssapi_not_avail && g_strcmp0 (type, "negotiate") == 0)
    input = g_bytes_new_static ("", 0);

  if (input && application)
    {
      argv[0] = command;
      ad = create_auth_data (self, "localhost", application,
                             type, remote_peer, command, input);
      start_auth_process (self, ad, input, result,
                          cockpit_auth_spawn_login_async, argv, NULL);
    }
  else
    {
      g_simple_async_result_set_error (result, COCKPIT_ERROR, COCKPIT_ERROR_AUTHENTICATION_FAILED,
                                       "Authentication required");
      g_simple_async_result_complete_in_idle (result);
    }

  if (input)
    g_bytes_unref (input);

  if (ad)
    auth_data_unref (ad);

  g_object_unref (result);
}

static CockpitCreds *
cockpit_auth_spawn_login_finish (CockpitAuth *self,
                                 GAsyncResult *result,
                                 GHashTable *headers,
                                 JsonObject **prompt_data,
                                 CockpitTransport **transport,
                                 GError **error)
{
  CockpitCreds *creds;
  CockpitPipe *pipe = NULL;
  AuthData *ad;

  g_return_val_if_fail (g_simple_async_result_is_valid (result, G_OBJECT (self),
                        cockpit_auth_spawn_login_async), NULL);

  ad = g_simple_async_result_get_op_res_gpointer (G_SIMPLE_ASYNC_RESULT (result));

  if (g_simple_async_result_propagate_error (G_SIMPLE_ASYNC_RESULT (result), error))
    return NULL;

  creds = parse_cockpit_spawn_results (self, ad, headers, prompt_data, error);

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
        cockpit_auth_prepare_login_reply (self, *prompt_data, headers, ad);
      else
        cockpit_auth_process_terminate (ad->auth_process);
    }

  g_free (ad->response_data);
  ad->response_data = NULL;

  return creds;
}


/* ------------------------------------------------------------------------
 * Remote login by using ssh even locally
 */

static CockpitCreds *
parse_ssh_spawn_results (CockpitAuth *self,
                         AuthData *ad,
                         GHashTable *headers,
                         JsonObject **prompt_data,
                         GError **error)
{
  CockpitCreds *creds = NULL;
  JsonObject *results = NULL;
  JsonObject *auth_results = NULL;
  const gchar *pw_result = NULL;
  const gchar *user;
  const gchar *error_str;

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
      else if (cockpit_json_get_string (results, "error", NULL, &error_str))
        {
          if (g_strcmp0 (error_str, "authentication-failed") == 0)
            {
              cockpit_json_get_object (results, "auth-method-results", NULL, &auth_results);
              if (auth_results)
                cockpit_json_get_string (auth_results, "password", NULL, &pw_result);

              if (!pw_result || g_strcmp0 (pw_result, "no-server-support") == 0)
                {
                  g_clear_error (error);
                  g_set_error (error, COCKPIT_ERROR,
                               COCKPIT_ERROR_AUTHENTICATION_FAILED,
                               "Authentication failed: authentication-not-supported");
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
      json_object_unref (results);
    }

  return creds;
}

static void
cockpit_auth_remote_login_async (CockpitAuth *self,
                                 const gchar *application,
                                 const gchar *type,
                                 GHashTable *headers,
                                 const gchar *remote_peer,
                                 GAsyncReadyCallback callback,
                                 gpointer user_data)
{
  GSimpleAsyncResult *task;
  AuthData *ad = NULL;
  GBytes *input = NULL;
  GBytes *auth_bytes = NULL;
  gchar *user = NULL;
  gchar *password = NULL; /* owned by input */
  gchar *host_arg = NULL;
  CockpitAuthOptions *options = NULL;
  CockpitSshOptions *ssh_options = NULL;

  const gchar *data = NULL;
  const gchar *command;
  const gchar *host;

  const gchar *argv[] = {
      cockpit_ws_ssh_program,
      NULL,
      NULL,
  };

  gchar **env = g_get_environ ();

  task = g_simple_async_result_new (G_OBJECT (self), callback, user_data,
                                    cockpit_auth_remote_login_async);
  if (g_strcmp0 (type, "basic") == 0)
    {
      input = cockpit_auth_parse_authorization (headers, TRUE);
      data = g_bytes_get_data (input, NULL);

      password = strchr (data, ':');
      if (password != NULL)
        {
          user = g_strndup (data, password - data);
          password++;
          auth_bytes = g_bytes_new_static (password, strlen(password));
        }
    }
  else
    {
      input = cockpit_auth_parse_authorization (headers, FALSE);
      if (input)
        auth_bytes = g_bytes_ref (input);
    }

  /* TODO: This will change with standardization refactoring */
  if (application && auth_bytes && input)
    {
      command = type_option (SSH_SECTION, "command", cockpit_ws_ssh_program);
      argv[0] = command;

      options = g_new0 (CockpitAuthOptions, 1);
      options->remote_peer = remote_peer;
      options->auth_type = "password";
      options->supports_conversations = TRUE;

      ssh_options = g_new0 (CockpitSshOptions, 1);
      ssh_options->supports_hostkey_prompt = TRUE;

      host = application_parse_host (application);
      if (!host)
        {
          ssh_options->ignore_hostkey = TRUE;
          if (cockpit_conf_string (SSH_SECTION, "host"))
            host = cockpit_conf_string (SSH_SECTION, "host");
          else
            host = "localhost";
        }

      if (user && user[0] != '\0')
          host_arg = g_strdup_printf ("%s@%s", user, host);
      else
          host_arg = g_strdup (host);

      env = cockpit_auth_options_to_env (options, env);
      env = cockpit_ssh_options_to_env (ssh_options, env);

      argv[1] = host_arg;
      ad = create_auth_data (self, host_arg, application,
                             SSH_SECTION, remote_peer, command, input);
      start_auth_process (self, ad, auth_bytes, task,
                          cockpit_auth_remote_login_async, argv,
                          (const gchar **) env);
    }
  else
    {
      g_simple_async_result_set_error (task, COCKPIT_ERROR, COCKPIT_ERROR_AUTHENTICATION_FAILED,
                                       "Basic authentication required");
      g_simple_async_result_complete_in_idle (task);
    }

  if (auth_bytes)
    g_bytes_unref (auth_bytes);

  if (input)
    g_bytes_unref (input);

  if (ad)
    auth_data_unref (ad);

  g_strfreev (env);
  g_free (host_arg);
  g_free (user);
  g_free (options);
  g_free (ssh_options);
  g_object_unref (task);
}

static CockpitCreds *
cockpit_auth_remote_login_finish (CockpitAuth *self,
                                  GAsyncResult *result,
                                  GHashTable *headers,
                                  JsonObject **prompt_data,
                                  CockpitTransport **transport,
                                  GError **error)
{
  CockpitCreds *creds;
  CockpitPipe *pipe = NULL;
  AuthData *ad;

  g_return_val_if_fail (g_simple_async_result_is_valid (result, G_OBJECT (self),
                        cockpit_auth_remote_login_async), NULL);

  ad = g_simple_async_result_get_op_res_gpointer (G_SIMPLE_ASYNC_RESULT (result));

  if (g_simple_async_result_propagate_error (G_SIMPLE_ASYNC_RESULT (result), error))
    return NULL;

  creds = parse_ssh_spawn_results (self, ad, headers, prompt_data, error);

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
        cockpit_auth_prepare_login_reply (self, *prompt_data, headers, ad);
      else
        cockpit_auth_process_terminate (ad->auth_process);
    }

  g_free (ad->response_data);
  ad->response_data = NULL;

  return creds;
}

/* ---------------------------------------------------------------------- */

static void
cockpit_auth_none_login_async (CockpitAuth *self,
                               GAsyncReadyCallback callback,
                               gpointer user_data)
{
  GSimpleAsyncResult *task;

  task = g_simple_async_result_new (G_OBJECT (self), callback, user_data,
                                    cockpit_auth_none_login_async);

  g_simple_async_result_set_error (task, COCKPIT_ERROR, COCKPIT_ERROR_AUTHENTICATION_FAILED,
                                   "Authentication disabled");
  g_simple_async_result_complete_in_idle (task);
  g_object_unref (task);
}


static CockpitCreds *
cockpit_auth_none_login_finish (CockpitAuth *self,
                                  GAsyncResult *result,
                                  GHashTable *headers,
                                  JsonObject **prompt_data,
                                  CockpitTransport **transport,
                                  GError **error)
{
  g_return_val_if_fail (g_simple_async_result_is_valid (result, G_OBJECT (self),
                        cockpit_auth_none_login_async), NULL);

  g_simple_async_result_propagate_error (G_SIMPLE_ASYNC_RESULT (result), error);
  return NULL;
}

/* ---------------------------------------------------------------------- */

static void
cockpit_auth_resume_async (CockpitAuth *self,
                           const gchar *application,
                           const gchar *type,
                           GHashTable *headers,
                           const gchar *remote_peer,
                           GAsyncReadyCallback callback,
                           gpointer user_data)
{
  AuthData *ad = NULL;
  GSimpleAsyncResult *task;
  GBytes *input = NULL;
  gchar **parts = NULL;
  gchar *header = NULL;
  gsize length;

  header = g_hash_table_lookup (headers, "Authorization");
  if (header)
    parts = g_strsplit (header, " ", 3);

  if (parts && g_strv_length (parts) == 3)
      ad = g_hash_table_lookup (self->authentication_pending, parts[1]);

  if (!ad)
    {
      task = g_simple_async_result_new (G_OBJECT (self), callback, user_data,
                                        cockpit_auth_none_login_async);

      g_simple_async_result_set_error (task, COCKPIT_ERROR,
                                       COCKPIT_ERROR_AUTHENTICATION_FAILED,
                                       "Invalid resume token");
      g_simple_async_result_complete_in_idle (task);
    }
  else
    {

      task = g_simple_async_result_new (G_OBJECT (self), callback, user_data,
                                        ad->tag);
      g_simple_async_result_set_op_res_gpointer (task, auth_data_ref (ad), auth_data_unref);
      g_hash_table_remove (self->authentication_pending, parts[1]);

      if (!g_base64_decode_inplace (parts[2], &length) || length < 1)
        {
          g_simple_async_result_set_error (task, COCKPIT_ERROR,
                                           COCKPIT_ERROR_AUTHENTICATION_FAILED,
                                           "Invalid resume token");
          g_simple_async_result_complete_in_idle (task);
        }
      else
        {
          input = g_bytes_new (parts[2], length);
          auth_data_add_pending_result (ad, task);
          cockpit_auth_process_write_auth_bytes (ad->auth_process, input);
          g_bytes_unref (input);
        }
    }

  if (parts)
    g_strfreev (parts);
  g_object_unref (task);
}

static const gchar *
action_for_type (const gchar *type,
                 const gchar *application,
                 gboolean force_ssh)
{
  const gchar *action;
  const gchar *host;

  g_return_val_if_fail (type != NULL, NULL);
  g_return_val_if_fail (application != NULL, NULL);

  host = application_parse_host (application);
  if (g_strcmp0 (type, ACTION_CONVERSATION) == 0)
    action = ACTION_CONVERSATION;

  else if (host)
    action = ACTION_SSH;

  /* Only force_ssh for basic */
  else if (force_ssh && g_strcmp0 (type, "basic") == 0)
    action = ACTION_SSH;

  else if (type && cockpit_conf_string (type, "action"))
      action = cockpit_conf_string (type, "action");

  else if (g_strcmp0 (type, "basic") == 0 ||
           g_strcmp0 (type, "negotiate") == 0)
      action = ACTION_SPAWN_DECODE;

  else
      action = ACTION_NONE;

  return action;
}

static void
cockpit_auth_choose_login_async (CockpitAuth *self,
                                 const gchar *path,
                                 GHashTable *headers,
                                 const gchar *remote_peer,
                                 GAsyncReadyCallback callback,
                                 gpointer user_data)
{
  const gchar *action;
  gchar *application = NULL;
  gchar *type = NULL;

  application = cockpit_auth_parse_application (path);
  type = cockpit_auth_parse_authorization_type (headers);
  if (!type)
    type = g_strdup ("negotiate");

  action = action_for_type (type, application, self->login_loopback);
  if (g_strcmp0 (action, ACTION_SPAWN_HEADER) == 0)
    {
      cockpit_auth_spawn_login_async (self, application, type, FALSE,
                                      headers, remote_peer,
                                      callback, user_data);
    }
  else if (g_strcmp0 (action, ACTION_SPAWN_DECODE) == 0)
    {
      cockpit_auth_spawn_login_async (self, application, type, TRUE,
                                       headers, remote_peer,
                                       callback, user_data);
    }
  else if (g_strcmp0 (action, ACTION_SSH) == 0)
    {
      cockpit_auth_remote_login_async (self, application, type,
                                       headers, remote_peer,
                                       callback, user_data);
    }
  else if (g_strcmp0 (action, ACTION_CONVERSATION) == 0)
    {
      cockpit_auth_resume_async (self, application, type,
                                 headers, remote_peer,
                                 callback, user_data);
    }
  else if (g_strcmp0 (action, ACTION_NONE) == 0)
    {
      cockpit_auth_none_login_async (self, callback, user_data);
    }
  else
    {
      g_message ("got unknown login action: %s", action);
      cockpit_auth_none_login_async (self, callback, user_data);
    }

  g_free (type);
  g_free (application);
}

static CockpitCreds *
cockpit_auth_choose_login_finish (CockpitAuth *self,
                                  GAsyncResult *result,
                                  GHashTable *headers,
                                  JsonObject **prompt_data,
                                  CockpitTransport **transport,
                                  GError **error)
{
  CockpitCreds *creds = NULL;

  if (g_simple_async_result_is_valid (result, G_OBJECT (self),
                                      cockpit_auth_spawn_login_async))
    {
      creds = cockpit_auth_spawn_login_finish (self, result, headers,
                                               prompt_data, transport, error);
    }
  else if (g_simple_async_result_is_valid (result, G_OBJECT (self),
                                           cockpit_auth_remote_login_async))
    {
      creds = cockpit_auth_remote_login_finish (self, result, headers,
                                                prompt_data, transport, error);
    }
  else if (g_simple_async_result_is_valid (result, G_OBJECT (self),
                                           cockpit_auth_none_login_async))
    {
      creds = cockpit_auth_none_login_finish (self, result, headers,
                                              prompt_data, transport, error);
    }
  else
    {
       g_critical ("Got invalid GAsyncResult. This is a programmer error.");
    }

    return creds;
}

static void
cockpit_auth_class_init (CockpitAuthClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);

  gobject_class->finalize = cockpit_auth_finalize;

  klass->login_async = cockpit_auth_choose_login_async;
  klass->login_finish = cockpit_auth_choose_login_finish;

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

  application = cockpit_auth_parse_application (path);
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
                          GHashTable *headers,
                          const gchar *remote_peer,
                          GAsyncReadyCallback callback,
                          gpointer user_data)
{
  CockpitAuthClass *klass = COCKPIT_AUTH_GET_CLASS (self);
  GSimpleAsyncResult *result = NULL;

  g_return_if_fail (klass->login_async != NULL);

  self->startups++;
  if (can_start_auth (self))
    {
      klass->login_async (self, path, headers, remote_peer, callback, user_data);
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
                           CockpitAuthFlags flags,
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

  g_return_val_if_fail (klass->login_finish != NULL, FALSE);
  creds = klass->login_finish (self, result, out_headers,
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
      gboolean force_secure = !(flags & COCKPIT_AUTH_COOKIE_INSECURE);
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
cockpit_auth_parse_application (const gchar *path)
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

  g_free (tmp);
  return val;
}
