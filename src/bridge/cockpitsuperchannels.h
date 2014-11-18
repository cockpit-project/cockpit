/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2014 Red Hat, Inc.
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

#ifndef __COCKPIT_SUPER_CHANNELS_H__
#define __COCKPIT_SUPER_CHANNELS_H__

#include <gio/gio.h>

#include "common/cockpittransport.h"

G_BEGIN_DECLS

#define COCKPIT_TYPE_SUPER_CHANNELS         (cockpit_super_channels_get_type ())
#define COCKPIT_SUPER_CHANNELS(o)           (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_SUPER_CHANNELS, CockpitSuperChannels))
#define COCKPIT_SUPER_CHANNELS_GET_CLASS(o) (G_TYPE_INSTANCE_GET_CLASS ((o), COCKPIT_TYPE_SUPER_CHANNELS, CockpitSuperChannels))
#define COCKPIT_IS_SUPER_CHANNELS_CLASS(k)  (G_TYPE_CHECK_CLASS_TYPE ((k), COCKPIT_TYPE_SUPER_CHANNELS))

typedef struct _CockpitSuperChannels        CockpitSuperChannels;
typedef struct _CockpitSuperChannelsClass   CockpitSuperChannelsClass;

GType                   cockpit_super_channels_get_type   (void) G_GNUC_CONST;

CockpitSuperChannels *  cockpit_super_channels_new        (CockpitTransport *peer);

G_END_DECLS

#endif /* __COCKPIT_SUPER_CHANNELS_H__ */
