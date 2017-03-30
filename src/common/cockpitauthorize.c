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

#include "config.h"

#include "cockpitauthorize.h"
#include "cockpitmemory.h"

#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif

#include <assert.h>
#include <ctype.h>
#include <crypt.h>
#include <errno.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

/* ----------------------------------------------------------------------------
 * Tools
 */

#ifndef debug
#define debug(format, ...) \
  do { if (logger_verbose) \
      message ("debug: " format, ##__VA_ARGS__); \
  } while (0)
#endif

static int logger_verbose = 0;
static void (* logger) (const char *data);

#ifndef message
#if __GNUC__ > 2
static void
message (const char *format, ...)
__attribute__((__format__(__printf__, 1, 2)));
#endif

static void
message (const char *format, ...)
{
  va_list va;
  char *data;
  int res;

  if (!logger)
    return;

  /* Fast path for simple messages */
  if (!strchr (format, '%'))
    {
      logger (format);
      return;
    }

  va_start (va, format);
  res = vasprintf (&data, format, va);
  va_end (va);

  if (res < 0)
    {
      logger ("out of memory printing message");
      return;
    }

  logger (data);
  free (data);
}
#endif

void
cockpit_authorize_logger (void (* func) (const char *data),
                          int verbose)
{
  logger_verbose = verbose;
  logger = func;
}

const char *
cockpit_authorize_type (const char *challenge,
                        char **type)
{
  size_t i, len = 0;

  /*
   * Either a space or a colon is the delimiter
   * that splits the type from the remainder
   * of the content.
   */
  if (challenge)
    len = strcspn (challenge, ": ");
  if (len == 0 || challenge[len] == '\0')
    {
      message ("invalid \"authorize\" message");
      errno = EINVAL;
      return NULL;
    }

  if (type)
    {
      *type = strndup (challenge, len);
      if (*type == NULL)
        {
          message ("couldn't allocate memory for \"authorize\" challenge");
          errno = ENOMEM;
          return NULL;
        }
      for (i = 0; i < len; i++)
        (*type)[i] = tolower ((*type)[i]);
    }

  if (challenge[len])
    len++;
  while (challenge[len] == ' ')
    len++;
  return challenge + len;
}

const char *
cockpit_authorize_subject (const char *challenge,
                           char **subject)
{
  size_t len;

  challenge = cockpit_authorize_type (challenge, NULL);
  if (!challenge)
    return NULL;

  len = strcspn (challenge, ": ");
  if (len == 0 || challenge[len] == '\0')
    {
      message ("invalid \"authorize\" message \"challenge\": no subject");
      errno = EINVAL;
      return NULL;
    }

  if (subject)
    {
      *subject = strndup (challenge, len);
      if (!*subject)
        {
          message ("couldn't allocate memory for \"authorize\" message \"challenge\"");
          errno = ENOMEM;
          return NULL;
        }
    }

  if (challenge[len])
    len++;
  while (challenge[len] == ' ')
    len++;
  return challenge + len;
}
