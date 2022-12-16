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

import argparse
import asyncio
import json
import logging
import pwd
import os
import shlex
import socket

from typing import Dict, Iterable, Tuple, Type

from systemd_ctypes import EventLoopPolicy, bus

from .channel import ChannelRoutingRule
from .channels import CHANNEL_TYPES
from .internal_endpoints import EXPORTS
from .packages import Packages
from .remote import HostRoutingRule
from .router import Router
from .superuser import SUPERUSER_AUTH_COOKIE, SuperuserRoutingRule
from .transports import StdioTransport

logger = logging.getLogger(__name__)


class InternalBus:
    exportees: list[bus.Slot]

    def __init__(self, exports: Iterable[Tuple[str, Type[bus.BaseObject]]]):
        client_socket, server_socket = socket.socketpair()
        self.client = bus.Bus.new(fd=client_socket.detach())
        self.server = bus.Bus.new(fd=server_socket.detach(), server=True)
        self.exportees = [self.server.add_object(path, cls()) for path, cls in exports]

    def export(self, path: str, obj: bus.BaseObject) -> None:
        self.exportees.append(self.server.add_object(path, obj))


class Bridge(Router):
    def __init__(self, args: argparse.Namespace):
        self.internal_bus = InternalBus(EXPORTS)
        self.packages = Packages()
        self.args = args

        self.superuser_rule = SuperuserRoutingRule(self, args.privileged)
        self.internal_bus.export('/superuser', self.superuser_rule)

        super().__init__([
            HostRoutingRule(self),
            self.superuser_rule,
            ChannelRoutingRule(self, CHANNEL_TYPES),
        ])

    @staticmethod
    def get_os_release():
        try:
            file = open('/etc/os-release', encoding='utf-8')
        except FileNotFoundError:
            try:
                file = open('/usr/lib/os-release', encoding='utf-8')
            except FileNotFoundError:
                logger.warn("Neither /etc/os-release nor /usr/lib/os-release exists")
                return {}

        with file:
            lexer = shlex.shlex(file, posix=True, punctuation_chars=True)
            return dict(token.split('=', 1) for token in lexer)

    def do_init(self, message: Dict[str, object]) -> None:
        superuser = message.get('superuser')
        if isinstance(superuser, dict):
            self.superuser_rule.init(superuser)

    def do_authorize(self, message: Dict[str, object]) -> None:
        if message.get('cookie') == SUPERUSER_AUTH_COOKIE:
            response = message.get('response')
            if isinstance(response, str):
                self.superuser_rule.answer(response)

    def do_send_init(self) -> None:
        self.write_control(command='init', version=1,
                           checksum=self.packages.checksum,
                           packages={p: None for p in self.packages.packages},
                           os_release=self.get_os_release(), capabilities={'explicit-superuser': True})


async def run(args) -> None:
    logger.debug("Hi. How are you today?")

    # Unit tests require this
    me = pwd.getpwuid(os.getuid())
    os.environ['HOME'] = me.pw_dir
    os.environ['SHELL'] = me.pw_shell
    os.environ['USER'] = me.pw_name

    logger.debug('Starting the router.')
    router = Bridge(args)
    StdioTransport(asyncio.get_running_loop(), router)

    logger.debug('Startup done.  Looping until connection closes.')

    try:
        await router.communicate()
    except BrokenPipeError:
        # not unexpected if the peer doesn't hang up cleanly
        pass


def main() -> None:
    parser = argparse.ArgumentParser(description='cockpit-bridge is run automatically inside of a Cockpit session.')
    parser.add_argument('--privileged', action='store_true', help='Privileged copy of the bridge')
    parser.add_argument('--packages', action='store_true', help='Show Cockpit package information')
    parser.add_argument('--bridges', action='store_true', help='Show Cockpit bridges information')
    parser.add_argument('--rules', action='store_true', help='Show Cockpit bridge rules')
    parser.add_argument('--debug', action='store_true', help='Enable debug output (very verbose)')
    parser.add_argument('--version', action='store_true', help='Show Cockpit version information')
    args = parser.parse_args()

    if args.debug:
        logging.basicConfig(level=logging.DEBUG)

    if args.packages:
        Packages().show()
    elif args.bridges:
        print(json.dumps(Packages().get_bridges(), indent=2))
    else:
        asyncio.set_event_loop_policy(EventLoopPolicy())
        asyncio.run(run(args), debug=args.debug)


if __name__ == '__main__':
    main()
