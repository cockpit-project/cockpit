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

"""Bi-directional asyncio.Transport implementations based on file descriptors."""

import asyncio
import collections
import logging
import os

from typing import Any, ClassVar, Dict, Optional, Tuple


logger = logging.getLogger(__name__)


class _Transport(asyncio.Transport):
    BLOCK_SIZE: ClassVar[int] = 1024 * 1024

    # A transport always has a loop and a protocol
    _loop: asyncio.AbstractEventLoop
    _protocol: asyncio.BaseProtocol

    _queue: Optional[collections.deque[bytes]]
    _in_fd: int
    _out_fd: int
    _closing: bool
    _is_reading: bool
    _eof: bool

    def __init__(self,
                 loop: asyncio.AbstractEventLoop,
                 protocol: asyncio.BaseProtocol,
                 in_fd: int = -1, out_fd: int = -1,
                 extra: Dict[str, Any] = None):
        super().__init__(extra)

        self._loop = loop
        self._protocol = protocol

        logger.debug('Created transport %s for protocol %s, fds %d %d', self, protocol, in_fd, out_fd)

        self._queue = None
        self._is_reading = False
        self._eof = False
        self._closing = False

        self._in_fd = in_fd
        self._out_fd = out_fd

        self._protocol.connection_made(self)
        self.resume_reading()

    def _read_ready(self):
        logger.debug('Read ready on %s %s %d', self, self._protocol, self._in_fd)
        data = os.read(self._in_fd, _Transport.BLOCK_SIZE)
        if data != b'':
            logger.debug('  read %d bytes', len(data))
            self._protocol.data_received(data)
        else:
            logger.debug('  got EOF')
            self._close_reader()
            keep_open = self._protocol.eof_received()
            if not keep_open:
                self.close()

    def is_reading(self) -> bool:
        return self._is_reading

    def _close_reader(self) -> None:
        self.pause_reading()
        self._in_fd = -1

    def pause_reading(self) -> None:
        if self._is_reading:
            self._loop.remove_reader(self._in_fd)
            self._is_reading = False

    def resume_reading(self) -> None:
        # It's possible that the Protocol could decide to attempt to unpause
        # reading after _close_reader() got called.  Check that the fd is != -1
        # before actually resuming.
        if not self._is_reading and self._in_fd != -1:
            self._loop.add_reader(self._in_fd, self._read_ready)
            self._is_reading = True

    def abort(self) -> None:
        self._close_reader()
        self._remove_write_queue()
        self._protocol.connection_lost(None)

    def can_write_eof(self) -> bool:
        raise NotImplementedError

    def write_eof(self) -> None:
        assert not self._eof
        self._eof = True
        if self._queue is None:
            self._write_eof_now()

    def get_write_buffer_size(self) -> int:
        if self._queue is None:
            return 0
        return sum(len(block) for block in self._queue)

    def get_write_buffer_limits(self) -> Tuple[int, int]:
        return (0, 0)

    def set_write_buffer_limits(self, high: Optional[int] = None, low: Optional[int] = None) -> None:
        assert high is None or high == 0
        assert low is None or low == 0

    def _write_eof_now(self) -> None:
        raise NotImplementedError

    def _write_ready(self):
        assert self._queue is not None
        n_bytes = os.writev(self._queue)

        while n_bytes:
            block = self._queue.popleft()
            if len(block) > n_bytes:
                # This block wasn't completely written.
                self._queue.appendleft(block[n_bytes:])
                break
            n_bytes -= len(block)
        else:
            self._remove_write_queue()
            if self._eof:
                self._write_eof_now()
                self._consider_closing()
            if self._closing:
                self.abort()

    def _remove_write_queue(self) -> None:
        if self._queue is not None:
            self._protocol.resume_writing()
            self._loop.remove_writer(self._out_fd)
            self._queue = None

    def _create_write_queue(self, data: bytes) -> None:
        assert self._queue is None
        self._loop.add_writer(self._out_fd, self._write_ready)
        self._queue = collections.deque((data,))
        self._protocol.pause_writing()

    def write(self, data: bytes) -> None:
        assert not self._closing
        assert not self._eof

        if self._queue is not None:
            self._queue.append(data)
            return

        n_bytes = os.write(self._out_fd, data)
        if n_bytes != len(data):
            self._create_write_queue(data[n_bytes:])

    def close(self) -> None:
        if self._closing:
            return

        self._closing = True
        self._close_reader()

        if self._queue is not None:
            # abort() will be called from _write_ready() when it's done
            return

        self.abort()

    def get_protocol(self) -> asyncio.BaseProtocol:
        return self._protocol

    def is_closing(self) -> bool:
        return self._closing

    def set_protocol(self, protocol: asyncio.BaseProtocol) -> None:
        self._protocol = protocol


class StdioTransport(_Transport):
    """A bi-directional transport that corresponds to stdin/out.

    Can talk to just about anything:
        - files
        - pipes
        - character devices (including terminals)
        - sockets
    """
    def __init__(self, loop: asyncio.AbstractEventLoop, protocol: asyncio.BaseProtocol):
        super().__init__(loop, protocol, 0, 1)

    def can_write_eof(self) -> bool:
        return False

    def _write_eof_now(self) -> None:
        raise RuntimeError("Can't write EOF to stdout")
