# Copyright (C) 2024 Red Hat, Inc.
# SPDX-License-Identifier: GPL-3.0-or-later

from __future__ import annotations

import argparse
import asyncio
import binascii
import functools
import http
import json
import logging
import mimetypes
import os
import platform
import re
import secrets
import shlex
import socket
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator, Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, NamedTuple

from starlette.applications import Starlette
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, Response, StreamingResponse
from starlette.routing import BaseRoute, Route, WebSocketRoute
from starlette.websockets import WebSocket

from cockpit.bridge import Bridge
from cockpit.data import read_cockpit_data_file
from cockpit.jsonutil import (
    JsonError,
    JsonObject,
    JsonValue,
    create_object,
    get_enum,
    get_int,
    get_nested,
    get_str,
    get_str_map,
    typechecked,
)
from cockpit.protocol import CockpitProblem, CockpitProtocolError

from . import authorize

logger = logging.getLogger(__name__)


# Good morning and welcome to the Python webserver code!
#
# This is currently a work in progress.  Some notes:
#
#   - comments starting with `# C-COMPAT` mark places where we match cockpit-ws
#     (C) behaviour for compatibility, but would prefer to do something
#     stricter/better in the future.  Some of these points are tested by qunit
#     tests which will need to be changed if/when we decide to change the
#     behaviour.


# TODO: consider moving to jsonutil
def parse_json_object(data: str | bytes) -> JsonObject:
    """Parse JSON, ensuring it's an object.

    Raises json.JSONDecodeError or JsonError on invalid input.
    """
    return typechecked(json.loads(data), dict)


# === Configuration ===


@dataclass(kw_only=True)
class Config:
    is_https: bool = False
    for_cockpit_client: bool = False
    local_ssh: bool = False
    login_to: bool = True

    default_unix_path: str = "/run/cockpit/session"
    default_ssh_command: str = "python3 -m cockpit.beiboot --remote-bridge=supported --"
    default_ssh_host: str = "127.0.0.1"

    # cockpit.conf sections, keyed by section name
    sections: Mapping[str, JsonObject] | None = None

    @staticmethod
    def load_cockpit_conf() -> Mapping[str, JsonObject] | None:
        """Parse cockpit.conf and return its sections, or None."""
        import configparser

        from cockpit.config import lookup_config

        parser = configparser.ConfigParser(interpolation=None)
        conf_path = lookup_config("cockpit.conf")
        logger.debug("load_cockpit_conf: loading %r", conf_path)
        try:
            parser.read(conf_path)
        except configparser.Error:
            logger.warning(
                "load_cockpit_conf: failed to parse %r", conf_path, exc_info=True
            )
            return None

        if not parser.sections():
            return None

        return {name: dict(parser[name]) for name in parser.sections()}

    def get_ssh_spawn(self, host: str | None) -> tuple[Sequence[str], str]:
        """Get (command, host) for an SSH session."""
        with get_nested(self.sections or {}, "Ssh-Login", {}) as section:
            command = get_str(section, "Command", self.default_ssh_command)
            target = host or get_str(section, "host", self.default_ssh_host)
            return shlex.split(command) + [target], target

    def get_session_backend(self, auth_type: str) -> tuple[str | None, str | None]:
        """Get (command, unix_path) for an auth type, with fallback to defaults.

        Returns the Command or UnixPath from the auth type's config section,
        falling back to (None, default_unix_path) if neither is configured.
        """
        with get_nested(self.sections or {}, auth_type, {}) as section:
            command = get_str(section, "Command", None)
            unix_path = get_str(section, "UnixPath", None)
            if command is None and unix_path is None:
                unix_path = self.default_unix_path
            return command, unix_path


# === Routing ===


@dataclass(frozen=True)
class AppContext:
    """Application context parsed from request path.

    Determines which session/cookie is used for authentication.
    """

    host: str | None = None  # hostname for remote connections
    app: str | None = None  # app suffix for cockpit+app
    is_resource: bool = False  # True if /cockpit... prefix

    @property
    def url_root(self) -> str:
        """URL path prefix for this app context."""
        if self.host:
            return f"/cockpit+={self.host}"
        if self.app:
            return f"/cockpit+{self.app}"
        return "/cockpit"

    @classmethod
    def split(cls, path: str) -> tuple[AppContext, str]:
        """Parse application context from path.

        Returns (AppContext, remaining_path) with leading / stripped from remainder.

        Examples:
            /cockpit/foo         -> (AppContext(is_resource=True), "foo")
            /cockpit+app/foo     -> (AppContext(app="app", is_resource=True), "foo")
            /cockpit+=host/foo   -> (AppContext(host="host", is_resource=True), "foo")
            /=host/foo           -> (AppContext(host="host"), "foo")
            /system              -> (AppContext(), "system")
        """
        # /cockpit+=host/...
        if m := re.fullmatch(r"/cockpit\+=([^/]+)/(.*)", path):
            return cls(host=m.group(1), is_resource=True), m.group(2)
        # /cockpit+app/...
        if m := re.fullmatch(r"/cockpit\+([^/=][^/]*)/(.*)", path):
            return cls(app=m.group(1), is_resource=True), m.group(2)
        # /cockpit/...
        if m := re.fullmatch(r"/cockpit/(.*)", path):
            return cls(is_resource=True), m.group(1)
        # /=host/... or /=host
        if m := re.fullmatch(r"/=([^/]+)/?(.*)", path):
            return cls(host=m.group(1)), m.group(2)
        # Strip leading / from non-matching paths
        return cls(), path.lstrip("/")


# Valid shell paths: /, /@host..., /=host..., /pkg... (pkg is [A-Za-z0-9_-]+)
# Valid shell paths (without leading /): "", "system", "system/logs", "@host/...", "=host/..."
_SHELL_PATH_RE = re.compile(r"^($|[@=][^/]|[A-Za-z0-9_-]+(/|$))")


class TextChannelOrigin(NamedTuple):
    # control or data
    enqueue: Callable[[str], None]


class BinaryChannelOrigin(NamedTuple):
    # control or data
    enqueue: Callable[[str | bytes], None]


class ExternalChannelOrigin(NamedTuple):
    # control or data (external is always binary)
    enqueue: Callable[[JsonObject | bytes], None]


type ChannelOrigin = TextChannelOrigin | BinaryChannelOrigin | ExternalChannelOrigin


class Session:
    """Corresponds to a single connection to a bridge.  Can have multiple
    associated websockets and external channels, and keeps track of which
    channel came from which origin.  It has a number of possible states:

      - initial state (no bridge started)
      - pre-init (possibly handling authorize messages)
      - running
      - closed

    on_control receives control messages.  On close, `None` is sent instead
    of the message.  The caller can change the callback at runtime (which
    happens with authenticated servers when the init message is received,
    for example.

    The session is responsible for ensuring channel names remain unique over
    the life of a particular bridge connection: it hands out the `channel-seed`
    to websockets (creating a namespace for all channels originating via that
    socket) and also names external channels.

    The session tracks active vs. idle state.  A session is idle if it has
    no websockets attached and will be closed if the idle timeout (15s by
    default) elapses. This allows pressing ^R in the browser without losing the
    session. TODO: think about idle before the websocket connects (during auth
    and after /login finishes but before websocket shows up).
    """

    def __init__(
        self,
        on_control: Callable[[Session, JsonObject | None], bool],
        *,
        idle_timeout: float | None = 15,  # seconds
    ):
        self.on_control = on_control
        self.idle_timeout = idle_timeout
        self.csrf_token = secrets.token_urlsafe(32)

        self.active = 0
        self.idle_handle: asyncio.TimerHandle | None = None

        # map each channel to where it came from (websocket, external)
        self.channels: dict[str | None, ChannelOrigin] = {}
        self.next_channel_seed = 1
        self.next_external_id = 1

        # Connection to bridge (set by start_in_process or start_with_socket)
        self.connection: BridgeTransport | SocketProtocol | None = None
        self.was_connected = False
        self.init_received: JsonObject | None = None

    def start_bridge_in_process(self) -> None:
        # NB: this requires the systemd_ctypes event loop to be active.
        # Use start_with_subprocess() instead for normal operation.
        router = Bridge(argparse.Namespace(privileged=False, beipack=False))
        transport = BridgeTransport(self, router)
        self.connection = transport
        self.was_connected = True
        router.connection_made(transport)

    async def start_with_subprocess(self, cmd: Sequence[str]) -> None:
        """Start session by spawning a subprocess (e.g., cockpit-bridge)."""
        logger.debug("start_with_subprocess: cmd=%r", cmd)
        ours, theirs = socket.socketpair()
        try:
            with theirs:
                self._subprocess = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdin=theirs.fileno(),
                    stdout=theirs.fileno(),
                )
            # theirs is now closed, subprocess owns the fd

            loop = asyncio.get_running_loop()
            _, protocol = await loop.create_connection(
                lambda: SocketProtocol(self), sock=ours
            )
            self.connection = protocol
            self.was_connected = True
            # ours is now owned by the transport
        except BaseException:
            ours.close()
            raise
        logger.debug("start_with_subprocess: connected")

    async def start_with_socket(self, path: str) -> None:
        """Connect to external bridge via Unix socket."""
        logger.debug("start_with_socket: connecting to %s", path)
        loop = asyncio.get_running_loop()
        _, protocol = await loop.create_unix_connection(
            lambda: SocketProtocol(self), path
        )
        self.connection = protocol
        self.was_connected = True
        logger.debug("start_with_socket: connected")

    def allocate_channel_seed(self) -> str:
        """Allocate a unique channel seed for a new websocket."""
        seed = f"{self.next_channel_seed}:"
        self.next_channel_seed += 1
        return seed

    def attach_websocket(self) -> None:
        """Called when a websocket connects to this session."""
        self.active += 1
        if self.idle_handle:
            self.idle_handle.cancel()
            self.idle_handle = None

    def detach_websocket(self) -> None:
        """Called when a websocket disconnects from this session."""
        self.active -= 1
        if self.active == 0 and self.idle_timeout is not None:
            loop = asyncio.get_running_loop()
            self.idle_handle = loop.call_later(self.idle_timeout, self.close)

    def close(self) -> None:
        """Close the session and clean up."""
        if self.idle_handle:
            self.idle_handle.cancel()
            self.idle_handle = None

        if self.connection is not None:
            self.connection.shutdown()
            self.connection = None

        self.on_control(self, None)

    def frame_received(self, frame: bytes) -> None:
        """Called by transport when a frame is received from the router."""
        logger.debug("frame_received: %d bytes: %r", len(frame), frame[:200])
        try:
            nl = frame.index(b"\n")
        except ValueError:
            # C-COMPAT: should be a protocol error, but C ignores it
            logger.info("received invalid message without channel prefix")
            return

        if nl > 0:
            # Data message on a named channel
            channel_id = frame[:nl]
            logger.debug("frame_received: data on channel %s", channel_id)
            origin = self.channels.get(channel_id.decode())
            match origin:
                case BinaryChannelOrigin(enqueue):
                    enqueue(frame)
                case TextChannelOrigin(enqueue):
                    enqueue(frame.decode())
                case ExternalChannelOrigin(enqueue):
                    enqueue(frame[nl + 1 :])
                case None:
                    pass
        else:
            # Control message
            try:
                message = parse_json_object(frame)
                command = get_str(message, "command")
                logger.debug("frame_received: control command=%s", command)

                if self.init_received is None:
                    # Pre-init: all control messages go through on_control
                    if command == "init":
                        logger.debug(
                            "frame_received: init, problem=%r",
                            get_str(message, "problem", None),
                        )
                        self.init_received = message
                        self.on_control(self, message)
                        self.send_control("init", version=1, host="localhost")
                    elif not self.on_control(self, message):
                        logger.debug("frame_received: control rejected, closing")
                        self.close()
                    return

                channel = get_str(message, "channel", None)
                origin = self.channels.get(channel)

                match origin:
                    case BinaryChannelOrigin(enqueue) | TextChannelOrigin(enqueue):
                        enqueue(frame.decode())
                    case ExternalChannelOrigin(enqueue):
                        enqueue(message)
                    case None:
                        pass

                if origin is not None and command == "close":
                    del self.channels[channel]
            except (json.JSONDecodeError, JsonError) as exc:
                logger.info("closing session due to json error from bridge: %s", exc)
                self.close()

    # Mux/demux: messages from channels to router
    def send_data(self, data: bytes) -> None:
        """Send data to the router. No-op if connection closed."""
        assert self.was_connected
        if self.connection is not None:
            self.connection.send_data(data)

    def send_control(
        self, command: str, msg: JsonObject | None = None, /, **kwargs: JsonValue
    ) -> None:
        """Send a control message to the router."""
        message = create_object(msg, {**kwargs, "command": command})
        self.send_data(b"\n" + json.dumps(message).encode())

    def register_origin(self, origin: ChannelOrigin, channel: str | None = None) -> str:
        """Register an origin for a channel. Allocates channel ID for external
        channels."""
        if channel is None:
            channel = f"external{self.next_external_id}"
            self.next_external_id += 1

        self.channels[channel] = origin
        return channel

    def open_channel(
        self, options: JsonObject
    ) -> tuple[str, asyncio.Queue[JsonObject | bytes]]:
        """Open a channel and return (channel_id, queue)."""
        queue: asyncio.Queue[JsonObject | bytes] = asyncio.Queue()
        channel = self.register_origin(ExternalChannelOrigin(queue.put_nowait))
        self.send_control("open", options, channel=channel, flow_control=True)
        return channel, queue

    async def wait_channel_ready(
        self, queue: asyncio.Queue[JsonObject | bytes]
    ) -> JsonObject:
        """Wait for a channel to become ready.

        Raises CockpitProblem if the channel fails to open.
        """
        open_result = await queue.get()
        if not isinstance(open_result, Mapping):
            logger.warning(
                "wait_channel_ready: expected control message, got %r",
                type(open_result),
            )
            raise CockpitProblem("protocol-error")
        try:
            command = get_str(open_result, "command")
        except JsonError as exc:
            logger.warning("wait_channel_ready: invalid response: %s", exc)
            raise CockpitProblem("protocol-error") from exc
        if command != "ready":
            raise CockpitProblem(
                get_str(open_result, "problem", "internal-error"), open_result
            )
        return open_result

    async def stream_channel(
        self, queue: asyncio.Queue[JsonObject | bytes]
    ) -> AsyncIterator[bytes]:
        """Stream data from a channel queue, handling ping/pong and close/done."""
        while item := await queue.get():
            match item:
                case Mapping():
                    match get_str(item, "command"):
                        case "ping":
                            self.send_control("pong", item)
                        case "close" | "done":
                            break
                        case _:
                            pass
                case bytes():
                    yield item


class BridgeTransport(asyncio.Transport):
    """Transport that connects to an in-process Bridge/Router."""

    def __init__(self, session: Session, protocol: asyncio.Protocol):
        self.session = session
        self.protocol = protocol

    def write(self, data: bytes | bytearray | memoryview) -> None:
        """Called by protocol to send data. Forwards to session for demux."""
        # Protocol writes frames with length header
        assert isinstance(data, bytes)
        header, _, frame = data.partition(b"\n")
        assert int(header) == len(frame)
        self.session.frame_received(frame)

    def send_data(self, data: bytes) -> None:
        """Send data to the protocol (adds length header)."""
        header = f"{len(data)}\n".encode()
        self.protocol.data_received(header + data)

    def close(self) -> None:
        pass

    def shutdown(self) -> None:
        pass


class SocketProtocol(asyncio.Protocol):
    """Protocol for Unix socket connection to external bridge."""

    def __init__(self, session: Session):
        self.session = session
        self.buffer = b""
        self._transport: asyncio.Transport | None = None

    def connection_made(self, transport: asyncio.BaseTransport) -> None:
        logger.debug("SocketProtocol: connection_made")
        assert isinstance(transport, asyncio.Transport)
        self._transport = transport

    def data_received(self, data: bytes) -> None:
        logger.debug(
            "SocketProtocol: data_received %d bytes: %r", len(data), data[:200]
        )
        self.buffer += data
        # Parse frames: each is "length\nframe"
        while b"\n" in self.buffer:
            header, _, rest = self.buffer.partition(b"\n")
            length = int(header)
            logger.debug(
                "SocketProtocol: frame header=%r, need %d bytes, have %d",
                header,
                length,
                len(rest),
            )
            if len(rest) < length:
                break  # incomplete frame
            frame = rest[:length]
            self.buffer = rest[length:]
            self.session.frame_received(frame)

    def send_data(self, data: bytes) -> None:
        """Send data to the bridge (adds length header)."""
        logger.debug("SocketProtocol: send_data %d bytes: %r", len(data), data[:200])
        assert self._transport is not None
        header = f"{len(data)}\n".encode()
        self._transport.write(header + data)

    def shutdown(self) -> None:
        """Close the connection to the bridge."""
        if self._transport is not None:
            self._transport.close()

    def connection_lost(self, exc: Exception | None) -> None:
        logger.debug("SocketProtocol: connection_lost exc=%s", exc)
        self.session.close()


class CockpitWebSocket:
    def __init__(self, ws: WebSocket, session: Session):
        self.ws = ws
        self.session = session
        self.closed = False
        self.init_received = False
        self.outgoing_queue: asyncio.Queue[str | bytes | None] = asyncio.Queue()
        self.channels: set[str] = set()
        self.channel_seed = session.allocate_channel_seed()

        # to avoid having to recompute these each time...
        self.binary_channel_seed = self.channel_seed.encode()
        self.binary_origin = BinaryChannelOrigin(self.outgoing_queue.put_nowait)
        self.text_origin = TextChannelOrigin(self.outgoing_queue.put_nowait)

    def send_control(
        self, command: str, msg: JsonObject | None = None, /, **kwargs: JsonValue
    ) -> None:
        message = create_object(msg, {**kwargs, "command": command})
        self.outgoing_queue.put_nowait("\n" + json.dumps(message))

    def transport_control_received(self, command: str, message: JsonObject) -> None:
        if command == "init":
            if message.get("version") != 1:
                raise CockpitProtocolError("expected init version 1")
            if self.init_received:
                # Due to a historical bug in the shell we are unfortunately
                # forced to accept and ignore extra init messages.
                return
            self.init_received = True
            return

        if not self.init_received:
            raise CockpitProtocolError("expected init message first")

        match command:
            case "ping":
                self.send_control("pong", message)

            case "logout":
                logger.debug("logout received, closing session")
                self.session.close()
                self.closed = True

            case other:
                logger.debug("Unknown transport control message %r", message)
                raise CockpitProtocolError(f"unknown transport control {other!r}")

    def channel_control_received(
        self, command: str, channel: str, frame: str, *, binary: bool
    ) -> None:
        if not channel.startswith(self.channel_seed):
            raise CockpitProtocolError(f"invalid channel {channel!r}")

        if command == "open":
            if binary:
                self.session.register_origin(self.binary_origin, channel)
            else:
                self.session.register_origin(self.text_origin, channel)
            self.channels.add(channel)

        self.session.send_data(frame.encode())

    def control_frame_received(self, frame: str) -> None:
        control = parse_json_object(frame)
        command = get_str(control, "command")
        channel = get_str(control, "channel", None)
        if channel is not None:
            binary = get_enum(control, "binary", ["raw"], None) == "raw"
            self.channel_control_received(command, channel, frame, binary=binary)
        else:
            self.transport_control_received(command, control)

    def text_data_frame_received(self, frame: str) -> None:
        if "\n" not in frame:
            # C-COMPAT: should be a protocol error, but C ignores it
            logger.info("received invalid message without channel prefix")
            return
        if not self.init_received:
            # C-COMPAT: C forwards(!) this to the bridge.  We just drop it.
            return
        if not frame.startswith(self.channel_seed):
            # C-COMPAT: should be a protocol error, but C allows(!) it
            logger.info("received message with invalid channel prefix")

        # Otherwise there's only one place to send it...
        self.session.send_data(frame.encode())

    def text_frame_received(self, frame: str) -> None:
        if frame.startswith("\n"):
            self.control_frame_received(frame)
        else:
            self.text_data_frame_received(frame)

    def binary_data_frame_received(self, frame: bytes) -> None:
        if b"\n" not in frame:
            # C-COMPAT: should be a protocol error, but C ignores it
            logger.info("received invalid message without channel prefix")
            return
        if not self.init_received:
            # C-COMPAT: C forwards to bridge, but bridge discards; just ignore
            return
        if not frame.startswith(self.channel_seed.encode()):
            # C-COMPAT: should be a protocol error, but C allows(!) it
            logger.info("received message with invalid channel prefix")

        # Otherwise there's only one place to send it...
        self.session.send_data(frame)

    async def communicate(self) -> None:
        self.session.attach_websocket()

        async def process_outgoing_queue() -> None:
            while True:
                item = await self.outgoing_queue.get()
                if isinstance(item, str):
                    await self.ws.send_text(item)
                elif isinstance(item, bytes):
                    await self.ws.send_bytes(item)
                else:
                    if not self.closed:
                        await self.ws.close()
                    break

        write_task = asyncio.create_task(process_outgoing_queue())

        try:
            # send our "init" to the websocket
            await self.ws.accept(subprotocol="cockpit1")
            self.send_control(
                "init",
                version=1,
                host="localhost",
                channel_seed=self.channel_seed,
                csrf_token=self.session.csrf_token,
                capabilities=["multi", "credentials", "binary"],
                system={"version": "0"},
            )

            while not self.closed:
                match await self.ws.receive():
                    case {"type": "websocket.disconnect"}:
                        self.closed = True
                    case {"text": str(frame)}:
                        self.text_frame_received(frame)
                    case {"bytes": bytes(frame)}:
                        self.binary_data_frame_received(frame)
                    case msg:
                        raise CockpitProtocolError(f"strange websocket message {msg!s}")

        except CockpitProblem as exc:
            logger.debug("closing websocket due to error: %r", exc)
            if not self.closed:
                self.send_control("close", exc.get_attrs())
        except (json.JSONDecodeError, JsonError) as exc:
            logger.info("closing websocket due to json error: %s", exc)
            if not self.closed:
                self.send_control("close", problem="protocol-error", message=str(exc))

        finally:
            for channel in self.channels:
                self.session.send_control("close", channel=channel)
            self.session.detach_websocket()
            self.outgoing_queue.put_nowait(None)
            await write_task


COMMON_HEADERS = {
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-DNS-Prefetch-Control": "off",
    "X-Frame-Options": "sameorigin",
}


class CockpitMiddleware(BaseHTTPMiddleware):
    @staticmethod
    def error_message(status_code: int) -> str:
        try:
            # This is also how uvicorn does it
            return http.HTTPStatus(status_code).phrase
        except ValueError:
            return f"{status_code} failed"

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Any]
    ) -> Response:
        response = await call_next(request)
        for key, value in COMMON_HEADERS.items():
            response.headers[key] = value

        # Wrap empty error responses in fail.html (only bare Response, not subclasses)
        # Note: call_next returns StreamingResponse wrapper, check type name
        if (
            type(response).__name__ == "_StreamingResponse"
            and response.status_code >= 400
            and response.headers.get("content-length") == "0"
        ):
            message = self.error_message(response.status_code)
            content = read_cockpit_data_file("fail.html").replace(
                b"@@message@@", message.encode()
            )
            logger.debug(
                "wrapping %d in fail.html, message=%r", response.status_code, message
            )
            original_headers = {
                k: v
                for k, v in response.headers.items()
                if k.lower() != "content-length"
            }
            response = Response(
                content,
                status_code=response.status_code,
                media_type="text/html; charset=utf-8",
                headers=original_headers,
            )

        return response


class Server(ABC):
    """Abstract base class for cockpit web servers."""

    def __init__(self, config: Config):
        self.config = config

    @abstractmethod
    async def start(self) -> None:
        """Initialize server state (e.g., create sessions)."""
        raise NotImplementedError

    @abstractmethod
    def lookup_session(
        self, cookies: Mapping[str, str], app_ctx: AppContext
    ) -> Session | None:
        """Find the session for a request based on cookies and app context."""
        raise NotImplementedError

    @abstractmethod
    async def login(self, app_ctx: AppContext, request: Request) -> Response:
        """Handle POST /login for authentication."""
        raise NotImplementedError

    # === Handler helpers ===

    def serve_login_html(self, app_ctx: AppContext) -> Response:
        try:
            with open(Path(__file__).parent / "static" / "login.html") as f:
                content = f.read()
        except OSError:
            return Response(status_code=404)

        environment = {
            "page": {
                "connect": True,
                "require_host": self.config.for_cockpit_client,
                "allow_multihost": False,
            },
            "hostname": platform.node(),
            "is_cockpit_client": self.config.for_cockpit_client,
        }
        # TODO: use app_ctx to set correct base href
        env_json = json.dumps(environment)
        inject = (
            f'<base href="/">\n'
            f"    <script>\nvar environment = {env_json};\n    </script>"
        )
        content = content.replace('<meta insert="dynamic_content_here" />', inject)
        return Response(content, media_type="text/html")

    async def serve_package_file(
        self,
        session: Session,
        host: str | None,
        path: str,
        headers: dict[str, str],
        inject_base: str | None = None,
    ) -> Response:
        """Serve a file via the bridge's internal packages system.

        Args:
            inject_base: If set, inject <base href="..."> after <head> in HTML.
        """
        channel, queue = session.open_channel({
            "payload": "http-stream1",
            "internal": "packages",
            "method": "GET",
            "host": host or "localhost",
            "path": f"/{path}",
            "headers": headers,
            "binary": "raw",
        })

        # Wait for ready
        msg = await queue.get()
        assert isinstance(msg, Mapping)
        if get_str(msg, "command") != "ready":
            return Response(status_code=502, content="Channel failed to open")

        # Signal we have no body to send
        session.send_control("done", channel=channel)

        # First data message has HTTP status and headers (as JSON-encoded data)
        stream = session.stream_channel(queue)
        first = await anext(stream)
        try:
            msg = parse_json_object(first)
            status = get_int(msg, "status", 500)
            response_headers = get_str_map(msg, "headers", {})
        except (json.JSONDecodeError, JsonError) as exc:
            logger.info("invalid http-stream1 response: %s", exc)
            return Response(status_code=502, content="Invalid response from bridge")

        async def with_injection() -> AsyncIterator[bytes]:
            if inject_base is not None:
                # NB: We assume <head> will be in the first chunk if it appears at all
                if chunk := await anext(stream, None):
                    yield chunk.replace(
                        b"<head>",
                        f'<head><base href="{inject_base}">'.encode(),
                        1,
                    )

            async for chunk in stream:
                yield chunk

        return StreamingResponse(
            with_injection(), status_code=status, headers=response_headers
        )

    def serve_static(self, path: str) -> Response:
        """Serve static/branding files."""
        if ".." in path:
            return Response(status_code=404)
        content_type, _encoding = mimetypes.guess_type(path)
        for root in [
            Path(__file__).parent / "static",
            Path(__file__).parent / "branding" / "default",
        ]:
            try:
                with open(root / path, "rb") as f:
                    content = f.read()
                return Response(content, media_type=content_type)
            except FileNotFoundError:
                continue
        return Response(status_code=404)

    # === Route handlers ===

    async def handle_ping(self) -> Response:
        logger.debug("handle_ping")
        return JSONResponse({"service": "cockpit"})

    async def handle_root_file(self, filename: str) -> Response:
        logger.debug("handle_root_file: %r", filename)
        return FileResponse(Path(__file__).parent / "branding" / "default" / filename)

    async def handle_ca_cert(self) -> Response:
        logger.debug("handle_ca_cert")
        # TODO: implement properly
        return Response(status_code=404)

    async def handle_robots(self) -> Response:
        logger.debug("handle_robots")
        return Response("User-agent: *\nDisallow: /\n", media_type="text/plain")

    async def handle_branding(
        self, app_ctx: AppContext, path: str, request: Request
    ) -> Response:
        logger.debug("handle_branding: %r", path)
        del app_ctx, request  # may be used later
        return self.serve_static(path)

    async def handle_resource(
        self,
        app_ctx: AppContext,
        host: str,
        path: str,
        request: Request,
    ) -> Response:
        """Handle /cockpit/@host/... or /cockpit/$cksum/... package resources."""
        logger.debug("handle_resource: host=%r path=%r", host, path)
        session = self.lookup_session(request.cookies, app_ctx)

        if path.endswith("/"):
            path += "index.html"

        if session is None:
            if path.endswith(".html"):
                return self.serve_login_html(app_ctx)
            return Response(status_code=401)

        # TODO: checksums?
        target_host = host[1:]  # strip @ prefix

        headers = {
            "X-Forwarded-Proto": request.url.scheme,
            "X-Forwarded-Host": request.headers.get("host", "localhost"),
        }
        return await self.serve_package_file(session, target_host, path, headers)

    async def handle_shell(
        self, app_ctx: AppContext, path: str, request: Request
    ) -> Response:
        """Handle shell paths (/, /@host/..., /=host/..., /pkg/...)."""
        logger.debug("handle_shell: path=%r", path)
        session = self.lookup_session(request.cookies, app_ctx)
        if session is None:
            return self.serve_login_html(app_ctx)

        # Shell paths (/, /system, /=host/system, etc.) serve shell/index.html
        # The URL path is used for client-side routing via hash
        headers = {
            "X-Forwarded-Proto": request.url.scheme,
            "X-Forwarded-Host": request.headers.get("host", "localhost"),
        }
        base_href = f"{app_ctx.url_root}/@localhost/shell/"
        return await self.serve_package_file(
            session, None, "shell/index.html", headers, inject_base=base_href
        )

    async def handle_channel(
        self, app_ctx: AppContext, csrf_token: str, request: Request
    ) -> Response:
        """Handle external channel requests."""
        logger.debug("handle_channel: csrf_token=%r", csrf_token)
        session = self.lookup_session(request.cookies, app_ctx)
        if session is None or session.csrf_token != csrf_token:
            logger.debug("handle_channel: no session or token mismatch")
            return Response(status_code=404)

        # Decode and validate the request before opening the channel
        try:
            options = parse_json_object(
                binascii.a2b_base64(request.scope["query_string"])
            )
            with get_nested(options, "external", {}) as external:
                headers: dict[str, str] = {
                    "content-type": get_str(
                        external, "content-type", "application/octet-stream"
                    )
                }
                if content_disposition := get_str(
                    external, "content-disposition", None
                ):
                    headers["content-disposition"] = content_disposition
                if content_encoding := get_str(external, "content-encoding", None):
                    headers["content-encoding"] = content_encoding
        except (json.JSONDecodeError, JsonError, binascii.Error) as exc:
            return Response(
                status_code=400, content=f"Invalid channel options: {exc!s}"
            )

        # Open the channel
        _channel, queue = session.open_channel(options)

        # Wait for ready or close
        try:
            open_result = await session.wait_channel_ready(queue)
        except CockpitProblem as exc:
            return JSONResponse(dict(exc.attrs), status_code=400)

        try:
            headers["content-length"] = str(get_int(open_result, "size-hint"))
        except JsonError:
            pass  # C-COMPAT: silently ignore bad size-hint

        return StreamingResponse(
            session.stream_channel(queue), status_code=200, headers=headers
        )

    async def handle_channel_websocket(self, ws: WebSocket) -> None:
        """Handle external channel WebSocket requests."""
        token = ws.path_params.get("token", "")
        logger.debug("handle_channel_websocket: token=%r", token)

        app_ctx, _ = AppContext.split(ws.url.path)
        session = self.lookup_session(ws.cookies, app_ctx)
        logger.debug(
            "handle_channel_websocket: session=%r, session.csrf_token=%r",
            session,
            session.csrf_token if session else None,
        )
        if session is None or session.csrf_token != token:
            logger.debug("handle_channel_websocket: no session or token mismatch")
            await ws.accept()
            await ws.close(1008)  # Policy Violation
            return

        # Decode the query string
        try:
            options = parse_json_object(binascii.a2b_base64(ws.scope["query_string"]))
        except (json.JSONDecodeError, JsonError, binascii.Error) as exc:
            logger.debug("handle_channel_websocket: invalid query string: %s", exc)
            await ws.accept()
            await ws.close(1002)  # Protocol Error
            return

        # Accept with any requested subprotocol (test uses "protocol-unused")
        subprotocol = ws.scope.get("subprotocols", [None])[0]
        await ws.accept(subprotocol=subprotocol)
        logger.debug(
            "handle_channel_websocket: accepted, options=%r, subprotocol=%r",
            options,
            subprotocol,
        )

        # Open the channel
        channel, queue = session.open_channel(options)
        logger.debug("handle_channel_websocket: opened channel %r", channel)

        # Wait for ready
        try:
            open_result = await session.wait_channel_ready(queue)
        except CockpitProblem:
            logger.debug("handle_channel_websocket: channel not ready, closing")
            await ws.close(1011)  # Internal Error
            return
        logger.debug("handle_channel_websocket: open_result=%r", open_result)

        logger.debug("handle_channel_websocket: channel ready, forwarding messages")

        # Forward messages between WebSocket and channel
        async def ws_to_channel() -> None:
            from starlette.websockets import WebSocketDisconnect

            try:
                while True:
                    data = await ws.receive_text()
                    # Send data to channel: format is "channel\ndata"
                    session.send_data(channel.encode() + b"\n" + data.encode())
            except WebSocketDisconnect:
                # Client closed, send done
                session.send_control("done", channel=channel)

        async def channel_to_ws() -> None:
            try:
                async for data in session.stream_channel(queue):
                    await ws.send_text(data.decode())
            except Exception:
                pass

        # Run both directions concurrently
        await asyncio.gather(ws_to_channel(), channel_to_ws(), return_exceptions=True)

    # === Main request handler ===

    async def handle_request(self, request: Request) -> Response:
        """Unified request handler."""
        if request.url.path.endswith("/robots.txt"):
            return await self.handle_robots()

        # Reject path traversal attempts
        if "//" in request.url.path or "/." in request.url.path:
            return Response(status_code=400, content="Invalid path")

        app_ctx, path = AppContext.split(request.url.path)
        logger.debug("handle_request: app_ctx=%r path=%r", app_ctx, path)

        if app_ctx.is_resource:
            # Resource paths: /cockpit/..., /cockpit+app/..., /cockpit+=host/...
            match path.split("/", 1):
                case ["socket"]:
                    return Response(
                        status_code=400, content="WebSocket upgrade required"
                    )
                case ["channel", token]:
                    return await self.handle_channel(app_ctx, token, request)
                case ["static", rest]:
                    return await self.handle_branding(app_ctx, rest, request)
                case ["login"]:
                    return await self.login(app_ctx, request)
                case [s, rest] if s.startswith("@"):
                    return await self.handle_resource(app_ctx, s, rest, request)
                case _:
                    return Response(status_code=404)

        else:
            # Non-resource paths: shell paths and fixed endpoints
            match path:
                case "ping":
                    return await self.handle_ping()
                case "favicon.ico":
                    return await self.handle_root_file("favicon.ico")
                case "apple-touch-icon.png":
                    return await self.handle_root_file("apple-touch-icon.png")
                case "ca.cer":
                    return await self.handle_ca_cert()
                case _:
                    return await self.handle_shell(app_ctx, path, request)

    async def handle_websocket(self, ws: WebSocket) -> None:
        """Unified WebSocket handler."""
        logger.debug("handle_websocket: %r", ws.url.path)
        app_ctx, _ = AppContext.split(ws.url.path)
        session = self.lookup_session(ws.cookies, app_ctx)
        if session is None:
            await ws.accept(subprotocol="cockpit1")
            await ws.send_text('\n{"command": "init", "problem": "no-session"}')
            await ws.close()
            return

        cws = CockpitWebSocket(ws, session)
        await cws.communicate()

    def create_asgi_app(self, extra_routes: Sequence[BaseRoute] = ()) -> Starlette:
        """Create the ASGI application."""
        routes = [
            # WebSocket routes - need explicit patterns for all */socket paths
            WebSocketRoute("/socket", self.handle_websocket),
            WebSocketRoute("/{prefix}/socket", self.handle_websocket),
            # External channel WebSocket
            WebSocketRoute("/cockpit/channel/{token}", self.handle_channel_websocket),
            WebSocketRoute("/{prefix}/channel/{token}", self.handle_channel_websocket),
            # Extra routes first so /mock/*, /qunit/* etc. win
            *extra_routes,
            # Catch-all for HTTP (must be last)
            Route("/{path:path}", self.handle_request),
            Route("/", self.handle_request),
        ]
        app = Starlette(routes=routes)
        app.add_middleware(CockpitMiddleware)
        return app


class LocalSessionServer(Server):
    """Server with a single pre-authenticated session. No login required."""

    def __init__(self, config: Config, bridge_cmd: Sequence[str]):
        super().__init__(config)
        self.bridge_cmd = bridge_cmd
        self.session = Session(self._on_control, idle_timeout=None)
        self.startup_event = asyncio.Event()

    def _on_control(self, session: Session, message: JsonObject | None) -> bool:
        """Handle control messages. Rejects authorize, signals startup on init/close."""
        assert session is self.session
        if message is not None and get_str(message, "command", None) == "authorize":
            logger.warning("LocalSessionServer: unexpected authorize message")
            return False
        self.startup_event.set()
        return True

    async def start(self) -> None:
        await self.session.start_with_subprocess(self.bridge_cmd)
        await self.startup_event.wait()
        if self.session.init_received is None:
            raise RuntimeError("Bridge startup failed")

    def lookup_session(
        self, cookies: Mapping[str, str], app_ctx: AppContext
    ) -> Session | None:
        del cookies, app_ctx  # we serve the same session to everybody who asks
        return self.session if self.session.connection else None

    async def login(self, app_ctx: AppContext, request: Request) -> Response:
        logger.debug("LocalSessionServer.login")
        del app_ctx, request
        if self.session.connection is None:
            logger.debug("LocalSessionServer.login: session unexpectedly exited")
            return Response(status_code=503, content="Session unexpectedly exited")
        logger.debug("LocalSessionServer.login: %r", self.session.init_received)
        return JSONResponse(self.session.init_received)


class PendingLogin:
    """Handles the auth protocol for a single login attempt."""

    def __init__(self, credentials: str):
        self.session = Session(self.handle)
        self.credentials = credentials
        self._event = asyncio.Event()
        self._result: JsonObject | tuple[str, str] | None = None

    def handle(self, session: Session, message: JsonObject | None) -> bool:
        """Handle control messages during auth."""
        logger.debug("PendingLogin.handle: %r", message)

        if message is None or get_str(message, "command", None) == "init":
            self.complete(message)
            return True

        if get_str(message, "command", None) != "authorize":
            return True  # not our concern, but don't reject

        cookie = get_str(message, "cookie")
        challenge = get_str(message, "challenge")
        logger.debug("PendingLogin.handle: challenge %r", challenge)

        try:
            auth_type, _ = authorize.parse_type(challenge)
        except ValueError:
            logger.debug("PendingLogin.handle: failed to parse challenge")
            return False

        if auth_type == "*":
            # Credentials request - respond and keep waiting
            # cockpit-session uses a hand-rolled parser that requires compact JSON
            logger.debug("PendingLogin.handle: sending credentials")
            msg = json.dumps(
                {
                    "command": "authorize",
                    "cookie": cookie,
                    "response": self.credentials,
                },
                separators=(",", ":"),
            )
            session.send_data(b"\n" + msg.encode())
            return True
        elif auth_type == "x-conversation":
            # Multi-step auth - signal caller
            conversation_id, _ = authorize.parse_x_conversation(challenge)
            logger.debug("PendingLogin.handle: x-conversation %r", conversation_id)
            self._result = (conversation_id, challenge)
            self._event.set()
            return True
        else:
            logger.debug("PendingLogin.handle: unhandled auth type %r", auth_type)
            return False

    def complete(self, message: JsonObject | None) -> None:
        """Called by on_change for init or close."""
        logger.debug("PendingLogin.complete: %r", message)
        self._result = message
        self._event.set()

    async def wait(self) -> JsonObject | tuple[str, str] | None:
        """Wait for auth result."""
        await self._event.wait()
        return self._result


class AuthenticatedServer(Server):
    """Server that requires authentication.

    Supports two modes:
    - socket_path set: authenticate via external session socket
    Session backends are determined by Config: cockpit.conf sections provide
    Command or UnixPath per auth type, with fallback to the session socket.
    """

    def __init__(
        self,
        config: Config,
        *,
        auth_timeout: float = 60.0,
    ):
        super().__init__(config)
        self.auth_timeout = auth_timeout
        self.authenticated_sessions: dict[str, Session] = {}  # cookie → session
        self.pending_logins: dict[str, PendingLogin] = {}  # conversation_id → pending
        # conversation_id → handle
        self._pending_timeouts: dict[str, asyncio.TimerHandle] = {}

    def _expire_pending(self, conversation_id: str) -> None:
        """Called when a pending login times out."""
        logger.debug("AuthenticatedServer: conversation %r timed out", conversation_id)
        del self._pending_timeouts[conversation_id]
        if pending := self.pending_logins.pop(conversation_id, None):
            pending.session.close()

    async def start(self) -> None:
        pass  # sessions are created on demand

    def _cookie_name(self, app_ctx: AppContext) -> str:
        if app_ctx.host:
            return f"machine-cockpit+{app_ctx.host}"
        if app_ctx.app:
            return f"cockpit+{app_ctx.app}"
        return "cockpit"

    def lookup_session(
        self, cookies: Mapping[str, str], app_ctx: AppContext
    ) -> Session | None:
        if cookie := cookies.get(self._cookie_name(app_ctx)):
            return self.authenticated_sessions.get(cookie)
        return None

    def _on_session_control(
        self, cookie: str, session: Session, message: JsonObject | None
    ) -> bool:
        """Handle control messages for authenticated session."""
        if message is None:
            logger.debug("AuthenticatedServer: session %r closed", cookie)
            self.authenticated_sessions.pop(cookie, None)
        return True

    async def _start_session(
        self, pending: PendingLogin, app_ctx: AppContext, auth_type: str
    ) -> None:
        """Start session connection based on config.

        Decision tree (matches C cockpit-ws):
          - remote host → Ssh-Login section
          - local_ssh + basic → Ssh-Login section
          - otherwise → look up auth_type section, fallback to session socket
        """
        session = pending.session

        if app_ctx.host is not None:
            if not self.config.login_to:
                raise ValueError("Direct remote login is disabled")
            cmd, _host = self.config.get_ssh_spawn(app_ctx.host)
            await session.start_with_subprocess(cmd)
        elif self.config.local_ssh and auth_type.lower() == "basic":
            cmd, _host = self.config.get_ssh_spawn(None)
            await session.start_with_subprocess(cmd)
        else:
            command, unix_path = self.config.get_session_backend(auth_type.lower())
            if command is not None:
                cmd = shlex.split(command) + ["localhost"]
                await session.start_with_subprocess(cmd)
            elif unix_path is not None:
                await session.start_with_socket(unix_path)
            else:
                raise ValueError("No auth backend configured")

    async def login(self, app_ctx: AppContext, request: Request) -> Response:
        logger.debug("AuthenticatedServer.login: app_ctx=%r", app_ctx)
        credentials = request.headers.get("Authorization", "")

        # If no credentials but valid session cookie, return session info
        if not credentials:
            session = self.lookup_session(request.cookies, app_ctx)
            if session and session.init_received:
                logger.debug("AuthenticatedServer.login: returning existing session")
                return JSONResponse(session.init_received)
            logger.debug("AuthenticatedServer.login: no credentials, no session")
            return Response(status_code=401)

        # Check for ongoing conversation
        auth_type = ""
        conversation_id = None
        try:
            auth_type, _ = authorize.parse_type(credentials)
            if auth_type == "x-conversation":
                conversation_id, _ = authorize.parse_subject(credentials)
        except ValueError:
            pass

        if conversation_id:
            if conversation_id in self.pending_logins:
                # Continue existing conversation
                logger.debug(
                    "AuthenticatedServer.login: continuing conversation %r",
                    conversation_id,
                )
                pending = self.pending_logins.pop(conversation_id)
                if handle := self._pending_timeouts.pop(conversation_id, None):
                    handle.cancel()
                # cockpit-session uses a hand-rolled parser that requires compact JSON
                msg = json.dumps(
                    {"command": "authorize", "response": credentials},
                    separators=(",", ":"),
                )
                pending.session.send_data(b"\n" + msg.encode())
            else:
                # Conversation expired or never existed
                logger.debug(
                    "AuthenticatedServer.login: conversation %r not found",
                    conversation_id,
                )
                return JSONResponse(
                    {
                        "error": "authentication-failed",
                        "message": "Conversation timed out",
                    },
                    status_code=401,
                )
        else:
            # New authentication attempt
            logger.debug("AuthenticatedServer.login: new auth attempt")
            pending = PendingLogin(credentials)
            try:
                await self._start_session(pending, app_ctx, auth_type)
            except (OSError, ValueError) as exc:
                logger.debug("AuthenticatedServer.login: error %s", exc)
                if isinstance(exc, ValueError):
                    return Response(status_code=403)
                return JSONResponse(
                    {"error": "internal-error", "message": str(exc)}, status_code=500
                )

        # Wait for result
        event = await pending.wait()

        match event:
            case None:
                logger.debug("AuthenticatedServer.login: session closed")
                return JSONResponse(
                    {"error": "terminated", "message": "Session closed"},
                    status_code=500,
                )

            case {"command": "init", "problem": problem}:
                logger.debug("AuthenticatedServer.login: init with problem %r", problem)
                return JSONResponse(event, status_code=401)

            case {"command": "init"}:  # no problem
                logger.debug("AuthenticatedServer.login: success")
                cookie = secrets.token_urlsafe(32)
                self.authenticated_sessions[cookie] = pending.session
                pending.session.on_control = functools.partial(
                    self._on_session_control, cookie
                )
                response = JSONResponse(event)
                response.set_cookie(
                    self._cookie_name(app_ctx),
                    cookie,
                    httponly=True,
                    secure=self.config.is_https,
                    samesite="strict",
                )
                return response

            case (conversation_id, challenge):
                logger.debug(
                    "AuthenticatedServer.login: conversation %r", conversation_id
                )
                self.pending_logins[conversation_id] = pending
                loop = asyncio.get_running_loop()
                self._pending_timeouts[conversation_id] = loop.call_later(
                    self.auth_timeout, self._expire_pending, conversation_id
                )
                return Response(
                    status_code=401,
                    headers={"WWW-Authenticate": challenge},
                )


def main() -> None:
    import uvicorn

    from cockpit._version import __version__

    version = f"cockpit-ws {__version__ or '(git)'}"

    parser = argparse.ArgumentParser(description="Cockpit web server")
    parser.add_argument("--debug", "-d", action="store_true", help="Debug output")
    parser.add_argument("--version", action="version", version=version)
    parser.add_argument("--addr", "-a", default="127.0.0.1", help="Address to bind to")
    parser.add_argument("--port", "-p", type=int, help="Port to bind to")

    # fmt:off
    tls = parser.add_mutually_exclusive_group(required=True)
    tls.add_argument("--http", "--no-tls", action="store_true",
                     help="HTTP mode (ie: connection without TLS, or no proxy)")
    tls.add_argument("--https", "--for-tls-proxy", action="store_true",
                     help="HTTPS mode (ie: TLS connection via a TLS-stripping proxy)")

    session_type = parser.add_mutually_exclusive_group()
    session_type.add_argument("--local-ssh", action="store_true",
                              help="Log in locally via SSH")
    session_type.add_argument("--local-session", metavar="CMD",
                              help="Launch a bridge in the local session (no auth)")
    # fmt:on

    args = parser.parse_args()

    logging.basicConfig(level=logging.DEBUG if args.debug else logging.WARNING)

    config = Config(
        is_https=args.https,
        local_ssh=args.local_ssh,
        sections=Config.load_cockpit_conf(),
    )

    if args.local_session:
        server: Server = LocalSessionServer(config, shlex.split(args.local_session))
    else:
        server = AuthenticatedServer(config)

    listen_pid = os.environ.get("LISTEN_PID", "x")
    listen_fds = os.environ.get("LISTEN_FDS", "x")
    if listen_pid == f"{os.getpid()}" and listen_fds.isdecimal():
        del os.environ["LISTEN_PID"]
        del os.environ["LISTEN_FDS"]

        listeners = [socket.socket(fileno=3 + i) for i in range(int(listen_fds))]
    elif args.port:
        listener = socket.socket()
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind((args.addr, args.port))
        listener.listen()
        listeners = [listener]
    else:
        parser.error("--port is mandatory unless LISTEN_FDS are present")

    logger.debug("listeners: pid/%r n/%r %r", listen_pid, listen_fds, listeners)

    async def run() -> None:
        await server.start()

        asgi_app = server.create_asgi_app()
        uvicorn_config = uvicorn.Config(asgi_app)
        uvicorn_server = uvicorn.Server(uvicorn_config)
        await uvicorn_server.serve(listeners)

    asyncio.run(run(), debug=args.debug)


if __name__ == "__main__":
    main()
