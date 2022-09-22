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


class Endpoint:
    router = None

    def do_channel_control(self, command, message):
        raise NotImplementedError

    def do_channel_data(self, channel, data):
        raise NotImplementedError


class ChannelError(Exception):
    def __init__(self, problem, **kwargs):
        super().__init__(f'ChannelError {problem}')
        self.kwargs = dict(kwargs, problem=problem)


class Channel(Endpoint):
    payload = None
    restrictions = ()

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

    # Values borrowed from C implementation
    CHANNEL_FLOW_PING = 16 * 1024
    CHANNEL_FLOW_WINDOW = 2 * 1024 * 1024

    loop = None

    # Receive-side flow control: intermix pings and data in the queue and reply
    # to pings as we dequeue them.  This is a buffer: since we need to handle
    # do_data() without blocking, we have no choice.
    receive_queue = None

    # Send-side flow control: no buffers here, just bookkeeping.
    out_sequence = 0
    out_window = CHANNEL_FLOW_WINDOW
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
            self.out_sequence += len(data)

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
