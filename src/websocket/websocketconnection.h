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

#ifndef __WEB_SOCKET_CONNECTION_H__
#define __WEB_SOCKET_CONNECTION_H__

#include "websocket.h"

#include <gio/gio.h>

G_BEGIN_DECLS

#define WEB_SOCKET_TYPE_CONNECTION         (web_socket_connection_get_type ())
#define WEB_SOCKET_CONNECTION(o)           (G_TYPE_CHECK_INSTANCE_CAST ((o), WEB_SOCKET_TYPE_CONNECTION, WebSocketConnection))
#define WEB_SOCKET_IS_CONNECTION(o)        (G_TYPE_CHECK_INSTANCE_TYPE ((o), WEB_SOCKET_TYPE_CONNECTION))
#define WEB_SOCKET_CONNECTION_CLASS(k)     (G_TYPE_CHECK_CLASS_CAST ((k), WEB_SOCKET_TYPE_CONNECTION, WebSocketConnectionClass))
#define WEB_SOCKET_CONNECTION_GET_CLASS(o) (G_TYPE_INSTANCE_GET_CLASS ((o), WEB_SOCKET_TYPE_CONNECTION, WebSocketConnectionClass))
#define WEB_SOCKET_IS_CONNECTION_CLASS(k)  (G_TYPE_CHECK_CLASS_TYPE ((k), WEB_SOCKET_TYPE_CONNECTION))

typedef struct _WebSocketConnectionPrivate  WebSocketConnectionPrivate;

struct _WebSocketConnection
{
  GObject parent;

  /*< private >*/
  WebSocketConnectionPrivate *pv;
};

struct _WebSocketConnectionClass
{
  GObjectClass parent;

  /* set by derived */
  gboolean server_behavior;

  /* vfuncs */
  gboolean  (* handshake)   (WebSocketConnection *self,
                             GByteArray *incoming);

  /* signals */
  void      (* open)        (WebSocketConnection *self);

  void      (* message)     (WebSocketConnection *self,
                             WebSocketDataType type,
                             GBytes *message);

  gboolean  (* error)       (WebSocketConnection *self,
                             GError *error);

  gboolean  (* closing)     (WebSocketConnection *self);

  void      (* close)       (WebSocketConnection *self);
};

GType           web_socket_connection_get_type            (void) G_GNUC_CONST;

const gchar *   web_socket_connection_get_url             (WebSocketConnection *self);

const gchar *   web_socket_connection_get_protocol        (WebSocketConnection *self);

WebSocketState  web_socket_connection_get_ready_state     (WebSocketConnection *self);

gsize           web_socket_connection_get_buffered_amount (WebSocketConnection *self);

gushort         web_socket_connection_get_close_code      (WebSocketConnection *self);

const gchar *   web_socket_connection_get_close_data      (WebSocketConnection *self);

GIOStream *     web_socket_connection_get_io_stream       (WebSocketConnection *self);

void            web_socket_connection_send                (WebSocketConnection *self,
                                                           WebSocketDataType type,
                                                           GBytes *prefix,
                                                           GBytes *payload);

void            web_socket_connection_close               (WebSocketConnection *self,
                                                           gushort code,
                                                           const gchar *data);

G_END_DECLS

#endif /* __WEB_SOCKET_CONNECTION_H__ */
