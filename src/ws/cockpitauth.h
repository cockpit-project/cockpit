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

#ifndef COCKPIT_AUTH_H_22A5945BB8AA45CB826129640F1C47FA
#define COCKPIT_AUTH_H_22A5945BB8AA45CB826129640F1C47FA

#include <pwd.h>
#include <gio/gio.h>

G_BEGIN_DECLS

#define COCKPIT_TYPE_AUTH         (cockpit_auth_get_type ())
#define COCKPIT_AUTH(o)           (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_AUTH, CockpitAuth))
#define COCKPIT_AUTH_GET_CLASS(o) (G_TYPE_INSTANCE_GET_CLASS ((o), COCKPIT_TYPE_AUTH, CockpitAuthClass))
#define COCKPIT_IS_AUTH_CLASS(k)  (G_TYPE_CHECK_CLASS_TYPE ((k), COCKPIT_TYPE_AUTH))

typedef struct CockpitAuth        CockpitAuth;
typedef struct CockpitAuthClass   CockpitAuthClass;

struct CockpitAuth
{
  GObject parent_instance;

  GByteArray *key;
  GMutex mutex;
  GHashTable *authenticated;
  guint64 nonce_seed;
};

struct CockpitAuthClass
{
  GObjectClass parent_class;

  /* vfunc */
  gboolean    (* verify_password)        (CockpitAuth *auth,
                                          const gchar *user,
                                          const gchar *password,
                                          GError **error);
};

GType           cockpit_auth_get_type        (void) G_GNUC_CONST;

CockpitAuth *   cockpit_auth_new             (void);

gboolean        cockpit_auth_check_userpass  (CockpitAuth *auth,
                                              const char *content,
                                              char **out_cookie,
                                              char **out_user,
                                              char **out_password,
                                              GError **error);

gboolean        cockpit_auth_check_headers   (CockpitAuth *auth,
                                              GHashTable *headers,
                                              char **out_user,
                                              char **out_password);

gboolean        cockpit_auth_verify_password (CockpitAuth *auth,
                                              const gchar *user,
                                              const gchar *password,
                                              GError **error);

struct passwd * cockpit_getpwnam_a           (const gchar *user,
                                              int *errp);

G_END_DECLS

#endif
