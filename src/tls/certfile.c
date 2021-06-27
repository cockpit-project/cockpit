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

#include "certfile.h"

#include <assert.h>
#include <err.h>
#include <errno.h>
#include <fcntl.h>
#include <pthread.h>
#include <stdbool.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <unistd.h>

#include "utils.h"

/* We could come up with some exotic ways to mitigate several issues
 * which we would encounter with purely file-based locking primitives
 * (mostly caused by wanting to delete the file when we're done) or we
 * could take advantage of the fact that cockpit-tls is the only process
 * that ever writes to the certificates directory and just use a mutex.
 */
static pthread_mutex_t certfile_mutex = PTHREAD_MUTEX_INITIALIZER;

static bool
fingerprint_certificate (const gnutls_datum_t *certificate,
                         Fingerprint          *out_fingerprint)
{
  unsigned char digest_data[sizeof (Fingerprint) / 2];
  size_t digest_size = sizeof digest_data;
  int r;

  r = gnutls_fingerprint (GNUTLS_DIG_SHA256, certificate, digest_data, &digest_size);
  if (r != GNUTLS_E_SUCCESS)
    {
      warnx ("Could not generate fingerprint of peer certificate: %s", gnutls_strerror (r));
      return false;
    }
  assert (digest_size == sizeof digest_data);

  int str_offset = 0;
  for (int i = 0; i < sizeof digest_data; i++)
    {
      int s = snprintf (out_fingerprint->str + str_offset,
                        sizeof out_fingerprint->str - str_offset,
                        "%02x", digest_data[i]);
      str_offset += s;

      assert (s == 2 && str_offset < sizeof out_fingerprint->str);
    }

  out_fingerprint->str[str_offset++] = '\0';
  assert (str_offset == sizeof out_fingerprint->str);

  return true;
}

int
certfile_open (int                   dirfd,
               Fingerprint          *out_fingerprint,
               const gnutls_datum_t *der)
{
  Fingerprint fingerprint;
  const char *unlink_on_error = NULL;
  gnutls_datum_t pem = { NULL, 0 };
  int result = -1;
  int fd;

  if (!fingerprint_certificate (der, &fingerprint))
    return -1;

  /* We need to take the mutex here two prevent (at least) two problems:
   *
   *  - two connections starting at the same time could get in a fight
   *    about which one is responsible for writing the contents of the
   *    certificate to the file in case they both fstat() before either
   *    of them writes.  This is not very serious, but it is undesired.
   *
   *  - a connection starting just as the last connection is exiting on
   *    another thread could open the certificate file, not yet
   *    acquiring its lock, just before the file is unlinked by the
   *    exiting thread.  We would then successfully acquire a lock on
   *    the no-longer-linked file.  This is very serious.
   *
   * Mutual exclusion solves both of those issues.
   */
  pthread_mutex_lock (&certfile_mutex);

  /* We have two cases here: the case where the file already exists, and
   * the case where we must create the file.
   *
   * We attempt a separate open() for each of these two cases because we
   * need to detect which situation we are in because the error handling
   * is different for each case: if something goes wrong while we're
   * attempting to create the file, then we need to make sure we unlink
   * it again in case of an error.  Otherwise, we need to leave it
   * alone.
   */
  fd = openat (dirfd, fingerprint.str, O_RDWR, 0644);
  if (fd == -1)
    {
      if (errno != ENOENT)
        {
          warn ("Couldn't open existing fingerprint file %s", fingerprint.str);
          goto out_lock_held;
        }

      debug (CONNECTION, "certfile_open_for_peer: fingerprint file %s does not exist yet, creating", fingerprint.str);

      /* ENOENT case: The file didn't exist.  Create it. */
      fd = openat (dirfd, fingerprint.str, O_CREAT | O_EXCL | O_RDWR, 0666);
      if (fd == -1)
        {
          /* We're doing this all while holding a lock, so any error at
           * all at this point (including the file springing into
           * existence since open() failed with ENOENT) is unexpected.
           */
          warn ("Failed to create fingerprint file %s", fingerprint.str);
          goto out_lock_held;
        }

      /* We've successfully created the file.  Any failure should result
       * in an unlink.
       */
      unlink_on_error = fingerprint.str;

      /* We're going to write the file now, so calculate its contents */
      int r = gnutls_pem_base64_encode2 ("CERTIFICATE", der, &pem);
      if (r != GNUTLS_E_SUCCESS)
        {
          warnx ("Couldn't base64 encode certificate: %s", gnutls_strerror (r));
          goto out_lock_held;
        }

      /* First write the expected cgroup of the wsinstance */
      char cgroup[200];
      int s = snprintf (cgroup, sizeof cgroup,
                        "0::/system.slice/system-cockpithttps.slice/cockpit-wsinstance-https@%s.service\n",
                        fingerprint.str);
      assert (s < sizeof cgroup);

      if (write (fd, cgroup, s) != s)
        {
          warn ("Couldn't write content to certificate file %s", fingerprint.str);
          goto out_lock_held;
        }

      /* Then write the certificate */
      if (write (fd, pem.data, pem.size) != pem.size)
        {
          warn ("Couldn't write content to certificate file %s", fingerprint.str);
          goto out_lock_held;
        }
      debug (CONNECTION, "certfile_open_for_peer: wrote fingerprint file %s", fingerprint.str);
    }
  else
    {
      debug (CONNECTION, "certfile_open_for_peer: fingerprint file %s exists, reffing", fingerprint.str);
    }

  /* At this point, we have a valid fd and a file with content in it.
   *
   * Write locks are only ever held while also holding the mutex, so if
   * we fail to acquire a read lock, something has gone seriously wrong.
   */
  if (flock (fd, LOCK_SH | LOCK_NB) != 0)
    {
      warn ("Couldn't acquire read lock on certificate file %s", fingerprint.str);
      goto out_lock_held;
    }

  /* success */
  result = fd;
  unlink_on_error = NULL;
  fd = -1;

out_lock_held:
  /* Make sure we get the function version and not the weird
   * side-effecting macro version.
   */
  (gnutls_free) (pem.data);

  if (unlink_on_error)
    {
      if (unlinkat (dirfd, unlink_on_error, 0) != 0)
        err (EXIT_FAILURE, "Failed to unlink just-created certificate file %s", fingerprint.str);
    }

  pthread_mutex_unlock (&certfile_mutex);

  if (fd != -1)
    {
      close (fd);
      fd = -1;
    }

  if (result != -1)
    *out_fingerprint = fingerprint;

  return result;
}

void
certfile_close (int                dirfd,
                int                fd,
                const Fingerprint *fingerprint)
{
  /* Try to determine if we are the last user of this file by attempting
   * to take an exclusive lock on it.
   *
   * Check for and abort on unexpected errors: leaving a certificate
   * file laying around after all connections are closed is a potential
   * security problem.
   *
   * We need to take the lock here because there's a chance that another
   * connection could open() the file after we've acquired our lock, but
   * just before we unlink().  In that case, the other connection could
   * end up with a read lock on a file which is no longer linked to the
   * filesystem.  See above.
   *
   * There's also a chance that two connections closing at the same time
   * could both try and fail to acquire the write lock.  See below.
   */
  pthread_mutex_lock (&certfile_mutex);
  {
    /* Attempting to upgrade a shared lock to an exclusive lock is
     * non-atomic, and in particular, when done with LOCK_NB, is
     * documented to *release* the shared lock in case the exclusive
     * lock cannot be acquired.  This is the "original BSD behavior" the
     * manpage mentions.
     */
    int r = flock (fd, LOCK_EX | LOCK_NB);

    /* The three possible outcomes:
     *
     *  - 0: we got the lock, which means we are the last user and we
     *    should unlink the file
     *
     *  - errno == EWOULDBLOCK: we've released the lock, which means
     *    that there are other users and we shouldn't unlink the file
     *
     *  - some other error: something bad happened
     */

    if (r == 0)
      {
        /* We got the lock, so we're the last user: unlink the file */
        if (unlinkat (dirfd, fingerprint->str, 0) != 0)
          {
            /* We can't leave stale certificate files hanging around
             * after they should have been deleted, and we're really not
             * expecting a failure here, so let's abort the entire
             * service.  This should cause any running -ws instances to
             * be terminated, and will cause systemd to delete the
             * entire runtime directory as well.
             */
            err (EXIT_FAILURE, "Failed to unlink certificate file %s", fingerprint->str);
          }
          debug (CONNECTION, "certfile_close: we were the last holder, removed %s", fingerprint->str);
      }
    else if (errno == EWOULDBLOCK)
      {
        /* There are other users, so don't unlink.
         *
         * Assuming flock() works as documented, we've already released
         * our read lock, but let's really make sure of it: exiting the
         * critical section with the lock still held could prevent
         * another terminating connection thread from acquiring the
         * write lock and deleting the file.
         */
        if (flock (fd, LOCK_UN) != 0)
          {
            /* An unexpected failure: as above, we should abort. */
            err (EXIT_FAILURE, "Failed to drop lock on file %s", fingerprint->str);
          }
          debug (CONNECTION, "certfile_close: there are other lock holders for %s", fingerprint->str);
      }
    else
      {
        /* An unexpected failure: as above, we should abort. */
        err (EXIT_FAILURE, "Failed to take write lock on certificate file %s", fingerprint->str);
      }
  }
  pthread_mutex_unlock (&certfile_mutex);

  close (fd);
}
