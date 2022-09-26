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
import sys

from systemd_ctypes import EventLoopPolicy

from .transports import StdioTransport
from .packages import Packages
from .router import Router

logger = logging.getLogger('cockpit.bridge')


async def run():
    logger.debug("Hi. How are you today?")

    # Unit tests require this
    me = pwd.getpwuid(os.getuid())
    os.environ['HOME'] = me.pw_dir
    os.environ['SHELL'] = me.pw_shell
    os.environ['USER'] = me.pw_name

    logger.debug('Starting the router.')
    router = Router()
    StdioTransport(asyncio.get_running_loop(), router)

    logger.debug('Startup done.  Looping until connection closes.')
    await router.communicate()


def main():
    parser = argparse.ArgumentParser(description='cockpit-bridge is run automatically inside of a Cockpit session.')
    parser.add_argument('--privileged', action='store_true', help='Privileged copy of the bridge')
    parser.add_argument('--packages', action='store_true', help='Show Cockpit package information')
    parser.add_argument('--bridges', action='store_true', help='Show Cockpit bridges information')
    parser.add_argument('--rules', action='store_true', help='Show Cockpit bridge rules')
    parser.add_argument('--version', action='store_true', help='Show Cockpit version information')
    args = parser.parse_args()

    output = os.environ.get('COCKPIT_BRIDGE_LOG') if not sys.stdout.isatty() else None
    logging.basicConfig(filename=output, level=logging.DEBUG)

    if args.packages:
        Packages().show()
    elif args.bridges:
        print(json.dumps(Packages().get_bridges(), indent=2))
    else:
        asyncio.set_event_loop_policy(EventLoopPolicy())
        asyncio.run(run(), debug=True)


if __name__ == '__main__':
    main()
