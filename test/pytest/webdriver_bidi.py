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

from __future__ import annotations

import asyncio
import contextlib
import logging
import socket
from typing import AsyncIterator, Callable, Generic, Mapping, TypeVar, override

import aiohttp
from yarl import URL

from cockpit.jsonutil import (
    JsonObject,
    JsonValue,
    create_object,
    get_dict,
    get_int,
    get_object,
    get_objv,
    get_str,
    typechecked,
)

logger = logging.getLogger(__name__)


class WebdriverError(RuntimeError):
    pass


class ConsoleMessage:
    def __init__(self, value: JsonObject):
        print('SSSS', value)
        self.level = get_str(value, 'level')
        self.type = get_str(value, 'type')
        self.timestamp = get_int(value, 'timestamp')
        self.args = get_objv(value, 'args', dict)
        self.text = get_str(value, 'text')


# Return a port number that was free at the time of checking
# It might be in use again by the time the function returns...
def pick_a_port() -> int:
    sock = socket.socket()
    try:
        sock.bind(('127.0.0.1', 0))
        _ip, port = sock.getsockname()
        return port
    finally:
        sock.close()


T = TypeVar('T')


class EventHandler:
    def handle_event(self, msg: JsonObject) -> None:
        raise NotImplementedError

    def eof(self) -> None:
        raise NotImplementedError


class EventLog(Generic[T], EventHandler):
    def __init__(self, ctor: Callable[[JsonObject], T]):
        self.queue = asyncio.Queue[T | None]()
        self.ctor = ctor

    @override
    def handle_event(self, msg: JsonObject) -> None:
        self.queue.put_nowait(get_object(msg, 'params', self.ctor))

    @override
    def eof(self) -> None:
        self.queue.put_nowait(None)

    async def __aiter__(self) -> AsyncIterator[T]:
        while True:
            entry = await self.queue.get()
            if entry is None:
                return
            yield entry


class BrowsingContext:
    def __init__(self, session: WebdriverSession, context: str):
        self.session = session
        self.context = context

    async def command(self, command: str, **kwargs: JsonValue) -> JsonObject:
        return await self.session.command(f'browsingContext.{command}', context=self.context, **kwargs)

    async def navigate(self, url: str, **kwargs: JsonValue) -> JsonObject:
        return await self.command('navigate', url=url, **kwargs)

    async def evaluate(self, expression: str, /, *, await_promise: bool = False, **kwargs: JsonValue) -> JsonObject:
        return await self.command(
            "script.evaluate",
            expression=expression,
            awaitPromise=await_promise,
            target={'context': self.context},
            **kwargs
        )


class WebdriverSession:
    def __init__(self, ws: aiohttp.ClientWebSocketResponse):
        self.ws = ws
        self.pending_commands = dict[int, asyncio.Future[JsonValue]]()
        self.events = dict[str, EventHandler]()
        self.last_tag = 1

    def get_tag(self):
        self.last_tag += 1
        return self.last_tag

    async def command(self, method, _params: JsonObject | None = None, /, **kwargs: JsonValue) -> JsonObject:
        msg = {'id': self.get_tag(), 'method': method, 'params': create_object(_params, kwargs)}
        logger.debug("ws ← %r", msg)
        await self.ws.send_json(msg)
        future = asyncio.get_running_loop().create_future()
        self.pending_commands[msg['id']] = future
        return await future

    async def subscribe_event(self, name: str, ctor: Callable[[JsonObject], T]) -> EventLog[T]:
        await self.command('session.subscribe', events=[name])
        log = EventLog(ctor)
        self.events[name] = log
        return log

    async def subscribe_console(self) -> EventLog[ConsoleMessage]:
        return await self.subscribe_event('log.entryAdded', ConsoleMessage)

    @contextlib.asynccontextmanager
    async def create_context(self, context_type: str = 'tab', **kwargs: JsonValue) -> AsyncIterator[BrowsingContext]:
        reply = await self.command("browsingContext.create", type=context_type, **kwargs)
        context = get_str(reply, 'context')

        yield BrowsingContext(self, context)

        # TODO: tear down context

    def reader_task_done(self, task: asyncio.Task[None]) -> None:
        exc = task.exception() or EOFError

        for future in self.pending_commands.values():
            future.set_exception(exc)
        self.pending_commands.clear()

        for handler in self.events.values():
            handler.eof()
        self.events.clear()

    async def reader_task(self) -> None:
        logger.debug('reader_task(%r)', self)

        async for ws_msg in self.ws:
            logger.debug('  reader_task(%r) got %r', self, ws_msg)

            if ws_msg.type == aiohttp.WSMsgType.TEXT:
                logger.debug("ws TEXT → %r", ws_msg)
                msg = typechecked(ws_msg.json(), Mapping)
                logger.debug("ws TEXT → %r", msg)

                msg_type = get_str(msg, 'type')
                msg_id = get_int(msg, 'id', None)

                if msg_id is not None:
                    try:
                        pending = self.pending_commands.pop(msg_id)
                    except KeyError:
                        logger.warning('Received non-pending command response %r', msg)
                        continue

                    logger.debug("ws_reader: resolving pending command %i", msg_id)
                    if msg_type == 'success':
                        pending.set_result(msg.get('result'))
                    else:
                        pending.set_exception(WebdriverError(f"{msg_type}: {msg['message']}"))

                elif msg_type == 'event':
                    method = get_str(msg, 'method')
                    if method in self.events:
                        self.events[method].handle_event(msg)
                    else:
                        logger.warning("ws_reader: unhandled event %r", msg)

                else:
                    logger.warning("ws_reader: unhandled message %r", msg)

            elif ws_msg.type == aiohttp.WSMsgType.ERROR:
                logger.error("BiDi failure: %s", ws_msg)
                break


class WebdriverDriver:
    status: JsonObject | None = None

    def __init__(self, url: URL):
        self.url = url

    async def poll_status(self, stdout: asyncio.StreamReader) -> None:
        async with aiohttp.ClientSession() as session:
            while self.status is None:
                logger.debug('polling for status from %r', self.url)
                try:
                    status = await session.get(self.url / 'status')
                    self.status = await status.json()
                    logger.debug('  status is %r', self.status)

                except aiohttp.ClientError as exc:
                    # wait for output and try again
                    # we don't actually care about the output
                    # if we don't get any output for a long time, raise
                    logger.debug('  %s. waiting for more input.', exc)
                    await asyncio.wait_for(stdout.read(1024), 5.0)

    @contextlib.asynccontextmanager
    async def start_session(self) -> AsyncIterator[WebdriverSession]:
        async with aiohttp.ClientSession() as client_session:
            session_args = {"capabilities": {
                "alwaysMatch": {
                    "webSocketUrl": True,
                    "goog:chromeOptions": {"binary": "/usr/bin/chromium-browser"},
                }
            }}

            logging.debug('requesting new session %s %s', self.url, session_args)
            response = await client_session.post(self.url / 'session', json=session_args)
            reply = get_dict(await response.json(), 'value')
            if 'error' in reply:
                raise WebdriverError(reply)

            logging.debug('  session created: %r', reply)
            session_id = get_str(reply, 'sessionId')
            capabilities = get_dict(reply, 'capabilities')
            url = get_str(capabilities, 'webSocketUrl')

            logging.debug('connecting to websocket %s', url)
            async with client_session.ws_connect(url) as ws:
                logging.debug('  connected %r', ws)
                session = WebdriverSession(ws)
                reader_task = asyncio.create_task(session.reader_task())
                reader_task.add_done_callback(session.reader_task_done)
                try:
                    yield session
                    logging.debug('delete session %r', session_id)
                    await client_session.delete(self.url / 'session' / session_id)
                finally:
                    await reader_task

    @classmethod
    @contextlib.asynccontextmanager
    async def connect(cls) -> AsyncIterator[WebdriverDriver]:
        port = pick_a_port()
        url = URL(f'http://127.0.0.1:{port}')

        logger.debug('Trying to spawn driver for port %r', port)

        process = await asyncio.create_subprocess_exec(
            'chromedriver', f'--port={port}',
            stdout=asyncio.subprocess.PIPE)
        assert process.stdout is not None
        logger.debug('webdriver process %r started', process.pid)

        try:
            webdriver = cls(url)
            await webdriver.poll_status(process.stdout)
            yield webdriver

        finally:
            logger.debug('killing webdriver process %r', process.pid)
            with contextlib.suppress(ProcessLookupError):
                process.kill()
            logger.debug('waiting for webdriver process %r', process.pid)
            await process.wait()
            logger.debug('webdriver process finished')


async def main():
    logging.basicConfig(level=logging.DEBUG)

    async with WebdriverDriver.connect() as driver:
        async with driver.start_session() as session:
            async with session.create_context() as context:
                await context.navigate('http://127.0.0.1:8080/')
                await asyncio.sleep(100)


if __name__ == '__main__':
    asyncio.run(main())
