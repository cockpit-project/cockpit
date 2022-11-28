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

from typing import Dict, List, Optional, Tuple, Type

from .protocol import CockpitProtocolServer, CockpitProtocolError

logger = logging.getLogger(__name__)


class Endpoint:
    router: Router

    def __init__(self, router: Router):
        self.router = router

    # interface for receiving messages
    def do_channel_control(self, command: str, message: Dict[str, object]) -> None:
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


MatchRule = Dict[str, object]
RoutingRule = Tuple[MatchRule, Type[Endpoint]]


class Router(CockpitProtocolServer):
    routing_rules: List[RoutingRule]
    open_channels: Dict[str, Endpoint]

    def __init__(self, routing_rules: List[RoutingRule]):
        self.routing_rules = routing_rules
        self.open_channels = {}

    def rule_matches(self, rule: MatchRule, options: Dict[str, object]) -> bool:
        for key, expected_value in rule.items():
            our_value = options.get(key)

            # Special treatment: we only consider the host field to be
            # present if it varies from the 'host' field we received with
            # our init message (ie: specifies a different host).
            if key == 'host':
                if our_value == self.init_host:
                    our_value = None

            # If the match rule specifies that a value must be present and
            # we don't have it, then fail.
            if our_value is None:
                return False

            # If the match rule specified a specific expected value, and
            # our value doesn't match it, then fail.
            if expected_value is not None and our_value != expected_value:
                return False

        # More special treatment: if 'host' was given in the options field, and
        # it's not the init_host, then the rule must specifically match it.
        if 'host' in options and options['host'] != self.init_host and 'host' not in rule:
            return False

        return True

    def check_rules(self, options) -> Optional[Endpoint]:
        for rule, result in self.routing_rules:
            if self.rule_matches(rule, options):
                return result(self)
        return None

    def close_channel(self, channel: str) -> None:
        self.open_channels.pop(channel, None)

    def channel_control_received(self, channel: str, command: str, message: Dict[str, object]) -> None:
        logger.debug('Received control message %s for channel %s: %s', command, channel, message)

        # If this is an open message then we need to apply the routing rules to
        # figure out the correct endpoint to connect.  If it's not an open
        # message, then we expect the endpoint to already exist.
        if command == 'open':
            if channel in self.open_channels:
                raise CockpitProtocolError('channel is already open')

            endpoint = self.check_rules(message)

            if endpoint is None:
                self.write_control(command='close', channel=channel, problem='not-supported')
                return

            self.open_channels[channel] = endpoint
        else:
            try:
                endpoint = self.open_channels[channel]
            except KeyError:
                # sending to a non-existent channel can happen due to races and is not an error
                return

        # At this point, we have the endpoint.  Route the message.
        endpoint.do_channel_control(command, message)

        # If that was a close message, we can remove the endpoint now.
        if command == 'close':
            self.close_channel(channel)

    def channel_data_received(self, channel: str, data: bytes) -> None:
        logger.debug('Received %d bytes of data for channel %s', len(data), channel)
        try:
            endpoint = self.open_channels[channel]
        except KeyError:
            return

        endpoint.do_channel_data(channel, data)
