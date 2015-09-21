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

#ifndef __COCKPIT_AUTH_H__
#define __COCKPIT_AUTH_H__

#include <pwd.h>
#include <gio/gio.h>

#include "cockpitcreds.h"
#include "cockpitwebservice.h"

#include "common/cockpittransport.h"

G_BEGIN_DECLS

#define COCKPIT_TYPE_AUTH         (cockpit_auth_get_type ())
#define COCKPIT_AUTH(o)           (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_AUTH, CockpitAuth))
#define COCKPIT_AUTH_GET_CLASS(o) (G_TYPE_INSTANCE_GET_CLASS ((o), COCKPIT_TYPE_AUTH, CockpitAuthClass))
#define COCKPIT_IS_AUTH_CLASS(k)  (G_TYPE_CHECK_CLASS_TYPE ((k), COCKPIT_TYPE_AUTH))

typedef enum {
    COCKPIT_AUTH_COOKIE_INSECURE = 1 << 1
} CockpitAuthFlags;

typedef struct _CockpitAuth        CockpitAuth;
typedef struct _CockpitAuthClass   CockpitAuthClass;

struct _CockpitAuth
{
  GObject parent_instance;

  GByteArray *key;
  GHashTable *authenticated;
  guint64 nonce_seed;
  gboolean login_loopback;
  gulong timeout_tag;
};

struct _CockpitAuthClass
{
  GObjectClass parent_class;

  /* vfunc */
  void           (* login_async)         (CockpitAuth *auth,
                                          const gchar *path,
                                          GHashTable *headers,
                                          const gchar *remote_peer,
                                          GAsyncReadyCallback callback,
                                          gpointer user_data);

  CockpitCreds * (* login_finish)        (CockpitAuth *auth,
                                          GAsyncResult *result,
                                          GHashTable *out_headers,
                                          CockpitTransport **transport,
                                          GError **error);
};

GType           cockpit_auth_get_type        (void) G_GNUC_CONST;

CockpitAuth *   cockpit_auth_new             (gboolean login_loopback);

void            cockpit_auth_login_async     (CockpitAuth *self,
                                              const gchar *path,
                                              GHashTable *headers,
                                              const gchar *remote_peer,
                                              GAsyncReadyCallback callback,
                                              gpointer user_data);

CockpitWebService *  cockpit_auth_login_finish    (CockpitAuth *self,
                                                   GAsyncResult *result,
                                                   CockpitAuthFlags flags,
                                                   GHashTable *out_headers,
                                                   GError **error);

CockpitWebService *  cockpit_auth_check_cookie    (CockpitAuth *self,
                                                   const gchar *path,
                                                   GHashTable *in_headers);

gchar *         cockpit_auth_parse_application    (const gchar *path);

GBytes *        cockpit_auth_parse_authorization  (GHashTable *headers,
                                                   gchar **type);

G_END_DECLS

#endif
