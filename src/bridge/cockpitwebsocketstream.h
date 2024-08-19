/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
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

#include "common/cockpitchannel.h"

#define COCKPIT_TYPE_WEB_SOCKET_STREAM (cockpit_web_socket_stream_get_type ())
G_DECLARE_FINAL_TYPE (CockpitWebSocketStream, cockpit_web_socket_stream,
                      COCKPIT, WEB_SOCKET_STREAM, CockpitChannel)
