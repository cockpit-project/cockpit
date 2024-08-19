/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2021 Red Hat, Inc.
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

/*
 * This file deals with authentication based on client certificates.  It
 * contains a peer certificate verification function and a series of
 * functions for dealing with the session-scoped client certificate file
 * we store on the disk.
 *
 * This file is responsible for determining the cockpit-ws instance
 * identifiers: the client certificate files are limited in scope to a
 * particular cgroup, which is determined based on the instance
 * identifier: that logic is also in this file.
 *
 * Higher layers (cockpit-tls → cockpit-ws → cockpit-session) are
 * responsible for transporting the client certificate filename from
 * here to the counterpart of this file which performs the actual
 * checks: src/session/client-certificate.c.  The filename is
 * required information for authentication, but it's not sufficient:
 * the cgroup of the wsinstance must also match the one found in the
 * client certificate file.
 */

#include "config.h"

#include "client-certificate.h"

#include "common/cockpitmemory.h"
#include "common/cockpithex.h"
#include "tls/utils.h" /* for SHA256_NIL */

#include <assert.h>
#include <err.h>
#include <fcntl.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/random.h>
#include <unistd.h>


/**
 * client_certificate_verify: Custom client certificate validation function
 *
 * cockpit-tls ignores CA/trusted owner and leaves that to e. g. sssd. But
 * validate the other properties such as expiry, unsafe algorithms, etc.
 * This combination cannot be done with gnutls_session_set_verify_cert().
 */
int
client_certificate_verify (gnutls_session_t session)
{
  unsigned status;
  int ret;

  do
    ret = gnutls_certificate_verify_peers2 (session, &status);
  while (ret == GNUTLS_E_INTERRUPTED);

  if (ret == 0)
    {
      /* ignore CA/trusted owner and leave that to e. g. sssd */
      status &= ~(GNUTLS_CERT_INVALID | GNUTLS_CERT_SIGNER_NOT_FOUND | GNUTLS_CERT_SIGNER_NOT_CA);
      if (status != 0)
        {
          gnutls_datum_t msg;
          ret = gnutls_certificate_verification_status_print (status, gnutls_certificate_type_get (session), &msg, 0);
          if (ret != GNUTLS_E_SUCCESS)
            errx (EXIT_FAILURE, "Failed to print verification status: %s", gnutls_strerror (ret));
          warnx ("Invalid TLS peer certificate: %s", msg.data);
          gnutls_free (msg.data);
#ifdef GNUTLS_E_CERTIFICATE_VERIFICATION_ERROR
          return GNUTLS_E_CERTIFICATE_VERIFICATION_ERROR;
#else  /* fallback for GnuTLS < 3.4.4 */
          return GNUTLS_E_CERTIFICATE_ERROR;
#endif
        }
    }
  else if (ret != GNUTLS_E_NO_CERTIFICATE_FOUND)
    {
      warnx ("Verifying TLS peer failed: %s", gnutls_strerror (ret));
      return ret;
    }

  return GNUTLS_E_SUCCESS;
}

/**
 * client_certificate_get_wsinstance:
 * @certificate: the certificate presented by the peer
 *
 * Determines the correct cockpit-ws instance for handling connections
 * for this @certificate (must be non-%NULL).
 *
 * Currently, the full SHA256 fingerprint of the peer certificate is
 * used.  This is a pure design decision that nothing else depends on,
 * and it could be changed to something else.
 *
 * This function never fails.  Any internal failure will abort the
 * program.
 *
 * The return value of this function needs to be free()d.
 */
static char *
client_certificate_get_wsinstance (const gnutls_datum_t *certificate)
{
  unsigned char digest_data[256 / 8];
  size_t digest_size = sizeof digest_data;
  int r = gnutls_fingerprint (GNUTLS_DIG_SHA256, certificate, digest_data, &digest_size);
  if (r != GNUTLS_E_SUCCESS)
    errx (EXIT_FAILURE, "Could not generate fingerprint of peer certificate: %s",
          gnutls_strerror (r));
  assert (digest_size == sizeof digest_data);

  return cockpit_hex_encode (digest_data, digest_size);
}

/**
 * client_certificate_random_filename:
 *
 * Generates a (high quality) random hexadecimal string to use as a
 * client certificate filename.
 *
 * Currently, the filename will be 64 characters in length.  This is a
 * pure design decision that nothing else depends on, and it could be
 * changed to something else.
 *
 * This function never fails.  Any internal failure will abort the
 * program.
 *
 * The return value of this function needs to be free()d.
 */
static char *
client_certificate_random_filename (void)
{
  /* This is guaranteed to succeed, but we check it anyway. */
  unsigned char random_data[256 / 8];
  ssize_t s = getrandom (random_data, sizeof random_data, 0);
  if (s != sizeof random_data)
    err (EXIT_FAILURE, "Could not read random data from the kernel");

  return cockpit_hex_encode (random_data, sizeof random_data);
}

/**
 * client_certificate_write_data:
 * @fd: a writable file descriptor
 * @data: data to write
 * @size: the length of @data
 * @description: description of @data, added to error messages
 *
 * Writes @data to @fd.
 *
 * There's no EINTR handling or support for partial writes.  Any kind of
 * result other than a complete success on the first try is treated as
 * an error — this is tmpfs, after all.
 *
 * In case of failure, a message will be written to stderr.
 */
static bool
client_certificate_write_data (int         fd,
                               const void *data,
                               size_t      size,
                               const char *description)
{
  ssize_t s = write (fd, data, size);

  if (s == size)
    return true;

  if (s == -1)
    warn ("Couldn't write %s to certificate file", description);
  else
    warnx ("Partial write of %s to certificate file: %zu of %zu", description, s, size);

  return false;
}

static bool
client_certificate_write_cgroup_header (int         fd,
                                        const char *wsinstance)
{
  char header[200];
  int s = snprintf (header, sizeof header,
                    "0::/system.slice/system-cockpithttps.slice/cockpit-wsinstance-https@%s.service\n",
                    wsinstance);
  assert (s < sizeof header);

  return client_certificate_write_data (fd, header, s, "cgroup header");
}

static bool
client_certificate_write_pem (int   fd,
                              const gnutls_datum_t *der)
{
  gnutls_datum_t pem = { NULL, 0 };
  int r = gnutls_pem_base64_encode2 ("CERTIFICATE", der, &pem);
  if (r != GNUTLS_E_SUCCESS)
    {
      warnx ("Couldn't base64 encode certificate: %s", gnutls_strerror (r));
      return false;
    }

  bool result = client_certificate_write_data (fd, pem.data, pem.size, "PEM data");

  /* Make sure we get the function version and not the weird
   * side-effecting macro version.
   */
  (gnutls_free) (pem.data);

  return result;
}

/**
 * client_certificate_link_fd_to_random_name:
 * @dirfd: the directory to link the file
 * @fd: the file created with O_TMPFILE
 * @out_filename: the filename that was chosen
 *
 * Links the O_TMPFILE referred to by @fd to a random filename in
 * @dirfd.
 *
 * On success, %true is returned and @out_filename is set to the
 * filename that was used.  It must be free()d.
 *
 * On failure, %false is returned and a message will have been logged.
 */
static bool
client_certificate_link_fd_to_random_name (int    dirfd,
                                           int    fd,
                                           char **out_filename)
{
  char *filename = client_certificate_random_filename ();

  /* "the usual tricks" — see openat(2) and linkat(2) */
  char path[PATH_MAX];
  snprintf(path, PATH_MAX,  "/proc/self/fd/%d", fd);

  if (linkat (AT_FDCWD, path, dirfd, filename, AT_SYMLINK_FOLLOW) == 0)
    {
      *out_filename = filename;
      return true;
    }
  else
    {
      warn ("Unable to link client certificate file to /run/cockpit/tls/%s", filename);
      free (filename);
      return false;
    }
}

/**
 * client_certificate_create_tmpfile:
 * @dirfd: the directory that will eventually contain the file
 * @out_fd: a write-mode fd for the created file
 */
static bool
client_certificate_create_tmpfile (int  dirfd,
                                   int *out_fd)
{
  int fd = openat (dirfd, ".", O_TMPFILE | O_WRONLY, 0400);
  if (fd == -1)
    {
      warn ("Couldn't create temporary file for client certificate");
      return false;
    }

  *out_fd = fd;
  return true;
}

/**
 * client_certificate_accept:
 * @session: a post-handshake gnutls session
 * @dirfd: the directory for session-scoped client certificates
 * @out_wsinstance: the instance of cockpit-ws to connect to
 * @out_filename: the filename where the client certificate was written
 *
 * Called immediately after completing the handshake with an incoming
 * HTTPS connection.
 *
 * If no client certificate was presented, this function writes %NULL to
 * @out_filename, but still provides a (hard-coded) instance identifier
 * to @out_wsinstance.
 *
 * If a client certificate was presented, the @out_wsinstance will
 * correspond to the SHA256 of the peer certificate.  In this case, a
 * file with a random filename will be written to the directory
 * referenced by @dirfd.  This file will contain the expected cgroup of
 * the cockpit-ws instance in question, plus the client certificate.
 * That data is interpreted by the counterpart to this code, living in
 * src/ws/cockpit-session-client-certificate.c
 *
 * In any case, %true will be returned in case of success, and %false
 * will be returned in case of an error.  In case of success, any values
 * returned in @out_wsinstance or @out_filename need to be free()d.  In
 * case of error, the connection should be terminated: a message will
 * already have been logged.
 */
bool
client_certificate_accept (gnutls_session_t   session,
                           int                dirfd,
                           char             **out_wsinstance,
                           char             **out_filename)
{
  const gnutls_datum_t *peer_certificate = gnutls_certificate_get_peers (session, NULL);

  if (peer_certificate == NULL)
    {
      *out_wsinstance = strdupx (SHA256_NIL);
      *out_filename = NULL;

      return true;
    }

  char *wsinstance = client_certificate_get_wsinstance (peer_certificate);

  int fd = -1;
  bool success =
    client_certificate_create_tmpfile (dirfd, &fd) &&
    client_certificate_write_cgroup_header (fd, wsinstance) &&
    client_certificate_write_pem (fd, peer_certificate) &&
    client_certificate_link_fd_to_random_name (dirfd, fd, out_filename);

  if (fd != -1)
    close (fd);

  if (success)
    *out_wsinstance = wsinstance;
  else
    free (wsinstance);

  if (!success)
    warnx ("Disconnecting client due to above failure.");

  return success;
}

/**
 * client_certificate_unlink_and_free:
 * @dirfd: the directory for session-scoped client certificates
 * @inout_filename: the name of the client certificate file
 *
 * Glorified wrapper around unlinkat().
 *
 * Frees @inout_filename.
 *
 * If the operation fails, the program will be aborted.
 */
void
client_certificate_unlink_and_free (int   dirfd,
                                    char *filename)
{
  if (unlinkat (dirfd, filename, 0) != 0)
    {
      /* We can't leave stale certificate files hanging around after
       * they should have been deleted, and we're really not expecting a
       * failure here, so let's abort the entire service.  This should
       * cause any running -ws instances to be terminated, and will
       * cause systemd to delete the entire runtime directory as well.
       */
      err (EXIT_FAILURE, "Failed to unlink client certificate file %s", filename);
    }

  free (filename);
}
