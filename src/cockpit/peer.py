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

from typing import Dict, List, Optional, Sequence, Set

from .router import Endpoint, Router, RoutingError, RoutingRule
from .protocol import CockpitProtocolClient
from .transports import SubprocessTransport, SubprocessProtocol

logger = logging.getLogger(__name__)


class PeerStateListener:
    def peer_state_changed(self, peer: 'Peer', event: str, exc: Optional[Exception] = None) -> None:
        """Signal a state change in the Peer.

        This is called on:
            - connection made (event='connect')
            - init message received (event='init')
            - connection lost (event='closed', exc possibly set)
        """

    def peer_authorization_request(self, peer: 'Peer', message: Optional[str], prompt: str, echo: bool) -> None:
        """Request authentication for connecting to the peer.

        The state listener should respond by calling .authorize_response() on the Peer.
        """


class Peer(CockpitProtocolClient, SubprocessProtocol, Endpoint):
    name: str
    init_host: str
    state_listener: Optional[PeerStateListener]

    channels: Set[str]

    authorize_pending: Optional[str] = None  # the cookie of the pending request

    def __init__(self,
                 router: Router,
                 name: str,
                 state_listener: Optional[PeerStateListener] = None,
                 init_host: Optional[str] = None):
        super().__init__(router)

        # All Peers start out frozen — we only unfreeze after we see the first 'init' message
        self.freeze_endpoint()

        self.name = name
        self.state_listener = state_listener

        assert router.init_host is not None
        self.init_host = init_host or router.init_host

        self.channels = set()
        self.authorize_pending = None

    def spawn(self, argv: Sequence[str], env: Sequence[str], **kwargs) -> asyncio.Transport:
        loop = asyncio.get_running_loop()
        user_env = dict(e.split('=', 1) for e in env)
        return SubprocessTransport(loop, self, argv, env=dict(os.environ, **user_env), **kwargs)

    # Handling of interesting events
    def do_ready(self) -> None:
        logger.debug('Peer %s connection established', self.name)
        if self.state_listener is not None:
            self.state_listener.peer_state_changed(self, 'connected')

    def do_send_stderr(self, transport: asyncio.Transport) -> None:
        if isinstance(transport, SubprocessTransport):
            transport.send_stderr_fd()

    def do_init(self, message: Dict[str, object]) -> None:
        if self.endpoint_is_frozen():
            logger.debug('Peer %s connection got init message', self.name)
            if self.state_listener is not None:
                self.state_listener.peer_state_changed(self, 'init')
            self.write_control(command='init', version=1, host=self.init_host)
            self.thaw_endpoint()
        else:
            logger.warning('Peer %s connection got duplicate init message', self.name)

    def do_closed(self, transport_was: asyncio.Transport, exc: Optional[Exception]) -> None:
        logger.debug('Peer %s connection lost %s', self.name, exc)

        # We need to synthesize close messages for all open channels
        while self.channels:
            self.send_channel_control(self.channels.pop(), 'close', problem='disconnected')

        if self.state_listener is not None:
            # If we don't otherwise has an exception set, but we have stderr output, we can use it.
            if isinstance(transport_was, SubprocessTransport):
                # BrokenPipeError just means that we tried to write after the process was gone
                if exc is None or isinstance(exc, BrokenPipeError):
                    stderr = transport_was.get_stderr()
                    if stderr:
                        exc = RuntimeError(stderr)

            self.state_listener.peer_state_changed(self, 'closed', exc)

    def do_authorize(self, message: Dict[str, object]) -> None:
        cookie = message.get('cookie')
        prompt = message.get('prompt')

        # If we have stderr output, send it along as the message part of the prompt
        # This allows forwarding messages like "the usual lecture" from sudo, etc.
        if isinstance(self.transport, SubprocessTransport):
            msg = self.transport.get_stderr(reset=True)
        else:
            msg = None

        logger.debug('Peer %s request, cookie=%s, prompt=%s', self.name, cookie, prompt)
        if self.state_listener is not None and isinstance(cookie, str) and isinstance(prompt, str):
            self.authorize_pending = cookie
            self.state_listener.peer_authorization_request(self, msg, prompt, False)

    def authorize_response(self, response: str) -> None:
        logger.debug('Peer %s response, cookie=%s, response=%s', self.name, self.authorize_pending, response)
        cookie = self.authorize_pending
        if cookie is not None:
            self.authorize_pending = None
            self.write_control(command='authorize', cookie=cookie, response=response)

    def process_exited(self) -> None:
        assert isinstance(self.transport, SubprocessTransport)
        logger.debug('Peer %s exited, status %d', self.name, self.transport.get_returncode())

    def close(self) -> None:
        if self.transport is not None:
            self.transport.close()

    # Forwarding data: from the peer to the router
    def channel_control_received(self, channel: str, command: str, message: Dict[str, object]) -> None:
        if command == 'close':
            self.channels.discard(channel)

        self.send_channel_control(**message)

    def channel_data_received(self, channel: str, data: bytes) -> None:
        self.send_channel_data(channel, data)

    # Forwarding data: from the router to the peer
    def do_channel_control(self, channel: str, command: str, message: Dict[str, object]) -> None:
        if command == 'open':
            self.channels.add(channel)
        elif command == 'close':
            self.channels.discard(channel)

        self.write_control(**message)

    def do_channel_data(self, channel: str, data: bytes) -> None:
        self.write_channel_data(channel, data)


class PeerRoutingRule(RoutingRule, PeerStateListener):
    config: Dict[str, object]
    peer: Optional[Peer]

    def __init__(self, router: Router, config: Dict[str, object]):
        super().__init__(router)
        self.config = config
        self.peer = None

    def apply_rule(self, options: Dict[str, object]) -> Optional[Peer]:
        # Check that we match
        for key, value in self.config['match'].items():  # type: ignore
            if key not in options:
                logger.debug('        rejecting because key %s is missing', key)
                return None
            if value is not None and options[key] != value:
                logger.debug('        rejecting because key %s has wrong value %s (vs %s)', key, options[key], value)
                return None

        # Start the peer if it's not running already
        if self.peer is None:
            try:
                args = self.config['spawn']
                env = self.config.get('environ', [])
                name = self.config.get('label', args[0])  # type: ignore

                peer = Peer(self.router, name, self)  # type: ignore
                peer.spawn(args, env)  # type: ignore
                self.peer = peer
            except OSError as error:
                raise RoutingError('spawn-error', message=str(error))

        return self.peer

    def peer_state_changed(self, peer: 'Peer', event: str, exc: Optional[Exception] = None):
        logger.debug('%s got peer state event %s %s %s', self, peer, event, exc)
        if event == 'init':
            pass
        elif event == 'closed':
            self.peer = None

    def rule_removed(self):
        if self.peer is not None:
            self.peer.close()


class PeersRoutingRule(RoutingRule):
    rules: List[PeerRoutingRule] = []

    def apply_rule(self, options: Dict[str, object]) -> Optional[Endpoint]:
        logger.debug('    considering %d rules', len(self.rules))
        for rule in self.rules:
            logger.debug('      considering %s', rule.config.get('spawn'))
            endpoint = rule.apply_rule(options)
            if endpoint is not None:
                logger.debug('        selected')
                return endpoint
        logger.debug('      no peer rules matched')
        return None

    def set_configs(self, bridge_configs: List[Dict[str, object]]) -> None:
        old_rules = self.rules
        self.rules = []

        for config in bridge_configs:
            # Those are handled elsewhere...
            if config.get('privileged') or 'host' in config['match']:  # type: ignore
                continue

            # Try to reuse an existing rule, if one exists...
            for rule in old_rules:
                if rule.config == config:
                    old_rules.remove(rule)
                    break
            else:
                # ... otherwise, create a new one.
                rule = PeerRoutingRule(self.router, config)

            self.rules.append(rule)

        # close down the old rules that didn't get reclaimed
        for rule in old_rules:
            rule.rule_removed()
