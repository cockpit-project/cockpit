# This file is part of Cockpit.
#
# Copyright (C) 2022 Red Hat, Inc.
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.

import asyncio
import socket
import subprocess

from channel import Endpoint
from protocol import CockpitProtocolClient


class PeerProtocol(CockpitProtocolClient):
    def __init__(self, upstream):
        self.upstream = upstream

    def do_ready(self):
        pass

    def do_init(self, message):
        # TODO: send init
        pass

    def do_frame(self, frame):
        self.upstream.send_frame(frame)


class Peer(Endpoint):
    subprocess = None
    protocol = None

    async def start(self, args):
        protocol_sock, subprocess_sock = socket.socketpair()
        self.subprocess = subprocess.Popen(args, stdin=subprocess_sock, stdout=subprocess_sock)
        loop = asyncio.get_event_loop()
        await loop.connect_accepted_socket(PeerProtocol, protocol_sock)

    def do_channel_control(self, command, message):
        raise NotImplementedError

    def do_channel_data(self, channel, data):
        raise NotImplementedError
