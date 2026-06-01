#
# Copyright (C) 2026 Red Hat, Inc.
# SPDX-License-Identifier: GPL-3.0-or-later

import argparse
import asyncio
import ssl
from pathlib import Path
from typing import AsyncGenerator

import pytest
import pytest_asyncio

from cockpit.bridge import Bridge

from .mocktransport import MockTransport

MOCK_DATA = Path(__file__).parent.parent / 'data'


@pytest_asyncio.fixture()
async def no_init_transport() -> AsyncGenerator[MockTransport, None]:
    bridge = Bridge(argparse.Namespace(privileged=False, beipack=False))
    transport = MockTransport(bridge)
    try:
        yield transport
    finally:
        await transport.stop()


@pytest.fixture
def transport(no_init_transport: MockTransport) -> MockTransport:
    no_init_transport.init()
    return no_init_transport


async def assert_http_response(transport: MockTransport, ch: str, *, tls: bool = False) -> None:
    await transport.assert_msg('', command='response', channel=ch, status=200, reason='OK')

    channel, data = await transport.next_frame()
    assert channel == ch
    if tls:
        assert data == b'Hello TLS\r\n'
    else:
        assert data == b'Hello\r\n'

    await transport.assert_msg('', command='done', channel=ch)
    await transport.assert_msg('', command='close', channel=ch)


@pytest_asyncio.fixture(params=['tcp', 'unix'])
async def http_server(request, tmp_path) -> AsyncGenerator[dict, None]:
    async def serve(reader, writer):
        while True:
            line = await reader.readline()
            if not line.strip():
                break
        writer.write(b'HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nHello\r\n')
        await writer.drain()
        writer.close()

    if request.param == 'tcp':
        server = await asyncio.start_server(serve, '127.0.0.1', 0)
        port = server.sockets[0].getsockname()[1]
        open_args = {'port': port}
    else:
        sock = str(tmp_path / 'http.sock')
        server = await asyncio.start_unix_server(serve, sock)
        open_args = {'unix': sock}

    yield open_args
    server.close()


@pytest_asyncio.fixture()
async def tls_server(request) -> AsyncGenerator[int, None]:
    async def serve(reader, writer):
        while True:
            line = await reader.readline()
            if not line.strip():
                break
        writer.write(b'HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nHello TLS\r\n')
        await writer.drain()
        writer.close()

    server_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    server_ctx.load_cert_chain(MOCK_DATA / 'mock-server.crt', MOCK_DATA / 'mock-server.key')
    if hasattr(request, 'param') and request.param == 'client-cert':
        server_ctx.verify_mode = ssl.CERT_REQUIRED
        server_ctx.load_verify_locations(MOCK_DATA / 'mock-client.crt')

    server = await asyncio.start_server(serve, '127.0.0.1', 0, ssl=server_ctx)
    yield server.sockets[0].getsockname()[1]
    server.close()


@pytest.mark.asyncio
async def test_open_error(transport):
    await transport.check_open('http-stream2', problem='protocol-error',
                               reply_keys={'message': "attribute 'method' required"})
    await transport.check_open('http-stream2', method='POST', path='/tmp/',
                               problem='protocol-error',
                               reply_keys={'message': 'no "port" or "unix" option for channel'})
    await transport.check_open('http-stream2', method='POST', path='/tmp/', port="foo",
                               problem='protocol-error',
                               reply_keys={'message': "attribute 'port': must have type int"})
    await transport.check_open('http-stream2', method='GET', path='/test', unix='/tmp/sock',
                               tls={}, problem='protocol-error',
                               reply_keys={'message': 'TLS on Unix socket is not supported'})
    await transport.check_open('http-stream2', method='GET', path='/test', port=666,
                               tls={
                                    'certificate': {'file': str(MOCK_DATA / 'mock-client.crt')},
                               }, problem='protocol-error',
                               reply_keys={'message': 'need to specify both "certificate" and "key"'})
    await transport.check_open('http-stream2', method='GET', path='/test', port=666,
                               tls={
                                    'key': {'file': str(MOCK_DATA / 'mock-client.crt')},
                               }, problem='protocol-error',
                               reply_keys={'message': 'need to specify both "certificate" and "key"'})
    await transport.check_open('http-stream2', method='GET', path='/test', port=666,
                               tls={
                                    'certificate': {'data': 'invalid'},
                                    'key': {'data': 'invalid'},
                               }, problem='protocol-error')


@pytest.mark.asyncio
async def test_http_request(transport, http_server):
    ch = await transport.check_open('http-stream2', method='GET', path='/test', **http_server)
    transport.send_done(ch)
    await assert_http_response(transport, ch, tls=False)


@pytest.mark.asyncio
async def test_tls_request(transport, tls_server):
    ch = await transport.check_open('http-stream2', method='GET', path='/test', port=tls_server,
                                    tls={'authority': {'file': str(MOCK_DATA / 'mock-server.crt')}})
    transport.send_done(ch)
    await assert_http_response(transport, ch, tls=True)


@pytest.mark.asyncio
async def test_tls_request_no_validate(transport, tls_server):
    ch = await transport.check_open('http-stream2', method='GET', path='/test', port=tls_server,
                                    tls={'validate': False})
    transport.send_done(ch)
    await assert_http_response(transport, ch, tls=True)


@pytest.mark.asyncio
async def test_tls_no_validate(transport, tls_server):
    ch = await transport.check_open('http-stream2', method='GET', path='/test', port=tls_server,
                                    tls={'validate': False})
    transport.send_done(ch)
    await assert_http_response(transport, ch, tls=True)


@pytest.mark.asyncio
@pytest.mark.parametrize('tls_server', ['client-cert'], indirect=True)
async def test_tls_client_cert(transport, tls_server):
    ch = await transport.check_open('http-stream2', method='GET', path='/test', port=tls_server,
                                    tls={
                                        'authority': {'file': str(MOCK_DATA / 'mock-server.crt')},
                                        'certificate': {'file': str(MOCK_DATA / 'mock-client.crt')},
                                        'key': {'file': str(MOCK_DATA / 'mock-client.key')},
                                    })
    transport.send_done(ch)
    await assert_http_response(transport, ch, tls=True)

    ch = await transport.check_open('http-stream2', method='GET', path='/test', port=tls_server,
                                    tls={
                                        'authority': {'data': (MOCK_DATA / 'mock-server.crt').read_text()},
                                        'certificate': {'file': str(MOCK_DATA / 'mock-client.crt')},
                                        'key': {'data': (MOCK_DATA / 'mock-client.key').read_text()},
                                    })
    transport.send_done(ch)
    await assert_http_response(transport, ch, tls=True)

    ch = await transport.check_open('http-stream2', method='GET', path='/test', port=tls_server,
                                    tls={
                                        'authority': {'data': (MOCK_DATA / 'mock-server.crt').read_text()},
                                        'certificate': {'data': (MOCK_DATA / 'mock-client.crt').read_text()},
                                        'key': {'data': (MOCK_DATA / 'mock-client.key').read_text()},
                                    })
    transport.send_done(ch)
    await assert_http_response(transport, ch, tls=True)
