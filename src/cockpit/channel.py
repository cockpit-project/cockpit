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

from typing import Any, Dict, Iterable, Optional, Tuple

from .protocol import CockpitProtocol


class Endpoint:
    router: CockpitProtocol

    def __init__(self, router):
        self.router = router

    def do_channel_control(self, command, message):
        raise NotImplementedError

    def do_channel_data(self, channel, data):
        raise NotImplementedError


class ChannelError(Exception):
    def __init__(self, problem, **kwargs):
        super().__init__(f'ChannelError {problem}')
        self.kwargs = dict(kwargs, problem=problem)


class Channel(Endpoint):
    # Values borrowed from C implementation
    CHANNEL_FLOW_PING = 16 * 1024
    CHANNEL_FLOW_WINDOW = 2 * 1024 * 1024

    payload: Optional[str] = None
    restrictions: Iterable[Tuple[str, Optional[object]]] = ()

    @staticmethod
    def create_match_rule(channel):
        assert channel.payload is not None, f'{channel} declares no payload'
        return dict(channel.restrictions, payload=channel.payload)

    @staticmethod
    def create_match_rules(channels):
        rules = [(Channel.create_match_rule(cls), cls) for cls in channels]
        rules.sort(key=lambda rule: len(rule[0]), reverse=True)  # more restrictive rules match first
        return rules

    channel = None

    # input
    def do_control(self, command, message):
        # Break the various different kinds of control messages out into the
        # things that our subclass may be interested in handling.  We drop the
        # 'message' field for handlers that don't need it.
        if command == 'open':
            self.channel = message['channel']
            self.do_open(message)
        elif command == 'ready':
            self.do_ready()
        elif command == 'done':
            self.do_done()
        elif command == 'close':
            self.do_close()
        elif command == 'ping':
            self.do_ping(message)
        elif command == 'pong':
            self.do_pong(message)
        elif command == 'options':
            self.do_options(message)

    def do_channel_control(self, command, message):
        # Catch errors and turn them into close messages
        try:
            self.do_control(command, message)
        except ChannelError as exc:
            self.close(**exc.kwargs)

    # At least this one really ought to be implemented...
    def do_open(self, options):
        raise NotImplementedError

    # ... but many subclasses may reasonably want to ignore some of these.
    def do_ready(self):
        pass

    def do_done(self):
        pass

    def do_close(self):
        pass

    def do_pong(self, message):
        pass

    def do_options(self, message):
        raise ChannelError('not-supported', message='This channel does not implement "options"')

    # 'reasonable' default, overridden in AsyncChannel for flow control
    def do_ping(self, message):
        self.send_pong(message)

    def do_channel_data(self, channel, data):
        # Catch errors and turn them into close messages
        try:
            self.do_data(data)
        except ChannelError as exc:
            self.close(**exc.kwargs)

    def do_data(self, _data):
        # By default, channels can't receive data.
        self.close()

    # output
    def ready(self):
        self.send_control(command='ready')

    def done(self):
        self.send_control(command='done')

    def close(self, **kwargs):
        self.send_control(command='close', **kwargs)

    def send_data(self, message):
        self.router.send_data(self.channel, message)

    def send_message(self, **kwargs):
        self.router.send_message(self.channel, **kwargs)

    def send_control(self, command, **kwargs):
        self.router.send_control(channel=self.channel, command=command, **kwargs)

    def send_pong(self, message):
        message['command'] = 'pong'
        self.router.send_message('', **message)


class ProtocolChannel(Channel, asyncio.Protocol):
    '''A channel subclass that implements the asyncio Protocol interface.

    In effect, data sent to this channel will be written to the connected
    transport, and vice-versa.  Flow control is supported.

    The default implementation of the .do_open() method calls the
    .create_transport() abstract method.  This method should return a transport
    which will be used for communication on the channel.

    Otherwise, if the subclass implements .do_open() itself, it is responsible
    for setting up the connection and ensuring that .connection_made() is called.
    '''
    _transport: Optional[asyncio.Transport]
    _loop: Optional[asyncio.AbstractEventLoop]
    _send_pongs: bool = True
    _last_ping: Optional[Dict[str, Any]]

    _send_pings: bool = False
    _out_sequence: int = 0
    _out_window: int = Channel.CHANNEL_FLOW_WINDOW

    # read-side EOF handling
    _close_on_eof: bool = False
    _eof: bool = False

    def create_transport(self, loop: asyncio.AbstractEventLoop, options: Dict[str, Any]) -> asyncio.Transport:
        """Creates the transport for this channel, according to options.

        The event loop for the transport is passed to the function.  The
        protocol for the transport is the channel object, itself (self).

        This needs to be implemented by the subclass.
        """
        raise NotImplementedError

    def do_open(self, options):
        loop = asyncio.get_running_loop()
        transport = self.create_transport(loop, options)
        self.connection_made(transport)

    def connection_made(self, transport: asyncio.BaseTransport):
        assert isinstance(transport, asyncio.Transport)
        self._transport = transport

    def _close_args(self) -> Dict[str, Any]:
        return {}

    def connection_lost(self, exc: Optional[Exception]) -> None:
        self.close(**self._close_args())

    def do_data(self, data: bytes) -> None:
        assert self._transport is not None
        self._transport.write(data)

    def do_done(self) -> None:
        assert self._transport is not None
        if self._transport.can_write_eof():
            self._transport.write_eof()

    def data_received(self, data: bytes) -> None:
        self.send_data(data)
        self._write_flow_control(len(data))

    def close_on_eof(self) -> None:
        """Mark the channel to be closed on EOF.

        Normally, ProtocolChannel tries to keep the channel half-open after
        receiving EOF from the transport.  This instructs that the channel
        should be closed on EOF.

        If EOF was already received, then calling this function will close the
        channel immediately.

        If you don't call this function, you are responsible for closing the
        channel yourself.
        """
        self._close_on_eof = True
        if self._eof:
            self._transport.close()

    def eof_received(self) -> bool:
        self._eof = True
        self.done()
        return not self._close_on_eof

    # Channel send-side flow control
    def _write_flow_control(self, n_bytes):
        out_sequence = self._out_sequence + n_bytes
        if self._out_sequence // Channel.CHANNEL_FLOW_PING != out_sequence // Channel.CHANNEL_FLOW_PING:
            self.send_control(command='ping', sequence=out_sequence)
        self._out_sequence = out_sequence

        if self._out_window <= self._out_sequence:
            self._transport.pause_reading()

    def do_pong(self, message):
        self._out_window = message['sequence'] + Channel.CHANNEL_FLOW_WINDOW
        if self._out_sequence < self._out_window:
            self._transport.resume_reading()

    # Channel receive-side flow control
    def do_ping(self, message):
        if self._send_pongs:
            self.send_pong(message)
        else:
            # we'll have to pong later
            self._last_ping = message

    def pause_writing(self) -> None:
        # We can't actually stop writing, but we can stop replying to pings
        self._send_pongs = False

    def resume_writing(self) -> None:
        self._send_pongs = True
        if self._last_ping is not None:
            self.send_pong(self._last_ping)
            self._last_ping = None


class AsyncChannel(Channel):
    '''A subclass for async/await-style implementation of channels, with flow control

    This subclass provides asynchronous `read()` and `write()` calls for
    subclasses, with familiar semantics.  `write()` doesn't buffer, so the
    `done()` method on the base channel class can be used in a way similar to
    `shutdown()`.  The subclass must provide a async `run()` function, which
    will be spawned as a task.

    On the receiving side, the channel will respond to flow control pings to
    indicate that it has received the data, but only after it has been consumed
    by `read()`.

    On the sending side, write() will block if the channel backs up.
    '''

    loop = None

    # Receive-side flow control: intermix pings and data in the queue and reply
    # to pings as we dequeue them.  This is a buffer: since we need to handle
    # do_data() without blocking, we have no choice.
    receive_queue = None

    # Send-side flow control: no buffers here, just bookkeeping.
    out_sequence = 0
    out_window = Channel.CHANNEL_FLOW_WINDOW
    write_waiter = None

    async def run(self, options):
        raise NotImplementedError

    async def run_wrapper(self, options):
        try:
            await self.run(options)
            self.close()
        except ChannelError as exc:
            self.close(**exc.kwargs)

    async def read(self):
        while not isinstance(item := await self.receive_queue.get(), bytes):
            self.send_pong(item)
        return item

    async def write(self, data):
        if self.flow_control:
            assert len(data) <= AsyncChannel.CHANNEL_FLOW_WINDOW

            out_sequence = self.out_sequence + len(data)
            if self.out_sequence // Channel.CHANNEL_FLOW_PING != out_sequence // Channel.CHANNEL_FLOW_PING:
                self.send_control(command='ping', sequence=out_sequence)
            self.out_sequence = out_sequence

            while self.out_window < self.out_sequence:
                self.write_waiter = asyncio.get_running_loop().create_future()
                await self.write_waiter

        self.send_data(data)

    def do_pong(self, message):
        self.out_window = message['sequence'] + AsyncChannel.CHANNEL_FLOW_WINDOW
        if self.out_sequence <= self.out_window and self.write_waiter is not None:
            self.write_waiter.set_result(None)
            self.write_waiter = None

    def do_open(self, options):
        self.receive_queue = asyncio.Queue()
        self.flow_control = options.get('flow-control') is True
        asyncio.create_task(self.run_wrapper(options), name='f{self.__class__.__name__}.run_wrapper({options})')

    def do_done(self):
        self.receive_queue.put_nowait(b'')

    def do_close(self):
        # we might have already sent EOF for done, but two EOFs won't hurt anyone
        self.receive_queue.put_nowait(b'')

    def do_ping(self, message):
        self.receive_queue.put_nowait(message)

    def do_data(self, data):
        if not isinstance(data, bytes):
            # this will persist past this callback, so make sure we take our
            # own copy, in case this was a memoryview into a bytearray.
            data = bytes(data)

        self.receive_queue.put_nowait(data)
