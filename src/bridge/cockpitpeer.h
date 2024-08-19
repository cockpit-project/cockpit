/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
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

#ifndef __COCKPIT_PEER_H__
#define __COCKPIT_PEER_H__

#include "common/cockpittransport.h"

G_BEGIN_DECLS

#define         COCKPIT_TYPE_PEER           (cockpit_peer_get_type ())
#define         COCKPIT_PEER(o)             (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_PEER, CockpitPeer))
#define         COCKPIT_IS_PEER(o)          (G_TYPE_CHECK_INSTANCE_TYPE ((o), COCKPIT_TYPE_PEER))

typedef struct _CockpitPeer        CockpitPeer;

typedef void CockpitPeerDoneFunction (const gchar *error, const gchar *stderr, gpointer data);

typedef struct _CockpitPeerClass {
  GObjectClass parent_class;

  /* signal */

  void        (* closed)      (CockpitPeer *peer,
                               const gchar *problem);

} CockpitPeerClass;

GType               cockpit_peer_get_type                        (void) G_GNUC_CONST;

CockpitPeer *       cockpit_peer_new                             (CockpitTransport *transport,
                                                                  JsonObject *config);

CockpitTransport *  cockpit_peer_ensure                          (CockpitPeer *peer);

CockpitTransport *  cockpit_peer_ensure_with_done                (CockpitPeer *peer,
                                                                  CockpitPeerDoneFunction *done_function,
                                                                  gpointer done_data);

gboolean            cockpit_peer_handle                          (CockpitPeer *peer,
                                                                  const gchar *channel,
                                                                  JsonObject *options,
                                                                  GBytes *data);

void                cockpit_peer_reset                           (CockpitPeer *peer);

G_END_DECLS

#endif /* __COCKPIT_PEER_H__ */
