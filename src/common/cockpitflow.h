/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2018 Red Hat, Inc.
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

#ifndef COCKPIT_FLOW_H__
#define COCKPIT_FLOW_H__

#include <glib-object.h>

G_BEGIN_DECLS

#define COCKPIT_TYPE_FLOW             (cockpit_flow_get_type ())
G_DECLARE_INTERFACE(CockpitFlow, cockpit_flow, COCKPIT, FLOW, GObject)

struct _CockpitFlowInterface {
  GTypeInterface parent_iface;

  void       (* throttle)         (CockpitFlow *flow,
                                   CockpitFlow *controlling);
};

void                cockpit_flow_throttle        (CockpitFlow *flow,
                                                  CockpitFlow *controller);

void                cockpit_flow_emit_pressure   (CockpitFlow *flow,
                                                  gboolean pressure);

G_END_DECLS

#endif /* COCKPIT_FLOW_H__ */
