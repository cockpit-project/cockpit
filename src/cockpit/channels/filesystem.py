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
import os
import tempfile

from ..channel import Channel

logger = logging.getLogger(__name__)


class FsListChannel(Channel):
    payload = 'fslist1'

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


class FsReadChannel(Channel):
    payload = 'fsread1'

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
        self.done()
        self.close()


class FsReplaceChannel(Channel):
    payload = 'fsreplace1'

    _tempfile = None
    _path = None

    def do_open(self, options):
        self._path = options.get('path')
        dirname, basename = os.path.split(self._path)
        self._tempfile = tempfile.NamedTemporaryFile(dir=dirname, prefix=f'.{basename}-', delete=False)

    def do_data(self, data):
        self._tempfile.write(data)

    def do_done(self):
        self._tempfile.flush()
        os.rename(self._tempfile.name, self._path)
        self._tempfile.close()
        self._tempfile = None
        self.done()
        self.close()

    def do_close(self):
        if self._tempfile is not None:
            self._tempfile.close()
            os.unlink(self._tempfile.name)
            self._tempfile = None


class FsWatchChannel(Channel):
    payload = 'fswatch1'

    def do_open(self, options):
        ...
