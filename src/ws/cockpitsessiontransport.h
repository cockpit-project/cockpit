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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

#ifndef __COCKPIT_SESSION_TRANSPORT_H__
#define __COCKPIT_SESSION_TRANSPORT_H__

#include "common/cockpitpipetransport.h"

#include "cockpitcreds.h"

G_BEGIN_DECLS

#define COCKPIT_TYPE_SESSION_TRANSPORT         (cockpit_session_transport_get_type ())
#define COCKPIT_SESSION_TRANSPORT(o)           (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_SESSION_TRANSPORT, CockpitSessionTransport))
#define COCKPIT_IS_SESSION_TRANSPORT(k)        (G_TYPE_CHECK_INSTANCE_TYPE ((k), COCKPIT_TYPE_SESSION_TRANSPORT))

typedef struct _CockpitSessionTransport        CockpitSessionTransport;
typedef struct _CockpitSessionTransportClass   CockpitSessionTransportClass;

GType               cockpit_session_transport_get_type          (void) G_GNUC_CONST;

CockpitTransport *  cockpit_session_transport_new               (CockpitCreds *creds);

G_END_DECLS

#endif /* __COCKPIT_SESSION_TRANSPORT_H__ */
