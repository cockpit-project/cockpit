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
#include <gsystem-local-alloc.h>

#include "websocket/websocket.h"

#include <glib/gstdio.h>

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

static void
cockpit_auth_finalize (GObject *object)
{
  CockpitAuth *self = COCKPIT_AUTH (object);

  g_byte_array_unref (self->key);
  g_mutex_clear (&self->mutex);
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

  g_mutex_init (&self->mutex);
  self->authenticated = g_hash_table_new_full (g_str_hash, g_str_equal,
                                               g_free, cockpit_creds_unref);
}

#define PAM_MAX_INPUTS 10

struct pam_conv_data {
  char *inputs[PAM_MAX_INPUTS];
  int current_input;
};

static int
pam_conv_func (int num_msg,
               const struct pam_message **msg,
               struct pam_response **resp,
               void *appdata_ptr)
{
  struct pam_conv_data *data = appdata_ptr;
  struct pam_response *r = calloc (sizeof(struct pam_response), num_msg);
  gboolean success = TRUE;

  int i;
  for (i = 0; i < num_msg; i++)
    {
      if ((*msg)[i].msg_style == PAM_PROMPT_ECHO_OFF)
        {
          if (data->current_input >= PAM_MAX_INPUTS
              || data->inputs[data->current_input] == NULL)
            success = FALSE;
          else
            {
              r[i].resp = g_strdup (data->inputs[data->current_input]);
              r[i].resp_retcode = 0;
              data->current_input++;
            }
        }
      else if ((*msg)[i].msg_style == PAM_PROMPT_ECHO_ON)
        success = FALSE;
    }

  if (success)
    {
      *resp = r;
      return PAM_SUCCESS;
    }
  else
    {
      for (i = 0; i < num_msg; i++)
        free (r[i].resp);
      free (r);
      return PAM_CONV_ERR;
    }
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

static gboolean
user_is_authorized (const gchar *user,
                    GError **error)
{
  /* Welcome!
   */
  return TRUE;
}

static gboolean
verify_userpass (CockpitAuth *self,
                 const char *content,
                 char **out_user,
                 char **out_password,
                 GError **error)
{
  gchar **lines = g_strsplit (content, "\n", 0);
  gboolean ret = FALSE;
  gchar *user;
  gchar *password;

  if (lines[0] == NULL
      || lines[1] == NULL
      || lines[2] != NULL)
    {
      g_set_error (error, G_IO_ERROR, G_IO_ERROR_INVALID_DATA,
                   "Malformed input");
      ret = FALSE;
      goto out;
    }

  user = lines[0];
  password = lines[1];

  if (!cockpit_auth_verify_password (self, user, password, error))
    goto out;

  if (!user_is_authorized (user, error))
    goto out;

  if (out_user)
    *out_user = g_strdup (user);
  if (out_password)
    *out_password = g_strdup (password);

  ret = TRUE;

out:
  g_strfreev (lines);
  return ret;
}

static gboolean
cockpit_auth_pam_verify_password (CockpitAuth *auth,
                                  const gchar *user,
                                  const gchar *password,
                                  GError **error)
{
  pam_handle_t *pamh = NULL;
  const char *pam_user = NULL;
  int pam_status = 0;
  gboolean ret = FALSE;
  struct pam_conv_data data;
  struct pam_conv conv;

  data.inputs[0] = (char *)password;
  data.inputs[1] = NULL;
  data.current_input = 0;
  conv.conv = pam_conv_func;
  conv.appdata_ptr = (void *)&data;

  pam_status = pam_start ("cockpit", user, &conv, &pamh);
  if (pam_status == PAM_SUCCESS)
    pam_status = pam_authenticate (pamh, 0);

  if (pam_status == PAM_SUCCESS)
    pam_status = pam_get_item (pamh, PAM_USER, (const void **)&pam_user);

  if (pam_status == PAM_AUTH_ERR || pam_status == PAM_USER_UNKNOWN)
    {
      g_set_error (error, COCKPIT_ERROR, COCKPIT_ERROR_AUTHENTICATION_FAILED,
                   "Authentication failed");
      ret = FALSE;
      goto out;
    }

  if (pam_status != PAM_SUCCESS)
    {
      g_set_error (error, COCKPIT_ERROR, COCKPIT_ERROR_FAILED,
                   "%s", pam_strerror (pamh, pam_status));
      ret = FALSE;
      goto out;
    }

  ret = TRUE;

out:
  if (pamh)
    pam_end (pamh, pam_status);
  return ret;
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
                             GHashTable *out_headers,
                             GError **error)
{
  CockpitCreds *creds;
  gs_free char *cookie = NULL;
  gs_free gchar *cookie_b64 = NULL;
  gchar *header;
  char *password;
  char *user;

  if (!verify_userpass (self, userpass, &user, &password, error))
    {
      g_debug ("user failed to verify");
      return FALSE;
    }

  creds = cockpit_creds_take_password (user, password);
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

gboolean
cockpit_auth_verify_password (CockpitAuth *auth,
                              const gchar *user,
                              const gchar *password,
                              GError **error)
{
  CockpitAuthClass *klass = COCKPIT_AUTH_GET_CLASS (auth);
  g_return_val_if_fail (klass->verify_password != NULL, FALSE);
  return klass->verify_password (auth, user, password, error);
}
