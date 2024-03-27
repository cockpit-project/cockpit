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

import array
import asyncio
import getpass
import logging
import os
import socket
from typing import Any, Sequence

from cockpit._vendor import ferny
from cockpit._vendor.systemd_ctypes import Variant, bus

from .jsonutil import JsonObject, get_str
from .packages import BridgeConfig
from .peer import ConfiguredPeer
from .protocol import CockpitProblem
from .router import Router, RoutingError, RoutingRule

logger = logging.getLogger(__name__)


class AuthorizeResponder(ferny.AskpassHandler):
    def __init__(self, router: Router):
        self.router = router

    async def do_askpass(self, messages: str, prompt: str, hint: str) -> str:
        hexuser = ''.join(f'{c:02x}' for c in getpass.getuser().encode('ascii'))
        return await self.router.request_authorization(f'plain1:{hexuser}')


class StderrInteractionHandler(ferny.InteractionHandler):
    commands = ('cockpit.send-stderr',)

    async def run_command(self, command: str, args: 'tuple[Any, ...]', fds: 'list[int]', stderr: str) -> None:
        assert command == 'cockpit.send-stderr'
        with socket.socket(fileno=fds[0]) as sock:
            fds.pop(0)
            # socket.send_fds(sock, [b'\0'], [2])  # New in Python 3.9
            sock.sendmsg([b'\0'], [(socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array("i", [2]))])


class SuperuserPeer(ConfiguredPeer):
    askpass_handler: 'ferny.AskpassHandler'
    startup: 'asyncio.Future[None]'

    def post_result(self, exc: 'Exception | None') -> None:
        logger.debug('post_result(%r, %r)', self, exc)

        if self.startup.done():
            logger.debug('  but result already posted')
            return

        if exc is not None:
            logger.debug('  setting exception')
            self.startup.set_exception(exc)
        else:
            logger.debug('  signalling success')
            self.startup.set_result(None)  # success (ie: not an exception)

    def do_init(self, message: JsonObject) -> None:
        assert isinstance(self.rule, SuperuserRoutingRule)
        super().do_init(message)
        self.post_result(None)
        self.rule.update()  # transition from 'init' → 'sudo'

    def connection_lost(self, exc: 'Exception | None' = None) -> None:
        assert isinstance(self.rule, SuperuserRoutingRule)
        super().connection_lost(exc)
        self.rule.set_peer(None)  # transition from 'sudo' or 'init' → 'none'
        self.post_result(exc or EOFError())

    def __init__(self, rule: 'SuperuserRoutingRule', config: BridgeConfig, askpass: ferny.AskpassHandler) -> None:
        self.startup = asyncio.get_running_loop().create_future()
        self.askpass_handler = askpass
        super().__init__(rule, config, interaction_handlers=[askpass, StderrInteractionHandler()])


class SuperuserRoutingRule(RoutingRule, ferny.AskpassHandler, bus.Object, interface='cockpit.Superuser'):
    privileged: bool  # am I root?

    # Configuration state
    superuser_configs: Sequence[BridgeConfig] = ()
    bridges = bus.Interface.Property('as', value=[])
    methods = bus.Interface.Property('a{sv}', value={})

    # D-Bus signals
    prompt = bus.Interface.Signal('s', 's', 's', 'b', 's')  # message, prompt, default, echo, error

    # Current bridge state.  'current' is derived state, mostly from 'peer'
    peer: 'SuperuserPeer | None' = None
    current = bus.Interface.Property('s')

    @current.getter
    def get_current(self) -> str:
        if self.privileged:
            return 'root'
        elif self.peer is None:
            return 'none'
        elif not self.peer.startup.done():
            return 'init'
        else:
            return self.peer.config.name

    def update(self):
        self.properties_changed('cockpit.Superuser', {'Current': Variant(self.current)}, [])

    # This is the only function which is permitted to modify 'peer'
    def set_peer(self, peer: 'SuperuserPeer | None') -> None:
        # We never hot-swap peers and we never do anything if we're already root
        assert self.peer is None or peer is None or self.peer is peer
        assert not self.privileged
        self.peer = peer
        self.update()

    # RoutingRule
    def apply_rule(self, options: JsonObject) -> 'SuperuserPeer | None':
        superuser = options.get('superuser')

        if self.privileged or not superuser:
            # superuser not requested, or already superuser?  Next rule.
            return None
        elif self.peer is not None or superuser == 'try':
            # superuser requested and active?  Return it.
            # 'try' requested?  Either return the peer, or None.
            return self.peer
        else:
            # superuser requested, but not active?  That's an error.
            raise RoutingError('access-denied')

    def __init__(self, router: Router, *, privileged: bool = False):
        self.privileged = privileged or os.getuid() == 0
        super().__init__(router)

    def start_peer(self, name: str, responder: ferny.AskpassHandler) -> SuperuserPeer:
        assert self.peer is None

        for config in self.superuser_configs:
            if name in (config.name, 'any'):
                break
        else:
            raise bus.BusError('cockpit.Superuser.Error', f'Unknown superuser bridge type "{name}"')

        peer = SuperuserPeer(self, config, responder)
        self.set_peer(peer)

        return peer

    def shutdown(self, exc: 'Exception | None' = None) -> None:
        if self.peer is not None:
            self.peer.close(exc)

        # Peer might take a while to come down, so clear this immediately
        self.set_peer(None)

    def set_configs(self, configs: Sequence[BridgeConfig]):
        logger.debug("set_configs() with %d items", len(configs))
        configs = [config for config in configs if config.privileged]
        self.superuser_configs = tuple(configs)
        self.bridges = [config.name for config in self.superuser_configs]
        self.methods = {c.label: Variant({'label': Variant(c.label)}, 'a{sv}') for c in configs if c.label}

        logger.debug("  bridges are now %s", self.bridges)

        # If the currently active bridge config is not in the new set of configs, stop it
        if self.peer is not None:
            if self.peer.config not in self.superuser_configs:
                logger.debug("  stopping superuser bridge '%s': it disappeared from configs", self.peer.config.name)
                self.stop()

    # Connect-on-startup functionality
    def init(self, params: JsonObject) -> None:
        if self.privileged:
            # ignore that if we're already root
            return

        name = get_str(params, 'id', 'any')
        peer = self.start_peer(name, AuthorizeResponder(self.router))
        peer.startup.add_done_callback(self._init_done)

    def _init_done(self, future: 'asyncio.Future[None]') -> None:
        logger.debug('superuser init done! %s', future.exception())
        self.router.write_control(command='superuser-init-done')

    # D-Bus methods
    @bus.Interface.Method(in_types=['s'])
    async def start(self, name: str) -> None:
        if self.peer is not None or self.privileged:
            raise bus.BusError('cockpit.Superuser.Error', 'Superuser bridge already running')

        try:
            await self.start_peer(name, self).startup
        except asyncio.CancelledError:
            raise bus.BusError('cockpit.Superuser.Error.Cancelled', 'Operation aborted') from None
        except EOFError:
            raise bus.BusError('cockpit.Superuser.Error', 'Unexpected EOF from peer') from None
        except OSError as exc:
            raise bus.BusError('cockpit.Superuser.Error', str(exc)) from exc
        except ferny.SubprocessError as exc:
            raise bus.BusError('cockpit.Superuser.Error', exc.stderr) from exc
        except CockpitProblem as exc:
            raise bus.BusError('cockpit.Superuser.Error', str(exc)) from exc

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

    # ferny.AskpassHandler
    pending_prompt: 'asyncio.Future[str] | None' = None

    async def do_askpass(self, messages: str, prompt: str, hint: str) -> 'str | None':
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
