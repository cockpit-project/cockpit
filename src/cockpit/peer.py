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
from typing import Callable, List, Optional, Sequence

from .jsonutil import JsonDocument, JsonObject
from .packages import BridgeConfig
from .protocol import CockpitProblem, CockpitProtocol, CockpitProtocolError
from .router import Endpoint, Router, RoutingRule
from .transports import SubprocessProtocol, SubprocessTransport

logger = logging.getLogger(__name__)


class PeerError(CockpitProblem):
    pass


class PeerExited(Exception):
    def __init__(self, exit_code: int):
        self.exit_code = exit_code


class Peer(CockpitProtocol, SubprocessProtocol, Endpoint):
    done_callbacks: List[Callable[[], None]]
    init_future: Optional[asyncio.Future]

    def __init__(self, router: Router):
        super().__init__(router)

        # All Peers start out frozen — we only unfreeze after we see the first 'init' message
        self.freeze_endpoint()

        self.init_future = asyncio.get_running_loop().create_future()
        self.done_callbacks = []

    # Initialization
    async def do_connect_transport(self) -> None:
        raise NotImplementedError

    async def spawn(self, argv: Sequence[str], env: Sequence[str], **kwargs) -> asyncio.Transport:
        # Not actually async...
        loop = asyncio.get_running_loop()
        user_env = dict(e.split('=', 1) for e in env)
        return SubprocessTransport(loop, self, argv, env=dict(os.environ, **user_env), **kwargs)

    async def start(self, init_host: Optional[str] = None, **kwargs: JsonDocument) -> JsonObject:
        """Request that the Peer is started and connected to the router.

        Creates the transport, connects it to the protocol, and participates in
        exchanging of init messages.  If anything goes wrong, the connection
        will be closed and an exception will be raised.

        The Peer starts out in a frozen state (ie: attempts to send messages to
        it will initially be queued). If init_host is not None then an init
        message is sent with the given 'host' field, plus any extra kwargs, and
        the queue is thawed. Otherwise, the caller is responsible for sending
        the init message and thawing the peer.

        In any case, the return value is the init message from the peer.
        """
        assert self.init_future is not None

        def _connect_task_done(task: asyncio.Task) -> None:
            assert task is connect_task
            try:
                task.result()
            except asyncio.CancelledError:  # we did that (below)
                pass                        # we want to ignore it
            except Exception as exc:
                self.close(exc)

        connect_task = asyncio.create_task(self.do_connect_transport())
        connect_task.add_done_callback(_connect_task_done)

        try:
            # Wait for something to happen:
            #   - exception from our connection function
            #   - receiving "init" from the other side
            #   - receiving EOF from the other side
            #   - .close() was called
            #   - other transport exception
            init_message = await self.init_future

        except PeerExited:
            # This is a fairly generic error.  If the connection process is
            # still running, perhaps we'd get a better error message from it.
            await connect_task
            # Otherwise, re-raise
            raise

        finally:
            self.init_future = None

            # In any case (failure or success) make sure this is done.
            if not connect_task.done():
                connect_task.cancel()

        if init_host is not None:
            logger.debug('  sending init message back, host %s', init_host)
            # Send "init" back
            self.write_control(command='init', version=1, host=init_host, **kwargs)

            # Thaw the queued messages
            self.thaw_endpoint()

        return init_message

    # Background initialization
    def start_in_background(self, init_host: Optional[str] = None, **kwargs: JsonDocument) -> None:
        def _start_task_done(task: asyncio.Task) -> None:
            assert task is start_task

            try:
                task.result()
            except (OSError, PeerExited, CockpitProblem, asyncio.CancelledError):
                pass  # Those are expected.  Others will throw.

        start_task = asyncio.create_task(self.start(init_host, **kwargs))
        start_task.add_done_callback(_start_task_done)

    # Shutdown
    def add_done_callback(self, callback: Callable[[], None]) -> None:
        self.done_callbacks.append(callback)

    # Handling of interesting events
    def do_superuser_init_done(self) -> None:
        pass

    def do_authorize(self, message: JsonObject) -> None:
        pass

    def transport_control_received(self, command: str, message: JsonObject) -> None:
        if command == 'init' and self.init_future is not None:
            logger.debug('Got init message with active init_future.  Setting result.')
            self.init_future.set_result(message)
        elif command == 'authorize':
            self.do_authorize(message)
        elif command == 'superuser-init-done':
            self.do_superuser_init_done()
        else:
            raise CockpitProtocolError(f'Received unexpected control message {command}')

    def eof_received(self) -> bool:
        # We always expect to be the ones to close the connection, so if we get
        # an EOF, then we consider it to be an error.  This allows us to
        # distinguish close caused by unexpected EOF (but no errno from a
        # syscall failure) vs. close caused by calling .close() on our side.
        # The process is still running at this point, so keep it and handle
        # the error in process_exited().
        logger.debug('Peer %s received unexpected EOF', self.__class__.__name__)
        return True

    def do_closed(self, exc: Optional[Exception]) -> None:
        logger.debug('Peer %s connection lost %s %s', self.__class__.__name__, type(exc), exc)

        if exc is None:
            self.shutdown_endpoint(problem='terminated')
        elif isinstance(exc, PeerExited):
            # a common case is that the called peer does not exist
            if exc.exit_code == 127:
                self.shutdown_endpoint(problem='no-cockpit')
            else:
                self.shutdown_endpoint(problem='terminated', message=f'Peer exited with status {exc.exit_code}')
        elif isinstance(exc, CockpitProblem):
            self.shutdown_endpoint(problem=exc.problem, **exc.kwargs)
        else:
            self.shutdown_endpoint(problem='internal-error',
                                   message=f"[{exc.__class__.__name__}] {exc!s}")

        # If .start() is running, we need to make sure it stops running,
        # raising the correct exception.
        if self.init_future is not None and not self.init_future.done():
            if exc is not None:
                self.init_future.set_exception(exc)
            else:
                self.init_future.cancel()

        for callback in self.done_callbacks:
            callback()

    def process_exited(self) -> None:
        assert isinstance(self.transport, SubprocessTransport)
        logger.debug('Peer %s exited, status %d', self.__class__.__name__, self.transport.get_returncode())
        returncode = self.transport.get_returncode()
        assert isinstance(returncode, int)
        self.close(PeerExited(returncode))

    # Forwarding data: from the peer to the router
    def channel_control_received(self, channel: str, command: str, message: JsonObject) -> None:
        if self.init_future is not None:
            raise CockpitProtocolError('Received unexpected channel control message before init')
        self.send_channel_control(**message)

    def channel_data_received(self, channel: str, data: bytes) -> None:
        if self.init_future is not None:
            raise CockpitProtocolError('Received unexpected channel data before init')
        self.send_channel_data(channel, data)

    # Forwarding data: from the router to the peer
    def do_channel_control(self, channel: str, command: str, message: JsonObject) -> None:
        assert self.init_future is None
        self.write_control(**message)

    def do_channel_data(self, channel: str, data: bytes) -> None:
        assert self.init_future is None
        self.write_channel_data(channel, data)

    def do_kill(self, host: Optional[str], group: Optional[str]) -> None:
        assert self.init_future is None
        self.write_control(command='kill', host=host, group=group)


class ConfiguredPeer(Peer):
    config: BridgeConfig
    args: Sequence[str]
    env: Sequence[str]

    def __init__(self, router: Router, config: BridgeConfig):
        self.config = config
        self.args = config.spawn
        self.env = config.environ
        super().__init__(router)

    async def do_connect_transport(self) -> None:
        await self.spawn(self.args, self.env)


class PeerRoutingRule(RoutingRule):
    config: BridgeConfig
    match: JsonObject
    peer: Optional[Peer]

    def __init__(self, router: Router, config: BridgeConfig):
        super().__init__(router)
        self.config = config
        self.match = config.match
        self.peer = None

    def apply_rule(self, options: JsonObject) -> Optional[Peer]:
        # Check that we match

        for key, value in self.match.items():
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
            assert self.router.init_host
            self.peer.start_in_background(init_host=self.router.init_host)

        return self.peer

    def peer_closed(self):
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
