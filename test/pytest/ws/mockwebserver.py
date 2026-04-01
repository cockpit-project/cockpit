# Copyright (C) 2024 Red Hat, Inc.
# SPDX-License-Identifier: GPL-3.0-or-later

import asyncio
import contextlib
import logging
import os
import pwd
import socket
import tempfile
from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import uvicorn
from starlette.requests import Request
from starlette.responses import (
    FileResponse,
    HTMLResponse,
    JSONResponse,
    Response,
    StreamingResponse,
)
from starlette.routing import Route

from cockpit._vendor import systemd_ctypes

from .mockdbusservice import mock_dbus_service_on_user_bus
from .webserver import Config, LocalSessionServer

logger = logging.getLogger(__name__)


SPLIT_UTF8_FRAMES = [
    b"initial",
    # split an é in the middle
    b"first half \xc3",
    b"\xa9 second half",
    b"final",
]


def mock_expect_warnings(request: Request) -> Response:
    # no op — only for compatibility with C test-server
    return Response(status_code=200, content="OK")


def mock_info(request: Request) -> JSONResponse:
    return JSONResponse({
        "pybridge": True,
        "skip_slow_tests": "COCKPIT_SKIP_SLOW_TESTS" in os.environ,
    })


def mock_stream(request: Request) -> StreamingResponse:
    def generate() -> Iterator[bytes]:
        for i in range(10):
            yield f"{i} ".encode()

    return StreamingResponse(generate())


def mock_split_utf8(request: Request) -> StreamingResponse:
    def generate() -> Iterator[bytes]:
        yield from SPLIT_UTF8_FRAMES

    return StreamingResponse(generate())


def mock_truncated_utf8(request: Request) -> StreamingResponse:
    def generate() -> Iterator[bytes]:
        yield from SPLIT_UTF8_FRAMES[0:2]

    return StreamingResponse(generate())


def mock_headers(request: Request) -> Response:
    headers = {
        k: v for k, v in request.headers.items() if k.lower().startswith("header")
    }
    headers["Header3"] = "three"
    headers["Header4"] = "marmalade"

    return Response(status_code=201, content="Yoo Hoo", headers=headers)


def mock_host(request: Request) -> Response:
    host = request.headers["Host"]
    return Response(status_code=201, content="Yoo Hoo", headers={"Host": host})


def mock_headonly(request: Request) -> Response:
    if request.method != "HEAD":
        return Response(status_code=400, content="Only HEAD allowed on this path")

    input_data = request.headers.get("InputData")
    if not input_data:
        return Response(status_code=400, content="Requires InputData header")

    length = str(len(input_data))
    return Response(status_code=200, content="OK", headers={"InputDataLength": length})


def mock_qs(request: Request) -> Response:
    query_string = request.scope["query_string"].decode()
    return Response(content=query_string.replace(" ", "+"))


def mock_binary_data(request: Request) -> Response:
    return Response(
        content=bytes([255, 1, 255, 2]), media_type="application/octet-stream"
    )


def mock_not_found(request: Request) -> Response:
    return Response(status_code=404)


CSP_POLICY = "default-src 'self' 'unsafe-inline';"


def index(request: Request) -> HTMLResponse:
    cases = Path("qunit").rglob("test-*.html")

    result = (
        """
        <html>
          <head>
             <title>Test cases</title>
          </head>
          <body>
            <ul>
            """
        + "\n".join(f'<li><a href="/{case}">{case}</a></li>' for case in cases)
        + """
            </ul>
          </body>
        </html>
        """
    )

    return HTMLResponse(result, headers={"Content-Security-Policy": CSP_POLICY})


def inject_html_addresses(content: bytes, direct_address: str | None = None) -> bytes:
    """Inject bus_address and direct_address variables into HTML after <head>."""
    injections: list[str] = []

    bus_address = os.environ.get("DBUS_SESSION_BUS_ADDRESS")
    if bus_address:
        injections.append(f"var bus_address = '{bus_address}';")

    if direct_address:
        injections.append(f"var direct_address = '{direct_address}';")

    if not injections:
        return content

    script = f"\n<script>\n{chr(10).join(injections)}\n</script>"
    return content.replace(b"<head>", b"<head>" + script.encode(), 1)


def serve_static_dir(prefix: str, direct_address: str | None = None):
    def handler(request: Request) -> Response:
        path_str = request.path_params.get("path", "")
        path = Path(".") / prefix / path_str

        # Check for .gz variant first
        gz_path = path.with_name(path.name + ".gz")
        is_gzip = False

        if path.is_file():
            actual_path = path
        elif gz_path.is_file():
            actual_path = gz_path
            is_gzip = True
        else:
            return Response(status_code=404)

        # For HTML files, inject addresses and add CSP
        if path_str.endswith(".html"):
            content = actual_path.read_bytes()
            content = inject_html_addresses(content, direct_address)
            return Response(
                content=content,
                media_type="text/html",
                headers={"Content-Security-Policy": CSP_POLICY},
            )

        # For non-HTML files
        if is_gzip:
            return FileResponse(actual_path, headers={"Content-Encoding": "gzip"})
        return FileResponse(actual_path)

    return handler


def make_mock_routes(direct_address: str | None = None) -> list[Route]:
    return [
        Route("/mock/expect-warnings", mock_expect_warnings),
        Route("/mock/dont-expect-warnings", mock_expect_warnings),
        Route("/mock/info", mock_info),
        Route("/mock/stream", mock_stream),
        Route("/mock/split-utf8", mock_split_utf8),
        Route("/mock/truncated-utf8", mock_truncated_utf8),
        Route("/mock/headers", mock_headers),
        Route("/mock/host", mock_host),
        Route("/mock/headonly", mock_headonly, methods=["GET", "HEAD"]),
        Route("/mock/qs", mock_qs),
        Route("/mock/binary-data", mock_binary_data),
        Route("/not/found", mock_not_found),
        Route("/", index),
        # Static file paths - specific prefixes so they don't shadow cockpit routes
        Route("/qunit/{path:path}", serve_static_dir("qunit", direct_address)),
        Route("/pkg/{path:path}", serve_static_dir("pkg", direct_address)),
        Route("/dist/{path:path}", serve_static_dir("dist", direct_address)),
    ]


@contextlib.asynccontextmanager
async def mock_webserver(
    addr: str = "127.0.0.1", port: int = 0, direct_address: str | None = None
) -> AsyncIterator[str]:
    """Run a LocalSessionServer with uvicorn."""
    # Unit tests require this
    me = pwd.getpwuid(os.getuid())
    os.environ["HOME"] = me.pw_dir
    os.environ["SHELL"] = me.pw_shell
    os.environ["USER"] = me.pw_name

    # Create temp config directory for cockpit.Config tests
    with tempfile.TemporaryDirectory(prefix="cockpit.config.") as config_dir:
        os.makedirs(os.path.join(config_dir, "cockpit", "machines.d"), exist_ok=True)
        os.environ["XDG_CONFIG_DIRS"] = config_dir

        server = LocalSessionServer(Config())
        await server.start()

        listener = socket.socket()
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind((addr, port))
        listener.listen()

        addr, port = listener.getsockname()

        config = uvicorn.Config(
            server.create_app(make_mock_routes(direct_address)), lifespan="off"
        )
        uvicorn_server = uvicorn.Server(config)
        uvicorn_server.servers = []  # prevent uvicorn from binding its own sockets

        serve_task = asyncio.create_task(uvicorn_server.serve([listener]))

        try:
            yield f"http://{addr}:{port}/"
        finally:
            logger.debug("cleaning up mock webserver")
            server.session.close()
            uvicorn_server.should_exit = True
            await serve_task
            logger.debug("cleaning up mock webserver complete")


async def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(
        description="Serve a single git repository via HTTP"
    )
    parser.add_argument("--addr", "-a", default="127.0.0.1", help="Address to bind to")
    parser.add_argument(
        "--port", "-p", type=int, default=8080, help="Port number to bind to"
    )
    args = parser.parse_args()

    logging.basicConfig(level=logging.DEBUG)

    async with mock_dbus_service_on_user_bus():
        async with mock_webserver(args.addr, args.port) as base_url:
            print(f"\n  {base_url}\n\nCtrl+C to exit.")
            await asyncio.sleep(1000000)


if __name__ == "__main__":
    systemd_ctypes.run_async(main())
