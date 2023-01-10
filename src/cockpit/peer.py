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

import asyncio
import logging
import os

from typing import Any, Dict, Optional, Set

from .router import Endpoint, Router
from .protocol import CockpitProtocolClient
from .transports import SubprocessTransport, SubprocessProtocol

logger = logging.getLogger(__name__)


class PeerStateListener:
    def peer_state_changed(self, peer: Peer, event: str, exc: Optional[Exception] = None) -> None:
        """Signal a state change in the Peer.

        This is called on:
            - connection made (event='connect')
            - init message received (event='init')
            - connection lost (event='closed', exc possibly set)
        """

    def peer_authorization_request(self, peer: Peer, prompt: str, echo: bool) -> None:
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

        self.name = name
        self.state_listener = state_listener

        assert router.init_host is not None
        self.init_host = init_host or router.init_host

        self.channels = set()
        self.authorize_pending = None

    def spawn(self, argv: list[str], env: Dict[str, str]) -> asyncio.Transport:
        loop = asyncio.get_running_loop()
        return SubprocessTransport(loop, self, argv, env=dict(os.environ, **env))

    # Handling of interesting events
    def do_ready(self) -> None:
        logger.debug('Peer %s connection established', self.name)
        if self.state_listener is not None:
            self.state_listener.peer_state_changed(self, 'connected')

    def do_init(self, message: Dict[str, Any]) -> None:
        logger.debug('Peer %s connection got init message', self.name)
        if self.state_listener is not None:
            self.state_listener.peer_state_changed(self, 'init')
        self.write_control(command='init', version='1', host=self.init_host)

    def do_closed(self, transport_was: asyncio.Transport, exc: Optional[Exception]) -> None:
        logger.debug('Peer %s connection lost %s', self.name, exc)

        # We need to synthesize close messages for all open channels
        while self.channels:
            self.send_channel_control(self.channels.pop(), 'close', problem='disconnected')

        if self.state_listener is not None:
            self.state_listener.peer_state_changed(self, 'closed', exc)

    def do_authorize(self, message: Dict[str, object]) -> None:
        cookie = message.get('cookie')
        prompt = message.get('prompt')
        logger.debug('Peer %s request, cookie=%s, prompt=%s', self.name, cookie, prompt)
        if self.state_listener is not None and isinstance(cookie, str) and isinstance(prompt, str):
            self.authorize_pending = cookie
            self.state_listener.peer_authorization_request(self, prompt, False)

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
