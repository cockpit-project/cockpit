/*
 * Copyright (C) 2014 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
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
