import argparse
import asyncio
import json
import unittest

from typing import Any, Dict, Tuple

import systemd_ctypes
from cockpit.bridge import Bridge
from cockpit.internal_endpoints import InternalEndpoints

MOCK_HOSTNAME = 'mockbox'

asyncio.set_event_loop_policy(systemd_ctypes.EventLoopPolicy())


class test_iface(systemd_ctypes.bus.Object):
    sig = systemd_ctypes.bus.Interface.Signal('s')
    prop = systemd_ctypes.bus.Interface.Property('s', value='none')


class MockTransport(asyncio.Transport):
    queue: asyncio.Queue[Tuple[str, bytes]]

    def send_json(self, _channel: str, **kwargs) -> None:
        self.send_data(_channel, json.dumps(kwargs).encode('ascii'))

    def send_data(self, channel: str, data: bytes) -> None:
        msg = channel.encode('ascii') + b'\n' + data
        msg = str(len(msg)).encode('ascii') + b'\n' + msg
        self.protocol.data_received(msg)

    def send_init(self, version=1, host=MOCK_HOSTNAME, **kwargs):
        self.send_json('', command='init', version=version, host=host, **kwargs)

    def send_open(self, channel, payload, **kwargs):
        self.send_json('', command='open', channel=channel, payload=payload, **kwargs)

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
        assert channel == expected_channel
        return json.loads(data)

    async def assert_data(self, expected_channel: str, expected_data: bytes) -> None:
        channel, data = await self.next_frame()
        assert channel == expected_channel
        assert data == expected_data

    async def assert_msg(self, expected_channel, **kwargs) -> None:
        msg = await self.next_msg(expected_channel)
        assert msg == msg | {k.replace('_', '-'): v for k, v in kwargs.items()}


class TestBridge(unittest.IsolatedAsyncioTestCase):
    async def start(self) -> Tuple[Bridge, MockTransport]:
        bridge = Bridge(argparse.Namespace(privileged=False))
        transport = MockTransport(bridge)

        await transport.assert_msg('', command='init')
        transport.send_init()

        return bridge, transport

    async def test_echo(self):
        bridge, transport = await self.start()

        transport.send_open('1', 'echo')
        await transport.assert_msg('', command='ready', channel='1')

        transport.send_data('1', b'foo')
        await transport.assert_data('1', b'foo')

        transport.send_ping(channel='1')
        await transport.assert_msg('', command='pong', channel='1')

        transport.send_done('1')
        await transport.assert_msg('', command='done', channel='1')

        transport.send_close('1')
        await transport.assert_msg('', command='close', channel='1')

    async def test_host(self):
        bridge, transport = await self.start()

        # try to open an null channel, explicitly naming our host
        transport.send_open('1', 'null', host=MOCK_HOSTNAME)
        await transport.assert_msg('', command='ready', channel='1')

        # try to open an null channel, no host
        transport.send_open('2', 'null')
        await transport.assert_msg('', command='ready', channel='2')

        # try to open an null channel, a different host (not yet supported)
        transport.send_open('3', 'null', host='other')
        await transport.assert_msg('', command='close', channel='3', problem='not-supported')

    async def test_dbus_call_internal(self):
        bridge, transport = await self.start()

        my_object = test_iface()
        server = InternalEndpoints.get_server()
        self.slot = server.add_object('/foo', my_object)
        assert my_object._dbus_bus == server
        assert my_object._dbus_path == '/foo'

        transport.send_open('internal', 'dbus-json3', bus='internal')
        await transport.assert_msg('', command='ready', channel='internal')

        # Call a method on a channel without a service name.  "GetAll"
        # is a convenient one to use.
        transport.send_json('internal',
                            call=["/foo", 'org.freedesktop.DBus.Properties', 'GetAll', ["test.iface"]],
                            id='x')
        msg = await transport.next_msg('internal')
        assert msg['id'] == 'x'
        assert 'reply' in msg
        assert msg['reply'] == [[{'Prop': {'t': 's', 'v': 'none'}}]]
