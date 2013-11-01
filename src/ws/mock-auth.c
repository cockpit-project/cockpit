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

#include "cockpit/cockpitenums.h"
#include "cockpit/cockpiterror.h"

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

static gboolean
mock_auth_verify_password (CockpitAuth *auth,
                           const gchar *user,
                           const gchar *password,
                           GError **error)
{
  MockAuth *self = MOCK_AUTH (auth);

  g_assert (user != NULL);
  g_assert (password != NULL);

  if (g_str_equal (user, self->expect_user) &&
      g_str_equal (password, self->expect_password))
    return TRUE;

  g_set_error (error, COCKPIT_ERROR, COCKPIT_ERROR_AUTHENTICATION_FAILED,
               "Authentication failed");
  return FALSE;
}

static void
mock_auth_class_init (MockAuthClass *klass)
{
  GObjectClass *object_class = G_OBJECT_CLASS (klass);

  klass->verify_password = mock_auth_verify_password;
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
