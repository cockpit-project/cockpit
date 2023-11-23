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

import getpass
import logging
import os
import sys
from typing import Dict, Optional, Tuple

from cockpit._vendor import ferny

from .jsonutil import JsonObject, JsonValue, get_dict, get_str, get_str_or_none
from .peer import Peer
from .router import Endpoint, RoutingRule

logger = logging.getLogger(__name__)


class RemotePeer(Peer):
    host: str
    init_superuser: 'str | bool' = False
    authorization: JsonObject

    def __init__(self, rule: RoutingRule, host: str, user: str, options: JsonObject, *, private: bool) -> None:
        super().__init__(rule)

        self.authorization = {'user': user or None, 'password': get_str(options, 'password', None)}
        self.host = host

        init_superuser = get_str_or_none(options, 'init-superuser', None)
        if init_superuser is not None and init_superuser != 'none':
            self.init_superuser = init_superuser

        # TODO: not gonna work with beipack
        env = dict(os.environ, PYTHONPATH=':'.join(sys.path))
        if private:
            env['COCKPIT_SSH_CONNECT_TO_UNKNOWN_HOSTS'] = '1'

        cmd = (sys.executable, '-m', 'cockpit.beiboot', '--never', host)
        ferny.FernyTransport.spawn(lambda: self, cmd, env=env)

    def do_init_args(self, message: JsonObject) -> JsonObject:
        args: dict[str, JsonValue] = {'host': self.host}

        if 'explicit-superuser' in get_dict(message, 'capabilities', {}):
            args['superuser'] = self.init_superuser

        return args

    def transport_control_received(self, command: str, message: JsonObject) -> None:
        # Handle replying to the initial '*' message we expect from cockpit-beiboot
        if command == 'authorize' and get_str(message, 'challenge') == '*' and self.authorization is not None:
            cookie = get_str(message, 'cookie')
            try:
                self.write_control(self.authorization, command='authorize', cookie=cookie)
            finally:
                self.authorization = {}
        else:
            super().transport_control_received(command, message)

    def do_kill(self, host: 'str | None', group: 'str | None', message: JsonObject) -> None:
        # we interpret 'kill' for our host as a request to shut down the connection
        if host == self.host:
            self.close()
        elif host is None:
            super().do_kill(host, group, message)


class HostRoutingRule(RoutingRule):
    remotes: Dict[Tuple[str, Optional[str], Optional[str]], Peer]

    def __init__(self, router):
        super().__init__(router)
        self.remotes = {}

    def apply_rule(self, options: JsonObject) -> Optional[Peer]:
        assert self.router is not None
        assert self.router.init_host is not None

        host = get_str(options, 'host', self.router.init_host)
        if host == self.router.init_host:
            return None

        user = get_str(options, 'user', '')
        # HACK: the front-end relies on this for tracking connections without an explicit user name;
        # the user will then be determined by SSH (`User` in the config or the current user)
        # See cockpit_router_normalize_host_params() in src/bridge/cockpitrouter.c
        if user == getpass.getuser():
            user = ''
        if not user:
            user_from_host, _, _ = host.rpartition('@')
            user = user_from_host  # may be ''

        if get_str(options, 'session', None) == 'private':
            nonce = get_str(options, 'channel')
        else:
            nonce = None

        assert isinstance(host, str)
        assert user is None or isinstance(user, str)
        assert nonce is None or isinstance(nonce, str)

        key = host, user, nonce

        logger.debug('Request for channel %s is remote.', options)
        logger.debug('key=%s', key)

        try:
            peer = self.remotes[key]
        except KeyError:
            logger.debug('%s is not among the existing remotes %s.  Opening a new connection.', key, self.remotes)
            peer = RemotePeer(self, host, user, options, private=nonce is not None)
            self.remotes[key] = peer

        # This is evil, but unconditionally forwarding the password on to remote hosts is worse.
        assert isinstance(options, dict)
        options.pop('password', None)

        return peer

    def endpoint_closed(self, endpoint: Endpoint) -> None:
        # we may have more than one peer — find the correct one
        for key, value in self.remotes.items():
            if value is endpoint:
                del self.remotes[key]
                return
