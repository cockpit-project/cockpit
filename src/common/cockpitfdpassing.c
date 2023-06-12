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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

#include "config.h"

#include "cockpitfdpassing.h"

#include <assert.h>
#include <errno.h>
#include <poll.h>
#include <string.h>
#include <unistd.h>

/**
 * cockpit_socket_msghdr_add_fd:
 * @msg: a msghdr to be passed to a future call to sendmsg
 * @cmsg: a buffer
 * @cmsgsize: sizeof cmsg
 * @fd: the fd to add to the msghdr
 *
 * Adds a cmsg to the given msghdr structure, transmitting @fd.
 *
 * @cmsg should be a pointer to a variable of type `struct cmsghdr[2]`
 * and @cmsgsize should be the sizeof this variable.  This is used for
 * temporary storage and needs to stay around until the sendmsg() call.
 *
 * This can't fail.
 */
void
cockpit_socket_msghdr_add_fd (struct msghdr  *msg,
                              struct cmsghdr *cmsg,
                              size_t          cmsgsize,
                              int             fd)
{
  /* make sure user's buffer is big enough */
  assert (CMSG_SPACE(sizeof fd) <= cmsgsize);

  /* make sure nothing else is there */
  assert (msg->msg_control == NULL);
  assert (msg->msg_controllen == 0);

  /* we have an fd to send: create an SCM_RIGHTS cmsg. */
  cmsg->cmsg_len = CMSG_LEN(sizeof fd);
  cmsg->cmsg_level = SOL_SOCKET;
  cmsg->cmsg_type = SCM_RIGHTS;
  memcpy (CMSG_DATA(cmsg), &fd, sizeof fd);

  /* attach it to the msghdr */
  msg->msg_control = cmsg;
  msg->msg_controllen = CMSG_LEN(sizeof fd);
}

/**
 * cockpit_socket_send_fd:
 * @socket_fd: a unix socket
 * @fd: the fd to send
 *
 * Calls sendmsg() to write a single nul byte, plus a single file
 * descriptor, @fd.
 *
 * If sendmsg() is successful then this function returns %true.
 * Otherwise, %false is returned and errno will be set.
 */
bool
cockpit_socket_send_fd (int socket_fd,
                        int fd)
{
  struct msghdr msg = { .msg_iov = (struct iovec[]){ {(char[]){""}, 1 } },
                        .msg_iovlen = 1 };

  struct cmsghdr cmsg[2];
  cockpit_socket_msghdr_add_fd (&msg, cmsg, sizeof cmsg, fd);

  ssize_t s;
  do
    s = sendmsg (socket_fd, &msg, MSG_NOSIGNAL);
  while (s == -1 && errno == EINTR);

  return s != -1;
}

/**
 * cockpit_socket_receive_fd:
 * @socket_fd: a unix socket
 * @out_fd: the received file descriptor
 *
 * Calls recvmsg() to receive a single byte and (hopefully) a single file
 * descriptor.  The byte is discarded.  The return value of this
 * function is equal to the return value of the recvmsg() call.
 *
 * A return value of -1 indicates a syscall fail (with errno set).  0
 * means EOF.  A return value of 1 means that we received a message, and
 * will set @fd to any file descriptor we received with the message (or
 * -1 otherwise).
 */
int
cockpit_socket_receive_fd (int  socket_fd,
                           int *out_fd)
{
  struct cmsghdr cmsg[2];
  struct msghdr msg = { .msg_iov = (struct iovec[]){ {(char[]){""}, 1 } },
                        .msg_iovlen = 1,
                        .msg_control = &cmsg,
                        .msg_controllen = CMSG_LEN (sizeof *out_fd) };
  assert (msg.msg_controllen <= sizeof cmsg);

  /* recvmsg() has no MSG_DONTWAIT, and e.g. sudo makes stdin non-blocking with `log_output` option */
  struct pollfd socket_pfd = { .fd = socket_fd, .events = POLLIN };
  int ret;
  do
      ret = poll (&socket_pfd, 1, -1);
  while (ret == -1 && errno == EINTR);
  if (ret <= 0) /* error or timeout; the latter should not happen, but pass it on as "EOF" */
    return ret;

  ssize_t s;
  do
    s = recvmsg (socket_fd, &msg, 0);
  while (s == -1 && errno == EINTR);

  if (s == 1)
    {
      if (msg.msg_controllen &&
          cmsg->cmsg_level == SOL_SOCKET &&
          cmsg->cmsg_type == SCM_RIGHTS)
        {
          /* We originally set .msg_controllen to exactly the space
           * required to receive a single fd, so if we received any
           * SCM_RIGHTS messages, then it must surely only be a single
           * fd.
           */
          assert (cmsg->cmsg_len == CMSG_LEN (sizeof *out_fd));
          memcpy (out_fd, CMSG_DATA(cmsg), sizeof *out_fd);
        }
      else
        *out_fd = -1;
    }

  return s;
}
