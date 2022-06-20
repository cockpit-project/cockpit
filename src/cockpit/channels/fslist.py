import logging
import os

from ..channel import Channel

logger = logging.getLogger(__name__)


class FSListChannel(Channel):
    def send_entry(self, event, entry):
        if entry.is_symlink():
            mode = 'link'
        elif entry.is_file():
            mode = 'file'
        elif entry.is_dir():
            mode = 'directory'
        else:
            mode = 'special'

        self.send_message(event=event, path=entry.name, type=mode)

    def do_open(self, options):
        path = options.get('path')
        watch = options.get('watch')

        for entry in os.scandir(path):
            self.send_entry("present", entry)

        if not watch:
            self.done()
            self.close()
