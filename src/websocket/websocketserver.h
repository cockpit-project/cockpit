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

WebSocketConnection * web_socket_server_new_for_stream     (const gchar *url,
                                                            const gchar * const *origins,
                                                            const gchar * const *protocols,
                                                            GIOStream *io_stream,
                                                            GHashTable *request_headers,
                                                            GByteArray *input_buffer);

G_END_DECLS

#endif /* __WEB_SOCKET_SERVER_H__ */
