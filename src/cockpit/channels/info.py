#
# Copyright (C) 2022 Red Hat, Inc.
# SPDX-License-Identifier: GPL-3.0-or-later


from ..channel import Channel
from ..jsonutil import JsonObject


class InfoChannel(Channel):
    payload = 'info'

    def do_open(self, options: JsonObject) -> None:
        del options

        self.ready()
        self.send_json(self.router.info())
        self.done()
        self.close()
