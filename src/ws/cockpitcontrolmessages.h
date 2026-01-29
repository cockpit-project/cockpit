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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
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
