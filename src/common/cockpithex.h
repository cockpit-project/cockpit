/*
 * Copyright (C) 2014 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#ifndef __COCKPIT_HEX_H__
#define __COCKPIT_HEX_H__

#include <sys/types.h>

char *          cockpit_hex_encode            (const void *data,
                                               ssize_t length);

#endif
