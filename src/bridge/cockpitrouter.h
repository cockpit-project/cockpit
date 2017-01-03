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

#ifndef __COCKPIT_ROUTER_H__
#define __COCKPIT_ROUTER_H__

#include "common/cockpittransport.h"

G_BEGIN_DECLS

typedef struct {
  const gchar *name;
  GType (* function) (void);
} CockpitPayloadType;

#define         COCKPIT_TYPE_ROUTER           (cockpit_router_get_type ())
#define         COCKPIT_ROUTER(o)             (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_ROUTER, CockpitRouter))
#define         COCKPIT_IS_ROUTER(o)          (G_TYPE_CHECK_INSTANCE_TYPE ((o), COCKPIT_TYPE_ROUTER))

typedef struct _CockpitRouter        CockpitRouter;

GType           cockpit_router_get_type     (void) G_GNUC_CONST;

CockpitRouter * cockpit_router_new          (CockpitTransport *transport,
                                             CockpitPayloadType *supported_payloads,
                                             const gchar *init_host);

G_END_DECLS

#endif /* __COCKPIT_ROUTER_H__ */
