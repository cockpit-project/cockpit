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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

#include "config.h"

#include "mock-channel.h"

typedef CockpitChannelClass MockEchoChannelClass;

G_DEFINE_TYPE (MockEchoChannel, mock_echo_channel, COCKPIT_TYPE_CHANNEL);

static void
mock_echo_channel_recv (CockpitChannel *channel,
                        GBytes *message)
{
  cockpit_channel_send (channel, message, FALSE);
}

static gboolean
mock_echo_channel_control (CockpitChannel *channel,
                           const gchar *command,
                           JsonObject *options)
{
  cockpit_channel_control (channel, command, options);
  return TRUE;
}

static void
mock_echo_channel_close (CockpitChannel *channel,
                         const gchar *problem)
{
  MockEchoChannel *self = (MockEchoChannel *)channel;
  self->close_called = TRUE;
  COCKPIT_CHANNEL_CLASS (mock_echo_channel_parent_class)->close (channel, problem);
}

static void
mock_echo_channel_init (MockEchoChannel *self)
{

}

static void
mock_echo_channel_constructed (GObject *obj)
{
  G_OBJECT_CLASS (mock_echo_channel_parent_class)->constructed (obj);
  cockpit_channel_ready (COCKPIT_CHANNEL (obj), NULL);
}

static void
mock_echo_channel_class_init (MockEchoChannelClass *klass)
{
  CockpitChannelClass *channel_class = COCKPIT_CHANNEL_CLASS (klass);
  GObjectClass *object_class = G_OBJECT_CLASS (klass);
  object_class->constructed = mock_echo_channel_constructed;
  channel_class->recv = mock_echo_channel_recv;
  channel_class->control = mock_echo_channel_control;
  channel_class->close = mock_echo_channel_close;
}
