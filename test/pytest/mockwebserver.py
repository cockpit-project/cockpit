# This file is part of Cockpit.
#
# Copyright (C) 2024 Red Hat, Inc.
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.

# https://github.com/astral-sh/ruff/issues/10980#issuecomment-2219615329
# ruff: noqa: RUF029

import argparse
import asyncio
import binascii
import contextlib
import json
import logging
import os
import pwd
import socket
import weakref
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from pathlib import Path
from typing import ClassVar, NamedTuple, Self

import aiohttp
from aiohttp import WSCloseCode, web
from yarl import URL

from cockpit._vendor import systemd_ctypes
from cockpit.bridge import Bridge
from cockpit.jsonutil import JsonObject, JsonValue, create_object, get_dict, get_enum, get_int, get_str, typechecked
from cockpit.protocol import CockpitProblem, CockpitProtocolError

from .mockdbusservice import mock_dbus_service_on_user_bus

logger = logging.getLogger(__name__)

websockets = web.AppKey("websockets", weakref.WeakSet['CockpitWebSocket'])


class TextChannelOrigin(NamedTuple):
    enqueue: Callable[[str | None], None]


class BinaryChannelOrigin(NamedTuple):
    enqueue: Callable[[str | bytes | None], None]


class ExternalChannelOrigin(NamedTuple):
    enqueue: Callable[[JsonObject | bytes], None]


ChannelOrigin = TextChannelOrigin | BinaryChannelOrigin | ExternalChannelOrigin


class MultiplexTransport(asyncio.Transport):
    transports: ClassVar[dict[str, Self]] = {}
    last_id: ClassVar[int] = 0

    def __init__(self, protocol: asyncio.Protocol, origin: ChannelOrigin):
        self.origins: dict[str | None, ChannelOrigin] = {None: origin}
        self.channel_sequence = 0
        self.protocol = protocol
        self.protocol.connection_made(self)

        self.csrf_token = f'token{MultiplexTransport.last_id}'
        MultiplexTransport.transports[self.csrf_token] = self
        MultiplexTransport.last_id += 1

    def write(self, data: bytes) -> None:
        # We know that cockpit.protocol always writes complete frames
        header, _, frame = data.partition(b'\n')
        assert int(header) == len(frame)

        channel_id, _, body = frame.partition(b'\n')
        if channel_id:
            # data message on the named channel
            origin = self.origins.get(channel_id.decode())
            match origin:
                case BinaryChannelOrigin(enqueue):
                    enqueue(frame)
                case TextChannelOrigin(enqueue):
                    enqueue(frame.decode())
                case ExternalChannelOrigin(enqueue):
                    enqueue(body)

        else:
            # control message (channel=None for transport control)
            message = json.loads(body)
            channel = get_str(message, 'channel', None)
            origin = self.origins.get(channel)

            match origin:
                case BinaryChannelOrigin(enqueue) | TextChannelOrigin(enqueue):
                    enqueue(frame.decode())
                case ExternalChannelOrigin(enqueue):
                    enqueue(message)

            print(message)
            if origin is not None and get_str(message, 'command') == 'close':
                del self.origins[channel]

    def register_origin(self, origin: ChannelOrigin, channel: str | None = None) -> str:
        # normal channels get their IDs allocated in cockpit.js

        if channel is None:
            # external channels get their IDs allocated by us
            channel = f'external{self.channel_sequence}'
            self.channel_sequence += 1

        self.origins[channel] = origin

        return channel

    def data_received(self, data: bytes) -> None:
        # cockpit.protocol expects a frame length header
        header = f'{len(data)}\n'.encode()
        self.protocol.data_received(header + data)

    def control_received(self, message: JsonObject) -> None:
        self.data_received(b'\n' + json.dumps(message).encode())

    def close(self) -> None:
        transport = MultiplexTransport.transports.pop(self.csrf_token)
        assert transport is self


class CockpitWebSocket(web.WebSocketResponse):
    def __init__(self):
        self.outgoing_queue = asyncio.Queue[str | bytes | None]()
        super().__init__(protocols=['cockpit1'])

    async def send_control(self, _msg: JsonObject | None = None, **kwargs: JsonValue) -> None:
        await self.send_str('\n' + json.dumps(create_object(_msg, kwargs)))

    async def process_outgoing_queue(self, queue: asyncio.Queue[str | bytes | None]) -> None:
        while True:
            item = await queue.get()
            if isinstance(item, str):
                await self.send_str(item)
            elif isinstance(item, bytes):
                await self.send_bytes(item)
            else:
                break

    async def communicate(self, request: web.Request) -> None:
        text_origin = TextChannelOrigin(self.outgoing_queue.put_nowait)
        binary_origin = BinaryChannelOrigin(self.outgoing_queue.put_nowait)

        try:
            bridge = Bridge(argparse.Namespace(privileged=False, beipack=False))
            transport = MultiplexTransport(bridge, text_origin)

            # wait for the bridge to send its "init"
            bridge_init = await self.outgoing_queue.get()
            del bridge_init

            # send our "init" to the websocket
            await self.prepare(request)
            await self.send_control(
                command='init', version=1, host='localhost',
                channel_seed='test-server', csrf_token=transport.csrf_token,
                capabilities=['multi', 'credentials', 'binary'],
                system={'version': '0'}
            )

            # receive "init" from the websocket
            try:
                assert await self.receive_json() == {'command': 'init', 'version': 1}
            except (TypeError, json.JSONDecodeError, AssertionError) as exc:
                raise CockpitProtocolError('expected init message') from exc

            # send "init" to the bridge
            # TODO: explicit-superuser handling
            transport.data_received(b'\n' + json.dumps({
                "command": "init",
                "version": 1,
                "host": "localhost"
            }).encode())

            write_task = asyncio.create_task(self.process_outgoing_queue(self.outgoing_queue))

            try:
                async for msg in self:
                    if msg.type == aiohttp.WSMsgType.TEXT:
                        frame = msg.data
                        if frame.startswith('\n'):
                            control = json.loads(frame)
                            command = get_str(control, 'command')
                            channel = get_str(control, 'channel', None)
                            if command == 'open':
                                if channel is None:
                                    raise CockpitProtocolError('open message without channel')
                                binary = get_enum(control, 'binary', ['raw'], None) == 'raw'
                                transport.register_origin(binary_origin if binary else text_origin, channel)
                        transport.data_received(frame.encode())
                    elif msg.type == aiohttp.WSMsgType.BINARY:
                        transport.data_received(msg.data)
                    else:
                        raise CockpitProtocolError(f'strange websocket message {msg!s}')
            finally:
                self.outgoing_queue.put_nowait(None)
                await write_task

        except CockpitProblem as exc:
            if not self.closed:
                await self.send_control(exc.get_attrs(), command='close')


routes = web.RouteTableDef()


@routes.get(r'/favicon.ico')
async def favicon_ico(request: web.Request) -> web.FileResponse:
    del request
    return web.FileResponse('src/branding/default/favicon.ico')


SPLIT_UTF8_FRAMES = [
    b"initial",
    # split an é in the middle
    b"first half \xc3",
    b"\xa9 second half",
    b"final"
]


@routes.get(r'/mock/expect-warnings')
@routes.get(r'/mock/dont-expect-warnings')
async def mock_expect_warnings(_request: web.Request) -> web.Response:
    # no op — only for compatibility with C test-server
    return web.Response(status=200, text='OK')


@routes.get(r'/mock/info')
async def mock_info(_request: web.Request) -> web.Response:
    return web.json_response({
        'pybridge': True,
        'skip_slow_tests': 'COCKPIT_SKIP_SLOW_TESTS' in os.environ
    })


@routes.get(r'/mock/stream')
async def mock_stream(request: web.Request) -> web.StreamResponse:
    response = web.StreamResponse()
    await response.prepare(request)

    for i in range(10):
        await response.write(f'{i} '.encode())

    return response


@routes.get(r'/mock/split-utf8')
async def mock_split_utf8(request: web.Request) -> web.StreamResponse:
    response = web.StreamResponse()
    await response.prepare(request)

    for chunk in SPLIT_UTF8_FRAMES:
        await response.write(chunk)

    return response


@routes.get(r'/mock/truncated-utf8')
async def mock_truncated_utf8(request: web.Request) -> web.StreamResponse:
    response = web.StreamResponse()
    await response.prepare(request)

    for chunk in SPLIT_UTF8_FRAMES[0:2]:
        await response.write(chunk)

    return response


@routes.get(r'/mock/headers')
async def mock_headers(request: web.Request) -> web.Response:
    headers = {k: v for k, v in request.headers.items() if k.startswith('Header')}
    headers['Header3'] = 'three'
    headers['Header4'] = 'marmalade'

    return web.Response(status=201, text='Yoo Hoo', headers=headers)


@routes.get(r'/mock/host')
async def mock_host(request: web.Request) -> web.Response:
    return web.Response(status=201, text='Yoo Hoo', headers={'Host': request.headers['Host']})


@routes.get(r'/mock/headonly')
async def mock_headonly(request: web.Request) -> web.Response:
    if request.method != 'HEAD':
        return web.Response(status=400, reason="Only HEAD allowed on this path")

    input_data = request.headers.get('InputData')
    if not input_data:
        return web.Response(status=400, reason="Requires InputData header")

    return web.Response(status=200, text='OK', headers={'InputDataLength': str(len(input_data))})


@routes.get(r'/mock/qs')
async def mock_qs(request: web.Request) -> web.Response:
    return web.Response(text=request.query_string.replace(' ', '+'))


@routes.get(r'/cockpit/channel/{csrf_token}')
async def cockpit_channel(request: web.Request) -> web.StreamResponse:
    try:
        transport = MultiplexTransport.transports[request.match_info['csrf_token']]
    except KeyError:
        return web.Response(status=404)

    # Decode the request
    try:
        options = json.loads(binascii.a2b_base64(request.query_string))
    except (json.JSONDecodeError, binascii.Error) as exc:
        return web.Response(status=400, reason=f'Invalid query string {exc!s}')

    binary = get_enum(options, 'binary', ['raw'], None) == 'raw'
    websocket = request.headers.get('Upgrade', '').lower() == 'websocket'

    # Open the channel, requesting data send to our queue
    queue = asyncio.Queue[JsonObject | bytes]()
    channel = transport.register_origin(ExternalChannelOrigin(queue.put_nowait))
    transport.control_received({**options, 'command': 'open', 'channel': channel, 'flow-control': True})

    # The first thing the channel sends back will be 'ready' or 'close'
    open_result = await queue.get()
    assert isinstance(open_result, Mapping)
    if get_str(open_result, 'command') != 'ready':
        return web.json_response(open_result, status=400, reason='Failed to open channel')

    # Start streaming the result.
    if websocket:
        response: web.StreamResponse = web.WebSocketResponse()
        await response.prepare(request)

    else:
        # Send the 'external' field back as the HTTP headers...
        headers = {k: typechecked(v, str) for k, v in get_dict(options, 'external', {}).items()}

        if 'Content-Type' not in headers:
            headers['Content-Type'] = 'application/octet-stream' if binary else 'text/plain'

        # ...plus this, if we have it.
        if size_hint := get_int(open_result, 'size-hint', None):
            headers['Content-Length'] = f'{size_hint}'

        response = web.StreamResponse(status=200, headers=headers)
        await response.prepare(request)

        # Now, handle the data we receive
        while item := await queue.get():
            match item:
                case Mapping():
                    match get_str(item, 'command'):
                        case 'ping':
                            transport.control_received({**item, 'command': 'pong'})
                        case 'close' | 'done':
                            break

                case bytes():
                    await response.write(item)

    return response


@routes.get(r'/cockpit/socket')
async def cockpit_socket(request: web.Request) -> web.WebSocketResponse:
    ws = CockpitWebSocket()
    request.app[websockets].add(ws)
    await ws.communicate(request)
    return ws


@routes.get('/')
async def index(_request: web.Request) -> web.Response:
    cases = Path('qunit').rglob('test-*.html')

    result = (
        """
        <html>
          <head>
             <title>Test cases</title>
          </head>
          <body>
            <ul>
            """ + '\n'.join(
                f'<li><a href="/{case}">{case}</a></li>' for case in cases
            ) + """
            </ul>
          </body>
        </html>
        """
    )

    return web.Response(text=result, content_type='text/html')


@routes.get(r'/{name:(pkg|dist|qunit)/.+}')
async def serve_file(request: web.Request) -> web.FileResponse:
    path = Path('.') / request.match_info['name']
    return web.FileResponse(path)


COMMON_HEADERS = {
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-DNS-Prefetch-Control": "off",
    "X-Frame-Options": "sameorigin",
}


@web.middleware
async def cockpit_middleware(
    request: web.Request, handler: Callable[[web.Request], Awaitable[web.StreamResponse]]
) -> web.StreamResponse:
    try:
        response = await handler(request)
    except web.HTTPException as ex:
        response = web.Response(
            status=ex.status, reason=ex.reason, text=f'<h1>{ex.reason}</h1>', content_type='text/html'
        )

    response.headers.update(COMMON_HEADERS)
    return response


@contextlib.asynccontextmanager
async def mock_webserver(addr: str = '127.0.0.1', port: int = 0) -> AsyncIterator[URL]:
    # Unit tests require this
    me = pwd.getpwuid(os.getuid())
    os.environ['HOME'] = me.pw_dir
    os.environ['SHELL'] = me.pw_shell
    os.environ['USER'] = me.pw_name

    async with mock_dbus_service_on_user_bus():
        app = web.Application(middlewares=[cockpit_middleware])

        # https://docs.aiohttp.org/en/stable/web_advanced.html#websocket-shutdown
        async def on_shutdown(app: web.Application):
            for ws in app[websockets]:
                await ws.close(code=WSCloseCode.GOING_AWAY, message=b"Server shutdown")
        app[websockets] = weakref.WeakSet()
        app.on_shutdown.append(on_shutdown)
        app.add_routes(routes)

        runner = web.AppRunner(app)
        await runner.setup()

        listener = socket.socket()
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind((addr, port))
        listener.listen()
        site = web.SockSite(runner, listener)
        await site.start()

        addr, port = listener.getsockname()
        yield URL(f'http://{addr}:{port}/')

        logger.debug('cleaning up mock webserver')
        await runner.cleanup()
        logger.debug('cleaning up mock webserver complete')


async def main() -> None:
    parser = argparse.ArgumentParser(description="Serve a single git repository via HTTP")
    parser.add_argument('--addr', '-a', default='127.0.0.1', help="Address to bind to")
    parser.add_argument('--port', '-p', type=int, default=8080, help="Port number to bind to")
    args = parser.parse_args()

    logging.basicConfig(level=logging.DEBUG)

    async with mock_webserver(args.addr, args.port) as url:
        print(f"\n  {url}\n\nCtrl+C to exit.")
        await asyncio.sleep(1000000)


if __name__ == '__main__':
    systemd_ctypes.run_async(main())
