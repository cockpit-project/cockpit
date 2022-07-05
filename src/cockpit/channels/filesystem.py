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


def tag_from_stat(buf):
    return f'1:{buf.st_ino}-{buf.st_mtime}'


def tag_from_path(path):
    try:
        return tag_from_stat(os.stat(path))
    except FileNotFoundError:
        return '-'
    except OSError:
        return None


def tag_from_file(file):
    try:
        return tag_from_stat(os.fstat(file.fileno()))
    except OSError:
        return None


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
            try:
                with open(options['path'], 'rb') as filep:
                    buf = os.stat(filep.fileno())
                    tag = tag_from_stat(buf)
                    if max_read_size := options.get('max_read_size'):
                        if buf.st_size > max_read_size:
                            self.close(problem='too-large')
                            return

                    data = filep.read()
            except FileNotFoundError:
                self.close(tag='-')
                return
            except PermissionError:
                self.close(problem='access-denied')
                return
            except OSError:
                self.close(problem='internal-error')
                return

            if 'binary' not in options:
                data = data.replace(b'\0', b'').decode('utf-8', errors='ignore').encode('utf-8')

            logger.debug('  ...sending %d bytes', len(data))
            self.send_data(data)
        except FileNotFoundError:
            logger.debug('  ...file not found!')
        self.done()
        self.close(tag=tag)


class FsReplaceChannel(Channel):
    payload = 'fsreplace1'

    _path = None
    _tag = None
    _tempfile = None

    def do_open(self, options):
        self._path = options.get('path')
        self._tag = options.get('tag')

    def do_data(self, data):
        if self._tempfile is None:
            dirname, basename = os.path.split(self._path)
            self._tempfile = tempfile.NamedTemporaryFile(dir=dirname, prefix=f'.{basename}-', delete=False)
        self._tempfile.write(data)

    def do_done(self):
        if self._tempfile is None:
            try:
                os.unlink(self._path)
            except FileNotFoundError:
                pass
        else:
            self._tempfile.flush()

            if self._tag and self._tag != tag_from_path(self._path):
                self.close(problem="change-conflict")
                return

            os.rename(self._tempfile.name, self._path)
            self._tempfile.close()
            self._tempfile = None

        self.done()
        self.close(tag=tag_from_path(self._path))

    def do_close(self):
        if self._tempfile is not None:
            self._tempfile.close()
            os.unlink(self._tempfile.name)
            self._tempfile = None


class FsWatchChannel(Channel):
    payload = 'fswatch1'

    def do_open(self, options):
        ...
