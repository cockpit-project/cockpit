import argparse
import asyncio
import json
import os
import pytest
import unittest
import unittest.mock
import sys
import tempfile

from pathlib import Path
from typing import Any, Dict, Iterable, Optional, Tuple

import systemd_ctypes
from cockpit.bridge import Bridge
from cockpit.channels import CHANNEL_TYPES

MOCK_HOSTNAME = 'mockbox'

asyncio.set_event_loop_policy(systemd_ctypes.EventLoopPolicy())


class test_iface(systemd_ctypes.bus.Object):
    sig = systemd_ctypes.bus.Interface.Signal('s')
    prop = systemd_ctypes.bus.Interface.Property('s', value='none')


class MockTransport(asyncio.Transport):
    queue: 'asyncio.Queue[Tuple[str, bytes]]'
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

    async def check_open(self, payload, channel=None, problem=None, reply_keys: Optional[Dict[str, object]] = None, **kwargs):
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

    async def assert_bus_error(self, tag: str, code: str, message: str, bus: Optional[str] = None) -> None:
        if bus is None:
            bus = await self.ensure_internal_bus()
        reply = await self.next_msg(bus)
        assert 'id' in reply, reply
        assert reply['id'] == tag, reply
        assert 'error' in reply, reply
        assert reply['error'] == [code, [message]]

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
        self.send_json(bus, add_match={'path': path, 'interface': iface})


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

        # We use this for assertions
        self.superuser_bridges = list(self.bridge.superuser_rule.bridges)

    def add_pseudo(self) -> None:
        self.more_superuser_bridges = [*self.superuser_bridges, 'pseudo']

        # Add pseudo to the existing set of superuser rules
        configs = self.bridge.packages.get_bridge_configs()
        configs.append({
            'label': 'pseudo',
            'spawn': [
                sys.executable, os.path.abspath(f'{__file__}/../pseudo.py'),
                sys.executable, '-m', 'cockpit.bridge', '--privileged'
            ],
            'environ': [
                f'PYTHONPATH={":".join(sys.path)}'
            ],
            'privileged': True
        })
        self.bridge.superuser_rule.set_configs(configs)

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

        # make sure host check happens before superuser
        # ie: requesting superuser=True on another host should fail because we
        # can't contact the other host ('not-supported'), rather than trying to
        # first go to our superuser self.bridge ('access-denied')
        await self.transport.check_open('null', host='other', superuser=True, problem='not-supported')

        # but make sure superuser is indeed failing as we expect, on our host
        await self.transport.check_open('null', host=MOCK_HOSTNAME, superuser=True, problem='access-denied')

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

    async def verify_root_bridge_not_running(self):
        assert self.bridge.superuser_rule.peer is None
        await self.transport.assert_bus_props('/superuser', 'cockpit.Superuser',
                                              {'Bridges': self.more_superuser_bridges, 'Current': 'none'})
        null = await self.transport.check_open('null', superuser=True, problem='access-denied')
        assert null not in self.bridge.open_channels

    async def verify_root_bridge_running(self):
        await self.transport.assert_bus_props('/superuser', 'cockpit.Superuser',
                                              {'Bridges': self.more_superuser_bridges, 'Current': 'pseudo'})
        assert self.bridge.superuser_rule.peer is not None

        # try to open dbus on the root bridge
        root_dbus = await self.transport.check_open('dbus-json3', bus='internal', superuser=True)
        assert self.bridge.open_channels[root_dbus].name == 'pseudo'

        # verify that the bridge thinks that it's the root bridge
        await self.transport.assert_bus_props('/superuser', 'cockpit.Superuser',
                                              {'Bridges': self.superuser_bridges, 'Current': 'root'}, bus=root_dbus)

        # close up
        await self.transport.check_close(channel=root_dbus)

    async def test_superuser_dbus(self):
        await self.start()
        self.add_pseudo()
        await self.verify_root_bridge_not_running()

        # start the superuser bridge -- no password, so it should work straight away
        () = await self.transport.check_bus_call('/superuser', 'cockpit.Superuser', 'Start', ['pseudo'])

        await self.verify_root_bridge_running()

        # open a channel on the root bridge
        root_null = await self.transport.check_open('null', superuser=True)

        # stop the bridge
        stop = self.transport.send_bus_call(self.transport.internal_bus, '/superuser', 'cockpit.Superuser', 'Stop', [])

        # that should have implicitly closed the open channel
        await self.transport.assert_msg('', command='close', channel=root_null)
        assert root_null not in self.bridge.open_channels

        # The Stop method call is done now
        await self.transport.assert_msg(self.transport.internal_bus, reply=[[]], id=stop)

    @staticmethod
    def format_methods(methods: Dict[str, str]):
        return {name: {'t': 'a{sv}', 'v': {'label': {'t': 's', 'v': label}}} for name, label in methods.items()}

    async def test_superuser_dbus_pw(self):
        await self.start()
        self.add_pseudo()
        await self.verify_root_bridge_not_running()

        # watch for signals
        await self.transport.add_bus_match('/superuser', 'cockpit.Superuser')
        await self.transport.watch_bus('/superuser', 'cockpit.Superuser',
                                       {
                                           'Bridges': self.more_superuser_bridges,
                                           'Current': 'none',
                                           'Methods': self.format_methods({'pseudo': 'pseudo'}),
                                       })

        # start the bridge.  with a password this is more complicated
        with unittest.mock.patch.dict(os.environ, {"PSEUDO_PASSWORD": "p4ssw0rd"}):
            start = self.transport.send_bus_call(self.transport.internal_bus, '/superuser', 'cockpit.Superuser', 'Start', ['pseudo'])
            # first, init state
            await self.transport.assert_bus_notify('/superuser', 'cockpit.Superuser', {'Current': 'init'})
            # then, we'll be asked for a password
            await self.transport.assert_bus_signal('/superuser', 'cockpit.Superuser', 'Prompt', ['', 'can haz pw?', '', False, ''])
            # give it
            await self.transport.check_bus_call('/superuser', 'cockpit.Superuser', 'Answer', ['p4ssw0rd'])
            # and now the bridge should be running
            await self.transport.assert_bus_notify('/superuser', 'cockpit.Superuser', {'Current': 'pseudo'})

            # Start call is now done
            await self.transport.assert_bus_reply(start, [])

        # double-check
        await self.verify_root_bridge_running()

    async def test_superuser_dbus_wrong_pw(self):
        await self.start()
        self.add_pseudo()
        await self.verify_root_bridge_not_running()

        # watch for signals
        await self.transport.add_bus_match('/superuser', 'cockpit.Superuser')
        await self.transport.watch_bus('/superuser', 'cockpit.Superuser',
                                       {
                                           'Bridges': self.more_superuser_bridges,
                                           'Current': 'none',
                                           'Methods': self.format_methods({'pseudo': 'pseudo'}),
                                       })

        # start the bridge.  with a password this is more complicated
        with unittest.mock.patch.dict(os.environ, {"PSEUDO_PASSWORD": "p4ssw0rd"}):
            start = self.transport.send_bus_call(self.transport.internal_bus, '/superuser', 'cockpit.Superuser', 'Start', ['pseudo'])
            # first, init state
            await self.transport.assert_bus_notify('/superuser', 'cockpit.Superuser', {'Current': 'init'})
            # then, we'll be asked for a password
            await self.transport.assert_bus_signal('/superuser', 'cockpit.Superuser', 'Prompt', ['', 'can haz pw?', '', False, ''])
            # give it
            await self.transport.check_bus_call('/superuser', 'cockpit.Superuser', 'Answer', ['p5ssw0rd'])  # wrong password
            # pseudo fails after the first wrong attempt
            await self.transport.assert_bus_notify('/superuser', 'cockpit.Superuser', {'Current': 'none'})

            # Start call is now done and returned failure
            await self.transport.assert_bus_error(start, 'cockpit.Superuser.Error', 'pseudo says: Bad password\n')

        # double-check
        await self.verify_root_bridge_not_running()

    async def test_superuser_init(self):
        await self.start(send_init=False)
        self.add_pseudo()
        await self.transport.assert_msg('', command='init')
        self.transport.send_init(superuser={"id": "pseudo"})

        # this should work right away without auth
        await self.transport.assert_msg('', command='superuser-init-done')

        await self.verify_root_bridge_running()

    async def test_superuser_init_pw(self):
        await self.start(send_init=False)
        self.add_pseudo()
        with unittest.mock.patch.dict(os.environ, {"PSEUDO_PASSWORD": "p4ssw0rd"}):
            await self.transport.assert_msg('', command='init')
            self.transport.send_init(superuser={"id": "pseudo"})

            await self.transport.assert_msg('', command='authorize', cookie='supermarius')
            self.transport.send_json('', command='authorize', cookie='supermarius', response='p4ssw0rd')

            # that should have worked
            await self.transport.assert_msg('', command='superuser-init-done')

        await self.verify_root_bridge_running()

    async def test_no_login_messages(self):
        await self.start()
        await self.transport.check_bus_call('/LoginMessages', 'cockpit.LoginMessages', 'Get', [], ["{}"])
        await self.transport.check_bus_call('/LoginMessages', 'cockpit.LoginMessages', 'Dismiss', [], [])
        await self.transport.check_bus_call('/LoginMessages', 'cockpit.LoginMessages', 'Get', [], ["{}"])

    async def test_login_messages(self):
        fd = os.memfd_create('login messages')
        os.write(fd, b"msg")
        with unittest.mock.patch.dict(os.environ, {"COCKPIT_LOGIN_MESSAGES_MEMFD": str(fd)}):
            await self.start()
            await self.transport.check_bus_call('/LoginMessages', 'cockpit.LoginMessages', 'Get', [], ["msg"])
            # repeated read should get the messages again
            await self.transport.check_bus_call('/LoginMessages', 'cockpit.LoginMessages', 'Get', [], ["msg"])
            # ...but not after they were dismissed
            await self.transport.check_bus_call('/LoginMessages', 'cockpit.LoginMessages', 'Dismiss', [], [])
            await self.transport.check_bus_call('/LoginMessages', 'cockpit.LoginMessages', 'Get', [], ["{}"])
            # idempotency
            await self.transport.check_bus_call('/LoginMessages', 'cockpit.LoginMessages', 'Dismiss', [], [])
            await self.transport.check_bus_call('/LoginMessages', 'cockpit.LoginMessages', 'Get', [], ["{}"])

    async def test_freeze(self):
        await self.start()

        koelle = await self.transport.check_open('echo')
        malle = await self.transport.check_open('echo')

        # send a bunch of data to frozen koelle
        self.bridge.open_channels[koelle].freeze_endpoint()
        self.transport.send_data(koelle, b'x1')
        self.transport.send_data(koelle, b'x2')
        self.transport.send_data(koelle, b'x3')
        self.transport.send_done(koelle)

        # malle never freezes
        self.transport.send_data(malle, b'yy')
        self.transport.send_done(malle)

        # unfreeze koelle
        self.bridge.open_channels[koelle].thaw_endpoint()

        # malle should have sent its messages first
        await self.transport.assert_data(malle, b'yy')
        await self.transport.assert_msg('', command='done', channel=malle)
        await self.transport.assert_msg('', command='close', channel=malle)

        # the data from koelle should still be in the right order, though
        await self.transport.assert_data(koelle, b'x1')
        await self.transport.assert_data(koelle, b'x2')
        await self.transport.assert_data(koelle, b'x3')
        await self.transport.assert_msg('', command='done', channel=koelle)
        await self.transport.assert_msg('', command='close', channel=koelle)

    async def test_internal_metrics(self):
        await self.start()
        metrics = [
            {"name": "cpu.core.user", "derive": "rate"},
            {"name": "memory.used"},
        ]
        interval = 100
        source = 'internal'

        await self.transport.check_open('metrics1', source=source, interval=interval, metrics=metrics)
        _, data = await self.transport.next_frame()
        # first message is always the meta message
        meta = json.loads(data)
        assert isinstance(meta['timestamp'], float)
        assert meta['interval'] == interval
        assert meta['source'] == source
        assert isinstance(meta['metrics'], list)
        instances = len([m['instances'] for m in meta['metrics'] if m['name'] == 'cpu.core.user'][0])

        # actual data
        _, data = await self.transport.next_frame()
        data = json.loads(data)
        # cpu.core.user instances should be the same as meta sent instances
        assert instances == len(data[0][0])
        # all instances should be False, as this is a rate
        assert not all(d for d in data[0][0])
        # memory.used should be an integer
        assert isinstance(data[0][1], int)

    async def test_fsread1_errors(self):
        await self.start()
        await self.transport.check_open('fsread1', path='/etc/shadow', problem='access-denied')
        await self.transport.check_open('fsread1', path='/', problem='internal-error',
                                        reply_keys={'message': "[Errno 21] Is a directory: '/'"})

    async def test_fslist1_no_watch(self):
        await self.start()
        tempdir = tempfile.TemporaryDirectory()
        dir_path = Path(tempdir.name)

        # empty
        ch = self.transport.send_open('fslist1', path=str(dir_path), watch=False)
        await self.transport.assert_msg('', command='done', channel=ch)
        await self.transport.check_close(channel=ch)

        # create a file and a directory in some_dir
        Path(dir_path, 'somefile').touch()
        Path(dir_path, 'somedir').mkdir()

        ch = self.transport.send_open('fslist1', path=str(dir_path), watch=False)
        # don't assume any ordering
        msg1 = await self.transport.next_msg(ch)
        msg2 = await self.transport.next_msg(ch)
        if msg1['type'] == 'file':
            msg1, msg2 = msg2, msg1
        assert msg1 == {'event': 'present', 'path': 'somedir', 'type': 'directory'}
        assert msg2 == {'event': 'present', 'path': 'somefile', 'type': 'file'}

        await self.transport.assert_msg('', command='done', channel=ch)
        await self.transport.check_close(channel=ch)

    async def test_fslist1_notexist(self):
        await self.start()
        await self.transport.check_open(
            'fslist1', path='/nonexisting', watch=False,
            problem='not-found',
            reply_keys={'message': "[Errno 2] No such file or directory: '/nonexisting'"})


@pytest.mark.asyncio
@pytest.mark.parametrize('channeltype', CHANNEL_TYPES)
async def test_channel(channeltype, tmp_path):
    bridge = Bridge(argparse.Namespace(privileged=False))
    transport = MockTransport(bridge)
    await transport.assert_msg('', command='init')
    transport.send_init()

    payload = channeltype.payload
    args = dict(channeltype.restrictions)

    async def serve_page(reader, writer):
        while True:
            line = await reader.readline()
            if line.strip():
                print('HTTP Request line', line)
            else:
                break

        print('Sending HTTP reply')
        writer.write(b'HTTP/1.1 200 OK\r\n\r\nA document\r\n')
        await writer.drain()
        writer.close()

    srv = str(tmp_path / 'sock')
    await asyncio.start_unix_server(serve_page, srv)

    if payload == 'fslist1':
        args = {'path': '/', 'watch': False}
    elif payload == 'fsread1':
        args = {'path': '/etc/passwd'}
    elif payload == 'fsreplace1':
        args = {'path': 'tmpfile'}
    elif payload == 'fswatch1':
        args = {'path': '/etc'}
    elif payload == 'http-stream1':
        args = {'internal': 'packages', 'method': 'GET', 'path': '/manifests.js',
                'headers': {'X-Forwarded-Proto': 'http', 'X-Forwarded-Host': 'localhost'}}
    elif payload == 'http-stream2':
        args = {'method': 'GET', 'path': '/bzzt', 'unix': srv}
    elif payload == 'stream':
        if 'spawn' in args:
            args = {'spawn': ['cat']}
        else:
            args = {'unix': srv}
    elif payload == 'metrics1':
        args['metrics'] = [{'name': 'memory.free'}]
    elif payload == 'dbus-json3':
        if not os.path.exists('/run/dbus/system_bus_socket'):
            pytest.skip('no dbus')
    else:
        args = {}

    print('sending open', payload, args)
    ch = transport.send_open(payload, **args)
    saw_data = False

    while True:
        channel, msg = await transport.next_frame()
        print(channel, msg)
        if channel == '':
            control = json.loads(msg)
            assert control['channel'] == ch
            command = control['command']
            if command == 'done':
                saw_data = True
            elif command == 'ready':
                # If we get ready, it's our turn to send data first.
                # Hopefully we didn't receive any before.
                assert isinstance(bridge.open_channels[ch], channeltype)
                assert not saw_data
                break
            elif command == 'close':
                # If we got an immediate close message then it should be
                # because the channel sent data and finished, without error.
                assert 'problem' not in control
                assert saw_data
                return
            else:
                assert False, (payload, args, control)
        else:
            saw_data = True

    # If we're here, it's our turn to talk.  Say nothing.
    print('sending done')
    transport.send_done(ch)

    if payload in ['dbus-json3', 'fswatch1', 'null']:
        transport.send_close(ch)

    while True:
        channel, msg = await transport.next_frame()
        print(channel, msg)
        if channel == '':
            control = json.loads(msg)
            command = control['command']
            if command == 'done':
                continue
            elif command == 'close':
                assert 'problem' not in control
                return
