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

#ifndef __WEB_SOCKET_CLIENT_H__
#define __WEB_SOCKET_CLIENT_H__

#include "websocketconnection.h"

#include <gio/gio.h>

G_BEGIN_DECLS

#define WEB_SOCKET_TYPE_CLIENT         (web_socket_client_get_type ())
#define WEB_SOCKET_CLIENT(o)           (G_TYPE_CHECK_INSTANCE_CAST ((o), WEB_SOCKET_TYPE_CLIENT, WebSocketClient))
#define WEB_SOCKET_IS_CLIENT(o)        (G_TYPE_CHECK_INSTANCE_TYPE ((o), WEB_SOCKET_TYPE_CLIENT))
#define WEB_SOCKET_CLIENT_GET_CLASS(o) (G_TYPE_INSTANCE_GET_CLASS ((o), WEB_SOCKET_TYPE_CLIENT, WebSocketClientClass))
#define WEB_SOCKET_IS_CLIENT_CLASS(k)  (G_TYPE_CHECK_CLASS_TYPE ((k), WEB_SOCKET_TYPE_CLIENT))

GType                 web_socket_client_get_type           (void) G_GNUC_CONST;

WebSocketConnection * web_socket_client_new                (const gchar *url,
                                                            const gchar *origin,
                                                            const gchar **protocols);

WebSocketConnection * web_socket_client_new_for_stream     (const gchar *url,
                                                            const gchar *origin,
                                                            const gchar **protocols,
                                                            GIOStream *io_stream);

void                  web_socket_client_include_header     (WebSocketClient *self,
                                                            const gchar *name,
                                                            const gchar *value);

GHashTable *          web_socket_client_get_headers        (WebSocketClient *self);

G_END_DECLS

#endif /* __WEB_SOCKET_CLIENT_H__ */
