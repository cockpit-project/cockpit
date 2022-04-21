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

#include "config.h"

#include "cockpitnullchannel.h"

/**
 * CockpitNullChannel:
 *
 * A #CockpitChannel that never sends messages and ignores
 * all messages it receives.
 *
 * The payload type for this channel is 'null'.
 */

#define COCKPIT_NULL_CHANNEL(o)    (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_NULL_CHANNEL, CockpitNullChannel))

typedef struct {
  CockpitChannel parent;
} CockpitNullChannel;

typedef struct {
  CockpitChannelClass parent_class;
} CockpitNullChannelClass;

G_DEFINE_TYPE (CockpitNullChannel, cockpit_null_channel, COCKPIT_TYPE_CHANNEL);

static void
cockpit_null_channel_recv (CockpitChannel *channel,
                           GBytes *message)
{
  g_debug ("received null channel payload");
}

static void
cockpit_null_channel_init (CockpitNullChannel *self)
{

}

static void
cockpit_null_channel_prepare (CockpitChannel *channel)
{
  COCKPIT_CHANNEL_CLASS (cockpit_null_channel_parent_class)->prepare (channel);
  cockpit_channel_ready (channel, NULL);
}

static void
cockpit_null_channel_class_init (CockpitNullChannelClass *klass)
{
  CockpitChannelClass *channel_class = COCKPIT_CHANNEL_CLASS (klass);

  channel_class->prepare = cockpit_null_channel_prepare;
  channel_class->recv = cockpit_null_channel_recv;
}
