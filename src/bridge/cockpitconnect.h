/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
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

#ifndef __COCKPIT_CONNECT_H__
#define __COCKPIT_CONNECT_H__

#include <gio/gio.h>

#include "common/cockpitchannel.h"

G_BEGIN_DECLS

typedef struct {
  gint refs;
  gchar *name;

  /* Where to connect to */
  GSocketConnectable *address;

  /* TLS flags */
  gboolean tls;
  gboolean local;
  GTlsCertificateFlags tls_flags;
  GTlsCertificate *tls_cert;
  GTlsDatabase *tls_database;
} CockpitConnectable;

CockpitConnectable *    cockpit_connectable_ref    (CockpitConnectable *connectable);

void                    cockpit_connectable_unref  (gpointer data);
G_DEFINE_AUTOPTR_CLEANUP_FUNC(CockpitConnectable, cockpit_connectable_unref)

void                    cockpit_connect_stream        (GSocketConnectable *address,
                                                       GCancellable *cancellable,
                                                       GAsyncReadyCallback callback,
                                                       gpointer user_data);


void                    cockpit_connect_stream_full   (CockpitConnectable *connectable,
                                                       GCancellable *cancellable,
                                                       GAsyncReadyCallback callback,
                                                       gpointer user_data);

GIOStream *             cockpit_connect_stream_finish (GAsyncResult *result,
                                                       GError **error);

CockpitConnectable *    cockpit_connect_parse_stream  (CockpitChannel *self);

GSocketAddress *        cockpit_connect_parse_address (CockpitChannel *self,
                                                       gchar **possible_name);

void                    cockpit_connect_add_internal_address        (const gchar *name,
                                                                     GSocketAddress *address);

gboolean                cockpit_connect_remove_internal_address     (const gchar *name);

G_END_DECLS

#endif /* __COCKPIT_STREAM_H__ */
