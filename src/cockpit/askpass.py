# This file is part of Cockpit.
#
# Copyright (C) 2023 Red Hat, Inc.
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

import argparse
import asyncio
import getpass
import logging
import os
import socket
import sys
import uuid

from typing import Dict

from .protocol import CockpitProtocol

logger = logging.getLogger(__name__)


class AuthorizeInteraction(CockpitProtocol):
    def __init__(self, prompt: str):
        self.prompt = prompt
        self.cookie = str(uuid.uuid4())

    def do_ready(self) -> None:
        challenge = 'plain1:' + ''.join('%02x' % ord(c) for c in getpass.getuser())
        self.write_control(command='authorize', challenge=challenge, cookie=self.cookie, prompt=self.prompt)

    def transport_control_received(self, command: str, message: Dict[str, object]) -> None:
        if command == 'authorize' and message.get('cookie') == self.cookie:
            print(message.get('response'))
        else:
            logger.error('received invalid control message: %s', message)

        assert self.transport is not None
        self.transport.close()

    async def run(self, connection: socket.socket) -> None:
        loop = asyncio.get_running_loop()
        await loop.create_connection(lambda: self, sock=connection)
        await self.communicate()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('prompt')
    args = parser.parse_args()

    try:
        connection = socket.socket(fileno=os.dup(0))
    except OSError:
        sys.exit('This command must be run with stdin connected to a socket.')

    interaction = AuthorizeInteraction(args.prompt)
    asyncio.run(interaction.run(connection))


if __name__ == '__main__':
    main()
