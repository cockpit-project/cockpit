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

#include "config.h"

#include "httpredirect.h"

#include <sys/socket.h>
#include <pthread.h>
#include <stdio.h>
#include <stdbool.h>
#include <string.h>
#include <unistd.h>

static char *
read_line (FILE *stream,
           char *buffer,
           size_t sizeof_buffer,
           size_t *offset)
{
  if (*offset >= sizeof_buffer)
    return NULL;

  char *line = fgets (buffer + *offset, sizeof_buffer - *offset, stream);

  if (line == NULL)
    return NULL;

  /* Make sure we're terminated with \r\n or \n */
  size_t line_length = strcspn (line, "\r\n");
  const char *ending = line + line_length;
  if (strcmp (ending, "\r\n") != 0 && strcmp (ending, "\n") != 0)
    return NULL;

  /* Discard the ending */
  line[line_length++] = '\0';

  *offset += line_length;

  return line;
}

static bool
write_error (FILE *output)
{
  fprintf (output, "HTTP/1.1 400 Client Error\r\n"
                   "\r\n"
                   "Incorrect request.\r\n");

  return false;
}

static bool
http_redirect (FILE *input,
               FILE *output)
{
  char buffer[10000];
  size_t offset = 0;

  char *request_line = read_line (input, buffer, sizeof buffer, &offset);
  if (request_line == NULL)
    return write_error (output);

  char *path = strchr (request_line, ' ');
  if (path == NULL)
    return write_error (output);
  path++;

  char *end_path = strchr (path, ' ');
  if (end_path == NULL)
    return write_error (output);
  *end_path = '\0';

  const char *host = NULL;
  const char *header;
  do
    {
      header = read_line (input, buffer, sizeof buffer, &offset);
      if (header == NULL)
        return write_error (output);

#define HOST_HEADER "Host:"
      if (strncmp (header, HOST_HEADER, strlen (HOST_HEADER)) == 0)
        {
          if (host != NULL)
            return write_error (output);

          host = header + strlen (HOST_HEADER);
          host += strspn (host, " \t");
        }
    }
  while (header[0] != '\0');

  if (!host)
    return write_error (output);

  fprintf (output, "HTTP/1.1 301 Moved Permanently\r\n"
                   "Content-Type: text/html\r\n"
                   "Location: https://%s%s\r\n"
                   "\r\n", host, path);

  return true;
}

static void *
http_redirect_start (void *arg)
{
  FILE *stream = arg;

  http_redirect (stream, stream);

  fclose (stream);

  return NULL;
}

int
http_redirect_connect (void)
{
  int sv[2];
  int r = socketpair (AF_UNIX, SOCK_STREAM, 0, sv);
  if (r != 0)
    return -1;

  /* At this point we're going to succeed and return sv[1] to the
   * caller.  We need to make sure that sv[0] gets closed one way or
   * another:
   *  - if we fail to create the stream, close()
   *  - if we fail to spawn the thread, fclose()
   *  - otherwise, the thread calls fclose()
   */
  FILE *stream = fdopen (sv[0], "r+");
  if (stream == NULL)
    close (sv[0]);
  else
    {
      pthread_attr_t attr;
      pthread_t thread;

      pthread_attr_init (&attr);
      pthread_attr_setdetachstate (&attr, PTHREAD_CREATE_DETACHED);

      if (pthread_create (&thread, &attr, &http_redirect_start, stream))
        fclose (stream);

      pthread_attr_destroy (&attr);
    }

  return sv[1];
}

#ifdef HTTP_REDIRECT_STANDALONE
int
main (void)
{
  return http_redirect (stdin, stdout) ? 0 : 1;
}
#endif
