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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

#ifndef __COCKPIT_PIPE_TRANSPORT_H__
#define __COCKPIT_PIPE_TRANSPORT_H__

#include <gio/gio.h>

#include "cockpitpipe.h"
#include "cockpittransport.h"

G_BEGIN_DECLS

#define COCKPIT_TYPE_PIPE_TRANSPORT         (cockpit_pipe_transport_get_type ())
G_DECLARE_FINAL_TYPE(CockpitPipeTransport, cockpit_pipe_transport, COCKPIT, PIPE_TRANSPORT, CockpitTransport)

CockpitTransport * cockpit_pipe_transport_new        (CockpitPipe *pipe);

CockpitTransport * cockpit_pipe_transport_new_fds    (const gchar *name,
                                                      gint in_fd,
                                                      gint out_fd);

CockpitPipe *      cockpit_pipe_transport_get_pipe   (CockpitPipeTransport *self);

G_END_DECLS

#endif /* __COCKPIT_PIPE_TRANSPORT_H__ */
