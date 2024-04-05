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
import http.client
import logging
import socket
import ssl

from ..channel import AsyncChannel, ChannelError
from ..jsonutil import JsonObject, get_dict, get_enum, get_int, get_object, get_str, typechecked

logger = logging.getLogger(__name__)


class HttpChannel(AsyncChannel):
    payload = 'http-stream2'

    @staticmethod
    def get_headers(response: http.client.HTTPResponse, *, binary: bool) -> JsonObject:
        # Never send these headers
        remove = {'Connection', 'Transfer-Encoding'}

        if not binary:
            # Only send these headers for raw binary streams
            remove.update({'Content-Length', 'Range'})

        return {key: value for key, value in response.getheaders() if key not in remove}

    @staticmethod
    def create_client(options: JsonObject) -> http.client.HTTPConnection:
        opt_address = get_str(options, 'address', 'localhost')
        opt_tls = get_dict(options, 'tls', None)
        opt_unix = get_str(options, 'unix', None)
        opt_port = get_int(options, 'port', None)

        if opt_tls is not None and opt_unix is not None:
            raise ChannelError('protocol-error', message='TLS on Unix socket is not supported')
        if opt_port is None and opt_unix is None:
            raise ChannelError('protocol-error', message='no "port" or "unix" option for channel')
        if opt_port is not None and opt_unix is not None:
            raise ChannelError('protocol-error', message='cannot specify both "port" and "unix" options')

        if opt_tls is not None:
            authority = get_dict(opt_tls, 'authority', None)
            if authority is not None:
                data = get_str(authority, 'data', None)
                if data is not None:
                    context = ssl.create_default_context(cadata=data)
                else:
                    context = ssl.create_default_context(cafile=get_str(authority, 'file'))
            else:
                context = ssl.create_default_context()

            if 'validate' in opt_tls and not opt_tls['validate']:
                context.check_hostname = False
                context.verify_mode = ssl.VerifyMode.CERT_NONE

            # See https://github.com/python/typeshed/issues/11057
            return http.client.HTTPSConnection(opt_address, port=opt_port, context=context)  # type: ignore[arg-type]

        else:
            return http.client.HTTPConnection(opt_address, port=opt_port)

    @staticmethod
    def connect(connection: http.client.HTTPConnection, opt_unix: 'str | None') -> None:
        # Blocks.  Runs in a thread.
        if opt_unix:
            # create the connection's socket so that it won't call .connect() internally (which only supports TCP)
            connection.sock = socket.socket(socket.AF_UNIX)
            connection.sock.connect(opt_unix)
        else:
            # explicitly call connect(), so that we can do proper error handling
            connection.connect()

    @staticmethod
    def request(
        connection: http.client.HTTPConnection, method: str, path: str, headers: 'dict[str, str]', body: bytes
    ) -> http.client.HTTPResponse:
        # Blocks.  Runs in a thread.
        connection.request(method, path, headers=headers or {}, body=body)
        return connection.getresponse()

    async def run(self, options: JsonObject) -> None:
        logger.debug('open %s', options)

        binary = get_enum(options, 'binary', ['raw'], None) is not None
        method = get_str(options, 'method')
        path = get_str(options, 'path')
        headers = get_object(options, 'headers', lambda d: {k: typechecked(v, str) for k, v in d.items()}, None)

        if 'connection' in options:
            raise ChannelError('protocol-error', message='connection sharing is not implemented on this bridge')

        loop = asyncio.get_running_loop()
        connection = self.create_client(options)

        self.ready()

        body = b''
        while True:
            data = await self.read()
            if data is None:
                break
            body += data

        # Connect in a thread and handle errors
        try:
            await loop.run_in_executor(None, self.connect, connection, get_str(options, 'unix', None))
        except ssl.SSLCertVerificationError as exc:
            raise ChannelError('unknown-hostkey', message=str(exc)) from exc
        except (OSError, IOError) as exc:
            raise ChannelError('not-found', message=str(exc)) from exc

        # Submit request in a thread and handle errors
        try:
            response = await loop.run_in_executor(None, self.request, connection, method, path, headers or {}, body)
        except (http.client.HTTPException, OSError) as exc:
            raise ChannelError('terminated', message=str(exc)) from exc

        self.send_control(command='response',
                          status=response.status,
                          reason=response.reason,
                          headers=self.get_headers(response, binary=binary))

        # Receive the body and finish up
        try:
            while True:
                block = await loop.run_in_executor(None, response.read1, self.BLOCK_SIZE)
                if not block:
                    break
                await self.write(block)

            logger.debug('reading response done')
            # this returns immediately and does not read anything more, but updates the http.client's
            # internal state machine to "response done"
            block = response.read()
            assert block == b''

            await loop.run_in_executor(None, connection.close)
        except (http.client.HTTPException, OSError) as exc:
            raise ChannelError('terminated', message=str(exc)) from exc

        self.done()
