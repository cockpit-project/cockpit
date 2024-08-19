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

#ifndef __COCKPIT_FRAME_H__
#define __COCKPIT_FRAME_H__

#include <sys/types.h>

ssize_t            cockpit_frame_parse       (unsigned char *input,
                                              size_t length,
                                              size_t *consumed);

ssize_t            cockpit_frame_read        (int fd,
                                              unsigned char **output);

ssize_t            cockpit_frame_write       (int fd,
                                              unsigned char *input,
                                              size_t length);

ssize_t            cockpit_fd_write_all      (int fd,
                                              unsigned char *input,
                                              size_t length);

#endif /* __COCKPIT_FRAME_H__ */
