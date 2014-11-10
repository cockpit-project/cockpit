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

#ifndef __COCKPIT_WEB_SERVER_H__
#define __COCKPIT_WEB_SERVER_H__

#include "cockpitwstypes.h"

G_BEGIN_DECLS

#define COCKPIT_TYPE_WEB_SERVER  (cockpit_web_server_get_type ())
#define COCKPIT_WEB_SERVER(o)    (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_WEB_SERVER, CockpitWebServer))
#define COCKPIT_IS_WEB_SERVER(o) (G_TYPE_CHECK_INSTANCE_TYPE ((o), COCKPIT_TYPE_WEB_SERVER))

GType              cockpit_web_server_get_type      (void) G_GNUC_CONST;

CockpitWebServer * cockpit_web_server_new           (gint port,
                                                     GTlsCertificate *certificate,
                                                     const gchar **document_roots,
                                                     GCancellable *cancellable,
                                                     GError **error);

GHashTable *       cockpit_web_server_new_table     (void);

gchar *            cockpit_web_server_parse_cookie    (GHashTable *headers,
                                                       const gchar *name);

gchar **           cockpit_web_server_parse_languages (GHashTable *headers,
                                                       const gchar *cookie);

gchar **           cockpit_web_server_resolve_roots (const gchar *root,
                                                     ...) G_GNUC_NULL_TERMINATED;

gboolean           cockpit_web_server_get_socket_activated (CockpitWebServer *self);

G_END_DECLS

#endif /* __COCKPIT_WEB_SERVER_H__ */
