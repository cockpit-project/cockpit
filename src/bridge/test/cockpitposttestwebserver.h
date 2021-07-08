/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013-2021 Red Hat, Inc.
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

#ifndef __COCKPIT_POST_TEST_WEB_SERVER_H__
#define __COCKPIT_POST_TEST_WEB_SERVER_H__

#include <gio/gio.h>

G_BEGIN_DECLS

#define COCKPIT_TYPE_POST_TEST_WEB_SERVER  (cockpit_post_test_web_server_get_type ())
G_DECLARE_FINAL_TYPE(CockpitPostTestWebServer, cockpit_post_test_web_server, COCKPIT, POST_TEST_WEB_SERVER, GObject)

extern guint cockpit_post_test_webserver_request_timeout;

CockpitPostTestWebServer * cockpit_post_test_web_server_new          (const gchar *address,
                                                                      gint port,
                                                                      const gchar *output_filename,
                                                                      GCancellable *cancellable,
                                                                      GError **error);

void               cockpit_post_test_web_server_start                (CockpitPostTestWebServer *self);

gboolean           cockpit_post_test_web_server_add_socket           (CockpitPostTestWebServer *self,
                                                                      GSocket *socket,
                                                                      GError **error);

GHashTable *       cockpit_post_test_web_server_new_table            (void);

gchar *            cockpit_post_test_web_server_parse_cookie         (GHashTable *headers,
                                                                      const gchar *name);

gchar **           cockpit_post_test_web_server_parse_languages      (GHashTable *headers,
                                                                      const gchar *first);

gboolean           cockpit_post_test_web_server_get_socket_activated (CockpitPostTestWebServer *self);

gint               cockpit_post_test_web_server_get_port             (CockpitPostTestWebServer *self);

G_END_DECLS

#endif /* __COCKPIT_POST_TEST_WEB_SERVER_H__ */
