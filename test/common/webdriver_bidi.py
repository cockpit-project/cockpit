# This file is part of Cockpit.
#
# Copyright (C) 2024 Red Hat, Inc.
#
# Cockpit is free software; you can redistribute it and/or modify it
# under the terms of the GNU Lesser General Public License as published by
# the Free Software Foundation; either version 2.1 of the License, or
# (at your option) any later version.
#
# Cockpit is distributed in the hope that it will be useful, but
# WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
# Lesser General Public License for more details.
#
# You should have received a copy of the GNU Lesser General Public License
# along with Cockpit; If not, see <http://www.gnu.org/licenses/>.

"""BiDi session/API driver

This directly talks the https://w3c.github.io/webdriver-bidi/ protocol from async Python,
without any node/JS in between. The only dependencies are aiohttp, firefox, and/or
chromedriver+chromium (or headless_shell).
"""

import asyncio
import contextlib
import json
import logging
import os
import socket
import sys
import tempfile
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import aiohttp

log_proto = logging.getLogger("bidi.proto")
log_command = logging.getLogger("bidi.command")


JsonObject = dict[str, Any]


class WebdriverError(RuntimeError):
    pass


@dataclass
class LogMessage:
    level: str  # like "info"
    type: str  # usually "console"
    timestamp: int
    args: list[object]
    text: str

    def __init__(self, message_params: JsonObject) -> None:
        self.level = message_params["level"]
        self.type = message_params["type"]
        self.timestamp = message_params["timestamp"]
        self.args = message_params.get("args", [])
        self.text = message_params["text"]

    def __str__(self) -> str:
        return f"> {self.level}: {self.text}"


@dataclass
class BidiSession:
    ws_url: str
    session_url: str
    process: asyncio.subprocess.Process


# Return port numbers that were free at the time of checking
# They might be in use again by the time the function returns...
def pick_ports(count: int) -> list[int]:
    sockets: list[socket.socket] = []
    ports: list[int] = []

    try:
        for _ in range(count):
            sock = socket.socket()
            sock.bind(('127.0.0.1', 0))
            sockets.append(sock)
            ports.append(sock.getsockname()[1])
    finally:
        for s in sockets:
            s.close()

    return ports


def jsquote(js: object) -> str:
    return json.dumps(js)


def unpack_value(raw: Any) -> Any:
    """Convert a WebDriver type/value object into a plain Python object"""

    if not isinstance(raw, dict):
        return raw
    try:
        type_ = raw["type"]
    except KeyError as e:
        raise ValueError(f"No type in {raw!r}") from e
    if type_ in ["undefined", "null"]:
        return None
    if type_ in ["string", "boolean", "number"]:
        return raw["value"]
    # serialized BiDi objects, don't touch
    if type_ in ["function", "node", "window"]:
        return raw
    if type_ == "array":
        return [unpack_value(v) for v in raw["value"]]
    if type_ == "object":
        obj = {}
        for k, v in raw["value"]:
            obj[k] = unpack_value(v["value"])
        return obj
    raise ValueError(f"Unknown type in {raw!r}")


# FIXME: No current way to say `[Self]`
class WebdriverBidi(contextlib.AbstractAsyncContextManager):  # type: ignore[type-arg]
    http_session: aiohttp.ClientSession

    def __init__(self, *, headless: bool = False) -> None:
        self.headless = headless
        self.last_id = 0
        self.pending_commands: dict[int, asyncio.Future[JsonObject]] = {}
        self.logs: list[LogMessage] = []
        self.bidi_session: BidiSession | None = None
        self.future_wait_page_load = None
        self.top_context: str | None = None  # top-level browsingContext
        self.context: str | None  # currently selected context (top or iframe)

        self.homedir_temp = tempfile.TemporaryDirectory(prefix="cockpit-test-browser-home-")
        self.homedir = Path(self.homedir_temp.name)
        self.download_dir = self.homedir / 'Downloads'
        self.download_dir.mkdir()

    async def start_bidi_session(self) -> None:
        raise NotImplementedError

    async def close_bidi_session(self) -> None:
        raise NotImplementedError

    async def close(self) -> None:
        assert self.bidi_session is not None
        log_proto.debug("cleaning up webdriver")

        self.task_reader.cancel()
        del self.task_reader
        await self.ws.close()
        await self.close_bidi_session()
        self.bidi_session.process.terminate()
        await self.bidi_session.process.wait()
        self.bidi_session = None
        await self.http_session.close()

    def ws_done_callback(self, future: asyncio.Future[None]) -> None:
        for fut in self.pending_commands.values():
            if not fut.done():
                fut.set_exception(WebdriverError("websocket closed"))
        if not future.cancelled():
            log_proto.error("ws_reader crashed: %r", future.result())

    async def start_session(self) -> None:
        self.http_session = aiohttp.ClientSession(raise_for_status=True)
        await self.start_bidi_session()
        assert self.bidi_session
        self.ws = await self.http_session.ws_connect(self.bidi_session.ws_url)
        self.task_reader = asyncio.create_task(self.ws_reader(self.ws), name="bidi_reader")
        self.task_reader.add_done_callback(self.ws_done_callback)

        await self.bidi("session.subscribe", events=[
            "log.entryAdded", "browsingContext.domContentLoaded",
        ])

        # wait for browser to initialize default context
        for _ in range(10):
            realms = (await self.bidi("script.getRealms"))["realms"]
            if len(realms) > 0:
                self.top_context = realms[0]["context"]
                self.context = self.top_context
                break
            await asyncio.sleep(0.5)
        else:
            raise WebdriverError("timed out waiting for default realm")

    async def __aenter__(self) -> "WebdriverBidi":
        await self.start_session()
        return self

    async def __aexit__(self, *_excinfo: Any) -> None:
        if self.bidi_session is not None:
            await self.close()

    async def ws_reader(self, ws: aiohttp.client.ClientWebSocketResponse) -> None:
        async for msg in ws:
            if msg.type == aiohttp.WSMsgType.TEXT:
                data = json.loads(msg.data)
                log_proto.debug("ws TEXT → %r", data)
                id_ = data.get("id")
                if id_ in self.pending_commands:
                    log_proto.debug("ws_reader: resolving pending command %i", id_)
                    pending_command = self.pending_commands[id_]
                    if data["type"] == "success":
                        if data["result"].get("type") == "exception":
                            pending_command.set_exception(
                                WebdriverError(data["result"]["exceptionDetails"]["text"]))
                        else:
                            pending_command.set_result(data["result"])
                    elif data["type"] == "exception":
                        pending_command.set_exception(
                            WebdriverError(data["exceptionDetails"]["text"]))
                    elif data["type"] == "error":
                        pending_command.set_exception(
                            WebdriverError(f"{data['error']}: {data.get('message', '')}"))
                    else:
                        pending_command.set_exception(
                            WebdriverError(f"unknown response type: {data!r}"))
                    del self.pending_commands[id_]
                    continue

                if data["type"] == "event":
                    if data["method"] == "log.entryAdded":
                        log = LogMessage(data["params"])
                        self.logs.append(log)
                        print(str(log), file=sys.stderr)
                        continue
                    if data["method"] == "browsingContext.domContentLoaded":
                        if self.future_wait_page_load:
                            log_command.debug("page loaded: %r, resolving wait page load future", data["params"])
                            self.future_wait_page_load.set_result(data["params"]["url"])
                        else:
                            log_command.debug("page loaded: %r (not awaited)", data["params"])
                        continue

                log_proto.warning("ws_reader: unhandled message %r", data)
            elif msg.type == aiohttp.WSMsgType.ERROR:
                log_proto.error("BiDi failure: %s", msg)
                break

    async def bidi(self, method: str, *, quiet: bool = False, timeout: int = 10, **params: Any) -> JsonObject:
        """Send a Webdriver BiDi command and return the JSON response

        Most commands ought to be quick, so the default timeout is 10 seconds.
        Set a custom one if you call a function which waits/polls for something
        for a non-trivial duration.
        """
        payload = json.dumps({"id": self.last_id, "method": method, "params": params})
        log_command.info("← %s(%r) [id %i]", method, 'quiet' if quiet else params, self.last_id)
        await self.ws.send_str(payload)
        future = asyncio.get_event_loop().create_future()
        self.pending_commands[self.last_id] = future
        res = await asyncio.wait_for(future, timeout=timeout)
        if "result" in res:
            value = unpack_value(res["result"])
            log_proto.debug("[id %i] unpacking raw result %r", self.last_id, res["result"])
            res["result"] = value
        self.last_id += 1
        if not quiet:
            log_command.info("→ %r", res)
        return res

    # this is mostly unused; testlib uses ph_find() due to sizzle
    async def locate(self, selector: str) -> str:
        r = await self.bidi("browsingContext.locateNodes", context=self.context,
                            locator={"type": "css", "value": selector})
        nodes = r["nodes"]
        if len(nodes) == 0:
            raise WebdriverError(f"no element found for {selector}")
        if len(nodes) > 1:
            raise WebdriverError(f"selector {selector} is ambiguous: {nodes}")
        log_command.info("locate(%s) = %r", selector, nodes[0])
        return nodes[0]

    async def switch_to_frame(self, name: str) -> None:
        self.switch_to_top()
        frame = await self.locate(f"iframe[name='{name}']")
        cw = await self.bidi("script.callFunction",
                             functionDeclaration="f => f.contentWindow",
                             arguments=[frame],
                             awaitPromise=False,
                             target={"context": self.top_context})
        self.context = cw["result"]["value"]["context"]
        log_command.info("← switch_to_frame(%s)", name)

    def switch_to_top(self) -> None:
        self.context = self.top_context
        log_command.info("← switch_to_top")

    @contextlib.contextmanager
    def restore_context(self, *, switch_to_top: bool = True) -> Iterator[None]:
        saved = self.context
        if switch_to_top:
            self.switch_to_top()
        try:
            yield
        finally:
            self.context = saved


class ChromiumBidi(WebdriverBidi):
    def __init__(self, *, headless: bool = False) -> None:
        super().__init__(headless=headless)
        self.cdp_ws: aiohttp.client.ClientWebSocketResponse | None = None

    async def start_bidi_session(self) -> None:
        assert self.bidi_session is None

        candidate_binaries = ["/usr/bin/chromium-browser"]
        if self.headless:
            candidate_binaries.insert(0, "/usr/lib64/chromium-browser/headless_shell")
        binaries = [path for path in candidate_binaries if os.path.exists(path)]
        if not binaries:
            raise WebdriverError(f"no Chromium binary found: tried {' '.join(candidate_binaries)}")
        chrome_binary = binaries[0]
        log_proto.debug("webdriver chromium binary: %s", chrome_binary)

        session_args = {"capabilities": {
            "alwaysMatch": {
                "webSocketUrl": True,
                "acceptInsecureCerts": True,
                "goog:chromeOptions": {
                    "binary": chrome_binary,
                    "args": [
                        "--font-render-hinting=none",
                        "--disable-pushstate-throttle",
                        # HACK: For Cockpit-Files downloading uses `window.open` which is sometimes allowed depending
                        # on unpredictable and unknown heuristics
                        "--disable-popup-blocking",
                    ] + (["--headless"] if self.headless else []),
                },
            }
        }}

        [webdriver_port] = pick_ports(1)
        driver = await asyncio.create_subprocess_exec(
                "chromedriver", "--port=" + str(webdriver_port),
                env=dict(os.environ, HOME=str(self.homedir)))

        wd_url = f"http://localhost:{webdriver_port}"

        # webdriver needs some time to launch
        for retry in range(1, 10):
            try:
                async with self.http_session.post(f"{wd_url}/session",
                                                  data=json.dumps(session_args).encode()) as resp:
                    session_info = json.loads(await resp.text())["value"]
                    log_proto.debug("webdriver session request: %r %r", resp, session_info)
                    break
            except (IOError, aiohttp.client.ClientResponseError) as e:
                log_proto.debug("waiting for webdriver: %s", e)
                await asyncio.sleep(0.1 * retry)
        else:
            raise WebdriverError("could not connect to chromedriver")

        self.cdp_address = session_info["capabilities"]["goog:chromeOptions"]["debuggerAddress"]
        self.last_cdp_id = 0

        self.bidi_session = BidiSession(
            session_url=f"{wd_url}/session/{session_info['sessionId']}",
            ws_url=session_info["capabilities"]["webSocketUrl"],
            process=driver)
        log_proto.debug("Established chromium session %r, CDP address %s", self.bidi_session, self.cdp_address)

    async def close_cdp_session(self) -> None:
        if self.cdp_ws is not None:
            await self.cdp_ws.close()
            self.cdp_ws = None

    async def close_bidi_session(self) -> None:
        assert self.bidi_session is not None
        await self.close_cdp_session()
        await self.http_session.delete(self.bidi_session.session_url)

    async def cdp(self, method: str, **params: Any) -> dict[str, Any]:
        """Send a Chrome DevTools command and return the JSON response

        This is currently *not* safe for enabling events! These should be handled via BiDi,
        this is only an escape hatch for CDP specific functionality such as Profiler.
        """
        if self.cdp_ws is None:
            # unfortunately we have to hold on to the open ws after sending .enable() commands,
            # otherwise they'll reset when closing and re-opening
            self.cdp_ws = await self.http_session.ws_connect(
                    f"ws://{self.cdp_address}/devtools/page/{self.top_context}",
                    # coverage data can be big
                    max_msg_size=16000000)

        reply = None
        payload = json.dumps({"id": self.last_cdp_id, "method": method, "params": params})
        log_proto.debug("CDP ← %r", payload)
        await self.cdp_ws.send_str(payload)
        async for msg in self.cdp_ws:
            if msg.type == aiohttp.WSMsgType.TEXT:
                reply = json.loads(msg.data)
                if reply.get("id") == self.last_cdp_id:
                    break
                else:
                    log_proto.warning("CDP message: %r", reply)
            else:
                log_proto.debug("CDP non-text message: %r", msg)
        log_proto.debug("CDP → %r", reply)
        assert reply
        self.last_cdp_id += 1
        return reply


# We could do this with https://github.com/mozilla/geckodriver/releases with a similar protocol as ChromeBidi
# But let's use https://firefox-source-docs.mozilla.org/testing/marionette/Protocol.html directly, fewer moving parts
class FirefoxBidi(WebdriverBidi):
    async def start_bidi_session(self) -> None:
        [marionette_port, bidi_port] = pick_ports(2)

        self.profiledir = self.homedir / "profile"
        self.profiledir.mkdir()
        (self.profiledir / "user.js").write_text(f"""
            user_pref("remote.enabled", true);
            user_pref("remote.frames.enabled", true);
            user_pref("app.update.auto", false);
            user_pref("datareporting.policy.dataSubmissionEnabled", false);
            user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);
            user_pref("dom.disable_beforeunload", true);
            user_pref("browser.download.dir", "{self.download_dir}");
            user_pref("browser.download.folderList", 2);
            user_pref("signon.rememberSignons", false);
            user_pref("dom.navigation.locationChangeRateLimit.count", 9999);
            user_pref('marionette.port', {marionette_port});
            """)

        driver = await asyncio.create_subprocess_exec(
            "firefox", "-profile", str(self.profiledir), "--marionette", "--no-remote",
            f"--remote-debugging-port={bidi_port}",
            *(["-headless"] if self.headless else []), "about:blank")

        # needs some time to launch
        for _ in range(1, 30):
            try:
                # we must keep this socket open throughout the lifetime of that session
                reader, self.writer_marionette = await asyncio.open_connection("127.0.0.1", marionette_port)
                break
            except ConnectionRefusedError as e:
                log_proto.debug("waiting for firefox marionette: %s", e)
                await asyncio.sleep(1)
        else:
            raise WebdriverError("could not connect to firefox marionette")

        reply = await reader.read(1024)
        if b'"marionetteProtocol":3' not in reply:
            raise WebdriverError(f"unexpected marionette reply: {reply.decode()}")
        cmd = '[0,1,"WebDriver:NewSession",{"webSocketUrl":true,"acceptInsecureCerts":true}]'
        self.writer_marionette.write(f"{len(cmd)}:{cmd}".encode())
        await self.writer_marionette.drain()
        reply = await reader.read(1024)
        # cut off length prefix
        reply = json.loads(reply[reply.index(b":") + 1:].decode())
        if not isinstance(reply, list) or len(reply) != 4 or not isinstance(reply[3], dict):
            raise WebdriverError(f"unexpected marionette session request reply: {reply!r}")
        log_proto.debug("marionette session request reply: %s", reply)

        url = reply[3]["capabilities"]["webSocketUrl"]
        self.bidi_session = BidiSession(session_url=url, ws_url=url, process=driver)
        log_proto.debug("Established firefox session %r", self.bidi_session)

    async def close_bidi_session(self) -> None:
        self.writer_marionette.close()
        await self.writer_marionette.wait_closed()
