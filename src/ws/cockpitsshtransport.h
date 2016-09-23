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

#ifndef __COCKPIT_SSH_TRANSPORT_H__
#define __COCKPIT_SSH_TRANSPORT_H__

#include "common/cockpittransport.h"
#include "common/cockpitjson.h"

#include "cockpitcreds.h"
#include "cockpitauthprocess.h"

G_BEGIN_DECLS

#define COCKPIT_TYPE_SSH_TRANSPORT         (cockpit_ssh_transport_get_type ())
#define COCKPIT_SSH_TRANSPORT(o)           (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_SSH_TRANSPORT, CockpitSshTransport))
#define COCKPIT_IS_SSH_TRANSPORT(k)        (G_TYPE_CHECK_INSTANCE_TYPE ((k), COCKPIT_TYPE_SSH_TRANSPORT))

typedef struct _CockpitSshTransport        CockpitSshTransport;
typedef struct _CockpitSshTransportClass   CockpitSshTransportClass;

GType               cockpit_ssh_transport_get_type              (void) G_GNUC_CONST;

CockpitTransport *  cockpit_ssh_transport_new                   (const gchar *host,
                                                                 guint port,
                                                                 CockpitCreds *creds);

const gchar *       cockpit_ssh_transport_get_host_key          (CockpitSshTransport *self);

const gchar *       cockpit_ssh_transport_get_host_fingerprint  (CockpitSshTransport *self);

JsonObject *        cockpit_ssh_transport_get_auth_method_results (CockpitSshTransport *self);

CockpitAuthProcess *   cockpit_ssh_transport_get_auth_process     (CockpitSshTransport *self);
G_END_DECLS

#endif /* __COCKPIT_SSH_TRANSPORT_H__ */
