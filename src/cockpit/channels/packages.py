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
import threading
from typing import Dict, Optional

from ..channel import Channel
from ..data import read_cockpit_data_file
from ..packages import Packages

logger = logging.getLogger(__name__)


class PackagesChannel(Channel):
    payload = 'http-stream1'
    restrictions = [("internal", "packages")]

    # used to carry data forward from open to done
    options: Optional[Dict[str, object]] = None

    def http_error(self, status: int, message: str) -> None:
        template = read_cockpit_data_file('fail.html')
        self.send_message(status=status, reason='ERROR', headers={'Content-Type': 'text/html; charset=utf-8'})
        self.send_data(template.replace(b'@@message@@', message.encode('utf-8')))
        self.done()
        self.close()

    def do_open(self, options: Dict[str, object]) -> None:
        self.ready()

        self.options = options

    def do_done(self) -> None:
        packages: Packages = self.router.packages  # type: ignore[attr-defined]  # yes, this is evil
        assert self.options is not None
        options = self.options

        try:
            if options.get('method') != 'GET':
                raise ValueError(f'Unsupported HTTP method {options["method"]}')

            path = options.get('path')
            if not isinstance(path, str) or not path.startswith('/'):
                raise ValueError(f'Unsupported HTTP method {options["method"]}')

            headers = options.get('headers')
            if not isinstance(headers, dict) or not all(isinstance(value, str) for value in headers.values()):
                raise ValueError(f'Unsupported HTTP method {options["method"]}')

            document = packages.load_path(path, headers)

            # Note: we can't cache documents right now.  See
            # https://github.com/cockpit-project/cockpit/issues/19071
            # for future plans.
            out_headers = {
                'Cache-Control': 'no-cache, no-store',
                'Content-Type': document.content_type,
            }

            if document.content_encoding is not None:
                out_headers['Content-Encoding'] = document.content_encoding

            if document.content_security_policy is not None:
                policy = document.content_security_policy

                # https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/connect-src
                #
                #    Note: connect-src 'self' does not resolve to websocket
                #    schemes in all browsers, more info in this issue.
                #
                # https://github.com/w3c/webappsec-csp/issues/7
                if "connect-src 'self';" in policy:
                    protocol = headers.get('X-Forwarded-Proto')
                    host = headers.get('X-Forwarded-Host')
                    if not isinstance(protocol, str) or not isinstance(host, str):
                        raise ValueError('Invalid host or protocol header')

                    websocket_scheme = "wss" if protocol == "https" else "ws"
                    websocket_origin = f"{websocket_scheme}://{host}"
                    policy = policy.replace("connect-src 'self';", f"connect-src {websocket_origin} 'self';")

                out_headers['Content-Security-Policy'] = policy

        except ValueError as exc:
            self.http_error(400, str(exc))

        except KeyError:
            self.http_error(404, 'Not found')

        except OSError as exc:
            self.http_error(500, f'Internal error: {exc!s}')

        else:
            self.send_message(status=200, reason='OK', headers=out_headers)
            threading.Thread(args=(asyncio.get_running_loop(), document.data),
                             target=self.send_document_data,
                             daemon=True).start()

    def send_document_data(self, loop, data):
        # split data into 4K blocks, to not overwhelm the channel
        block_size = 4096
        for i in range(0, len(data), block_size):
            loop.call_soon_threadsafe(self.send_data, data[i:i + block_size])
        loop.call_soon_threadsafe(self.done)
        loop.call_soon_threadsafe(self.close)
