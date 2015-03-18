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

#include "cockpitsessiontransport.h"
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

static void
on_initable_done (GObject *source,
                  GAsyncResult *result,
                  gpointer user_data)
{
  GSimpleAsyncResult *task = G_SIMPLE_ASYNC_RESULT (user_data);
  GError *error = NULL;
  GObject *object;

  object = g_async_initable_new_finish (G_ASYNC_INITABLE (source),
                                        result, &error);

  if (object)
    g_simple_async_result_set_op_res_gpointer (task, object, g_object_unref);
  else
    g_simple_async_result_take_error (task, error);
}

static void
cockpit_auth_real_login_async (CockpitAuth *self,
                               GHashTable *headers,
                               const gchar *remote_peer,
                               GAsyncReadyCallback callback,
                               gpointer user_data)
{
  GSimpleAsyncResult *task;

  task = g_simple_async_result_new (G_OBJECT (self), callback, user_data,
                                    cockpit_auth_real_login_async);

  if (self->login_loopback)
    {
      g_async_initable_new_async (COCKPIT_TYPE_SSH_TRANSPORT, G_PRIORITY_DEFAULT, NULL,
                                  on_initable_done, g_object_ref (task),
                                  "host", "127.0.0.1",
                                  "port", cockpit_ws_specific_ssh_port,
                                  "command", cockpit_ws_bridge_program,
                                  "headers", headers,
                                  "remote", remote_peer,
                                  "ignore-key", TRUE,
                                  NULL);
    }
  else
    {
      g_async_initable_new_async (COCKPIT_TYPE_SESSION_TRANSPORT, G_PRIORITY_DEFAULT, NULL,
                                  on_initable_done, g_object_ref (task),
                                  "headers", headers,
                                  "remote", remote_peer,
                                  NULL);
    }

  g_object_unref (task);
}

static CockpitCreds *
cockpit_auth_real_login_finish (CockpitAuth *self,
                                GAsyncResult *result,
                                GHashTable *headers,
                                CockpitTransport **transport,
                                GError **error)
{
  CockpitTransport *trans;
  CockpitCreds *creds = NULL;
  GHashTable *heads = NULL;
  const gchar *www_authenticate;

  g_return_val_if_fail (g_simple_async_result_is_valid (result, G_OBJECT (self),
                        cockpit_auth_real_login_async), NULL);

  trans = g_simple_async_result_get_op_res_gpointer (G_SIMPLE_ASYNC_RESULT (result));

  if (trans)
    {
      g_object_get (trans, "headers", &heads, NULL);
      if (heads)
        {
          www_authenticate = g_hash_table_lookup (heads, "WWW-Authenticate");
          if (www_authenticate)
            g_hash_table_insert (headers, "WWW-Authenticate", g_strdup (www_authenticate));
        }
    }

  if (g_simple_async_result_propagate_error (G_SIMPLE_ASYNC_RESULT (result), error))
    return NULL;

  if (trans)
    {
      g_object_get (transport, "creds", &creds, NULL);
      if (transport)
        *transport = g_object_ref (trans);
      g_object_unref (trans);
    }

  return creds;
}

/* ---------------------------------------------------------------------- */

static void
cockpit_auth_class_init (CockpitAuthClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);

  gobject_class->finalize = cockpit_auth_finalize;

  klass->login_async = cockpit_auth_real_login_async;
  klass->login_finish = cockpit_auth_real_login_finish;

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
                           GHashTable *in_headers)
{
  gchar *cookie = NULL;
  gchar *raw = NULL;
  const char *prefix = "v=2;k=";
  CockpitAuthenticated *ret = NULL;

  g_return_val_if_fail (self != NULL, FALSE);
  g_return_val_if_fail (in_headers != NULL, FALSE);

  raw = cockpit_web_server_parse_cookie (in_headers, "cockpit");
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

  return ret;
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
                          const gchar *remote_peer,
                          GAsyncReadyCallback callback,
                          gpointer user_data)
{
  CockpitAuthClass *klass = COCKPIT_AUTH_GET_CLASS (self);
  g_return_if_fail (klass->login_async != NULL);
  klass->login_async (self, headers, remote_peer, callback, user_data);
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

  g_debug ("sending credential id '%s' for user '%s'", id,
           cockpit_creds_get_user (creds));

  g_free (id);

  if (out_headers)
    {
      gboolean force_secure = !(flags & COCKPIT_AUTH_COOKIE_INSECURE);
      cookie_b64 = g_base64_encode ((guint8 *)authenticated->cookie, strlen (authenticated->cookie));
      header = g_strdup_printf ("cockpit=%s; Path=/; %s HttpOnly",
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
