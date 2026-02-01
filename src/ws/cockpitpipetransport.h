/*
 * Copyright (C) 2013 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
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
