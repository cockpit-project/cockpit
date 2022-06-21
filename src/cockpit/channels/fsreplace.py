import logging
import os
import tempfile

from ..channel import Channel

logger = logging.getLogger(__name__)


class FSReplaceChannel(Channel):
    tempfile = None
    path = None

    def do_open(self, options):
        self.path = options.get('path')
        dirname, basename = os.path.split(self.path)
        self.tempfile = tempfile.NamedTemporaryFile(dir=dirname, prefix=f'.{basename}-', delete=False)

    def do_data(self, data):
        self.tempfile.write(data)

    def do_done(self):
        self.tempfile.flush()
        os.rename(self.tempfile.name, self.path)
        self.tempfile.close()
        self.tempfile = None
        self.done()
        self.close()

    def do_close(self):
        if self.tempfile is not None:
            self.tempfile.close()
            os.unlink(self.tempfile.name)
            self.tempfile = None
