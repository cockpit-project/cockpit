/*
 * Copyright (C) 2013 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#ifndef __WEB_SOCKET_H__
#define __WEB_SOCKET_H__

#include <gio/gio.h>

G_BEGIN_DECLS

#define WEB_SOCKET_ERROR        (web_socket_error_get_quark ())

GQuark          web_socket_error_get_quark     (void) G_GNUC_CONST;

GHashTable *    web_socket_util_new_headers    (void);

gssize          web_socket_util_parse_headers  (const gchar *data,
                                                gsize length,
                                                GHashTable **headers);

gssize          web_socket_util_parse_req_line (const gchar *data,
                                                gsize length,
                                                gchar **method,
                                                gchar **resource);

gssize       web_socket_util_parse_status_line (const gchar *data,
                                                gsize length,
                                                gchar **version,
                                                guint *status,
                                                gchar **reason);

typedef enum {
  WEB_SOCKET_DATA_TEXT = 0x01,
  WEB_SOCKET_DATA_BINARY = 0x02,
} WebSocketDataType;

typedef enum {
  WEB_SOCKET_CLOSE_NORMAL = 1000,
  WEB_SOCKET_CLOSE_GOING_AWAY = 1001,
  WEB_SOCKET_CLOSE_NO_STATUS = 1005,
  WEB_SOCKET_CLOSE_ABNORMAL = 1006,
  WEB_SOCKET_CLOSE_PROTOCOL = 1002,
  WEB_SOCKET_CLOSE_UNSUPPORTED_DATA = 1003,
  WEB_SOCKET_CLOSE_BAD_DATA = 1007,
  WEB_SOCKET_CLOSE_POLICY_VIOLATION = 1008,
  WEB_SOCKET_CLOSE_TOO_BIG = 1009,
  WEB_SOCKET_CLOSE_NO_EXTENSION = 1010,
  WEB_SOCKET_CLOSE_SERVER_ERROR = 1011,
  WEB_SOCKET_CLOSE_TLS_HANDSHAKE = 1015,
} WebSocketCloseCodes;

typedef enum {
  WEB_SOCKET_STATE_CONNECTING = 0,
  WEB_SOCKET_STATE_OPEN = 1,
  WEB_SOCKET_STATE_CLOSING = 2,
  WEB_SOCKET_STATE_CLOSED = 3,
} WebSocketState;

typedef struct _WebSocketConnection       WebSocketConnection;
typedef struct _WebSocketConnectionClass  WebSocketConnectionClass;
typedef struct _WebSocketClient           WebSocketClient;
typedef struct _WebSocketClientClass      WebSocketClientClass;
typedef struct _WebSocketServer           WebSocketServer;
typedef struct _WebSocketServerClass      WebSocketServerClass;

#include "websocketconnection.h"
#include "websocketclient.h"
#include "websocketserver.h"

G_END_DECLS

#endif /* __WEB_SOCKET_H__ */
