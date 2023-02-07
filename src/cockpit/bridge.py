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
import sys

from typing import Dict, Iterable, List, Tuple, Type

from systemd_ctypes import EventLoopPolicy, bus

from .channel import ChannelRoutingRule
from .channels import CHANNEL_TYPES
from .config import Config, Environment
from .internal_endpoints import EXPORTS
from .packages import Packages, PackagesListener
from .peer import PeersRoutingRule
from .remote import HostRoutingRule
from .router import Router
from .superuser import SUPERUSER_AUTH_COOKIE, SuperuserRoutingRule
from .transports import StdioTransport

logger = logging.getLogger(__name__)


class InternalBus:
    exportees: List[bus.Slot]

    def __init__(self, exports: Iterable[Tuple[str, Type[bus.BaseObject]]]):
        client_socket, server_socket = socket.socketpair()
        self.client = bus.Bus.new(fd=client_socket.detach())
        self.server = bus.Bus.new(fd=server_socket.detach(), server=True)
        self.exportees = [self.server.add_object(path, cls()) for path, cls in exports]

    def export(self, path: str, obj: bus.BaseObject) -> None:
        self.exportees.append(self.server.add_object(path, obj))


class Bridge(Router, PackagesListener):
    internal_bus: InternalBus
    packages: Packages
    bridge_rules: List[Dict[str, object]]
    args: argparse.Namespace

    def __init__(self, args: argparse.Namespace):
        self.internal_bus = InternalBus(EXPORTS)
        self.packages = Packages(self)
        self.bridge_rules = []
        self.args = args

        self.superuser_rule = SuperuserRoutingRule(self, args.privileged)
        self.internal_bus.export('/superuser', self.superuser_rule)
        self.internal_bus.export('/packages', self.packages)
        self.internal_bus.export('/config', Config())
        self.internal_bus.export('/environment', Environment())

        self.peers_rule = PeersRoutingRule(self)

        self.packages_loaded()

        super().__init__([
            HostRoutingRule(self),
            self.superuser_rule,
            ChannelRoutingRule(self, CHANNEL_TYPES),
            self.peers_rule,
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

    # PackagesListener interface
    def packages_loaded(self):
        bridge_configs = self.packages.get_bridge_configs()
        if self.bridge_rules != bridge_configs:
            self.superuser_rule.set_configs(bridge_configs)
            self.peers_rule.set_configs(bridge_configs)
            self.bridge_configs = bridge_configs


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
    except (BrokenPipeError, ConnectionResetError):
        # not unexpected if the peer doesn't hang up cleanly
        pass


def try_to_receive_stderr():
    # We need to take great care to ensure that `stdin_socket` doesn't fall out
    # of scope before we call .detach() on it — that would close the stdin fd.
    stdin_socket = None
    try:
        stdin_socket = socket.socket(fileno=0)
        request = '\n{"command": "send-stderr"}\n'
        stdin_socket.send(f'{len(request)}\n{request}'.encode('ascii'))
        _msg, fds, _flags, _addr = socket.recv_fds(stdin_socket, 0, 1)
    except OSError:
        return
    finally:
        if stdin_socket is not None:
            stdin_socket.detach()
        del stdin_socket

    if fds:
        # This is our new stderr.  We have to be careful not to leak it.
        stderr_fd, = fds

        try:
            os.dup2(stderr_fd, 2)
        finally:
            os.close(stderr_fd)


def setup_logging(debug: bool):
    """Setup our logger with optional filtering of modules if COCKPIT_DEBUG env is set"""

    modules = os.getenv('COCKPIT_DEBUG', '')
    logging.basicConfig(format='%(name)s-%(levelname)s: %(message)s')

    if debug or modules == 'all':
        logging.getLogger().setLevel(level=logging.DEBUG)
    elif modules:
        for module in modules.split(','):
            module = module.strip()
            if not module:
                continue

            logging.getLogger(module).setLevel(logging.DEBUG)


def main() -> None:
    # The --privileged bridge gets spawned with its stderr being consumed by a
    # pipe used for reading authentication-related message from sudo.  The
    # absolute first thing we want to do is to recover the original stderr that
    # we had.
    if '--privileged' in sys.argv:
        try_to_receive_stderr()

    parser = argparse.ArgumentParser(description='cockpit-bridge is run automatically inside of a Cockpit session.')
    parser.add_argument('--privileged', action='store_true', help='Privileged copy of the bridge')
    parser.add_argument('--packages', action='store_true', help='Show Cockpit package information')
    parser.add_argument('--bridges', action='store_true', help='Show Cockpit bridges information')
    parser.add_argument('--rules', action='store_true', help='Show Cockpit bridge rules')
    parser.add_argument('--debug', action='store_true', help='Enable debug output (very verbose)')
    parser.add_argument('--version', action='store_true', help='Show Cockpit version information')
    args = parser.parse_args()

    setup_logging(args.debug)

    if args.packages:
        Packages().show()
    elif args.bridges:
        print(json.dumps(Packages().get_bridge_configs(), indent=2))
    else:
        asyncio.set_event_loop_policy(EventLoopPolicy())
        asyncio.run(run(args), debug=args.debug)


if __name__ == '__main__':
    main()
