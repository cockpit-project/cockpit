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
import ctypes
import logging
import os
import signal
import subprocess

from typing import Dict


from ..channel import ProtocolChannel, ChannelError
from ..transports import SubprocessTransport, SubprocessProtocol

logger = logging.getLogger(__name__)

libc6 = ctypes.cdll.LoadLibrary('libc.so.6')


def prctl(*args):
    if libc6.prctl(*args) != 0:
        raise OSError('prctl() failed')


SET_PDEATHSIG = 1


class SocketStreamChannel(ProtocolChannel):
    payload = 'stream'

    async def create_transport(self, loop: asyncio.AbstractEventLoop, options: Dict[str, object]) -> asyncio.Transport:
        if 'unix' in options and 'port' in options:
            raise ChannelError('protocol-error', message='cannot specify both "port" and "unix" options')

        try:
            # Unix
            if 'unix' in options:
                path = options['unix']
                # TODO: generic JSON validation
                if not isinstance(path, str):
                    raise ChannelError('protocol-error', message='unix option must be a string')
                label = f'Unix socket {path}'
                transport, _ = await loop.create_unix_connection(lambda: self, path)

            # TCP
            elif 'port' in options:
                try:
                    port: int = int(options['port'])  # type: ignore
                except ValueError:
                    raise ChannelError('protocol-error', message='invalid "port" option for stream channel')
                host = options.get('address', 'localhost')
                # TODO: generic JSON validation
                if not isinstance(host, str):
                    raise ChannelError('protocol-error', message='"address" option for stream channel must be a string')
                label = f'TCP socket {host}:{port}'

                transport, _ = await loop.create_connection(lambda: self, host, port)
            else:
                raise ChannelError('protocol-error', message='no "port" or "unix" or other address option for channel')

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

    def _get_close_args(self) -> Dict[str, object]:
        assert isinstance(self._transport, SubprocessTransport)
        args: Dict[str, object] = {'exit-status': self._transport.get_returncode()}
        stderr = self._transport.get_stderr()
        if stderr is not None:
            args['message'] = stderr
        return args

    def do_options(self, options):
        window = options.get('window')
        if window is not None:
            self._transport.set_window_size(**window)

    def do_close(self):
        assert isinstance(self._transport, SubprocessTransport)
        pid = self._transport.get_pid()
        # avoid calling .terminate(), as that will try to read the process' exit code and race with
        # asyncio's ChildWatcher (which also wants to wait() the process); the cockpit.spawn() API
        # already ensures that the process is valid before even calling do_close.
        try:
            os.kill(pid, signal.SIGTERM)
            logger.debug('Received close signal from peer, SIGTERMed process %i', pid)
        except ProcessLookupError:
            # already gone? fine!
            logger.debug('Received close signal from peer, but process %i is already gone', pid)

    async def create_transport(self, loop: asyncio.AbstractEventLoop, options: Dict[str, object]) -> SubprocessTransport:
        args = options['spawn']

        # TODO: generic JSON validation
        if not isinstance(args, list) or not all(isinstance(a, str) for a in args):
            raise ChannelError('protocol-error', message='invalid "args" option for stream channel')

        err = options.get('err')
        if err is not None and not isinstance(err, str):
            raise ChannelError('protocol-error', message='invalid "err" option for stream channel')

        cwd = options.get('directory')
        if cwd is not None and not isinstance(cwd, str):
            raise ChannelError('protocol-error', message='invalid "cwd" option for stream channel')

        pty = options.get('pty', False)
        if not isinstance(pty, bool):
            raise ChannelError('protocol-error', message='invalid "pty" option for stream channel')

        window = options.get('window')
        if window is not None and (
                not isinstance(window, dict) or
                not all(isinstance(k, str) and isinstance(v, int) for k, v in window.items())):
            raise ChannelError('protocol-error', message='invalid "window" option for stream channel')

        environ = options.get('environ')

        if err == 'out':
            stderr = subprocess.STDOUT
        elif err == 'ignore':
            stderr = subprocess.DEVNULL
        else:
            stderr = subprocess.PIPE

        env: Dict[str, str] = dict(os.environ)
        if environ is not None:
            if not isinstance(environ, list) or not all(isinstance(e, str) and '=' in e for e in environ):
                raise ChannelError('protocol-error', message='invalid "environ" option for stream channel')

            env.update(dict(e.split('=', 1) for e in environ))

        try:
            transport = SubprocessTransport(loop, self, args, pty, window, env=env, cwd=cwd, stderr=stderr,
                                            preexec_fn=lambda: prctl(SET_PDEATHSIG, signal.SIGHUP))
            logger.debug('Spawned process args=%s pid=%i', args, transport.get_pid())
            return transport
        except FileNotFoundError as error:
            raise ChannelError('not-found') from error
        except PermissionError as error:
            raise ChannelError('access-denied') from error
        except OSError as error:
            logger.info("Failed to spawn %s: %s", args, str(error))
            raise ChannelError('internal-error') from error
