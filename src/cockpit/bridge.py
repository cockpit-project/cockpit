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
import os
import pwd
import shlex
import socket
import subprocess
from typing import Dict, Iterable, List, Optional, Tuple, Type

from cockpit._vendor.ferny import interaction_client
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
    packages: Optional[Packages]
    bridge_rules: List[Dict[str, object]]
    args: argparse.Namespace

    def __init__(self, args: argparse.Namespace):
        self.internal_bus = InternalBus(EXPORTS)
        self.bridge_rules = []
        self.args = args

        self.superuser_rule = SuperuserRoutingRule(self, privileged=args.privileged)
        self.internal_bus.export('/superuser', self.superuser_rule)

        self.internal_bus.export('/config', Config())
        self.internal_bus.export('/environment', Environment())

        self.peers_rule = PeersRoutingRule(self)

        if args.beipack:
            # Some special stuff for beipack
            self.superuser_rule.set_configs([
                {
                    "privileged": True,
                    "spawn": ["sudo", "-k", "-A", "python3", "-ic", "# cockpit-bridge", "--privileged"],
                    "environ": ["SUDO_ASKPASS=ferny-askpass"],
                }
            ])
            self.packages = None
        elif args.privileged:
            self.packages = None
        else:
            self.packages = Packages(self)
            self.internal_bus.export('/packages', self.packages)
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
                logger.warning("Neither /etc/os-release nor /usr/lib/os-release exists")
                return {}

        with file:
            lexer = shlex.shlex(file, posix=True, punctuation_chars=True)
            return dict(token.split('=', 1) for token in lexer)

    def do_init(self, message: Dict[str, object]) -> None:
        superuser = message.get('superuser')
        if isinstance(superuser, dict):
            self.superuser_rule.init(superuser)

    def do_send_init(self) -> None:
        init_args = {
            'capabilities': {'explicit-superuser': True},
            'os-release': self.get_os_release(),
        }

        if self.packages is not None:
            init_args['packages'] = {p: None for p in self.packages.packages}

        self.write_control(command='init', version=1, **init_args)

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
    try:
        ours, theirs = socket.socketpair()
        with ours:
            with theirs:
                interaction_client.command(2, 'cockpit.send-stderr', fds=[theirs.fileno()])
            _msg, fds, _flags, _addr = socket.recv_fds(ours, 1, 1)
    except OSError:
        return

    try:
        stderr_fd, = fds
        # We're about to abruptly drop our end of the stderr socketpair that we
        # share with the ferny agent.  ferny would normally treat that as an
        # unexpected error. Instruct it to do a clean exit, instead.
        interaction_client.command(2, 'ferny.end')
        os.dup2(stderr_fd, 2)
    finally:
        for fd in fds:
            os.close(fd)


def setup_logging(*, debug: bool):
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
    # Launch the agent so that it goes down with us on EOF; PDEATHSIG would be more robust,
    # but it gets cleared on setgid ssh-agent, which some distros still do
    try:
        proc = subprocess.Popen(['ssh-agent', 'sh', '-ec', 'echo SSH_AUTH_SOCK=$SSH_AUTH_SOCK; read a'],
                                stdin=subprocess.PIPE, stdout=subprocess.PIPE, universal_newlines=True)
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
            proc.wait()

    except FileNotFoundError:
        logger.debug("Couldn't start ssh-agent (FileNotFoundError)")

    except OSError as exc:
        logger.warning("Could not start ssh-agent: %s", exc)


def main(*, beipack: bool = False) -> None:
    polyfills.install()

    parser = argparse.ArgumentParser(description='cockpit-bridge is run automatically inside of a Cockpit session.')
    parser.add_argument('--privileged', action='store_true', help='Privileged copy of the bridge')
    parser.add_argument('--packages', action='store_true', help='Show Cockpit package information')
    parser.add_argument('--bridges', action='store_true', help='Show Cockpit bridges information')
    parser.add_argument('--rules', action='store_true', help='Show Cockpit bridge rules')
    parser.add_argument('--debug', action='store_true', help='Enable debug output (very verbose)')
    parser.add_argument('--version', action='store_true', help='Show Cockpit version information')
    args = parser.parse_args()

    # This is determined by who calls us
    args.beipack = beipack

    # If we were run with --privileged then our stderr is currently being
    # consumed by the main bridge looking for startup-related error messages.
    # Let's switch back to the original stderr stream, which has a side-effect
    # of indicating that our startup is more or less complete.  Any errors
    # after this point will land in the journal.
    if args.privileged:
        try_to_receive_stderr()

    setup_logging(debug=args.debug)

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
