/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2021 Red Hat, Inc.
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

#include <stdbool.h>
#include <sys/socket.h>

void
cockpit_socket_msghdr_add_fd (struct msghdr  *msg,
                              struct cmsghdr *cmsg,
                              size_t          cmsgsize,
                              int             fd);

bool
cockpit_socket_send_fd (int socket_fd,
                        int fd);

int
cockpit_socket_receive_fd (int  socket_fd,
                           int *out_fd);
