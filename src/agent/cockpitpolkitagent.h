/*
 * Copyright (C) 2008 Red Hat, Inc.
 * Copyright (C) 2014 Red Hat, Inc.
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 2 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General
 * Public License along with this library; if not, write to the
 * Free Software Foundation, Inc., 59 Temple Place, Suite 330,
 * Boston, MA 02111-1307, USA.
 *
 * Author: David Zeuthen <davidz@redhat.com>
 *         Cockpit Authors
 */

#ifndef __COCKPIT_POLKIT_AGENT_H
#define __COCKPIT_POLKIT_AGENT_H

#include <glib-object.h>
#include <gio/gio.h>

#include "common/cockpittransport.h"

G_BEGIN_DECLS

#define COCKPIT_TYPE_POLKIT_AGENT          (cockpit_polkit_agent_get_type())
#define COCKPIT_POLKIT_AGENT(o)            (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_POLKIT_AGENT, CockpitPolkitAgent))
#define COCKPIT_IS_POLKIT_AGENT(o)         (G_TYPE_CHECK_INSTANCE_TYPE ((o), COCKPIT_TYPE_POLKIT_AGENT))

typedef struct _CockpitPolkitAgent CockpitPolkitAgent;

GType                 cockpit_polkit_agent_get_type     (void) G_GNUC_CONST;

gpointer              cockpit_polkit_agent_register     (CockpitTransport *transport,
                                                         GCancellable *cancellable);

void                  cockpit_polkit_agent_unregister   (gpointer handle);


G_END_DECLS

#endif /* __COCKPIT_POLKIT_AGENT_H */
