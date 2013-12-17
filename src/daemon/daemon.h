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

#ifndef __DAEMON_H__
#define __DAEMON_H__

#include "types.h"

G_BEGIN_DECLS

#define TYPE_DAEMON   (daemon_get_type ())
#define DAEMON(o)     (G_TYPE_CHECK_INSTANCE_CAST ((o), TYPE_DAEMON, Daemon))
#define IS_DAEMON(o)  (G_TYPE_CHECK_INSTANCE_TYPE ((o), TYPE_DAEMON))

GType                      daemon_get_type             (void) G_GNUC_CONST;

Daemon *                   daemon_new                  (GDBusConnection *connection);

Daemon *                   daemon_get                  (void);

GDBusConnection *          daemon_get_connection       (Daemon *daemon);

GDBusObjectManagerServer * daemon_get_object_manager   (Daemon *daemon);

gboolean                   daemon_authorize_method     (Daemon *daemon,
                                                        GDBusMethodInvocation *invocation);

gboolean                   daemon_get_sender_uid       (Daemon *daemon,
                                                        GDBusMethodInvocation *invocation,
                                                        uid_t *uid);

Machines                  *daemon_get_machines         (Daemon *daemon);

G_END_DECLS

#endif /* __DAEMON_H__ */
