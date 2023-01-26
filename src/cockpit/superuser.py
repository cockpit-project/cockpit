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

from __future__ import annotations

import asyncio
import logging
import os
import pwd
import subprocess

from systemd_ctypes import bus

from typing import Dict, List, Optional, Sequence, Tuple

from .router import Router, RoutingError, RoutingRule
from .peer import Peer, PeerStateListener

logger = logging.getLogger(__name__)

SUPERUSER_AUTH_COOKIE = 'supermarius'


class SuperuserStartup:
    peer: Peer  # the peer that's being started

    def success(self, rule: SuperuserRoutingRule) -> None:
        raise NotImplementedError

    def failed(self, rule: SuperuserRoutingRule, exc: Exception) -> None:
        raise NotImplementedError

    def auth(self, rule: SuperuserRoutingRule, message: Optional[str], prompt: str, echo: bool) -> None:
        raise NotImplementedError


class ControlMessageStartup(SuperuserStartup):
    def success(self, rule: SuperuserRoutingRule) -> None:
        rule.router.write_control(command='superuser-init-done')

    def failed(self, rule: SuperuserRoutingRule, exc: Exception) -> None:
        rule.router.write_control(command='superuser-init-done')

    def auth(self, rule: SuperuserRoutingRule, message: Optional[str], prompt: str, echo: bool) -> None:
        username = pwd.getpwuid(os.getuid()).pw_name
        hexuser = ''.join(f'{c:02x}' for c in username.encode('ascii'))
        rule.router.write_control(command='authorize', cookie=SUPERUSER_AUTH_COOKIE, challenge=f'plain1:{hexuser}')


class DBusStartup(SuperuserStartup):
    future: asyncio.Future

    def __init__(self):
        self.future = asyncio.get_running_loop().create_future()

    def success(self, rule: SuperuserRoutingRule) -> None:
        self.future.set_result(None)

    def failed(self, rule: SuperuserRoutingRule, exc: Exception) -> None:
        self.future.set_exception(bus.BusError('cockpit.Superuser.Error', str(exc)))

    def auth(self, rule: SuperuserRoutingRule, message: Optional[str], prompt: str, echo: bool) -> None:
        rule.prompt(message or '', prompt, '', echo, '')

    async def wait(self) -> None:
        await self.future


class SuperuserRoutingRule(PeerStateListener, RoutingRule, bus.Object, interface='cockpit.Superuser'):
    startup: Optional[SuperuserStartup]
    peer: Optional[Peer]

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

    # PeerStateListener hooks
    def peer_state_changed(self, peer: Peer, event: str, exc: Optional[Exception] = None) -> None:
        logger.debug('Peer %s state changed -> %s', peer.name, event)
        if event == 'connected':
            self.current = 'init'
            self.peer = peer

        elif event == 'init':
            self.current = peer.name
            if self.startup is not None:
                self.startup.success(self)
                self.startup = None

        elif event == 'closed':
            self.current = 'none'
            self.peer = None

            if self.startup is not None:
                self.startup.failed(self, exc or ConnectionResetError('connection lost'))
                self.startup = None

    def peer_authorization_request(self, peer: Peer, message: Optional[str], prompt: str, echo: bool) -> None:
        if self.startup:
            self.startup.auth(self, message, prompt, echo)

    def __init__(self, router: Router, privileged: bool = False):
        super().__init__(router)

        # name → (label, spawn, env)
        self.superuser_rules: Dict[Optional[str], Tuple[str, Sequence[str], Sequence[str]]] = {}
        self.bridges = []
        self.peer = None
        self.startup = None

        if privileged or os.getuid() == 0:
            self.current = 'root'

    def go(self, startup: SuperuserStartup, name: str) -> None:
        if self.current != 'none':
            raise bus.BusError('cockpit.Superuser.Error', 'Superuser bridge already running')

        assert self.peer is None
        assert self.startup is None

        try:
            _label, args, env = self.superuser_rules[name]
        except KeyError as exc:
            raise bus.BusError('cockpit.Superuser.Error', f'Unknown superuser bridge type "{name}"') from exc

        startup.peer = Peer(self.router, name, self)

        try:
            # We want to capture the error messages to send to the user
            startup.peer.spawn(args, env, stderr=subprocess.PIPE)
        except OSError as exc:
            raise bus.BusError('cockpit.Superuser.Error', f'Failed to start peer bridge: {exc}') from exc

        # We do this step last, only after everything above was successful.  If
        # anything above raises an error, it will all go away neatly, without
        # side-effects.
        self.startup = startup

    def init(self, params: Dict[str, object]) -> None:
        name = params.get('id')
        if not isinstance(name, str) or name == 'any':
            if len(self.bridges) == 0:
                return
            name = self.bridges[0]

        startup = ControlMessageStartup()
        try:
            self.go(startup, name)
        except bus.BusError as exc:
            startup.failed(self, exc)

    def set_configs(self, configs: List[Dict[str, object]]):
        self.superuser_rules = {}
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
                environ = config.get('environ', [])
                assert isinstance(environ, list)
                self.superuser_rules[name] = label, spawn, environ
        self.bridges = list(self.superuser_rules)

        # If the currently-active bridge got removed...
        if self.peer is not None and self.current not in self.superuser_rules:
            self.stop()

    # D-Bus methods
    @bus.Interface.Method(in_types=['s'])
    async def start(self, name: str) -> None:
        startup = DBusStartup()
        self.go(startup, name)
        await startup.wait()

    @bus.Interface.Method()
    def stop(self) -> None:
        if self.peer is not None:
            self.peer.close()

        # close() should have disconnected the peer immediately
        assert self.peer is None

    @bus.Interface.Method(in_types=['s'])
    def answer(self, reply: str) -> None:
        if self.startup is not None:
            self.startup.peer.authorize_response(reply)

    @methods.getter
    def get_methods(self):
        methods = {}
        for name, (label, _, _) in self.superuser_rules.items():
            if label:
                methods[name] = {'t': 'a{sv}', 'v': {'label': {'t': 's', 'v': label}}}
        return methods
