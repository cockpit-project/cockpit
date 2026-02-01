/*
 * Copyright (C) 2013 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#ifndef __WEB_SOCKET_SERVER_H__
#define __WEB_SOCKET_SERVER_H__

#include "websocketconnection.h"

#include <gio/gio.h>

G_BEGIN_DECLS

#define WEB_SOCKET_TYPE_SERVER         (web_socket_server_get_type ())
#define WEB_SOCKET_SERVER(o)           (G_TYPE_CHECK_INSTANCE_CAST ((o), WEB_SOCKET_TYPE_SERVER, WebSocketServer))
#define WEB_SOCKET_IS_SERVER(o)        (G_TYPE_CHECK_INSTANCE_TYPE ((o), WEB_SOCKET_TYPE_SERVER))
#define WEB_SOCKET_SERVER_GET_CLASS(o) (G_TYPE_INSTANCE_GET_CLASS ((o), WEB_SOCKET_TYPE_SERVER, WebSocketServerClass))
#define WEB_SOCKET_IS_SERVER_CLASS(k)  (G_TYPE_CHECK_CLASS_TYPE ((k), WEB_SOCKET_TYPE_SERVER))

GType                 web_socket_server_get_type           (void) G_GNUC_CONST;

WebSocketConnection * web_socket_server_new_for_stream     (const gchar * const *origins,
                                                            const gchar * const *protocols,
                                                            GIOStream *io_stream,
                                                            GHashTable *request_headers,
                                                            GByteArray *input_buffer);

G_END_DECLS

#endif /* __WEB_SOCKET_SERVER_H__ */
