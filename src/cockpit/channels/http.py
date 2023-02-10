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
import ssl
import socket
import threading

from ..channel import Channel

logger = logging.getLogger(__name__)


class HttpChannel(Channel):
    payload = 'http-stream2'

    def create_connection(self):
        opt_address = self.options.get('address') or 'localhost'
        opt_port = self.options.get('port')
        opt_unix = self.options.get('unix')
        opt_tls = self.options.get('tls')
        logger.debug('connecting to %s:%s; tls: %s', opt_address, opt_port or opt_unix, opt_tls)

        if opt_tls is not None:
            if 'authority' in opt_tls:
                if 'data' in opt_tls['authority']:
                    context = ssl.create_default_context(cadata=opt_tls['authority']['data'])
                else:
                    context = ssl.create_default_context(cafile=opt_tls['authority']['file'])
            else:
                context = ssl.create_default_context()

            if 'validate' in opt_tls and not opt_tls['validate']:
                context.check_hostname = False
                context.verify_mode = ssl.VerifyMode.CERT_NONE

            connection = http.client.HTTPSConnection(opt_address, opt_port, context=context)
        else:
            connection = http.client.HTTPConnection(opt_address, opt_port)

        try:
            if opt_unix:
                # create the connection's socket so that it won't call .connect() internally (which only supports TCP)
                connection.sock = socket.socket(socket.AF_UNIX)
                connection.sock.connect(opt_unix)
            else:
                # explicitly call connect(), so that we can do proper error handling
                connection.connect()
        except (OSError, IOError) as e:
            logger.error('Failed to open %s:%s: %s %s', opt_address, opt_port or opt_unix, type(e), e)
            problem = 'unknown-hostkey' if isinstance(e, ssl.SSLCertVerificationError) else 'not-found'
            self.close(problem=problem, message=str(e))
            return None

        return connection

    def read_send_response(self, response):
        """Completely read the response and send it to the channel"""

        while True:
            # we want to stream data blocks as soon as they come in
            block = response.read1(4096)
            if not block:
                logger.debug('reading response done')
                # this returns immediately and does not read anything more, but updates the http.client's
                # internal state machine to "response done"
                block = response.read()
                assert block == b''
                break
            logger.debug('read block of size %i', len(block))
            self.loop.call_soon_threadsafe(self.send_data, block)

    def parse_headers(self, http_msg):
        headers = dict(http_msg)
        remove = ['Connection', 'Transfer-Encoding']
        if self.options.get('binary'):
            remove = ['Content-Length', 'Range']
        for h in remove:
            try:
                del headers[h]
            except KeyError:
                pass
        return headers

    def request(self):
        connection = self.create_connection()
        if not connection:
            # make_connection does the error reporting
            return

        connection.request(self.options.get('method'),
                           self.options.get('path'),
                           headers=self.options.get('headers') or {},
                           body=self.body)
        try:
            response = connection.getresponse()
            self.loop.call_soon_threadsafe(lambda: self.send_control(
                command='response', status=response.status, reason=response.reason,
                headers=self.parse_headers(response.headers)))
            self.read_send_response(response)
        except http.client.HTTPException as error:
            msg = str(error)
            logger.debug('HTTP reading response failed: %s', msg)
            self.loop.call_soon_threadsafe(lambda: self.close(problem='terminated', message=msg))
            return
        finally:
            connection.close()

        self.loop.call_soon_threadsafe(self.done)
        self.loop.call_soon_threadsafe(self.close)
        logger.debug('closed')

    def do_open(self, options):
        logger.debug('open %s', options)
        # TODO: generic JSON validation
        if not options.get('method'):
            self.close(problem='protocol-error', message='missing or empty "method" field in HTTP stream request')
            return
        if options.get('path') is None:
            self.close(problem='protocol-error', message='missing "path" field in HTTP stream request')
            return
        if options.get('tls') is not None and options.get('unix'):
            self.close(problem='protocol-error', message='TLS on Unix socket is not supported')
            return
        if options.get('connection') is not None:
            self.close(problem='protocol-error', message='connection sharing is not implemented on this bridge')
            return

        opt_port = options.get('port')
        opt_unix = options.get('unix')
        if opt_port is None and opt_unix is None:
            self.close(problem='protocol-error', message='no "port" or "unix" option for channel')
            return
        if opt_port is not None and opt_unix is not None:
            self.close(problem='protocol-error', message='cannot specify both "port" and "unix" options')
            return

        self.options = options
        self.body = b''

        self.ready()

    def do_data(self, data):
        self.body += data

    def do_done(self):
        self.loop = asyncio.get_running_loop()
        threading.Thread(target=self.request, daemon=True).start()
