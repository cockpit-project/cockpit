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
import contextlib
import getpass
import logging
import os
import socket
from tempfile import TemporaryDirectory
from typing import Dict, List, Optional, Sequence, Tuple, Union

from cockpit._vendor import ferny
from cockpit._vendor.bei.bootloader import make_bootloader
from cockpit._vendor.systemd_ctypes import bus

from .beipack import BridgeBeibootHelper
from .peer import ConfiguredPeer, Peer, PeerError
from .polkit import PolkitAgent
from .router import Router, RoutingError, RoutingRule

logger = logging.getLogger(__name__)


class SuperuserPeer(ConfiguredPeer):
    name: str
    responder: ferny.InteractionResponder

    def __init__(self, router: Router, name: str, config: Dict[str, object], responder: ferny.InteractionResponder):
        super().__init__(router, config)
        self.name = name
        self.responder = responder

    async def do_connect_transport(self) -> asyncio.Transport:
        async with contextlib.AsyncExitStack() as context:
            if 'pkexec' in self.args:
                logger.debug('connecting polkit superuser peer transport %r', self.args)
                await context.enter_async_context(PolkitAgent(self.responder))
            else:
                logger.debug('connecting non-polkit superuser peer transport %r', self.args)

            agent = ferny.InteractionAgent(self.responder)

            if 'SUDO_ASKPASS=ferny-askpass' in self.env:
                tmpdir = context.enter_context(TemporaryDirectory())
                ferny_askpass = ferny.write_askpass_to_tmpdir(tmpdir)
                env: Sequence[str] = [f'SUDO_ASKPASS={ferny_askpass}']
            else:
                env = self.env

            transport = await self.spawn(self.args, env, stderr=agent, start_new_session=True)

            if '# cockpit-bridge' in self.args:
                logger.debug('going to beiboot superuser bridge %r', self.args)
                helper = BridgeBeibootHelper(self, ['--privileged'])
                agent.add_handler(helper)
                transport.write(make_bootloader(helper.steps, gadgets=ferny.BEIBOOT_GADGETS).encode())

            try:
                await agent.communicate()
            except ferny.InteractionError as exc:
                raise PeerError('authentication-failed', message=str(exc)) from exc

        return transport


class CockpitResponder(ferny.InteractionResponder):
    commands = ('ferny.askpass', 'cockpit.send-stderr')

    async def do_custom_command(self, command: str, args: Tuple, fds: List[int], stderr: str) -> None:
        if command == 'cockpit.send-stderr':
            with socket.socket(fileno=fds[0]) as sock:
                fds.pop(0)
                socket.send_fds(sock, [b'\0'], [2])


class AuthorizeResponder(CockpitResponder):
    def __init__(self, router: Router):
        self.router = router

    async def do_askpass(self, messages: str, prompt: str, hint: str) -> str:
        hexuser = ''.join(f'{c:02x}' for c in getpass.getuser().encode('ascii'))
        return await self.router.request_authorization(f'plain1:{hexuser}')


class SuperuserRoutingRule(RoutingRule, CockpitResponder, bus.Object, interface='cockpit.Superuser'):
    superuser_configs: Dict[str, Dict[str, object]]
    pending_prompt: Optional[asyncio.Future]
    peer: Optional[SuperuserPeer]

    # D-Bus signals
    prompt = bus.Interface.Signal('s', 's', 's', 'b', 's')  # message, prompt, default, echo, error

    # D-Bus properties
    bridges = bus.Interface.Property('as', value=[])
    current = bus.Interface.Property('s', value='none')
    methods = bus.Interface.Property('a{sv}')

    # RoutingRule
    def apply_rule(self, options: Dict[str, object]) -> Optional[Peer]:
        superuser = options.get('superuser')

        if not superuser or self.current == 'root':
            # superuser not requested, or already superuser?  Next rule.
            return None
        elif self.peer or superuser == 'try':
            # superuser requested and active?  Return it.
            # 'try' requested?  Either return the peer, or None.
            return self.peer
        else:
            # superuser requested, but not active?  That's an error.
            raise RoutingError('access-denied')

    # ferny.InteractionResponder
    async def do_askpass(self, messages: str, prompt: str, hint: str) -> Optional[str]:
        assert self.pending_prompt is None
        echo = hint == "confirm"
        self.pending_prompt = asyncio.get_running_loop().create_future()
        try:
            logger.debug('prompting for %s', prompt)
            # with sudo, all stderr messages are treated as warning/errors by the UI
            # (such as the lecture or "wrong password"), so pass them in the "error" field
            self.prompt('', prompt, '', echo, messages)
            return await self.pending_prompt
        finally:
            self.pending_prompt = None

    def __init__(self, router: Router, *, privileged: bool = False):
        super().__init__(router)

        self.superuser_configs = {}
        self.pending_prompt = None
        self.bridges = []
        self.peer = None
        self.startup = None

        if privileged or os.getuid() == 0:
            self.current = 'root'

    def peer_done(self):
        self.current = 'none'
        self.peer = None

    async def go(self, name: str, responder: ferny.InteractionResponder) -> None:
        if self.current != 'none':
            raise bus.BusError('cockpit.Superuser.Error', 'Superuser bridge already running')

        if name == 'any' and self.bridges:
            name = self.bridges[0]

        assert self.peer is None
        assert self.startup is None

        try:
            config = self.superuser_configs[name]
        except KeyError as exc:
            raise bus.BusError('cockpit.Superuser.Error', f'Unknown superuser bridge type "{name}"') from exc

        self.current = 'init'
        self.peer = SuperuserPeer(self.router, name, config, responder)
        self.peer.add_done_callback(self.peer_done)

        try:
            await self.peer.start(init_host=self.router.init_host)
        except asyncio.CancelledError:
            raise bus.BusError('cockpit.Superuser.Error.Cancelled', 'Operation aborted') from None
        except (OSError, PeerError) as exc:
            raise bus.BusError('cockpit.Superuser.Error', str(exc)) from exc

        self.current = name

    def set_configs(self, configs: List[Dict[str, object]]):
        logger.debug("set_configs() with %d items", len(configs))
        self.superuser_configs = {}
        for config in configs:
            if config.get('privileged', False):
                spawn = config['spawn']
                assert isinstance(spawn, list)
                assert isinstance(spawn[0], str)
                label = config.get('label')
                if label is not None:
                    assert isinstance(label, str)
                    name = label
                else:
                    name = os.path.basename(spawn[0])
                self.superuser_configs[name] = config
        self.bridges = list(self.superuser_configs)

        logger.debug("  bridges are now %s", self.bridges)

        # If the currently-active bridge got removed, stop it
        if self.peer is not None and self.peer.name not in self.superuser_configs:
            logger.debug("  stopping current superuser bridge '%s' (peer name %s), as it disappeared from configs",
                         self.current, self.peer.name)

            self.stop()

    def cancel_prompt(self):
        if self.pending_prompt is not None:
            self.pending_prompt.cancel()
            self.pending_prompt = None

    def shutdown(self):
        self.cancel_prompt()

        if self.peer is not None:
            self.peer.close()

        # close() should have disconnected the peer immediately
        assert self.peer is None

    # Connect-on-startup functionality
    def init(self, params: Dict[str, Union[bool, str, Sequence[str]]]) -> None:
        name = params.get('id', 'any')
        assert isinstance(name, str)
        responder = AuthorizeResponder(self.router)
        self._init_task = asyncio.create_task(self.go(name, responder))
        self._init_task.add_done_callback(self._init_done)

    def _init_done(self, task):
        logger.debug('superuser init done! %s', task.exception())
        self.router.write_control(command='superuser-init-done')
        del self._init_task

    # D-Bus methods
    @bus.Interface.Method(in_types=['s'])
    async def start(self, name: str) -> None:
        await self.go(name, self)

    @bus.Interface.Method()
    def stop(self) -> None:
        self.shutdown()

    @bus.Interface.Method(in_types=['s'])
    def answer(self, reply: str) -> None:
        if self.pending_prompt is not None:
            logger.debug('responding to pending prompt')
            self.pending_prompt.set_result(reply)
        else:
            logger.debug('got Answer, but no prompt pending')

    @methods.getter
    def get_methods(self):
        methods = {}
        for name, config in self.superuser_configs.items():
            label = config.get('label')
            if label:
                methods[name] = {'t': 'a{sv}', 'v': {'label': {'t': 's', 'v': label}}}
        return methods
