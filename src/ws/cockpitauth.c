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

#include <cockpit/cockpit.h>

#include "cockpitauth.h"
#include "cockpitwebserver.h"
#include "cockpitws.h"

#include <gsystem-local-alloc.h>

#include "websocket/websocket.h"

#include "cockpit/cockpitjson.h"
#include "cockpit/cockpitpipe.h"
#include "cockpit/cockpitmemory.h"

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

static char *     creds_to_cookie    (CockpitAuth *self,
                                      CockpitCreds *creds);

G_DEFINE_TYPE (CockpitAuth, cockpit_auth, G_TYPE_OBJECT)

static void
cockpit_auth_finalize (GObject *object)
{
  CockpitAuth *self = COCKPIT_AUTH (object);

  g_byte_array_unref (self->key);
  g_hash_table_destroy (self->authenticated);
  g_hash_table_destroy (self->ready_sessions);

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
                                               g_free, cockpit_creds_unref);

  self->ready_sessions = g_hash_table_new_full (cockpit_creds_hash, cockpit_creds_equal,
                                                cockpit_creds_unref, g_object_unref);
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

static void
stash_session_process (CockpitAuth *self,
                       CockpitCreds *creds,
                       CockpitPipe *proc)
{
  /* Avoid calling destructors within the mutex */
  if (g_hash_table_lookup (self->ready_sessions, creds))
    {
      g_debug ("already had stashed session process for user");
    }
  else
    {
      g_debug ("stashed session process for later");
      g_hash_table_insert (self->ready_sessions,
                           cockpit_creds_ref (creds), proc);
    }
}

static CockpitPipe *
pop_session_process (CockpitAuth *self,
                     CockpitCreds *creds)
{
  CockpitPipe *proc = NULL;
  CockpitCreds *orig = NULL;

  if (g_hash_table_lookup_extended (self->ready_sessions, creds,
                                    (gpointer *)&orig, (gpointer *)&proc))
    {
      if (!g_hash_table_steal (self->ready_sessions, orig))
        g_assert_not_reached ();
      cockpit_creds_unref (orig);
    }

  return proc;
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
  const gchar **argv;
  char autharg[32];
  GPid pid = 0;
  gint in_fd = -1;
  gint out_fd = -1;

  const gchar *argv_password[] = {
      cockpit_ws_session_program,
      "-p", autharg,
      user ? user : "",
      remote_peer ? remote_peer : "",
      cockpit_ws_agent_program,
      NULL,
  };

  const gchar *argv_noauth[] = {
      cockpit_ws_session_program,
      user ? user : "",
      remote_peer ? remote_peer : "",
      cockpit_ws_agent_program,
      NULL,
  };

  if (password)
    {
      if (socketpair (PF_UNIX, SOCK_STREAM, 0, pwfds) < 0)
        g_return_val_if_reached (NULL);
      g_snprintf (autharg, sizeof (autharg), "%d", pwfds[1]);
      argv = argv_password;
    }
  else
    {
      argv = argv_noauth;
    }

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

  if (user && password)
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
  results = cockpit_json_parse_object ((const gchar *)buffer->data, buffer->len, &json_error);
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

  stash_session_process (self, creds, login->session_pipe);
  login->session_pipe = NULL;

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
creds_to_cookie (CockpitAuth *self,
                 CockpitCreds *creds)
{
  guint64 seed;
  gchar *cookie;
  char *id;

  seed = self->nonce_seed++;
  id = g_compute_hmac_for_data (G_CHECKSUM_SHA256,
                                self->key->data, self->key->len,
                                (guchar *)&seed, sizeof (seed));

  cookie = g_strdup_printf ("v=2;k=%s", id);
  g_hash_table_insert (self->authenticated, id,
                       cockpit_creds_ref (creds));

  g_debug ("sending credential id '%s' for user '%s'", id,
           cockpit_creds_get_user (creds));

  return cookie;
}

static CockpitCreds *
cookie_to_creds  (CockpitAuth *self,
                  const char *cookie)
{
  CockpitCreds *creds = NULL;
  const char *prefix = "v=2;k=";
  const gsize n_prefix = 6;
  const gchar *id;

  if (!g_str_has_prefix (cookie, prefix))
    {
      g_debug ("invalid or unsupported cookie: %s", cookie);
      return NULL;
    }

  id = cookie + n_prefix;

  creds = g_hash_table_lookup (self->authenticated, id);
  if (creds)
    {
      g_debug ("received credential id '%s' for user '%s'", id,
               cockpit_creds_get_user (creds));
      cockpit_creds_ref (creds);
    }
  else
    g_debug ("received unknown/invalid credential id '%s'", id);

  return creds;
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

CockpitCreds *
cockpit_auth_check_cookie (CockpitAuth *auth,
                           GHashTable *in_headers)
{
  gs_unref_hashtable GHashTable *cookies = NULL;
  gs_free gchar *auth_cookie = NULL;

  g_return_val_if_fail (auth != NULL, FALSE);
  g_return_val_if_fail (in_headers != NULL, FALSE);

  if (!cockpit_web_server_parse_cookies (in_headers, &cookies, NULL))
    return NULL;

  auth_cookie = base64_decode_string (g_hash_table_lookup (cookies, "CockpitAuth"));
  if (auth_cookie == NULL)
    return NULL;

  return cookie_to_creds (auth, auth_cookie);
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

CockpitCreds *
cockpit_auth_login_finish (CockpitAuth *self,
                           GAsyncResult *result,
                           gboolean force_secure,
                           GHashTable *out_headers,
                           GError **error)
{
  CockpitAuthClass *klass = COCKPIT_AUTH_GET_CLASS (self);
  CockpitCreds *creds;
  gs_free char *cookie = NULL;
  gs_free gchar *cookie_b64 = NULL;
  gchar *header;

  g_return_val_if_fail (klass->login_finish != NULL, FALSE);
  creds = klass->login_finish (self, result, error);

  if (creds && out_headers)
    {
      cookie = creds_to_cookie (self, creds);
      cookie_b64 = g_base64_encode ((guint8 *)cookie, strlen (cookie));
      header = g_strdup_printf ("CockpitAuth=%s; Path=/; Expires=Wed, 13-Jan-2021 22:23:01 GMT;%s HttpOnly",
                                cookie_b64, force_secure ? " Secure;" : "");

      g_hash_table_insert (out_headers, g_strdup ("Set-Cookie"), header);
    }

  return creds;
}

CockpitAuth *
cockpit_auth_new (void)
{
  return (CockpitAuth *)g_object_new (COCKPIT_TYPE_AUTH, NULL);
}

/**
 * cockpit_auth_start_session:
 * @self: a CockpitAuth
 * @creds: credentials for the session
 *
 * Start a local session process for the given credentials. It may be
 * that one is hanging around from prior authentication, in which case
 * that one is used.
 *
 * If launching the session fails, then the pipe will be created in a
 * failed state, and will close shortly. A CockpitPipe is always returned.
 *
 * Returns: (transfer full): the new pipe
 */
CockpitPipe *
cockpit_auth_start_session (CockpitAuth *self,
                            CockpitCreds *creds)
{
  CockpitPipe *pipe;
  CockpitPipe *auth_pipe = NULL;
  const gchar *password;
  GBytes *bytes;

  g_return_val_if_fail (creds != NULL, NULL);

  pipe = pop_session_process (self, creds);
  if (pipe == NULL)
    {
      password = cockpit_creds_get_password (creds);
      if (password == NULL)
        {
          bytes = NULL;
        }
      else
        {
          bytes = g_bytes_new_with_free_func (password, strlen (password),
                                              cockpit_creds_unref, creds);
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
    }

  if (!pipe)
    {
      pipe = g_object_new (COCKPIT_TYPE_PIPE,
                           "problem", "internal-error",
                           NULL);
    }

  return pipe;
}
