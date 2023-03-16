import asyncio
import os
import sys

from cockpit.transports import StdioTransport
from cockpit.protocol import CockpitProtocolServer


class MockPeer(CockpitProtocolServer):
    def do_send_init(self):
        init_type = os.environ.get('INIT_TYPE', None)
        if init_type == 'wrong-command':
            self.write_control(command='xnit', version=1)
        elif init_type == 'wrong-version':
            self.write_control(command='init', version=2)
        elif init_type == 'channel-control':
            self.write_control(command='init', channel='x')
        elif init_type == 'data':
            self.write_channel_data('x', b'123')
        elif init_type == 'break-protocol':
            print('i like printf debugging', flush=True)
        elif init_type == 'exit':
            sys.exit()
        elif init_type != 'silence':
            self.write_control(command='init', version=1)

    def channel_control_received(self, channel, command, message):
        if command == 'open':
            self.write_control(command='ready', channel=channel)

    def channel_data_received(self, channel, data):
        pass


async def run():
    protocol = MockPeer()
    StdioTransport(asyncio.get_running_loop(), protocol)
    await protocol.communicate()


if __name__ == '__main__':
    asyncio.run(run())
