import argparse
import asyncio
import contextlib
import errno
import getpass
import grp
import json
import os
import pwd
import shlex
import stat
import subprocess
import sys
import unittest.mock
from collections import deque
from pathlib import Path
from typing import Dict, Iterable, Sequence

import pytest

from cockpit._vendor.systemd_ctypes import bus
from cockpit.bridge import Bridge
from cockpit.channel import AsyncChannel, Channel, ChannelRoutingRule
from cockpit.channels import CHANNEL_TYPES
from cockpit.jsonutil import JsonDict, JsonObject, JsonValue, get_bool, get_dict, get_int, json_merge_patch
from cockpit.packages import BridgeConfig

from .mocktransport import MOCK_HOSTNAME, MockTransport


class test_iface(bus.Object):
    sig = bus.Interface.Signal('s')
    prop = bus.Interface.Property('s', value='none')

    @bus.Interface.Method('s')
    def get_prop(self) -> str:
        return self.prop


@pytest.fixture
def bridge() -> Bridge:
    bridge = Bridge(argparse.Namespace(privileged=False, beipack=False))
    bridge.superuser_bridges = list(bridge.superuser_rule.bridges)  # type: ignore[attr-defined]
    return bridge


def add_pseudo(bridge: Bridge) -> None:
    bridge.more_superuser_bridges = [*bridge.superuser_bridges, 'pseudo']  # type: ignore[attr-defined]

    assert bridge.packages is not None

    # Add pseudo to the existing set of superuser rules
    bridge.superuser_rule.set_configs([
        *bridge.packages.get_bridge_configs(),
        BridgeConfig({
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
    ])


@pytest.fixture
def no_init_transport(event_loop: asyncio.AbstractEventLoop, bridge: Bridge) -> Iterable[MockTransport]:
    transport = MockTransport(bridge)
    try:
        yield transport
    finally:
        transport.stop(event_loop)


@pytest.fixture
def transport(no_init_transport: MockTransport) -> MockTransport:
    no_init_transport.init()
    return no_init_transport


@pytest.mark.asyncio
async def test_echo(transport: MockTransport) -> None:
    echo = await transport.check_open('echo')

    transport.send_data(echo, b'foo')
    await transport.assert_data(echo, b'foo')

    transport.send_ping(channel=echo)
    await transport.assert_msg('', command='pong', channel=echo)

    transport.send_done(echo)
    await transport.assert_msg('', command='done', channel=echo)
    await transport.assert_msg('', command='close', channel=echo)


@pytest.mark.asyncio
async def test_host(transport: MockTransport) -> None:
    # try to open a null channel, explicitly naming our host
    await transport.check_open('null', host=MOCK_HOSTNAME)

    # try to open a null channel, no host
    await transport.check_open('null')

    # try to open a null channel, a different host which is sure to fail DNS
    await transport.check_open('null', host='¡invalid!', problem='no-host')

    # make sure host check happens before superuser
    # ie: requesting superuser=True on another host should fail because we
    # can't contact the other host ('no-host'), rather than trying to first
    # go to our superuser bridge ('access-denied')
    await transport.check_open('null', host='¡invalid!', superuser=True, problem='no-host')

    # but make sure superuser is indeed failing as we expect, on our host
    await transport.check_open('null', host=MOCK_HOSTNAME, superuser=True, problem='access-denied')


@pytest.mark.asyncio
async def test_dbus_call_internal(bridge: Bridge, transport: MockTransport) -> None:
    my_object = test_iface()
    bridge.internal_bus.export('/foo', my_object)
    assert my_object._dbus_bus == bridge.internal_bus.server
    assert my_object._dbus_path == '/foo'

    values, = await transport.check_bus_call('/foo', 'org.freedesktop.DBus.Properties',
                                             'GetAll', ["test.iface"])
    assert values == {'Prop': {'t': 's', 'v': 'none'}}

    result, = await transport.check_bus_call('/foo', 'test.iface', 'GetProp', [])
    assert result == 'none'


@pytest.mark.asyncio
async def test_dbus_watch(bridge: Bridge, transport: MockTransport) -> None:
    my_object = test_iface()
    bridge.internal_bus.export('/foo', my_object)
    assert my_object._dbus_bus == bridge.internal_bus.server
    assert my_object._dbus_path == '/foo'

    # Add a watch
    internal = await transport.ensure_internal_bus()

    transport.send_json(internal, watch={'path': '/foo', 'interface': 'test.iface'}, id='4')
    meta = await transport.next_msg(internal)
    assert meta['meta']['test.iface'] == {
        'methods': {'GetProp': {'in': [], 'out': ['s']}},
        'properties': {'Prop': {'flags': 'r', 'type': 's'}},
        'signals': {'Sig': {'in': ['s']}}
    }
    notify = await transport.next_msg(internal)
    assert notify['notify']['/foo'] == {'test.iface': {'Prop': 'none'}}
    reply = await transport.next_msg(internal)
    assert reply == {'id': '4', 'reply': []}

    # Change a property
    my_object.prop = 'xyz'
    notify = await transport.next_msg(internal)
    assert 'notify' in notify
    assert notify['notify']['/foo'] == {'test.iface': {'Prop': 'xyz'}}


async def verify_root_bridge_not_running(bridge: Bridge, transport: MockTransport) -> None:
    assert bridge.superuser_rule.peer is None
    await transport.assert_bus_props('/superuser', 'cockpit.Superuser',
                                     {'Bridges': bridge.more_superuser_bridges, 'Current': 'none'})  # type: ignore[attr-defined]
    null = await transport.check_open('null', superuser=True, problem='access-denied')
    assert null not in bridge.open_channels


@pytest.mark.asyncio
async def verify_root_bridge_running(bridge: Bridge, transport: MockTransport) -> None:
    await transport.assert_bus_props('/superuser', 'cockpit.Superuser',
                                     {'Bridges': bridge.more_superuser_bridges, 'Current': 'pseudo'})  # type: ignore[attr-defined]
    assert bridge.superuser_rule.peer is not None

    # try to open dbus on the root bridge
    root_dbus = await transport.check_open('dbus-json3', bus='internal', superuser=True)

    # verify that the bridge thinks that it's the root bridge
    await transport.assert_bus_props('/superuser', 'cockpit.Superuser',
                                     {'Bridges': [], 'Current': 'root'}, bus=root_dbus)

    # close up
    await transport.check_close(channel=root_dbus)


@pytest.mark.asyncio
async def test_superuser_dbus(bridge: Bridge, transport: MockTransport) -> None:
    add_pseudo(bridge)
    await verify_root_bridge_not_running(bridge, transport)

    # start the superuser bridge -- no password, so it should work straight away
    () = await transport.check_bus_call('/superuser', 'cockpit.Superuser', 'Start', ['pseudo'])

    await verify_root_bridge_running(bridge, transport)

    # open a channel on the root bridge
    root_null = await transport.check_open('null', superuser=True)

    # stop the bridge
    stop = transport.send_bus_call(transport.internal_bus, '/superuser',
                                   'cockpit.Superuser', 'Stop', [])

    # that should have implicitly closed the open channel
    await transport.assert_msg('', command='close', channel=root_null)
    assert root_null not in bridge.open_channels

    # The Stop method call is done now
    await transport.assert_msg(transport.internal_bus, reply=[[]], id=stop)


def format_methods(methods: Dict[str, str]):
    return {name: {'t': 'a{sv}', 'v': {'label': {'t': 's', 'v': label}}} for name, label in methods.items()}


@pytest.mark.asyncio
async def test_superuser_dbus_pw(bridge: Bridge, transport: MockTransport, monkeypatch) -> None:
    monkeypatch.setenv('PSEUDO_PASSWORD', 'p4ssw0rd')
    add_pseudo(bridge)
    await verify_root_bridge_not_running(bridge, transport)

    # watch for signals
    await transport.add_bus_match('/superuser', 'cockpit.Superuser')
    await transport.watch_bus('/superuser', 'cockpit.Superuser',
                              {
                                  'Bridges': bridge.more_superuser_bridges,  # type: ignore[attr-defined]
                                  'Current': 'none',
                                  'Methods': format_methods({'pseudo': 'pseudo'}),
                              })

    # start the bridge.  with a password this is more complicated
    start = transport.send_bus_call(transport.internal_bus, '/superuser',
                                    'cockpit.Superuser', 'Start', ['pseudo'])
    # first, init state
    await transport.assert_bus_notify('/superuser', 'cockpit.Superuser', {'Current': 'init'})
    # then, we'll be asked for a password
    await transport.assert_bus_signal('/superuser', 'cockpit.Superuser', 'Prompt',
                                      ['', 'can haz pw?', '', False, ''])
    # give it
    await transport.check_bus_call('/superuser', 'cockpit.Superuser', 'Answer', ['p4ssw0rd'])
    # and now the bridge should be running
    await transport.assert_bus_notify('/superuser', 'cockpit.Superuser', {'Current': 'pseudo'})

    # Start call is now done
    await transport.assert_bus_reply(start, [])

    # double-check
    await verify_root_bridge_running(bridge, transport)


@pytest.mark.asyncio
async def test_superuser_dbus_wrong_pw(bridge: Bridge, transport: MockTransport, monkeypatch) -> None:
    monkeypatch.setenv('PSEUDO_PASSWORD', 'p4ssw0rd')
    add_pseudo(bridge)
    await verify_root_bridge_not_running(bridge, transport)

    # watch for signals
    await transport.add_bus_match('/superuser', 'cockpit.Superuser')
    await transport.watch_bus('/superuser', 'cockpit.Superuser',
                              {
                                  'Bridges': bridge.more_superuser_bridges,  # type: ignore[attr-defined]
                                  'Current': 'none',
                                  'Methods': format_methods({'pseudo': 'pseudo'}),
                              })

    # start the bridge.  with a password this is more complicated
    start = transport.send_bus_call(transport.internal_bus, '/superuser',
                                    'cockpit.Superuser', 'Start', ['pseudo'])
    # first, init state
    await transport.assert_bus_notify('/superuser', 'cockpit.Superuser', {'Current': 'init'})
    # then, we'll be asked for a password
    await transport.assert_bus_signal('/superuser', 'cockpit.Superuser', 'Prompt',
                                      ['', 'can haz pw?', '', False, ''])
    # give it
    await transport.check_bus_call('/superuser', 'cockpit.Superuser',
                                   'Answer', ['p5ssw0rd'])  # wrong password
    # pseudo fails after the first wrong attempt
    await transport.assert_bus_notify('/superuser', 'cockpit.Superuser', {'Current': 'none'})

    # Start call is now done and returned failure
    await transport.assert_bus_error(start, 'cockpit.Superuser.Error', 'pseudo says: Bad password')

    # double-check
    await verify_root_bridge_not_running(bridge, transport)


@pytest.mark.asyncio
async def test_superuser_init(bridge: Bridge, no_init_transport: MockTransport) -> None:
    add_pseudo(bridge)
    no_init_transport.init(superuser={"id": "pseudo"})
    transport = no_init_transport

    # this should work right away without auth
    await transport.assert_msg('', command='superuser-init-done')

    await verify_root_bridge_running(bridge, transport)


@pytest.mark.asyncio
async def test_superuser_init_pw(bridge: Bridge, no_init_transport: MockTransport, monkeypatch) -> None:
    monkeypatch.setenv('PSEUDO_PASSWORD', 'p4ssw0rd')
    add_pseudo(bridge)
    no_init_transport.init(superuser={"id": "pseudo"})
    transport = no_init_transport

    msg = await transport.assert_msg('', command='authorize')
    transport.send_json('', command='authorize', cookie=msg['cookie'], response='p4ssw0rd')

    # that should have worked
    await transport.assert_msg('', command='superuser-init-done')

    await verify_root_bridge_running(bridge, transport)


@pytest.mark.asyncio
async def test_no_login_messages(transport: MockTransport) -> None:
    await transport.check_bus_call('/LoginMessages', 'cockpit.LoginMessages', 'Get', [], ["{}"])
    await transport.check_bus_call('/LoginMessages', 'cockpit.LoginMessages', 'Dismiss', [], [])
    await transport.check_bus_call('/LoginMessages', 'cockpit.LoginMessages', 'Get', [], ["{}"])


@pytest.fixture
def login_messages_envvar(monkeypatch):
    if sys.version_info < (3, 8):
        pytest.skip("os.memfd_create new in 3.8")
    fd = os.memfd_create('login messages')
    os.write(fd, b"msg")
    # this is questionable (since it relies on ordering of fixtures), but it works
    monkeypatch.setenv('COCKPIT_LOGIN_MESSAGES_MEMFD', str(fd))
    return None


@pytest.mark.asyncio
async def test_login_messages(login_messages_envvar, transport: MockTransport) -> None:
    del login_messages_envvar

    await transport.check_bus_call('/LoginMessages', 'cockpit.LoginMessages', 'Get', [], ["msg"])
    # repeated read should get the messages again
    await transport.check_bus_call('/LoginMessages', 'cockpit.LoginMessages', 'Get', [], ["msg"])
    # ...but not after they were dismissed
    await transport.check_bus_call('/LoginMessages', 'cockpit.LoginMessages', 'Dismiss', [], [])
    await transport.check_bus_call('/LoginMessages', 'cockpit.LoginMessages', 'Get', [], ["{}"])
    # idempotency
    await transport.check_bus_call('/LoginMessages', 'cockpit.LoginMessages', 'Dismiss', [], [])
    await transport.check_bus_call('/LoginMessages', 'cockpit.LoginMessages', 'Get', [], ["{}"])


@pytest.mark.asyncio
async def test_freeze(bridge: Bridge, transport: MockTransport) -> None:
    koelle = await transport.check_open('echo')
    malle = await transport.check_open('echo')

    # send a bunch of data to frozen koelle
    bridge.open_channels[koelle].freeze_endpoint()
    transport.send_data(koelle, b'x1')
    transport.send_data(koelle, b'x2')
    transport.send_data(koelle, b'x3')
    transport.send_done(koelle)

    # malle never freezes
    transport.send_data(malle, b'yy')
    transport.send_done(malle)

    # unfreeze koelle
    bridge.open_channels[koelle].thaw_endpoint()

    # malle should have sent its messages first
    await transport.assert_data(malle, b'yy')
    await transport.assert_msg('', command='done', channel=malle)
    await transport.assert_msg('', command='close', channel=malle)

    # the data from koelle should still be in the right order, though
    await transport.assert_data(koelle, b'x1')
    await transport.assert_data(koelle, b'x2')
    await transport.assert_data(koelle, b'x3')
    await transport.assert_msg('', command='done', channel=koelle)
    await transport.assert_msg('', command='close', channel=koelle)


@pytest.mark.asyncio
async def test_internal_metrics(transport: MockTransport) -> None:
    metrics = [
        {"name": "cpu.core.user", "derive": "rate"},
        {"name": "memory.used"},
    ]
    interval = 100
    source = 'internal'

    await transport.check_open('metrics1', source=source, interval=interval, metrics=metrics)
    _, data = await transport.next_frame()
    # first message is always the meta message
    meta = json.loads(data)
    assert isinstance(meta['timestamp'], float)
    assert meta['interval'] == interval
    assert meta['source'] == source
    assert isinstance(meta['metrics'], list)
    instances = len(next(m['instances'] for m in meta['metrics'] if m['name'] == 'cpu.core.user'))

    # actual data
    _, data = await transport.next_frame()
    data = json.loads(data)
    assert isinstance(data, list)
    # cpu.core.user instances should be the same as meta sent instances
    assert instances == len(data[0][0])
    # all instances should be False, as this is a rate
    assert not all(d for d in data[0][0])
    # memory.used should be an integer
    assert isinstance(data[0][1], int)


@pytest.mark.asyncio
async def test_fsread1_errors(transport: MockTransport) -> None:
    await transport.check_open('fsread1', path='/etc/shadow', problem='access-denied')
    await transport.check_open('fsread1', path='/', problem='internal-error',
                               reply_keys={'message': "[Errno 21] Is a directory: '/'"})
    await transport.check_open('fsread1', path='/etc/passwd', max_read_size="lol",
                               problem='protocol-error',
                               reply_keys={'message': "attribute 'max_read_size': must have type int"})


@pytest.mark.asyncio
async def test_fsread1_size_hint(transport: MockTransport) -> None:
    data = None
    stat = os.stat('/usr/lib/os-release')
    with open('/usr/lib/os-release', 'rb') as fp:
        data = fp.read()
    ch = await transport.check_open('fsread1', path='/usr/lib/os-release', binary='raw',
                                    reply_keys={'size-hint': stat.st_size})
    await transport.assert_data(ch, data)


@pytest.mark.asyncio
async def test_fsread1_size_hint_absent(transport: MockTransport) -> None:
    # non-binary fsread1 has no size-hint
    await transport.check_open('fsread1', path='/etc/passwd', absent_keys=['size-hint'])


@pytest.mark.asyncio
async def test_fsread1_size_hint_absent_char_device(transport: MockTransport) -> None:
    # character device fsread1 has no size-hint
    await transport.check_open('fsread1', path='/dev/null', binary='raw', absent_keys=['size-hint'])


@pytest.mark.asyncio
async def test_fslist1_no_watch(transport: MockTransport, tmp_path: Path) -> None:
    # empty
    ch = await transport.check_open('fslist1', path=str(tmp_path), watch=False)
    await transport.assert_msg('', command='done', channel=ch)
    await transport.check_close(channel=ch)

    # create a file and a directory in some_dir
    (tmp_path / 'somefile').touch()
    (tmp_path / 'somedir').mkdir()

    ch = await transport.check_open('fslist1', path=str(tmp_path), watch=False)
    # don't assume any ordering
    msg1 = await transport.next_msg(ch)
    msg2 = await transport.next_msg(ch)
    if msg1['type'] == 'file':
        msg1, msg2 = msg2, msg1
    assert msg1 == {'event': 'present', 'path': 'somedir', 'type': 'directory'}
    assert msg2 == {'event': 'present', 'path': 'somefile', 'type': 'file'}

    await transport.assert_msg('', command='done', channel=ch)
    await transport.check_close(channel=ch)


@pytest.mark.asyncio
async def test_fslist1_notexist(transport: MockTransport) -> None:
    await transport.check_open(
        'fslist1', path='/nonexisting', watch=False,
        problem='not-found',
        reply_keys={'message': "[Errno 2] No such file or directory: '/nonexisting'"})


@pytest.mark.asyncio
async def test_fsreplace1(transport: MockTransport, tmp_path: Path) -> None:
    # create non-existing file
    myfile = tmp_path / 'newfile'
    ch = await transport.check_open('fsreplace1', path=str(myfile))
    transport.send_data(ch, b'some stuff')
    transport.send_done(ch)
    await transport.assert_msg('', command='done', channel=ch)
    await transport.check_close(channel=ch)
    assert myfile.read_bytes() == b'some stuff'
    # no leftover files
    assert os.listdir(tmp_path) == ['newfile']

    # now update its contents
    ch = await transport.check_open('fsreplace1', path=str(myfile))
    transport.send_data(ch, b'new new new!')
    transport.send_done(ch)
    await transport.assert_msg('', command='done', channel=ch)
    await transport.check_close(channel=ch)
    assert myfile.read_bytes() == b'new new new!'
    # no leftover files
    assert os.listdir(tmp_path) == ['newfile']

    # set funny permissions to check that they are preserved
    perms = 0o625
    myfile.chmod(perms)

    # get the current tag
    ch = await transport.check_open('fsread1', path=str(myfile))
    transport.send_done(ch)
    await transport.assert_data(ch, b'new new new!')
    await transport.assert_msg('', command='done', channel=ch)
    transport.send_close(ch)
    close_msg = await transport.next_msg('')
    assert close_msg['command'] == 'close'
    tag = close_msg['tag']

    # update contents with expected tag
    ch = await transport.check_open('fsreplace1', path=str(myfile), tag=tag)
    transport.send_data(ch, b'even newer')
    transport.send_done(ch)
    await transport.assert_msg('', command='done', channel=ch)
    await transport.check_close(channel=ch)
    assert myfile.read_bytes() == b'even newer'

    # preserves existing permissions when giving expected tag
    assert stat.S_IMODE(myfile.stat().st_mode) == perms

    # write empty file
    ch = await transport.check_open('fsreplace1', path=str(myfile))
    transport.send_data(ch, b'')
    transport.send_done(ch)
    await transport.assert_msg('', command='done', channel=ch)
    await transport.check_close(channel=ch)
    assert myfile.read_bytes() == b''

    # delete file
    ch = await transport.check_open('fsreplace1', path=str(myfile))
    transport.send_done(ch)
    await transport.assert_msg('', command='done', channel=ch)
    await transport.check_close(channel=ch)
    assert not myfile.exists()

    # acks
    ch = await transport.check_open('fsreplace1', path=str(myfile), send_acks='bytes')
    transport.send_data(ch, b'some stuff')
    await transport.assert_msg('', command='ack', bytes=10, channel=ch)
    transport.send_data(ch, b'some more stuff')
    await transport.assert_msg('', command='ack', bytes=15, channel=ch)
    transport.send_done(ch)
    await transport.assert_msg('', command='done', channel=ch)
    await transport.check_close(channel=ch)


@pytest.mark.asyncio
async def test_fsreplace1_change_conflict(transport: MockTransport, tmp_path: Path) -> None:
    myfile = tmp_path / 'data'
    myfile.write_text('hello')

    # get current tag from fsread1
    ch = await transport.check_open('fsread1', path=str(myfile))
    transport.send_done(ch)
    await transport.assert_data(ch, b'hello')
    await transport.assert_msg('', command='done', channel=ch)
    transport.send_close(ch)
    close_msg = await transport.next_msg('')
    assert close_msg['command'] == 'close'
    tag = close_msg['tag']

    # modify the file in between read and replace operations
    # we have to wait a bit, assuming that file systems we run tests on have at least centisecond mtime resolution
    await asyncio.sleep(0.2)
    myfile.write_text('goodbye')

    # try to replace it, expecting the old contents (via tag)
    ch = await transport.check_open('fsreplace1', path=str(myfile), tag=tag)
    transport.send_data(ch, b'newcontent')
    transport.send_done(ch)
    await transport.assert_msg('', command='close', channel=ch, problem='change-conflict')
    transport.send_close(ch)

    # file was not touched by fsreplace1 due to conflict
    assert myfile.read_text() == 'goodbye'


@pytest.mark.asyncio
async def test_fsreplace1_change_conflict_mode(transport: MockTransport, tmp_path: Path) -> None:
    myfile = tmp_path / 'data'
    myfile.write_text('hello')

    # get current tag
    ch = await transport.check_open('fsread1', path=str(myfile))
    transport.send_done(ch)
    await transport.assert_data(ch, b'hello')
    await transport.assert_msg('', command='done', channel=ch)
    transport.send_close(ch)
    close_msg = await transport.next_msg('')
    assert close_msg['command'] == 'close'
    tag = close_msg['tag']

    # modify the stat metadata in between read and replace operations
    new_mode = 0o741
    assert stat.S_IMODE(myfile.stat().st_mode) != new_mode
    myfile.chmod(new_mode)

    # try to replace it, expecting the old mode (via tag)
    ch = await transport.check_open('fsreplace1', path=str(myfile), tag=tag)
    transport.send_data(ch, b'newcontent')
    transport.send_done(ch)
    await transport.assert_msg('', command='close', channel=ch, problem='change-conflict')
    transport.send_close(ch)

    # file was not touched by fsreplace1 due to conflict
    assert stat.S_IMODE(myfile.stat().st_mode) == new_mode
    assert myfile.read_text() == 'hello'


@pytest.mark.asyncio
async def test_fsreplace1_error(transport: MockTransport, tmp_path: Path) -> None:
    # trying to write a directory
    ch = await transport.check_open('fsreplace1', path=str(tmp_path))
    transport.send_data(ch, b'not me')
    transport.send_done(ch)
    await transport.assert_msg('', command='close', channel=ch, problem='access-denied')

    # nonexisting directory
    ch = await transport.check_open('fsreplace1', path='/non/existing/file')
    transport.send_data(ch, b'not me')
    transport.send_done(ch)
    await transport.assert_msg('', command='close', channel=ch, problem='not-found')

    # invalid send-acks option
    await transport.check_open('fsreplace1', path=str(tmp_path), send_acks='not-valid',
                               problem='protocol-error',
                               reply_keys={
                                   'message': """attribute 'send-acks': invalid value "not-valid" not in ['bytes']"""
    })


@pytest.mark.asyncio
@pytest.mark.parametrize('channeltype', CHANNEL_TYPES)
async def test_channel(bridge: Bridge, transport: MockTransport, channeltype, tmp_path: Path) -> None:
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

    if payload == 'fsinfo':
        args = {'path': '/', 'attrs': []}
    elif payload == 'fslist1':
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
            if command == 'ready':
                # If we get ready, it's our turn to send data first.
                # Hopefully we didn't receive any before.
                assert not saw_data
                break
            else:
                pytest.fail(f'unexpected event: {(payload, args, control)}')
        else:
            saw_data = True

    # If we're here, it's our turn to talk.  Say nothing.
    print('sending done')
    transport.send_done(ch)

    if payload in ['dbus-json3', 'fswatch1', 'metrics1', 'null']:
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


@pytest.mark.parametrize(('os_release', 'expected'), [
    # simple values, with comments and ignored space
    (
        '\n\n# simple\nID=mylinux\nVERSION=1.2\n\n# comment\nFOO=bar\n\n',
        {'ID': 'mylinux', 'VERSION': '1.2', 'FOO': 'bar'}
    ),
    # quoted values
    (
        '''SINGLE='foo:bar '\nDOUBLE=" bar//foo"\n''',
        {'SINGLE': 'foo:bar ', 'DOUBLE': ' bar//foo'}
    ),
    # ignore ungrammatical lines
    (
        'A=a\nNOVALUE\nDOUBLEEQ=a=b\nB=b',
        {'A': 'a', 'B': 'b'}
    ),
    # invalid values; anything outside [A-Za-z0-9] must be quoted; but our parser is more liberal
    (
        'X=a:b\nY=a b\nZ=a-b\nV=a_b',
        {'X': 'a:b', 'Z': 'a-b', 'V': 'a_b'}
    ),
])
def test_get_os_release(os_release: str, expected: str) -> None:
    with unittest.mock.patch('builtins.open', unittest.mock.mock_open(read_data=os_release)):
        assert Bridge.get_os_release() == expected


class AckChannel(AsyncChannel):
    payload = 'ack1'

    async def run(self, options: JsonObject) -> None:
        self.semaphore = asyncio.Semaphore(0)
        self.ready()
        while await self.read():
            await self.semaphore.acquire()


@pytest.mark.asyncio
async def test_async_acks(bridge: Bridge, transport: MockTransport) -> None:
    # Inject our mock channel type
    for rule in bridge.routing_rules:
        if isinstance(rule, ChannelRoutingRule):
            rule.table['ack1'] = [AckChannel]

    # invalid send-acks values
    await transport.check_open('ack1', send_acks=True, problem='protocol-error')
    await transport.check_open('ack1', send_acks='x', problem='protocol-error')

    # open the channel with acks off
    ch = await transport.check_open('ack1')
    # send a bunch of data and get no acks
    for _ in range(20):
        transport.send_data(ch, b'x')
    # this will assert that we receive only the close message (and no acks)
    await transport.check_close(ch)

    # open the channel with acks on
    ch = await transport.check_open('ack1', send_acks='bytes')
    # send a bunch of data
    for _ in range(20):
        transport.send_data(ch, b'x')
    # we should get exactly one ack (from the first read) before things block
    await transport.assert_msg('', channel=ch, command='ack', bytes=1)
    # this will assert that we receive only the close message (and no additional acks)
    await transport.check_close(ch)

    # open the channel with acks on
    ch = await transport.check_open('ack1', send_acks='bytes')
    # fish the open channel out of the bridge
    ack = bridge.open_channels[ch]
    assert isinstance(ack, AckChannel)
    # let's give ourselves a bit more headroom
    for _ in range(5):
        ack.semaphore.release()
    # send a bunch of data and get some acks
    for _ in range(10):
        transport.send_data(ch, b'x')
    for _ in range(6):
        await transport.assert_msg('', channel=ch, command='ack', bytes=1)
    # make sure that as we "consume" the data we get more acks:
    for _ in range(4):
        # no ack in the queue...
        await transport.assert_empty()
        ack.semaphore.release()
        # ... but now there is.
        await transport.assert_msg('', channel=ch, command='ack', bytes=1)
    # make some more room (for data we didn't send)
    for _ in range(5):
        ack.semaphore.release()
    # but we shouldn't have gotten any acks for those
    await transport.check_close(ch)


@pytest.mark.asyncio
async def test_flow_control(transport: MockTransport, tmp_path: Path) -> None:
    bigun = tmp_path / 'bigun'
    total_bytes = 8 * 1024 * 1024
    recvd_bytes = 0
    bigun.write_bytes(b'0' * total_bytes)
    fsread1 = await transport.check_open('fsread1', path=str(bigun), flow_control=True)

    # We should receive a number of blocks of initial data, each with a ping.
    # We save the pings to reply later.
    pings: 'deque[JsonObject]' = deque()

    async def recv_one():
        nonlocal recvd_bytes

        channel, data = await transport.next_frame()
        assert channel == fsread1
        assert data == b'0' * Channel.BLOCK_SIZE
        recvd_bytes += len(data)

        ping = await transport.next_msg('')
        assert ping['command'] == 'ping'
        assert ping['channel'] == fsread1
        assert ping['sequence'] == recvd_bytes
        pings.append(ping)

    while recvd_bytes < Channel.SEND_WINDOW:
        await recv_one()

    # We should stall out here.  Make sure nothing else arrives.
    await transport.assert_empty()

    # Start sending pongs and make sure we receive a new block of data for each
    # one (as the window extends)
    while recvd_bytes < total_bytes:
        ping = pings.popleft()
        transport.send_json('', **dict(ping, command='pong'))
        await recv_one()

    transport.send_close(fsread1)


@pytest.mark.asyncio
async def test_large_upload(event_loop: asyncio.AbstractEventLoop, transport: MockTransport, tmp_path: Path) -> None:
    fifo = str(tmp_path / 'pipe')
    os.mkfifo(fifo)

    sender = await transport.check_open('stream', spawn=['dd', f'of={fifo}'])
    # cockpit.js doesn't do flow control, so neither do we...
    chunk = b'0' * Channel.BLOCK_SIZE
    loops = 100
    for _ in range(loops):
        transport.send_data(sender, chunk)
    transport.send_done(sender)

    # we should be in a state now where we have a bunch of bytes queued up in
    # the bridge but they can't be delivered because nobody is reading from the
    # pipe...  make sure dd is still running and we didn't get any messages.
    await transport.assert_empty()

    # start draining now, and make sure we get everything we sent.
    with open(fifo, 'rb') as receiver:
        received = await event_loop.run_in_executor(None, receiver.read)
        assert len(received) == loops * Channel.BLOCK_SIZE

    # and now our done and close messages should come
    await transport.assert_msg('', command='done', channel=sender)
    await transport.assert_msg('', command='close', channel=sender)


class FsInfoClient:
    def __init__(self, transport: MockTransport, channel: str):
        self.transport = transport
        self.channel = channel
        self.state: JsonObject = {}

    @classmethod
    async def open(
            cls,
            transport: MockTransport,
            path: 'str | Path',
            attrs: Sequence[str] = ('type', 'target'),
            fnmatch: str = '*.txt',
            **kwargs: JsonValue
    ) -> 'FsInfoClient':
        channel = await transport.check_open('fsinfo', path=str(path), attrs=attrs,
                                             fnmatch=fnmatch, reply_keys=None,
                                             absent_keys=(), **kwargs)
        return cls(transport, channel)

    async def next_state(self) -> JsonObject:
        while True:
            patch = await self.transport.next_msg(self.channel)
            self.state = json_merge_patch(self.state, patch)
            if not get_bool(self.state, 'partial', None):
                break
        return self.state

    async def wait(self) -> JsonObject:
        state = await self.next_state()
        await self.transport.assert_msg('', command='done', channel=self.channel)
        await self.transport.assert_msg('', command='close', channel=self.channel)
        return state

    async def close(self):
        await self.transport.check_close(self.channel)


def fsinfo_err(err: int) -> JsonObject:
    problems = {
        errno.ENOENT: 'not-found',
        errno.EPERM: 'access-denied',
        errno.EACCES: 'access-denied',
        errno.ENOTDIR: 'not-directory'
    }
    return {
        'error': {
            'problem': problems.get(err, 'internal-error'),
            'message': os.strerror(err),
            'errno': errno.errorcode[err],
        }
    }


@pytest.fixture
def fsinfo_test_cases(tmp_path: Path) -> 'dict[Path, JsonObject]':
    # a normal directory
    normal_dir = tmp_path / 'dir'
    normal_dir.mkdir()
    (normal_dir / 'dir-file.txt').write_text('dir file')
    (normal_dir / 'dir-file.xtx').write_text('do not read this')

    # a directory without +x (search)
    no_x_dir = tmp_path / 'no-x-dir'
    no_x_dir.mkdir()
    (no_x_dir / 'no-x-dir-file.txt').write_text('file')
    no_x_dir.chmod(0o644)

    # a directory without +r (read)
    no_r_dir = tmp_path / 'no-r-dir'
    no_r_dir.mkdir()
    (no_r_dir / 'no-r-dir-file.txt').write_text('file')
    no_r_dir.chmod(0o311)

    # a normal file
    file = tmp_path / 'file'
    file.write_text('normal file')

    # a non-readable file
    no_r_file = tmp_path / 'no-r-file'
    no_r_file.write_text('inaccessible file')
    no_r_file.chmod(0)

    # a device
    dev = tmp_path / 'dev'
    dev.symlink_to('/dev/null')

    # a dangling symlink
    dangling = tmp_path / 'dangling'
    dangling.symlink_to('does-not-exist')

    # a symlink pointing to itself
    loopy = tmp_path / 'loopy'
    loopy.symlink_to(loopy)

    expected_state: 'dict[Path, JsonObject]' = {
        normal_dir: {"info": {"type": "dir", "entries": {'dir-file.txt': {"type": "reg"}}}},

        # can't stat() the file
        no_x_dir: {"info": {"type": "dir", "entries": {"no-x-dir-file.txt": {}}}},

        # can't read the directory, so no entries
        no_r_dir: {"info": {"type": "dir"}},

        # normal file, can read its contents
        file: {"info": {"type": "reg"}},

        # can't read file, so no contents
        no_r_file: {"info": {"type": "reg"}},

        # a device
        dev: {"info": {"type": "chr"}},

        # a dangling symlink
        dangling: fsinfo_err(errno.ENOENT),

        # a link pointing at itself
        loopy: fsinfo_err(errno.ELOOP),
    }

    if os.getuid() == 0:
        # we can't do the permissions-dependent tests as root
        del expected_state[no_x_dir]
        del expected_state[no_r_dir]
        del expected_state[no_r_file]

    return expected_state


@pytest.mark.asyncio
async def test_fsinfo_nopath(transport: MockTransport) -> None:
    await transport.check_open('fsinfo', attrs=['type'], problem='protocol-error')


@pytest.mark.asyncio
async def test_fsinfo_noattrs(transport: MockTransport) -> None:
    await transport.check_open('fsinfo', path='/', problem='protocol-error')


@pytest.mark.asyncio
async def test_fsinfo_relative(transport: MockTransport) -> None:
    await transport.check_open('fsinfo', path='rel', problem='protocol-error')
    await transport.check_open('fsinfo', path='.', problem='protocol-error')


@pytest.mark.asyncio
async def test_fsinfo_nofollow_watch(transport: MockTransport) -> None:
    await transport.check_open('fsinfo', path='/', attrs=[], watch=True, follow=False, problem='protocol-error')


@pytest.mark.asyncio
async def test_fsinfo_nofollow_targets(transport: MockTransport) -> None:
    await transport.check_open('fsinfo', path='/', attrs=['targets'], follow=False, problem='protocol-error')


@pytest.mark.asyncio
async def test_fsinfo_empty_update(transport: MockTransport, tmp_path: Path) -> None:
    # test an empty update — make sure nothing lands on the wire
    ch = await transport.check_open('fsinfo', path=str(tmp_path), attrs=['type'], watch=True)
    assert await transport.next_msg(ch) == {'info': {"type": "dir"}}
    tmp_path.touch()
    await asyncio.sleep(0.1)  # fsinfo waits 0.1 before dispatching updates
    await transport.assert_empty()  # this waits another 0.1
    await transport.check_close(ch)


@pytest.mark.asyncio
async def test_fsinfo(transport: MockTransport, fsinfo_test_cases: 'dict[Path, JsonObject]') -> None:
    for path, expected_state in fsinfo_test_cases.items():
        client = await FsInfoClient.open(transport, path)
        assert await client.wait() == expected_state


@pytest.mark.asyncio
async def test_fsinfo_nofollow(transport: MockTransport, fsinfo_test_cases: 'dict[Path, JsonObject]') -> None:
    for path, expected_state in fsinfo_test_cases.items():
        if path.name == 'loopy':
            # with nofollow, this won't fail — we'll see the link itself
            expected_state = {"info": {"type": "lnk", "target": str(path)}}
        elif path.name == 'dev':
            expected_state = {"info": {"type": "lnk", "target": "/dev/null"}}
        elif path.name == 'dangling':
            expected_state = {"info": {"type": "lnk", "target": "does-not-exist"}}

        client = await FsInfoClient.open(transport, path, follow=False)
        assert await client.wait() == expected_state


@pytest.mark.asyncio
async def test_fsinfo_onlydir(transport: MockTransport, fsinfo_test_cases: 'dict[Path, JsonObject]') -> None:
    for path, expected_state in fsinfo_test_cases.items():
        if 'dir' not in path.name and 'error' not in expected_state:
            expected_state = fsinfo_err(errno.ENOTDIR)

        # with '/' appended, this should only open dirs
        client = await FsInfoClient.open(transport, str(path) + '/')
        assert await client.wait() == expected_state


@pytest.mark.asyncio
async def test_fsinfo_onlydir_watch(transport: MockTransport, fsinfo_test_cases: 'dict[Path, JsonObject]') -> None:
    for path, expected_state in fsinfo_test_cases.items():
        # note the order here: because our check for notdir is implemented
        # inside of the bridge, we try inotify first and check for notdir
        # second.  if systemd_ctypes supports this some day, it may change.
        if path.name.startswith('no-r'):
            # we need this one because we can't inotify files without +r
            expected_state = fsinfo_err(errno.EACCES)
        elif 'dir' not in path.name and 'error' not in expected_state:
            # and this one to deal with not-dir
            expected_state = fsinfo_err(errno.ENOTDIR)

        # with '/' appended, this should only open dirs
        client = await FsInfoClient.open(transport, str(path) + '/', watch=True)
        assert await client.next_state() == expected_state
        await client.close()


@pytest.mark.asyncio
async def test_fsinfo_watch_identity_changes(
        transport: MockTransport, tmp_path: Path, fsinfo_test_cases: 'dict[Path, JsonObject]'
) -> None:
    # we will now point a symlink to the various possibilities to make sure the
    # transitions are correctly handled
    link = tmp_path / 'link'
    client = await FsInfoClient.open(transport, link, watch=True)

    # we didn't make a link yet, so...
    assert (await client.next_state()) == fsinfo_err(errno.ENOENT)

    # in watch mode we report errors a bit more sensitively: we also report
    # them if we can't inotify the inode in question, which requires +r
    # permission.  as such, we need to modify our 'no-r' tests:
    for path in list(fsinfo_test_cases):
        if path.name.startswith('no-r'):
            fsinfo_test_cases[path] = fsinfo_err(errno.EACCES)
        if path.name == 'dangling':
            # this breaks our logic below because we transition from ENOENT to ENOENT
            del fsinfo_test_cases[path]

    possibilities = tuple(fsinfo_test_cases)
    for from_file in possibilities:
        for to_file in possibilities:
            if from_file is to_file:
                continue

            # link to the original file and check state
            link.symlink_to(from_file)
            assert await client.next_state() == fsinfo_test_cases[from_file]

            # Try to generate some events immediately before we switch the link
            # to ensure the event is suppressed.  Any one of these could fail
            # due to not being a directory or not having permissions.
            with contextlib.suppress(OSError):
                from_file.touch()
            with contextlib.suppress(OSError):
                (from_file / 'a.txt').touch()
            with contextlib.suppress(OSError):
                (from_file / 'a.txt').unlink()

            # atomic replace, check state
            (tmp_path / 'tmp').symlink_to(to_file)
            (tmp_path / 'tmp').rename(link)
            assert await client.next_state() == fsinfo_test_cases[to_file]

            if to_file.name == 'dir':
                # copied from fsinfo_test_cases fixture
                dir_entries = {'dir-file.txt': {"type": "reg"}}
                expected_state = {"info": {"type": "dir", "entries": dir_entries}}

                (to_file / 'a.txt').write_text('a file')
                dir_entries['a.txt'] = {"type": "reg"}
                (to_file / 'b.txt').write_text('b file')
                dir_entries['b.txt'] = {"type": "reg"}
                (to_file / 'a.xtx').write_text('b file')
                (to_file / 'b.xtx').write_text('b file')
                assert await client.next_state() == expected_state

                (to_file / 'a.xtx').unlink()
                (to_file / 'b.xtx').unlink()
                (to_file / 'dir.txt').mkdir()
                dir_entries['dir.txt'] = {"type": "dir"}
                (to_file / 'sym.txt').symlink_to('/x')
                dir_entries['sym.txt'] = {"type": "lnk", "target": "/x"}
                assert await client.next_state() == expected_state

                (to_file / 'sym.txt').unlink()
                del dir_entries['sym.txt']
                assert await client.next_state() == expected_state

                # we intentionally try not to receive these events — we want
                # them to get lost when the identity changes, below
                (to_file / 'dir.txt').rmdir()
                (to_file / 'a.txt').unlink()
                (to_file / 'b.txt').unlink()

            # delete link to start over
            link.unlink()
            assert (await client.next_state()) == fsinfo_err(errno.ENOENT)

        # let the pending event handler occasionally run to find nothing to process
        await asyncio.sleep(0.15)

    await client.close()


@pytest.mark.asyncio
async def test_fsinfo_self_owner(transport: MockTransport, tmp_path: Path) -> None:
    client = await FsInfoClient.open(transport, tmp_path, ['user', 'uid', 'group', 'gid'])
    state = await client.wait()
    info = get_dict(state, 'info')

    assert get_int(info, 'uid') == os.getuid()
    assert get_int(info, 'gid') == os.getgid()
    assert info.get('user') == getpass.getuser()
    assert info.get('group') == grp.getgrgid(os.getgid()).gr_name  # hopefully true...


@pytest.mark.asyncio
async def test_fsinfo_other_owner(transport: MockTransport, tmp_path: Path) -> None:
    tmpfile = tmp_path / 'x'
    tmpfile.touch()

    # try to get root to own this thing using a couple of tricks that may work
    # inside or outside of toolbox or containers
    quoted = shlex.quote(str(tmpfile))
    subprocess.run(fr'''
        podman unshare chown 888:888 {quoted} || SUDO_ASKPASS=true sudo -A chown 0:0 '{quoted}'
    ''', shell=True, check=False)

    # verify that we ended up with a uid/gid with no user
    buf = tmpfile.stat()
    try:
        pwd.getpwuid(buf.st_uid)
        pytest.skip('Failed to find unmapped uid')
    except KeyError:
        pass  # good!
    try:
        grp.getgrgid(buf.st_gid)
        pytest.skip('Failed to find unmapped gid')
    except KeyError:
        pass  # good!

    client = await FsInfoClient.open(transport, tmpfile, ['user', 'uid', 'group', 'gid'])
    state = await client.wait()
    info = get_dict(state, 'info')

    assert get_int(info, 'uid') == buf.st_uid
    assert get_int(info, 'gid') == buf.st_gid
    assert info.get('user') == buf.st_uid  # numeric fallback
    assert info.get('group') == buf.st_gid  # numeric fallback


@pytest.mark.asyncio
async def test_fsinfo_targets(transport: MockTransport, tmp_path: Path) -> None:
    # we are only interested in the things that start with 'l'
    watch = await FsInfoClient.open(transport, tmp_path, ['type', 'target', 'targets'], fnmatch='l*', watch=True)

    entries: JsonDict = {}
    targets: JsonDict = {}
    state = {"info": {"type": "dir", "entries": entries, "targets": targets}}
    assert await watch.next_state() == state

    # none of those will show up in entries (not 'l*')
    (tmp_path / 'dir').mkdir()
    (tmp_path / 'dir' / 'file').write_text('abc')
    (tmp_path / 'dir' / 'lonely').write_text('abc')
    (tmp_path / 'dir' / 'dir').mkdir()
    (tmp_path / 'file').write_text('abc')
    (tmp_path / 'Lonely').write_text('abc')

    # this one will show up in entries because it matches 'l*'
    (tmp_path / 'loved').write_text('abc')
    entries['loved'] = {'type': 'reg'}

    # a link that won't show up anywhere (no fnmatch)
    (tmp_path / 'LonelyLink').symlink_to('dir/lonely')

    # link to things that will land in targets because they're not in fnmatch
    (tmp_path / 'lfile').symlink_to('file')
    entries['lfile'] = {'type': 'lnk', 'target': 'file'}
    targets['file'] = {'type': 'reg'}
    (tmp_path / 'ldir').symlink_to('dir')
    entries['ldir'] = {'type': 'lnk', 'target': 'dir'}
    targets['dir'] = {'type': 'dir'}

    # link to things that will land in targets because they're in another dir
    (tmp_path / 'ldirfile').symlink_to('dir/file')
    entries['ldirfile'] = {'type': 'lnk', 'target': 'dir/file'}
    targets['dir/file'] = {'type': 'reg'}
    (tmp_path / 'ldirdir').symlink_to('dir/dir')
    entries['ldirdir'] = {'type': 'lnk', 'target': 'dir/dir'}
    targets['dir/dir'] = {'type': 'dir'}
    (tmp_path / 'lnull').symlink_to('/dev/null')
    entries['lnull'] = {'type': 'lnk', 'target': '/dev/null'}
    targets['/dev/null'] = {'type': 'chr'}
    (tmp_path / 'lroot').symlink_to('/')
    entries['lroot'] = {'type': 'lnk', 'target': '/'}
    targets['/'] = {'type': 'dir'}

    # link to things that won't land in targets because they're in entries
    (tmp_path / 'llfile').symlink_to('lfile')
    entries['llfile'] = {'type': 'lnk', 'target': 'lfile'}
    (tmp_path / 'lldir').symlink_to('ldir')
    entries['lldir'] = {'type': 'lnk', 'target': 'ldir'}
    (tmp_path / 'lloved').symlink_to('loved')
    entries['lloved'] = {'type': 'lnk', 'target': 'loved'}

    # make sure the watch managed to pick that all up
    assert await watch.next_state() == state

    # double-check with the non-watch variant
    client = await FsInfoClient.open(transport, tmp_path, ['type', 'target', 'targets'], fnmatch='l*')
    assert await client.wait() == state
