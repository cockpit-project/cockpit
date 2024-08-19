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

#include "client-certificate.h"

#include <assert.h>
#include <err.h>
#include <errno.h>
#include <fcntl.h>
#include <regex.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <syslog.h>
#include <unistd.h>

#include <systemd/sd-bus.h>

#include "session-utils.h"

#define CLIENT_CERTIFICATE_DIRECTORY   "/run/cockpit/tls/clients"

/* This is a bit lame, but having a hard limit on peer certificates is
 * desirable: Let's not get DoSed by huge certs */
#define MAX_PEER_CERT_SIZE 100000

/* Reads the cgroupsv2-style /proc/[pid]/cgroup file of the process,
 * including "0::" prefix and newline.
 *
 * In case of cgroupsv1, look for the name=systemd controller, and fake
 * it.
 */
static char *
read_proc_self_cgroup (size_t *out_length)
{
  FILE *fp = fopen ("/proc/self/cgroup", "r");

  if (fp == NULL)
    {
      warn ("Failed to open /proc/self/cgroup");
      return NULL;
    }

  /* Support cgroups v1 by looping.
   * Once we no longer need this support, we can drop the loop, switch
   * to fread(), and just return the entire content of the file.
   *
   * NB: the kernel doesn't allow newlines in cgroup names.
   */
  char buffer[1024];
  char *result = NULL;
  while (fgets (buffer, sizeof buffer, fp))
    {
      if (strncmp (buffer, "0::", 3) == 0)
        {
          /* cgroupsv2 (or hybrid) case.  Return the entire line. */
          result = strdupx (buffer);
          break;
        }
      else if (strncmp (buffer, "1:name=systemd:", 15) == 0)
        {
          /* cgroupsv1.  Rewrite to what we'd expect from cgroupsv2. */
          asprintfx (&result, "0::%s", buffer + 15);
          break;
        }
    }

  fclose (fp);

  assert (result != NULL);

  *out_length = strlen (result);

  /* Make sure we have a non-empty result, and that it ends with a
   * newline: this could only fail if the kernel returned something
   * unexpected.
   */
  assert (*out_length >= 5); /* "0::/\n" */
  assert (result[*out_length - 1] == '\n');

  return result;
}

/* valid_256_bit_hex_string:
 * @str: a string
 *
 * Ensures that str is a hexadecimal character string, exactly 64
 * characters in length.
 */
static bool
valid_256_bit_hex_string (const char *str)
{
  size_t length = strspn (str, "0123456789abcdef");

  return str[length] == '\0' && length == 64;
}

/**
 * read_cert_file:
 * @contents: a buffer to read the certificate into
 * @contents_size: the size of @contents
 *
 * Reads the contents of the certificate file into @contents (of size @contents_size).
 * The buffer must be large enough for the contents of the certificate file, plus
 * a nul terminator (which will be added).
 *
 * On success, the size of the certificate file (excluding nul
 * terminator) is returned.  This value is never 0.  On error, -1 is
 * returned with errno not guaranteed to be set (but a message will be
 * logged).
 */
static ssize_t
read_cert_file (const char *filename,
                char       *contents,
                size_t      contents_size)
{
  int dirfd = -1, filefd = -1;
  ssize_t result = -1;
  struct stat buf;
  ssize_t r;

  /* No tricky stuff, please */
  if (!valid_256_bit_hex_string (filename))
    {
      warnx ("tls-cert authentication token is invalid");
      goto out;
    }

  dirfd = open (CLIENT_CERTIFICATE_DIRECTORY, O_PATH | O_DIRECTORY | O_NOFOLLOW);
  if (dirfd == -1)
    {
      warn ("Failed to open " CLIENT_CERTIFICATE_DIRECTORY);
      goto out;
    }

  filefd = openat (dirfd, filename, O_RDONLY | O_NOFOLLOW);
  if (filefd == -1)
    {
      warn ("Failed to open certificate file %s/%s",
            CLIENT_CERTIFICATE_DIRECTORY, filename);
      goto out;
    }

  if (fstat (filefd, &buf) != 0)
    {
      warn ("Failed to stat certificate file %s/%s",
            CLIENT_CERTIFICATE_DIRECTORY, filename);
      goto out;
    }

  if (!S_ISREG (buf.st_mode))
    {
      warnx ("Could not read certificate: %s/%s is not a regular file",
             CLIENT_CERTIFICATE_DIRECTORY, filename);
      goto out;
    }

  if (buf.st_size == 0)
    {
      warnx ("Could not read certificate: %s/%s is empty",
             CLIENT_CERTIFICATE_DIRECTORY, filename);
      goto out;
    }

  /* Strictly less than, since we will add a nul */
  if (!(buf.st_size < contents_size))
    {
      warnx ("Insufficient space in read buffer for %s/%s",
             CLIENT_CERTIFICATE_DIRECTORY, filename);
      goto out;
    }

  do
    r = pread (filefd, contents, buf.st_size, 0);
  while (r == -1 && errno == EINTR);
  if (r == -1)
    {
      warn ("Could not read certificate file %s/%s",
            CLIENT_CERTIFICATE_DIRECTORY, filename);
      goto out;
    }
  if (r != buf.st_size)
    {
      warnx ("Read incomplete contents of certificate file %s/%s: %zu of %zu bytes",
             CLIENT_CERTIFICATE_DIRECTORY, filename, r, (size_t) buf.st_size);
      goto out;
    }

  contents[buf.st_size] = '\0';

  if (strlen (contents) != buf.st_size)
    {
      warnx ("Certificate file %s/%s contains nul characters",
             CLIENT_CERTIFICATE_DIRECTORY, filename);
      goto out;
    }

  result = buf.st_size;

out:
  if (filefd != -1)
    close (filefd);

  if (dirfd != -1)
    close (dirfd);

  return result;
}

static bool
sssd_map_certificate (const char *certificate, char** username)
{
  int result = false;
  sd_bus_error err = SD_BUS_ERROR_NULL;
  sd_bus *bus = NULL;
  sd_bus_message *user_obj_msg = NULL;
  const char *user_obj_path = NULL;
  int r;

  assert (username);
  assert (!*username);

  r = sd_bus_open_system (&bus);
  if (r < 0)
    {
      warnx ("Failed to connect to system bus: %s", strerror (-r));
      goto out;
    }

  /* sssd 2.6.1 introduces certificate validation against the configured CA. This version is in all supported distros */
  r = sd_bus_call_method (bus,
                          "org.freedesktop.sssd.infopipe",
                          "/org/freedesktop/sssd/infopipe/Users",
                          "org.freedesktop.sssd.infopipe.Users",
                          "FindByValidCertificate",
                          &err,
                          &user_obj_msg,
                          "s",
                          certificate);

  if (r < 0)
    {
      /* The error name is a bit confusing, and this is the common case; translate to readable error */
      if (sd_bus_error_has_name (&err, "sbus.Error.NotFound"))
        {
          warnx ("No matching user for certificate");
          goto out;
        }

      warnx ("Failed to map certificate to user: [%s] %s", err.name, err.message);
      goto out;
    }

  assert (user_obj_msg);

  r = sd_bus_message_read (user_obj_msg, "o", &user_obj_path);
  if (r < 0)
    {
      warnx ("Failed to parse response message: %s", strerror (-r));
      goto out;
    }

  debug ("certificate mapped to user object path %s", user_obj_path);

  r = sd_bus_get_property_string (bus,
                                  "org.freedesktop.sssd.infopipe",
                                  user_obj_path,
                                  "org.freedesktop.sssd.infopipe.Users.User",
                                  "name",
                                  &err,
                                  username);

  if (r < 0)
    {
      warnx ("Failed to map user object to name: [%s] %s", err.name, err.message);
      goto out;
    }

  assert (*username);
  debug ("mapped certificate to user %s", *username);
  result = true;

out:
  sd_bus_error_free (&err);
  sd_bus_message_unref (user_obj_msg);
  sd_bus_unref (bus);
  return result;
}

/**
 * cockpit_session_client_certificate_map_user
 *
 * Read the given certificate file, ensure that it belongs to our own cgroup, and ask
 * sssd to map it to a user. If everything matches as expected, return the user name.
 * Otherwise return %NULL, a warning message will already have been logged.
 */
char *
cockpit_session_client_certificate_map_user (const char *client_certificate_filename)
{
  char cert_pem[MAX_PEER_CERT_SIZE];
  char *sssd_user = NULL;

  /* read the certificate file from disk */
  if (read_cert_file (client_certificate_filename, cert_pem, sizeof cert_pem) < 0)
    {
      warnx ("No https instance certificate present");
      return NULL;
    }

  size_t my_cgroup_length;
  char *my_cgroup = read_proc_self_cgroup (&my_cgroup_length);
  if (my_cgroup == NULL)
    {
      warnx ("Could not determine cgroup of this process");
      return NULL;
    }
  /* A simple prefix comparison is appropriate here because my_cgroup
   * will contain exactly one newline (at the end), and the expected
   * value of my_cgroup is on the first line in cert_pem.
   */
  if (strncmp (cert_pem, my_cgroup, my_cgroup_length) != 0)
    {
      warnx ("This client certificate is only meant to be used from another cgroup");
      free (my_cgroup);
      return NULL;
    }
  free (my_cgroup);

  /* ask sssd to map cert to a user */
  if (!sssd_map_certificate (cert_pem + my_cgroup_length, &sssd_user))
    return NULL;

  return sssd_user;
}
