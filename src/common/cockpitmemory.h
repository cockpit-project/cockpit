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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

#ifndef __COCKPIT_MEMORY_H__
#define __COCKPIT_MEMORY_H__

#include <sys/types.h>

void     cockpit_memory_clear            (void *data,
                                          ssize_t length);

/* variants of glibc functions that abort() on ENOMEM */
void *   mallocx                         (size_t size);
void *   callocx                         (size_t nmemb, size_t size);
char *   strdupx                         (const char *s);

char *   strndupx                        (const char *s,
                                          size_t n);

__attribute__((__format__ (__printf__, 2, 3)))
int      asprintfx                       (char **strp,
                                          const char *fmt, ...);

void *   reallocx                        (void *ptr,
                                          size_t size);

void *   reallocarrayx                   (void *ptr,
                                          size_t nmemb,
                                          size_t size);

#endif /* __COCKPIT_MEMORY_H__ */
