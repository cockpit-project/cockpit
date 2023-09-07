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

import errno
import grp
import json
import logging
import os
import pwd
import random
import stat
from typing import Callable, ClassVar, Dict, Optional, Sequence, Union

from cockpit._vendor.systemd_ctypes import Handle, PathWatch
from cockpit._vendor.systemd_ctypes.inotify import Event as InotifyEvent
from cockpit._vendor.systemd_ctypes.pathwatch import Listener as PathListener

from ..channel import Channel, ChannelError, GeneratorChannel
from ..jsonutil import JsonDocument, JsonObject, get_bool, get_int, get_str, get_strv

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


class AttributeReporter:
    uid_cache: Dict[int, Union[str, int]]
    gid_cache: Dict[int, Union[str, int]]
    report_target: bool
    getters: Dict[str, Callable[[os.stat_result], JsonDocument]]

    def do_get_tag(self, buf: os.stat_result) -> str:
        return tag_from_stat(buf)

    def do_get_type(self, buf: os.stat_result) -> str:
        if stat.S_ISDIR(buf.st_mode):
            return 'directory'
        elif stat.S_ISREG(buf.st_mode):
            return 'file'
        elif stat.S_ISLNK(buf.st_mode):
            return 'link'
        else:
            return 'special'

    def do_get_mode(self, buf: os.stat_result) -> int:
        return buf.st_mode & 0o777

    def do_get_owner(self, buf: os.stat_result) -> Union[int, str]:
        if buf.st_uid not in self.uid_cache:
            try:
                self.uid_cache[buf.st_uid] = pwd.getpwuid(buf.st_uid).pw_name
            except KeyError:
                self.uid_cache[buf.st_uid] = buf.st_uid
        return self.uid_cache[buf.st_uid]

    def do_get_group(self, buf: os.stat_result) -> Union[int, str]:
        if buf.st_gid not in self.gid_cache:
            try:
                self.gid_cache[buf.st_gid] = grp.getgrgid(buf.st_gid).gr_name
            except KeyError:
                self.gid_cache[buf.st_gid] = buf.st_gid
        return self.gid_cache[buf.st_gid]

    def do_get_size(self, buf: os.stat_result) -> int:
        return buf.st_size

    def do_get_modified(self, buf: os.stat_result) -> float:
        return buf.st_mtime

    def report(self, path: str, dir_fd: int = -1) -> JsonObject:
        buf = os.lstat(path, dir_fd=dir_fd)
        attrs = {attr: getter(buf) for attr, getter in self.getters.items()}
        if self.report_target and stat.S_ISLNK(buf.st_mode):
            try:
                attrs['target'] = os.readlink(path, dir_fd=dir_fd)
            except OSError:
                pass  # no need to impede reporting the other attributes...
        return attrs

    def __init__(self, attrs: Sequence[str]) -> None:
        self.uid_cache = {}
        self.gid_cache = {}
        # 'target' gets handled specially (since it's not in the stat data)
        self.report_target = 'target' in attrs
        self.getters = {attr: getattr(self, f'do_get_{attr}') for attr in attrs if attr != 'target'}


class WatchAndListCommon(Channel, PathListener):
    attrs: ClassVar[Sequence[str]] = ()
    children: ClassVar[bool]

    reporter: AttributeReporter
    watch: Optional[PathWatch] = None
    fd: Optional[Handle] = None
    exists: Optional[bool] = None
    path: str

    def event(self, event: str, name: str) -> None:
        attrs: JsonObject = {'event': event, 'path': name}

        if event != 'deleted':
            assert self.fd is not None

            try:
                attrs.update(self.reporter.report(name, dir_fd=self.fd))
            except FileNotFoundError:
                return  # we'll get the delete event delivered to us soon...
            except OSError:
                pass  # we're just not going to report attributes in that case
        else:
            attrs['deleted'] = True

        logger.debug('%s %s', self.channel, attrs)
        self.send_text(json.dumps(attrs) + '\n')

    def do_close(self, error: Optional[int] = None) -> None:
        if self.watch is not None:
            self.watch.close()

        if error is None:
            self.close()
        elif error == errno.ENOENT:
            self.close(problem='not-found', message=os.strerror(error))
        elif error in (errno.EPERM, errno.EACCES):
            self.close(problem='access-denied', message=os.strerror(error))
        else:
            self.close(problem='internal-error', message=os.strerror(error))

    def do_inotify_event(self, mask: InotifyEvent, _cookie: int, name: Optional[bytes]) -> None:
        # If self.children is True, return if name is None
        # If self.children is False, return if name is non-None
        if self.children == (name is None):
            return

        if mask & (InotifyEvent.MOVED_FROM | InotifyEvent.DELETE):
            event = 'deleted'
        elif mask & (InotifyEvent.MOVED_TO | InotifyEvent.CREATE):
            event = 'created'
        elif mask & InotifyEvent.ATTRIB:
            event = 'attribute-changed'
        elif mask & InotifyEvent.CLOSE_WRITE:
            event = 'done-hint'
        else:
            event = 'changed'

        self.event(event, name.decode('utf-8') if name is not None else self.path)

    def do_identity_changed(self, fd: Optional[Handle], err: Optional[int]) -> None:
        self.fd = fd

        if self.children and err is not None:
            self.do_close(err)
        elif (self.fd is not None) != self.exists:
            if self.exists is not None:
                self.event('deleted' if fd is None else 'created', self.path)
            self.exists = self.fd is not None

    def do_open(self, options: JsonObject) -> None:
        self.path = get_str(options, 'path')

        if not self.path.startswith('/'):
            raise ChannelError('not-supported', message='Only absolute paths allowed')

        try:
            self.reporter = AttributeReporter(get_strv(options, 'attrs', self.attrs))
        except AttributeError as exc:
            raise ChannelError('not-supported', message=str(exc)) from exc

        try:
            if get_bool(options, 'watch', default=True):
                self.watch = PathWatch(self.path, self)
                if self.is_closing():
                    return
            else:
                self.fd = Handle.open(self.path, os.O_PATH)

            if self.children:
                assert self.fd is not None
                names = os.listdir(f'/proc/self/fd/{self.fd}')
            elif self.fd is not None:
                names = [self.path]
            else:
                names = []

        except OSError as exc:
            self.do_close(exc.errno)

        else:
            self.ready()

            for name in names:
                self.event('present', name)

            if self.watch:
                # make sure the user knows when the initial data is done
                self.event('done', self.path)

            else:
                # otherwise, we're done here...
                self.done()
                self.close()


class FsListChannel(WatchAndListCommon):
    attrs = ('type',)
    payload = 'fslist1'
    children = True


class FsWatchChannel(WatchAndListCommon):
    attrs = ('tag',)
    payload = 'fswatch1'
    children = False


class FsReadChannel(GeneratorChannel):
    payload = 'fsread1'

    def do_yield_data(self, options: JsonObject) -> GeneratorChannel.DataGenerator:
        path = get_str(options, 'path')
        binary = get_str(options, 'binary', None)
        max_read_size = get_int(options, 'max_read_size', None)

        logger.debug('Opening file "%s" for reading', path)

        try:
            with open(path, 'rb') as filep:
                buf = os.stat(filep.fileno())
                if max_read_size is not None and buf.st_size > max_read_size:
                    raise ChannelError('too-large')

                self.ready()

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
        except PermissionError as exc:
            raise ChannelError('access-denied') from exc
        except OSError as exc:
            raise ChannelError('internal-error', message=str(exc)) from exc


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
        self._path = get_str(options, 'path')
        self._tag = get_str(options, 'tag', None)
        self.ready()

    def do_data(self, data):
        if self._tempfile is None:
            # keep this bounded, in case anything unexpected goes wrong
            for _ in range(10):
                suffix = ''.join(random.choices("abcdefghijklmnopqrstuvwxyz0123456789_", k=6))
                self._temppath = f'{self._path}.cockpit-tmp.{suffix}'
                try:
                    fd = os.open(self._temppath, os.O_CREAT | os.O_WRONLY | os.O_EXCL, 0o666)
                    break
                except FileExistsError:
                    continue
                except PermissionError as exc:
                    raise ChannelError('access-denied') from exc
                except OSError as exc:
                    raise ChannelError('internal-error', message=str(exc)) from exc
            else:
                raise ChannelError('internal-error',
                                   message=f"Could not find unique file name for replacing {self._path}")

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
