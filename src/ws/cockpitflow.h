/*
 * Copyright (C) 2018 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
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
