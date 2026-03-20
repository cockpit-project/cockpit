#
# Copyright (C) 2022 Red Hat, Inc.
# SPDX-License-Identifier: GPL-3.0-or-later


import logging

from cockpit.jsonutil import JsonObject

from ..channel import Channel

logger = logging.getLogger(__name__)


class SessionControlChannel(Channel):
    payload = 'session-control'

    def do_open(self, options: JsonObject) -> None:
        self.router.session_controller.add_channel(self)
        self.ready(timeout=self.router.session_controller.timeout)

    def do_data(self, data: bytes) -> None:
        if data == b'active':
            self.router.session_controller.reset_session_timeout()

    def do_done(self) -> None:
        self.router.session_controller.remove_channel(self)
        self.done()
        self.close()
