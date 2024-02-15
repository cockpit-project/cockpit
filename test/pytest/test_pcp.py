import argparse
import asyncio
import json
from typing import Iterable

import pytest
from cpmapi import PM_ID_NULL, PM_INDOM_NULL, PM_SEM_INSTANT, PM_TYPE_U32
from pcp import pmi

from cockpit.bridge import Bridge

from .mocktransport import MockTransport


# HACK: copied
@pytest.fixture
def bridge() -> Bridge:
    bridge = Bridge(argparse.Namespace(privileged=False, beipack=False))
    bridge.superuser_bridges = list(bridge.superuser_rule.bridges)  # type: ignore[attr-defined]
    return bridge


# HACK: copied
@pytest.fixture
def no_init_transport(event_loop: asyncio.AbstractEventLoop, bridge: Bridge) -> Iterable[MockTransport]:
    transport = MockTransport(bridge)
    try:
        yield transport
    finally:
        transport.stop(event_loop)


# HACK: copied
@pytest.fixture
def transport(no_init_transport: MockTransport) -> MockTransport:
    no_init_transport.init()
    return no_init_transport


@pytest.fixture
def test_broken_archive(tmpdir_factory):
    pcp_dir = tmpdir_factory.mktemp('mock-archives')

    with open(pcp_dir / '0.index', 'w') as f:
        f.write("not a pcp index file")
    with open(pcp_dir / '0.meta', 'w') as f:
        f.write("not a pcp meta file")
    with open(pcp_dir / '0.0', 'w') as f:
        f.write("not a pcp sample file")

    return pcp_dir


@pytest.fixture
def test_archive(tmpdir_factory):
    pcp_dir = tmpdir_factory.mktemp('mock-archives')
    archive_1 = pmi.pmiLogImport(f"{pcp_dir}/0")
    archive_1.pmiAddMetric("mock.value", PM_ID_NULL, PM_TYPE_U32, PM_INDOM_NULL,
                           PM_SEM_INSTANT, archive_1.pmiUnits(0, 0, 0, 0, 0, 0))
    archive_1.pmiPutValue("mock.value", None, "10")
    archive_1.pmiWrite(0, 0)
    archive_1.pmiPutValue("mock.value", None, "11")
    archive_1.pmiWrite(1, 0)
    archive_1.pmiPutValue("mock.value", None, "12")
    archive_1.pmiWrite(2, 0)
    archive_1.pmiEnd()

    archive_2 = pmi.pmiLogImport(f"{pcp_dir}/1")
    archive_2.pmiAddMetric("mock.value", PM_ID_NULL, PM_TYPE_U32,
                           PM_INDOM_NULL, PM_SEM_INSTANT,
                           archive_2.pmiUnits(0, 0, 0, 0, 0, 0))
    archive_2.pmiAddMetric("mock.late", PM_ID_NULL, PM_TYPE_U32, PM_INDOM_NULL,
                           PM_SEM_INSTANT, archive_2.pmiUnits(0, 0, 0, 0, 0, 0))
    archive_2.pmiPutValue("mock.value", None, "13")
    archive_2.pmiPutValue("mock.late", None, "30")
    archive_2.pmiWrite(3, 0)
    archive_2.pmiPutValue("mock.value", None, "14")
    archive_2.pmiPutValue("mock.late", None, "31")
    archive_2.pmiWrite(4, 0)
    archive_2.pmiPutValue("mock.value", None, "15")
    archive_2.pmiPutValue("mock.late", None, "32")
    archive_2.pmiWrite(5, 0)
    archive_2.pmiEnd()

    return pcp_dir


@pytest.mark.asyncio
async def test_pcp_open_error(transport, test_archive):
    await transport.check_open('metrics1', source=str(test_archive), interval=-10, problem='protocol-error',
                               reply_keys={'message': 'invalid "interval" value: -10'})
    await transport.check_open('metrics1', problem='protocol-error',
                               reply_keys={'message': 'no "source" option specified for metrics channel'})
    await transport.check_open('metrics1', source="bazinga", problem='not-supported',
                               reply_keys={'message': 'unsupported "source" option specified for metrics: bazinga'})
    await transport.check_open('metrics1', source="/non-existant", problem='not-found')
    await transport.check_open('metrics1', source=str(test_archive),
                               metrics=[{"name": "mock.blah", "derive": "rate"}],
                               problem='not-found',
                               reply_keys={'message': 'no such metric: mock.blah'})


@pytest.mark.asyncio
async def test_pcp_open(transport, test_archive):
    _ = await transport.check_open('metrics1', source=str(test_archive),
                                   metrics=[{"name": "mock.value", "derive": "rate"}])

    _, data = await transport.next_frame()
    # first message is always the meta message
    meta = json.loads(data)
    # C bridge
    # {"timestamp":0,"now":1708092219642,"interval":1000,
    #  "metrics":[{"name":"mock.value","units":"","semantics":"instant"}]}

    assert meta['timestamp'] == 0
    assert meta['interval'] == 1000  # default interval
    assert meta['source'] == str(test_archive)

    metrics = meta['metrics']
    assert len(metrics) == 1

    metric = metrics[0]
    assert metric['name'] == 'mock.value'
    assert metric['derive'] == 'rate'
    assert metric['semantic'] == 'instant'


@pytest.mark.asyncio
async def test_pcp_broken_archive(transport, test_broken_archive):
    await transport.check_open('metrics1', source=str(test_broken_archive),
                               metrics=[{"name": "mock.value", "derive": "rate"}],
                               problem='not-found',
                               reply_keys={'message': f'could not read archive {test_broken_archive}/0.index'})
