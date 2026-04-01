# Copyright (C) 2026 Red Hat, Inc.
# SPDX-License-Identifier: GPL-3.0-or-later

import asyncio
import json

import pytest

from .mockwebserver import mock_webserver


async def http_get(
    base_url: str, path: str, headers: dict[str, str] | None = None
) -> tuple[int, dict[str, str], bytes]:
    """Simple async HTTP GET."""
    addr, port = base_url.replace("http://", "").rstrip("/").split(":")

    reader, writer = await asyncio.open_connection(addr, int(port))
    try:
        header_lines = "".join(f"{k}: {v}\r\n" for k, v in (headers or {}).items())
        request = f"GET {path} HTTP/1.1\r\nHost: localhost\r\n{header_lines}\r\n"
        writer.write(request.encode())
        await writer.drain()

        # Read response
        response = await asyncio.wait_for(reader.read(4096), timeout=5)
        header_part, _, body = response.partition(b"\r\n\r\n")
        status_line, *resp_header_lines = header_part.decode().split("\r\n")
        status_code = int(status_line.split()[1])
        resp_headers = dict(line.split(": ", 1) for line in resp_header_lines)
        return status_code, resp_headers, body
    finally:
        writer.close()
        await writer.wait_closed()


@pytest.mark.asyncio
@pytest.mark.timeout(10)
async def test_http_info_endpoint() -> None:
    """Test /mock/info endpoint works."""
    async with mock_webserver() as base_url:
        status, _headers, body = await http_get(base_url, "/mock/info")
        assert status == 200
        data = json.loads(body)
        assert data["pybridge"] is True


@pytest.mark.asyncio
@pytest.mark.timeout(10)
async def test_http_headers_endpoint() -> None:
    """Test /mock/headers endpoint works."""
    async with mock_webserver() as base_url:
        status, headers, _body = await http_get(
            base_url, "/mock/headers", {"Header1": "one", "Header2": "two"}
        )
        assert status == 201
        assert headers["header1"] == "one"
        assert headers["header2"] == "two"
        assert headers["header3"] == "three"
