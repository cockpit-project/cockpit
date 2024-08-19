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

#include "socket-io.h"

#include <assert.h>
#include <ctype.h>
#include <err.h>
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <sys/socket.h>
#include <sys/un.h>

#include "utils.h"

static uint64_t
get_elapsed_time (struct timespec *start)
{
  struct timespec now;
  int r;

  r = clock_gettime (CLOCK_MONOTONIC, &now);
  assert (r == 0);

  if (start->tv_sec == 0 && start->tv_nsec == 0)
    *start = now;

  int64_t elapsed = ((int64_t) now.tv_sec - start->tv_sec) * 1000000 +
                    ((int64_t) now.tv_nsec - start->tv_nsec) / 1000;

  assert (elapsed >= 0);

  return elapsed;
}

/**
 * get_remaining_timeout:
 * @start: a timespec struct, initially initialised to { 0, 0 }
 * @timeout_remaining: out-value for timeout remaining, in microseconds
 * @timeout_us: the total timeout value in microseconds
 *
 * Uses @start to keep track of how much time of an initial timeout is
 * remaining.
 *
 * This is useful to keep track of multiple-syscall IO operations with
 * one global timeout, in the presence of multiple read() or write()
 * calls, poll(), and the possibility of EINTR.
 *
 * On the first call (when @start is filled with zeros), @start is
 * initialised and @timeout_remaining will be set to the value of
 * @timeout_us.  On successive calls (which should usually have the same
 * value of @timeout_us), smaller values will be returned in line with
 * the passage of time, until there is no timeout remaining.
 *
 * Returns #true when there has been a non-negative value written into
 * @timeout_remaining, and returns #false when the timeout has expired.
 */
bool
get_remaining_timeout (struct timespec *start,
                       uint64_t        *timeout_remaining,
                       uint64_t         timeout_us)
{
  uint64_t elapsed = get_elapsed_time (start);

  debug (SOCKET_IO, "  -> %lld of %lld elapsed", (long long) elapsed, (long long) timeout_us);

  if (timeout_us < elapsed)
    return false;

  *timeout_remaining = timeout_us - elapsed;

  return true;
}

static int
wait_for_io (struct timespec *start,
             int              fd,
             short            events,
             uint64_t         timeout_us)
{
  struct pollfd pfd = { .fd = fd, .events = events };
  uint64_t remaining;
  int r;

  debug (SOCKET_IO, "wait_for_io(%d, %u, %ju):", fd, (unsigned) events, (uintmax_t) timeout_us);

  if (!get_remaining_timeout (start, &remaining, timeout_us))
    return 0;

  debug (SOCKET_IO, "  -> waiting for %jd", (uintmax_t) remaining);

  do
    r = poll (&pfd, 1, (remaining + 999) / 1000);
  while (r == -1 && errno == ENOENT);

  debug (SOCKET_IO, "  -> result is %d/%s", r, r < 0 ? strerror (errno) : "-");

  return r;
}

/**
 * recv_all:
 * @fd: a file descriptor for a connected stream socket
 * @buffer: a buffer
 * @size: the size of @buffer
 * @timeout: a timeout, in microseconds
 *
 * Attempts to read up to @size - 1 bytes from the connected stream
 * socket @fd, followed by EOF.  On success, a nul terminator is
 * inserted after the last byte and the number of bytes read (which
 * might be less than @size - 1) is returned, excluding the nul
 * terminator.  0 is a valid result.
 *
 * On failure (socket errors, timeout, or simply too much data read
 * without EOF), -1 is returned.
 *
 * This function is meant to be used with send_all() on the other side.
 */
static ssize_t
recv_all (int     fd,
          char   *buffer,
          size_t  size,
          int     timeout)
{
  struct timespec start = { 0, 0 };
  size_t count = 0;

  debug (SOCKET_IO, "read_all(fd=%d, size=%zu, timeout=%d)", fd, size, timeout);

  /* We need to see recv() return 0 in order to know that we have EOF.
   * In order to see that 0, we need to call recv() with a non-empty
   * buffer.  Conveniently, we can use the byte at the end of the buffer
   * that we will write the nul terminator byte into.  Without this
   * extra byte, we'd need to have a separate throwaway variable and a
   * separately-coded function call.
   */
  while (count < size && wait_for_io (&start, fd, POLLIN, timeout) == 1)
    {
      ssize_t s = recv (fd, buffer + count, size - count, MSG_DONTWAIT);
      debug (SOCKET_IO, "  -> recv returned %zd/%m", s);

      if (s == -1)
        {
          if (errno == EINTR || errno == EAGAIN)
            continue;

          warn ("recv_all() failed");
          return -1;
        }

      if (s == 0)
        {
          /* EOF → success */
          debug (SOCKET_IO, "  -> successfully received %zu bytes and EOF.", count);
          buffer[count] = '\0';
          return count;
        }

      count += s;
    }

  /* either the buffer overflowed or we timed out */
  warnx ("recv_all() failed: buffer is full and no EOF received");
  return -1;
}

/**
 * recv_alnum:
 * @fd: a file descriptor for a connected stream socket
 * @buffer: a buffer
 * @size: the size of @buffer
 * @timeout: a timeout, in microseconds
 *
 * Attempts to read a non-empty alphanumeric string up to @size - 1
 * bytes from the connected stream socket @fd, followed by EOF.  On
 * success, a nul terminator is inserted after the last byte and true is
 * returned.  The empty string is not a valid result.
 *
 * On failure (socket errors, timeout, too much data read, no data read,
 * or in case the data is not alphanumeric), false is returned.
 */
bool
recv_alnum (int     fd,
            char   *buffer,
            size_t  size,
            int     timeout)
{
  ssize_t r;
  size_t i;

  r = recv_all (fd, buffer, size, timeout);

  /* we need to have read at least one byte */
  if (r < 1)
    return false;

  for (i = 0; i < r; i++)
    if (!isalnum (buffer[i]))
      return false;

  return true;
}

/**
 * send_all:
 * @fd: a file descriptor for a connected stream socket
 * @buffer: a buffer
 * @size: the size of @buffer
 * @timeout: a timeout, in microseconds
 *
 * Writes exactly @size bytes of @buffer to @fd, followed by EOF (ie:
 * SHUT_WR).
 *
 * If all the bytes are written and the shutdown is successful, #true is
 * returned.  On failure (socket errors, or timeout) #false is returned.
 *
 * This function is meant to be used with recv_all() on the other side.
 */
bool
send_all (int         fd,
          const char *buffer,
          size_t      size,
          int         timeout)
{
  struct timespec start = { 0, 0 };
  size_t count = 0;

  while (count < size && wait_for_io (&start, fd, POLLOUT, timeout) == 1)
    {
      ssize_t s = send (fd, buffer + count, size - count, MSG_DONTWAIT | MSG_NOSIGNAL);

      if (s == -1)
        {
          if (errno == EINTR || errno == EAGAIN)
            continue;

          warn ("send_all() failed");
          return false;
        }

      count += s;
    }

  if (count != size)
    {
      warnx ("send_all() timed out");
      return false;
    }

  if (shutdown (fd, SHUT_WR) != 0)
    {
      warn ("send_all(): shutdown(SHUT_WR)");
      return false;
    }

  debug (SOCKET_IO, "  -> successfully sent all %zu bytes and EOF.", count);
  return true;
}

/**
 * af_unix_fill_sockaddr_at:
 * @addr: a (probably uninitialised) struct sockaddr_in
 * @dirfd: a directory fd, or AT_FDCWD
 * @pathname: a pathname
 *
 * Fills in @addr (both family and name) fields to be used with a
 * connect() or bind() call on a AF_UNIX socket.
 *
 * If the pathname given in @pathname is relative, then it is interpreted
 * relative to the directory referred to bythe file descriptor dirfd
 * (rather than relative to the current working directory of the calling
 * process, as is done by connect() or bind() for a relative pathname).
 * This is accomplished by building a pathname based on the symlinks in
 * /proc/self/fd/ (so @dirfd needs to remain open for the actual call to
 * connect() or bind()).
 *
 * If @pathname is relative and dirfd is the special value AT_FDCWD,
 * then @pathname is interpreted relative to the current working
 * directory of the calling process (like connect() or bind()).
 *
 * If @pathname is absolute, then dirfd is ignored.
 *
 * @dirfd is never actually inspected in any way during this call: it is
 * assumed to be a valid open directory file descriptor.  If it's not,
 * then this error won't be detected.
 *
 * Returns: %true on success, or %false (and errno == ENOMEM) in case it
 *   was not possible to fit the formatted string into the `struct
 *   sockaddr_un`.
 */
static bool
af_unix_fill_sockaddr_at (struct sockaddr_un *addr,
                          int                 dirfd,
                          const char         *pathname)
{
  int r;

  addr->sun_family = AF_UNIX;

  if (pathname[0] != '/' && dirfd != AT_FDCWD)
    r = snprintf (addr->sun_path, sizeof addr->sun_path, "/proc/self/fd/%d/%s", dirfd, pathname);
  else
    r = snprintf (addr->sun_path, sizeof addr->sun_path, "%s", pathname);

  if (0 < r && r < sizeof addr->sun_path)
    return true;

  errno = ENOMEM;
  return false;
}

/**
 * af_unix_connectat:
 * @sockfd: a socket file descriptor
 * @dirfd: a directory file descriptor
 * @pathname: a pathname
 *
 * Connects @sockfd to the unix domain socket at @pathname (relative to
 * @dirfd).
 *
 * This call operates in exactly the same way as connect(), except for
 * the differences described here.
 *
 * If the pathname given in @pathname is relative, then it is
 * interpreted relative to the directory referred to bythe file
 * descriptor dirfd (rather than relative to the current working
 * directory of the calling process, as is done by connect() for a
 * relative pathname).
 *
 * If @pathname is relative and dirfd is the special value AT_FDCWD,
 * then @pathname is interpreted relative to the current working
 * directory of the calling process (like connect()).
 *
 * If @pathname is absolute, then dirfd is ignored.
 *
 * An additional error of %ENOMEM can be returned in the event that it
 * was not possible to fit the filename into a `struct sockaddr_un`.
 *
 * Returns: 0 on success, or -1 (and errno set) on error
 */
int
af_unix_connectat (int         sockfd,
                   int         dirfd,
                   const char *pathname)
{
  struct sockaddr_un addr;

  if (!af_unix_fill_sockaddr_at (&addr, dirfd, pathname))
    return -1;

  debug (SOCKET_IO, "af_unix_connectat(%d, %s) to '%s'", dirfd, pathname, addr.sun_path);

  return connect (sockfd, (struct sockaddr *) &addr, sizeof addr);
}

/**
 * af_unix_bindat:
 * @sockfd: a socket file descriptor
 * @dirfd: a directory file descriptor
 * @pathname: a pathname
 *
 * Binds @sockfd to the filesystem at @pathname (relative to @dirfd).
 *
 * This call operates in exactly the same way as bind(), except for
 * the differences described here.
 *
 * If the pathname given in @pathname is relative, then it is
 * interpreted relative to the directory referred to bythe file
 * descriptor dirfd (rather than relative to the current working
 * directory of the calling process, as is done by bind() for a
 * relative pathname).
 *
 * If @pathname is relative and dirfd is the special value AT_FDCWD,
 * then @pathname is interpreted relative to the current working
 * directory of the calling process (like bind()).
 *
 * If @pathname is absolute, then dirfd is ignored.
 *
 * An additional error of %ENOMEM can be returned in the event that it
 * was not possible to fit the filename into a `struct sockaddr_un`.
 *
 * Returns: 0 on success, or -1 (and errno set) on error
 */
int
af_unix_bindat (int         sockfd,
                int         dirfd,
                const char *pathname)
{
  struct sockaddr_un addr;

  if (!af_unix_fill_sockaddr_at (&addr, dirfd, pathname))
    return -1;

  debug (SOCKET_IO, "af_unix_bindat(%d, %s) to '%s'", dirfd, pathname, addr.sun_path);

  return bind (sockfd, (struct sockaddr *) &addr, sizeof addr);
}
