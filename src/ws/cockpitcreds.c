/*
 * Copyright (C) 2013 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#include "config.h"

#include "cockpitcreds.h"

#include "common/cockpitmemory.h"
#include "cockpitjson.h"

#include <string.h>

struct _CockpitCreds {
  gint refs;
  gint poisoned;
  gchar *user;
  gchar *application;
  GBytes *password;
  gchar *rhost;
  gchar *csrf_token;
  JsonObject *login_data;
  GList *bytes;
  gchar *superuser;
};

static void
cockpit_creds_free (gpointer data)
{
  CockpitCreds *creds = data;

  cockpit_creds_poison (creds);

  g_list_free_full (creds->bytes, (GDestroyNotify)g_bytes_unref);

  g_free (creds->user);
  g_free (creds->application);
  g_free (creds->rhost);
  g_free (creds->csrf_token);
  g_free (creds->superuser);

  if (creds->login_data)
    json_object_unref (creds->login_data);

  g_free (creds);
}

/**
 * cockpit_creds_new:
 * @application: the application the creds are for
 * @...: multiple credentials, followed by NULL
 *
 * Create a new set of credentials for a user. Each vararg should be
 * a COCKPIT_CRED_PASSWORD, COCKPIT_CRED_RHOST, or similar constant
 * followed by the value.
 *
 * COCKPIT_CRED_PASSWORD is a GBytes and should contain a null terminated
 * string with the terminator not included in the count.
 *
 * Returns: (transfer full): the new set of credentials.
 */
CockpitCreds *
cockpit_creds_new (const gchar *application,
                   ...)
{
  GBytes *password = NULL;
  CockpitCreds *creds;
  const char *type;
  va_list va;

  g_return_val_if_fail (application != NULL, NULL);
  g_return_val_if_fail (!g_str_equal (application, ""), NULL);

  creds = g_new0 (CockpitCreds, 1);
  creds->application = g_strdup (application);
  creds->login_data = NULL;

  va_start (va, application);
  for (;;)
    {
      type = va_arg (va, const char *);
      if (type == NULL)
        break;
      else if (g_str_equal (type, COCKPIT_CRED_USER))
        cockpit_creds_set_user (creds, va_arg (va, const char *));
      else if (g_str_equal (type, COCKPIT_CRED_PASSWORD))
        password = va_arg (va, GBytes *);
      else if (g_str_equal (type, COCKPIT_CRED_RHOST))
        creds->rhost = g_strdup (va_arg (va, const char *));
      else if (g_str_equal (type, COCKPIT_CRED_CSRF_TOKEN))
        creds->csrf_token = g_strdup (va_arg (va, const char *));
      else if (g_str_equal (type, COCKPIT_CRED_SUPERUSER))
        creds->superuser = g_strdup (va_arg (va, const char *));
      else
        g_assert_not_reached ();
    }
  va_end (va);

  if (password)
    cockpit_creds_set_password (creds, password);

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
  cockpit_creds_set_password (creds, NULL);
}

const gchar *
cockpit_creds_get_user (CockpitCreds *creds)
{
  g_return_val_if_fail (creds != NULL, NULL);
  return creds->user;
}

void
cockpit_creds_set_user (CockpitCreds *creds,
                        const gchar *user)
{
  g_return_if_fail (creds != NULL);
  if (user != creds->user)
    {
      g_free (creds->user);
      creds->user = g_strdup (user);
    }
}

const gchar *
cockpit_creds_get_application (CockpitCreds *creds)
{
  g_return_val_if_fail (creds != NULL, NULL);
  return creds->application;
}

GBytes *
cockpit_creds_get_password (CockpitCreds *creds)
{
  g_return_val_if_fail (creds != NULL, NULL);
  if (g_atomic_int_get (&creds->poisoned))
      return NULL;
  return creds->password;
}

void
cockpit_creds_set_password (CockpitCreds *creds,
                            GBytes *password)
{
  gpointer data;
  gsize length;

  g_return_if_fail (creds != NULL);

  if (creds->password)
    {
      data = (gpointer)g_bytes_get_data (creds->password, &length);
      cockpit_memory_clear (data, length);
      creds->password = NULL;
    }
  if (password)
    {
      data = (gpointer)g_bytes_get_data (password, &length);
      g_assert (((gchar *)data)[length] == '\0');
      creds->password = g_bytes_ref (password);
      creds->bytes = g_list_prepend (creds->bytes, creds->password);
    }
}

const gchar *
cockpit_creds_get_csrf_token (CockpitCreds *creds)
{
  g_return_val_if_fail (creds != NULL, NULL);
  return creds->csrf_token;
}

const gchar *
cockpit_creds_get_superuser (CockpitCreds *creds)
{
  g_return_val_if_fail (creds != NULL, NULL);
  return creds->superuser;
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

void
cockpit_creds_set_login_data (CockpitCreds *creds,
                              JsonObject *login_data)
{
  g_return_if_fail (creds != NULL);
  if (login_data)
    json_object_ref (login_data);
  if (creds->login_data)
    json_object_unref (creds->login_data);
  creds->login_data = login_data;
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

JsonObject *
cockpit_creds_to_json (CockpitCreds *creds)
{
  JsonObject *object = NULL;
  JsonObject *login_data = NULL;

  object = json_object_new ();
  json_object_set_string_member (object, "csrf-token", cockpit_creds_get_csrf_token (creds));

  login_data = cockpit_creds_get_login_data (creds);
  if (login_data)
      json_object_set_object_member (object, "login-data", json_object_ref (login_data));

  return object;
}
