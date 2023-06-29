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
import re
import socket
from typing import Dict, List, Optional, Tuple

from cockpit._vendor import ferny

from .peer import Peer, PeerError
from .router import Router, RoutingRule

logger = logging.getLogger(__name__)


class PasswordResponder(ferny.InteractionResponder):
    PASSPHRASE_RE = re.compile(r"Enter passphrase for key '(.*)': ")

    password: Optional[str]

    hostkeys_seen: List[Tuple[str, str, str, str, str]]
    error_message: Optional[str]
    password_attempts: int

    def __init__(self, password: Optional[str]):
        self.password = password

        self.hostkeys_seen = []
        self.error_message = None
        self.password_attempts = 0

    async def do_hostkey(self, reason: str, host: str, algorithm: str, key: str, fingerprint: str) -> bool:
        self.hostkeys_seen.append((reason, host, algorithm, key, fingerprint))
        return False

    async def do_askpass(self, messages: str, prompt: str, hint: str) -> Optional[str]:
        logger.debug('Got askpass(%s): %s', hint, prompt)

        match = PasswordResponder.PASSPHRASE_RE.fullmatch(prompt)
        if match is not None:
            # We never unlock private keys — we rather need to throw a
            # specially-formatted error message which will cause the frontend
            # to load the named key into the agent for us and try again.
            path = match.group(1)
            logger.debug("This is a passphrase request for %s, but we don't do those.  Abort.", path)
            self.error_message = f'locked identity: {path}'
            return None

        assert self.password is not None
        assert self.password_attempts == 0
        self.password_attempts += 1
        return self.password


class SshPeer(Peer):
    session: Optional[ferny.Session] = None
    host: str
    user: Optional[str]
    password: Optional[str]
    private: bool

    async def do_connect_transport(self) -> None:
        assert self.session is not None
        logger.debug('Starting ssh session user=%s, host=%s, private=%s', self.user, self.host, self.private)

        basename, colon, portstr = self.host.rpartition(':')
        if colon and portstr.isdigit():
            host = basename
            port = int(portstr)
        else:
            host = self.host
            port = None

        responder = PasswordResponder(self.password)
        options = {"StrictHostKeyChecking": 'yes'}

        if self.password is not None:
            options.update(NumberOfPasswordPrompts='1')
        else:
            options.update(PasswordAuthentication="no", KbdInteractiveAuthentication="no")

        try:
            await self.session.connect(host, login_name=self.user, port=port,
                                       handle_host_key=self.private, options=options,
                                       interaction_responder=responder)
        except (OSError, socket.gaierror) as exc:
            logger.debug('connecting to host %s failed: %s', host, exc)
            raise PeerError('no-host', error='no-host', message=str(exc)) from exc

        except ferny.HostKeyError as exc:
            if responder.hostkeys_seen:
                # If we saw a hostkey then we can issue a detailed error message
                # containing the key that would need to be accepted.  That will
                # cause the front-end to present a dialog.
                _reason, host, algorithm, key, fingerprint = responder.hostkeys_seen[0]
                error_args = {'host_key': f'{host} {algorithm} {key}', 'host_fingerprint': fingerprint}
            else:
                error_args = {}

            if isinstance(exc, ferny.ChangedHostKeyError):
                error = 'invalid-hostkey'
            elif self.private:
                error = 'unknown-hostkey'
            else:
                # non-private session case.  throw a generic error.
                error = 'unknown-host'

            logger.debug('SshPeer got a %s %s; private %s, seen hostkeys %r; raising %s with extra args %r',
                         type(exc), exc, self.private, responder.hostkeys_seen, error, error_args)
            raise PeerError(error, error=error, auth_method_results={}, **error_args) from exc

        except ferny.AuthenticationError as exc:
            logger.debug('authentication to host %s failed: %s', host, exc)

            results = {method: 'not-provided' for method in exc.methods}
            if 'password' in results and self.password is not None:
                if responder.password_attempts == 0:
                    results['password'] = 'not-tried'
                else:
                    results['password'] = 'denied'

            raise PeerError('authentication-failed',
                            error=responder.error_message or 'authentication-failed',
                            auth_method_results=results) from exc

        except ferny.SshError as exc:
            logger.debug('unknown failure connecting to host %s: %s', host, exc)
            raise PeerError('internal-error', message=str(exc)) from exc

        args = self.session.wrap_subprocess_args(['cockpit-bridge'])
        await self.spawn(args, [])

    def do_kill(self, host: Optional[str], group: Optional[str]) -> None:
        if host == self.host:
            self.close()
        elif host is None:
            super().do_kill(None, group)

    def __init__(self, router: Router, host: str, user: Optional[str], password: Optional[str], *, private: bool):
        super().__init__(router)
        self.host = host
        self.user = user
        self.password = password
        self.private = private

        self.session = ferny.Session()
        self.start_in_background(init_host=host)


class HostRoutingRule(RoutingRule):
    remotes: Dict[Tuple[str, Optional[str], Optional[str]], Peer]

    def __init__(self, router):
        super().__init__(router)
        self.remotes = {}

    def apply_rule(self, options: Dict[str, object]) -> Optional[Peer]:
        assert self.router is not None

        host = options.get('host')

        if host is None or host == self.router.init_host:
            return None

        assert isinstance(host, str)

        user = options.get('user')
        # HACK: the front-end relies on this for tracking connections without an explicit user name;
        # the user will then be determined by SSH (`User` in the config or the current user)
        # See cockpit_router_normalize_host_params() in src/bridge/cockpitrouter.c
        if user == getpass.getuser():
            user = None
        if not user:
            user_from_host, _, _ = host.rpartition('@')
            user = user_from_host or None  # avoid ''

        if options.get('session') == 'private':
            nonce = options.get('channel')
        else:
            nonce = None

        assert isinstance(host, str)
        assert user is None or isinstance(user, str)
        assert nonce is None or isinstance(nonce, str)

        key = host, user, nonce

        logger.debug('Request for channel %s is remote.', options)
        logger.debug('key=%s', key)

        if key not in self.remotes:
            logger.debug('%s is not among the existing remotes %s.  Opening a new connection.', key, self.remotes)
            password = options.get('password')
            assert password is None or isinstance(password, str)
            peer = SshPeer(self.router, host, user, password, private=nonce is not None)
            peer.add_done_callback(lambda: self.remotes.__delitem__(key))
            self.remotes[key] = peer

        return self.remotes[key]

    def shutdown(self):
        for peer in set(self.remotes.values()):
            peer.close()
