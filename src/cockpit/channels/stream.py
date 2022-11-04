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
import socket
import subprocess

from typing import Any, Dict, Optional


from ..channel import ProtocolChannel, ChannelError
from ..transports import SocketTransport, SubprocessTransport, SubprocessProtocol

logger = logging.getLogger(__name__)


class UnixStreamChannel(ProtocolChannel):
    payload = 'stream'
    restrictions = (('unix', None),)

    def create_transport(self, loop: asyncio.AbstractEventLoop, options: Dict[str, Any]) -> SocketTransport:
        path: str = options['unix']
        connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        connection.connect(path)
        return SocketTransport(loop, self, connection)


class SubprocessStreamChannel(ProtocolChannel, SubprocessProtocol):
    payload = 'stream'
    restrictions = (('spawn', None),)

    def process_exited(self) -> None:
        self.close_on_eof()

    def _close_args(self) -> Dict[str, Any]:
        assert isinstance(self._transport, SubprocessTransport)
        args: Dict[str, object] = {'exit-status': self._transport.get_returncode()}
        stderr = self._transport.get_stderr()
        if stderr is not None:
            args['message'] = stderr.decode('utf-8')
        return args

    def do_options(self, options):
        if window := options.get('window'):
            self._transport.set_window_size(**window)

    def create_transport(self, loop: asyncio.AbstractEventLoop, options: Dict[str, Any]) -> SubprocessTransport:
        args: list[str] = options['spawn']
        err: Optional[str] = options.get('err')
        cwd: Optional[str] = options.get('directory')
        pty: bool = options.get('pty', False)
        window: Dict[str, int] = options.get('window')

        if err == 'out':
            stderr = subprocess.STDOUT
        elif err == 'ignore':
            stderr = subprocess.DEVNULL
        else:
            stderr = subprocess.PIPE

        env: Dict[str, str] = dict(os.environ)
        env.update(options.get('env') or [])

        try:
            logger.debug('Spawning process args=%s', args)
            return SubprocessTransport(loop, self, args, pty, window, env=env, cwd=cwd, stderr=stderr)
        except FileNotFoundError as error:
            raise ChannelError('not-found') from error
        except PermissionError as error:
            raise ChannelError('access-denied') from error
        except OSError as error:
            logger.info("Failed to spawn %s: %s", args, str(error))
            raise ChannelError('internal-error') from error
