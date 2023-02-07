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

import asyncio
import json
import logging

from typing import Dict, Optional


logger = logging.getLogger(__name__)


class CockpitProtocolError(Exception):
    def __init__(self, message, problem='protocol-error'):
        super().__init__(message)
        self.problem = problem


class CockpitProtocol(asyncio.Protocol):
    """A naive implementation of the Cockpit frame protocol

    We need to use this because Python's SelectorEventLoop doesn't supported
    buffered protocols.
    """
    transport: Optional[asyncio.Transport] = None
    buffer = b''
    _communication_done: Optional[asyncio.Future] = None

    def do_ready(self) -> None:
        raise NotImplementedError

    def do_closed(self, transport_was: asyncio.Transport, exc: Optional[Exception]) -> None:
        pass

    def transport_control_received(self, command: str, message: Dict[str, object]) -> None:
        raise NotImplementedError

    def channel_control_received(self, channel: str, command: str, message: Dict[str, object]) -> None:
        raise NotImplementedError

    def channel_data_received(self, channel: str, data: bytes) -> None:
        raise NotImplementedError

    def frame_received(self, frame):
        channel, _, data = frame.partition(b'\n')
        channel = channel.decode('ascii')

        if channel != '':
            logger.debug('data received: %d bytes of data for channel %s', len(data), channel)
            self.channel_data_received(channel, data)
        else:
            message = json.loads(data)
            try:
                command = message['command']
            except KeyError as exc:
                raise CockpitProtocolError('control message is missing command field') from exc

            channel = message.get('channel')
            if channel is not None:
                logger.debug('channel control received %s', message)
                self.channel_control_received(channel, command, message)
            else:
                logger.debug('transport control received %s', message)
                self.transport_control_received(command, message)

    def consume_one_frame(self, view):
        """Consumes a single frame from view.

        Returns positive if a number of bytes were consumed, or negative if no
        work can be done because of a given number of bytes missing.
        """

        # Nothing to look at?  Save ourselves the trouble...
        if not view:
            return 0

        view = bytes(view)
        # We know the length + newline is never more than 10 bytes, so just
        # slice that out and deal with it directly.  We don't have .index() on
        # a memoryview, for example.
        # From a performance standpoint, hitting the exception case is going to
        # be very rare: we're going to receive more than the first few bytes of
        # the packet in the regular case.  The more likely situation is where
        # we get "unlucky" and end up splitting the header between two read()s.
        header = bytes(view[:10])
        try:
            newline = header.index(b'\n')
        except ValueError as exc:
            if len(header) < 10:
                # Let's try reading more
                return len(header) - 10
            raise ValueError("size line is too long") from exc
        length = int(header[:newline])
        start = newline + 1
        end = start + length

        if end > len(view):
            # We need to read more
            return len(view) - end

        # We can consume a full frame
        self.frame_received(view[start:end])
        return end

    def connection_made(self, transport):
        logger.debug('connection_made(%s)', transport)
        self.transport = transport
        self.do_ready()

    def connection_lost(self, exc):
        logger.debug('connection_lost')
        assert self.transport is not None
        transport_was = self.transport
        self.transport = None
        self.do_closed(transport_was, exc)

        if self._communication_done is not None:
            if exc is None:
                self._communication_done.set_result(None)
            else:
                self._communication_done.set_exception(exc)

    def write_frame(self, frame):
        frame_length = len(frame)
        header = f'{frame_length}\n'.encode('ascii')
        if self.transport is not None:
            self.transport.write(header + frame)

    def write_channel_data(self, channel, payload):
        """Send a given payload (bytes) on channel (string)"""
        # Channel is certainly ascii (as enforced by .encode() below)
        frame_length = len(channel + '\n') + len(payload)
        header = f'{frame_length}\n{channel}\n'.encode('ascii')
        if self.transport is not None:
            logger.debug('writing to transport %s', self.transport)
            self.transport.write(header + payload)
        else:
            logger.debug('cannot write to closed transport')

    def write_message(self, _channel, **kwargs):
        """Format kwargs as a JSON blob and send as a message
           Any kwargs with '_' in their names will be converted to '-'
        """
        for name in list(kwargs):
            if '_' in name:
                kwargs[name.replace('_', '-')] = kwargs[name]
                del kwargs[name]

        logger.debug('sending message %s %s', _channel, kwargs)
        pretty = json.dumps(kwargs, indent=2) + '\n'
        self.write_channel_data(_channel, pretty.encode('utf-8'))

    def write_control(self, **kwargs):
        self.write_message('', **kwargs)

    def data_received(self, data):
        try:
            self.buffer += data
            while True:
                result = self.consume_one_frame(self.buffer)
                if result <= 0:
                    return
                self.buffer = self.buffer[result:]
        except CockpitProtocolError as exc:
            self.write_control(command="close", problem=exc.problem, exception=str(exc))
            self.transport.close()

    def eof_received(self):
        self.write_control(command='close')

    async def communicate(self) -> None:
        """Wait until communication is complete on this protocol."""
        assert self._communication_done is None
        self._communication_done = asyncio.get_running_loop().create_future()
        await self._communication_done
        self._communication_done = None


# All CockpitProtocol subclasses should derive from either
# CockpitProtocolClient or CockpitProtocolServer.  The main difference here is
# that the server should send its init message immediately upon the connection
# being established, whereas the client shouldn't do anything until it sees the
# init message from the server.
#
# Both clients and servers need to implement `do_channel_control()` and
# `do_channel_data()` as well as `do_init()`.
class CockpitProtocolClient(CockpitProtocol):
    def do_init(self, message):
        raise NotImplementedError

    def do_authorize(self, message):
        raise NotImplementedError

    def transport_control_received(self, command, message):
        if command == 'init':
            self.do_init(message)
        elif command == 'authorize':
            self.do_authorize(message)
        elif command == 'send-stderr':
            self.do_send_stderr(self.transport)
        else:
            raise CockpitProtocolError(f'unexpected control message {command} received')

    def do_ready(self):
        pass


class CockpitProtocolServer(CockpitProtocol):
    init_host: Optional[str] = None

    def do_send_init(self):
        raise NotImplementedError

    def do_init(self, message):
        pass

    def do_kill(self, host: Optional[str], group: Optional[str]) -> None:
        raise NotImplementedError

    def do_authorize(self, message: Dict[str, object]) -> None:
        raise NotImplementedError

    def do_send_stderr(self, transport: asyncio.Transport) -> None:
        raise NotImplementedError

    def transport_control_received(self, command, message):
        if command == 'init':
            try:
                if int(message['version']) != 1:
                    raise CockpitProtocolError('incorrect version number', 'protocol-error')
            except KeyError as exc:
                raise CockpitProtocolError('version field is missing', 'protocol-error') from exc
            except ValueError as exc:
                raise CockpitProtocolError('version field is not an int', 'protocol-error') from exc

            try:
                self.init_host = message['host']
            except KeyError as exc:
                raise CockpitProtocolError('missing host field', 'protocol-error') from exc
            self.do_init(message)
        elif command == 'kill':
            self.do_kill(message.get('host'), message.get('group'))
        elif command == 'authorize':
            self.do_authorize(message)
        else:
            raise CockpitProtocolError(f'unexpected control message {command} received')

    def do_ready(self):
        self.do_send_init()
