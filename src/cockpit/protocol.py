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

from .jsonutil import JsonError, JsonObject, JsonValue, create_object, get_int, get_str, get_str_or_none, typechecked

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
    attrs: JsonObject

    def __init__(self, problem: str, _msg: 'JsonObject | None' = None, **kwargs: JsonValue) -> None:
        kwargs['problem'] = problem
        self.attrs = create_object(_msg, kwargs)
        super().__init__(get_str(self.attrs, 'message', problem))


class CockpitProtocolError(CockpitProblem):
    def __init__(self, message: str, problem: str = 'protocol-error'):
        super().__init__(problem, message=message)


class CockpitProtocol(asyncio.Protocol):
    """A naive implementation of the Cockpit frame protocol

    We need to use this because Python's SelectorEventLoop doesn't supported
    buffered protocols.
    """
    transport: 'asyncio.Transport | None' = None
    buffer = b''
    _closed: bool = False
    _communication_done: 'asyncio.Future[None] | None' = None

    def do_ready(self) -> None:
        pass

    def do_closed(self, exc: 'Exception | None') -> None:
        pass

    def transport_control_received(self, command: str, message: JsonObject) -> None:
        raise NotImplementedError

    def channel_control_received(self, channel: str, command: str, message: JsonObject) -> None:
        raise NotImplementedError

    def channel_data_received(self, channel: str, data: bytes) -> None:
        raise NotImplementedError

    def frame_received(self, frame: bytes) -> None:
        header, _, data = frame.partition(b'\n')

        if header != b'':
            channel = header.decode('ascii')
            logger.debug('data received: %d bytes of data for channel %s', len(data), channel)
            self.channel_data_received(channel, data)

        else:
            self.control_received(data)

    def control_received(self, data: bytes) -> None:
        try:
            message = typechecked(json.loads(data), dict)
            command = get_str(message, 'command')
            channel = get_str(message, 'channel', None)

            if channel is not None:
                logger.debug('channel control received %s', message)
                self.channel_control_received(channel, command, message)
            else:
                logger.debug('transport control received %s', message)
                self.transport_control_received(command, message)

        except (json.JSONDecodeError, JsonError) as exc:
            raise CockpitProtocolError(f'control message: {exc!s}') from exc

    def consume_one_frame(self, data: bytes) -> int:
        """Consumes a single frame from view.

        Returns positive if a number of bytes were consumed, or negative if no
        work can be done because of a given number of bytes missing.
        """

        try:
            newline = data.index(b'\n')
        except ValueError as exc:
            if len(data) < 10:
                # Let's try reading more
                return len(data) - 10
            raise CockpitProtocolError("size line is too long") from exc

        try:
            length = int(data[:newline])
        except ValueError as exc:
            raise CockpitProtocolError("frame size is not an integer") from exc

        start = newline + 1
        end = start + length

        if end > len(data):
            # We need to read more
            return len(data) - end

        # We can consume a full frame
        self.frame_received(data[start:end])
        return end

    def connection_made(self, transport: asyncio.BaseTransport) -> None:
        logger.debug('connection_made(%s)', transport)
        assert isinstance(transport, asyncio.Transport)
        self.transport = transport
        self.do_ready()

        if self._closed:
            logger.debug('  but the protocol already was closed, so closing transport')
            transport.close()

    def connection_lost(self, exc: 'Exception | None') -> None:
        logger.debug('connection_lost')
        assert self.transport is not None
        self.transport = None
        self.close(exc)

    def close(self, exc: 'Exception | None' = None) -> None:
        if self._closed:
            return
        self._closed = True

        if self.transport:
            self.transport.close()

        self.do_closed(exc)

    def write_channel_data(self, channel: str, payload: bytes) -> None:
        """Send a given payload (bytes) on channel (string)"""
        # Channel is certainly ascii (as enforced by .encode() below)
        frame_length = len(channel + '\n') + len(payload)
        header = f'{frame_length}\n{channel}\n'.encode('ascii')
        if self.transport is not None:
            logger.debug('writing to transport %s', self.transport)
            self.transport.write(header + payload)
        else:
            logger.debug('cannot write to closed transport')

    def write_control(self, _msg: 'JsonObject | None' = None, **kwargs: JsonValue) -> None:
        """Write a control message.  See jsonutil.create_object() for details."""
        logger.debug('sending control message %r %r', _msg, kwargs)
        pretty = json.dumps(create_object(_msg, kwargs), indent=2) + '\n'
        self.write_channel_data('', pretty.encode())

    def data_received(self, data: bytes) -> None:
        try:
            self.buffer += data
            while self.buffer:
                result = self.consume_one_frame(self.buffer)
                if result <= 0:
                    return
                self.buffer = self.buffer[result:]
        except CockpitProtocolError as exc:
            self.close(exc)

    def eof_received(self) -> bool:
        return False


# Helpful functionality for "server"-side protocol implementations
class CockpitProtocolServer(CockpitProtocol):
    init_host: 'str | None' = None
    authorizations: 'dict[str, asyncio.Future[str]] | None' = None

    def do_send_init(self) -> None:
        raise NotImplementedError

    def do_init(self, message: JsonObject) -> None:
        pass

    def do_kill(self, host: 'str | None', group: 'str | None', message: JsonObject) -> None:
        raise NotImplementedError

    def transport_control_received(self, command: str, message: JsonObject) -> None:
        if command == 'init':
            if get_int(message, 'version') != 1:
                raise CockpitProtocolError('incorrect version number')
            self.init_host = get_str(message, 'host')
            self.do_init(message)
        elif command == 'kill':
            self.do_kill(get_str_or_none(message, 'host', None), get_str_or_none(message, 'group', None), message)
        elif command == 'authorize':
            self.do_authorize(message)
        else:
            raise CockpitProtocolError(f'unexpected control message {command} received')

    def do_ready(self) -> None:
        self.do_send_init()

    # authorize request/response API
    async def request_authorization(
        self, challenge: str, timeout: 'int | None' = None, **kwargs: JsonValue
    ) -> str:
        if self.authorizations is None:
            self.authorizations = {}
        cookie = str(uuid.uuid4())
        future = asyncio.get_running_loop().create_future()
        try:
            self.authorizations[cookie] = future
            self.write_control(None, command='authorize', challenge=challenge, cookie=cookie, **kwargs)
            return await asyncio.wait_for(future, timeout)
        finally:
            self.authorizations.pop(cookie)

    def do_authorize(self, message: JsonObject) -> None:
        cookie = get_str(message, 'cookie')
        response = get_str(message, 'response')

        if self.authorizations is None or cookie not in self.authorizations:
            logger.warning('no matching authorize request')
            return

        self.authorizations[cookie].set_result(response)
