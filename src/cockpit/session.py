#
# Copyright (C) 2022 Red Hat, Inc.
# SPDX-License-Identifier: GPL-3.0-or-later

import asyncio
import logging
from typing import TYPE_CHECKING, Callable, Union

if TYPE_CHECKING:
    from .channel import Channel

logger = logging.getLogger(__name__)

# Manages the session timeout


class SessionController:
    task: Union[asyncio.Task, None] = None
    channels: 'set[Channel]' = set()
    timeout: int
    on_timeout: Callable[[], None]

    def __init__(self, timeout: int, on_timeout: Callable[[], None]) -> None:
        self.timeout = timeout
        self.on_timeout = on_timeout

    def add_channel(self, channel: 'Channel') -> None:
        self.channels.add(channel)
        if self.task is None:
            self.reset_session_timeout()

    def remove_channel(self, channel: 'Channel') -> None:
        self.channels.remove(channel)

    def send_channel_message(self, msg: bytes) -> None:
        for c in self.channels:
            c.send_bytes(msg)

    async def _sequence(self) -> None:
        await asyncio.sleep(max(self.timeout - 30, 30))
        for i in range(30, 0, -1):
            self.send_channel_message(f'{{"countdown": {i!s}}}'.encode())
            await asyncio.sleep(1)
        self.send_channel_message(b'{"logout": true}')
        await asyncio.sleep(10)
        self.on_timeout()

    def reset_session_timeout(self) -> None:
        if self.task is not None:
            self.task.cancel()
            self.task = None
        if self.timeout > 0:
            self.task = asyncio.create_task(self._sequence())
