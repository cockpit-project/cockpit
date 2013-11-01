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
#include "libgsystem.h"

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

typedef struct {
  gchar *user;
  gchar *password;
} CockpitCredentials;

static void
cockpit_credentials_free (gpointer data)
{
  CockpitCredentials *credentials = data;
  g_free (credentials->user);
  g_free (credentials->password);
  g_free (credentials);
}

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
                                               g_free, cockpit_credentials_free);
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
  struct passwd *buf, *ret;

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
  int pam_status = 0;
  const char *pam_user;
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

static void
cockpit_auth_class_init (CockpitAuthClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);

  gobject_class->finalize = cockpit_auth_finalize;

  klass->verify_password = cockpit_auth_pam_verify_password;
}

static char *
authenticated_user_to_id (CockpitAuth *self,
                          const char *user,
                          const char *password)
{
  CockpitCredentials *credentials;
  guint64 seed;
  char *id;

  g_mutex_lock (&self->mutex);

  credentials = g_new0 (CockpitCredentials, 1);
  credentials->user = g_strdup (user);
  credentials->password = g_strdup (password);

  seed = self->nonce_seed++;
  id = g_compute_hmac_for_data (G_CHECKSUM_SHA256,
                                self->key->data, self->key->len,
                                (guchar *)&seed, sizeof (seed));
  g_hash_table_insert (self->authenticated, g_strdup (id), credentials);

  g_mutex_unlock (&self->mutex);

  g_debug ("sending credential id '%s' for user '%s'", id, user);
  return id;
}

static gboolean
authenticated_id_to_user (CockpitAuth *self,
                          const char *id,
                          char **out_user,
                          char **out_password)
{
  CockpitCredentials *credentials;

  g_mutex_lock (&self->mutex);

  credentials = g_hash_table_lookup (self->authenticated, id);
  if (credentials && out_user)
    *out_user = g_strdup (credentials->user);
  if (credentials && out_password)
    *out_password = g_strdup (credentials->password);

  if (credentials)
    g_debug ("received credential id '%s' for user '%s'", id, credentials->user);
  else
    g_debug ("received unknown/invalid credential id '%s'", id);

  g_mutex_unlock (&self->mutex);

  return credentials != NULL;
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

/**
 * cockpit_auth_check_userpass:
 * @self:
 * @userpass: String of the form "<user>\n<pass>" - utf8
 * @out_cookie: (out): Authentication cookie, suitable for encoding as HTTP cookie
 * @error: a #GError
 *
 * Verify the given password.
 */
gboolean
cockpit_auth_check_userpass (CockpitAuth *self,
                             const char *userpass,
                             char **out_cookie,
                             char **out_user,
                             char **out_password,
                             GError **error)
{
  gs_free char *ret_cookie = NULL;
  gs_free char *password = NULL;
  gs_free char *user = NULL;
  gs_free char *id = NULL;

  if (!verify_userpass (self, userpass, &user, &password, error))
    {
      g_debug ("user failed to verify");
      return FALSE;
    }

  id = authenticated_user_to_id (self, user, password);
  ret_cookie = g_strdup_printf ("v=2;k=%s", id);

  if (out_user)
    {
      *out_user = user;
      user = NULL;
    }

  if (out_password)
    {
      *out_password = password;
      password = NULL;
    }

  if (out_cookie)
    {
      *out_cookie = ret_cookie;
      ret_cookie = NULL;
    }

  return TRUE;
}

gboolean
cockpit_auth_check_headers (CockpitAuth *auth,
                            GHashTable *headers,
                            char **out_user,
                            char **out_password)
{
  gs_unref_hashtable GHashTable *cookies = NULL;
  gs_free gchar *auth_cookie = NULL;
  const char *prefix = "v=2;k=";

  if (out_user)
    *out_user = NULL;
  if (out_password)
    *out_password = NULL;

  if (auth == NULL)
    {
      *out_user = g_strdup (g_get_user_name ());
      *out_password = g_strdup ("<noauth>");
      return TRUE;
    }

  if (!cockpit_web_server_parse_cookies (headers, &cookies, NULL))
    return FALSE;

  auth_cookie = base64_decode_string (g_hash_table_lookup (cookies, "CockpitAuth"));
  if (auth_cookie == NULL)
    return FALSE;

  if (!g_str_has_prefix (auth_cookie, prefix))
    {
      g_debug ("invalid or unsupported cookie: %s", auth_cookie);
      return FALSE;
    }

  return authenticated_id_to_user (auth, auth_cookie + strlen (prefix),
                                   out_user, out_password);
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
