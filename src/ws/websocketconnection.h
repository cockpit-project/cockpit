/*
 * Copyright (C) 2013 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#pragma once

#include "websocket.h"

#include <gio/gio.h>

G_BEGIN_DECLS

#define WEB_SOCKET_TYPE_CONNECTION (web_socket_connection_get_type ())
G_DECLARE_DERIVABLE_TYPE(WebSocketConnection, web_socket_connection, WEB_SOCKET, CONNECTION, GObject)

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
