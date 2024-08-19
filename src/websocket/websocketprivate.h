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

#ifndef __WEB_SOCKET_PRIVATE_H__
#define __WEB_SOCKET_PRIVATE_H__

#include <gio/gio.h>

G_BEGIN_DECLS

gboolean     _web_socket_util_parse_url         (const gchar *url,
                                                 gchar **out_scheme,
                                                 gchar **out_host,
                                                 gchar **out_path,
                                                 GError **error);

gboolean     _web_socket_util_header_equals     (GHashTable *headers,
                                                 const gchar *name,
                                                 const gchar *want);

gboolean     _web_socket_util_header_contains   (GHashTable *headers,
                                                 const gchar *name,
                                                 const gchar *word);

gboolean     _web_socket_util_header_empty      (GHashTable *headers,
                                                 const gchar *name);

typedef enum {
  WEB_SOCKET_QUEUE_NORMAL = 0,
  WEB_SOCKET_QUEUE_URGENT = 1 << 0,
  WEB_SOCKET_QUEUE_LAST = 1 << 1,
} WebSocketQueueFlags;

void             _web_socket_connection_queue             (WebSocketConnection *conn,
                                                           WebSocketQueueFlags flags,
                                                           gpointer frame,
                                                           gsize length,
                                                           gsize buffered_amount);

GMainContext *   _web_socket_connection_get_main_context  (WebSocketConnection *self);

gboolean         _web_socket_connection_error             (WebSocketConnection *self,
                                                           GError *error);

void             _web_socket_connection_error_and_close   (WebSocketConnection *self,
                                                           GError *error,
                                                           gboolean prejudice);

void             _web_socket_connection_take_io_stream    (WebSocketConnection *self,
                                                           GIOStream *io_stream);

void             _web_socket_connection_take_incoming     (WebSocketConnection *self,
                                                           GByteArray *input_buffer);

gboolean         _web_socket_connection_choose_protocol   (WebSocketConnection *self,
                                                           const gchar **protocols,
                                                           const gchar *value);

gchar *          _web_socket_complete_accept_key_rfc6455  (const gchar *key);

G_END_DECLS

#endif /* __WEB_SOCKET_PRIVATE_H__ */
