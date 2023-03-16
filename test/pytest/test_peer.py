import asyncio
import os
import sys

import pytest

from cockpit.router import Router
from cockpit.peer import PeerRoutingRule

import mockpeer
from mocktransport import MockTransport, assert_no_subprocesses, settle_down


class Bridge(Router):
    def __init__(self):
        rule = PeerRoutingRule(self, {
            "spawn": [sys.executable, mockpeer.__file__],
            "environ": ['PYTHONPATH=' + ':'.join(sys.path)],
            "match": {"payload": "test"},
        })
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
    await transport.assert_msg('', command='close', channel='channel.1', problem='peer-disconnected')

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
    await transport.assert_msg('', command='close', channel=channel, problem='peer-disconnected')
    await settle_down()


@pytest.mark.asyncio
async def test_exit_without_init(monkeypatch, transport):
    monkeypatch.setenv('INIT_TYPE', 'exit')
    await transport.check_open('test', problem='peer-disconnected')
    await settle_down()


@pytest.mark.asyncio
async def test_killed(monkeypatch, transport, rule):
    channel = await transport.check_open('test')
    os.kill(rule.peer.transport._process.pid, 9)
    await transport.assert_msg('', command='close', channel=channel, problem='peer-disconnected')
    await settle_down()
