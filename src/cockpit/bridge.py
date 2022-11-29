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

from systemd_ctypes import EventLoopPolicy

from .channel import ChannelRoutingRule
from .channels import CHANNEL_TYPES
from .packages import Packages
from .remote import HostRoutingRule
from .router import Router
from .transports import StdioTransport

logger = logging.getLogger(__name__)


class Bridge(Router):
    def __init__(self, args: argparse.Namespace):
        self.packages = Packages()
        self.args = args

        super().__init__([
            HostRoutingRule(self),
            ChannelRoutingRule(self, CHANNEL_TYPES),
        ])

    @staticmethod
    def get_os_release():
        try:
            file = open('/etc/os-release', encoding='utf-8')
        except FileNotFoundError:
            file = open('/usr/lib/os-release', encoding='utf-8')

        with file:
            lexer = shlex.shlex(file, posix=True, punctuation_chars=True)
            return dict(token.split('=', 1) for token in lexer)

    def do_send_init(self) -> None:
        self.write_control(command='init', version=1,
                           checksum=self.packages.checksum,
                           packages={p: None for p in self.packages.packages},
                           os_release=self.get_os_release())


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
        asyncio.run(run(args), debug=True)


if __name__ == '__main__':
    main()
