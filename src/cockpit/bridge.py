#!/usr/bin/python3

import pwd
import grp
import glob
import json
import logging
import os
import subprocess
import sys
import traceback

BASE = os.path.realpath(f'{__file__}/../../..')


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


def load_web_resource(path):
    if path == '/manifests.js':
        manifests = {}
        for manifest in glob.glob(f'{BASE}/dist/*/manifest.json'):
            with open(manifest) as filep:
                content = json.load(filep)
            if 'name' in content:
                name = content['name']
                del content['name']
            else:
                name = os.path.basename(os.path.dirname(manifest))
            manifests[name] = content

        return '''
            (function (root, data) {
                if (typeof define === 'function' && define.amd) {
                    define(data);
                }

                if (typeof cockpit === 'object') {
                    cockpit.manifests = data;
                } else {
                    root.manifests = data;
                }
            }(this, ''' + json.dumps(manifests) + '''))'''

    if '*' in path:
        return ''

    with open(f'{BASE}/dist/{path}', 'rb') as filep:
        return filep.read()


class Channel:
    subclasses = {}

    def __new__(cls, _transport, channel, options):
        payload = options['payload']

        if payload not in cls.subclasses:
            for subcls in cls.__subclasses__():
                cls.subclasses[subcls.payload] = subcls

        logging.debug('new Channel %s with id %s', payload, channel)

        return super().__new__(Channel.subclasses[payload])

    def __init__(self, transport, channel, options):
        self.transport = transport
        self.channel = channel
        self.options = options

        self.transport.channels[channel] = self

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
        if self.channel in self.transport.channels:
            self.send_control('close')
            del self.transport.channels[self.channel]

    def send_data(self, message):
        self.transport.send_data(self.channel, message)

    def send_message(self, **kwargs):
        self.transport.send_message(self.channel, **kwargs)

    def send_control(self, command, **kwargs):
        self.transport.send_control(channel=self.channel, command=command, **kwargs)


class FsRead(Channel):
    payload = 'fsread1'

    def do_prepare(self):
        self.ready()
        try:
            with open(self.options['path']) as filep:
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

    def do_done(self):
        assert not self.post
        assert self.options['method'] == 'GET'
        path = self.options['path']

        ext_map = {
            'css': 'text/css',
            'map': 'application/json',
            'js': 'text/javascript',
            'html': 'text/html',
            'woff2': 'application/font-woff2'
        }

        _, _, ext = path.rpartition('.')
        ctype = ext_map[ext]

        try:
            data = load_web_resource(path)
            self.send_message(status=200, reason='OK', headers={'Content-Type': ctype})
            self.send_data(data)
        except FileNotFoundError:
            logging.debug('404 %s', path)
            self.send_message(status=404, reason='Not Found')
            self.send_data('Not found')

        self.done()

    def do_receive(self, data):
        self.post += data

    def do_prepare(self):
        self.post = b''
        self.ready()


class Transport:
    def __init__(self, _input, _output):
        self.input = _input
        self.output = _output
        self.channels = {}

    def send_data(self, channel, payload):
        '''Send a given payload (possibly bytes) on channel'''
        if isinstance(payload, str):
            payload = payload.encode('utf-8')
        message = channel.encode('ascii') + b'\n' + payload
        length = bytes(str(len(message)), 'ascii')
        self.output.write(length + b'\n' + message)
        logging.debug('sent %d bytes on %s', length, channel)
        self.output.flush()

    def send_message(self, _channel, **kwargs):
        '''Format kwargs as a JSON blob and send as a message
           Any kwargs with '_' in their names will be converted to '-'
        '''
        for name in list(kwargs):
            if '-' in name:
                kwargs[name.replace('_', '-')] = kwargs[name]
                del kwargs[name]

        logging.debug('sending message %s %s', _channel, kwargs)
        self.send_data(_channel, json.dumps(kwargs, indent=2) + '\n')

    def send_control(self, **kwargs):
        self.send_message('', **kwargs)

    def recv(self):
        '''Receives a single message and returns the channel and the payload'''
        length_line = self.input.readline()
        # perfectly reasonable to get EOF here
        if not length_line:
            return None
        length = int(length_line)
        message = self.input.read(length)
        channel, _, payload = message.partition(b'\n')
        return channel.decode('ascii'), payload

    def handle_control_message(self, options):
        logging.debug('Received control message %s', options)

        command = options['command']

        if command == 'init':
            pass
        elif command == 'open':
            Channel(self, options['channel'], options)
        else:
            channel = self.channels[options['channel']]
            if command == 'done':
                channel.do_done()
            elif command == 'ready':
                channel.do_ready()
            elif command == 'close':
                channel.close()

    def handle_channel_data(self, channel, data):
        logging.debug('Received %d bytes of data for channel %s', len(data), channel)
        self.channels[channel].do_receive(data)

    def iteration(self):
        packet = self.recv()
        if not packet:
            return False

        channel, data = packet

        if channel:
            self.handle_channel_data(channel, data)
        else:
            self.handle_control_message(json.loads(data))

        return True


def main():
    transport = Transport(sys.stdin.buffer, sys.stdout.buffer)
    logging.debug("Online")

    transport.send_control(command='init',
                           host='me',
                           version=1,
                           packages={"playground": None},
                           os_release={"NAME": "Fedora Linux"},
                           session_id=1)

    while transport.iteration():
        pass


def main_with_logging(output):
    logging.basicConfig(filename=output, level=logging.DEBUG)

    try:
        main()
        logging.debug("quit")
    except Exception:
        logging.debug(traceback.format_exc())
        raise


if __name__ == '__main__':
    main_with_logging('bridge.log')
