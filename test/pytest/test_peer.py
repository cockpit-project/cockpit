import asyncio
import os
import sys

import pytest

from cockpit.packages import BridgeConfig
from cockpit.peer import PeerRoutingRule
from cockpit.router import Router

from . import mockpeer
from .mocktransport import MockTransport

PEER_CONFIG = BridgeConfig({
    "spawn": [sys.executable, mockpeer.__file__],
    "environ": ['PYTHONPATH=' + ':'.join(sys.path)],
    "match": {"payload": "test"},
})


class Bridge(Router):
    init_host = 'localhost'

    def __init__(self):
        rule = PeerRoutingRule(self, PEER_CONFIG)
        super().__init__([rule])

    def do_send_init(self):
        pass


@pytest.fixture
def bridge(event_loop):
    bridge = Bridge()
    yield bridge
    while bridge.endpoints:
        event_loop.run_until_complete(asyncio.sleep(0.1))


@pytest.fixture
def transport(bridge):
    return MockTransport(bridge)


@pytest.fixture
def rule(bridge):
    return bridge.routing_rules[0]


@pytest.mark.asyncio
async def test_shutdown(transport, rule):
    await transport.check_open('test')
    await transport.check_open('xest', problem='not-supported')

    # Force the Peer closed
    rule.peer.close()
    await transport.assert_msg('', command='close', channel='channel.1', problem='terminated')

    # But it should spawn again
    await transport.check_open('test')
    await transport.check_open('xest', problem='not-supported')
    rule.peer.close()


@pytest.mark.asyncio
@pytest.mark.parametrize('init_type', ['wrong-command', 'channel-control', 'data', 'break-protocol'])
async def test_init_failure(rule, init_type, monkeypatch, transport):
    monkeypatch.setenv('INIT_TYPE', init_type)
    await transport.check_open('test', problem='protocol-error')


@pytest.mark.asyncio
async def test_immediate_shutdown(rule):
    peer = rule.apply_rule({'payload': 'test'})
    assert peer is not None
    rule.shutdown()


@pytest.mark.asyncio
async def test_shutdown_before_init(monkeypatch, transport, rule):
    monkeypatch.setenv('INIT_TYPE', 'silence')
    channel = transport.send_open('test')
    assert rule.peer is not None
    assert not rule.peer.transport_connected
    while not rule.peer.transport_connected:
        await asyncio.sleep(0)
    rule.peer.close()
    await transport.assert_msg('', command='close', channel=channel, problem='terminated')


@pytest.mark.asyncio
async def test_exit_without_init(monkeypatch, transport):
    monkeypatch.setenv('INIT_TYPE', 'exit')
    await transport.check_open('test', problem='terminated')


@pytest.mark.asyncio
async def test_exit_not_found(monkeypatch, transport):
    monkeypatch.setenv('INIT_TYPE', 'exit-not-found')
    await transport.check_open('test', problem='no-cockpit')


@pytest.mark.asyncio
async def test_killed(monkeypatch, transport, rule):
    channel = await transport.check_open('test')
    os.kill(rule.peer.transport.get_pid(), 9)
    await transport.assert_msg('', command='close', channel=channel, problem='terminated')
