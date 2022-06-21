import logging

from ..channel import Channel

logger = logging.getLogger(__name__)


class FSReadChannel(Channel):
    def do_open(self, options):
        self.ready()
        try:
            logger.debug('Opening file "%s" for reading', options['path'])
            with open(options['path'], 'rb') as filep:
                data = filep.read()
                logger.debug('  ...sending %d bytes', len(data))
                self.send_data(data)
        except FileNotFoundError:
            logger.debug('  ...file not found!')
            pass
        self.done()
        self.close()
