#
# Copyright (C) 2023 Red Hat, Inc.
# SPDX-License-Identifier: GPL-3.0-or-later


import contextlib
import socket


def install():
    """Add shims for older Python versions"""

    # introduced in 3.9
    if not hasattr(socket, 'recv_fds'):
        import _socket
        import array

        def recv_fds(sock, bufsize, maxfds, flags=0):
            fds = array.array("i")
            msg, ancdata, flags, addr = sock.recvmsg(bufsize, _socket.CMSG_LEN(maxfds * fds.itemsize))
            for cmsg_level, cmsg_type, cmsg_data in ancdata:
                if (cmsg_level == _socket.SOL_SOCKET and cmsg_type == _socket.SCM_RIGHTS):
                    fds.frombytes(cmsg_data[:len(cmsg_data) - (len(cmsg_data) % fds.itemsize)])
            return msg, list(fds), flags, addr

        socket.recv_fds = recv_fds

    # introduced in 3.7
    if not hasattr(contextlib, 'AsyncExitStack'):
        class AsyncExitStack:
            async def __aenter__(self):
                self.cms = []
                self.async_cms = []
                return self

            async def enter_async_context(self, cm):
                result = await cm.__aenter__()
                self.async_cms.append(cm)
                return result

            def enter_context(self, cm):
                result = cm.__enter__()
                self.cms.append(cm)
                return result

            async def __aexit__(self, exc_type, exc_value, traceback):
                for cm in self.async_cms:
                    cm.__aexit__(exc_type, exc_value, traceback)
                for cm in self.cms:
                    cm.__exit__(exc_type, exc_value, traceback)

        contextlib.AsyncExitStack = AsyncExitStack
