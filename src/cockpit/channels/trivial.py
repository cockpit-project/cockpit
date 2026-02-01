#
# Copyright (C) 2022 Red Hat, Inc.
# SPDX-License-Identifier: GPL-3.0-or-later


import logging

from cockpit.jsonutil import JsonObject

from ..channel import Channel

logger = logging.getLogger(__name__)


class EchoChannel(Channel):
    payload = 'echo'

    def do_open(self, options: JsonObject) -> None:
        self.ready()

    def do_data(self, data: bytes) -> None:
        self.send_bytes(data)

    def do_done(self) -> None:
        self.done()
        self.close()


class NullChannel(Channel):
    payload = 'null'

    def do_open(self, options: JsonObject) -> None:
        self.ready()

    def do_close(self) -> None:
        self.close()
