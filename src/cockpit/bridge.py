#!/usr/bin/python3

'''cockpit-bridge in python'''

import glob
import json
import logging
import os
import sys
import traceback


class Channel:
    subclasses = {}

    def __new__(self, transport, channel, options):
        payload = options['payload']

        if payload not in Channel.subclasses:
            for cls in Channel.__subclasses__():
                Channel.subclasses[cls.payload] = cls

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
        pass

    def do_receive(self, message):
        pass

    def do_control(self, message):
        pass

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


class DBus(Channel):
    payload = 'dbus-json3'

    def do_prepare(self):
        self.ready()
        self.done()


class NullChannel(Channel):
    payload = 'null'


class EchoChannel(Channel):
    payload = 'echo'

    def do_prepare(self):
        self.ready()

    def do_receive(self, message):
        self.send_data(message)

    def do_control(self, command, **options):
        if command == 'done':
            self.control(command, **options)


class HttpChannel(Channel):
    payload = 'http-stream1'

    def do_manifests(self):
        self.send_message(status=200, reason='OK',
                          headers={'Content-Type': 'application/javascript'})

        self.send_data('''
            (function (root, data) {
                if (typeof define === 'function' && define.amd) {
                    define(data);
                }

                if(typeof cockpit === 'object') {
                    cockpit.manifests = data;
                } else {
                    root.manifests = data;
                }
            }(this,
        ''')

        manifests = {}
        for manifest in glob.glob('/home/lis/cp/*/manifest.json'):
            with open(manifest) as fp:
                content = json.load(fp)
                if 'name' in content:
                    name = content['name']
                    del content['name']
                else:
                    name = os.path.basename(os.path.dirname(manifest))
                manifests[name] = content

        self.send_data(json.dumps(manifests))
        self.send_data('))')

    def do_done(self):
        assert not self.post
        assert self.options['method'] == 'GET'

        path = self.options['path']

        if path == '/manifests.js':
            self.do_manifests()
        elif '*' in path:
            self.send_message(status=404, reason='ERROR')
        else:
            with open(f'/var/home/lis/cp/{path}', 'rb') as fp:
                content = fp.read()

            if path.endswith('.css'):
                ctype = 'text/css'
            elif path.endswith('.js'):
                ctype = 'text/javascript'
            elif path.endswith('.html'):
                ctype = 'text/html'
            else:
                ctype = 'text/plain'
            self.send_message(status=200, reason='OK',
                              headers={'Content-Type': ctype})
            self.send_data(content)

        self.done()

    def do_receive(self, message):
        self.post += message

    def do_prepare(self):
        self.post = b''
        self.ready()


class Transport:
    '''CockpitTransport'''
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
        logging.debug(f'sent {length} bytes on {channel}')
        self.output.flush()

    def send_message(self, _channel, **kwargs):
        '''Format kwargs as a JSON blob and send as a message
           Any kwargs with '_' in their names will be converted to '-'
        '''
        for name in list(kwargs):
            if '-' in name:
                kwargs[name.replace('_', '-')] = kwargs[name]
                del kwargs[name]

        logging.debug(f'sending control {kwargs}')
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
                channel.close(options)

    def handle_channel_data(self, channel, data):
        logging.debug('Received %d bytes of data for channel %s', len(data), channel)
        self.channels[channel].do_receive(data)

    def iteration(self):
        if packet := self.recv():
            channel, data = packet

            if channel:
                self.handle_channel_data(channel, data)
            else:
                self.handle_control_message(json.loads(data))

            return True


def main():
    '''main'''

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


def do_init(transport, message):
    pass


def do_ready(transport, message):
    pass


def do_done(transport, message):
    pass


logging.basicConfig(filename='bridge.log', encoding='utf-8', level=logging.DEBUG)

try:
    main()
except Exception:
    trace = traceback.format_exc()
    logging.debug(trace)
    raise
