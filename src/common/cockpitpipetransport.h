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

#ifndef __COCKPIT_PIPE_TRANSPORT_H__
#define __COCKPIT_PIPE_TRANSPORT_H__

#include <gio/gio.h>

#include "cockpitpipe.h"
#include "cockpittransport.h"

G_BEGIN_DECLS

#define COCKPIT_TYPE_PIPE_TRANSPORT         (cockpit_pipe_transport_get_type ())
#define COCKPIT_PIPE_TRANSPORT(o)           (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_PIPE_TRANSPORT, CockpitPipeTransport))
#define COCKPIT_IS_PIPE_TRANSPORT(o)        (G_TYPE_CHECK_INSTANCE_TYPE ((o), COCKPIT_TYPE_PIPE_TRANSPORT))
#define COCKPIT_PIPE_TRANSPORT_GET_CLASS(o) (G_TYPE_INSTANCE_GET_CLASS ((o), COCKPIT_TYPE_PIPE_TRANSPORT, CockpitPipeTransportClass))
#define COCKPIT_IS_PIPE_TRANSPORT_CLASS(k)  (G_TYPE_CHECK_CLASS_TYPE ((k), COCKPIT_TYPE_PIPE_TRANSPORT))

typedef struct _CockpitPipeTransport        CockpitPipeTransport;
typedef struct _CockpitPipeTransportClass   CockpitPipeTransportClass;

GType              cockpit_pipe_transport_get_type   (void) G_GNUC_CONST;

CockpitTransport * cockpit_pipe_transport_new        (CockpitPipe *pipe);

CockpitTransport * cockpit_pipe_transport_new_fds    (const gchar *name,
                                                      gint in_fd,
                                                      gint out_fd);

CockpitPipe *      cockpit_pipe_transport_get_pipe   (CockpitPipeTransport *self);

void               cockpit_transport_read_from_pipe  (CockpitTransport *self,
                                                      const gchar *logname,
                                                      CockpitPipe *pipe,
                                                      gboolean *closed,
                                                      GByteArray *input,
                                                      gboolean end_of_data);
G_END_DECLS

#endif /* __COCKPIT_PIPE_TRANSPORT_H__ */
