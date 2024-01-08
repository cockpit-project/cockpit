/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2020 Red Hat, Inc.
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

#include "cockpitjsonprint.h"

#include <assert.h>
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <string.h>
#include <sys/mman.h>

static bool
char_needs_json_escape (unsigned char c)
{
  /* we escape:
   *   - ascii controls
   *   - backslash
   *   - double quote
   *   - ascii del
   *   - all non-ascii
   */
  return c < ' ' || c == '\\' || c == '"' || c >= 0x7f;
}

static bool
json_escape_char (FILE *stream,
                  unsigned char c)
{
  if (c == '\\')
    return fputs ("\\\\", stream) >= 0;
  else if (c == '"')
    return fputs ("\\\"", stream) >= 0;
  else if (c >= 0x80) /* non-ascii */
    return fputc ('?', stream) >= 0;
  else
    return fprintf (stream, "\\u%04x", c) == 6;
}

static bool
json_escape_string (FILE       *stream,
                    const char *str,
                    size_t      maxlen)
{
  size_t offset = 0;

  while (offset < maxlen && str[offset])
    {
      size_t start = offset;

      while (offset < maxlen && str[offset] && !char_needs_json_escape (str[offset]))
        offset++;

      /* print the non-escaped prefix, if there is one */
      if (offset != start)
        {
          size_t length = offset - start;
          if (fwrite (str + start, 1, length, stream) != length)
            return false;
        }

      /* print the escaped character, if there is one */
      if (offset < maxlen && str[offset])
        {
          if (!json_escape_char (stream, str[offset]))
            return false;

          offset++;
        }
    }

  return true;
}

/**
 * cockpit_json_print_string_property:
 * @stream: a stdio stream open for writing
 * @key: the JSON key name
 * @value: the string value to write
 * @maxlen: the maximum length of @value
 *
 * Adds a string key/value pair to a JSON object.
 *
 * @key and @value should both be plain ASCII.  @key is copied directly
 * to the stream and must not contain any characters that would require
 * escapes.  @value is escaped, if necessary (including replacing
 * non-ASCII characters with '?').
 *
 * @maxlen can be -1 if @value is nul-terminated.  Otherwise, @maxlen is
 * a maximum: the actual number of characters escaped and written is the
 * lesser of the length of the string or @maxlen.
 *
 * Returns true if the value was correctly written.
 */
bool
cockpit_json_print_string_property (FILE       *stream,
                                    const char *key,
                                    const char *value,
                                    ssize_t     maxlen)
{
  size_t expected = strlen (key) + 7;

  return fprintf (stream, ", \"%s\": \"", key) == expected &&
         json_escape_string (stream, value, maxlen) &&
         fputc ('"', stream) >= 0;
}

/**
 * cockpit_json_print_bool_property:
 * @stream: a stdio stream open for writing
 * @key: the JSON key name
 * @value: the boolean value to write
 *
 * Adds a boolean key/value pair to a JSON object.  The boolean value is
 * formatted as either the string "true" or "false".
 *
 * Returns true if the value was correctly written.
 */
bool
cockpit_json_print_bool_property (FILE       *stream,
                                  const char *key,
                                  bool        value)
{
  size_t expected = 6 + strlen (key) + (value ? 4 : 5); /* "true" or "false" */

  return fprintf (stream, ", \"%s\": %s", key, value ? "true" : "false") == expected;
}

/**
 * cockpit_json_print_integer_property:
 * @stream: a stdio stream open for writing
 * @key: the JSON key name
 * @value: the unsigned integer value to write
 *
 * Adds an integer key/value pair to a JSON object.
 *
 * Returns true if the value was correctly written.
 */
bool
cockpit_json_print_integer_property (FILE       *stream,
                                     const char *key,
                                     uint64_t    value)
{
  /* too much effort to figure out the expected length exactly */
  return fprintf (stream, ", \"%s\": %"PRIu64, key, value) > 6;
}

/**
 * cockpit_json_print_open_memfd:
 * @name: passed to memfd_create, gets displayed in /proc/.../fd
 * @version: if not negative then a "version" field will be added
 *
 * Creates a memfd, wraps it in a stdio stream, and starts the printing
 * of a JSON object into it by writing a '{' character and an optional
 * version field.
 *
 * If you don't write the version field, you need to take care to write
 * something else before first using the other cockpit_json_print_*
 * functions, because they all prepend commas.
 *
 * This function always returns a valid stream.  In case of any errors,
 * the program is aborted.
 */
FILE *
cockpit_json_print_open_memfd (const char *name,
                               int         version)
{
  int fd;
  /* current kernels moan about not specifying exec mode */
#ifdef MFD_NOEXEC_SEAL
  fd = memfd_create ("cockpit login messages", MFD_ALLOW_SEALING | MFD_CLOEXEC | MFD_NOEXEC_SEAL);
  /* fallback for older kernels */
  if (fd == -1 && errno == EINVAL)
#endif
    fd = memfd_create ("cockpit login messages", MFD_ALLOW_SEALING | MFD_CLOEXEC);
  assert (fd != -1);

  FILE *stream = fdopen (fd, "w");
  assert (stream != NULL);

  if (version >= 0)
    fprintf (stream, "{\"version\": %d", version);
  else
    fputc ('{', stream);

  return stream;
}

/**
 * cockpit_json_print_finish_memfd:
 * @stream: the pointer to where a stream created by
 *     cockpit_json_print_open_memfd() is stored.
 *
 * Finishes off the printing of a JSON object to a memfd by writing
 * the closing '}', sealing the memfd, and reopening it readonly.
 *
 * @stream is closed, and set to %NULL.
 *
 * This function always returns a valid readonly file descriptor
 * pointing to the sealed memfd.  In case of any errors, the program is
 * aborted.
 */
int
cockpit_json_print_finish_memfd (FILE **stream)
{
  int r = fputc ('}', *stream);
  assert (r == '}');

  r = fflush (*stream);
  assert (r == 0);

  int fd = fileno (*stream);

  const int seals = F_SEAL_SHRINK | F_SEAL_GROW | F_SEAL_WRITE;
  r = fcntl (fd, F_ADD_SEALS, seals);
  assert (r == 0);

  char fd_name[] = "/proc/self/fd/xxxxxx";
  r = snprintf (fd_name, sizeof fd_name, "/proc/self/fd/%d", fd);
  assert (r < sizeof fd_name);

  int readonly_fd = open (fd_name, O_RDONLY);
  assert (readonly_fd != -1);

  fclose (*stream);
  *stream = NULL;

  return readonly_fd;
}
