/*
 * Copyright (C) 2020 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#pragma once

#include <gio/gio.h>

typedef struct
{
  GSocketControlMessage **messages;
  int                     n_messages;
} CockpitControlMessages;

#define COCKPIT_CONTROL_MESSAGES_INIT {}

void
cockpit_control_messages_clear (CockpitControlMessages *ccm);

gboolean
cockpit_control_messages_empty (CockpitControlMessages *ccm);

gpointer
cockpit_control_messages_get_single_message (CockpitControlMessages *ccm,
                                             GType message_type,
                                             GError **error);

const gint *
cockpit_control_messages_peek_fd_list (CockpitControlMessages *ccm,
                                       gint *n_fds,
                                       GError **error);

gint
cockpit_control_messages_peek_single_fd (CockpitControlMessages *ccm,
                                         GError **error);

G_DEFINE_AUTO_CLEANUP_CLEAR_FUNC(CockpitControlMessages, cockpit_control_messages_clear)
