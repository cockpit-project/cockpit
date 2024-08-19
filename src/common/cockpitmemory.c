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

#include "config.h"

#include "cockpitmemory.h"

#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>

/**
 * cockpit_memory_clear:
 *
 * The cockpit_memory_clear function overwrites LEN bytes of memory
 * pointed to by DATA with non-sensitive values.  When LEN is -1, DATA
 * must be zero-terminated and all bytes until the zero are
 * overwritten.
 *
 * This is very similar to memset but we take extra measures to
 * prevent the compiler from optimizing it away.
 */

void
cockpit_memory_clear (void * data,
                      ssize_t len)
{
  if (len < 0)
    len = strlen (data);

  explicit_bzero (data, len);
}

static void
abort_errno (const char *msg)
{
  perror (msg);
  abort ();
}

void *
mallocx (size_t size)
{
  void *r = malloc (size);
  if (r == NULL)
    abort_errno ("failed to allocate memory");
  return r;
}

void *
callocx (size_t nmemb, size_t size)
{
  void *r = calloc (nmemb, size);
  if (r == NULL)
    abort_errno ("failed to allocate memory");
  return r;
}

char *
strdupx (const char *s)
{
  char *r = strdup (s);
  if (r == NULL)
    abort_errno ("failed to allocate memory for strdup");
  return r;
}

char *
strndupx (const char *s,
         size_t n)
{
  char *r = strndup (s, n);
  if (r == NULL)
    abort_errno ("failed to allocate memory for strndup");
  return r;
}

int
asprintfx (char **strp,
           const char *fmt, ...)
{
  va_list args;
  int r;

  va_start (args, fmt);
  r = vasprintf (strp, fmt, args);
  va_end (args);
  if (r < 0)
    {
      fprintf (stderr, "Cannot allocate memory for asprintf\n");
      abort ();
    }
  return r;
}

void *
reallocx (void *ptr,
          size_t size)
{
  void *r = realloc (ptr, size);
  if (r == NULL)
    abort_errno ("failed to allocate memory");
  return r;
}

/* this is like reallocarray(3), but this does not yet exist everywhere; plus
 * abort() on ENOMEM */
void *
reallocarrayx (void *ptr,
               size_t nmemb,
               size_t size)
{
  void *r;

  if (nmemb >= SIZE_MAX / size)
    {
      fprintf (stderr, "reallocarr: overflow (nmemb %zu)\n", nmemb);
      abort ();
    }
  r = realloc (ptr, nmemb * size);
  if (r == NULL)
    abort_errno ("failed to allocate memory for realloc");
  return r;
}
