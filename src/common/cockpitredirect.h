/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2020 Red Hat, Inc.
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

#ifndef __COCKPITREDIRECT_H__
#define __COCKPITREDIRECT_H__

#include <glib-object.h>

G_BEGIN_DECLS

/* CockpitRedirect interface */

#define COCKPIT_TYPE_REDIRECT cockpit_redirect_get_type ()
G_DECLARE_INTERFACE (CockpitRedirect, cockpit_redirect, COCKPIT, REDIRECT, GObject)

struct _CockpitRedirectInterface
{
  GTypeInterface parent_iface;

  gboolean (*send) (CockpitRedirect *self,
                    GBytes *payload);
};

gboolean cockpit_redirect_send (CockpitRedirect *self,
                                GBytes *payload);

/* CockpitChannelRedirect class */

#define COCKPIT_TYPE_CHANNEL_REDIRECT cockpit_channel_redirect_get_type ()
G_DECLARE_FINAL_TYPE (CockpitChannelRedirect, cockpit_channel_redirect, COCKPIT, CHANNEL_REDIRECT,
                      GObject)

gboolean
cockpit_channel_redirect_send (CockpitChannelRedirect *self, GBytes *payload);

/* CockpitPeerRedirect class */

#define COCKPIT_TYPE_PEER_REDIRECT cockpit_peer_redirect_get_type ()
G_DECLARE_FINAL_TYPE (CockpitPeerRedirect, cockpit_peer_redirect, COCKPIT, PEER_REDIRECT,
                      GObject)

gboolean
cockpit_peer_redirect_send (CockpitPeerRedirect *self, GBytes *payload);

G_END_DECLS

#endif
