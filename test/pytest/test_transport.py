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
# along with this program.  If not, see <http://www.gnu.org/licenses/>.

import asyncio
import socket
import unittest

from typing import Optional

import cockpit.transports


class Protocol(asyncio.Protocol):
    transport: Optional[asyncio.Transport] = None
    paused: bool = False
    sent: int = 0
    received: int = 0

    def connection_made(self, transport: asyncio.BaseTransport) -> None:
        assert isinstance(transport, asyncio.Transport)
        self.transport = transport

    def connection_lost(self, exc: Optional[Exception] = None) -> None:
        self.transport = None

    def data_received(self, data: bytes) -> None:
        self.received += len(data)

    def eof_received(self) -> bool:
        return False

    def pause_writing(self) -> None:
        self.paused = True

    def write_until_backlogged(self) -> None:
        while not self.paused:
            self.write(b'a' * 4096)

    def write(self, data: bytes) -> None:
        assert self.transport is not None
        self.transport.write(data)
        self.sent += len(data)

    def write_a_lot(self) -> None:
        assert self.transport is not None
        self.write_until_backlogged()
        assert self.transport.get_write_buffer_size() != 0
        for _ in range(20):
            self.write(b'b' * 1024 * 1024)
        assert self.transport.get_write_buffer_size() > 20 * 1024 * 1024


class TestSocketTransport(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        one, two = socket.socketpair()

        self.writer = Protocol()
        self.reader = Protocol()

        loop = asyncio.get_running_loop()

        cockpit.transports.SocketTransport(loop, self.writer, one)
        assert isinstance(self.writer.transport, cockpit.transports.SocketTransport)
        assert self.writer.transport.get_protocol() == self.writer

        cockpit.transports.SocketTransport(loop, self.reader, two)
        assert isinstance(self.reader.transport, cockpit.transports.SocketTransport)
        assert self.reader.transport.get_protocol() == self.reader

        assert self.writer.transport.get_write_buffer_limits() == (0, 0)
        self.writer.transport.set_write_buffer_limits(0, 0)
        assert self.writer.transport.get_write_buffer_limits() == (0, 0)

    def tearDown(self) -> None:
        assert self.writer.sent == self.reader.received

    async def read_to_end(self) -> None:
        assert self.reader.transport
        assert self.reader.transport.is_reading()
        while self.reader.transport is not None:
            await asyncio.sleep(0.1)

    async def test_simple_eof(self) -> None:
        self.writer.write(b'abcd')
        assert self.writer.transport
        assert self.writer.transport.get_write_buffer_size() == 0
        assert self.writer.transport.can_write_eof()
        self.writer.transport.write_eof()
        assert not self.writer.transport.is_closing()
        await self.read_to_end()
        assert self.reader.transport is None

    async def test_simple_close(self) -> None:
        self.writer.write(b'abcd')
        assert self.writer.transport
        assert self.writer.transport.get_write_buffer_size() == 0
        # hold a ref on the transport to make sure close() closes the socket
        writer_transport = self.writer.transport
        self.writer.transport.close()
        assert self.writer.transport is None  # make sure it closed immediately
        writer_transport.close()  # should be idempotent
        await self.read_to_end()
        del writer_transport
        assert self.reader.transport is None

    async def test_write_backlog_eof(self) -> None:
        self.writer.write_a_lot()
        assert self.writer.transport
        assert self.writer.transport.can_write_eof()
        self.writer.transport.write_eof()
        assert not self.writer.transport.is_closing()
        await self.read_to_end()
        assert self.reader.transport is None
        assert self.writer.transport is None

    async def test_write_backlog_close(self) -> None:
        self.writer.write_a_lot()
        assert self.writer.transport
        self.writer.transport.close()
        assert self.writer.transport
        assert self.writer.transport.is_closing()
        await self.read_to_end()
        assert self.writer.transport is None
        assert self.reader.transport is None

    async def test_write_backlog_eof_and_close(self) -> None:
        self.writer.write_a_lot()
        assert self.writer.transport
        self.writer.transport.write_eof()
        self.writer.transport.close()
        assert self.writer.transport
        assert self.writer.transport.is_closing()
        await self.read_to_end()
        assert self.reader.transport is None
