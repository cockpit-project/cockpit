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


#ifdef HAVE_CONFIG_H
#include <config.h>
#endif

#include "cockpitwsinstancecert.h"

#include <assert.h>
#include <err.h>
#include <errno.h>
#include <fcntl.h>
#include <regex.h>
#include <stddef.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#include "../tls/utils.h"

#define CGROUP_REGEX         "^(0:|1:name=systemd):/system.slice/system-cockpithttps.slice/" \
                             "cockpit-wsinstance-https@([0-9a-f]{64}).service$"
#define CGROUP_REGEX_FLAGS   (REG_EXTENDED | REG_NEWLINE)
#define CGROUP_REGEX_GROUPS  3   /* number of groups, including the complete match */
#define CGROUP_REGEX_MATCH   2   /* the group which contains the instance */

/* get our cgroup, map it to a systemd unit instance name
 * looks like 0::/system.slice/system-cockpit\x2dwsinstance\x2dhttps.slice/cockpit-wsinstance-https@123abc.service
 * returns "123abc" instance name (static string)
 */
static const char *
get_ws_https_instance (void)
{
  int r;
  static char buf[1024];
  regmatch_t pmatch[CGROUP_REGEX_GROUPS];
  regex_t preg;
  int fd;

  /* read /proc/self/cgroup */
  fd = open ("/proc/self/cgroup", O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
  if (fd < 0)
    {
      warn ("Failed to open /proc/self/cgroup");
      return NULL;
    }

  do
    r = read (fd, buf, sizeof buf);
  while (r < 0 && errno == EINTR);
  if (r < 0)
    {
      warn ("Failed to read /proc/self/cgroup");
      close (fd);
      return NULL;
    }
  close (fd);
  if (r == 0 || r >= sizeof buf)
    {
      warnx ("Read invalid size %i from /proc/self/cgroup", r);
      return NULL;
    }
  buf[r] = '\0';

  /* extract the instance name */
  r = regcomp (&preg, CGROUP_REGEX, CGROUP_REGEX_FLAGS);
  assert (r == 0);

  r = regexec (&preg, buf, CGROUP_REGEX_GROUPS, pmatch, 0);
  regfree (&preg);
  if (r != 0)
    {
      /* It's expected that this function will often be called even when
       * the client didn't send a certificate, so we shouldn't log about
       * that.  It might be useful for debugging, though.
       */

      // warnx ("Not running in a template cgroup, unable to parse systemd unit instance.\n\n/proc/self/cgroups content follows:\n%s\n", buf);
      return NULL;
    }

  buf[pmatch[CGROUP_REGEX_MATCH].rm_eo] = '\0';

  return buf + pmatch[CGROUP_REGEX_MATCH].rm_so;
}

/**
 * cockpit_wsinstance_has_certificate_file:
 * @contents: an optional buffer to read the certificate into
 * @contents_size: the size of @contents
 *
 * Checks if an active, regular, non-empty https certificate file exists
 * for the cgroup of the current wsinstance.  This is true if there are
 * any active https connections from the client which was responsible
 * for this cockpit-ws instance being started.
 *
 * Optionally, reads the contents of the certificate file into
 * @contents (of size @contents_size).  The buffer must be large enough
 * for the contents of the certificate file, plus a nul terminator
 * (which will be added).  If @contents is %NULL then no attempt will be
 * made to read the file contents, but the other checks are performed.
 *
 * On success, the size of the certificate file (excluding nul
 * terminator) is returned.  This value is never 0.  On error, -1 is
 * returned with errno not guaranteed to be set (but a message will be
 * logged).
 */
ssize_t
https_instance_has_certificate_file (char   *contents,
                                     size_t  contents_size)
{
  const char *https_instance = get_ws_https_instance ();
  int dirfd = -1, filefd = -1;
  ssize_t result = -1;
  struct stat buf;
  ssize_t r;

  if (https_instance == NULL) /* already warned */
    goto out;
  if (strcmp (https_instance, SHA256_NIL) == 0)
    goto out;

  dirfd = open ("/run/cockpit/tls", O_PATH | O_DIRECTORY | O_NOFOLLOW);
  if (dirfd == -1)
    {
      warn ("Failed to open /run/cockpit/tls");
      goto out;
    }

  filefd = openat (dirfd, https_instance, O_RDONLY | O_NOFOLLOW);
  if (filefd == -1)
    {
      warn ("Failed to open certificate file /run/cockpit/tls/%s", https_instance);
      goto out;
    }

  if (fstat (filefd, &buf) != 0)
    {
      warn ("Failed to stat certificate file /run/cockpit/tls/%s", https_instance);
      goto out;
    }

  if (!S_ISREG (buf.st_mode))
    {
      warnx ("Could not read certificate: /run/cockpit/tls/%s is not a regular file", https_instance);
      goto out;
    }

  if (buf.st_size == 0)
    {
      warnx ("Could not read certificate: /run/cockpit/tls/%s is empty", https_instance);
      goto out;
    }

  if (contents != NULL)
    {
      /* Strictly less than, since we will add a nul */
      if (!(buf.st_size < contents_size))
        {
          warnx ("Insufficient space in read buffer for /run/cockpit/tls/%s", https_instance);
          goto out;
        }

      do
        r = pread (filefd, contents, buf.st_size, 0);
      while (r == -1 && errno == EINTR);
      if (r == -1)
        {
          warn ("Could not read certificate file /run/cockpit/tls/%s", https_instance);
          goto out;
        }
      if (r != buf.st_size)
        {
          warnx ("Read incomplete contents of certificate file /run/cockpit/tls/%s: %zu of %zu bytes",
                 https_instance, r, (size_t) buf.st_size);
          goto out;
        }

      contents[buf.st_size] = '\0';

      if (strlen (contents) != buf.st_size)
        {
          warnx ("Certificate file /run/cockpit/tls/%s contains nul characters", https_instance);
          goto out;
        }
    }

  result = buf.st_size;

out:
  if (filefd != -1)
    close (filefd);

  if (dirfd != -1)
    close (dirfd);

  return result;
}
