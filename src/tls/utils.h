/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2019 Red Hat, Inc.
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

#include <stdio.h>

/* define to 1 to enable debug messages; very verbose! */
#define DEBUG 0

/* messages can be disabled per-domain */
#define DEBUG_POLL 0
#define DEBUG_BUFFER 0
#define DEBUG_IOVEC 0
#define DEBUG_CONNECTION 1
#define DEBUG_SERVER 1
#define DEBUG_FACTORY 1
#define DEBUG_SOCKET_IO 1

/* socket-activation-helper.c */
#define DEBUG_HELPER 1

/* cockpit-certificate-ensure.c */
#define DEBUG_ENSURE 1

/* testcases */
#define DEBUG_TESTS 1

#if DEBUG
#define debug(domain, fmt, ...) do if (DEBUG_##domain) fprintf (stderr, __FILE__ ": " fmt "\n", ##__VA_ARGS__); while (0)
#else
#define debug(...)
#endif

#define N_ELEMENTS(arr) (sizeof (arr) / sizeof ((arr)[0]))

#define SD_LISTEN_FDS_START 3   /* sd_listen_fds(3) */

#define SHA256_NIL "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
#define WSINSTANCE_MAX (64 + 1)

