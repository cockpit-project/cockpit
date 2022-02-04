#!/usr/bin/python3

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
import collections
import grp
import json
import logging
import os
import packaging.version
import pwd
import socket
import shlex
import subprocess
import sys
import threading


VERSION = packaging.version.Version("300")


class Package:
    def __init__(self, entry):
        self.path = entry.path

        with open(f'{self.path}/manifest.json') as manifest_file:
            self.manifest = json.load(manifest_file)

        if 'name' in self.manifest:
            self.name = self.manifest['name']
        else:
            self.name = entry.name

        self.content_security_policy = None

    def check(self):
        if 'requires' not in self.manifest:
            return True

        requires = self.manifest['requires']
        if any(package != 'cockpit' for package in requires):
            return False

        if 'cockpit' not in requires:
            return True

        return VERSION >= packaging.version.Version(requires['cockpit'])

    def get_content_security_policy(self, origin):
        assert origin.startswith('http')
        origin_ws = origin.replace('http', 'ws', 1)

        # TODO: unit tests depend on the specific order
        policy = collections.OrderedDict({
            "default-src": f"'self' {origin}",
            "connect-src": f"'self' {origin} {origin_ws}",
            "form-action": f"'self' {origin}",
            "base-uri": f"'self' {origin}",
            "object-src": "'none'",
            "font-src": f"'self' {origin} data:",
            "img-src": f"'self' {origin} data:",
        })

        manifest_policy = self.manifest.get('content-security-policy', '')
        for item in manifest_policy.split(';'):
            item = item.strip()
            if item:
                key, _, value = item.strip().partition(' ')
                policy[key] = value

        return ' '.join(f'{k} {v};' for k, v in policy.items()) + ' block-all-mixed-content'

    def serve_file(self, path, channel):
        ext_map = {
            'css': 'text/css',
            'map': 'application/json',
            'js': 'text/javascript',
            'html': 'text/html',
            'woff2': 'application/font-woff2'
        }

        prefix, _, ext = path.rpartition('.')
        content_type = ext_map[ext]

        try:
            languages = channel.headers['Accept-Language'].split(',')
        except KeyError:
            languages = []

        for ling in languages:
            pass

        with open(f'{self.path}/{path}', 'rb') as file:
            headers = {
                "X-Content-Type-Options": "nosniff",
                "X-DNS-Prefetch-Control": "off",
                "Referrer-Policy": "no-referrer",
                "Cross-Origin-Resource-Policy": "same-origin",
                "X-Frame-Options": "sameorigin",
                "Content-Security-Policy": self.get_content_security_policy(channel.origin),
                "Cache-Control": "no-cache, no-store",
                "Access-Control-Allow-Origin": channel.origin,
            }
            channel.http_ok(content_type, headers)
            channel.send_data(file.read())


class Packages:
    def __init__(self):
        self.packages = {}
        self.load_packages()

    def load_packages(self):
        xdg_data_dirs = [
            os.environ.get('XDG_DATA_HOME') or os.path.expanduser('~/.local/share'),
            *os.environ.get('XDG_DATA_DIRS', '/usr/local/share:/usr/share').split(':')
        ]
        for xdg_dir in reversed(xdg_data_dirs):
            try:
                items = os.scandir(f'{xdg_dir}/cockpit')
            except FileNotFoundError:
                continue

            for item in items:
                if item.is_dir():
                    try:
                        package = Package(item)
                    except FileNotFoundError:
                        continue

                    if package.check():
                        self.packages[package.name] = package

    def serve_manifests_js(self, channel):
        channel.http_ok('text/javascript')
        manifests = {name: package.manifest for name, package in self.packages.items()}
        channel.send_data(('''
            (function (root, data) {
                if (typeof define === 'function' && define.amd) {
                    define(data);
                }

                if (typeof cockpit === 'object') {
                    cockpit.manifests = data;
                } else {
                    root.manifests = data;
                }
            }(this, ''' + json.dumps(manifests) + '''))''').encode('ascii'))

    def serve_package_file(self, path, channel):
        package, _, package_path = path[1:].partition('/')
        self.packages[package].serve_file(package_path, channel)

    def serve_file(self, path, channel):
        assert path[0] == '/'

        if path == '/manifests.js':
            self.serve_manifests_js(channel)
        elif '*' in path:
            channel.http_error(404, "Not Found")
        else:
            self.serve_package_file(path, channel)


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


class Channel:
    subclasses = {}

    def __init__(self, router, channel, options):
        self.router = router
        self.channel = channel
        self.options = options

        self.router.channels[channel] = self

        self.do_prepare()

    def do_ready(self):
        pass

    def do_prepare(self):
        self.ready()

    def do_receive(self, data):
        logging.debug('unhandled receive %s', data)
        self.close()

    def done(self):
        self.send_control(command='done')

    def ready(self):
        self.send_control(command='ready')

    def close(self):
        self.router.close_channel(self.channel)

    def send_data(self, message):
        self.router.send_data(self.channel, message)

    def send_message(self, **kwargs):
        self.router.send_message(self.channel, **kwargs)

    def send_control(self, command, **kwargs):
        self.router.send_control(channel=self.channel, command=command, **kwargs)


class FsRead(Channel):
    payload = 'fsread1'

    def do_prepare(self):
        self.ready()
        try:
            with open(self.options['path'], 'rb') as filep:
                self.send_data(filep.read())
        except FileNotFoundError:
            pass
        self.done()


class FsWatch(Channel):
    payload = 'fswatch1'


class Stream(Channel):
    payload = 'stream'

    def do_prepare(self):
        self.ready()
        proc = subprocess.run(self.options['spawn'], capture_output=True, check=False)
        self.send_data(proc.stdout)
        self.done()


class Metrics(Channel):
    payload = 'metrics1'

    def do_prepare(self):
        assert self.options['source'] == 'internal'
        assert self.options['interval'] == 3000
        assert 'omit-instances' not in self.options
        assert self.options['metrics'] == [
            {"name": "cpu.basic.user", "derive": "rate"},
            {"name": "cpu.basic.system", "derive": "rate"},
            {"name": "cpu.basic.nice", "derive": "rate"},
            {"name": "memory.used"},
        ]


class DBus(Channel):
    payload = 'dbus-json3'

    def do_prepare(self):
        self.ready()

    def do_receive(self, data):
        if 'bus' not in self.options or self.options['bus'] != 'internal':
            return

        logging.debug('dbus recv %s', data)
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


class NullChannel(Channel):
    payload = 'null'


class EchoChannel(Channel):
    payload = 'echo'

    def do_prepare(self):
        self.ready()

    def do_receive(self, data):
        self.send_data(data)


class HttpChannel(Channel):
    payload = 'http-stream1'
    headers = None
    protocol = None
    host = None
    origin = None

    def http_ok(self, content_type, headers={}):
        # TODO: unit tests depend on order
        headers['Content-Type'] = content_type
        self.send_message(status=200, reason='OK', headers=headers)

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

    def do_receive(self, data):
        self.post += data

    def do_prepare(self):
        self.post = b''
        self.ready()


class CockpitProtocolError(Exception):
    def __init__(self, message, problem):
        super().__init__(message)
        self.problem = problem


class CockpitProtocol(asyncio.Protocol):
    '''A naive implementation of the Cockpit frame protocol

    We need to use this because Python's SelectorEventLoop doesn't supported
    buffered protocols.
    '''
    def __init__(self):
        self.transport = None
        self.buffer = b''

    def do_ready(self):
        raise NotImplementedError()

    def do_receive(self, channel, data):
        raise NotImplementedError()

    def do_control(self, message):
        raise NotImplementedError()

    def frame_received(self, frame):
        '''Handles a single frame, with the length already removed'''
        channel, _, data = frame.partition(b'\n')
        channel = channel.decode('ascii')

        if channel != '':
            self.do_receive(channel, data)
        else:
            self.do_control(json.loads(data))

    def consume_one_frame(self, view):
        '''Consumes a single frame from view.

        Returns positive if a number of bytes were consumed, or negative if no
        work can be done because of a given number of bytes missing.
        '''

        # Nothing to look at?  Save ourselves the trouble...
        if not view:
            return 0

        view = bytes(view)
        # We know the length + newline is never more than 10 bytes, so just
        # slice that out and deal with it directly.  We don't have .index() on
        # a memoryview, for example.
        # From a performance standpoint, hitting the exception case is going to
        # be very rare: we're going to receive more than the first few bytes of
        # the packet in the regular case.  The more likely situation is where
        # we get "unlucky" and end up splitting the header between two read()s.
        header = bytes(view[:10])
        try:
            newline = header.index(b'\n')
        except ValueError as exc:
            if len(header) < 10:
                # Let's try reading more
                return len(header) - 10
            raise ValueError("size line is too long") from exc
        length = int(header[:newline])
        start = newline + 1
        end = start + length

        if end > len(view):
            # We need to read more
            return len(view) - end

        # We can consume a full frame
        self.frame_received(view[start:end])
        return end

    def connection_made(self, transport):
        logging.debug('connection_made(%s)', transport)
        self.transport = transport
        self.do_ready()

    def connection_lost(self, exc):
        logging.debug('connection_lost')
        self.transport = None

    def send_data(self, channel, payload):
        '''Send a given payload (bytes) on channel (string)'''
        # Channel is certainly ascii (as enforced by .encode() below)
        message_length = len(channel + '\n') + len(payload)
        header = f'{message_length}\n{channel}\n'.encode('ascii')
        logging.debug('writing to transport %s', self.transport)
        self.transport.write(header + payload)

    def send_message(self, _channel, **kwargs):
        '''Format kwargs as a JSON blob and send as a message
           Any kwargs with '_' in their names will be converted to '-'
        '''
        for name in list(kwargs):
            if '_' in name:
                kwargs[name.replace('_', '-')] = kwargs[name]
                del kwargs[name]

        logging.debug('sending message %s %s', _channel, kwargs)
        pretty = json.dumps(kwargs, indent=2) + '\n'
        self.send_data(_channel, pretty.encode('utf-8'))

    def send_control(self, **kwargs):
        self.send_message('', **kwargs)

    def data_received(self, data):
        try:
            self.buffer += data
            while (result := self.consume_one_frame(self.buffer)) > 0:
                self.buffer = self.buffer[result:]
        except CockpitProtocolError as exc:
            self.send_control(command="close", problem=exc.problem, exception=str(exc))
            self.close()

    def eof_received(self):
        self.send_control(command='close')


def parse_os_release():
    with open('/usr/lib/os-release') as os_release:
        fields = dict(line.split('=', 1) for line in os_release)

    # there's no shlex.unquote(), and somewhat reasonably so
    return {k: shlex.split(v)[0] for k, v in fields.items()}


class Router(CockpitProtocol):
    payloads = {}

    def __init__(self):
        super(Router, self).__init__()
        self.os_release = parse_os_release()
        self.packages = Packages()
        self.channels = {}

    def do_ready(self):
        logging.debug('ready')
        self.send_control(command='init', version=1, host='me',
                          packages={p: None for p in self.packages.packages},
                          os_release=parse_os_release(), session_id=1)

    def close_channel(self, channel):
        if channel in self.channels:
            self.send_control(command='close', channel=channel)
            del self.channels[channel]

    def open_channel(self, options):
        try:
            channel = options['channel']
            payload = options['payload']
            host = options['host']
        except KeyError:
            raise CockpitProtocolError('fields missing on open', 'not-supported')

        if host != self.host:
            self.send_control(command='close', channel=channel, problem='not-supported')

        if payload not in Router.payloads:
            Router.payloads = {cls.payload: cls for cls in Channel.__subclasses__()}
        cls = Router.payloads[payload]

        logging.debug('new Channel %s with id %s class %s', payload, channel, cls)
        self.channels[channel] = cls(self, channel, options)

    def init(self, message):
        try:
            version = int(message['version'])
        except KeyError:
            raise CockpitProtocolError('version field is missing', 'protocol-error')
        except ValueError:
            raise CockpitProtocolError('version field is not an int', 'protocol-error')
        if version != 1:
            raise CockpitProtocolError('incorrect version number', 'protocol-error')

        try:
            self.host = message['host']
        except KeyError:
            raise CockpitProtocolError('missing host field', 'protocol-error')

    def do_control(self, message):
        logging.debug('Received control message %s', message)

        command = message['command']

        if command == 'init':
            self.init(message)
        elif command == 'open':
            self.open_channel(message)
        else:
            channel = self.channels[message['channel']]
            if command == 'done':
                channel.do_done()
            elif command == 'ready':
                channel.do_ready()
            elif command == 'close':
                channel.close()

    def do_receive(self, channel, data):
        logging.debug('Received %d bytes of data for channel %s', len(data), channel)
        self.channels[channel].do_receive(data)


class AsyncStdio:
    BLOCK_SIZE = 1024 * 1024

    def __init__(self, loop):
        self.loop = loop
        self.connection_lost = loop.create_future()
        self.protocol_sock, self.stdio_sock = socket.socketpair()

    def forward_stdin(self):
        while buffer := os.read(0, self.BLOCK_SIZE):
            self.stdio_sock.send(buffer)
        self.stdio_sock.shutdown(socket.SHUT_WR)

    def forward_stdout(self):
        while buffer := self.stdio_sock.recv(self.BLOCK_SIZE):
            os.write(1, buffer)
        # no shutdown here, because the process will exit as a result of this:
        self.loop.call_soon_threadsafe(self.connection_lost.set_result, True)

    async def forward(self):
        # it's not clear how to create daemon threads from inside of the
        # asyncio framework, and the threads get blocked on the blocking read
        # operations and refuse to join on exit, so just do this for ourselves,
        # the old-fashioned way.
        threading.Thread(target=self.forward_stdin, daemon=True).start()
        threading.Thread(target=self.forward_stdout, daemon=True).start()
        await self.connection_lost


async def main():
    logging.debug("Hi. How are you today?")

    loop = asyncio.get_event_loop()
    stdio = AsyncStdio(loop)

    logging.debug('Starting the router.')
    await loop.connect_accepted_socket(Router, stdio.protocol_sock)

    logging.debug('Startup done.  Looping until connection closes.')
    await stdio.forward()


if __name__ == '__main__':
    output = 'bridge.log' if not sys.stdout.isatty() else None
    logging.basicConfig(filename=output, level=logging.DEBUG)
    asyncio.run(main(), debug=True)
