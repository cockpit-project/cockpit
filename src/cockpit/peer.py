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

from typing import Callable, Dict, List, Optional, Sequence

from .router import Endpoint, Router, RoutingRule
from .protocol import CockpitProtocol, CockpitProblem, CockpitProtocolError
from .transports import SubprocessTransport, SubprocessProtocol

logger = logging.getLogger(__name__)


class PeerError(CockpitProblem):
    pass


class Peer(CockpitProtocol, SubprocessProtocol, Endpoint):
    done_callbacks: List[Callable[[], None]]
    init_future: Optional[asyncio.Future]
    start_task: Optional[asyncio.Task]

    def __init__(self, router: Router):
        super().__init__(router)

        # All Peers start out frozen — we only unfreeze after we see the first 'init' message
        self.freeze_endpoint()

        self.done_callbacks = []
        self.init_future = None
        self.start_task = None

    # Initialization
    async def do_connect_transport(self) -> asyncio.Transport:
        raise NotImplementedError

    async def spawn(self, argv: Sequence[str], env: Sequence[str], **kwargs) -> asyncio.Transport:
        # Not actually async...
        loop = asyncio.get_running_loop()
        user_env = dict(e.split('=', 1) for e in env)
        return SubprocessTransport(loop, self, argv, env=dict(os.environ, **user_env), **kwargs)

    async def start(self, init_host: Optional[str] = None) -> None:
        """Request that the Peer is started and connected to the router.

        Creates the transport, connects it to the protocol, and participates in
        exchanging of init messages.  If anything goes wrong, an exception will
        be thrown and you must call .close() to make sure the connection is
        properly shut down.
        """
        try:
            assert self.init_future is None

            # Connect the transport
            transport = await self.do_connect_transport()
            assert transport is not None
            assert self._closed or self.transport is transport

            # Wait for the other side to send "init"
            self.init_future = asyncio.get_running_loop().create_future()
            try:
                await self.init_future
            finally:
                self.init_future = None

            # Send "init" back
            self.write_control(command='init', version=1, host=init_host or self.router.init_host)

            # Thaw the queued messages
            self.thaw_endpoint()

        except Exception as exc:
            self.close(exc)
            raise

    # Background initialization
    def _start_task_done(self, task: asyncio.Task) -> None:
        assert task is self.start_task
        self.start_task = None

        try:
            task.result()
        except (OSError, CockpitProblem, asyncio.CancelledError):
            pass  # Those are expected.  Others will throw.

    def start_in_background(self, init_host: Optional[str] = None) -> None:
        self.start_task = asyncio.create_task(self.start(init_host))
        self.start_task.add_done_callback(self._start_task_done)

    # Shutdown
    def add_done_callback(self, callback: Callable[[], None]) -> None:
        self.done_callbacks.append(callback)

    # Handling of interesting events
    def transport_control_received(self, command: str, message: Dict[str, object]) -> None:
        if command == 'init' and self.init_future is not None:
            self.init_future.set_result(True)
        else:
            raise CockpitProtocolError(f'Received unexpected control message {command}')

    def do_closed(self, exc: Optional[Exception]) -> None:
        logger.debug('Peer %s connection lost %s', self.__class__.__name__, exc)

        if exc is None:
            self.shutdown_endpoint(problem='peer-disconnected')
        elif isinstance(exc, CockpitProblem):
            self.shutdown_endpoint(problem=exc.problem, message=exc.message, **exc.kwargs)
        else:
            self.shutdown_endpoint(problem='internal-error',
                                   message=f"[{exc.__class__.__name__}] {str(exc)}")

        if self.init_future is not None and exc is not None:
            self.init_future.set_exception(exc)
        elif self.start_task is not None:
            self.start_task.cancel()

        for callback in self.done_callbacks:
            callback()

    def process_exited(self) -> None:
        assert isinstance(self.transport, SubprocessTransport)
        logger.debug('Peer %s exited, status %d', self.__class__.__name__, self.transport.get_returncode())

    # Forwarding data: from the peer to the router
    def channel_control_received(self, channel: str, command: str, message: Dict[str, object]) -> None:
        if self.init_future is not None:
            raise CockpitProtocolError('Received unexpected channel control message before init')
        self.send_channel_control(**message)

    def channel_data_received(self, channel: str, data: bytes) -> None:
        if self.init_future is not None:
            raise CockpitProtocolError('Received unexpected channel data before init')
        self.send_channel_data(channel, data)

    # Forwarding data: from the router to the peer
    def do_channel_control(self, channel: str, command: str, message: Dict[str, object]) -> None:
        assert self.init_future is None
        self.write_control(**message)

    def do_channel_data(self, channel: str, data: bytes) -> None:
        assert self.init_future is None
        self.write_channel_data(channel, data)

    def do_kill(self, host: Optional[str], group: Optional[str]) -> None:
        assert self.init_future is None
        self.write_control(command='kill', host=host, group=group)


class ConfiguredPeer(Peer):
    args: Sequence[str]
    env: Sequence[str]

    def __init__(self, router: Router, config: Dict[str, object]):
        self.args = config['spawn']  # type: ignore
        self.env = config.get('environ', [])  # type: ignore
        super().__init__(router)

    async def do_connect_transport(self):
        return await self.spawn(self.args, self.env)


class PeerRoutingRule(RoutingRule):
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
            self.peer = ConfiguredPeer(self.router, self.config)
            self.peer.add_done_callback(self.peer_closed)
            self.peer.start_in_background()

        return self.peer

    def peer_closed(self):
        self.peer = None

    def shutdown(self):
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
            rule.shutdown()

    def shutdown(self):
        for rule in self.rules:
            rule.shutdown()
