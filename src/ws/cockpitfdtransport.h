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

#ifndef __COCKPIT_FD_TRANSPORT_H__
#define __COCKPIT_FD_TRANSPORT_H__

#include <gio/gio.h>

#include "cockpittransport.h"

G_BEGIN_DECLS

#define COCKPIT_TYPE_FD_TRANSPORT         (cockpit_fd_transport_get_type ())
#define COCKPIT_FD_TRANSPORT(o)           (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_FD_TRANSPORT, CockpitFdTransport))
#define COCKPIT_FD_TRANSPORT_GET_CLASS(o) (G_TYPE_INSTANCE_GET_CLASS ((o), COCKPIT_TYPE_FD_TRANSPORT, CockpitFdTransportClass))
#define COCKPIT_IS_FD_TRANSPORT_CLASS(k)  (G_TYPE_CHECK_CLASS_TYPE ((k), COCKPIT_TYPE_FD_TRANSPORT))

typedef struct _CockpitFdTransport        CockpitFdTransport;
typedef struct _CockpitFdTransportClass   CockpitFdTransportClass;

GType              cockpit_fd_transport_get_type     (void) G_GNUC_CONST;

CockpitTransport * cockpit_fd_transport_new          (const gchar *name,
                                                      int in_fd,
                                                      int out_fd);

CockpitTransport * cockpit_fd_transport_spawn        (const gchar *host,
                                                      gint port,
                                                      const gchar *agent,
                                                      const gchar *user,
                                                      const gchar *password,
                                                      const gchar *client,
                                                      gboolean force_remote,
                                                      GError **error);

G_END_DECLS

#endif /* __COCKPIT_FD_TRANSPORT_H__ */
