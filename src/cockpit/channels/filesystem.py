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

from systemd_ctypes import PathWatch

from ..channel import Channel, ChannelError

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


def tag_from_fd(fd):
    try:
        return tag_from_stat(os.fstat(fd))
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
                            raise ChannelError('too-large')

                    data = filep.read()
            except FileNotFoundError:
                self.close(tag='-')
                return
            except PermissionError:
                raise ChannelError('access-denied')
            except OSError:
                raise ChannelError('internal-error')

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
                raise ChannelError('change-conflict')

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
    _tag = None
    _path = None
    _watch = None

    # The C bridge doesn't send the initial event, and the JS calls read()
    # instead to figure out the initial state of the file.  If we send the
    # initial state then we cause the event to get delivered twice.
    # Ideally we'll sort that out at some point, but for now, suppress it.
    _active = False

    def set_tag(self, tag):
        if tag == self._tag:
            return
        self._tag = tag
        if self._active:
            self.send_message(path=self._path, tag=self._tag)

    def do_inotify_event(self, _mask, _cookie, _name):
        self.set_tag(tag_from_path(self._path))

    def do_identity_changed(self, fd, _err):
        self.set_tag(tag_from_fd(fd) if fd else '-')

    def do_open(self, options):
        self._path = options['path']
        self._tag = None

        self._active = False
        self._watch = PathWatch(self._path, self)
        self._active = True

        self.ready()

    def do_close(self):
        self._watch.close()
        self._watch = None
        self.close()
