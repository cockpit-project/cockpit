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
import contextlib
import errno
import os
import signal
import subprocess
import unittest
import unittest.mock

from typing import Any, List, Optional, Tuple

import cockpit.transports


class Protocol(cockpit.transports.SubprocessProtocol):
    transport: Optional[asyncio.Transport] = None
    paused: bool = False
    sent: int = 0
    received: int = 0
    exited: bool = False
    close_on_eof: bool = True
    eof: bool = False
    exc: Optional[Exception] = None
    output: Optional[List[bytes]] = None

    def connection_made(self, transport: asyncio.BaseTransport) -> None:
        assert isinstance(transport, asyncio.Transport)
        self.transport = transport

    def connection_lost(self, exc: Optional[Exception] = None) -> None:
        self.transport = None
        self.exc = exc

    def data_received(self, data: bytes) -> None:
        if self.output is not None:
            self.output.append(data)
        self.received += len(data)

    def eof_received(self) -> bool:
        self.eof = True
        return not self.close_on_eof

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

    def process_exited(self) -> None:
        self.exited = True

    def get_output(self) -> bytes:
        assert self.output is not None
        return b''.join(self.output)

    async def eof_and_exited_with_code(self, returncode) -> None:
        self.close_on_eof = False  # otherwise we won't get process_exited()
        transport = self.transport
        assert isinstance(transport, cockpit.transports.SubprocessTransport)
        while not self.exited or not self.eof:
            await asyncio.sleep(0.1)
        assert transport.get_returncode() == returncode


class TestSpooler(unittest.IsolatedAsyncioTestCase):
    async def test_bad_fd(self) -> None:
        # Make sure failing to construct succeeds without further failures
        loop = asyncio.get_running_loop()
        try:
            cockpit.transports.Spooler(loop, -1)
        except OSError as exc:
            assert exc.errno == errno.EBADF

    def create_spooler(self, to_write: bytes = b'') -> cockpit.transports.Spooler:
        loop = asyncio.get_running_loop()
        reader, writer = os.pipe()
        try:
            spooler = cockpit.transports.Spooler(loop, reader)
        finally:
            os.close(reader)
        try:
            os.write(writer, to_write)
        finally:
            os.close(writer)
        return spooler

    async def test_poll_eof(self) -> None:
        spooler = self.create_spooler()
        while not spooler.is_closed():
            await asyncio.sleep(0.1)
        assert spooler.get() == b''

    async def test_nopoll_eof(self) -> None:
        spooler = self.create_spooler()
        assert spooler.get() == b''
        assert spooler.is_closed()

    async def test_poll_small(self) -> None:
        spooler = self.create_spooler(b'abcd')
        while not spooler.is_closed():
            await asyncio.sleep(0.1)
        assert spooler.get() == b'abcd'

    async def test_nopoll_small(self) -> None:
        spooler = self.create_spooler(b'abcd')
        assert spooler.get() == b'abcd'
        assert spooler.is_closed()

    async def test_big(self) -> None:
        loop = asyncio.get_running_loop()
        reader, writer = os.pipe()
        try:
            spooler = cockpit.transports.Spooler(loop, reader)
        finally:
            os.close(reader)

        try:
            os.set_blocking(writer, False)
            written = 0
            blob = b'a' * 64 * 1024  # NB: pipe buffer is 64k
            while written < 1024 * 1024:
                # Note: we should never get BlockingIOError here since we always
                # give the reader a chance to drain the pipe.
                written += os.write(writer, blob)
                while len(spooler.get()) < written:
                    await asyncio.sleep(0.01)

            assert not spooler.is_closed()
        finally:
            os.close(writer)

        await asyncio.sleep(0.1)
        assert spooler.is_closed()

        assert len(spooler.get()) == written


class TestEpollLimitations(unittest.IsolatedAsyncioTestCase):
    # https://github.com/python/cpython/issues/73903
    #
    # There are some types of files that epoll doesn't work with, returning
    # EPERM.  We might be in a situation where we receive one of those on
    # stdin/stdout for AsyncioTransport, so we'd theoretically like to support
    # them.
    async def spool_file(self, filename: str) -> None:
        loop = asyncio.get_running_loop()
        with open(filename) as fp:
            spooler = cockpit.transports.Spooler(loop, fp.fileno())
        while not spooler.is_closed():
            await asyncio.sleep(0.1)

    @unittest.expectedFailure
    async def test_read_file(self) -> None:
        await self.spool_file(__file__)

    @unittest.expectedFailure
    async def test_dev_null(self) -> None:
        await self.spool_file('/dev/null')


class TestStdio(unittest.IsolatedAsyncioTestCase):
    @contextlib.contextmanager
    def create_terminal(self):
        ours, theirs = os.openpty()
        stdin = os.dup(theirs)
        stdout = os.dup(theirs)
        os.close(theirs)
        loop = asyncio.get_running_loop()
        protocol = Protocol()
        yield ours, protocol, cockpit.transports.StdioTransport(loop, protocol, stdin=stdin, stdout=stdout)
        os.close(stdin)
        os.close(stdout)

    async def test_terminal_write_eof(self):
        # Make sure write_eof() fails
        with self.create_terminal() as (ours, protocol, transport):
            assert not transport.can_write_eof()
            with self.assertRaises(RuntimeError):
                transport.write_eof()
            os.close(ours)

    async def test_terminal_disconnect(self):
        # Make sure disconnecting the session shows up as an EOF
        with self.create_terminal() as (ours, protocol, transport):
            os.close(ours)
            while not protocol.eof:
                await asyncio.sleep(0.1)


class TestSubprocessTransport(unittest.IsolatedAsyncioTestCase):
    def subprocess(self, args, **kwargs: Any) -> Tuple[Protocol, cockpit.transports.SubprocessTransport]:
        loop = asyncio.get_running_loop()
        protocol = Protocol()
        transport = cockpit.transports.SubprocessTransport(loop, protocol, args, **kwargs)
        assert transport._protocol == protocol
        assert protocol.transport == transport
        return protocol, transport

    async def test_true(self) -> None:
        protocol, transport = self.subprocess(['true'])
        await protocol.eof_and_exited_with_code(0)
        assert transport.get_stderr() is None

    async def test_cat(self) -> None:
        protocol, transport = self.subprocess(['cat'])
        protocol.close_on_eof = False
        protocol.write_a_lot()
        assert transport.can_write_eof()
        transport.write_eof()
        await protocol.eof_and_exited_with_code(0)
        assert protocol.transport is not None  # should not have automatically closed
        assert transport.get_returncode() == 0
        assert protocol.sent == protocol.received
        transport.close()
        assert protocol.transport is None

    async def test_send_signal(self) -> None:
        protocol, transport = self.subprocess(['cat'])
        transport.send_signal(signal.SIGINT)
        await protocol.eof_and_exited_with_code(-signal.SIGINT)

    async def test_pid(self) -> None:
        protocol, transport = self.subprocess(['sh', '-c', 'echo $$'])
        protocol.output = []
        await protocol.eof_and_exited_with_code(0)
        assert int(protocol.get_output()) == transport.get_pid()

    async def test_terminate(self) -> None:
        protocol, transport = self.subprocess(['cat'])
        transport.kill()
        await protocol.eof_and_exited_with_code(-signal.SIGKILL)

        protocol, transport = self.subprocess(['cat'])
        transport.terminate()
        await protocol.eof_and_exited_with_code(-signal.SIGTERM)

    async def test_stderr(self) -> None:
        loop = asyncio.get_running_loop()
        protocol = Protocol()
        transport = cockpit.transports.SubprocessTransport(loop, protocol, ['cat', '/nonexistent'],
                                                           stderr=subprocess.PIPE)
        await protocol.eof_and_exited_with_code(1)
        assert protocol.received == protocol.sent == 0
        # Unless we reset it, we should get the same result repeatedly
        assert '/nonexistent' in transport.get_stderr()
        assert '/nonexistent' in transport.get_stderr()
        assert '/nonexistent' in transport.get_stderr(reset=True)
        # After we reset, it should be the empty string
        assert transport.get_stderr() == ''
        assert transport.get_stderr(reset=True) == ''

    async def test_safe_watcher_ENOSYS(self) -> None:
        with unittest.mock.patch('asyncio.PidfdChildWatcher', unittest.mock.Mock(side_effect=OSError)):
            protocol, transport = self.subprocess(['true'])
            watcher = transport._get_watcher(asyncio.get_running_loop())
            assert isinstance(watcher, asyncio.SafeChildWatcher)
            await protocol.eof_and_exited_with_code(0)
        assert isinstance(asyncio.PidfdChildWatcher, type)

    async def test_safe_watcher_oldpy(self) -> None:
        with unittest.mock.patch('asyncio.PidfdChildWatcher'):
            del asyncio.PidfdChildWatcher
            protocol, transport = self.subprocess(['true'])
            watcher = transport._get_watcher(asyncio.get_running_loop())
            assert isinstance(watcher, asyncio.SafeChildWatcher)
            await protocol.eof_and_exited_with_code(0)
        assert isinstance(asyncio.PidfdChildWatcher, type)

    async def test_true_pty(self) -> None:
        loop = asyncio.get_running_loop()
        protocol = Protocol()
        transport = cockpit.transports.SubprocessTransport(loop, protocol, ['true'], pty=True)
        assert not transport.can_write_eof()
        await protocol.eof_and_exited_with_code(0)
        assert protocol.received == protocol.sent == 0

    async def test_broken_pipe(self) -> None:
        loop = asyncio.get_running_loop()
        protocol = Protocol()
        transport = cockpit.transports.SubprocessTransport(loop, protocol, ['true'])
        protocol.close_on_eof = False
        while not protocol.exited:
            await asyncio.sleep(0.1)

        assert protocol.transport is transport  # should not close on EOF

        # Now let's write to the stdin with the other side closed.
        # This should be enough to immediately disconnect us (EPIPE)
        protocol.write(b'abc')
        assert protocol.transport is None
        assert isinstance(protocol.exc, BrokenPipeError)

    async def test_broken_pipe_backlog(self) -> None:
        loop = asyncio.get_running_loop()
        protocol = Protocol()
        transport = cockpit.transports.SubprocessTransport(loop, protocol, ['cat'])
        protocol.close_on_eof = False

        # Since we're not reading, cat's stdout will back up and it will be
        # forced to stop reading at some point.  We'll still have a rather full
        # write buffer.
        protocol.write_a_lot()

        # This will result in the stdin closing.  Our next attempt to write to
        # the buffer should end badly (EPIPE).
        transport.kill()

        while protocol.transport:
            await asyncio.sleep(0.1)

        assert protocol.transport is None
        assert isinstance(protocol.exc, BrokenPipeError)

    async def test_window_size(self) -> None:
        protocol, transport = self.subprocess(['bash', '-ic',
                                               '''
                                                   while true; do
                                                       sleep 0.1
                                                       echo ${LINES}x${COLUMNS}
                                                   done
                                               '''],
                                              pty=True,
                                              window={"rows": 22, "cols": 33})
        protocol.output = []
        while b'22x33\r\n' not in protocol.get_output():
            await asyncio.sleep(0.1)

        transport.set_window_size(44, 55)
        while b'44x55\r\n' not in protocol.get_output():
            await asyncio.sleep(0.1)

    async def test_env(self) -> None:
        protocol, transport = self.subprocess(['bash', '-ic', 'echo $HOME'],
                                              pty=True,
                                              env={'HOME': '/test'})
        protocol.output = []
        while b'/test\r\n' not in protocol.get_output():
            await asyncio.sleep(0.1)
