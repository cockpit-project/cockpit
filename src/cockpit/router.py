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

import logging

from typing import Dict, List, Optional

from .protocol import CockpitProtocolServer, CockpitProtocolError

logger = logging.getLogger(__name__)


class Endpoint:
    router: Router

    def __init__(self, router: Router):
        self.router = router

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
    def __init__(self, problem):
        self.problem = problem


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

    def __init__(self, routing_rules: List[RoutingRule]):
        for rule in routing_rules:
            rule.router = self
        self.routing_rules = routing_rules
        self.open_channels = {}

    def check_rules(self, options: Dict[str, object]) -> Endpoint:
        for rule in self.routing_rules:
            endpoint = rule.apply_rule(options)
            if endpoint is not None:
                return endpoint
        else:
            raise RoutingError('not-supported')

    def close_channel(self, channel: str) -> None:
        self.open_channels.pop(channel, None)

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
                self.write_control(command='close', channel=channel, problem=exc.problem)
                return

            self.open_channels[channel] = endpoint
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
