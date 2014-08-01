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
#include "cockpitwebserver.h"
#include "cockpitws.h"

#include <gsystem-local-alloc.h>

#include "websocket/websocket.h"

#include "common/cockpiterror.h"
#include "common/cockpitlog.h"
#include "common/cockpitjson.h"
#include "common/cockpitpipe.h"
#include "common/cockpitmemory.h"

#include <glib/gstdio.h>


#include <sys/types.h>
#include <sys/socket.h>

#include <stdio.h>
#include <string.h>
#include <errno.h>
#include <unistd.h>
#include <sys/wait.h>
#include <pwd.h>
#include <grp.h>

#include <security/pam_appl.h>
#include <stdlib.h>

/* Timeout of authentication when no connections */
guint cockpit_ws_idle_timeout = 15;

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

static void
cockpit_auth_finalize (GObject *object)
{
  CockpitAuth *self = COCKPIT_AUTH (object);

  g_byte_array_unref (self->key);
  g_hash_table_destroy (self->authenticated);

  G_OBJECT_CLASS (cockpit_auth_parent_class)->finalize (object);
}

static void
cockpit_auth_init (CockpitAuth *self)
{
  gint fd;

  self->key = g_byte_array_new ();
  g_byte_array_set_size (self->key, 128);
  fd = g_open ("/dev/urandom", O_RDONLY, 0);
  if (fd < 0 || read (fd, self->key->data, 128) != 128)
    g_error ("couldn't read random key, startup aborted");
  close (fd);

  self->authenticated = g_hash_table_new_full (g_str_hash, g_str_equal,
                                               NULL, cockpit_authenticated_free);
}

struct passwd *
cockpit_getpwnam_a (const gchar *user,
                    int *errp)
{
  int err;
  long bufsize = sysconf (_SC_GETPW_R_SIZE_MAX);
  struct passwd *ret = NULL;
  struct passwd *buf;

  g_return_val_if_fail (bufsize >= 0, NULL);

  buf = malloc (sizeof(struct passwd) + bufsize);
  if (buf == NULL)
    err = ENOMEM;
  else
    err = getpwnam_r (user, buf, (char *)(buf + 1), bufsize, &ret);

  if (ret == NULL)
    {
      free (buf);
      if (err == 0)
        err = ENOENT;
    }

  if (errp)
    *errp = err;
  return ret;
}

static CockpitPipe *
spawn_session_process (const gchar *user,
                       GBytes *password,
                       const gchar *remote_peer,
                       CockpitPipe **auth_pipe)
{
  CockpitPipe *pipe;
  int pwfds[2] = { -1, -1 };
  GError *error = NULL;
  char autharg[32];
  GPid pid = 0;
  gint in_fd = -1;
  gint out_fd = -1;

  const gchar *argv[] = {
      cockpit_ws_session_program,
      "-p", autharg,
      user ? user : "",
      remote_peer ? remote_peer : "",
      NULL,
  };

  g_return_val_if_fail (password != NULL, NULL);

  if (socketpair (PF_UNIX, SOCK_STREAM, 0, pwfds) < 0)
    g_return_val_if_reached (NULL);
  g_snprintf (autharg, sizeof (autharg), "%d", pwfds[1]);

  if (!g_spawn_async_with_pipes (NULL, (gchar **)argv, NULL,
                                 G_SPAWN_DO_NOT_REAP_CHILD | G_SPAWN_LEAVE_DESCRIPTORS_OPEN,
                                 NULL, NULL, &pid, &in_fd, &out_fd, NULL, &error))
    {
      g_warning ("failed to start %s: %s", cockpit_ws_session_program, error->message);
      g_error_free (error);
      return NULL;

    }
  else
    {
      pipe = g_object_new (COCKPIT_TYPE_PIPE,
                           "name", "localhost",
                           "pid", pid,
                           "in-fd", out_fd,
                           "out-fd", in_fd,
                           NULL);

      if (password)
        {
          /* Child process end of pipe */
          close (pwfds[1]);

          *auth_pipe = cockpit_pipe_new ("password-pipe", pwfds[0], pwfds[0]);
          cockpit_pipe_write (*auth_pipe, password);
          cockpit_pipe_close (*auth_pipe, NULL);
        }
    }

  return pipe;
}

gboolean
cockpit_auth_parse_input (GBytes *input,
                          gchar **ret_user,
                          GBytes **ret_password,
                          GError **error)
{
  gchar *user = NULL;
  GBytes *password = NULL;
  const gchar *post;
  const gchar *line;
  gboolean ret;
  gsize length;
  gsize offset;

  if (input)
    {
      post = g_bytes_get_data (input, &length);
      line = memchr (post, '\n', length);
      if (line && line != post)
        {
          user = g_strndup (post, line - post);
          offset = (line - post) + 1;

          /* No newline allowed in password */
          if (memchr (post + offset, '\n', length - offset) == NULL)
            password = g_bytes_new_from_bytes (input, offset, length - offset);
        }
    }

  if (!user)
    {
      g_set_error (error, COCKPIT_ERROR, COCKPIT_ERROR_AUTHENTICATION_FAILED,
                   "Authentication failed");
      ret = FALSE;
    }
  else if (user && password)
    {
      if (ret_user)
        {
          *ret_user = user;
          user = NULL;
        }
      if (ret_password)
        {
          *ret_password = password;
          password = NULL;
        }
      ret = TRUE;
    }
  else
    {
      g_set_error (error, G_IO_ERROR, G_IO_ERROR_INVALID_DATA,
                   "Malformed input");
      ret = FALSE;
    }

  if (password)
    g_bytes_unref (password);
  g_free (user);
  return ret;
}

typedef struct {
  CockpitPipe *session_pipe;
  CockpitPipe *auth_pipe;
  GBytes *password;
  gchar *remote_peer;
} LoginData;

static void
login_data_free (gpointer data)
{
  LoginData *login = data;
  if (login->session_pipe)
    g_object_unref (login->session_pipe);
  if (login->auth_pipe)
    g_object_unref (login->auth_pipe);
  if (login->password)
    g_bytes_unref (login->password);
  g_free (login->remote_peer);
  g_free (login);
}

static void
on_login_done (CockpitPipe *pipe,
               const gchar *problem,
               gpointer user_data)
{
  GSimpleAsyncResult *result = G_SIMPLE_ASYNC_RESULT (user_data);

  if (problem)
    {
      g_warning ("cockpit session failed during auth: %s", problem);
      g_simple_async_result_set_error (result, COCKPIT_ERROR, COCKPIT_ERROR_FAILED,
                                       "Internal error in session process");
    }

  g_simple_async_result_complete (result);
  g_object_unref (result);
}

static void
cockpit_auth_session_login_async (CockpitAuth *self,
                                  GHashTable *headers,
                                  GBytes *input,
                                  const gchar *remote_peer,
                                  GAsyncReadyCallback callback,
                                  gpointer user_data)
{
  GSimpleAsyncResult *result;
  GBytes *password = NULL;
  gchar *user = NULL;
  LoginData *login;
  GError *error = NULL;

  result = g_simple_async_result_new (G_OBJECT (self), callback, user_data,
                                      cockpit_auth_session_login_async);

  if (!cockpit_auth_parse_input (input, &user, &password, &error))
    {
      g_message ("couldn't parse login input: %s", error->message);
      g_simple_async_result_take_error (result, error);
      g_simple_async_result_complete_in_idle (result);
    }
  else
    {
      login = g_new0 (LoginData, 1);
      login->password = password;
      login->remote_peer = g_strdup (remote_peer);
      g_simple_async_result_set_op_res_gpointer (result, login, login_data_free);

      g_assert (password != NULL);
      login->session_pipe = spawn_session_process (user, password, remote_peer,
                                                   &login->auth_pipe);

      if (login->session_pipe)
        {
          g_signal_connect (login->auth_pipe, "close",
                            G_CALLBACK (on_login_done), g_object_ref (result));
        }
      else
        {
          g_simple_async_result_set_error (result, COCKPIT_ERROR, COCKPIT_ERROR_FAILED,
                                           "Internal error starting session process");
          g_simple_async_result_complete_in_idle (result);
        }
    }

  g_free (user);
  g_object_unref (result);
}

static CockpitCreds *
parse_auth_results (LoginData *login,
                    GError **error)
{
  CockpitCreds *creds = NULL;
  GByteArray *buffer;
  GError *json_error = NULL;
  const gchar *pam_user;
  JsonObject *results;
  gconstpointer data;
  gint64 code = -1;
  gchar *password;
  gsize length;

  buffer = cockpit_pipe_get_buffer (login->auth_pipe);
  g_debug ("cockpit-session says: %.*s", (int)buffer->len, (const gchar *)buffer->data);

  results = cockpit_json_parse_object ((const gchar *)buffer->data, buffer->len, &json_error);

  if (g_error_matches (json_error, JSON_PARSER_ERROR, JSON_PARSER_ERROR_INVALID_DATA))
    {
      g_message ("got non-utf8 user name from cockpit-session");
      g_set_error (error, G_IO_ERROR, G_IO_ERROR_INVALID_DATA,
                   "Login user name is not UTF8 encoded");
      g_error_free (json_error);
      return NULL;
    }

  if (!results)
    {
      g_warning ("couldn't parse session auth output: %s", json_error->message);
      g_error_free (json_error);
      return NULL;
    }

  if (!cockpit_json_get_int (results, "pam-result", -1, &code) || code < 0)
    {
      g_set_error (error, G_IO_ERROR, G_IO_ERROR_INVALID_DATA,
                   "Invalid data from session process: bad PAM result");
    }
  else if (code == PAM_SUCCESS)
    {
      if (!cockpit_json_get_string (results, "user", NULL, &pam_user) || !pam_user)
        {
          g_set_error (error, G_IO_ERROR, G_IO_ERROR_INVALID_DATA,
                       "Invalid data from session process: missing user");
        }
      else
        {
          g_debug ("user authenticated as %s", pam_user);

          /* TODO: Try to avoid copying password */
          data = g_bytes_get_data (login->password, &length);
          password = g_strndup (data, length);
          creds = cockpit_creds_new (pam_user,
                                     COCKPIT_CRED_PASSWORD, password,
                                     COCKPIT_CRED_RHOST, login->remote_peer,
                                     NULL);
          g_free (password);
        }
    }
  else if (code == PAM_AUTH_ERR || code == PAM_USER_UNKNOWN)
    {
      g_debug ("authentication failed: %d", (int)code);
      g_set_error (error, COCKPIT_ERROR, COCKPIT_ERROR_AUTHENTICATION_FAILED,
                   "Authentication failed");
    }
  else
    {
      g_debug ("pam error: %d", (int)code);
      g_set_error (error, COCKPIT_ERROR, COCKPIT_ERROR_FAILED,
                   "%s", pam_strerror (NULL, code));
    }

  json_object_unref (results);
  return creds;
}

static CockpitCreds *
cockpit_auth_session_login_finish (CockpitAuth *self,
                                   GAsyncResult *result,
                                   CockpitPipe **session,
                                   GError **error)
{
  CockpitCreds *creds;
  LoginData *login;

  g_return_val_if_fail (g_simple_async_result_is_valid (result, G_OBJECT (self),
                        cockpit_auth_session_login_async), NULL);

  if (g_simple_async_result_propagate_error (G_SIMPLE_ASYNC_RESULT (result), error))
    return NULL;

  login = g_simple_async_result_get_op_res_gpointer (G_SIMPLE_ASYNC_RESULT (result));

  creds = parse_auth_results (login, error);
  if (!creds)
    return NULL;

  if (session)
    {
      *session = login->session_pipe;
      login->session_pipe = NULL;
    }

  return creds;
}

static void
cockpit_auth_class_init (CockpitAuthClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);

  gobject_class->finalize = cockpit_auth_finalize;

  klass->login_async = cockpit_auth_session_login_async;
  klass->login_finish = cockpit_auth_session_login_finish;
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
                           GHashTable *in_headers)
{
  gs_unref_hashtable GHashTable *cookies = NULL;
  gs_free gchar *cookie = NULL;
  const char *prefix = "v=2;k=";

  g_return_val_if_fail (self != NULL, FALSE);
  g_return_val_if_fail (in_headers != NULL, FALSE);

  if (!cockpit_web_server_parse_cookies (in_headers, &cookies, NULL))
    return NULL;

  cookie = base64_decode_string (g_hash_table_lookup (cookies, "CockpitAuth"));
  if (cookie == NULL)
    return NULL;

  if (!g_str_has_prefix (cookie, prefix))
    {
      g_debug ("invalid or unsupported cookie: %s", cookie);
      return NULL;
    }

  return g_hash_table_lookup (self->authenticated, cookie);
}

CockpitWebService *
cockpit_auth_check_cookie (CockpitAuth *self,
                           GHashTable *in_headers)
{
  CockpitAuthenticated *authenticated;

  authenticated = authenticated_for_headers (self, in_headers);

  if (authenticated)
    {
      g_debug ("received credential cookie for user '%s'",
               cockpit_creds_get_user (authenticated->creds));
      return g_object_ref (authenticated->service);
    }
  else
    {
      g_debug ("received unknown/invalid credential cookie");
      return NULL;
    }
}

void
cockpit_auth_login_async (CockpitAuth *self,
                          GHashTable *headers,
                          GBytes *input,
                          const gchar *remote_peer,
                          GAsyncReadyCallback callback,
                          gpointer user_data)
{
  CockpitAuthClass *klass = COCKPIT_AUTH_GET_CLASS (self);
  g_return_if_fail (klass->login_async != NULL);
  klass->login_async (self, headers, input, remote_peer, callback, user_data);
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
  authenticated->timeout_tag = g_timeout_add_seconds (cockpit_ws_idle_timeout,
                                                      on_authenticated_timeout,
                                                      authenticated);
}

static void
on_web_service_destroy (CockpitWebService *service,
                        gpointer data)
{
  cockpit_authenticated_destroy (data);
}

CockpitWebService *
cockpit_auth_login_finish (CockpitAuth *self,
                           GAsyncResult *result,
                           gboolean force_secure,
                           GHashTable *out_headers,
                           GError **error)
{
  CockpitAuthClass *klass = COCKPIT_AUTH_GET_CLASS (self);
  CockpitAuthenticated *authenticated;
  CockpitPipe *session = NULL;
  CockpitCreds *creds;
  gchar *cookie_b64 = NULL;
  gchar *header;
  guint64 seed;
  gchar *id;

  g_return_val_if_fail (klass->login_finish != NULL, FALSE);
  creds = klass->login_finish (self, result, &session, error);

  if (creds == NULL)
    return NULL;

  seed = self->nonce_seed++;
  id = g_compute_hmac_for_data (G_CHECKSUM_SHA256,
                                self->key->data, self->key->len,
                                (guchar *)&seed, sizeof (seed));

  authenticated = g_new0 (CockpitAuthenticated, 1);
  authenticated->cookie = g_strdup_printf ("v=2;k=%s", id);
  authenticated->creds = creds;
  authenticated->service = cockpit_web_service_new (creds, session);
  authenticated->auth = self;

  authenticated->idling_sig = g_signal_connect (authenticated->service, "idling",
                                                G_CALLBACK (on_web_service_idling), authenticated);
  authenticated->destroy_sig = g_signal_connect (authenticated->service, "destroy",
                                                G_CALLBACK (on_web_service_destroy), authenticated);

  if (session)
    g_object_unref (session);

  g_object_weak_ref (G_OBJECT (authenticated->service),
                     on_web_service_gone, authenticated);

  /* Start off in the idling state, and begin a timeout during which caller must do something else */
  on_web_service_idling (authenticated->service, authenticated);

  g_hash_table_insert (self->authenticated, authenticated->cookie, authenticated);

  g_debug ("sending credential id '%s' for user '%s'", id,
           cockpit_creds_get_user (creds));

  g_free (id);

  if (out_headers)
    {
      cookie_b64 = g_base64_encode ((guint8 *)authenticated->cookie, strlen (authenticated->cookie));
      header = g_strdup_printf ("CockpitAuth=%s; Path=/; Expires=Wed, 13-Jan-2021 22:23:01 GMT;%s HttpOnly",
                                cookie_b64, force_secure ? " Secure;" : "");
      g_free (cookie_b64);
      g_hash_table_insert (out_headers, g_strdup ("Set-Cookie"), header);
    }

  g_info ("logged in user: %s", cockpit_creds_get_user (authenticated->creds));
  return g_object_ref (authenticated->service);
}

CockpitAuth *
cockpit_auth_new (void)
{
  return (CockpitAuth *)g_object_new (COCKPIT_TYPE_AUTH, NULL);
}

/**
 * cockpit_auth_start_session:
 * @creds: credentials for the session
 *
 * Start a local session process for the given credentials.
 *
 * If launching the session fails, then the pipe will be created in a
 * failed state, and will close shortly. A CockpitPipe is always returned.
 *
 * Returns: (transfer full): the new pipe
 */
CockpitPipe *
cockpit_auth_start_session (CockpitCreds *creds)
{
  CockpitPipe *pipe;
  CockpitPipe *auth_pipe = NULL;
  const gchar *password;
  GBytes *bytes = NULL;

  g_return_val_if_fail (creds != NULL, NULL);

  password = cockpit_creds_get_password (creds);
  if (password != NULL)
    {
      bytes = g_bytes_new_with_free_func (password, strlen (password),
                                          cockpit_creds_unref,
                                          cockpit_creds_ref (creds));
    }

  pipe = spawn_session_process (cockpit_creds_get_user (creds),
                                bytes, cockpit_creds_get_rhost (creds),
                                &auth_pipe);
  if (auth_pipe)
    {
      /*
       * Any failure will come from the pipe exit code, but the session
       * needs our password (if we have one) so let it get sent.
       */
      g_signal_connect (auth_pipe, "close", G_CALLBACK (g_object_unref), NULL);
    }

  if (!pipe)
    {
      pipe = g_object_new (COCKPIT_TYPE_PIPE,
                           "name", "localhost",
                           "problem", "internal-error",
                           NULL);
    }

  if (bytes)
    g_bytes_unref (bytes);

  return pipe;
}
