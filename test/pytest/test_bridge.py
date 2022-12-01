import argparse
import asyncio
import json
import unittest

from typing import Any, Dict, Iterable, Optional, Tuple

import systemd_ctypes
from cockpit.bridge import Bridge

MOCK_HOSTNAME = 'mockbox'

asyncio.set_event_loop_policy(systemd_ctypes.EventLoopPolicy())


class test_iface(systemd_ctypes.bus.Object):
    sig = systemd_ctypes.bus.Interface.Signal('s')
    prop = systemd_ctypes.bus.Interface.Property('s', value='none')


class MockTransport(asyncio.Transport):
    queue: asyncio.Queue[Tuple[str, bytes]]
    next_id: int = 0

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

    async def check_open(self, payload, channel=None, problem=None, **kwargs):
        ch = self.send_open(payload, channel, **kwargs)
        if problem is None:
            await self.assert_msg('', command='ready', channel=ch)
            assert ch in self.protocol.open_channels
        else:
            await self.assert_msg('', command='close', channel=ch, problem=problem)
            assert ch not in self.protocol.open_channels
        return ch

    def send_done(self, channel, **kwargs):
        self.send_json('', command='done', channel=channel, **kwargs)

    def send_close(self, channel, **kwargs):
        self.send_json('', command='close', channel=channel, **kwargs)

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

    def close(self) -> None:
        pass

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

    async def assert_msg(self, expected_channel, **kwargs) -> None:
        msg = await self.next_msg(expected_channel)
        assert msg == msg | {k.replace('_', '-'): v for k, v in kwargs.items()}

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

    async def assert_bus_reply(self, tag: str, expected_reply: Optional[list] = None, bus: Optional[str] = None) -> list:
        if bus is None:
            bus = await self.ensure_internal_bus()
        reply = await self.next_msg(bus)
        assert 'id' in reply, reply
        assert reply['id'] == tag, reply
        assert 'reply' in reply, reply
        if expected_reply is not None:
            assert reply['reply'] == [expected_reply]
        return reply['reply'][0]

    async def check_bus_call(self, path: str, iface: str, name: str, args: list, expected_reply: Optional[list] = None, bus: Optional[str] = None) -> list:
        if bus is None:
            bus = await self.ensure_internal_bus()
        tag = self.send_bus_call(bus, path, iface, name, args)
        return await self.assert_bus_reply(tag, expected_reply, bus=bus)

    async def assert_bus_props(self, path: str, iface: str, expected_values: Dict[str, object], bus: Optional[str] = None) -> None:
        values, = await self.check_bus_call(path, 'org.freedesktop.DBus.Properties', 'GetAll', [iface], bus=bus)
        for key, value in expected_values.items():
            assert values[key]['v'] == value

    async def assert_bus_meta(self, path: str, iface: str, expected: Iterable[str], bus: Optional[str] = None) -> None:
        if bus is None:
            bus = await self.ensure_internal_bus()
        meta = await self.next_msg(bus)
        assert 'meta' in meta, meta
        assert set(meta['meta'][iface]['properties']) == set(expected)

    async def assert_bus_notify(self, path: str, iface: str, expected: Dict[str, object], bus: Optional[str] = None) -> None:
        if bus is None:
            bus = await self.ensure_internal_bus()
        notify = await self.next_msg(bus)
        assert notify['notify'][path][iface] == expected

    async def watch_bus(self, path: str, iface: str, expected: Dict[str, object], bus: Optional[str] = None) -> None:
        if bus is None:
            bus = await self.ensure_internal_bus()
        tag = self.get_id('watch')
        self.send_json(bus, watch={'path': path, 'interface': iface}, id=tag)
        await self.assert_bus_meta(path, iface, expected, bus)
        await self.assert_bus_notify(path, iface, expected, bus)
        await self.assert_msg(bus, id=tag, reply=[])

    async def assert_bus_signal(self, path: str, iface: str, name: str, args: list, bus: Optional[str] = None) -> None:
        if bus is None:
            bus = await self.ensure_internal_bus()
        signal = await self.next_msg(bus)
        assert 'signal' in signal, signal
        assert signal['signal'] == [path, iface, name, args]

    async def add_bus_match(self, path: str, iface: str, bus: Optional[str] = None) -> None:
        if bus is None:
            bus = await self.ensure_internal_bus()
        tag = self.get_id('match.')
        self.send_json(bus, add_match={'path': path, 'interface': iface}, id=tag)
        await self.assert_msg(bus, id=tag, reply=[])


class TestBridge(unittest.IsolatedAsyncioTestCase):
    transport: MockTransport
    bridge: Bridge

    async def start(self, args=None, send_init=True) -> None:
        if args is None:
            args = argparse.Namespace(privileged=False)
        self.bridge = Bridge(args)
        self.transport = MockTransport(self.bridge)

        if send_init:
            await self.transport.assert_msg('', command='init')
            self.transport.send_init()

    async def test_echo(self):
        await self.start()

        echo = await self.transport.check_open('echo')

        self.transport.send_data(echo, b'foo')
        await self.transport.assert_data(echo, b'foo')

        self.transport.send_ping(channel=echo)
        await self.transport.assert_msg('', command='pong', channel=echo)

        self.transport.send_done(echo)
        await self.transport.assert_msg('', command='done', channel=echo)
        await self.transport.assert_msg('', command='close', channel=echo)

    async def test_host(self):
        await self.start()

        # try to open a null channel, explicitly naming our host
        await self.transport.check_open('null', host=MOCK_HOSTNAME)

        # try to open a null channel, no host
        await self.transport.check_open('null')

        # try to open a null channel, a different host (not yet supported)
        await self.transport.check_open('null', host='other', problem='not-supported')

    async def test_dbus_call_internal(self):
        await self.start()

        my_object = test_iface()
        self.bridge.internal_bus.export('/foo', my_object)
        assert my_object._dbus_bus == self.bridge.internal_bus.server
        assert my_object._dbus_path == '/foo'

        values, = await self.transport.check_bus_call('/foo', 'org.freedesktop.DBus.Properties', 'GetAll', ["test.iface"])
        assert values == {'Prop': {'t': 's', 'v': 'none'}}

    async def test_dbus_watch(self):
        await self.start()

        my_object = test_iface()
        self.bridge.internal_bus.export('/foo', my_object)
        assert my_object._dbus_bus == self.bridge.internal_bus.server
        assert my_object._dbus_path == '/foo'

        # Add a watch
        internal = await self.transport.ensure_internal_bus()

        self.transport.send_json(internal, watch={'path': '/foo', 'interface': 'test.iface'}, id='4')
        meta = await self.transport.next_msg(internal)
        assert meta['meta']['test.iface'] == {
            'methods': {},
            'properties': {'Prop': {'flags': 'r', 'type': 's'}},
            'signals': {'Sig': {'in': ['s']}}
        }
        notify = await self.transport.next_msg(internal)
        assert notify['notify']['/foo'] == {'test.iface': {'Prop': 'none'}}
        reply = await self.transport.next_msg(internal)
        assert reply == {'id': '4', 'reply': []}

        # Change a property
        my_object.prop = 'xyz'
        notify = await self.transport.next_msg(internal)
        assert 'notify' in notify
        assert notify['notify']['/foo'] == {'test.iface': {'Prop': 'xyz'}}
