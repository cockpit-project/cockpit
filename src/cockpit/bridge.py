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
import ctypes
import json
import logging
import pwd
import os
import shlex
import signal
import socket
import subprocess

from typing import Dict, Iterable, List, Tuple, Type

from cockpit._vendor.systemd_ctypes import bus, run_async

from . import polyfills

from .channel import ChannelRoutingRule
from .channels import CHANNEL_TYPES
from .config import Config, Environment
from .internal_endpoints import EXPORTS
from .packages import Packages, PackagesListener
from .peer import PeersRoutingRule
from .remote import HostRoutingRule
from .router import Router
from .superuser import SuperuserRoutingRule
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

    def eof_received(self) -> bool:
        # HACK: Make sure there's no outstanding sudo prompts blocking our shutdown
        self.superuser_rule.cancel_prompt()
        return super().eof_received()


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
    fds = []
    try:
        stderr_socket = socket.fromfd(2, socket.AF_UNIX, socket.SOCK_STREAM)
        ours, theirs = socket.socketpair()
        socket.send_fds(stderr_socket, [b'\0ferny\0(["send-stderr"], {})'], [theirs.fileno(), 1])
        theirs.close()
        _msg, fds, _flags, _addr = socket.recv_fds(ours, 1, 1)
    except OSError:
        return

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


def start_ssh_agent() -> None:
    prctl = ctypes.CDLL(None).prctl
    PR_SET_PDEATHSIG = 1

    # NB: We prefer SIGTERM to SIGKILL here since the agent needs to have a
    # chance to clean up its listener socket.
    try:
        proc = subprocess.Popen(['ssh-agent',
                                 '-D',  # no-daemon
                                 '-s',  # shell-style output
                                 ], stdout=subprocess.PIPE, universal_newlines=True,
                                preexec_fn=lambda: prctl(PR_SET_PDEATHSIG, signal.SIGTERM))
        assert proc.stdout is not None

        # Wait for the agent to write at least one line and look for the
        # listener socket.  If we fail to find it, kill the agent — something
        # went wrong.
        for token in shlex.shlex(proc.stdout.readline(), punctuation_chars=True):
            if token.startswith('SSH_AUTH_SOCK='):
                os.environ['SSH_AUTH_SOCK'] = token.replace('SSH_AUTH_SOCK=', '', 1)
                break
        else:
            proc.terminate()

    except OSError as exc:
        logger.warning("Could not start ssh-agent: %s", exc)


def main() -> None:
    polyfills.install()

    parser = argparse.ArgumentParser(description='cockpit-bridge is run automatically inside of a Cockpit session.')
    parser.add_argument('--privileged', action='store_true', help='Privileged copy of the bridge')
    parser.add_argument('--packages', action='store_true', help='Show Cockpit package information')
    parser.add_argument('--bridges', action='store_true', help='Show Cockpit bridges information')
    parser.add_argument('--rules', action='store_true', help='Show Cockpit bridge rules')
    parser.add_argument('--debug', action='store_true', help='Enable debug output (very verbose)')
    parser.add_argument('--version', action='store_true', help='Show Cockpit version information')
    args = parser.parse_args()

    # If we were run with --privileged then our stderr is currently being
    # consumed by the main bridge looking for startup-related error messages.
    # Let's switch back to the original stderr stream, which has a side-effect
    # of indicating that our startup is more or less complete.  Any errors
    # after this point will land in the journal.
    if args.privileged:
        try_to_receive_stderr()

    setup_logging(args.debug)

    # Special modes
    if args.packages:
        Packages().show()
        return
    elif args.bridges:
        print(json.dumps(Packages().get_bridge_configs(), indent=2))
        return

    # The privileged bridge doesn't need ssh-agent, but the main one does
    if 'SSH_AUTH_SOCK' not in os.environ and not args.privileged:
        start_ssh_agent()

    # asyncio.run() shim for Python 3.6 support
    run_async(run(args), debug=args.debug)


if __name__ == '__main__':
    main()
