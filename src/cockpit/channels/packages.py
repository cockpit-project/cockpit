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
from typing import Optional

from ..channel import AsyncChannel
from ..data import read_cockpit_data_file
from ..jsonutil import JsonObject, get_dict, get_str
from ..packages import Packages

logger = logging.getLogger(__name__)


class PackagesChannel(AsyncChannel):
    payload = 'http-stream1'
    restrictions = [("internal", "packages")]

    # used to carry data forward from open to done
    options: Optional[JsonObject] = None

    def http_error(self, status: int, message: str) -> None:
        template = read_cockpit_data_file('fail.html')
        self.send_json(status=status, reason='ERROR', headers={'Content-Type': 'text/html; charset=utf-8'})
        self.send_data(template.replace(b'@@message@@', message.encode('utf-8')))
        self.done()
        self.close()

    async def run(self, options: JsonObject) -> None:
        packages: Packages = self.router.packages  # type: ignore[attr-defined]  # yes, this is evil

        try:
            if get_str(options, 'method') != 'GET':
                raise ValueError(f'Unsupported HTTP method {options["method"]}')

            self.ready()
            if await self.read() != b'':
                raise ValueError('Received unexpected data')

            path = get_str(options, 'path')
            headers = get_dict(options, 'headers')
            document = packages.load_path(path, headers)

            # Note: we can't cache documents right now.  See
            # https://github.com/cockpit-project/cockpit/issues/19071
            # for future plans.
            out_headers: JsonObject = {
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
            self.send_json(status=200, reason='OK', headers=out_headers)
            await self.sendfile(document.data)
