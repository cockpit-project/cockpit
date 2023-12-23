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
from typing import BinaryIO, ClassVar, Dict, Generator, List, Optional, Sequence, Set, Tuple, Type

from .jsonutil import JsonDocument, JsonError, JsonObject, create_object, get_bool, get_str
from .protocol import CockpitProblem
from .router import Endpoint, Router, RoutingRule

logger = logging.getLogger(__name__)


class ChannelRoutingRule(RoutingRule):
    table: Dict[str, List[Type['Channel']]]

    def __init__(self, router: Router, channel_types: List[Type['Channel']]):
        super().__init__(router)
        self.table = {}

        # Sort the channels into buckets by payload type
        for cls in channel_types:
            entry = self.table.setdefault(cls.payload, [])
            entry.append(cls)

        # Within each bucket, sort the channels so those with more
        # restrictions are considered first.
        for entry in self.table.values():
            entry.sort(key=lambda cls: len(cls.restrictions), reverse=True)

    def check_restrictions(self, restrictions: Sequence[Tuple[str, object]], options: JsonObject) -> bool:
        for key, expected_value in restrictions:
            our_value = options.get(key)

            # If the match rule specifies that a value must be present and
            # we don't have it, then fail.
            if our_value is None:
                return False

            # If the match rule specified a specific expected value, and
            # our value doesn't match it, then fail.
            if expected_value is not None and our_value != expected_value:
                return False

        # Everything checked out
        return True

    def apply_rule(self, options: JsonObject) -> Optional['Channel']:
        assert self.router is not None

        payload = options.get('payload')
        if not isinstance(payload, str):
            return None

        for cls in self.table.get(payload, []):
            if self.check_restrictions(cls.restrictions, options):
                return cls(self.router)
        else:
            return None

    def shutdown(self):
        pass  # we don't hold any state


class ChannelError(CockpitProblem):
    pass


class Channel(Endpoint):
    # Values borrowed from C implementation
    BLOCK_SIZE = 16 * 1024
    SEND_WINDOW = 2 * 1024 * 1024

    # Flow control book-keeping
    _send_pings: bool = False
    _out_sequence: int = 0
    _out_window: int = SEND_WINDOW

    # Task management
    _tasks: Set[asyncio.Task]
    _close_args: Optional[JsonObject] = None

    # Must be filled in by the channel implementation
    payload: ClassVar[str]
    restrictions: ClassVar[Sequence[Tuple[str, object]]] = ()

    # These get filled in from .do_open()
    channel = ''
    group = ''

    # input
    def do_control(self, command, message):
        # Break the various different kinds of control messages out into the
        # things that our subclass may be interested in handling.  We drop the
        # 'message' field for handlers that don't need it.
        if command == 'open':
            self._tasks = set()
            self.channel = message['channel']
            if get_bool(message, 'flow-control', default=False):
                self._send_pings = True
            self.group = get_str(message, 'group', 'default')
            self.freeze_endpoint()
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

    def do_channel_control(self, channel: str, command: str, message: JsonObject) -> None:
        # Already closing?  Ignore.
        if self._close_args is not None:
            return

        # Catch errors and turn them into close messages
        try:
            try:
                self.do_control(command, message)
            except JsonError as exc:
                raise ChannelError('protocol-error', message=str(exc)) from exc
        except ChannelError as exc:
            self.close(exc.attrs)

    def do_kill(self, host: Optional[str], group: Optional[str]) -> None:
        # Already closing?  Ignore.
        if self._close_args is not None:
            return

        if host is not None:
            return
        if group is not None and self.group != group:
            return
        self.do_close()

    # At least this one really ought to be implemented...
    def do_open(self, options: JsonObject) -> None:
        raise NotImplementedError

    # ... but many subclasses may reasonably want to ignore some of these.
    def do_ready(self) -> None:
        pass

    def do_done(self) -> None:
        pass

    def do_close(self) -> None:
        self.close()

    def do_options(self, message: JsonObject) -> None:
        raise ChannelError('not-supported', message='This channel does not implement "options"')

    # 'reasonable' default, overridden in other channels for receive-side flow control
    def do_ping(self, message: JsonObject) -> None:
        self.send_pong(message)

    def do_channel_data(self, channel: str, data: bytes) -> None:
        # Already closing?  Ignore.
        if self._close_args is not None:
            return

        # Catch errors and turn them into close messages
        try:
            self.do_data(data)
        except ChannelError as exc:
            self.close(exc.attrs)

    def do_data(self, _data: bytes) -> None:
        # By default, channels can't receive data.
        self.close()

    # output
    def ready(self, **kwargs: JsonDocument) -> None:
        self.thaw_endpoint()
        self.send_control(command='ready', **kwargs)

    def done(self) -> None:
        self.send_control(command='done')

    # tasks and close management
    def is_closing(self) -> bool:
        return self._close_args is not None

    def _close_now(self) -> None:
        self.shutdown_endpoint(self._close_args)

    def _task_done(self, task):
        # Strictly speaking, we should read the result and check for exceptions but:
        #   - exceptions bubbling out of the task are programming errors
        #   - the only thing we'd do with it anyway, is to show it
        #   - Python already does that with its "Task exception was never retrieved" messages
        self._tasks.remove(task)
        if self._close_args is not None and not self._tasks:
            self._close_now()

    def create_task(self, coroutine, name=None):
        """Create a task associated with the channel.

        All tasks must exit before the channel can close.  You may not create
        new tasks after calling .close().
        """
        assert self._close_args is None
        task = asyncio.create_task(coroutine)
        self._tasks.add(task)
        task.add_done_callback(self._task_done)
        return task

    def close(self, close_args: 'JsonObject | None' = None) -> None:
        """Requests the channel to be closed.

        After you call this method, you won't get anymore `.do_*()` calls.

        This will wait for any running tasks to complete before sending the
        close message.
        """
        if self._close_args is not None:
            # close already requested
            return
        self._close_args = close_args or {}
        if not self._tasks:
            self._close_now()

    def send_data(self, data: bytes) -> bool:
        """Send data and handle book-keeping for flow control.

        The flow control is "advisory".  The data is sent immediately, even if
        it's larger than the window.  In general you should try to send packets
        which are approximately Channel.BLOCK_SIZE in size.

        Returns True if there is still room in the window, or False if you
        should stop writing for now.  In that case, `.do_resume_send()` will be
        called later when there is more room.
        """
        self.send_channel_data(self.channel, data)

        if self._send_pings:
            out_sequence = self._out_sequence + len(data)
            if self._out_sequence // Channel.BLOCK_SIZE != out_sequence // Channel.BLOCK_SIZE:
                self.send_control(command='ping', sequence=out_sequence)
            self._out_sequence = out_sequence

        return self._out_sequence < self._out_window

    def do_pong(self, message):
        if not self._send_pings:  # huh?
            logger.warning("Got wild pong on channel %s", self.channel)
            return

        self._out_window = message['sequence'] + Channel.SEND_WINDOW
        if self._out_sequence < self._out_window:
            self.do_resume_send()

    def do_resume_send(self) -> None:
        """Called to indicate that the channel may start sending again."""
        # change to `raise NotImplementedError` after everyone implements it

    json_encoder: ClassVar[json.JSONEncoder] = json.JSONEncoder(indent=2)

    def send_json(self, **kwargs: JsonDocument) -> bool:
        pretty = self.json_encoder.encode(create_object(None, kwargs)) + '\n'
        return self.send_data(pretty.encode())

    def send_control(self, command: str, **kwargs: JsonDocument) -> None:
        self.send_channel_control(self.channel, command, None, **kwargs)

    def send_pong(self, message: JsonObject) -> None:
        self.send_channel_control(self.channel, 'pong', message)


class ProtocolChannel(Channel, asyncio.Protocol):
    """A channel subclass that implements the asyncio Protocol interface.

    In effect, data sent to this channel will be written to the connected
    transport, and vice-versa.  Flow control is supported.

    The default implementation of the .do_open() method calls the
    .create_transport() abstract method.  This method should return a transport
    which will be used for communication on the channel.

    Otherwise, if the subclass implements .do_open() itself, it is responsible
    for setting up the connection and ensuring that .connection_made() is called.
    """
    _transport: Optional[asyncio.Transport]
    _loop: Optional[asyncio.AbstractEventLoop]
    _send_pongs: bool = True
    _last_ping: Optional[JsonObject] = None
    _create_transport_task = None

    # read-side EOF handling
    _close_on_eof: bool = False
    _eof: bool = False

    async def create_transport(self, loop: asyncio.AbstractEventLoop, options: JsonObject) -> asyncio.Transport:
        """Creates the transport for this channel, according to options.

        The event loop for the transport is passed to the function.  The
        protocol for the transport is the channel object, itself (self).

        This needs to be implemented by the subclass.
        """
        raise NotImplementedError

    def do_open(self, options: JsonObject) -> None:
        loop = asyncio.get_running_loop()
        self._create_transport_task = asyncio.create_task(self.create_transport(loop, options))
        self._create_transport_task.add_done_callback(self.create_transport_done)

    def create_transport_done(self, task: 'asyncio.Task[asyncio.Transport]') -> None:
        assert task is self._create_transport_task
        self._create_transport_task = None
        try:
            transport = task.result()
        except ChannelError as exc:
            self.close(exc.attrs)
            return

        self.connection_made(transport)
        self.ready()

    def connection_made(self, transport: asyncio.BaseTransport) -> None:
        assert isinstance(transport, asyncio.Transport)
        self._transport = transport

    def _get_close_args(self) -> JsonObject:
        return {}

    def connection_lost(self, exc: Optional[Exception]) -> None:
        self.close(self._get_close_args())

    def do_data(self, data: bytes) -> None:
        assert self._transport is not None
        self._transport.write(data)

    def do_done(self) -> None:
        assert self._transport is not None
        if self._transport.can_write_eof():
            self._transport.write_eof()

    def do_close(self) -> None:
        if self._transport is not None:
            self._transport.close()

    def data_received(self, data: bytes) -> None:
        assert self._transport is not None
        if not self.send_data(data):
            self._transport.pause_reading()

    def do_resume_send(self) -> None:
        assert self._transport is not None
        self._transport.resume_reading()

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
            assert self._transport is not None
            self._transport.close()

    def eof_received(self) -> bool:
        self._eof = True
        self.done()
        return not self._close_on_eof

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
    """A subclass for async/await-style implementation of channels, with flow control

    This subclass provides asynchronous `read()` and `write()` calls for
    subclasses, with familiar semantics.  `write()` doesn't buffer, so the
    `done()` method on the base channel class can be used in a way similar to
    `shutdown()`.  A high-level `sendfile()` method is available to send the
    entire contents of a binary-mode file-like object.

    The subclass must provide an async `run()` function, which will be spawned
    as a task.

    On the receiving side, the channel will respond to flow control pings to
    indicate that it has received the data, but only after it has been consumed
    by `read()`.

    On the sending side, write() will block if the channel backs up.
    """

    # Receive-side flow control: intermix pings and data in the queue and reply
    # to pings as we dequeue them.  This is a buffer: since we need to handle
    # do_data() without blocking, we have no choice.
    receive_queue = None

    # Send-side flow control
    write_waiter = None

    async def run(self, options):
        raise NotImplementedError

    async def run_wrapper(self, options):
        try:
            await self.run(options)
            self.close()
        except ChannelError as exc:
            self.close(exc.attrs)

    async def read(self):
        while True:
            item = await self.receive_queue.get()
            if isinstance(item, bytes):
                return item
            self.send_pong(item)

    async def write(self, data):
        if not self.send_data(data):
            self.write_waiter = asyncio.get_running_loop().create_future()
            await self.write_waiter

    async def sendfile(self, stream: BinaryIO) -> None:
        loop = asyncio.get_running_loop()
        with stream:
            while True:
                data = await loop.run_in_executor(None, stream.read, Channel.BLOCK_SIZE)
                if data == b'':
                    break
                await self.write(data)

            self.done()

    def do_resume_send(self) -> None:
        if self.write_waiter is not None:
            self.write_waiter.set_result(None)
            self.write_waiter = None

    def do_open(self, options):
        self.receive_queue = asyncio.Queue()
        self.create_task(self.run_wrapper(options), name=f'{self.__class__.__name__}.run_wrapper({options})')

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


class GeneratorChannel(Channel):
    """A trivial Channel subclass for sending data from a generator with flow control.

    Calls the .do_yield_data() generator with the options from the open message
    and sends the data which it yields.  If the generator returns a value it
    will be used for the close message.
    """
    DataGenerator = Generator[bytes, None, Optional[JsonObject]]
    __generator: DataGenerator

    def do_yield_data(self, options: JsonObject) -> 'DataGenerator':
        raise NotImplementedError

    def do_open(self, options: JsonObject) -> None:
        self.__generator = self.do_yield_data(options)
        self.do_resume_send()

    def do_resume_send(self) -> None:
        try:
            while self.send_data(next(self.__generator)):
                pass
        except StopIteration as stop:
            self.done()
            self.close(stop.value)
