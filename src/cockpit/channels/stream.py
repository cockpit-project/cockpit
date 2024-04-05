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
import subprocess
from typing import Dict

from ..channel import ChannelError, ProtocolChannel
from ..jsonutil import JsonDict, JsonObject, get_bool, get_enum, get_int, get_object, get_str, get_strv
from ..transports import SubprocessProtocol, SubprocessTransport, WindowSize

logger = logging.getLogger(__name__)


class SocketStreamChannel(ProtocolChannel):
    payload = 'stream'

    async def create_transport(self, loop: asyncio.AbstractEventLoop, options: JsonObject) -> asyncio.Transport:
        if 'unix' in options and 'port' in options:
            raise ChannelError('protocol-error', message='cannot specify both "port" and "unix" options')

        try:
            # Unix
            if 'unix' in options:
                path = get_str(options, 'unix')
                label = f'Unix socket {path}'
                transport, _ = await loop.create_unix_connection(lambda: self, path)

            # TCP
            elif 'port' in options:
                port = get_int(options, 'port')
                host = get_str(options, 'address', 'localhost')
                label = f'TCP socket {host}:{port}'

                transport, _ = await loop.create_connection(lambda: self, host, port)
            else:
                raise ChannelError('protocol-error',
                                   message='no "port" or "unix" or other address option for channel')

            logger.debug('SocketStreamChannel: connected to %s', label)
        except OSError as error:
            logger.info('SocketStreamChannel: connecting to %s failed: %s', label, error)
            if isinstance(error, ConnectionRefusedError):
                problem = 'not-found'
            else:
                problem = 'terminated'
            raise ChannelError(problem, message=str(error)) from error
        self.close_on_eof()
        assert isinstance(transport, asyncio.Transport)
        return transport


class SubprocessStreamChannel(ProtocolChannel, SubprocessProtocol):
    payload = 'stream'
    restrictions = (('spawn', None),)

    def process_exited(self) -> None:
        self.close_on_eof()

    def _get_close_args(self) -> JsonObject:
        assert isinstance(self._transport, SubprocessTransport)
        args: JsonDict = {'exit-status': self._transport.get_returncode()}
        stderr = self._transport.get_stderr()
        if stderr is not None:
            args['message'] = stderr
        return args

    def do_options(self, options):
        window = get_object(options, 'window', WindowSize, None)
        if window is not None:
            self._transport.set_window_size(window)

    async def create_transport(self, loop: asyncio.AbstractEventLoop, options: JsonObject) -> SubprocessTransport:
        args = get_strv(options, 'spawn')
        err = get_enum(options, 'err', ['out', 'ignore', 'message'], 'message')
        cwd = get_str(options, 'directory', '.')
        pty = get_bool(options, 'pty', default=False)
        window = get_object(options, 'window', WindowSize, None)
        environ = get_strv(options, 'environ', [])

        if err == 'out':
            stderr = subprocess.STDOUT
        elif err == 'ignore':
            stderr = subprocess.DEVNULL
        else:
            stderr = subprocess.PIPE

        env: Dict[str, str] = dict(os.environ)
        try:
            env.update(dict(e.split('=', 1) for e in environ))
        except ValueError:
            raise ChannelError('protocol-error', message='invalid "environ" option for stream channel') from None

        try:
            transport = SubprocessTransport(loop, self, args, pty=pty, window=window, env=env, cwd=cwd, stderr=stderr)
            logger.debug('Spawned process args=%s pid=%i', args, transport.get_pid())
            return transport
        except FileNotFoundError as error:
            raise ChannelError('not-found') from error
        except PermissionError as error:
            raise ChannelError('access-denied') from error
        except OSError as error:
            logger.info("Failed to spawn %s: %s", args, str(error))
            raise ChannelError('internal-error') from error
