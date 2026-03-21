# SPDX-License-Identifier: LGPL-3.0-or-later

import argparse
import asyncio
import contextlib
import json
import logging
import os
import secrets
import socket
import sys
from collections.abc import Awaitable, Callable, Sequence

from cockpit.bridge import Bridge
from cockpit.jsonutil import JsonObject, get_str, typechecked

from . import authorize

logger = logging.getLogger(__name__)


AuthorizeFunction = Callable[[socket.socket], Awaitable[bool]]


async def send_control(sock: socket.socket, msg: JsonObject) -> None:
    """Send a control message."""
    data = b"\n" + json.dumps(msg).encode()
    frame = f"{len(data)}\n".encode() + data
    logger.debug("send_control: %r", msg)
    await asyncio.get_running_loop().sock_sendall(sock, frame)


async def recv_control(sock: socket.socket) -> JsonObject:
    """Receive a control message."""
    loop = asyncio.get_running_loop()

    async def recv_exact(buf: memoryview) -> None:
        while len(buf) > 0:
            n = await loop.sock_recv_into(sock, buf)
            logger.debug("recv_control: received %r bytes of %r", n, len(buf))
            if n == 0:
                raise EOFError
            buf = buf[n:]

    # "15\n\n{"command":""}" is the smallest conceivable message we could get
    # here and it's already 18 bytes, but the maximum size is 2**32 which fits
    # into 10 bytes (or 11, with the '\n' separator).  It's always safe to read
    # those first bytes.
    start = bytearray(16)
    await recv_exact(memoryview(start))

    # Figure out the total message size
    header, nl, initial = start.partition(b"\n")
    if not nl:
        raise ValueError("No newline separator in frame header")
    length = int(header)
    if len(initial) >= length:
        raise ValueError("Initial read already exceeds frame length")

    # Receive the rest.  NB: bytearray.resize() is 3.14+
    payload = bytearray(length)
    payload[: len(initial)] = initial
    await recv_exact(memoryview(payload)[len(initial) :])

    # Parse the payload
    if not payload.startswith(b"\n"):
        raise ValueError("Expected control message (leading newline)")
    logger.debug("recv_control: %r", payload)
    msg = typechecked(json.loads(payload), dict)
    logger.debug("recv_control: %r", msg)
    return msg


async def challenge(sock: socket.socket, challenge: str = "*") -> str:
    """Send authorize challenge and return the response."""
    cookie = secrets.token_hex(16)
    await send_control(
        sock,
        {
            "command": "authorize",
            "cookie": cookie,
            "challenge": challenge,
        },
    )
    msg = await recv_control(sock)
    if get_str(msg, "command") != "authorize" or get_str(msg, "cookie") != cookie:
        raise ValueError("Invalid reply to challenge")
    return get_str(msg, "response", "")


async def authorize_basic(sock: socket.socket, expected: str) -> bool:
    """Default authorizer: accepts expected credentials via Basic auth."""
    response = await challenge(sock)
    try:
        user, password, _ = authorize.parse_basic(response)
        creds = f"{user}:{password}"
    except ValueError:
        creds = None
    logger.debug("authorize_basic: creds=%r", creds)
    if creds != expected:
        await send_control(
            sock,
            {
                "command": "init",
                "version": 1,
                "problem": "authentication-failed",
                "message": "Invalid credentials",
            },
        )
        return False
    return True


async def authorize_2fa(sock: socket.socket, expected_code: str) -> bool:
    """2FA code authorizer."""
    x_conv_challenge, _ = authorize.build_x_conversation("Enter 2FA code")
    response = await challenge(sock, x_conv_challenge)
    try:
        _, code = authorize.parse_x_conversation(response)
    except ValueError:
        code = None
    logger.debug("authorize_2fa: code=%r", code)
    if code != expected_code:
        await send_control(
            sock,
            {
                "command": "init",
                "version": 1,
                "problem": "authentication-failed",
                "message": "Invalid 2FA code",
            },
        )
        return False
    return True


async def run_internal_bridge(sock: socket.socket) -> None:
    _transport, bridge = await asyncio.get_running_loop().create_connection(
        lambda: Bridge(argparse.Namespace(beipack=False, privileged=False)), sock=sock
    )

    logger.debug("Startup done.  Looping until connection closes.")

    try:
        await bridge.communicate()
    except (BrokenPipeError, ConnectionResetError):
        # not unexpected if the peer doesn't hang up cleanly
        pass


async def run_external_bridge(sock: socket.socket, bridge_cmd: Sequence[str]) -> None:
    logger.debug("handle_session: spawning bridge")
    env = {**os.environ, "PYTHONPATH": ":".join(sys.path)}
    if logger.isEnabledFor(logging.DEBUG):
        env["COCKPIT_DEBUG"] = "all"
    proc = await asyncio.create_subprocess_exec(
        *bridge_cmd,
        stdin=sock.fileno(),
        stdout=sock.fileno(),
        env=env,
    )
    logger.debug("handle_session: bridge spawned, pid=%d, closing socket", proc.pid)
    sock.close()

    try:
        returncode = await proc.wait()
        logger.debug("handle_session: bridge exited, returncode=%d", returncode)
    except asyncio.CancelledError:
        logger.debug("handle_session: cancelled, killing bridge pid=%d", proc.pid)
        proc.kill()
        await proc.wait()
        raise


async def handle_session(
    sock: socket.socket,
    bridge_cmd: list[str],
    auth_func: AuthorizeFunction | None,
) -> None:
    """Handle one session connection."""
    logger.debug("handle_session: new connection, fd=%d", sock.fileno())

    with sock:
        try:
            if auth_func is not None and not await auth_func(sock):
                return
        except EOFError:
            logger.debug("handle_session: got unexpected EOF during auth stage")
            return

        if bridge_cmd:
            await run_external_bridge(sock, bridge_cmd)
        else:
            await run_internal_bridge(sock)


async def run_session_server(
    socket_path: str,
    bridge_cmd: list[str] | None = None,
    auth_func: AuthorizeFunction | None = None,
) -> None:
    """Run the mock session socket server until cancelled."""
    if bridge_cmd is None:
        bridge_cmd = [sys.executable, "-m", "cockpit.bridge"]

    logger.debug("run_session_server: starting on %r", socket_path)
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.setblocking(False)  # needed by .sock_accept()  # noqa: FBT003
    sock.bind(socket_path)
    sock.listen()
    logger.debug("run_session_server: listening")

    try:
        loop = asyncio.get_running_loop()
        async with asyncio.TaskGroup() as tg:
            while True:
                client, _ = await loop.sock_accept(sock)
                tg.create_task(handle_session(client, bridge_cmd, auth_func))
    finally:
        try:
            os.unlink(socket_path)
            logger.debug("run_session_server: cleaned up socket %r", socket_path)
        except OSError as exc:
            logger.warning(
                "run_session_server: failed to clean up socket %r: %s", socket_path, exc
            )


async def main() -> None:
    import argparse
    import signal

    parser = argparse.ArgumentParser(description="Mock session socket server")
    parser.add_argument(
        "--basic",
        metavar="USER:PASS",
        help="Require basic auth credentials",
    )
    parser.add_argument(
        "--2fa",
        dest="twofa",
        metavar="CODE",
        help="Require 2FA code after basic auth",
    )
    parser.add_argument(
        "socket_path",
        help="Path to Unix socket",
    )
    parser.add_argument(
        "command",
        nargs="*",
        help="Bridge command to run (default: internal bridge)",
    )

    args = parser.parse_args()

    logging.basicConfig(level=logging.DEBUG)

    async def auth(sock: socket.socket) -> bool:
        return (not args.basic or await authorize_basic(sock, args.basic)) and (
            not args.twofa or await authorize_2fa(sock, args.twofa)
        )

    # Remove stale socket if it exists
    with contextlib.suppress(FileNotFoundError):
        os.unlink(args.socket_path)
        logger.debug("deleted previously existing socket %r", args.socket_path)

    task = asyncio.create_task(
        run_session_server(
            args.socket_path,
            args.command,
            auth if args.basic or args.twofa else None,
        )
    )

    loop = asyncio.get_running_loop()
    loop.add_signal_handler(signal.SIGTERM, task.cancel)
    loop.add_signal_handler(signal.SIGINT, task.cancel)

    with contextlib.suppress(asyncio.CancelledError):
        await task


if __name__ == "__main__":
    asyncio.run(main())
