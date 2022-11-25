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

import logging
import shlex

from .channel import Channel
from .channels import CHANNEL_TYPES
from .packages import Packages
from .protocol import CockpitProtocolServer, CockpitProtocolError

logger = logging.getLogger('cockpit.bridge')


def parse_os_release():
    with open('/usr/lib/os-release', encoding='utf-8') as os_release:
        lexer = shlex.shlex(os_release, posix=True, punctuation_chars=True)
        return dict(token.split('=', 1) for token in lexer)


class Router(CockpitProtocolServer):
    def __init__(self):
        self.match_rules = Channel.create_match_rules(CHANNEL_TYPES)
        self.os_release = parse_os_release()
        self.packages = Packages()
        self.endpoints = {}
        self.peers = {}

    def do_send_init(self):
        self.send_control(command='init', version=1,
                          checksum=self.packages.checksum,
                          packages={p: None for p in self.packages.packages},
                          os_release=parse_os_release())

    def rule_matches(self, rule, options):
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

    def check_rules(self, options):
        for rule, result in self.match_rules:
            if self.rule_matches(rule, options):
                return result(self)
        return None

    def do_channel_control(self, channel, command, message):
        logger.debug('Received control message %s for channel %s: %s', command, channel, message)

        # If this is an open message then we need to apply the routing rules to
        # figure out the correct endpoint to connect.  If it's not an open
        # message, then we expect the endpoint to already exist.
        if command == 'open':
            endpoint = self.check_rules(message)

            if endpoint is None:
                self.send_control(command='close', channel=channel, problem='not-supported')
                return

            # can't find a more pythonic way to do this without two lookups...
            if self.endpoints.setdefault(channel, endpoint) != endpoint:
                raise CockpitProtocolError('channel is already open')
        else:
            try:
                endpoint = self.endpoints[channel]
            except KeyError:
                # sending to a non-existent channel can happen due to races and is not an error
                return

        # At this point, we have the endpoint.  Route the message.
        endpoint.do_channel_control(command, message)

        # If that was a close message, we can remove the endpoint now.
        if command == 'close':
            del self.endpoints[channel]

    def do_channel_data(self, channel, data):
        logger.debug('Received %d bytes of data for channel %s', len(data), channel)
        try:
            endpoint = self.endpoints[channel]
        except KeyError:
            return

        endpoint.do_channel_data(channel, data)
