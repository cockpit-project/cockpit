# This file is part of Cockpit.
#
# Copyright (C) 2022 Red Hat, Inc.
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

import os
import socket
import threading


class AsyncStdio:
    BLOCK_SIZE = 1024 * 1024

    def __init__(self, loop):
        self.loop = loop
        self.connection_lost = loop.create_future()
        self.protocol_sock, self.stdio_sock = socket.socketpair()

    def forward_stdin(self):
        while buffer := os.read(0, self.BLOCK_SIZE):
            self.stdio_sock.send(buffer)
        self.stdio_sock.shutdown(socket.SHUT_WR)

    def forward_stdout(self):
        while buffer := self.stdio_sock.recv(self.BLOCK_SIZE):
            os.write(1, buffer)
        # no shutdown here, because the process will exit as a result of this:
        self.loop.call_soon_threadsafe(self.connection_lost.set_result, True)

    async def forward(self):
        # it's not clear how to create daemon threads from inside of the
        # asyncio framework, and the threads get blocked on the blocking read
        # operations and refuse to join on exit, so just do this for ourselves,
        # the old-fashioned way.
        threading.Thread(target=self.forward_stdin, daemon=True).start()
        threading.Thread(target=self.forward_stdout, daemon=True).start()
        await self.connection_lost
