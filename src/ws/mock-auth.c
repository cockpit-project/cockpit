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

#include "mock-auth.h"

#include "common/cockpitenums.h"
#include "common/cockpiterror.h"
#include "common/cockpitpipetransport.h"

#include "ws/cockpitws.h"

#include "websocket/websocket.h"

#include <string.h>

struct _MockAuth {
  CockpitAuth parent;
  gchar *expect_user;
  gchar *expect_password;
};

typedef struct _CockpitAuthClass MockAuthClass;

G_DEFINE_TYPE (MockAuth, mock_auth, COCKPIT_TYPE_AUTH)

static void
mock_auth_init (MockAuth *self)
{

}

static void
mock_auth_finalize (GObject *obj)
{
  MockAuth *self = MOCK_AUTH (obj);
  g_free (self->expect_user);
  g_free (self->expect_password);
  G_OBJECT_CLASS (mock_auth_parent_class)->finalize (obj);
}

static void
mock_auth_login_async (CockpitAuth *auth,
                       const gchar *path,
                       GHashTable *headers,
                       const gchar *remote_peer,
                       GAsyncReadyCallback callback,
                       gpointer user_data)
{
  MockAuth *self = MOCK_AUTH (auth);
  GSimpleAsyncResult *result;
  GBytes *userpass;
  gchar **split;
  gboolean correct = FALSE;
  gchar *type = NULL;

  result = g_simple_async_result_new (G_OBJECT (auth), callback, user_data, NULL);

  g_object_set_data_full (G_OBJECT (result), "remote", g_strdup (remote_peer), g_free);
  g_object_set_data_full (G_OBJECT (result), "application", cockpit_auth_parse_application (path), g_free);

  userpass = cockpit_auth_parse_authorization (headers, &type);
  if (userpass && g_str_equal (type, "basic"))
    {
      split = g_strsplit (g_bytes_get_data (userpass, NULL), ":", 2);
      correct = split[0] && split[1] &&
                g_str_equal (split[0], self->expect_user) &&
                g_str_equal (split[1], self->expect_password);
      g_strfreev (split);
    }

  if (!correct)
    {
      g_simple_async_result_set_error (result, COCKPIT_ERROR,
                                       COCKPIT_ERROR_AUTHENTICATION_FAILED,
                                       "Authentication failed");
    }

  g_simple_async_result_complete_in_idle (result);
  g_object_unref (result);

  g_free (type);
  g_bytes_unref (userpass);
}

static CockpitCreds *
mock_auth_login_finish (CockpitAuth *auth,
                        GAsyncResult *async,
                        GHashTable *headers,
                        CockpitTransport **transport,
                        GError **error)
{
  MockAuth *self = MOCK_AUTH (auth);
  GSimpleAsyncResult *result = G_SIMPLE_ASYNC_RESULT (async);
  CockpitCreds *creds;
  CockpitPipe *pipe;

  const gchar *argv[] = {
    cockpit_ws_bridge_program ? cockpit_ws_bridge_program : BUILDDIR "/cockpit-bridge",
    NULL
  };

  if (g_simple_async_result_propagate_error (result, error))
      return NULL;

  creds = cockpit_creds_new (self->expect_user,
                             g_object_get_data (G_OBJECT (result), "application"),
                             COCKPIT_CRED_PASSWORD, self->expect_password,
                             COCKPIT_CRED_RHOST, g_object_get_data (G_OBJECT (result), "remote"),
                             NULL);

  if (transport)
    {
      pipe = cockpit_pipe_spawn (argv, NULL, NULL, COCKPIT_PIPE_FLAGS_NONE);
      *transport = cockpit_pipe_transport_new (pipe);
      g_object_unref (pipe);
    }

  return creds;
}

static void
mock_auth_class_init (MockAuthClass *klass)
{
  GObjectClass *object_class = G_OBJECT_CLASS (klass);

  klass->login_async = mock_auth_login_async;
  klass->login_finish = mock_auth_login_finish;
  object_class->finalize = mock_auth_finalize;
}

CockpitAuth *
mock_auth_new (const char *expect_user,
               const char *expect_password)
{
  MockAuth *self;

  g_assert (expect_user != NULL);
  g_assert (expect_password != NULL);

  self = g_object_new (MOCK_TYPE_AUTH, NULL);
  self->expect_user = g_strdup (expect_user);
  self->expect_password = g_strdup (expect_password);

  return COCKPIT_AUTH (self);
}

GHashTable *
mock_auth_basic_header (const gchar *user,
                        const gchar *password)
{
  GHashTable *headers;
  gchar *userpass;
  gchar *encoded;
  gchar *header;

  userpass = g_strdup_printf ("%s:%s", user, password);
  encoded = g_base64_encode ((guchar *)userpass, strlen (userpass));
  header = g_strdup_printf ("Basic %s", encoded);

  g_free (userpass);
  g_free (encoded);

  headers = web_socket_util_new_headers ();
  g_hash_table_insert (headers, g_strdup ("Authorization"), header);
  return headers;
}
