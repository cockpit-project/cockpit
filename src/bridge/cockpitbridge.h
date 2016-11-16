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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

#ifndef __COCKPIT_BRIDGE_H__
#define __COCKPIT_BRIDGE_H__

#include "common/cockpittransport.h"

G_BEGIN_DECLS

typedef struct {
  const gchar *name;
  GType (* function) (void);
} CockpitPayloadType;

#define         COCKPIT_TYPE_BRIDGE           (cockpit_bridge_get_type ())
#define         COCKPIT_BRIDGE(o)            (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_BRIDGE, CockpitBridge))
#define         COCKPIT_BRIDGE_GET_CLASS(o)   (G_TYPE_INSTANCE_GET_CLASS ((o), COCKPIT_TYPE_BRIDGE, CockpitAuthClass))
#define         COCKPIT_IS_BRIDGE_CLASS(k)    (G_TYPE_CHECK_CLASS_TYPE ((k), COCKPIT_TYPE_BRIDGE))
#define         COCKPIT_IS_BRIDGE(o)          (G_TYPE_CHECK_INSTANCE_TYPE ((o), COCKPIT_TYPE_BRIDGE))

typedef struct _CockpitBridge        CockpitBridge;
typedef struct _CockpitBridgeClass   CockpitBridgeClass;

GType           cockpit_bridge_get_type     (void) G_GNUC_CONST;

CockpitBridge * cockpit_bridge_new          (CockpitTransport *transport,
                                             CockpitPayloadType *supported_payloads,
                                             const gchar *init_host);

G_END_DECLS

#endif /* __COCKPIT_CHANNEL_H__ */
