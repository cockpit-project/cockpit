/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2014 Red Hat, Inc.
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

#ifndef REAUTHUTIL_H__
#define REAUTHUTIL_H__

#include <sys/types.h>

void *   _reauthorize_xrealloc     (void *mem,
                                    size_t len);

int      _reauthorize_hex          (const void *data,
                                    ssize_t len,
                                    char **hex);

int      _reauthorize_unhex        (const char *hex,
                                    ssize_t len,
                                    void **data,
                                    size_t *data_len);

ssize_t  _reauthorize_parse_salt   (const char *input);

void     _reauthorize_secfree      (void *data,
                                    ssize_t len);

#endif /* REAUTHUTIL_H__ */
