/*
 * Copyright (C) 2019 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <sys/types.h>
#include <time.h>

bool
get_remaining_timeout (struct timespec *start,
                       uint64_t *timeout_remaining,
                       uint64_t timeout_us);

bool
recv_alnum (int fd,
            char *buffer,
            size_t size,
            int timeout);

bool
send_all (int fd,
          const char *buffer,
          size_t size,
          int timeout);

int
af_unix_connectat (int sockfd,
                   int dirfd,
                   const char *pathname);

int
af_unix_bindat (int sockfd,
                int dirfd,
                const char *pathname);
