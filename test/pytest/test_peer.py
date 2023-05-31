import asyncio
import os
import sys

import pytest

from cockpit.peer import ConfiguredPeer, PeerRoutingRule
from cockpit.protocol import CockpitProtocolError
from cockpit.router import Router

from . import mockpeer
from .mocktransport import MockTransport, assert_no_subprocesses, settle_down

PEER_CONFIG = {
    "spawn": [sys.executable, mockpeer.__file__],
    "environ": ['PYTHONPATH=' + ':'.join(sys.path)],
    "match": {"payload": "test"},
}


class Bridge(Router):
    def __init__(self):
        rule = PeerRoutingRule(self, PEER_CONFIG)
        super().__init__([rule])

    def do_send_init(self):
        pass


@pytest.fixture
def bridge():
    yield Bridge()
    assert_no_subprocesses()


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

    # the processes should exit without needing to take the bridge down
    await settle_down()


@pytest.mark.asyncio
@pytest.mark.parametrize('init_type', ['wrong-command', 'channel-control', 'data', 'break-protocol'])
async def test_init_failure(rule, init_type, monkeypatch, transport):
    monkeypatch.setenv('INIT_TYPE', init_type)
    await transport.check_open('test', problem='protocol-error')
    await settle_down()


@pytest.mark.asyncio
async def test_immediate_shutdown(rule):
    peer = rule.apply_rule({'payload': 'test'})
    assert peer is not None
    peer.close()
    await settle_down()


@pytest.mark.asyncio
async def test_shutdown_before_init(monkeypatch, transport, rule):
    monkeypatch.setenv('INIT_TYPE', 'silence')
    channel = transport.send_open('test')
    assert rule.peer is not None
    assert rule.peer.transport is None
    while rule.peer.transport is None:
        await asyncio.sleep(0)
    rule.peer.close()
    await transport.assert_msg('', command='close', channel=channel, problem='terminated')
    await settle_down()


@pytest.mark.asyncio
async def test_exit_without_init(monkeypatch, transport):
    monkeypatch.setenv('INIT_TYPE', 'exit')
    await transport.check_open('test', problem='terminated')
    await settle_down()


@pytest.mark.asyncio
async def test_exit_not_found(monkeypatch, transport):
    monkeypatch.setenv('INIT_TYPE', 'exit-not-found')
    await transport.check_open('test', problem='no-cockpit')
    await settle_down()


@pytest.mark.asyncio
async def test_killed(monkeypatch, transport, rule):
    channel = await transport.check_open('test')
    os.kill(rule.peer.transport._process.pid, 9)
    await transport.assert_msg('', command='close', channel=channel, problem='terminated')
    await settle_down()


@pytest.mark.asyncio
@pytest.mark.parametrize('init_type', ['wrong-command', 'channel-control', 'data', 'break-protocol'])
async def test_await_failure(init_type, monkeypatch, bridge):
    monkeypatch.setenv('INIT_TYPE', init_type)
    peer = ConfiguredPeer(bridge, PEER_CONFIG)
    with pytest.raises(CockpitProtocolError):
        await peer.start()
    peer.close()
    await settle_down()


@pytest.mark.asyncio
async def test_await_broken_connect(bridge):
    class BrokenConnect(ConfiguredPeer):
        async def do_connect_transport(self):
            _ = 42 / 0

    peer = BrokenConnect(bridge, PEER_CONFIG)
    with pytest.raises(ZeroDivisionError):
        await peer.start()
    peer.close()
    await settle_down()


@pytest.mark.asyncio
async def test_await_broken_after_connect(bridge):
    class BrokenConnect(ConfiguredPeer):
        async def do_connect_transport(self):
            await super().do_connect_transport()
            _ = 42 / 0

    peer = BrokenConnect(bridge, PEER_CONFIG)
    with pytest.raises(ZeroDivisionError):
        await peer.start()
    peer.close()
    await settle_down()


class CancellableConnect(ConfiguredPeer):
    was_cancelled = False

    async def do_connect_transport(self):
        await super().do_connect_transport()
        try:
            # We should get cancelled here when the mockpeer sends "init"
            await asyncio.sleep(10000)
        except asyncio.CancelledError:
            self.was_cancelled = True
            raise


@pytest.mark.asyncio
async def test_await_cancellable_connect_init(bridge):
    peer = CancellableConnect(bridge, PEER_CONFIG)
    await peer.start()
    peer.close()
    await settle_down()
    assert peer.was_cancelled


@pytest.mark.asyncio
async def test_await_cancellable_connect_close(monkeypatch, event_loop, bridge):
    monkeypatch.setenv('INIT_TYPE', 'silence')  # make sure we never get "init"
    peer = CancellableConnect(bridge, PEER_CONFIG)
    event_loop.call_later(0.1, peer.close)  # call peer.close() after .start() is running
    with pytest.raises(asyncio.CancelledError):
        await peer.start()
    # we already called .close()
    await settle_down()
    assert peer.was_cancelled
