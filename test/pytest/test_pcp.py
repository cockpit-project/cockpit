import argparse
import asyncio
import datetime
import json
import sys
import time
from typing import Iterable

import pytest

# Skip import when PCP is not available (for example in our tox env without system packages)
try:
    from cpmapi import (
        PM_ID_NULL,
        PM_INDOM_NULL,
        PM_SEM_COUNTER,
        PM_SEM_DISCRETE,
        PM_SEM_INSTANT,
        PM_TYPE_64,
        PM_TYPE_DOUBLE,
        PM_TYPE_STRING,
        PM_TYPE_U32,
        PM_TYPE_U64,
    )
    from pcp import pmi
except ImportError:
    pytestmark = pytest.mark.skip("PCP not available")

from cockpit.bridge import Bridge

from .mocktransport import MockTransport


@pytest.fixture
def no_init_transport(event_loop: asyncio.AbstractEventLoop) -> Iterable[MockTransport]:
    bridge = Bridge(argparse.Namespace(privileged=False, beipack=False))
    transport = MockTransport(bridge)
    try:
        yield transport
    finally:
        transport.stop(event_loop)


@pytest.fixture
def transport(no_init_transport: MockTransport) -> MockTransport:
    no_init_transport.init()
    return no_init_transport


@pytest.fixture
def broken_archive(tmpdir_factory):
    pcp_dir = tmpdir_factory.mktemp('mock-archives')

    with open(pcp_dir / '0.index', 'w') as f:
        f.write("not a pcp index file")
    with open(pcp_dir / '0.meta', 'w') as f:
        f.write("not a pcp meta file")
    with open(pcp_dir / '0.0', 'w') as f:
        f.write("not a pcp sample file")

    return pcp_dir


@pytest.fixture
def discrete_metric_archive(tmpdir_factory):
    pcp_dir = tmpdir_factory.mktemp('discrete-archive')
    archive_1 = pmi.pmiLogImport(f"{pcp_dir}/0")
    archive_1.pmiAddMetric("mock.value", PM_ID_NULL, PM_TYPE_64, PM_INDOM_NULL,
                           PM_SEM_DISCRETE, archive_1.pmiUnits(0, 0, 0, 0, 0, 0))

    archive_1.pmiPutValue("mock.value", None, "4")
    archive_1.pmiWrite(0, 0)

    archive_1.pmiEnd()

    return pcp_dir


@pytest.fixture
def big_archive(tmpdir_factory):
    pcp_dir = tmpdir_factory.mktemp('big-archive')
    archive_1 = pmi.pmiLogImport(f"{pcp_dir}/0")
    archive_1.pmiAddMetric("mock.value", PM_ID_NULL, PM_TYPE_64, PM_INDOM_NULL,
                           PM_SEM_INSTANT, archive_1.pmiUnits(0, 0, 0, 0, 0, 0))
    for i in range(1000):
        archive_1.pmiPutValue("mock.value", None, str(i))
        archive_1.pmiWrite(i, 0)

    archive_1.pmiEnd()

    return pcp_dir


@pytest.fixture
def multi_file_archive(tmpdir_factory):
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


@pytest.fixture
def timestamps_archive(tmpdir_factory):
    pcp_dir = tmpdir_factory.mktemp('timestamps-archives')
    archive_1 = pmi.pmiLogImport(f"{pcp_dir}/0")

    archive_1.pmiAddMetric("mock.value", PM_ID_NULL, PM_TYPE_U32, PM_INDOM_NULL,
                           PM_SEM_INSTANT, archive_1.pmiUnits(0, 0, 0, 0, 0, 0))

    timestamp = int(datetime.datetime.fromisoformat('2023-01-01').timestamp())
    archive_1.pmiPutValue("mock.value", None, "10")
    archive_1.pmiWrite(timestamp, 0)

    timestamp = int(datetime.datetime.fromisoformat('2023-06-01').timestamp())
    archive_1.pmiPutValue("mock.value", None, "11")
    archive_1.pmiWrite(timestamp, 0)

    timestamp = int(datetime.datetime.fromisoformat('2023-12-01').timestamp())
    archive_1.pmiPutValue("mock.value", None, "12")
    archive_1.pmiWrite(timestamp, 0)

    archive_1.pmiEnd()

    return pcp_dir


@pytest.fixture
def instances_archive(tmpdir_factory):
    pcp_dir = tmpdir_factory.mktemp('instances-archives')
    archive_1 = pmi.pmiLogImport(f"{pcp_dir}/0")

    domain = 60  # Linux kernel
    pmid = archive_1.pmiID(domain, 2, 0)
    indom = archive_1.pmiInDom(domain, 2)
    units = archive_1.pmiUnits(0, 0, 0, 0, 0, 0)

    archive_1.pmiAddMetric("kernel.all.load", pmid, PM_TYPE_DOUBLE, indom,
                           PM_SEM_INSTANT, units)
    archive_1.pmiAddInstance(indom, "1 minute", 1)
    archive_1.pmiAddInstance(indom, "5 minute", 5)
    archive_1.pmiAddInstance(indom, "15 minute", 15)

    archive_1.pmiPutValue("kernel.all.load", "1 minute", "1.0")
    archive_1.pmiPutValue("kernel.all.load", "5 minute", "5.0")
    archive_1.pmiPutValue("kernel.all.load", "15 minute", "15.0")
    archive_1.pmiWrite(0, 0)

    archive_1.pmiEnd()

    return pcp_dir


@pytest.fixture
def instances_change_archive(tmpdir_factory):
    pcp_dir = tmpdir_factory.mktemp('instances-change-archives')
    archive_1 = pmi.pmiLogImport(f"{pcp_dir}/0")

    domain = 60  # Linux kernel
    pmid = archive_1.pmiID(domain, 2, 0)
    indom = archive_1.pmiInDom(domain, 2)
    units = archive_1.pmiUnits(0, 0, 0, 0, 0, 0)

    archive_1.pmiAddMetric("network.interface.total.bytes", pmid, PM_TYPE_U32, indom,
                           PM_SEM_COUNTER, units)
    archive_1.pmiAddInstance(indom, "lo", 1)
    archive_1.pmiAddInstance(indom, "eth0", 2)
    archive_1.pmiAddInstance(indom, "eth1", 3)

    archive_1.pmiPutValue("network.interface.total.bytes", "lo", "1")
    archive_1.pmiPutValue("network.interface.total.bytes", "eth0", "0")
    archive_1.pmiPutValue("network.interface.total.bytes", "eth1", "1")
    archive_1.pmiWrite(1597663539413, 0)

    archive_1.pmiPutValue("network.interface.total.bytes", "lo", "2")
    archive_1.pmiPutValue("network.interface.total.bytes", "eth0", "1")
    archive_1.pmiWrite(1597663539483, 0)

    archive_1.pmiEnd()

    return pcp_dir


@pytest.fixture
def instances_rate_archive(tmpdir_factory):
    pcp_dir = tmpdir_factory.mktemp('instances-rate-archives')
    archive_1 = pmi.pmiLogImport(f"{pcp_dir}/0")

    domain = 60  # Linux kernel
    pmid = archive_1.pmiID(domain, 2, 0)
    indom = archive_1.pmiInDom(domain, 2)
    units = archive_1.pmiUnits(0, 0, 0, 0, 0, 0)

    archive_1.pmiAddMetric("disk.value", pmid, PM_TYPE_U32, indom,
                           PM_SEM_INSTANT, units)
    archive_1.pmiAddInstance(indom, "sda", 1)
    archive_1.pmiAddInstance(indom, "sdb", 2)
    archive_1.pmiAddInstance(indom, "sdc", 3)

    archive_1.pmiPutValue("disk.value", "sda", "1")
    archive_1.pmiPutValue("disk.value", "sdb", "1")
    archive_1.pmiPutValue("disk.value", "sdc", "1")
    archive_1.pmiWrite(0, 0)

    archive_1.pmiPutValue("disk.value", "sda", "1")
    archive_1.pmiPutValue("disk.value", "sdb", "1")
    archive_1.pmiPutValue("disk.value", "sdc", "2")
    archive_1.pmiWrite(1, 0)

    archive_1.pmiPutValue("disk.value", "sda", "1")
    archive_1.pmiPutValue("disk.value", "sdb", "10")
    archive_1.pmiPutValue("disk.value", "sdc", "3")
    archive_1.pmiWrite(2, 0)

    archive_1.pmiEnd()

    return pcp_dir


@pytest.fixture
def unsupported_metric_archive(tmpdir_factory):
    """Cockpit only support float/integer type metrics"""

    pcp_dir = tmpdir_factory.mktemp('unsupported-metric-archives')
    archive_1 = pmi.pmiLogImport(f"{pcp_dir}/0")
    archive_1.pmiAddMetric("mock.value", PM_ID_NULL, PM_TYPE_STRING, PM_INDOM_NULL,
                           PM_SEM_INSTANT, archive_1.pmiUnits(0, 0, 0, 0, 0, 0))

    archive_1.pmiPutValue("mock.value", None, b"10")
    archive_1.pmiWrite(0, 0)
    archive_1.pmiEnd()

    return pcp_dir


@pytest.fixture
def mem_avail_archive(tmpdir_factory):
    pcp_dir = tmpdir_factory.mktemp('mem-avail-archives')
    archive_1 = pmi.pmiLogImport(f"{pcp_dir}/0")

    # https://github.com/performancecopilot/pcp/blob/766a78e631998e97196eeed9cc36631f30add74b/src/collectl2pcp/metrics.c#L339
    # pminfo -m -f "mem.util.available"
    domain = 60  # Linux kernel
    pmid = archive_1.pmiID(domain, 1, 58)
    units = archive_1.pmiUnits(1, 0, 0, 1, 0, 0)

    archive_1.pmiAddMetric("mem.util.available", pmid, PM_TYPE_U64, PM_INDOM_NULL,
                           PM_SEM_INSTANT, units)

    archive_1.pmiPutValue("mem.util.available", None, "19362828")
    archive_1.pmiWrite(0, 0)

    archive_1.pmiEnd()

    return pcp_dir


def assert_metrics_meta(meta, source, timestamp=0, interval=1000):
    assert meta['timestamp'] == timestamp
    assert meta['interval'] == interval
    assert meta['source'] == source


@pytest.mark.asyncio
async def test_pcp_open_error(transport, multi_file_archive):
    await transport.check_open('metrics1', source=str(multi_file_archive), interval=-10, problem='protocol-error',
                               reply_keys={'message': 'invalid "interval" value: -10'})
    await transport.check_open('metrics1', problem='protocol-error',
                               reply_keys={'message': 'no "source" option specified for metrics channel'})
    await transport.check_open('metrics1', source="bazinga", problem='not-supported',
                               reply_keys={'message': 'unsupported "source" option specified for metrics: bazinga'})
    await transport.check_open('metrics1', source="/non-existant", problem='not-found')
    await transport.check_open('metrics1', source=str(multi_file_archive),
                               metrics=[{"name": ""}],
                               problem='protocol-error',
                               reply_keys={'message': 'invalid "metrics" option was specified (no name for metric)'})
    await transport.check_open('metrics1', source=str(multi_file_archive), limit=-10, problem='protocol-error',
                               reply_keys={'message': 'invalid "limit" value: -10'})
    invalid_timestamp_size = sys.maxsize * 1000 + 3
    await transport.check_open('metrics1', source=str(multi_file_archive), timestamp=invalid_timestamp_size,
                               problem='protocol-error',
                               reply_keys={'message': f'invalid "timestamp" value: {invalid_timestamp_size}'})
    await transport.check_open('metrics1', problem='protocol-error',
                               reply_keys={'message': 'no "source" option specified for metrics channel'})


@pytest.mark.asyncio
async def test_pcp_open(transport, multi_file_archive):
    await transport.check_open('metrics1', source=str(multi_file_archive),
                                    metrics=[{"name": "mock.value"}])

    _, data = await transport.next_frame()
    # first message is always the meta message
    meta = json.loads(data)
    assert_metrics_meta(meta, str(multi_file_archive))

    metrics = meta['metrics']
    assert len(metrics) == 1

    metric = metrics[0]
    assert metric['name'] == 'mock.value'
    assert 'derive' not in metric
    assert metric['semantics'] == 'instant'

    # assert_sample (tc, "[[10],[11],[12]]");
    _, data = await transport.next_frame()
    data = json.loads(data)
    assert data == [[10], [11], [12]]

    _, data = await transport.next_frame()
    # first message is always the meta message
    meta = json.loads(data)

    metrics = meta['metrics']
    assert len(metrics) == 1

    metric = metrics[0]
    assert metric['name'] == 'mock.value'
    assert 'derive' not in metric
    assert metric['semantics'] == 'instant'

    _, data = await transport.next_frame()
    data = json.loads(data)
    assert data == [[13], [14], [15]]


@pytest.mark.asyncio
async def test_pcp_big_archive(transport, big_archive):
    await transport.check_open('metrics1', source=str(big_archive),
                                   metrics=[{"name": "mock.value"}])

    _, data = await transport.next_frame()
    # first message is always the meta message
    meta = json.loads(data)

    assert_metrics_meta(meta, str(big_archive))
    metrics = meta['metrics']
    assert len(metrics) == 1

    metric = metrics[0]
    assert metric['name'] == 'mock.value'
    assert 'derive' not in metric
    assert metric['semantics'] == 'instant'

    _, data = await transport.next_frame()
    data = json.loads(data)
    # archives batch size is hardcoded to 60
    assert data == [[i] for i in range(60)]


@pytest.mark.asyncio
async def test_pcp_instances_option(transport, instances_archive):
    await transport.check_open('metrics1', source=str(instances_archive),
                                   metrics=[{"name": "kernel.all.load"}], instances=["1 minute"])

    _, data = await transport.next_frame()
    # first message is always the meta message
    meta = json.loads(data)

    assert_metrics_meta(meta, str(instances_archive))

    metrics = meta['metrics']
    assert len(metrics) == 1

    metric = metrics[0]
    assert metric['name'] == 'kernel.all.load'
    assert 'derive' not in metric
    assert metric['semantics'] == 'instant'
    assert metric['instances'] == ['1 minute']

    _, data = await transport.next_frame()
    data = json.loads(data)
    assert data == [[[1.0]]]


@pytest.mark.asyncio
async def test_pcp_omit_instances_option(transport, instances_archive):
    await transport.check_open('metrics1', source=str(instances_archive),
                                   metrics=[{"name": "kernel.all.load"}], omit_instances=["1 minute"])

    _, data = await transport.next_frame()
    # first message is always the meta message
    meta = json.loads(data)

    assert_metrics_meta(meta, str(instances_archive))

    metrics = meta['metrics']
    assert len(metrics) == 1

    metric = metrics[0]
    assert metric['name'] == 'kernel.all.load'
    assert 'derive' not in metric
    assert metric['semantics'] == 'instant'
    assert metric['instances'] == ['15 minute', '5 minute']

    _, data = await transport.next_frame()
    data = json.loads(data)
    assert data == [[[15.0, 5.0]]]


@pytest.mark.asyncio
async def test_pcp_instances(transport, instances_archive):
    await transport.check_open('metrics1', source=str(instances_archive),
                                   metrics=[{"name": "kernel.all.load"}])

    _, data = await transport.next_frame()
    # first message is always the meta message
    meta = json.loads(data)

    assert_metrics_meta(meta, str(instances_archive))

    metrics = meta['metrics']
    assert len(metrics) == 1

    metric = metrics[0]
    assert metric['name'] == 'kernel.all.load'
    assert 'derive' not in metric
    assert metric['semantics'] == 'instant'
    assert metric['instances'] == ['15 minute', '1 minute', '5 minute']

    _, data = await transport.next_frame()
    data = json.loads(data)
    assert data == [[[15.0, 1.0, 5.0]]]


@pytest.mark.asyncio
async def test_pcp_timestamp(transport, timestamps_archive):
    timestamp = int(datetime.datetime.fromisoformat('2023-07-01').timestamp()) * 1000
    await transport.check_open('metrics1', source=str(timestamps_archive),
                                   metrics=[{"name": "mock.value"}], limit=1,
                                   timestamp=timestamp)

    _, data = await transport.next_frame()
    # first message is always the meta message
    meta = json.loads(data)

    assert_metrics_meta(meta, str(timestamps_archive), timestamp=timestamp)

    metrics = meta['metrics']
    assert len(metrics) == 1

    metric = metrics[0]
    assert metric['name'] == 'mock.value'

    _, data = await transport.next_frame()
    data = json.loads(data)
    assert data == [[11.0]]


@pytest.mark.asyncio
async def test_pcp_negative_timestamp(transport, timestamps_archive):
    """ Given a negative timestamp the current time is taken and substracted
    with the given timestamp """

    timestamp = int(datetime.datetime.fromisoformat('2023-07-01').timestamp()) * 1000
    relative_timestamp = int(time.time() * 1000) - timestamp
    await transport.check_open('metrics1', source=str(timestamps_archive),
                                   metrics=[{"name": "mock.value"}], limit=1,
                                   timestamp=-relative_timestamp)

    _, data = await transport.next_frame()
    # first message is always the meta message
    meta = json.loads(data)
    # time.time() is not exact
    assert (meta['timestamp'] - timestamp) < 10

    metrics = meta['metrics']
    assert len(metrics) == 1

    metric = metrics[0]
    assert metric['name'] == 'mock.value'

    _, data = await transport.next_frame()
    data = json.loads(data)
    assert data == [[11.0]]


@pytest.mark.asyncio
async def test_pcp_limit_archive(transport, big_archive):
    await transport.check_open('metrics1', source=str(big_archive),
                                    limit=30,
                                    metrics=[{"name": "mock.value"}])

    _, data = await transport.next_frame()
    # first message is always the meta message
    meta = json.loads(data)
    assert_metrics_meta(meta, str(big_archive))

    _, data = await transport.next_frame()
    data = json.loads(data)
    assert data == [[i] for i in range(30)]

    _, data = await transport.next_frame()
    data = json.loads(data)
    assert data['command'] == 'close'


@pytest.mark.asyncio
async def test_pcp_broken_archive(transport, broken_archive):
    await transport.check_open('metrics1', source=str(broken_archive),
                               metrics=[{"name": "mock.value", "derive": "rate"}],
                               problem='not-found',
                               reply_keys={'message': f'could not read archive {broken_archive}/0.index'})


@pytest.mark.asyncio
async def test_pcp_instances_change(transport, instances_change_archive):
    await transport.check_open('metrics1', source=str(instances_change_archive),
                                    metrics=[{"name": "network.interface.total.bytes"}], limit=2)

    _, data = await transport.next_frame()
    # first message is always the meta message
    meta = json.loads(data)

    assert_metrics_meta(meta, str(instances_change_archive), 1597663539413000, 1000)
    metrics = meta['metrics'][0]
    assert metrics['instances'] == ['eth1', 'lo', 'eth0']

    _, data = await transport.next_frame()
    data = json.loads(data)
    assert data == [[[1, 1, 0]]]

    # eth1 is unplugged, new meta message
    _, data = await transport.next_frame()
    meta = json.loads(data)
    assert_metrics_meta(meta, str(instances_change_archive), 1597663539414000, 1000)
    metrics = meta['metrics'][0]
    assert metrics['instances'] == ['lo', 'eth0']

    _, data = await transport.next_frame()
    data = json.loads(data)
    assert data == [[[1, 0]]]


@pytest.mark.asyncio
async def test_pcp_scale_memory_unit(transport, mem_avail_archive):
    await transport.check_open('metrics1', source=str(mem_avail_archive),
                                   metrics=[{"name": "mem.util.available", "units": "bytes"}], limit=1)

    _, data = await transport.next_frame()
    meta = json.loads(data)

    assert_metrics_meta(meta, str(mem_avail_archive), 0, 1000)
    metric = meta['metrics'][0]
    assert metric['name'] == "mem.util.available"
    assert metric['units'] == "byte"
    assert metric['semantics'] == "instant"

    _, data = await transport.next_frame()
    data = json.loads(data)
    assert data == [[19827535872]]


@pytest.mark.asyncio
async def test_pcp_discrete_metric(transport, discrete_metric_archive):
    await transport.check_open('metrics1', source=str(discrete_metric_archive),
                                    metrics=[{"name": "mock.value"}])
    _, data = await transport.next_frame()

    meta = json.loads(data)
    assert_metrics_meta(meta, str(discrete_metric_archive), 0, 1000)
    metric = meta['metrics'][0]
    assert metric['name'] == "mock.value"
    assert metric['units'] == ""
    assert metric['semantics'] == "discrete"

    _, data = await transport.next_frame()
    data = json.loads(data)
    assert data == [[4]]


@pytest.mark.asyncio
async def test_pcp_rate_metric(transport, multi_file_archive):
    await transport.check_open('metrics1', source=str(multi_file_archive),
                                   metrics=[{"name": "mock.value", "derive": "rate"}])
    _, data = await transport.next_frame()

    meta = json.loads(data)
    assert_metrics_meta(meta, str(multi_file_archive))
    metric = meta['metrics'][0]
    assert metric['name'] == "mock.value"
    assert metric['units'] == ""
    assert metric['semantics'] == "instant"

    _, data = await transport.next_frame()
    data = json.loads(data)
    assert data == [[False], [1.0], [1.0]]

    # new archive, new meta
    _, data = await transport.next_frame()
    meta = json.loads(data)
    assert_metrics_meta(meta, str(multi_file_archive), timestamp=3000)

    _, data = await transport.next_frame()
    data = json.loads(data)
    assert data == [[False], [1.0], [1.0]]


@pytest.mark.asyncio
async def test_pcp_rate_instances(transport, instances_rate_archive):
    await transport.check_open('metrics1', source=str(instances_rate_archive),
                                   metrics=[{"name": "disk.value", "derive": "rate"}])
    _, data = await transport.next_frame()

    meta = json.loads(data)
    assert_metrics_meta(meta, str(instances_rate_archive))
    metric = meta['metrics'][0]
    assert metric['name'] == "disk.value"
    assert metric['derive'] == "rate"
    assert metric['semantics'] == "instant"

    _, data = await transport.next_frame()
    data = json.loads(data)
    assert data == [[[False, False, False]], [[1.0, 0.0, 0.0]], [[1.0, 0.0, 9.0]]]

    _, data = await transport.next_frame()
    data = json.loads(data)
    print(data)


@pytest.mark.asyncio
async def test_pcp_unsupported_metric(transport, unsupported_metric_archive):
    """Verify that the PCP channel does not crash on an unknown metric type"""
    await transport.check_open('metrics1', source=str(unsupported_metric_archive),
                                    metrics=[{"name": "mock.value"}])
    _, data = await transport.next_frame()

    meta = json.loads(data)
    assert_metrics_meta(meta, str(unsupported_metric_archive), 0, 1000)
