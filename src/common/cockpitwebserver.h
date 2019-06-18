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

#include <gio/gio.h>

G_BEGIN_DECLS

#define COCKPIT_TYPE_WEB_SERVER  (cockpit_web_server_get_type ())
G_DECLARE_FINAL_TYPE(CockpitWebServer, cockpit_web_server, COCKPIT, WEB_SERVER, GObject)

extern guint cockpit_webserver_request_timeout;
extern gsize cockpit_webserver_request_maximum;

typedef enum {
  COCKPIT_WEB_SERVER_NONE = 0,
  COCKPIT_WEB_SERVER_FOR_TLS_PROXY = 1 << 0,
  COCKPIT_WEB_SERVER_FLAGS_MAX = 1 << 1
} CockpitWebServerFlags;


CockpitWebServer * cockpit_web_server_new           (const gchar *address,
                                                     gint port,
                                                     GTlsCertificate *certificate,
                                                     CockpitWebServerFlags flags,
                                                     GCancellable *cancellable,
                                                     GError **error);

void               cockpit_web_server_start         (CockpitWebServer *self);

gboolean           cockpit_web_server_add_socket    (CockpitWebServer *self,
                                                     GSocket *socket,
                                                     GError **error);

GHashTable *       cockpit_web_server_new_table     (void);

gchar *            cockpit_web_server_parse_cookie    (GHashTable *headers,
                                                       const gchar *name);

gchar **           cockpit_web_server_parse_languages (GHashTable *headers,
                                                       const gchar *first);

gboolean           cockpit_web_server_get_socket_activated (CockpitWebServer *self);

gint               cockpit_web_server_get_port             (CockpitWebServer *self);

void               cockpit_web_server_set_redirect_tls     (CockpitWebServer *self,
                                                            gboolean          redirect_tls);

gboolean           cockpit_web_server_get_redirect_tls     (CockpitWebServer *self);

CockpitWebServerFlags cockpit_web_server_get_flags         (CockpitWebServer *self);

G_END_DECLS

#endif /* __COCKPIT_WEB_SERVER_H__ */
