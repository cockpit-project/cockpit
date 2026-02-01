/*
 * Copyright (C) 2021 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#pragma once

#include <gio/gio.h>

void
cockpit_socket_socketpair (GSocket **one,
                           GSocket **two);

void
cockpit_socket_streampair (GIOStream **one,
                           GIOStream **two);
