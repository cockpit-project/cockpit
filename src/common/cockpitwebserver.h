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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

#ifndef __COCKPIT_WEB_SERVER_H__
#define __COCKPIT_WEB_SERVER_H__

#include <gio/gio.h>

#include "cockpitwebresponse.h"

G_BEGIN_DECLS

#define COCKPIT_TYPE_WEB_REQUEST (cockpit_web_request_get_type ())
typedef struct _CockpitWebRequest CockpitWebRequest;

GType
cockpit_web_request_get_type (void);

CockpitWebResponse *
cockpit_web_request_respond (CockpitWebRequest *self);

const gchar *
cockpit_web_request_get_original_path (CockpitWebRequest *self);

const gchar *
cockpit_web_request_get_path (CockpitWebRequest *self);

const gchar *
cockpit_web_request_get_query (CockpitWebRequest *self);

const gchar *
cockpit_web_request_get_method (CockpitWebRequest *self);

GHashTable *
cockpit_web_request_get_headers (CockpitWebRequest *self);

const gchar *
cockpit_web_request_lookup_header (CockpitWebRequest *self,
                                   const gchar *header);

gchar *
cockpit_web_request_parse_cookie (CockpitWebRequest *self,
                                  const gchar *name);

GIOStream *
cockpit_web_request_get_io_stream (CockpitWebRequest *self);

GHashTable *
cockpit_web_request_get_headers (CockpitWebRequest *self);

GByteArray *
cockpit_web_request_get_buffer (CockpitWebRequest *self);

const gchar *
cockpit_web_request_get_host (CockpitWebRequest *self);

const gchar *
cockpit_web_request_get_protocol (CockpitWebRequest *self);

gchar *
cockpit_web_request_get_remote_address (CockpitWebRequest *self);

const gchar *
cockpit_web_request_get_client_certificate (CockpitWebRequest *self);

gboolean
cockpit_web_request_accepts_encoding (CockpitWebRequest *self,
                                      const gchar *encoding);

#define COCKPIT_TYPE_WEB_SERVER  (cockpit_web_server_get_type ())
G_DECLARE_FINAL_TYPE(CockpitWebServer, cockpit_web_server, COCKPIT, WEB_SERVER, GObject)

extern guint cockpit_webserver_request_timeout;

typedef enum {
  COCKPIT_WEB_SERVER_NONE = 0,
  COCKPIT_WEB_SERVER_FOR_TLS_PROXY = 1 << 0,
  /* http → https redirection for non-localhost addresses */
  COCKPIT_WEB_SERVER_REDIRECT_TLS = 1 << 1,
  COCKPIT_WEB_SERVER_FLAGS_MAX = 1 << 2
} CockpitWebServerFlags;


CockpitWebServer * cockpit_web_server_new           (GTlsCertificate *certificate,
                                                     CockpitWebServerFlags flags);

void               cockpit_web_server_start         (CockpitWebServer *self);

GHashTable *       cockpit_web_server_new_table     (void);

gchar *            cockpit_web_server_parse_cookie    (GHashTable *headers,
                                                       const gchar *name);

gchar **           cockpit_web_server_parse_accept_list   (const gchar *accept,
                                                           const gchar *first);

CockpitWebServerFlags cockpit_web_server_get_flags         (CockpitWebServer *self);

guint16
cockpit_web_server_add_inet_listener (CockpitWebServer *self,
                                      const gchar *address,
                                      guint16 port,
                                      GError **error);

gboolean
cockpit_web_server_add_fd_listener (CockpitWebServer *self,
                                    int fd,
                                    GError **error);

void
cockpit_web_server_set_protocol_header (CockpitWebServer *self,
                                        const gchar *protocol_header);

void
cockpit_web_server_set_forwarded_for_header (CockpitWebServer *self,
                                             const gchar *forwarded_for_header);

G_END_DECLS

#endif /* __COCKPIT_WEB_SERVER_H__ */
