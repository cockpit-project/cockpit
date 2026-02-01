/*
 * Copyright (C) 2021 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
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
