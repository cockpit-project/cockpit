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

import collections
import logging

from typing import Dict, List, Optional

from .protocol import CockpitProtocolServer, CockpitProtocolError

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

    def run(self):
        logger.debug('ExecutionQueue: Running %d queued method calls', len(self.queue))
        for method, args in self.queue:
            method(*args)

        for method in self.methods:
            delattr(method.__self__, method.__func__.__name__)


class Endpoint:
    router: Router
    __endpoint_frozen_queue: Optional[ExecutionQueue] = None

    def __init__(self, router: Router):
        self.router = router

    def endpoint_is_frozen(self) -> bool:
        return self.__endpoint_frozen_queue is not None

    def freeze_endpoint(self):
        assert self.__endpoint_frozen_queue is None
        logger.debug('Freezing endpoint %s', self)
        self.__endpoint_frozen_queue = ExecutionQueue({self.do_channel_control, self.do_channel_data})

    def thaw_endpoint(self):
        assert self.__endpoint_frozen_queue is not None
        logger.debug('Thawing endpoint %s', self)
        self.__endpoint_frozen_queue.run()
        self.__endpoint_frozen_queue = None

    # interface for receiving messages
    def do_channel_control(self, channel: str, command: str, message: Dict[str, object]) -> None:
        raise NotImplementedError

    def do_channel_data(self, channel: str, data: bytes) -> None:
        raise NotImplementedError

    # interface for sending messages
    def send_channel_data(self, channel: str, data: bytes) -> None:
        self.router.write_channel_data(channel, data)

    def send_channel_message(self, channel: str, **kwargs) -> None:
        self.router.write_message(channel, **kwargs)

    def send_channel_control(self, channel, command, **kwargs) -> None:
        self.router.write_control(channel=channel, command=command, **kwargs)
        if command == 'close':
            self.router.close_channel(channel)


class RoutingError(Exception):
    def __init__(self, problem, **kwargs):
        self.problem = problem
        self.kwargs = kwargs


class RoutingRule:
    router: Router

    def __init__(self, router: Router):
        self.router = router

    def apply_rule(self, options: Dict[str, object]) -> Optional[Endpoint]:
        """Check if a routing rule applies to a given 'open' message.

        This should inspect the options dictionary and do one of the following three things:

            - return an Endpoint to handle this channel
            - raise a RoutingError to indicate that the open should be rejected
            - return None to let the next rule run
        """
        raise NotImplementedError


class Router(CockpitProtocolServer):
    routing_rules: List[RoutingRule]
    open_channels: Dict[str, Endpoint]
    groups: Dict[str, str]

    def __init__(self, routing_rules: List[RoutingRule]):
        for rule in routing_rules:
            rule.router = self
        self.routing_rules = routing_rules
        self.open_channels = {}
        self.groups = {}

    def check_rules(self, options: Dict[str, object]) -> Endpoint:
        for rule in self.routing_rules:
            endpoint = rule.apply_rule(options)
            if endpoint is not None:
                return endpoint
        else:
            raise RoutingError('not-supported')

    def close_channel(self, channel: str) -> None:
        self.open_channels.pop(channel, None)
        if channel in self.groups:
            del self.groups[channel]

    def do_kill(self, host: Optional[str], group: Optional[str]) -> None:
        if group:
            to_close = set(ch for ch, gr in self.groups.items() if gr == group)
            for channel in to_close:
                self.close_channel(channel)

    def channel_control_received(self, channel: str, command: str, message: Dict[str, object]) -> None:
        # If this is an open message then we need to apply the routing rules to
        # figure out the correct endpoint to connect.  If it's not an open
        # message, then we expect the endpoint to already exist.
        if command == 'open':
            if channel in self.open_channels:
                raise CockpitProtocolError('channel is already open')

            try:
                endpoint = self.check_rules(message)
            except RoutingError as exc:
                self.write_control(command='close', channel=channel, problem=exc.problem, **exc.kwargs)
                return

            self.open_channels[channel] = endpoint

            group = message.get('group')
            if isinstance(group, str):
                self.groups[channel] = group
        else:
            try:
                endpoint = self.open_channels[channel]
            except KeyError:
                # sending to a non-existent channel can happen due to races and is not an error
                return

        # At this point, we have the endpoint.  Route the message.
        endpoint.do_channel_control(channel, command, message)

        # If that was a close message, we can remove the endpoint now.
        if command == 'close':
            self.close_channel(channel)

    def channel_data_received(self, channel: str, data: bytes) -> None:
        try:
            endpoint = self.open_channels[channel]
        except KeyError:
            return

        endpoint.do_channel_data(channel, data)
