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
import uuid
from typing import ClassVar, Dict, Optional

from cockpit._vendor import systemd_ctypes

from .jsonutil import JsonObject

logger = logging.getLogger(__name__)


class CockpitProblem(Exception):
    """A type of exception that carries a problem code and a message.

    Depending on the scope, this is used to handle shutting down:

      - an individual channel (sends problem code in the close message)
      - peer connections (sends problem code in close message for each open channel)
      - the main stdio interaction with the bridge

    It is usually thrown in response to some violation of expected protocol
    when parsing messages, connecting to a peer, or opening a channel.
    """
    def __init__(self, problem: str, **kwargs):
        super().__init__(kwargs.get('message') or problem)
        self.problem = problem
        self.kwargs = kwargs


class CockpitProtocolError(CockpitProblem):
    def __init__(self, message, problem='protocol-error'):
        super().__init__(problem, message=message)


class CockpitProtocol(asyncio.Protocol):
    """A naive implementation of the Cockpit frame protocol

    We need to use this because Python's SelectorEventLoop doesn't supported
    buffered protocols.
    """
    json_encoder: ClassVar[json.JSONEncoder] = systemd_ctypes.JSONEncoder(indent=2)
    transport: Optional[asyncio.Transport] = None
    buffer = b''
    _closed: bool = False
    _communication_done: Optional[asyncio.Future] = None

    def do_ready(self) -> None:
        pass

    def do_closed(self, exc: Optional[Exception]) -> None:
        pass

    def transport_control_received(self, command: str, message: JsonObject) -> None:
        raise NotImplementedError

    def channel_control_received(self, channel: str, command: str, message: JsonObject) -> None:
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
            raise CockpitProtocolError("size line is too long") from exc

        try:
            length = int(header[:newline])
        except ValueError as exc:
            raise CockpitProtocolError("frame size is not an integer") from exc

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

        if self._closed:
            logger.debug('  but the protocol already was closed, so closing transport')
            transport.close()

    def connection_lost(self, exc):
        logger.debug('connection_lost')
        assert self.transport is not None
        self.transport = None
        self.close(exc)

    def close(self, exc: Optional[Exception] = None) -> None:
        if self._closed:
            return
        self._closed = True

        if self.transport:
            self.transport.close()

        self.do_closed(exc)

        if self._communication_done is not None:
            if exc is None:
                self._communication_done.set_result(None)
            else:
                self._communication_done.set_exception(exc)

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
        pretty = CockpitProtocol.json_encoder.encode(kwargs) + '\n'
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
            self.close(exc)

    def eof_received(self) -> Optional[bool]:
        return False

    async def communicate(self) -> None:
        """Wait until communication is complete on this protocol."""
        assert self._communication_done is None
        self._communication_done = asyncio.get_running_loop().create_future()
        await self._communication_done
        self._communication_done = None


# Helpful functionality for "server"-side protocol implementations
class CockpitProtocolServer(CockpitProtocol):
    init_host: Optional[str] = None
    authorizations: Optional[Dict[str, asyncio.Future]] = None

    def do_send_init(self):
        raise NotImplementedError

    def do_init(self, message):
        pass

    def do_kill(self, host: Optional[str], group: Optional[str]) -> None:
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

    # authorize request/response API
    async def request_authorization(self, challenge: str, timeout: Optional[int] = None, **kwargs: object) -> str:
        if self.authorizations is None:
            self.authorizations = {}
        cookie = str(uuid.uuid4())
        future = asyncio.get_running_loop().create_future()
        try:
            self.authorizations[cookie] = future
            self.write_control(command='authorize', challenge=challenge, cookie=cookie, **kwargs)
            return await asyncio.wait_for(future, timeout)
        finally:
            self.authorizations.pop(cookie)

    def do_authorize(self, message: JsonObject) -> None:
        cookie = message.get('cookie')
        response = message.get('response')

        if not isinstance(cookie, str) or not isinstance(response, str):
            raise CockpitProtocolError('invalid authorize response')

        if self.authorizations is None or cookie not in self.authorizations:
            logger.warning('no matching authorize request')
            return

        self.authorizations[cookie].set_result(response)
