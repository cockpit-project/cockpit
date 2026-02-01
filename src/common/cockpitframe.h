/*
 * Copyright (C) 2017 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
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
