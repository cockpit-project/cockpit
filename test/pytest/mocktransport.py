import asyncio
import json
import os
import subprocess
from typing import Any, Dict, Iterable, Optional, Tuple

import pytest

from cockpit.router import Router

MOCK_HOSTNAME = 'mockbox'


def my_subprocesses():
    try:
        return subprocess.check_output(['pgrep', '-a', '-P', f'{os.getpid()}'], text=True).splitlines()
    except subprocess.CalledProcessError:
        # no processes found?  good!
        return []


def assert_no_subprocesses():
    running = my_subprocesses()
    if not running:
        return

    print('Some subprocesses still running', running)
    # Clear it out for the sake of the other tests
    subprocess.call(['pkill', '-9', '-P', f'{os.getpid()}'])
    for _ in range(100):  # zombie vacuum
        os.waitpid(-1, os.WNOHANG)  # will eventually throw, failing the test (which we want)
    pytest.fail('failed to reap all children')


def assert_no_tasks(allow_tasks=0):
    if len(asyncio.all_tasks()) > allow_tasks:
        assert asyncio.all_tasks() == []


def assert_all_exited(allow_tasks=0):
    assert_no_subprocesses()
    assert_no_tasks(allow_tasks)


async def settle_down():
    # Let things settle for a bit
    for _ in range(100):
        # We expect at least one task: ourselves!
        if len(asyncio.all_tasks()) <= 1 and not my_subprocesses():
            break
        await asyncio.sleep(0.05)
    else:
        assert_all_exited(allow_tasks=1)


class MockTransport(asyncio.Transport):
    queue: 'asyncio.Queue[Tuple[str, bytes]]'
    next_id: int = 0
    close_future: Optional[asyncio.Future] = None

    def send_json(self, _channel: str, **kwargs) -> None:
        msg = {k.replace('_', '-'): v for k, v in kwargs.items()}
        self.send_data(_channel, json.dumps(msg).encode('ascii'))

    def send_data(self, channel: str, data: bytes) -> None:
        msg = channel.encode('ascii') + b'\n' + data
        msg = str(len(msg)).encode('ascii') + b'\n' + msg
        self.protocol.data_received(msg)

    def send_init(self, version=1, host=MOCK_HOSTNAME, **kwargs):
        self.send_json('', command='init', version=version, host=host, **kwargs)

    def get_id(self, prefix: str) -> str:
        self.next_id += 1
        return f'{prefix}.{self.next_id}'

    def send_open(self, payload, channel=None, **kwargs):
        if channel is None:
            channel = self.get_id('channel')
        self.send_json('', command='open', channel=channel, payload=payload, **kwargs)
        return channel

    async def check_open(
        self,
        payload,
        channel=None,
        problem=None,
        reply_keys: Optional[Dict[str, object]] = None,
        **kwargs,
    ):
        assert isinstance(self.protocol, Router)
        ch = self.send_open(payload, channel, **kwargs)
        if problem is None:
            await self.assert_msg('', command='ready', channel=ch, **(reply_keys or {}))
            assert ch in self.protocol.open_channels
        else:
            await self.assert_msg('', command='close', channel=ch, problem=problem, **(reply_keys or {}))
            assert ch not in self.protocol.open_channels
        return ch

    def send_done(self, channel, **kwargs):
        self.send_json('', command='done', channel=channel, **kwargs)

    def send_close(self, channel, **kwargs):
        self.send_json('', command='close', channel=channel, **kwargs)

    async def check_close(self, channel, **kwargs):
        self.send_close(channel, **kwargs)
        await self.assert_msg('', command='close', channel=channel)

    def send_ping(self, **kwargs):
        self.send_json('', command='ping', **kwargs)

    def __init__(self, protocol: asyncio.Protocol):
        self.queue = asyncio.Queue()
        self.protocol = protocol
        protocol.connection_made(self)

    def write(self, data: bytes) -> None:
        # We know that the bridge only ever writes full frames at once, so we
        # can disassemble them immediately.
        _, channel, data = data.split(b'\n', 2)
        self.queue.put_nowait((channel.decode('ascii'), data))

    async def stop(self) -> None:
        keep_open = self.protocol.eof_received()
        if keep_open:
            self.close_future = asyncio.get_running_loop().create_future()
            try:
                await self.close_future
            finally:
                self.close_future = None

        await settle_down()

    def close(self) -> None:
        if self.close_future is not None:
            self.close_future.set_result(None)

        if self.protocol is not None:
            self.protocol.connection_lost(None)

    async def next_frame(self) -> Tuple[str, bytes]:
        return await self.queue.get()

    async def next_msg(self, expected_channel) -> Dict[str, Any]:
        channel, data = await self.next_frame()
        assert channel == expected_channel, data
        return json.loads(data)

    async def assert_data(self, expected_channel: str, expected_data: bytes) -> None:
        channel, data = await self.next_frame()
        assert channel == expected_channel
        assert data == expected_data

    async def assert_msg(self, expected_channel, **kwargs) -> Dict[str, object]:
        msg = await self.next_msg(expected_channel)
        assert msg == msg | {k.replace('_', '-'): v for k, v in kwargs.items()}, msg
        return msg

    # D-Bus helpers
    internal_bus: str = ''

    async def ensure_internal_bus(self):
        if not self.internal_bus:
            self.internal_bus = await self.check_open('dbus-json3', bus='internal')
        assert self.protocol.open_channels[self.internal_bus].bus == self.protocol.internal_bus.client
        return self.internal_bus

    def send_bus_call(self, bus: str, path: str, iface: str, name: str, args: list) -> str:
        tag = self.get_id('call')
        self.send_json(bus, call=[path, iface, name, args], id=tag)
        return tag

    async def assert_bus_reply(
        self,
        tag: str,
        expected_reply: Optional[list] = None,
        bus: Optional[str] = None,
    ) -> list:
        if bus is None:
            bus = await self.ensure_internal_bus()
        reply = await self.next_msg(bus)
        assert 'id' in reply, reply
        assert reply['id'] == tag, reply
        assert 'reply' in reply, reply
        if expected_reply is not None:
            assert reply['reply'] == [expected_reply]
        return reply['reply'][0]

    async def assert_bus_error(self, tag: str, code: str, message: str, bus: Optional[str] = None) -> None:
        if bus is None:
            bus = await self.ensure_internal_bus()
        reply = await self.next_msg(bus)
        assert 'id' in reply, reply
        assert reply['id'] == tag, reply
        assert 'error' in reply, reply
        assert reply['error'] == [code, [message]], reply['error']

    async def check_bus_call(
        self,
        path: str,
        iface: str,
        name: str,
        args: list,
        expected_reply: Optional[list] = None,
        bus: Optional[str] = None,
    ) -> list:
        if bus is None:
            bus = await self.ensure_internal_bus()
        tag = self.send_bus_call(bus, path, iface, name, args)
        return await self.assert_bus_reply(tag, expected_reply, bus=bus)

    async def assert_bus_props(
        self, path: str, iface: str, expected_values: Dict[str, object], bus: Optional[str] = None
    ) -> None:
        (values,) = await self.check_bus_call(path, 'org.freedesktop.DBus.Properties', 'GetAll', [iface], bus=bus)
        for key, value in expected_values.items():
            assert values[key]['v'] == value

    async def assert_bus_meta(
        self,
        path: str,
        iface: str,
        expected: Iterable[str],
        bus: Optional[str] = None,
    ) -> None:
        if bus is None:
            bus = await self.ensure_internal_bus()
        meta = await self.next_msg(bus)
        assert 'meta' in meta, meta
        assert set(meta['meta'][iface]['properties']) == set(expected)

    async def assert_bus_notify(
        self,
        path: str,
        iface: str,
        expected: Dict[str, object],
        bus: Optional[str] = None,
    ) -> None:
        if bus is None:
            bus = await self.ensure_internal_bus()
        notify = await self.next_msg(bus)
        assert 'notify' in notify
        assert notify['notify'][path][iface] == expected

    async def watch_bus(self, path: str, iface: str, expected: Dict[str, object], bus: Optional[str] = None) -> None:
        if bus is None:
            bus = await self.ensure_internal_bus()
        tag = self.get_id('watch')
        self.send_json(bus, watch={'path': path, 'interface': iface}, id=tag)
        await self.assert_bus_meta(path, iface, expected, bus)
        await self.assert_bus_notify(path, iface, expected, bus)
        await self.assert_msg(bus, id=tag, reply=[])

    async def assert_bus_signal(
        self,
        path: str,
        iface: str,
        name: str,
        args: list,
        bus: Optional[str] = None,
    ) -> None:
        if bus is None:
            bus = await self.ensure_internal_bus()
        signal = await self.next_msg(bus)
        assert 'signal' in signal, signal
        assert signal['signal'] == [path, iface, name, args]

    async def add_bus_match(self, path: str, iface: str, bus: Optional[str] = None) -> None:
        if bus is None:
            bus = await self.ensure_internal_bus()
        self.send_json(bus, add_match={'path': path, 'interface': iface})
