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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

#pragma once

#include <stdio.h>

/* define to 1 to enable debug messages; very verbose! */
#define DEBUG 0

/* messages can be disabled per-domain */
#define DEBUG_CONNECTION 1
#define DEBUG_SERVER 1

/* socket-activation-helper.c */
#define DEBUG_HELPER 1

/* testcases */
#define DEBUG_TESTS 1

#if DEBUG
#define debug(domain, fmt, ...) do if (DEBUG_##domain) fprintf (stderr, __FILE__ ": " fmt "\n", ##__VA_ARGS__); while (0)
#else
#define debug(...)
#endif

#define gnutls_check(expr) { \
  int r = expr; \
  if (r < 0) {  \
    fprintf (stderr, "cockpit-tls: %s failed: %s\n", #expr, gnutls_strerror (r)); \
    abort ();   \
  }             \
}

#define N_ELEMENTS(arr) (sizeof (arr) / sizeof ((arr)[0]))

#define SD_LISTEN_FDS_START 3   /* sd_listen_fds(3) */
