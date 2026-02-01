/*
 * Copyright (C) 2017 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#ifndef MOCK_CHANNEL_H
#define MOCK_CHANNEL_H

#include "ws/cockpitchannel.h"

#define MOCK_TYPE_ECHO_CHANNEL         (mock_echo_channel_get_type ())
#define MOCK_ECHO_CHANNEL(o)           (G_TYPE_CHECK_INSTANCE_CAST ((o), MOCK_TYPE_ECHO_CHANNEL, MockEchoChannel))
#define MOCK_IS_ECHO_CHANNEL(o)        (G_TYPE_CHECK_INSTANCE_TYPE ((o), MOCK_TYPE_ECHO_CHANNEL))

typedef struct {
  CockpitChannel parent;
  gboolean close_called;
} MockEchoChannel;

GType                mock_echo_channel_get_type      (void);

#endif /* MOCK_CHANNEL_H */
