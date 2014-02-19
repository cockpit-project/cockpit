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

#include "config.h"

#include "cockpittransport.h"

enum {
  RECV,
  CLOSED,
  NUM_SIGNALS
};

static guint signals[NUM_SIGNALS];

typedef CockpitTransportIface CockpitTransportInterface;

static void   cockpit_transport_default_init    (CockpitTransportIface *iface);

G_DEFINE_INTERFACE (CockpitTransport, cockpit_transport, G_TYPE_OBJECT);

static void
cockpit_transport_default_init (CockpitTransportIface *iface)
{
  g_object_interface_install_property (iface,
             g_param_spec_string ("name", "name", "name", "<unnamed>",
                                  G_PARAM_READWRITE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));

  signals[RECV] = g_signal_new ("recv", COCKPIT_TYPE_TRANSPORT, G_SIGNAL_RUN_LAST,
                                G_STRUCT_OFFSET (CockpitTransportIface, recv),
                                g_signal_accumulator_true_handled, NULL,
                                g_cclosure_marshal_generic,
                                G_TYPE_BOOLEAN, 2, G_TYPE_UINT, G_TYPE_BYTES);

  signals[CLOSED] = g_signal_new ("closed", COCKPIT_TYPE_TRANSPORT, G_SIGNAL_RUN_FIRST,
                                  G_STRUCT_OFFSET (CockpitTransportIface, closed),
                                  NULL, NULL, g_cclosure_marshal_generic,
                                  G_TYPE_NONE, 1, G_TYPE_STRING);
}

void
cockpit_transport_send (CockpitTransport *transport,
                        guint channel,
                        GBytes *data)
{
  CockpitTransportIface *iface;

  g_return_if_fail (COCKPIT_IS_TRANSPORT (transport));

  /* TODO: Implement channel support later */
  g_return_if_fail (channel == 0);

  iface = COCKPIT_TRANSPORT_GET_IFACE(transport);
  g_return_if_fail (iface && iface->send);
  iface->send (transport, channel, data);
}

void
cockpit_transport_close (CockpitTransport *transport,
                         const gchar *problem)
{
  CockpitTransportIface *iface;

  g_return_if_fail (COCKPIT_IS_TRANSPORT (transport));

  iface = COCKPIT_TRANSPORT_GET_IFACE(transport);
  g_return_if_fail (iface && iface->close);
  iface->close (transport, problem);
}

void
cockpit_transport_emit_recv (CockpitTransport *transport,
                             guint channel,
                             GBytes *data)
{
  gboolean result = FALSE;

  g_return_if_fail (COCKPIT_IS_TRANSPORT (transport));

  /* TODO: Implement channel support later */
  g_return_if_fail (channel == 0);

  g_signal_emit (transport, signals[RECV], 0, channel, data, &result);

  if (!result)
    g_warning ("No handler for received message in channel %u, closing", channel);
}

void
cockpit_transport_emit_closed (CockpitTransport *transport,
                               const gchar *problem)
{
  g_return_if_fail (COCKPIT_IS_TRANSPORT (transport));
  g_signal_emit (transport, signals[CLOSED], 0, problem);
}
