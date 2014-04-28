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

enum {
  AUTHENTICATE,
  NUM_SIGNALS
};

static guint signals[NUM_SIGNALS] = { 0, };

static CockpitCreds *    cockpit_auth_cookie_authenticate      (CockpitAuth *auth,
                                                                GHashTable *in_headers,
                                                                GHashTable *out_headers);

G_DEFINE_TYPE (CockpitAuth, cockpit_auth, G_TYPE_OBJECT)

/*
 * We really want to be able to use CockpitPipe here ... but we can't ... yet.
 * Since we use threaded handlers in cockpit-ws, and CockpitPipe wants a stable
 * main context, and isn't thread safe, we can't use it yet. SessionProcess is
 * a necessary complication, until CockpitWebServer and the handlers are no longer
 * threaded.
 */

typedef struct {
    GPid pid;
    gint in_fd;
    gint out_fd;
} SessionProcess;

static void
session_process_watch (GPid pid,
                       gint status,
                       gpointer data)
{
  /* This function is just to prevent zombies */
}

static void
session_process_free (gpointer data)
{
  SessionProcess *proc = data;
  close (proc->in_fd);
  close (proc->out_fd);
  if (proc->pid)
    {
      g_child_watch_add (proc->pid, session_process_watch, NULL);
      g_spawn_close_pid (proc->pid);
    }
  g_free (proc);
}

static void
cockpit_auth_finalize (GObject *object)
{
  CockpitAuth *self = COCKPIT_AUTH (object);

  g_byte_array_unref (self->key);
  g_mutex_clear (&self->mutex);
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

  g_mutex_init (&self->mutex);
  self->authenticated = g_hash_table_new_full (g_str_hash, g_str_equal,
                                               g_free, cockpit_creds_unref);

  self->ready_sessions = g_hash_table_new_full (cockpit_creds_hash, cockpit_creds_equal,
                                                cockpit_creds_unref, session_process_free);
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

static gchar *
read_until_eof (int fd)
{
  GString *input = g_string_new ("");
  gsize len;
  gssize ret;

  for (;;)
    {
      len = input->len;
      g_string_set_size (input, len + 1024);
      ret = read (fd, input->str + len, 1024);
      if (ret < 0)
        {
          if (errno == EAGAIN)
            continue;
          g_critical ("couldn't read from cockpit-session: %m");
          return g_string_free (input, TRUE);
        }
      else if (ret == 0)
        {
          return g_string_free (input, FALSE);
        }
      else
        {
          g_debug ("data from cockpit-session: %.*s", (int)ret, input->str + len);
          g_string_set_size (input, len + ret);
        }
    }
}

static gboolean
write_and_eof (int fd,
               const char *str)
{
  size_t len;
  int r;

  len = strlen (str);
  while (len > 0)
    {
      r = write (fd, str, len);
      if (r < 0)
        {
          if (errno == EAGAIN)
            continue;
          g_warning ("couldn't write password to cockpit-session: %m");
          return FALSE;
        }
      else
        {
          g_assert (r <= len);
          str += r;
          len -= r;
        }
    }

  while (shutdown (fd, SHUT_WR) < 0)
    {
      if (errno == EAGAIN)
        continue;
      g_warning ("couldn't flush password to cockpit-session: %m");
      return FALSE;
    }

  return TRUE;
}

static JsonObject *
password_handshake (int pwfd,
                    const gchar *password)
{
  JsonObject *results = NULL;
  GError *error = NULL;
  gchar *output;

  /*
   * Yes cockpit-session will read this pipe first, and never touches stdin
   * and stdout (until the cockpit-agent subprocess is launched).
   */
  g_debug ("sending password to cockpit-session");

  if (write_and_eof (pwfd, password))
    {
      output = read_until_eof (pwfd);
      if (output)
        {
          results = cockpit_json_parse_object (output, -1, &error);
          if (error != NULL)
            {
              g_warning ("couldn't parse data from session process: %s", error->message);
              g_error_free (error);
            }
        }
      g_free (output);
    }

  return results;
}

static void
stash_session_process (CockpitAuth *self,
                       CockpitCreds *creds,
                       SessionProcess *proc)
{
  g_mutex_lock (&self->mutex);

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

  g_mutex_unlock (&self->mutex);
}

static SessionProcess *
pop_session_process (CockpitAuth *self,
                     CockpitCreds *creds)
{
  SessionProcess *proc = NULL;
  CockpitCreds *orig = NULL;

  g_mutex_lock (&self->mutex);

  /* Avoid calling destructors within the mutex */
  if (g_hash_table_lookup_extended (self->ready_sessions, creds,
                                    (gpointer *)&orig, (gpointer *)&proc))
    {
      if (!g_hash_table_steal (self->ready_sessions, orig))
        g_assert_not_reached ();
    }

  g_mutex_unlock (&self->mutex);

  if (orig)
    cockpit_creds_unref (orig);

  return proc;
}

static SessionProcess *
spawn_session_process (const gchar *user,
                       const gchar *password,
                       const gchar *remote_peer,
                       JsonObject **results)
{
  SessionProcess *proc;
  int pwfds[2] = { -1, -1 };
  GError *error = NULL;
  const gchar **argv;
  char autharg[32];

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

  proc = g_new0 (SessionProcess, 1);
  if (!g_spawn_async_with_pipes (NULL, (gchar **)argv, NULL,
                                 G_SPAWN_DO_NOT_REAP_CHILD | G_SPAWN_LEAVE_DESCRIPTORS_OPEN,
                                 NULL, NULL, &proc->pid, &proc->in_fd, &proc->out_fd, NULL, &error))
    {
      g_warning ("failed to start %s: %s", cockpit_ws_session_program, error->message);
      g_error_free (error);
      g_free (proc);
      return NULL;
    }

  *results = NULL;

  if (password)
    {
      /* Child process end of pipe */
      close (pwfds[1]);

      *results = password_handshake (pwfds[0], password);
      close (pwfds[0]);
    }

  return proc;
}

static CockpitCreds *
verify_userpass (CockpitAuth *self,
                 const char *content,
                 const char *remote_peer,
                 GError **error)
{
  gchar **lines = g_strsplit (content, "\n", 0);
  CockpitCreds *ret = NULL;

  if (lines[0] == NULL
      || lines[1] == NULL
      || lines[2] != NULL)
    {
      g_set_error (error, G_IO_ERROR, G_IO_ERROR_INVALID_DATA,
                   "Malformed input");
      return NULL;
    }

  ret = cockpit_auth_verify_password (self, lines[0], lines[1], remote_peer, error);
  g_strfreev (lines);
  return ret;
}

static CockpitCreds *
cockpit_auth_pam_verify_password (CockpitAuth *self,
                                  const gchar *user,
                                  const gchar *password,
                                  const gchar *remote_peer,
                                  GError **error)
{
  const char *pam_user = NULL;
  CockpitCreds *creds = NULL;
  JsonObject *results = NULL;
  SessionProcess *proc;
  gint64 code = -1;

  /*
   * In the absence of a password cockpit-session runs without
   * authenticating. So as a last double check, make sure that
   * one is present.
   */
  if (!password)
    password = "";

  proc = spawn_session_process (user, password, remote_peer, &results);
  if (proc == NULL)
    {
      g_set_error (error, COCKPIT_ERROR, COCKPIT_ERROR_FAILED,
                   "Internal error starting session process");
      goto out;
    }

  if (results == NULL ||
      !cockpit_json_get_int (results, "pam-result", -1, &code) || code < 0)
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

          creds = cockpit_creds_new (pam_user,
                                     COCKPIT_CRED_PASSWORD, password,
                                     COCKPIT_CRED_RHOST, remote_peer,
                                     NULL);

          stash_session_process (self, creds, proc);
          proc = NULL;
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

out:
  if (results)
    json_object_unref (results);
  if (proc)
    session_process_free (proc);
  return creds;
}

static gboolean
authenticate_accumulator (GSignalInvocationHint *ihint,
                          GValue *return_accu,
                          const GValue *handler_return,
                          gpointer unused)
{
  CockpitCreds *creds;

  creds = g_value_get_boxed (handler_return);
  if (creds != NULL)
    {
      g_value_set_boxed (return_accu, creds);
      return FALSE;
    }

  return TRUE;
}

static void
cockpit_auth_class_init (CockpitAuthClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);

  gobject_class->finalize = cockpit_auth_finalize;

  klass->authenticate = cockpit_auth_cookie_authenticate;
  klass->verify_password = cockpit_auth_pam_verify_password;

  signals[AUTHENTICATE] = g_signal_new ("authenticate", COCKPIT_TYPE_AUTH, G_SIGNAL_RUN_LAST,
                                        G_STRUCT_OFFSET (CockpitAuthClass, authenticate),
                                        authenticate_accumulator, NULL,
                                        g_cclosure_marshal_generic,
                                        COCKPIT_TYPE_CREDS, 2,
                                        G_TYPE_HASH_TABLE,
                                        G_TYPE_HASH_TABLE);
}

static char *
creds_to_cookie (CockpitAuth *self,
                 CockpitCreds *creds)
{
  guint64 seed;
  gchar *cookie;
  char *id;

  g_mutex_lock (&self->mutex);

  seed = self->nonce_seed++;
  id = g_compute_hmac_for_data (G_CHECKSUM_SHA256,
                                self->key->data, self->key->len,
                                (guchar *)&seed, sizeof (seed));

  cookie = g_strdup_printf ("v=2;k=%s", id);
  g_hash_table_insert (self->authenticated, id,
                       cockpit_creds_ref (creds));

  g_debug ("sending credential id '%s' for user '%s'", id,
           cockpit_creds_get_user (creds));

  g_mutex_unlock (&self->mutex);

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

  g_mutex_lock (&self->mutex);

  creds = g_hash_table_lookup (self->authenticated, id);
  if (creds)
    {
      g_debug ("received credential id '%s' for user '%s'", id,
               cockpit_creds_get_user (creds));
      cockpit_creds_ref (creds);
    }
  else
    g_debug ("received unknown/invalid credential id '%s'", id);

  g_mutex_unlock (&self->mutex);

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
cockpit_auth_check_userpass (CockpitAuth *self,
                             const char *userpass,
                             gboolean force_secure,
                             const gchar *remote_peer,
                             GHashTable *out_headers,
                             GError **error)
{
  CockpitCreds *creds;
  gs_free char *cookie = NULL;
  gs_free gchar *cookie_b64 = NULL;
  gchar *header;

  creds = verify_userpass (self, userpass, remote_peer, error);
  if (!creds)
    {
      g_debug ("user failed to verify");
      return FALSE;
    }

  cookie = creds_to_cookie (self, creds);

  if (out_headers)
    {
      cookie_b64 = g_base64_encode ((guint8 *)cookie, strlen (cookie));
      header = g_strdup_printf ("CockpitAuth=%s; Path=/; Expires=Wed, 13-Jan-2021 22:23:01 GMT;%s HttpOnly",
                                cookie_b64, force_secure ? " Secure;" : "");

      g_hash_table_insert (out_headers, g_strdup ("Set-Cookie"), header);
    }

  return creds;
}

CockpitCreds *
cockpit_auth_check_headers (CockpitAuth *auth,
                            GHashTable *in_headers,
                            GHashTable *out_headers)
{
  CockpitCreds *creds = NULL;

  g_return_val_if_fail (auth != NULL, FALSE);
  g_return_val_if_fail (in_headers != NULL, FALSE);

  if (out_headers == NULL)
    out_headers = web_socket_util_new_headers ();
  else
    g_hash_table_ref (out_headers);

  g_signal_emit (auth, signals[AUTHENTICATE], 0, in_headers, out_headers, &creds);

  g_hash_table_unref (out_headers);
  return creds;
}

static CockpitCreds *
cockpit_auth_cookie_authenticate (CockpitAuth *auth,
                                  GHashTable *in_headers,
                                  GHashTable *out_headers)
{
  gs_unref_hashtable GHashTable *cookies = NULL;
  gs_free gchar *auth_cookie = NULL;

  if (!cockpit_web_server_parse_cookies (in_headers, &cookies, NULL))
    return NULL;

  auth_cookie = base64_decode_string (g_hash_table_lookup (cookies, "CockpitAuth"));
  if (auth_cookie == NULL)
    return NULL;

  return cookie_to_creds (auth, auth_cookie);
}

CockpitAuth *
cockpit_auth_new (void)
{
  return (CockpitAuth *)g_object_new (COCKPIT_TYPE_AUTH, NULL);
}

CockpitCreds *
cockpit_auth_verify_password (CockpitAuth *auth,
                              const gchar *user,
                              const gchar *password,
                              const gchar *remote_peer,
                              GError **error)
{
  CockpitAuthClass *klass = COCKPIT_AUTH_GET_CLASS (auth);
  g_return_val_if_fail (klass->verify_password != NULL, FALSE);
  return klass->verify_password (auth, user, password, remote_peer, error);
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
 * This must be called in the main context of the thread where the pipe
 * will be serviced. The CockpitPipe is created for the current thread
 * default main context.
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
  SessionProcess *proc;
  JsonObject *results = NULL;
  CockpitPipe *pipe;

  g_return_val_if_fail (creds != NULL, NULL);

  proc = pop_session_process (self, creds);
  if (proc == NULL)
    {
      proc = spawn_session_process (cockpit_creds_get_user (creds),
                                    cockpit_creds_get_password (creds),
                                    cockpit_creds_get_rhost (creds),
                                    &results);

      /* Any failure will come from the pipe exit code */
      if (results)
        json_object_unref (results);
    }

  if (proc)
    {
      pipe = g_object_new (COCKPIT_TYPE_PIPE,
                           "name", "localhost",
                           "pid", proc->pid,
                           "in-fd", proc->out_fd,
                           "out-fd", proc->in_fd,
                           NULL);
      g_free (proc); /* stole all values */
    }
  else
    {
      pipe = g_object_new (COCKPIT_TYPE_PIPE,
                           "problem", "internal-error",
                           NULL);
    }

  return pipe;
}
