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

struct _CockpitCreds {
  gint refs;
  gchar *user;
  gchar *password;
};

G_DEFINE_BOXED_TYPE (CockpitCreds, cockpit_creds, cockpit_creds_ref, cockpit_creds_unref);

static void
cockpit_creds_free (gpointer data)
{
  CockpitCreds *creds = data;
  g_free (creds->user);
  g_free (creds->password);
  g_free (creds);
}

CockpitCreds *
cockpit_creds_new_password (const gchar *user,
                            const gchar *password)
{
  CockpitCreds *creds = g_new0 (CockpitCreds, 1);
  creds->user = g_strdup (user);
  creds->password = g_strdup (password);
  creds->refs = 1;
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

const gchar *
cockpit_creds_get_user (CockpitCreds *creds)
{
  g_return_val_if_fail (creds != NULL, NULL);
  return creds->user;
}

const gchar *
cockpit_creds_get_password (CockpitCreds *creds)
{
  g_return_val_if_fail (creds != NULL, NULL);
  return creds->password;
}
