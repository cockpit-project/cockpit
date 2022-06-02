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

import grp
import json
import logging
import os
import pwd
import subprocess

from .channel import Endpoint, Channel

CHANNEL_TYPES = []
logger = logging.getLogger('cockpit.channeltypes')


def internal_dbus_call(path, _iface, method, args):
    if path == '/user':
        if method == 'GetAll':
            user = pwd.getpwuid(os.getuid())
            groups = [gr.gr_name for gr in grp.getgrall() if user.pw_name in gr.gr_mem]
            attrs = {"Name": user.pw_name, "Full": user.pw_gecos, "Id": user.pw_uid,
                     "Home": user.pw_dir, "Shell": user.pw_shell, "Groups": groups}
            return [{k: {"v": v} for k, v in attrs.items()}]

    elif path == '/config':
        if method == 'GetUInt':
            return [args[2]]  # default value

    elif path == '/superuser':
        return []

    elif path == '/packages':
        return []

    elif path == '/LoginMessages':
        return ['{}']

    raise ValueError('unknown call', path, method)


@Endpoint.match(CHANNEL_TYPES, payload='dbus-json3', bus='internal')
class DBusInternalChannel(Channel):
    def do_open(self, options):
        self.ready()

    def do_data(self, data):
        logger.debug('dbus recv %s', data)
        message = json.loads(data)
        if 'add-match' in message:
            pass
        elif 'watch' in message:
            if 'path' in message['watch'] and message['watch']['path'] == '/superuser':
                self.send_message(meta={
                    "cockpit.Superuser": {
                        "methods": {
                            "Start": {
                                "in": ["s"],
                                "out": []
                            },
                            "Stop": {
                                "in": [],
                                "out": []
                            },
                            "Answer": {
                                "in": ["s"],
                                "out": []
                            }
                        },
                        "properties": {
                            "Bridges": {
                                "flags": "r",
                                "type": "as"
                            },
                            "Current": {
                                "flags": "r",
                                "type": "s"
                            }
                        },
                        "signals": {}
                    }
                })
                self.send_message(notify={
                    "/superuser": {
                        "cockpit.Superuser": {
                            "Bridges": ['sudo', 'pkexec'],
                            "Current": "root"
                        }
                    }
                })

            elif 'path' in message['watch'] and message['watch']['path'] == '/machines':
                self.send_message(meta={
                    "cockpit.Machines": {
                        "methods": {
                            "Update": {"in": ["s", "s", "a{sv}"], "out": []}
                        },
                        "properties": {
                            "Machines": {
                                "flags": "r",
                                "type": "a{sa{sv}}"
                            }
                        },
                        "signals": {}
                    }
                })
                self.send_message(notify={"/machines": {"cockpit.Machines": {"Machines": {}}}})

            self.send_message(reply=[], id=message['id'])
        elif 'call' in message:
            reply = internal_dbus_call(*message['call'])
            self.send_message(reply=[reply], id=message['id'])
        else:
            raise ValueError('unknown dbus method', message)


@Endpoint.match(CHANNEL_TYPES, payload='dbus-json3')
class DBusSessionChannel(Channel):
    def do_open(self, options):
        self.ready()

    def do_data(self, data):
        logger.debug('ignored dbus request %s', data)


@Endpoint.match(CHANNEL_TYPES, payload='echo')
class EchoChannel(Channel):
    def do_open(self, options):
        self.ready()

    def do_data(self, data):
        self.send_data(data)


@Endpoint.match(CHANNEL_TYPES, payload='fsread1')
class FsReadChannel(Channel):
    def do_open(self, options):
        self.ready()
        try:
            with open(options['path'], 'rb') as filep:
                self.send_data(filep.read())
        except FileNotFoundError:
            pass
        self.done()


@Endpoint.match(CHANNEL_TYPES, payload='fswatch1')
class FsWatchChannel(Channel):
    def do_open(self, options):
        pass


@Endpoint.match(CHANNEL_TYPES, payload='http-stream1', internal='packages')
class HttpPackagesChannel(Channel):
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
        self.send_message(status=status, reason='ERROR')
        self.send_data(message.encode('utf-8'))

    def do_done(self):
        assert not self.post
        assert self.options['method'] == 'GET'
        path = self.options['path']

        self.headers = self.options['headers']
        self.protocol = self.headers['X-Forwarded-Proto']
        self.host = self.headers['X-Forwarded-Host']
        self.origin = f'{self.protocol}://{self.host}'

        try:
            self.router.packages.serve_file(path, self)
        except FileNotFoundError:
            self.http_error(404, 'Not Found')

        self.done()

    def do_data(self, data):
        self.post += data

    def do_open(self, options):
        self.post = b''
        self.options = options
        self.ready()


@Endpoint.match(CHANNEL_TYPES, payload='metrics1')
class MetricsChannel(Channel):
    def do_open(self, options):
        assert options['source'] == 'internal'
        assert options['interval'] == 3000
        assert 'omit-instances' not in options
        assert options['metrics'] == [
            {"name": "cpu.basic.user", "derive": "rate"},
            {"name": "cpu.basic.system", "derive": "rate"},
            {"name": "cpu.basic.nice", "derive": "rate"},
            {"name": "memory.used"},
        ]


@Endpoint.match(CHANNEL_TYPES, payload='null')
class NullChannel(Channel):
    def do_open(self, options):
        pass


@Endpoint.match(CHANNEL_TYPES, payload='stream')
class StreamChannel(Channel):

    def do_open(self, options):
        self.ready()
        proc = subprocess.run(options['spawn'], capture_output=True, check=False)
        self.send_data(proc.stdout)
        self.done()
