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

from ..channel import Channel

logger = logging.getLogger(__name__)


class PackagesChannel(Channel):
    payload = 'http-stream1'
    restrictions = [("internal", "packages")]

    headers = None
    protocol = None
    host = None
    origin = None
    out_headers = None
    options = None
    post = None

    def push_header(self, key, value):
        if self.out_headers is None:
            self.out_headers = {}
        self.out_headers[key] = value

    def http_ok(self, content_type, extra_headers=None):
        headers = {'Content-Type': content_type}
        if self.out_headers is not None:
            headers.update(self.out_headers)
        if extra_headers is not None:
            headers.update(extra_headers)
        self.send_message(status=200, reason='OK', headers={k: v for k, v in headers.items() if v is not None})

    def http_error(self, status, message):
        # with (importlib.resources.file('cockpit.data') / 'data' / 'fail.html').open() ...  (from py3.7)
        fail_path = __file__.removesuffix('/channels/packages.py') + '/data/fail.html'
        template = __loader__.get_data(fail_path)
        self.send_message(status=status, reason='ERROR', headers={'Content-Type': 'text/html; charset=utf-8'})
        self.send_data(template.replace(b'@@message@@', message.encode('utf-8')))

    def do_done(self):
        assert not self.post
        assert self.options['method'] == 'GET'
        path = self.options['path']

        self.headers = self.options['headers']
        self.protocol = self.headers['X-Forwarded-Proto']
        self.host = self.headers['X-Forwarded-Host']
        self.origin = f'{self.protocol}://{self.host}'

        self.router.packages.serve_file(path, self)
        self.done()

    def do_data(self, data):
        self.post += data

    def do_open(self, options):
        self.post = b''
        self.options = options
        self.ready()
