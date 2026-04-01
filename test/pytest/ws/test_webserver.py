# Copyright (C) 2026 Red Hat, Inc.
# SPDX-License-Identifier: GPL-3.0-or-later

import asyncio
import base64
import json
import os
import socket
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from tempfile import TemporaryDirectory

import pytest
import pytest_asyncio

from .mocksessionsocket import authorize_2fa, authorize_basic, run_session_server
from .webserver import (
    _SHELL_PATH_RE,
    AppContext,
    AuthenticatedServer,
    Config,
    LocalSessionServer,
    Server,
)

SRCDIR = Path(__file__).parent.parent.parent.parent


@pytest.fixture(autouse=True)
def package_env(monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    """Set up package environment with dist/ symlinked as cockpit/."""
    with TemporaryDirectory() as tmpdir:
        tmppath = Path(tmpdir)
        cockpit_dir = tmppath / "cockpit"
        cockpit_dir.symlink_to(SRCDIR / "dist")

        xdg_dirs = (
            f"{tmpdir}:{os.environ.get('XDG_DATA_DIRS', '/usr/local/share:/usr/share')}"
        )
        monkeypatch.setenv("XDG_DATA_DIRS", xdg_dirs)

        yield tmppath


async def run_server(server: Server) -> AsyncIterator[str]:
    """Run a server with uvicorn and yield the base URL."""
    import uvicorn

    listener = socket.socket()
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind(("127.0.0.1", 0))
    listener.listen()
    _, port = listener.getsockname()

    config = uvicorn.Config(server.create_app(), lifespan="off", log_level="warning")
    uvicorn_server = uvicorn.Server(config)
    uvicorn_server.servers = []

    serve_task = asyncio.create_task(uvicorn_server.serve([listener]))

    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        uvicorn_server.should_exit = True
        await serve_task


@pytest_asyncio.fixture
async def local_server() -> AsyncIterator[str]:
    """Run a LocalSessionServer with uvicorn and yield the base URL."""
    srv = LocalSessionServer(Config())
    await srv.start()
    async for url in run_server(srv):
        yield url


@pytest_asyncio.fixture
async def auth_server(package_env: Path) -> AsyncIterator[str]:
    """Run an AuthenticatedServer with mock session socket."""
    socket_path = package_env / "session.sock"
    session_task = asyncio.create_task(
        run_session_server(
            socket_path, auth_func=lambda sock: authorize_basic(sock, "admin:foobar")
        )
    )
    try:
        srv = AuthenticatedServer(Config(), str(socket_path))
        await srv.start()
        async for url in run_server(srv):
            yield url
    finally:
        session_task.cancel()
        try:
            await session_task
        except asyncio.CancelledError:
            pass


@pytest.mark.asyncio
async def test_login(local_server: str) -> None:
    """Test that /cockpit/login returns session info."""
    import httpx

    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{local_server}/cockpit/login")
        assert resp.status_code == 200

        data = resp.json()
        assert "version" in data
        assert data.get("command") == "init"


@pytest.mark.asyncio
async def test_static_files(local_server: str) -> None:
    """Test serving static files."""
    import httpx

    async with httpx.AsyncClient() as client:
        # Test login.css from dist/static
        resp = await client.get(f"{local_server}/cockpit/static/login.css")
        assert resp.status_code == 200
        assert "text/css" in resp.headers.get("content-type", "")

        # Test branding.css fallback from src/branding/default
        resp = await client.get(f"{local_server}/cockpit/static/branding.css")
        assert resp.status_code == 200
        assert "text/css" in resp.headers.get("content-type", "")

        # Test 404 for nonexistent file
        resp = await client.get(f"{local_server}/cockpit/static/nonexistent.xyz")
        assert resp.status_code == 404


@pytest.mark.asyncio
async def test_package_serving(local_server: str) -> None:
    """Test serving packages via the bridge."""
    import httpx

    async with httpx.AsyncClient() as client:
        # Package files require /cockpit/@host/pkg/file path
        resp = await client.get(f"{local_server}/cockpit/@localhost/shell/index.html")
        assert resp.status_code == 200
        assert "text/html" in resp.headers.get("content-type", "")
        assert b"Cockpit" in resp.content

        # Test shell.js
        resp = await client.get(f"{local_server}/cockpit/@localhost/shell/shell.js")
        assert resp.status_code == 200
        assert "javascript" in resp.headers.get("content-type", "")

        # Test base1/cockpit.js
        resp = await client.get(f"{local_server}/cockpit/@localhost/base1/cockpit.js")
        assert resp.status_code == 200
        assert "javascript" in resp.headers.get("content-type", "")


async def get_csrf_token(server_url: str) -> str:
    """Connect via websocket and get CSRF token from init message."""
    import websockets

    ws_url = server_url.replace("http://", "ws://") + "/socket"
    async with websockets.connect(ws_url, subprotocols=["cockpit1"]) as ws:
        # Receive server init
        msg = await ws.recv()
        assert isinstance(msg, str)
        init = json.loads(msg.lstrip("\n"))
        assert init.get("command") == "init"
        csrf_token = init.get("csrf-token")
        assert csrf_token

        # Send client init
        await ws.send('\n{"command": "init", "version": 1}')

        return csrf_token


@pytest.mark.asyncio
async def test_external_channel(local_server):
    """Test external channel access for fsinfo."""
    import httpx

    csrf_token = await get_csrf_token(local_server)

    async with httpx.AsyncClient() as client:
        # Open an fsinfo channel
        options = {
            "payload": "fsinfo",
            "path": "/etc/os-release",
            "attrs": ["type"],
        }
        query = base64.b64encode(json.dumps(options).encode()).decode()

        resp = await client.get(
            f"{local_server}/cockpit/channel/{csrf_token}?{query}",
            cookies={"cockpit": csrf_token},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("info", {}).get("type") == "reg"


@pytest.mark.asyncio
async def test_external_channel_stream(local_server):
    """Test external channel for spawning a command."""
    import httpx

    csrf_token = await get_csrf_token(local_server)

    async with httpx.AsyncClient() as client:
        # Open a stream channel to run a command
        options = {
            "payload": "stream",
            "spawn": ["echo", "hello"],
        }
        query = base64.b64encode(json.dumps(options).encode()).decode()

        resp = await client.get(
            f"{local_server}/cockpit/channel/{csrf_token}?{query}",
            cookies={"cockpit": csrf_token},
        )
        assert resp.status_code == 200
        assert b"hello" in resp.content


@pytest.mark.asyncio
async def test_authentication(auth_server):
    """Test authentication with AuthenticatedServer."""
    import httpx

    async with httpx.AsyncClient() as client:
        # No credentials → 401 (no WWW-Authenticate to avoid browser popup)
        resp = await client.get(f"{auth_server}/cockpit/login")
        assert resp.status_code == 401
        assert "WWW-Authenticate" not in resp.headers

        # Wrong credentials → 401
        resp = await client.get(
            f"{auth_server}/cockpit/login",
            auth=("admin", "wrongpass"),
        )
        assert resp.status_code == 401

        # Correct credentials → 200 + cookie
        resp = await client.get(
            f"{auth_server}/cockpit/login",
            auth=("admin", "foobar"),
        )
        assert resp.status_code == 200
        assert "cockpit" in resp.cookies
        csrf_token = resp.cookies["cockpit"]

        data = resp.json()
        assert data.get("command") == "init"
        assert "version" in data

        # Can access packages with cookie
        resp = await client.get(
            f"{auth_server}/shell/index.html",
            cookies={"cockpit": csrf_token},
        )
        assert resp.status_code == 200
        assert b"Cockpit" in resp.content


@pytest.mark.asyncio
async def test_auth_timeout(package_env: Path) -> None:
    """Test that pending x-conversation logins time out."""
    import httpx

    socket_path = package_env / "session.sock"

    async def auth_basic_then_2fa(sock):
        if not await authorize_basic(sock, "admin:foobar"):
            return False
        return await authorize_2fa(sock, "123456")

    session_task = asyncio.create_task(
        run_session_server(socket_path, auth_func=auth_basic_then_2fa)
    )
    try:
        srv = AuthenticatedServer(Config(), str(socket_path), auth_timeout=0.1)
        await srv.start()
        async for url in run_server(srv):
            async with httpx.AsyncClient() as client:
                # Start auth - basic succeeds, then get x-conversation challenge
                resp = await client.get(
                    f"{url}/cockpit/login",
                    auth=("admin", "foobar"),
                )
                assert resp.status_code == 401
                challenge = resp.headers.get("WWW-Authenticate", "")
                assert challenge.startswith("X-Conversation ")

                # Wait for timeout
                await asyncio.sleep(0.2)

                # Try to continue - should fail with timeout
                resp = await client.get(
                    f"{url}/cockpit/login",
                    headers={"Authorization": challenge},
                )
                assert resp.status_code == 401
                data = resp.json()
                assert data.get("error") == "authentication-failed"
                assert "timed out" in data.get("message", "").lower()
    finally:
        session_task.cancel()
        try:
            await session_task
        except asyncio.CancelledError:
            pass


@pytest.mark.parametrize(
    "path",
    [
        "",
        "system",
        "system/logs",
        "=host",
        "=host/page",
        "@myhost",
        "@myhost/system",
    ],
)
def test_shell_path_regex_valid(path: str) -> None:
    assert _SHELL_PATH_RE.match(path)


@pytest.mark.parametrize(
    "path",
    [
        "/foo",
        "=/",
        "@/",
    ],
)
def test_shell_path_regex_invalid(path: str) -> None:
    assert not _SHELL_PATH_RE.match(path)


# AppContext.split tests - resource paths (is_resource=True)


@pytest.mark.parametrize(
    ("path", "host", "app", "remaining"),
    [
        # Plain cockpit
        ("/cockpit/login", None, None, "login"),
        ("/cockpit/static/branding.css", None, None, "static/branding.css"),
        ("/cockpit/@host/shell/index.html", None, None, "@host/shell/index.html"),
        # cockpit+app
        ("/cockpit+app/foo", None, "app", "foo"),
        ("/cockpit+myapp/bar/baz", None, "myapp", "bar/baz"),
        # cockpit+=host
        ("/cockpit+=myhost/login", "myhost", None, "login"),
        ("/cockpit+=host.example.com/system", "host.example.com", None, "system"),
    ],
)
def test_app_context_split_resource(
    path: str,
    host: str | None,
    app: str | None,
    remaining: str,
) -> None:
    ctx, rem = AppContext.split(path)
    assert ctx.host == host
    assert ctx.app == app
    assert ctx.is_resource
    assert rem == remaining


# AppContext.split tests - /=host/ prefix (is_resource=False, but host extracted)


@pytest.mark.parametrize(
    ("path", "host", "remaining"),
    [
        ("/=myhost", "myhost", ""),
        ("/=myhost/system", "myhost", "system"),
        ("/=host.example.com/page", "host.example.com", "page"),
    ],
)
def test_app_context_split_host_prefix(
    path: str,
    host: str,
    remaining: str,
) -> None:
    ctx, rem = AppContext.split(path)
    assert ctx.host == host
    assert ctx.app is None
    assert not ctx.is_resource
    assert rem == remaining


# AppContext.split tests - shell paths (not resource, no host)


@pytest.mark.parametrize(
    ("path", "remaining"),
    [
        ("/system", "system"),
        ("/system/logs", "system/logs"),
        ("/@myhost/system", "@myhost/system"),
        ("/", ""),
    ],
)
def test_app_context_split_shell(path: str, remaining: str) -> None:
    ctx, rem = AppContext.split(path)
    assert ctx.host is None
    assert ctx.app is None
    assert not ctx.is_resource
    assert rem == remaining


# Paths that require trailing / should not match without it


@pytest.mark.parametrize(
    ("path", "remaining"),
    [
        ("/cockpit", "cockpit"),  # no trailing /
        ("/cockpit+app", "cockpit+app"),  # no trailing /
        ("/cockpit+=myhost", "cockpit+=myhost"),  # no trailing /
        ("/=", "="),  # empty host
        ("/=/", "=/"),  # empty host with trailing slash
        ("/cockpit+=", "cockpit+="),  # empty host after cockpit+=
        ("/cockpit+=/", "cockpit+=/"),  # empty host with trailing slash
    ],
)
def test_app_context_split_no_match(path: str, remaining: str) -> None:
    ctx, rem = AppContext.split(path)
    assert ctx.host is None
    assert ctx.app is None
    assert not ctx.is_resource
    assert rem == remaining
