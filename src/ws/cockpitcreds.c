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

#include "cockpitcreds.h"

#include "common/cockpitmemory.h"
#include "common/cockpitjson.h"

#include <krb5/krb5.h>
#include <gssapi/gssapi.h>
#include <gssapi/gssapi_krb5.h>
#include <gssapi/gssapi_ext.h>

#include <string.h>

struct _CockpitCreds {
  gint refs;
  gint poisoned;
  gchar *user;
  gchar *application;
  gchar *password;
  gchar *rhost;
  gchar *gssapi_creds;
  gchar *csrf_token;
  krb5_context krb5_ctx;
  krb5_ccache krb5_ccache;
  gchar *krb5_ccache_name;
  JsonObject *login_data;
};

G_DEFINE_BOXED_TYPE (CockpitCreds, cockpit_creds, cockpit_creds_ref, cockpit_creds_unref);

static void
cockpit_creds_free (gpointer data)
{
  CockpitCreds *creds = data;

  g_free (creds->user);
  g_free (creds->application);
  cockpit_secclear (creds->password, -1);
  g_free (creds->password);
  g_free (creds->rhost);
  g_free (creds->gssapi_creds);
  g_free (creds->csrf_token);

  if (creds->krb5_ctx)
    {
      if (creds->krb5_ccache)
        krb5_cc_destroy (creds->krb5_ctx, creds->krb5_ccache);
      if (creds->krb5_ccache_name)
        krb5_free_string (creds->krb5_ctx, creds->krb5_ccache_name);
      krb5_free_context (creds->krb5_ctx);
    }

  if (creds->login_data)
    json_object_unref (creds->login_data);

  g_free (creds);
}

static JsonObject *
parse_login_data (const gchar *json_str)
{
  JsonObject *results = NULL;
  JsonObject *login_data = NULL;
  GError *error = NULL;

  results = cockpit_json_parse_object (json_str, strlen(json_str), &error);
  if (!results)
    {
      g_warning ("received bad json data: %s", error->message);
      g_error_free (error);
      goto out;
    }

  if (!cockpit_json_get_object (results, "login-data", NULL, &login_data))
    {
      g_warning ("received bad login-data: %s", json_str);
      login_data = NULL;
      goto out;
    }

  if (login_data)
    login_data = json_object_ref (login_data);

out:
  if (results)
    json_object_unref (results);

  return login_data;
}

/**
 * cockpit_creds_new:
 * @user: the user name the creds are for
 * @application: the application the creds are for
 * @...: multiple credentials, followed by NULL
 *
 * Create a new set of credentials for a user. Each vararg should be
 * a COCKPIT_CRED_PASSWORD, COCKPIT_CRED_RHOST, or similar constant
 * followed by the value.
 *
 * Returns: (transfer full): the new set of credentials.
 */
CockpitCreds *
cockpit_creds_new (const gchar *user,
                   const gchar *application,
                   ...)
{
  krb5_error_code code;
  CockpitCreds *creds;
  const char *type;
  va_list va;

  g_return_val_if_fail (user != NULL, NULL);
  g_return_val_if_fail (!g_str_equal (user, ""), NULL);
  g_return_val_if_fail (application != NULL, NULL);
  g_return_val_if_fail (!g_str_equal (application, ""), NULL);

  creds = g_new0 (CockpitCreds, 1);
  creds->user = g_strdup (user);
  creds->application = g_strdup (application);
  creds->login_data = NULL;

  va_start (va, application);
  for (;;)
    {
      type = va_arg (va, const char *);
      if (type == NULL)
        break;
      else if (g_str_equal (type, COCKPIT_CRED_PASSWORD))
        creds->password = g_strdup (va_arg (va, const char *));
      else if (g_str_equal (type, COCKPIT_CRED_RHOST))
        creds->rhost = g_strdup (va_arg (va, const char *));
      else if (g_str_equal (type, COCKPIT_CRED_GSSAPI))
        creds->gssapi_creds = g_strdup (va_arg (va, const char *));
      else if (g_str_equal (type, COCKPIT_CRED_CSRF_TOKEN))
        creds->csrf_token = g_strdup (va_arg (va, const char *));
      else if (g_str_equal (type, COCKPIT_CRED_LOGIN_DATA))
        creds->login_data = parse_login_data(va_arg (va, const char *));
      else
        g_assert_not_reached ();
    }
  va_end (va);

  if (creds->gssapi_creds)
    {
      /*
       * All use of krb5_ctx happen in one thread at a time, either
       * while creating the CockpitCreds, or destroying it.
       */
      code = krb5_init_context (&creds->krb5_ctx);
      if (code != 0)
        {
          g_critical ("couldn't initialize krb5: %s",
                      krb5_get_error_message (NULL, code));
        }
      else
        {
          code = krb5_cc_new_unique (creds->krb5_ctx, "MEMORY", NULL, &creds->krb5_ccache);
          if (code == 0)
            code = krb5_cc_get_full_name (creds->krb5_ctx, creds->krb5_ccache, &creds->krb5_ccache_name);
          if (code != 0)
            {
              g_critical ("couldn't create krb5 ticket cache: %s",
                          krb5_get_error_message (creds->krb5_ctx, code));
            }
        }
    }

  creds->refs = 1;
  creds->poisoned = 0;
  return creds;
}

CockpitCreds *
cockpit_creds_ref (CockpitCreds *creds)
{
  g_return_val_if_fail (creds != NULL, NULL);
  g_atomic_int_inc (&creds->refs);
  return creds;
}

void
cockpit_creds_unref (gpointer creds)
{
  CockpitCreds *c = creds;
  g_return_if_fail (creds != NULL);
  if (g_atomic_int_dec_and_test (&c->refs))
    cockpit_creds_free (c);
}

void
cockpit_creds_poison (CockpitCreds *creds)
{
  g_return_if_fail (creds != NULL);
  g_atomic_int_set (&creds->poisoned, 1);
  if (creds->password)
    memset (creds->password, 0, strlen (creds->password));
}

const gchar *
cockpit_creds_get_user (CockpitCreds *creds)
{
  g_return_val_if_fail (creds != NULL, NULL);
  return creds->user;
}

const gchar *
cockpit_creds_get_application (CockpitCreds *creds)
{
  g_return_val_if_fail (creds != NULL, NULL);
  return creds->application;
}

const gchar *
cockpit_creds_get_password (CockpitCreds *creds)
{
  g_return_val_if_fail (creds != NULL, NULL);
  if (g_atomic_int_get (&creds->poisoned))
      return NULL;
  return creds->password;
}

const gchar *
cockpit_creds_get_gssapi_creds (CockpitCreds *creds)
{
  g_return_val_if_fail (creds != NULL, NULL);
  if (g_atomic_int_get (&creds->poisoned))
      return NULL;
  return creds->gssapi_creds;
}

const gchar *
cockpit_creds_get_krb5_ccache_name (CockpitCreds *creds)
{
  g_return_val_if_fail (creds != NULL, NULL);
  if (g_atomic_int_get (&creds->poisoned))
      return NULL;
  return creds->krb5_ccache_name;
}

const gchar *
cockpit_creds_get_csrf_token (CockpitCreds *creds)
{
  g_return_val_if_fail (creds != NULL, NULL);
  return creds->csrf_token;
}

/**
 * cockpit_creds_get_login_data
 * @creds: the credentials
 *
 * Get any login data, or NULL
 * if none present.
 *
 * Returns: A JsonObject (transfer none) or NULL
 */
JsonObject *
cockpit_creds_get_login_data (CockpitCreds *creds)
{
  g_return_val_if_fail (creds != NULL, NULL);
  return creds->login_data;
}

/**
 * cockpit_creds_get_rhost:
 * @creds: the credentials
 *
 * Get the remote host credential, or NULL
 * if none present.
 *
 * Returns: the remote host or NULL
 */
const gchar *
cockpit_creds_get_rhost (CockpitCreds *creds)
{
  g_return_val_if_fail (creds != NULL, NULL);
  return creds->rhost;
}

/**
 * cockpit_creds_has_gssapi:
 * @creds: the credentials
 *
 * Returns: true if this credentials instance has gssapi credentials
 * stored. Otherwise false.
 */
gboolean
cockpit_creds_has_gssapi (CockpitCreds *creds)
{
  g_return_val_if_fail (creds != NULL, FALSE);

  if (!creds->gssapi_creds || !creds->krb5_ccache_name)
    return FALSE;

  return TRUE;
}

gboolean
cockpit_creds_equal (gconstpointer v1,
                     gconstpointer v2)
{
  const CockpitCreds *c1;
  const CockpitCreds *c2;

  if (v1 == v2)
    return TRUE;
  if (!v1 || !v2)
    return FALSE;

  c1 = v1;
  c2 = v2;

  return g_strcmp0 (c1->user, c2->user) == 0 &&
         g_strcmp0 (c1->application, c2->application) == 0 &&
         g_strcmp0 (c1->rhost, c2->rhost) == 0;
}

guint
cockpit_creds_hash (gconstpointer v)
{
  const CockpitCreds *c = v;
  guint hash = 0;
  if (v)
    {
      c = v;
      if (c->user)
        hash ^= g_str_hash (c->user);
      if (c->application)
        hash ^= g_str_hash (c->application);
      if (c->rhost)
        hash ^= g_str_hash (c->rhost);
    }
  return hash;
}

JsonObject *
cockpit_creds_to_json (CockpitCreds *creds)
{
  JsonObject *object = NULL;
  JsonObject *login_data = NULL;

  object = json_object_new ();
  json_object_set_string_member (object, "user", cockpit_creds_get_user (creds));
  json_object_set_string_member (object, "csrf-token", cockpit_creds_get_csrf_token (creds));

  login_data = cockpit_creds_get_login_data (creds);
  if (login_data)
      json_object_set_object_member (object, "login-data", json_object_ref (login_data));

  return object;
}
