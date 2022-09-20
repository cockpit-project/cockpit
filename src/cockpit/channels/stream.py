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
import os

from ..channel import AsyncChannel, ChannelError

logger = logging.getLogger(__name__)


class StreamChannel(AsyncChannel):
    payload = 'stream'

    async def send_reader(self, reader):
        while True:
            logger.debug('waiting to read from process')
            data = await reader.read(AsyncChannel.CHANNEL_FLOW_WINDOW)
            logger.debug('read data from process (%d byteS)', len(data))
            if not data:
                break
            logger.debug('waiting to write to channel')
            await self.write(data)
            logger.debug('write to channel complete')

        logger.debug('EOF from process.  closing channel.')
        self.done()

    async def receive_writer(self, writer):
        while True:
            logger.debug('waiting to read from channel')
            data = await self.read()
            logger.debug('read data from channel: %s', data)
            if not data:
                break
            logger.debug('waiting to write to stdin')
            writer.write(data)
            await writer.drain()
            logger.debug('write to stdin complete')

        logger.debug('EOF from channel.  closing stdin.')
        writer.close()
        await writer.wait_closed()

    async def stream_socket(self, path):
        reader, writer = await asyncio.open_unix_connection(path)
        await asyncio.gather(self.send_reader(reader), self.receive_writer(writer))

    async def wait_for_exit(self, process):
        await self.send_reader(process.stdout)

        # read concurrently?
        if process.stderr is not None:
            message = await process.stderr.read()
            message = message.decode()
        else:
            message = None

        exit_status = await process.wait()

        logger.debug('Process exited.')
        self.close(exit_status=exit_status, message=message)
        logger.debug('Close message sent.')

    async def stream_process(self, args, options):
        err = options.get('err')
        cwd = options.get('directory')
        stderr = None
        if err == 'out':
            stderr = asyncio.subprocess.STDOUT
        elif err == 'ignore':
            stderr = asyncio.subprocess.DEVNULL
        elif err == 'message' or err is None:
            stderr = asyncio.subprocess.PIPE
        else:
            stderr = None

        env = dict(os.environ)
        env.update(options.get('env') or [])

        logger.debug('Spawning process args=%s', args)
        try:
            process = await asyncio.create_subprocess_exec(
                *args,
                cwd=cwd,
                env=env,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=stderr)
        except FileNotFoundError as error:
            raise ChannelError('not-found') from error
        except PermissionError as error:
            raise ChannelError('access-denied') from error
        except OSError as error:
            logger.info("Failed to spawn %s: %s", args, str(error))
            raise ChannelError('internal-error') from error

        logger.debug('starting forwarding')
        await asyncio.gather(self.receive_writer(process.stdin),
                             self.wait_for_exit(process))

    async def run(self, options):
        # ignored: 'batch', 'latency'
        if unix := options.get('unix'):
            await self.stream_socket(unix)

        elif spawn := options.get('spawn'):
            await self.stream_process(spawn, options)

        else:
            logger.error('stream channel created without "unix" or "spawn": %s', options)
