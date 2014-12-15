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

#include "cockpitechochannel.h"

/**
 * CockpitEchoChannel:
 *
 * A #CockpitChannel that never sends messages and ignores
 * all messages it receives.
 *
 * The payload type for this channel is 'echo'.
 */

#define COCKPIT_ECHO_CHANNEL(o)    (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_ECHO_CHANNEL, CockpitEchoChannel))

typedef struct {
  CockpitChannel parent;
} CockpitEchoChannel;

typedef struct {
  CockpitChannelClass parent_class;
} CockpitEchoChannelClass;

G_DEFINE_TYPE (CockpitEchoChannel, cockpit_echo_channel, COCKPIT_TYPE_CHANNEL);

static void
cockpit_echo_channel_recv (CockpitChannel *channel,
                           GBytes *message)
{
  g_debug ("received echo channel payload");
  cockpit_channel_send (channel, message, FALSE);
}

static void
cockpit_echo_channel_done (CockpitChannel *channel)
{
  g_debug ("received echo channel done");
  cockpit_channel_done (channel);
}

static void
cockpit_echo_channel_init (CockpitEchoChannel *self)
{

}

static void
cockpit_echo_channel_prepare (CockpitChannel *channel)
{
  COCKPIT_CHANNEL_CLASS (cockpit_echo_channel_parent_class)->prepare (channel);
  cockpit_channel_ready (channel);
}

static void
cockpit_echo_channel_class_init (CockpitEchoChannelClass *klass)
{
  CockpitChannelClass *channel_class = COCKPIT_CHANNEL_CLASS (klass);

  channel_class->prepare = cockpit_echo_channel_prepare;
  channel_class->recv = cockpit_echo_channel_recv;
  channel_class->done = cockpit_echo_channel_done;
}
