/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2014 Red Hat, Inc.
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

#ifndef __COCKPIT_TRANSPORT_H__
#define __COCKPIT_TRANSPORT_H__

#include <glib-object.h>
#include <json-glib/json-glib.h>

G_BEGIN_DECLS

#define COCKPIT_TYPE_TRANSPORT            (cockpit_transport_get_type ())
#define COCKPIT_TRANSPORT(o)              (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_TRANSPORT, CockpitTransport))
#define COCKPIT_IS_TRANSPORT(o)           (G_TYPE_CHECK_INSTANCE_TYPE ((o), COCKPIT_TYPE_TRANSPORT))
#define COCKPIT_TRANSPORT_CLASS(k)        (G_TYPE_CHECK_CLASS_CAST((k), COCKPIT_TYPE_TRANSPORT, CockpitTransportClass))
#define COCKPIT_TRANSPORT_GET_CLASS(o)    (G_TYPE_INSTANCE_GET_CLASS ((o), COCKPIT_TYPE_TRANSPORT, CockpitTransportClass))

typedef struct _CockpitTransport        CockpitTransport;
typedef struct _CockpitTransportClass   CockpitTransportClass;

struct _CockpitTransport
{
  GObject parent;
};

struct _CockpitTransportClass
{
  GObjectClass parent_class;

  /* signals */

  /*
   * Fired when the transport recieves a new message.
   */
  gboolean    (* recv)        (CockpitTransport *transport,
                               const gchar *channel,
                               GBytes *data);

  gboolean    (* control)     (CockpitTransport *transport,
                               const char *command,
                               const gchar *channel,
                               JsonObject *options,
                               GBytes *payload);

  void        (* closed)      (CockpitTransport *transport,
                               const gchar *problem);

  /* vfuncs */

  /*
   * Called when transport should queue a new message to send.
   */
  void        (* send)        (CockpitTransport *transport,
                               const gchar *channel,
                               GBytes *data);

  void        (* close)       (CockpitTransport *transport,
                               const gchar *problem);
};

GType       cockpit_transport_get_type       (void) G_GNUC_CONST;

void        cockpit_transport_send           (CockpitTransport *transport,
                                              const gchar *channel,
                                              GBytes *data);

void        cockpit_transport_close          (CockpitTransport *transport,
                                              const gchar *problem);

void        cockpit_transport_emit_recv      (CockpitTransport *transport,
                                              const gchar *channel,
                                              GBytes *data);

void        cockpit_transport_emit_closed    (CockpitTransport *transport,
                                              const gchar *problem);

GBytes *    cockpit_transport_parse_frame    (GBytes *message,
                                              gchar **channel);

gboolean    cockpit_transport_parse_command  (GBytes *payload,
                                              const gchar **command,
                                              const gchar **channel,
                                              JsonObject **options);

JsonObject *cockpit_transport_build_json     (const gchar *name,
                                              ...) G_GNUC_NULL_TERMINATED;

GBytes *    cockpit_transport_build_control  (const gchar *name,
                                              ...) G_GNUC_NULL_TERMINATED;

G_END_DECLS

#endif /* __COCKPIT_TRANSPORT_H__ */
