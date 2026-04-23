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
        if self.router.session_controller is not None:
            self.router.session_controller.add_channel(self.channel)
            self.ready(timeout=self.router.session_controller.timeout)
        else:
            self.ready(timeout=0)

    def do_control(self, command: str, message: JsonObject) -> None:
        super().do_control(command, message)
        if command == 'active' and self.router.session_controller is not None:
            self.router.session_controller.reset_session_timeout()

    def do_close(self) -> None:
        if self.router.session_controller is not None:
            self.router.session_controller.remove_channel(self.channel)
        self.close()
