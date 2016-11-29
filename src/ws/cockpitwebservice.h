/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013-2014 Red Hat, Inc.
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

#ifndef __COCKPIT_WEB_SERVICE_H__
#define __COCKPIT_WEB_SERVICE_H__

#include "cockpitcreds.h"

#include "common/cockpitjson.h"
#include "common/cockpittransport.h"
#include "common/cockpitwebresponse.h"

#include "websocket/websocket.h"

G_BEGIN_DECLS

#define COCKPIT_TYPE_WEB_SERVICE         (cockpit_web_service_get_type ())
#define COCKPIT_WEB_SERVICE(o)           (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_WEB_SERVICE, CockpitWebService))
#define COCKPIT_IS_WEB_SERVICE(o)        (G_TYPE_CHECK_INSTANCE_TYPE ((o), COCKPIT_TYPE_WEB_SERVICE))

typedef struct _CockpitWebService   CockpitWebService;

GType                cockpit_web_service_get_type    (void);

CockpitWebService *  cockpit_web_service_new         (CockpitCreds *creds,
                                                      CockpitTransport *local_session);

void                 cockpit_web_service_disconnect  (CockpitWebService *self);

void                 cockpit_web_service_socket      (CockpitWebService *self,
                                                      const gchar *path,
                                                      GIOStream *io_stream,
                                                      GHashTable *headers,
                                                      GByteArray *input_buffer);

CockpitCreds *       cockpit_web_service_get_creds   (CockpitWebService *self);

gboolean             cockpit_web_service_get_idling  (CockpitWebService *self);

WebSocketConnection *   cockpit_web_service_create_socket    (const gchar **protocols,
                                                              const gchar *path,
                                                              GIOStream *io_stream,
                                                              GHashTable *headers,
                                                              GByteArray *input_buffer);

gchar *                 cockpit_web_service_unique_channel   (CockpitWebService *self);

CockpitTransport *      cockpit_web_service_ensure_transport (CockpitWebService *self,
                                                              JsonObject *open);

CockpitTransport *      cockpit_web_service_find_transport   (CockpitWebService *self,
                                                              const gchar *checksum);

const gchar *           cockpit_web_service_get_checksum     (CockpitWebService *self,
                                                              CockpitTransport *transport);

const gchar *           cockpit_web_service_get_host         (CockpitWebService *self,
                                                              CockpitTransport *transport);

gboolean                cockpit_web_service_parse_binary     (JsonObject *open,
                                                              WebSocketDataType *type);

gboolean                cockpit_web_service_parse_external   (JsonObject *open,
                                                              const gchar **content_type,
                                                              const gchar **content_disposition,
                                                              gchar ***protocols);

void           cockpit_web_service_get_transport_init_message_aysnc  (CockpitWebService *self,
                                                                      CockpitTransport *transport,
                                                                      GAsyncReadyCallback callback,
                                                                      gpointer user_data);

JsonObject *   cockpit_web_service_get_transport_init_message_finish (CockpitWebService *self,
                                                                      GAsyncResult *result);
G_END_DECLS

#endif /* __COCKPIT_WEB_SERVICE_H__ */
