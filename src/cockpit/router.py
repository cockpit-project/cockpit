#
# Copyright (C) 2022 Red Hat, Inc.
# SPDX-License-Identifier: GPL-3.0-or-later


import asyncio
import collections
import logging
from typing import Dict, List, Optional

from .jsonutil import JsonObject, JsonValue
from .protocol import CockpitProblem, CockpitProtocolError, CockpitProtocolServer

logger = logging.getLogger(__name__)


class ExecutionQueue:
    """Temporarily delay calls to a given set of class methods.

    Functions by replacing the named function at the instance __dict__
    level, effectively providing an override for exactly one instance
    of `method`'s object.
    Queues the invocations.  Run them later with .run(), which also reverses
    the redirection by deleting the named methods from the instance.
    """
    def __init__(self, methods):
        self.queue = collections.deque()
        self.methods = methods

        for method in self.methods:
            self._wrap(method)

    def _wrap(self, method):
        # NB: this function is stored in the instance dict and therefore
        # doesn't function as a descriptor, isn't a method, doesn't get bound,
        # and therefore doesn't receive a self parameter
        setattr(method.__self__, method.__func__.__name__, lambda *args: self.queue.append((method, args)))

    def run(self) -> None:
        logger.debug('ExecutionQueue: Running %d queued method calls', len(self.queue))
        for method, args in self.queue:
            method(*args)

        for method in self.methods:
            delattr(method.__self__, method.__func__.__name__)


class Endpoint:
    router: 'Router'
    __endpoint_frozen_queue: Optional[ExecutionQueue] = None

    def __init__(self, router: 'Router'):
        router.add_endpoint(self)
        self.router = router

    def freeze_endpoint(self) -> None:
        assert self.__endpoint_frozen_queue is None
        logger.debug('Freezing endpoint %s', self)
        self.__endpoint_frozen_queue = ExecutionQueue({self.do_channel_control, self.do_channel_data, self.do_kill})

    def thaw_endpoint(self) -> None:
        assert self.__endpoint_frozen_queue is not None
        logger.debug('Thawing endpoint %s', self)
        self.__endpoint_frozen_queue.run()
        self.__endpoint_frozen_queue = None

    # interface for receiving messages
    def do_close(self) -> None:
        raise NotImplementedError

    def do_channel_control(self, channel: str, command: str, message: JsonObject) -> None:
        raise NotImplementedError

    def do_channel_data(self, channel: str, data: bytes) -> None:
        raise NotImplementedError

    def do_kill(self, host: 'str | None', group: 'str | None', message: JsonObject) -> None:
        raise NotImplementedError

    # interface for sending messages
    def send_channel_data(self, channel: str, data: bytes) -> None:
        self.router.write_channel_data(channel, data)

    def send_channel_control(
        self, channel: str, command: str, msg: 'JsonObject | None', **kwargs: JsonValue
    ) -> None:
        self.router.write_control(msg, channel=channel, command=command, **kwargs)
        if command == 'close':
            self.router.endpoints[self].remove(channel)
            self.router.drop_channel(channel)

    def shutdown_endpoint(self, msg: 'JsonObject | None' = None, **kwargs: JsonValue) -> None:
        self.router.shutdown_endpoint(self, msg, **kwargs)


class RoutingError(CockpitProblem):
    pass


class RoutingRule:
    router: 'Router'

    def __init__(self, router: 'Router'):
        self.router = router

    def apply_rule(self, options: JsonObject) -> Optional[Endpoint]:
        """Check if a routing rule applies to a given 'open' message.

        This should inspect the options dictionary and do one of the following three things:

            - return an Endpoint to handle this channel
            - raise a RoutingError to indicate that the open should be rejected
            - return None to let the next rule run
        """
        raise NotImplementedError

    def shutdown(self) -> None:
        raise NotImplementedError


class SessionController:
    router: 'Router'
    channels: 'set[str]'
    timeout: int
    timer: 'asyncio.TimerHandle | None'
    task: 'asyncio.Task | None'

    def __init__(self, timeout: int, router) -> None:
        self.channels = set()
        self.timeout = timeout
        self.timer = None
        self.task = None
        self.router = router

    def add_channel(self, channel: str) -> None:
        self.channels.add(channel)
        if self.timer is None and self.task is None:
            self.reset_session_timeout()

    def remove_channel(self, channel: str) -> None:
        self.channels.remove(channel)
        if len(self.channels) == 0:
            self.reset_session_timeout()

    def send_message(self, command: str, **kwargs) -> None:
        for c in self.channels:
            self.router.write_control(channel=c, command=command, **kwargs)

    async def _logout_sequence(self) -> None:
        for i in range(30, 0, -1):
            self.send_message("countdown", counter=i)
            await asyncio.sleep(1)
        self.send_message("logout")
        await asyncio.sleep(10)
        self.router.close()

    def _start_logout_sequence(self) -> None:
        self.task = asyncio.create_task(self._logout_sequence())

    def reset_session_timeout(self) -> None:
        if self.timer is not None:
            self.timer.cancel()
            self.timer = None
        if self.task is not None:
            self.task.cancel()
            self.task = None
        if self.timeout > 0 and len(self.channels) > 0:
            self.timer = asyncio.get_event_loop().call_later(max(self.timeout - 30, 30), self._start_logout_sequence)


class Router(CockpitProtocolServer):
    routing_rules: List[RoutingRule]
    open_channels: Dict[str, Endpoint]
    endpoints: 'dict[Endpoint, set[str]]'
    no_endpoints: asyncio.Event  # set if endpoints dict is empty
    session_controller: 'SessionController | None'

    _eof: bool = False

    def __init__(self, routing_rules: List[RoutingRule], *, session_timeout: 'int | None' = None):
        for rule in routing_rules:
            rule.router = self
        self.routing_rules = routing_rules
        self.open_channels = {}
        self.endpoints = {}
        self.no_endpoints = asyncio.Event()
        self.no_endpoints.set()  # at first there are no endpoints
        self.session_controller = None
        if session_timeout is not None:
            self.session_controller = SessionController(session_timeout, self)

    def info(self) -> JsonObject:
        """Used by the 'info' channel.  Gets overridden in Bridge."""
        return {}

    def check_rules(self, options: JsonObject) -> Endpoint:
        for rule in self.routing_rules:
            logger.debug('  applying rule %s', rule)
            endpoint = rule.apply_rule(options)
            if endpoint is not None:
                logger.debug('    resulting endpoint is %s', endpoint)
                return endpoint
        else:
            logger.debug('  No rules matched')
            raise RoutingError('not-supported')

    def drop_channel(self, channel: str) -> None:
        try:
            self.open_channels.pop(channel)
            logger.debug('router dropped channel %s', channel)
        except KeyError:
            logger.error('trying to drop non-existent channel %s from %s', channel, self.open_channels)

    def add_endpoint(self, endpoint: Endpoint) -> None:
        self.endpoints[endpoint] = set()
        self.no_endpoints.clear()

    def shutdown_endpoint(self, endpoint: Endpoint, msg: 'JsonObject | None' = None, **kwargs: JsonValue) -> None:
        channels = self.endpoints.pop(endpoint)
        logger.debug('shutdown_endpoint(%s, %s) will close %s', endpoint, kwargs, channels)
        for channel in channels:
            self.write_control(msg, command='close', channel=channel, **kwargs)
            self.drop_channel(channel)

        if not self.endpoints:
            self.no_endpoints.set()

        # were we waiting to exit?
        if self._eof:
            logger.debug('  endpoints remaining: %r', self.endpoints)
            if not self.endpoints and self.transport:
                logger.debug('  close transport')
                self.transport.close()

    def do_kill(self, host: 'str | None', group: 'str | None', message: JsonObject) -> None:
        endpoints = set(self.endpoints)
        logger.debug('do_kill(%s, %s).  Considering %d endpoints.', host, group, len(endpoints))
        for endpoint in endpoints:
            endpoint.do_kill(host, group, message)

    def channel_control_received(self, channel: str, command: str, message: JsonObject) -> None:
        if self.init_host is None:
            raise CockpitProtocolError('channel control message received before init')

        # If this is an open message then we need to apply the routing rules to
        # figure out the correct endpoint to connect.  If it's not an open
        # message, then we expect the endpoint to already exist.
        if command == 'open':
            if channel in self.open_channels:
                raise CockpitProtocolError('channel is already open')

            try:
                logger.debug('Trying to find endpoint for new channel %s payload=%s', channel, message.get('payload'))
                endpoint = self.check_rules(message)
            except RoutingError as exc:
                self.write_control(exc.get_attrs(), command='close', channel=channel)
                return

            self.open_channels[channel] = endpoint
            self.endpoints[endpoint].add(channel)
        else:
            try:
                endpoint = self.open_channels[channel]
            except KeyError:
                # sending to a non-existent channel can happen due to races and is not an error
                return

        # At this point, we have the endpoint.  Route the message.
        endpoint.do_channel_control(channel, command, message)

    def channel_data_received(self, channel: str, data: bytes) -> None:
        if self.init_host is None:
            raise CockpitProtocolError('channel data message received before init')

        try:
            endpoint = self.open_channels[channel]
        except KeyError:
            return

        endpoint.do_channel_data(channel, data)

    def eof_received(self) -> bool:
        logger.debug('eof_received(%r)', self)

        endpoints = set(self.endpoints)
        for endpoint in endpoints:
            endpoint.do_close()

        self._eof = True
        logger.debug('  endpoints remaining: %r', self.endpoints)
        return bool(self.endpoints)

    _communication_done: Optional[asyncio.Future] = None

    def do_closed(self, exc: Optional[Exception]) -> None:
        # If we didn't send EOF yet, do it now.
        if not self._eof:
            self.eof_received()

        if self._communication_done is not None:
            if exc is None:
                self._communication_done.set_result(None)
            else:
                self._communication_done.set_exception(exc)

    async def communicate(self) -> None:
        """Wait until communication is complete on the router and all endpoints are done."""
        assert self._communication_done is None
        self._communication_done = asyncio.get_running_loop().create_future()
        try:
            await self._communication_done
        except (BrokenPipeError, ConnectionResetError):
            pass  # these are normal occurrences when closed from the other side
        finally:
            self._communication_done = None

            # In an orderly exit, this is already done, but in case it wasn't
            # orderly, we need to make sure the endpoints shut down anyway...
            await self.no_endpoints.wait()
