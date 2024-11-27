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

#ifdef HAVE_PIDFD_GETPID
#include <sys/pidfd.h>
#endif

#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <syslog.h>
#include <unistd.h>

#include <systemd/sd-bus.h>

#include "session-utils.h"

#define CLIENT_CERTIFICATE_DIRECTORY   "/run/cockpit/tls/clients"

static int
open_proc_pid (pid_t pid)
{
    char path[100];
    int r = snprintf (path, sizeof path, "/proc/%lu", (unsigned long) pid);
    if (r < 0 || r >= sizeof path)
        errx (EX, "memory error");
    int fd = open (path, O_DIRECTORY | O_NOFOLLOW | O_PATH | O_CLOEXEC);
    if (fd < 0)
      err (EX, "failed to open %s", path);
    return fd;
}

static size_t
read_proc_file (int dirfd, const char *name, char *buffer, size_t bufsize)
{
  int fd = openat (dirfd, name, O_RDONLY | O_CLOEXEC);
  if (fd < 0)
    err (EX, "Failed to open %s proc file", name);

  /* we don't accept/expect EINTR or short reads here: this is /proc, and we don't have
   * signal handlers which survive the login */
  ssize_t len = read (fd, buffer, bufsize);
  if (len < 0)
    err (EX, "Failed to read /proc file %s", name);

  close (fd);
  if (len >= bufsize)
    errx (EX, "proc file %s exceeds buffer size %zu", name, bufsize);
  buffer[len] = '\0';
  return len;
}

/* This is a bit lame, but having a hard limit on peer certificates is
 * desirable: Let's not get DoSed by huge certs */
#define MAX_PEER_CERT_SIZE 100000

/* Reads the cgroupsv2-style /proc/[pid]/cgroup file of the process,
 * including "0::" prefix and newline.
 * NB: the kernel doesn't allow newlines in cgroup names. */
static char *
read_proc_pid_cgroup (int dirfd, size_t *out_length)
{
  char buffer[1024];
  size_t len = read_proc_file (dirfd, "cgroup", buffer, sizeof buffer);

  if (strncmp (buffer, "0::/", 4) == 0 && /* must be a cgroupsv2 */
      buffer[len - 1] == '\n') /* must end with a newline */
    {
      *out_length = len;
      return strdupx (buffer);
    }

  warnx ("unexpected cgroups content, certificate matching only supports cgroup v2: '%s'", buffer);
  exit_init_problem ("authentication-unavailable", "certificate matching only supports cgroup v2");
}

static
unsigned long long get_proc_pid_start_time (int dirfd)
{
  char buffer[4096];
  read_proc_file (dirfd, "stat", buffer, sizeof buffer);

  /* start time is the token at index 19 after the '(process name)' entry - since only this
  * field can contain the ')' character, search backwards for this to avoid malicious
  * processes trying to fool us; See proc_pid_stat(5) */
  const char *p = strrchr (buffer, ')');
  if (p == NULL)
    errx (EX, "Failed to find process name in /proc/pid/stat: %s", buffer);
  for (int i = 0; i <= 19; i++) /* NB: ')' is the first token */
    {
      p = strchr (p, ' ');
      if (p == NULL)
        errx (EX, "Failed to find start time in /proc/pid/stat");
      ++p; /* skip over the space */
    }

  char *endptr;
  unsigned long long start_time = strtoull (p, &endptr, 10);
  if (*endptr != ' ')
    errx (EX, "Failed to parse start time in /proc/pid/stat from %s", p);
  return start_time;
}

/* Fallback for get_ws_proc_fd() on older kernels which don't support enough pidfd API */
static int
get_ws_proc_fd_pid_time (int unix_fd)
{
  struct ucred ucred;
  socklen_t ucred_len = sizeof ucred;
  if (getsockopt (unix_fd, SOL_SOCKET, SO_PEERCRED, &ucred, &ucred_len) != 0 ||
      /* this is an inout parameter, be extra suspicious */
      ucred_len != sizeof ucred)
    {
      debug ("failed to read stdin peer credentials: %m; not in socket mode?");
      warnx ("Certificate authentication only supported with cockpit-session.socket");
      exit_init_problem ("authentication-unavailable", "Certificate authentication only supported with cockpit-session.socket");
    }

  debug ("unix socket mode, ws peer pid %d", ucred.pid);
  int ws_proc_dirfd = open_proc_pid (ucred.pid);
  unsigned long long ws_start_time = get_proc_pid_start_time (ws_proc_dirfd);

  int my_pid_dirfd = open_proc_pid (getpid ());
  unsigned long long my_start_time = get_proc_pid_start_time (my_pid_dirfd);
  close (my_pid_dirfd);

  debug ("peer start time: %llu, my start time: %llu", ws_start_time, my_start_time);

  /* Guard against pid recycling: If a malicious user captures ws, keeps the socket in a forked child and exits
    * the original pid, they can trick a different user to login, get the old pid (pointing to their cgroup), and
    * capture their session. To prevent that, require that ws must have started earlier than ourselves. */
  if (my_start_time < ws_start_time)
    {
      warnx ("start time of this process (%llu) is older than cockpit-ws (%llu), pid recycling attack?",
              my_start_time, ws_start_time);
      close (ws_proc_dirfd);
      exit_init_problem ("access-denied", "implausible cockpit-ws start time");
    }

  return ws_proc_dirfd;
}

/* Get a /proc/[pid] dirfd for our Unix socket peer (i.e. cockpit-ws).
 * We only support being called via cockpit-session.socket (i.e. Unix socket).
 */
static int
get_ws_proc_fd (int unix_fd)
{
#if defined(SO_PEERPIDFD) && defined(HAVE_PIDFD_GETPID)
  int pidfd = -1;
  socklen_t socklen = sizeof pidfd;
  /* this is always the pidfd for the process that started the communication, it cannot be recycled */
  if (getsockopt (unix_fd, SOL_SOCKET, SO_PEERPIDFD, &pidfd, &socklen) < 0)
    {
      if (errno == ENOPROTOOPT)
        {
          debug ("SO_PEERPIDFD not supported: %m, falling back to pid/time check");
          return get_ws_proc_fd_pid_time (unix_fd);
        }

      warn ("Failed to get peer pidfd");
      exit_init_problem ("access-denied", "Failed to get peer pidfd");
    }
  /* this is an inout parameter, be extra suspicious; this really Should Not Happen™, so bomb out */
  if (socklen != sizeof pidfd)
    errx (EX, "SO_PEERPIDFD returned too small result");

  /* get pid for pidfd; from here on this is racy and could suffer from PID recycling */
  pid_t pid = pidfd_getpid (pidfd);
  if (pid < 0)
    {
      /* be *very* strict here. This could theoretically ENOSYS if glibc has pidfd_getpid() but the kernel doesn't
       * support it; but err on the side of denying access rather than falling back */
      warn ("Failed to get pid from pidfd");
      exit_init_problem ("access-denied", "Failed to get pid from pidfd");
    }

  debug ("pid from ws peer pidfd: %i", (int) pid);
  int ws_proc_dirfd = open_proc_pid (pid);

  /* check that the pid is still valid to guard against recycling */
  if (pidfd_getpid (pidfd) != pid)
    {
      warn ("original pid %i is not valid any more", (int) pid);
      exit_init_problem ("access-denied", "Failed to get cockpit-ws pid");
    }

  close (pidfd);
  return ws_proc_dirfd;

#else
  debug ("not built with pidfd support, falling back to pid/time check");
  return get_ws_proc_fd_pid_time (unix_fd);
#endif
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
 * Otherwise exit the process with sending an appropriate error to stdout using the
 * Cockpit protocol.
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
      exit_init_problem ("authentication-unavailable", "No https instance certificate present");
    }

  /* We need to check the cgroup of cockpit-ws (our peer); we are systemd socket activated, so stdin is a socket */
  int ws_proc_dirfd = get_ws_proc_fd (STDIN_FILENO);
  size_t ws_cgroup_length;
  char *ws_cgroup = read_proc_pid_cgroup (ws_proc_dirfd, &ws_cgroup_length);
  assert (ws_cgroup);
  close (ws_proc_dirfd);

  /* read_proc_pid_cgroup() already ensures that, but just in case we refactor this: this is *essential* for the
   * subsequent comparison */
  if (ws_cgroup[ws_cgroup_length - 1] != '\n')
    errx (EX, "cgroup does not end in newline");

  /* A simple prefix comparison is appropriate here because ws_cgroup
   * contains exactly one newline (at the end), and the expected
   * value of ws_cgroup is on the first line in cert_pem.
   */
  if (strncmp (cert_pem, ws_cgroup, ws_cgroup_length) != 0)
    {
      warnx ("This client certificate is only meant to be used from another cgroup");
      free (ws_cgroup);
      exit_init_problem ("access-denied", "mismatching client certificate");
    }
  free (ws_cgroup);

  /* ask sssd to map cert to a user */
  if (!sssd_map_certificate (cert_pem + ws_cgroup_length, &sssd_user))
    exit_init_problem ("authentication-failed", "sssd does not know this certificate");

  return sssd_user;
}
