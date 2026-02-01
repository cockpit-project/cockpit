/*
 * Copyright (C) 2013-2014 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#ifndef __COCKPIT_WEB_SERVICE_H__
#define __COCKPIT_WEB_SERVICE_H__

#include "cockpitcreds.h"

#include "cockpitjson.h"
#include "cockpittransport.h"
#include "cockpitwebresponse.h"
#include "cockpitwebserver.h"

#include "websocket.h"

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
                                                      CockpitWebRequest *request);

CockpitCreds *       cockpit_web_service_get_creds   (CockpitWebService *self);
const gchar *        cockpit_web_service_get_id      (CockpitWebService *self);
void                 cockpit_web_service_set_id      (CockpitWebService *self,
                                                      const gchar *id);

gboolean             cockpit_web_service_get_idling  (CockpitWebService *self);

WebSocketConnection *   cockpit_web_service_create_socket    (const gchar **protocols,
                                                              CockpitWebRequest *request);

gchar *                 cockpit_web_service_unique_channel   (CockpitWebService *self);

CockpitTransport *      cockpit_web_service_get_transport    (CockpitWebService *self);

JsonObject *            cockpit_web_service_get_init         (CockpitWebService *self);

gboolean                cockpit_web_service_parse_binary     (JsonObject *open,
                                                              WebSocketDataType *type);

gboolean                cockpit_web_service_parse_external   (JsonObject *open,
                                                              const gchar **content_type,
                                                              const gchar **content_encoding,
                                                              const gchar **content_disposition,
                                                              const gchar ***protocols);

const gchar *           cockpit_web_service_get_host         (CockpitWebService *self,
                                                              const gchar *checksum);

const gchar *           cockpit_web_service_get_checksum     (CockpitWebService *self,
                                                              const gchar *host);

void                    cockpit_web_service_set_host_checksum       (CockpitWebService *self,
                                                                     const gchar *host,
                                                                     const gchar *checksum);

G_END_DECLS

#endif /* __COCKPIT_WEB_SERVICE_H__ */
