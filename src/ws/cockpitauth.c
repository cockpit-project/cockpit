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

#include "cockpitsshtransport.h"
#include "cockpitws.h"

#include "websocket/websocket.h"

#include "common/cockpiterror.h"
#include "common/cockpithex.h"
#include "common/cockpitlog.h"
#include "common/cockpitjson.h"
#include "common/cockpitpipe.h"
#include "common/cockpitpipetransport.h"
#include "common/cockpitmemory.h"
#include "common/cockpitunixfd.h"
#include "common/cockpitwebserver.h"

#include <glib/gstdio.h>

#include <sys/types.h>
#include <sys/socket.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <errno.h>
#include <unistd.h>
#include <sys/wait.h>
#include <pwd.h>
#include <grp.h>

#include <security/pam_appl.h>
#include <stdlib.h>

/* Timeout of authenticated session when no connections */
guint cockpit_ws_service_idle = 15;

/* Timeout of everything when noone is connected */
guint cockpit_ws_process_idle = 600;

static guint sig__idling = 0;

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
  if (self->timeout_tag)
    g_source_remove (self->timeout_tag);
  g_byte_array_unref (self->key);
  g_hash_table_destroy (self->authenticated);

  G_OBJECT_CLASS (cockpit_auth_parent_class)->finalize (object);
}

static gboolean
on_process_timeout (gpointer data)
{
  CockpitAuth *self = COCKPIT_AUTH (data);

  self->timeout_tag = 0;
  if (g_hash_table_size (self->authenticated) == 0)
    {
      g_debug ("web service is idle");
      g_signal_emit (self, sig__idling, 0);
    }

  return FALSE;
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

  self->timeout_tag = g_timeout_add_seconds (cockpit_ws_process_idle,
                                             on_process_timeout, self);
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

GBytes *
cockpit_auth_parse_authorization (GHashTable *headers,
                                  gchar **type)
{
  gchar *line;
  gchar *next;
  gchar *contents;
  gsize length;
  gpointer key;
  gsize i;

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
  if (g_base64_decode_inplace (contents, &length) == NULL)
    {
      g_free (line);
      return NULL;
    }

  /* Null terminate for convenience, but null count not included in GBytes */
  contents[length] = '\0';

  if (type)
    {
      *type = g_strndup (line, next - line);
      for (i = 0; (*type)[i] != '\0'; i++)
        (*type)[i] = g_ascii_tolower ((*type)[i]);
    }

  /* Avoid copying by using the line directly */
  return g_bytes_new_with_free_func (contents, length, clear_free_authorization, line);
}

/* ------------------------------------------------------------------------
 *  Login via cockpit-session
 */

static void
session_child_setup (gpointer data)
{
  gint auth_fd = GPOINTER_TO_INT (data);

  if (cockpit_unix_fd_close_all (3, auth_fd) < 0)
    {
      g_printerr ("couldn't close file descriptors: %m");
      _exit (127);
    }

  /* When running cockpit-session fd 3 is always auth */
  if (dup2 (auth_fd, 3) < 0)
    {
      g_printerr ("couldn't dup file descriptor: %m");
      _exit (127);
    }

  close (auth_fd);
}

static CockpitPipe *
spawn_session_process (const gchar *type,
                       GBytes *input,
                       const gchar *remote_peer,
                       CockpitPipe **auth_pipe)
{
  CockpitPipe *pipe;
  int pwfds[2] = { -1, -1 };
  GError *error = NULL;
  GPid pid = 0;
  gint in_fd = -1;
  gint out_fd = -1;

  const gchar *argv[] = {
      cockpit_ws_session_program,
      type,
      remote_peer ? remote_peer : "",
      NULL,
  };

  g_return_val_if_fail (input != NULL, NULL);

  if (socketpair (PF_UNIX, SOCK_STREAM, 0, pwfds) < 0)
    g_return_val_if_reached (NULL);

  g_debug ("spawning %s", cockpit_ws_session_program);

  if (!g_spawn_async_with_pipes (NULL, (gchar **)argv, NULL,
                                 G_SPAWN_DO_NOT_REAP_CHILD | G_SPAWN_LEAVE_DESCRIPTORS_OPEN,
                                 session_child_setup, GINT_TO_POINTER (pwfds[1]),
                                 &pid, &in_fd, &out_fd, NULL, &error))
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

      /* Child process end of pipe */
      close (pwfds[1]);

      *auth_pipe = cockpit_pipe_new ("auth-pipe", pwfds[0], pwfds[0]);
      cockpit_pipe_write (*auth_pipe, input);
      cockpit_pipe_close (*auth_pipe, NULL);
    }

  return pipe;
}

typedef struct {
  CockpitPipe *session_pipe;
  CockpitPipe *auth_pipe;
  GBytes *authorization;
  gchar *remote_peer;
  gchar *auth_type;
  gchar *application;
} SessionLoginData;

static void
session_login_data_free (gpointer data)
{
  SessionLoginData *sl = data;
  if (sl->session_pipe)
    g_object_unref (sl->session_pipe);
  if (sl->auth_pipe)
    g_object_unref (sl->auth_pipe);
  if (sl->authorization)
    g_bytes_unref (sl->authorization);
  g_free (sl->auth_type);
  g_free (sl->application);
  g_free (sl->remote_peer);
  g_free (sl);
}

static void
on_session_login_done (CockpitPipe *pipe,
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
build_gssapi_output_header (GHashTable *headers,
                            JsonObject *results)
{
  gchar *encoded;
  const gchar *output = NULL;
  gpointer data;
  gsize length;
  gchar *value;

  if (results)
    {
      if (!cockpit_json_get_string (results, "gssapi-output", NULL, &output))
        {
          g_warning ("received invalid gssapi-output field from cockpit-session");
          return;
        }
    }

  if (output)
    {
      data = cockpit_hex_decode (output, &length);
      if (!data)
        {
          g_warning ("received invalid gssapi-output from cockpit-session");
          return;
        }
      encoded = g_base64_encode (data, length);
      value = g_strdup_printf ("Negotiate %s", encoded);

      g_free (data);
      g_free (encoded);
    }
  else
    {
      value = g_strdup ("Negotiate");
    }

  g_hash_table_replace (headers, g_strdup ("WWW-Authenticate"), value);
  g_debug ("gssapi: WWW-Authenticate: %s", value);
}

static const gchar *
auth_parse_application (const gchar *path,
                        gchar **memory)
{
  const gchar *pos;

  g_return_val_if_fail (path != NULL, NULL);
  g_return_val_if_fail (path[0] == '/', NULL);

  path += 1;

  /* We are being embedded as a specific application */
  if (g_str_has_prefix (path, "cockpit+") && path[8] != '\0')
    {
      pos = strchr (path, '/');
      if (pos)
        {
          *memory = g_strndup (path, pos - path);
          return *memory;
        }
      else
        {
          return path;
        }
    }
  else
    {
      return "cockpit";
    }
}

static void
cockpit_auth_session_login_async (CockpitAuth *self,
                                  const gchar *path,
                                  GHashTable *headers,
                                  const gchar *remote_peer,
                                  GAsyncReadyCallback callback,
                                  gpointer user_data)
{
  GSimpleAsyncResult *result;
  SessionLoginData *sl;
  GBytes *input;
  gchar *application;
  gchar *type = NULL;

  result = g_simple_async_result_new (G_OBJECT (self), callback, user_data,
                                      cockpit_auth_session_login_async);

  application = cockpit_auth_parse_application (path);
  input = cockpit_auth_parse_authorization (headers, &type);

  if (input && application)
    {
      sl = g_new0 (SessionLoginData, 1);
      sl->remote_peer = g_strdup (remote_peer);
      sl->auth_type = type;
      sl->authorization = g_bytes_ref (input);
      sl->application = application;
      application = NULL;

      g_simple_async_result_set_op_res_gpointer (result, sl, session_login_data_free);

      sl->session_pipe = spawn_session_process (type, input, remote_peer, &sl->auth_pipe);

      if (sl->session_pipe)
        {
          g_signal_connect (sl->auth_pipe, "close",
                            G_CALLBACK (on_session_login_done), g_object_ref (result));
        }
      else
        {
          g_simple_async_result_set_error (result, COCKPIT_ERROR, COCKPIT_ERROR_FAILED,
                                           "Internal error starting session process");
          g_simple_async_result_complete_in_idle (result);
        }
    }
  else
    {
      g_free (type);
      g_simple_async_result_set_error (result, COCKPIT_ERROR, COCKPIT_ERROR_AUTHENTICATION_FAILED,
                                       "Authentication required");
      g_simple_async_result_complete_in_idle (result);
    }

  g_bytes_unref (input);
  g_free (application);
  g_object_unref (result);
}

static CockpitCreds *
create_creds_for_authenticated (const char *user,
                                SessionLoginData *sl,
                                JsonObject *results)
{
  const gchar *fullname = NULL;
  const gchar *password = NULL;
  const gchar *gssapi_creds = NULL;

  /*
   * Dig the password out of the authorization header, rather than having
   * cockpit-session pass it back and forth possibly leaking it.
   */

  if (g_str_equal (sl->auth_type, "basic"))
    password = parse_basic_auth_password (sl->authorization, NULL);

  if (!cockpit_json_get_string (results, "gssapi-creds", NULL, &gssapi_creds))
    {
      g_warning ("received bad gssapi-creds from cockpit-session");
      gssapi_creds = NULL;
    }

  if (!cockpit_json_get_string (results, "full-name", NULL, &fullname))
    {
      g_warning ("received bad full-name from cockpit-session");
      fullname = NULL;
    }

  /* TODO: Try to avoid copying password */
  return cockpit_creds_new (user,
                            sl->application,
                            COCKPIT_CRED_FULLNAME, fullname,
                            COCKPIT_CRED_PASSWORD, password,
                            COCKPIT_CRED_RHOST, sl->remote_peer,
                            COCKPIT_CRED_GSSAPI, gssapi_creds,
                            NULL);
}

static CockpitCreds *
parse_auth_results (SessionLoginData *sl,
                    GHashTable *headers,
                    GError **error)
{
  CockpitCreds *creds = NULL;
  GByteArray *buffer;
  GError *json_error = NULL;
  const gchar *pam_user;
  JsonObject *results;
  gint64 code = -1;

  buffer = cockpit_pipe_get_buffer (sl->auth_pipe);
  g_debug ("cockpit-session says: %.*s", (int)buffer->len, (const gchar *)buffer->data);

  results = cockpit_json_parse_object ((const gchar *)buffer->data, buffer->len, &json_error);

  if (g_error_matches (json_error, JSON_PARSER_ERROR, JSON_PARSER_ERROR_INVALID_DATA))
    {
      g_message ("got non-utf8 user name from cockpit-session");
      g_set_error (error, G_IO_ERROR, G_IO_ERROR_INVALID_DATA,
                   "Login user name is not UTF8 encoded");
      g_error_free (json_error);
    }
  else if (!results)
    {
      g_warning ("couldn't parse session auth output: %s",
                 json_error ? json_error->message : NULL);
      g_error_free (json_error);
      g_set_error (error, G_IO_ERROR, G_IO_ERROR_INVALID_DATA,
                   "Invalid data from session process: no results");
    }
  else if (!cockpit_json_get_int (results, "result-code", -1, &code) || code < 0)
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
          creds = create_creds_for_authenticated (pam_user, sl, results);
        }
    }
  else if (code == PAM_AUTH_ERR || code == PAM_USER_UNKNOWN)
    {
      g_debug ("authentication failed: %d", (int)code);
      g_set_error (error, COCKPIT_ERROR, COCKPIT_ERROR_AUTHENTICATION_FAILED,
                   "Authentication failed");
    }
  else if (code == PAM_PERM_DENIED)
    {
      g_debug ("permission denied: %d", (int)code);
      g_set_error (error, COCKPIT_ERROR, COCKPIT_ERROR_PERMISSION_DENIED,
                   "Permission denied");
    }
  else
    {
      g_debug ("pam error: %d", (int)code);
      g_set_error (error, COCKPIT_ERROR, COCKPIT_ERROR_FAILED,
                   "%s", pam_strerror (NULL, code));
    }

  build_gssapi_output_header (headers, results);

  if (results)
    json_object_unref (results);
  return creds;
}

static CockpitCreds *
cockpit_auth_session_login_finish (CockpitAuth *self,
                                   GAsyncResult *result,
                                   GHashTable *headers,
                                   CockpitTransport **transport,
                                   GError **error)
{
  CockpitCreds *creds;
  SessionLoginData *sl;

  g_return_val_if_fail (g_simple_async_result_is_valid (result, G_OBJECT (self),
                        cockpit_auth_session_login_async), NULL);

  if (g_simple_async_result_propagate_error (G_SIMPLE_ASYNC_RESULT (result), error))
    {
      build_gssapi_output_header (headers, NULL);
      return NULL;
    }

  sl = g_simple_async_result_get_op_res_gpointer (G_SIMPLE_ASYNC_RESULT (result));

  creds = parse_auth_results (sl, headers, error);
  if (!creds)
    return NULL;

  if (transport)
    *transport = cockpit_pipe_transport_new (sl->session_pipe);

  return creds;
}


/* ------------------------------------------------------------------------
 * Remote login without cockpit-session by using ssh even locally
 */

typedef struct {
  CockpitCreds *creds;
  CockpitTransport *transport;
} RemoteLoginData;

static void
remote_login_data_free (gpointer data)
{
  RemoteLoginData *rl = data;
  if (rl->creds)
    cockpit_creds_unref (rl->creds);
  if (rl->transport)
    g_object_unref (rl->transport);
  g_free (rl);
}

static void
on_remote_login_done (CockpitSshTransport *transport,
                      const gchar *problem,
                      gpointer user_data)
{
  CockpitAuth *self = COCKPIT_AUTH (g_async_result_get_source_object (user_data));
  GSimpleAsyncResult *task = user_data;

  if (problem)
    {
      if (g_str_equal (problem, "authentication-failed"))
        {
          g_simple_async_result_set_error (task, COCKPIT_ERROR,
                                           COCKPIT_ERROR_AUTHENTICATION_FAILED,
                                           "Authentication failed");
        }
      else if (g_str_equal (problem, "authentication-not-supported") ||
               g_str_equal (problem, "no-forwarding"))
        {
          g_simple_async_result_set_error (task, COCKPIT_ERROR,
                                           COCKPIT_ERROR_AUTHENTICATION_FAILED,
                                           "Authentication failed: authentication-not-supported");
        }
      else
        {
          g_simple_async_result_set_error (task, COCKPIT_ERROR, COCKPIT_ERROR_FAILED,
                                           "Couldn't connect or authenticate: %s", problem);
        }
    }

  g_simple_async_result_complete (task);
  g_object_unref (self);
  g_object_unref (task);
}

static void
cockpit_auth_remote_login_async (CockpitAuth *self,
                                 const gchar *path,
                                 GHashTable *headers,
                                 const gchar *remote_peer,
                                 GAsyncReadyCallback callback,
                                 gpointer user_data)
{
  GSimpleAsyncResult *task;
  CockpitCreds *creds = NULL;
  RemoteLoginData *rl;
  const gchar *application;
  const gchar *password;
  gchar *memory = NULL;
  GBytes *input;
  gchar *type = NULL;
  gchar *user = NULL;

  task = g_simple_async_result_new (G_OBJECT (self), callback, user_data,
                                    cockpit_auth_remote_login_async);

  application = auth_parse_application (path, &memory);
  input = cockpit_auth_parse_authorization (headers, &type);

  if (application && type && input && g_str_equal (type, "basic"))
    {
      password = parse_basic_auth_password (input, &user);
      if (password && user)
        {
          creds = cockpit_creds_new (user,
                                     application,
                                     COCKPIT_CRED_PASSWORD, password,
                                     COCKPIT_CRED_RHOST, remote_peer,
                                     NULL);
        }
      g_free (user);
    }

  if (creds)
    {
      rl = g_new0 (RemoteLoginData, 1);
      rl->creds = creds;
      rl->transport = g_object_new (COCKPIT_TYPE_SSH_TRANSPORT,
                                    "host", "127.0.0.1",
                                    "port", cockpit_ws_specific_ssh_port,
                                    "command", cockpit_ws_bridge_program,
                                    "creds", creds,
                                    "ignore-key", TRUE,
                                    NULL);

      g_simple_async_result_set_op_res_gpointer (task, rl, remote_login_data_free);
      g_signal_connect (rl->transport, "result", G_CALLBACK (on_remote_login_done), g_object_ref (task));
    }
  else
    {
      g_simple_async_result_set_error (task, COCKPIT_ERROR, COCKPIT_ERROR_AUTHENTICATION_FAILED,
                                       "Basic authentication required");
      g_simple_async_result_complete_in_idle (task);
    }

  g_free (type);
  g_free (memory);
  g_object_unref (task);
}

static CockpitCreds *
cockpit_auth_remote_login_finish (CockpitAuth *self,
                                  GAsyncResult *result,
                                  GHashTable *headers,
                                  CockpitTransport **transport,
                                  GError **error)
{
  RemoteLoginData *rl;

  g_return_val_if_fail (g_simple_async_result_is_valid (result, G_OBJECT (self),
                        cockpit_auth_remote_login_async), NULL);

  if (g_simple_async_result_propagate_error (G_SIMPLE_ASYNC_RESULT (result), error))
    return NULL;

  rl = g_simple_async_result_get_op_res_gpointer (G_SIMPLE_ASYNC_RESULT (result));

  if (transport)
    *transport = g_object_ref (rl->transport);

  return cockpit_creds_ref (rl->creds);
}


/* ---------------------------------------------------------------------- */

static void
cockpit_auth_choose_login_async (CockpitAuth *self,
                                 const gchar *path,
                                 GHashTable *headers,
                                 const gchar *remote_peer,
                                 GAsyncReadyCallback callback,
                                 gpointer user_data)
{
  if (self->login_loopback)
    cockpit_auth_remote_login_async (self, path, headers, remote_peer, callback, user_data);
  else
    cockpit_auth_session_login_async (self, path, headers, remote_peer, callback, user_data);
}

static CockpitCreds *
cockpit_auth_choose_login_finish (CockpitAuth *self,
                                  GAsyncResult *result,
                                  GHashTable *headers,
                                  CockpitTransport **transport,
                                  GError **error)
{
  if (self->login_loopback)
    return cockpit_auth_remote_login_finish (self, result, headers, transport, error);
  else
    return cockpit_auth_session_login_finish (self, result, headers, transport, error);
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
  const gchar *application;
  gchar *memory = NULL;

  g_return_val_if_fail (self != NULL, FALSE);
  g_return_val_if_fail (in_headers != NULL, FALSE);

  application = auth_parse_application (path, &memory);
  if (!application)
    return NULL;

  raw = cockpit_web_server_parse_cookie (in_headers, application);
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

  g_free (memory);
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

void
cockpit_auth_login_async (CockpitAuth *self,
                          const gchar *path,
                          GHashTable *headers,
                          const gchar *remote_peer,
                          GAsyncReadyCallback callback,
                          gpointer user_data)
{
  CockpitAuthClass *klass = COCKPIT_AUTH_GET_CLASS (self);
  g_return_if_fail (klass->login_async != NULL);
  klass->login_async (self, path, headers, remote_peer, callback, user_data);
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
  cockpit_authenticated_destroy (data);
}

CockpitWebService *
cockpit_auth_login_finish (CockpitAuth *self,
                           GAsyncResult *result,
                           CockpitAuthFlags flags,
                           GHashTable *out_headers,
                           GError **error)
{
  CockpitAuthClass *klass = COCKPIT_AUTH_GET_CLASS (self);
  CockpitAuthenticated *authenticated;
  CockpitTransport *transport = NULL;
  CockpitCreds *creds;
  gchar *cookie_b64 = NULL;
  gchar *header;
  guint64 seed;
  gchar *id;

  g_return_val_if_fail (klass->login_finish != NULL, FALSE);
  creds = klass->login_finish (self, result, out_headers, &transport, error);

  if (creds == NULL)
    return NULL;

  seed = self->nonce_seed++;
  id = g_compute_hmac_for_data (G_CHECKSUM_SHA256,
                                self->key->data, self->key->len,
                                (guchar *)&seed, sizeof (seed));

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
      cookie_b64 = g_base64_encode ((guint8 *)authenticated->cookie, strlen (authenticated->cookie));
      header = g_strdup_printf ("%s=%s; Path=/; %s HttpOnly",
                                cockpit_creds_get_application (creds),
                                cookie_b64, force_secure ? " Secure;" : "");
      g_free (cookie_b64);
      g_hash_table_insert (out_headers, g_strdup ("Set-Cookie"), header);
    }

  g_info ("logged in user: %s", cockpit_creds_get_user (authenticated->creds));
  return g_object_ref (authenticated->service);
}

CockpitAuth *
cockpit_auth_new (gboolean login_loopback)
{
  CockpitAuth *self = g_object_new (COCKPIT_TYPE_AUTH, NULL);
  self->login_loopback = login_loopback;
  return self;
}

gchar *
cockpit_auth_parse_application (const gchar *path)
{
  const gchar *application;
  gchar *memory = NULL;

  application = auth_parse_application (path, &memory);
  if (!memory)
    memory = g_strdup (application);
  return memory;
}
