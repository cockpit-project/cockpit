# This file is part of Cockpit.
#
# Copyright (C) 2023 Red Hat, Inc.
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.

import contextlib
import socket


def install():
    """Add shims for older Python versions"""

    # introduced in 3.9
    if not hasattr(socket, 'recv_fds'):
        import array

        import _socket

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
                return self

            async def enter_async_context(self, cm):
                result = await cm.__aenter__()
                self.cms.append(cm)
                return result

            async def __aexit__(self, exc_type, exc_value, traceback):
                for cm in self.cms:
                    cm.__aexit__(exc_type, exc_value, traceback)

        contextlib.AsyncExitStack = AsyncExitStack
