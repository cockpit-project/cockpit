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

#ifndef __COCKPIT_PORTAL_H__
#define __COCKPIT_PORTAL_H__

#include <gio/gio.h>

#include "common/cockpittransport.h"

G_BEGIN_DECLS

typedef enum {
  COCKPIT_PORTAL_NORMAL = 0,
  COCKPIT_PORTAL_FALLBACK = 1 << 0
} CockpitPortalFlags;

#define COCKPIT_TYPE_PORTAL         (cockpit_portal_get_type ())
#define COCKPIT_PORTAL(o)           (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_PORTAL, CockpitPortal))
#define COCKPIT_IS_PORTAL(o)        (G_TYPE_CHECK_INSTANCE_TYPE ((o), COCKPIT_TYPE_PORTAL))
#define COCKPIT_PORTAL_GET_CLASS(o) (G_TYPE_INSTANCE_GET_CLASS ((o), COCKPIT_TYPE_PORTAL, CockpitPortal))
#define COCKPIT_IS_PORTAL_CLASS(k)  (G_TYPE_CHECK_CLASS_TYPE ((k), COCKPIT_TYPE_PORTAL))

typedef struct _CockpitPortal        CockpitPortal;
typedef struct _CockpitPortalClass   CockpitPortalClass;

typedef gboolean     (* CockpitPortalFilter)             (CockpitPortal *portal,
                                                          const gchar *command,
                                                          const gchar *channel,
                                                          JsonObject *options);

GType                   cockpit_portal_get_type           (void) G_GNUC_CONST;

CockpitPortal *         cockpit_portal_new_superuser      (CockpitTransport *transport);

void                    cockpit_portal_add_channel        (CockpitPortal *self,
                                                           const gchar *channel,
                                                           CockpitPortalFlags flags);

G_END_DECLS

#endif /* __COCKPIT_PORTAL_H__ */
