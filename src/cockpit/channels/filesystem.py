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
import random

from typing import Dict

from systemd_ctypes import PathWatch
from systemd_ctypes.inotify import Event as InotifyEvent

from ..channel import Channel, ChannelError, GeneratorChannel

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
        watch = options.get('watch', True)

        if watch:
            raise ChannelError('not-supported', message='watching is not implemented, use fswatch1')

        try:
            scan_dir = os.scandir(path)
        except OSError as error:
            if isinstance(error, FileNotFoundError):
                problem = 'not-found'
            elif isinstance(error, PermissionError):
                problem = 'access-denied'
            else:
                problem = 'internal-error'
            raise ChannelError(problem, message=str(error)) from error
        for entry in scan_dir:
            self.send_entry("present", entry)

        if not watch:
            self.done()
            self.close()


class FsReadChannel(GeneratorChannel):
    payload = 'fsread1'

    def do_yield_data(self, options: Dict[str, object]) -> GeneratorChannel.DataGenerator:
        binary = options.get('binary', False)
        max_read_size = options.get('max_read_size')
        # TODO: generic JSON validation
        if max_read_size is not None and not isinstance(max_read_size, int):
            raise ChannelError('protocol-error', message='max_read_size must be an integer')
        if not isinstance(options['path'], str):
            raise ChannelError('protocol-error', message='path is not a string')

        logger.debug('Opening file "%s" for reading', options['path'])

        try:
            with open(options['path'], 'rb') as filep:
                buf = os.stat(filep.fileno())
                if max_read_size is not None and buf.st_size > max_read_size:
                    raise ChannelError('too-large')

                while True:
                    data = filep.read1(Channel.BLOCK_SIZE)
                    if data == b'':
                        break
                    logger.debug('  ...sending %d bytes', len(data))
                    if not binary:
                        data = data.replace(b'\0', b'').decode('utf-8', errors='ignore').encode('utf-8')
                    yield data

            return {'tag': tag_from_stat(buf)}

        except FileNotFoundError:
            return {'tag': '-'}
        except PermissionError:
            raise ChannelError('access-denied')
        except OSError as error:
            raise ChannelError('internal-error', message=str(error)) from error


class FsReplaceChannel(Channel):
    payload = 'fsreplace1'

    _path = None
    _tag = None
    _tempfile = None
    _temppath = None

    def unlink_temppath(self):
        try:
            os.unlink(self._temppath)
        except OSError:
            pass  # might have been removed from outside

    def do_open(self, options):
        self._path = options.get('path')
        self._tag = options.get('tag')

    def do_data(self, data):
        if self._tempfile is None:
            # keep this bounded, in case anything unexpected goes wrong
            for i in range(10):
                suffix = ''.join(random.choices("abcdefghijklmnopqrstuvwxyz0123456789_", k=6))
                self._temppath = f'{self._path}.cockpit-tmp.{suffix}'
                try:
                    fd = os.open(self._temppath, os.O_CREAT | os.O_WRONLY | os.O_EXCL, 0o666)
                    break
                except FileExistsError:
                    continue
                except PermissionError:
                    raise ChannelError('access-denied')
                except OSError as ex:
                    raise ChannelError('internal-error', message=str(ex))
            else:
                raise ChannelError('internal-error', message=f"Could not find unique file name for replacing {self._path}")

            try:
                self._tempfile = os.fdopen(fd, 'wb')
            except OSError:
                # Should Not Happen™, but let's be safe and avoid fd leak
                os.close(fd)
                self.unlink_temppath()
                raise

        self._tempfile.write(data)

    def do_done(self):
        if self._tempfile is None:
            try:
                os.unlink(self._path)
            # crash on other errors, as they are unexpected
            except FileNotFoundError:
                pass
        else:
            self._tempfile.flush()

            if self._tag and self._tag != tag_from_path(self._path):
                raise ChannelError('change-conflict')

            try:
                os.rename(self._temppath, self._path)
            except OSError:
                # ensure to not leave the temp file behind
                self.unlink_temppath()
                raise
            self._tempfile.close()
            self._tempfile = None

        self.done()
        self.close(tag=tag_from_path(self._path))

    def do_close(self):
        if self._tempfile is not None:
            self._tempfile.close()
            self.unlink_temppath()
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

    @staticmethod
    def mask_to_event_and_type(mask):
        if (InotifyEvent.CREATE or InotifyEvent.MOVED_TO) in mask:
            return 'created', 'directory' if InotifyEvent.ISDIR in mask else 'file'
        elif InotifyEvent.MOVED_FROM in mask or InotifyEvent.DELETE in mask or InotifyEvent.DELETE_SELF in mask:
            return 'deleted', None
        elif InotifyEvent.ATTRIB in mask:
            return 'attribute-changed', None
        elif InotifyEvent.CLOSE_WRITE in mask:
            return 'done-hint', None
        else:
            return 'changed', None

    def do_inotify_event(self, mask, _cookie, name):
        logger.debug("do_inotify_event(%s): mask %X name %s", self._path, mask, name)
        event, type_ = self.mask_to_event_and_type(mask)
        if name:
            # file inside watched directory changed
            path = os.path.join(self._path, name.decode())
            tag = tag_from_path(path)
            self.send_message(event=event, path=path, tag=tag, type=type_)
        else:
            # the watched path itself changed; filter out duplicate events
            tag = tag_from_path(self._path)
            if tag == self._tag:
                return
            self._tag = tag
            self.send_message(event=event, path=self._path, tag=self._tag, type=type_)

    def do_identity_changed(self, fd, err):
        logger.debug("do_identity_changed(%s): fd %s, err %s", self._path, str(fd), err)
        self._tag = tag_from_fd(fd) if fd else '-'
        if self._active:
            self.send_message(event='created' if fd else 'deleted', path=self._path, tag=self._tag)

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
