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
import logging
import os
import traceback
from typing import List, Optional, Sequence

from cockpit._vendor import ferny

from .beipack import BridgeBeibootHelper
from .jsonutil import JsonObject, JsonValue, get_str
from .packages import BridgeConfig
from .protocol import CockpitProblem, CockpitProtocol, CockpitProtocolError
from .router import Endpoint, Router, RoutingRule

logger = logging.getLogger(__name__)


class Peer(CockpitProtocol, Endpoint):
    saw_init: bool = False

    def __init__(self, rule: RoutingRule) -> None:
        super().__init__(rule)
        self.freeze_endpoint()

    def do_init_args(self, message: JsonObject) -> JsonObject:
        return {}

    # Handling of interesting events
    def do_init(self, message: JsonObject) -> None:
        logger.debug('do_init(%r, %r)', self, message)
        if self.saw_init:
            logger.warning('received duplicate "init" control message on %r', self)
            return

        self.saw_init = True

        problem = get_str(message, 'problem', None)
        if problem is not None:
            raise CockpitProblem(problem, message)

        assert self.router.init_host is not None
        assert self.transport is not None
        args: dict[str, JsonValue] = {
            'command': 'init',
            'host': self.router.init_host,
            'version': 1
        }
        args.update(self.do_init_args(message))
        self.write_control(args)
        self.thaw_endpoint()

    def transport_control_received(self, command: str, message: JsonObject) -> None:
        if command == 'init':
            self.do_init(message)
        else:
            raise CockpitProtocolError(f'Received unexpected control message {command}')

    def eof_received(self) -> bool:
        logger.debug('eof_received(%r)', self)
        return True  # wait for more information (exit status, stderr, etc.)

    def do_exception(self, exc: Exception) -> None:
        if isinstance(exc, ferny.SubprocessError):
            # a common case is that the called peer does not exist
            # 127 is the return code from `sh -c` for ENOENT
            if exc.returncode == 127:
                raise CockpitProblem('no-cockpit')
            else:
                raise CockpitProblem('terminated', message=exc.stderr or f'Peer exited with status {exc.returncode}')

    def connection_lost(self, exc: 'Exception | None' = None) -> None:
        super().connection_lost(exc)

        logger.debug('Peer %s connection lost %s %s', self.__class__.__name__, type(exc), exc)
        self.rule.endpoint_closed(self)

        if exc is None:
            # No exception — just return 'terminated'
            self.shutdown_endpoint(problem='terminated')
        elif isinstance(exc, CockpitProblem):
            # If this is already a CockpitProblem, report it
            self.shutdown_endpoint(exc.attrs)
        else:
            # Otherwise, see if do_exception() waits to raise it as a CockpitProblem
            try:
                self.do_exception(exc)
            except CockpitProblem as problem:
                self.shutdown_endpoint(problem.attrs)
            else:
                self.shutdown_endpoint(problem='internal-error',
                                       cause=traceback.format_exception(exc.__class__, exc, exc.__traceback__))

                # OSErrors are kinda expected in many circumstances and we're
                # not interested in treating those as programming errors
                if not isinstance(exc, OSError):
                    raise exc

    # Forwarding data: from the peer to the router
    def channel_control_received(self, channel: str, command: str, message: JsonObject) -> None:
        if not self.saw_init:
            raise CockpitProtocolError('Received unexpected channel control message before init')
        self.send_channel_control(channel, command, message)

    def channel_data_received(self, channel: str, data: bytes) -> None:
        if not self.saw_init:
            raise CockpitProtocolError('Received unexpected channel data before init')
        self.send_channel_data(channel, data)

    # Forwarding data: from the router to the peer
    def do_channel_control(self, channel: str, command: str, message: JsonObject) -> None:
        assert self.saw_init
        self.write_control(message)

    def do_channel_data(self, channel: str, data: bytes) -> None:
        assert self.saw_init
        self.write_channel_data(channel, data)

    def do_kill(self, host: 'str | None', group: 'str | None', message: JsonObject) -> None:
        self.write_control(message)

    def do_close(self) -> None:
        self.close()


class ConfiguredPeer(Peer):
    helper: 'BridgeBeibootHelper | None' = None
    config: BridgeConfig

    def connection_made(self, transport: asyncio.BaseTransport) -> None:
        super().connection_made(transport)
        assert self.transport is not None

        if self.helper is not None:
            logger.debug('  sending payload for %r %r', self, self.config.name)
            self.transport.write(self.helper.get_stage1().encode())
        else:
            logger.debug('  no payload to send for %r %r', self, self.config.name)

    def __init__(
        self, rule: RoutingRule, config: BridgeConfig, interaction_handlers: Sequence[ferny.InteractionHandler] = ()
    ):
        self.config = config
        super().__init__(rule)

        if '# cockpit-bridge' in config.spawn:
            self.helper = BridgeBeibootHelper(self)
            interaction_handlers = (*interaction_handlers, self.helper)

        env_overrides = dict(e.split('=', 1) for e in config.environ)
        self.transport, myself = ferny.FernyTransport.spawn(
            lambda: self, config.spawn, env=dict(os.environ, **env_overrides),
            interaction_handlers=interaction_handlers
        )
        assert myself is self


class PeerRoutingRule(RoutingRule):
    config: BridgeConfig
    peer: Optional[Peer]

    def __init__(self, router: Router, config: BridgeConfig):
        super().__init__(router)
        self.config = config
        self.peer = None

    def apply_rule(self, options: JsonObject) -> Optional[Peer]:
        # Check that we match

        for key, value in self.config.match.items():
            if key not in options:
                logger.debug('        rejecting because key %s is missing', key)
                return None
            if value is not None and options[key] != value:
                logger.debug('        rejecting because key %s has wrong value %s (vs %s)', key, options[key], value)
                return None

        # Start the peer if it's not running already
        if self.peer is None:
            self.peer = ConfiguredPeer(self, self.config)

        return self.peer

    def endpoint_closed(self, endpoint: Endpoint) -> None:
        assert self.peer is endpoint or self.peer is None
        self.peer = None

    def shutdown(self):
        if self.peer is not None:
            self.peer.close()


class PeersRoutingRule(RoutingRule):
    rules: List[PeerRoutingRule] = []

    def apply_rule(self, options: JsonObject) -> Optional[Endpoint]:
        logger.debug('    considering %d rules', len(self.rules))
        for rule in self.rules:
            logger.debug('      considering %s', rule.config.name)
            endpoint = rule.apply_rule(options)
            if endpoint is not None:
                logger.debug('        selected')
                return endpoint
        logger.debug('      no peer rules matched')
        return None

    def set_configs(self, bridge_configs: Sequence[BridgeConfig]) -> None:
        old_rules = self.rules
        self.rules = []

        for config in bridge_configs:
            # Those are handled elsewhere...
            if config.privileged or 'host' in config.match:
                continue

            # Try to reuse an existing rule, if one exists...
            for rule in list(old_rules):
                if rule.config == config:
                    old_rules.remove(rule)
                    break
            else:
                # ... otherwise, create a new one.
                rule = PeerRoutingRule(self.router, config)

            self.rules.append(rule)

        # close down the old rules that didn't get reclaimed
        for rule in old_rules:
            rule.shutdown()

    def shutdown(self):
        for rule in self.rules:
            rule.shutdown()
