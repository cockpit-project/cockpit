#
# Copyright (C) 2022 Red Hat, Inc.
# SPDX-License-Identifier: GPL-3.0-or-later


import asyncio
import logging

logger = logging.getLogger(__name__)

# Manages the session timeout


class SessionController():
    def __init__(self, timeout, on_timeout):
        self.timeout = timeout
        self.on_timeout = on_timeout
        self.channels = set()
        self.task = None
        if timeout > 0:
            self.task = asyncio.create_task(self.sequence())

    def add_channel(self, channel):
        self.channels.add(channel)

    def remove_channel(self, channel):
        self.channels.remove(channel)

    def send_channel_message(self, msg):
        for c in self.channels:
            c.send_bytes(msg)

    async def sequence(self):
        await asyncio.sleep(max(self.timeout - 30, 30))
        for i in range(30, 0, -1):
            self.send_channel_message(f'{{"countdown": {i!s}}}'.encode())
            await asyncio.sleep(1)
        self.send_channel_message(b'{"logout": true}')
        await asyncio.sleep(10)
        self.on_timeout()

    def reset_session_timeout(self):
        if self.task is not None:
            self.task.cancel()
            self.task = asyncio.create_task(self.sequence())
