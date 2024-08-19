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

#ifndef MOCK_CHANNEL_H
#define MOCK_CHANNEL_H

#include "common/cockpitchannel.h"

#define MOCK_TYPE_ECHO_CHANNEL         (mock_echo_channel_get_type ())
#define MOCK_ECHO_CHANNEL(o)           (G_TYPE_CHECK_INSTANCE_CAST ((o), MOCK_TYPE_ECHO_CHANNEL, MockEchoChannel))
#define MOCK_IS_ECHO_CHANNEL(o)        (G_TYPE_CHECK_INSTANCE_TYPE ((o), MOCK_TYPE_ECHO_CHANNEL))

typedef struct {
  CockpitChannel parent;
  gboolean close_called;
} MockEchoChannel;

GType                mock_echo_channel_get_type      (void);

#endif /* MOCK_CHANNEL_H */
