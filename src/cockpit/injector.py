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

"""
This is the injector component.

It turns a Python interpreter (with nothing else installed) into a Cockpit
bridge.  It does three things in order to accomplish this:

    - at the start of the session the injector sends a small "bootloader" into
      the Python interpreter which is responsible for arranging for the bridge
      code to run.

    - if the remote side doesn't have a copy of the bridge, the injector it
      sends it.

    - the injector contains a copy of the package serving logic, so packages
      are served from local files.  The packages provided from the remote side
      are currently ignored.

For the most part, the injector acts as a wrapper around the remotely-running
bridge, filling in the gaps to turn it into a complete cockpit-bridge, from the
viewpoint of whoever invoked it (ie: cockpit-ws).

At some point, the package serving component can be moved up the stack (ie:
closer to the browser).  The injection of the bootloader and the bridge code
could also theoretically be done from cockpit-ws (or its eventual successor).
"""

import asyncio
import logging
import sys

from typing import Any, Dict
from importlib.resources import files

from .channels import PackagesChannel
from .packages import Packages
from .protocol import CockpitProtocol
from .transports import StdioTransport, SubprocessTransport


logger = logging.getLogger(__name__)


class InjectorFrontend(CockpitProtocol):
    backend: CockpitProtocol
    channels: Dict[str, PackagesChannel]
    packages: Packages

    def __init__(self, backend) -> None:
        self.backend = backend
        backend.frontend = self
        self.channels = {}
        self.packages = Packages()

    def do_transport_control(self, command: str, message: Dict[str, Any]) -> None:
        logger.debug('Transport control')
        self.backend.send_control(**message)

    def do_channel_control(self, channel: str, command: str, message: Dict[str, Any]) -> None:
        logger.debug('Channel control')
        if command == 'open' and \
           message.get('payload') == 'http-stream1' and \
           message.get('internal') == 'packages':
            self.channels[channel] = PackagesChannel(self)

        if channel in self.channels:
            self.channels[channel].do_channel_control(command, message)
        else:
            self.backend.send_control(**message)

        if command == 'close' and channel in self.channels:
            del self.channels[channel]

    def do_channel_data(self, channel: str, data: bytes) -> None:
        logger.debug('Channel data')
        if channel in self.channels:
            self.channels[channel].do_channel_data(channel, data)
        else:
            self.backend.send_data(channel, data)

    def do_ready(self) -> None:
        # The process begins from the backend.
        pass

    def send_init(self, message: Dict[str, Any]) -> None:
        message.update(checksum=self.packages.checksum,
                       packages={p: None for p in self.packages.packages})
        self.send_control(**message)


class InjectorBackend(CockpitProtocol):
    data: bytes
    start_line: bytes
    frontend: InjectorFrontend

    def do_transport_control(self, command: str, message: Dict[str, Any]) -> None:
        assert self.transport is not None

        if command == 'need-script':
            logger.debug('Sending script %s', message)
            resources = files(__package__)
            data = resources.joinpath('data/bundle.pyz').read_bytes()
            self.transport.write(data)
        elif command == 'init':
            self.frontend.send_init(message)
        else:
            self.frontend.send_control(**message)

    def do_channel_control(self, channel: str, command: str, message: Dict[str, Any]) -> None:
        self.frontend.send_control(**message)

    def do_channel_data(self, channel: str, data: bytes) -> None:
        self.frontend.send_data(channel, data)

    def do_ready(self) -> None:
        assert self.transport is not None

        # we start by sending the bootloader
        resources = files(__package__)
        bootloader = resources.joinpath('data/bootloader.py').read_bytes()
        self.transport.write(bootloader)


async def run() -> None:
    loop = asyncio.get_running_loop()

    backend = InjectorBackend()
    frontend = InjectorFrontend(backend)

    # can be used to ssh to another host, for example
    cmd = sys.argv[1:] + ['python3', '-i']

    StdioTransport(loop, frontend)
    SubprocessTransport(loop, backend, cmd, None, None)

    await frontend.communicate()


def main() -> None:
    asyncio.run(run(), debug=True)


if __name__ == '__main__':
    main()
