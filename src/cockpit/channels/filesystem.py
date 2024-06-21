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
import contextlib
import enum
import errno
import fnmatch
import functools
import grp
import logging
import os
import pwd
import re
import stat
import tempfile
from pathlib import Path
from typing import Callable, Generator, Iterable

from cockpit._vendor.systemd_ctypes import Handle, PathWatch
from cockpit._vendor.systemd_ctypes.inotify import Event as InotifyEvent
from cockpit._vendor.systemd_ctypes.pathwatch import Listener as PathWatchListener

from ..channel import AsyncChannel, Channel, ChannelError, GeneratorChannel
from ..jsonutil import (
    JsonDict,
    JsonDocument,
    JsonError,
    JsonObject,
    get_bool,
    get_enum,
    get_int,
    get_str,
    get_strv,
    json_merge_and_filter_patch,
)

logger = logging.getLogger(__name__)


@functools.lru_cache()
def my_umask() -> int:
    match = re.search(r'^Umask:\s*0([0-7]*)$', Path('/proc/self/status').read_text(), re.M)
    return (match and int(match.group(1), 8)) or 0o077


def tag_from_stat(buf):
    return f'1:{buf.st_ino}-{buf.st_mtime}-{buf.st_mode:o}-{buf.st_uid}-{buf.st_gid}'


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

        self.send_json(event=event, path=entry.name, type=mode)

    def do_open(self, options):
        path = options.get('path')
        watch = options.get('watch', True)

        if watch:
            raise ChannelError('not-supported', message='watching is not implemented, use fswatch1')

        try:
            scan_dir = os.scandir(path)
        except FileNotFoundError as error:
            raise ChannelError('not-found', message=str(error)) from error
        except PermissionError as error:
            raise ChannelError('access-denied', message=str(error)) from error
        except OSError as error:
            raise ChannelError('internal-error', message=str(error)) from error

        self.ready()
        for entry in scan_dir:
            self.send_entry("present", entry)

        if not watch:
            self.done()
            self.close()


class FsReadChannel(GeneratorChannel):
    payload = 'fsread1'

    def do_yield_data(self, options: JsonObject) -> Generator[bytes, None, JsonObject]:
        path = get_str(options, 'path')
        binary = get_enum(options, 'binary', ['raw'], None) is not None
        max_read_size = get_int(options, 'max_read_size', None)

        logger.debug('Opening file "%s" for reading', path)

        try:
            with open(path, 'rb') as filep:
                buf = os.stat(filep.fileno())
                if max_read_size is not None and buf.st_size > max_read_size:
                    raise ChannelError('too-large')

                if binary and stat.S_ISREG(buf.st_mode):
                    self.ready(size_hint=buf.st_size)
                else:
                    self.ready()

                while True:
                    data = filep.read1(Channel.BLOCK_SIZE)
                    if data == b'':
                        break
                    logger.debug('  ...sending %d bytes', len(data))
                    if not binary:
                        data = data.replace(b'\0', b'').decode(errors='ignore').encode()
                    yield data

            return {'tag': tag_from_stat(buf)}

        except FileNotFoundError:
            return {'tag': '-'}
        except PermissionError as exc:
            raise ChannelError('access-denied') from exc
        except OSError as exc:
            raise ChannelError('internal-error', message=str(exc)) from exc


class FsReplaceChannel(AsyncChannel):
    payload = 'fsreplace1'

    def delete(self, path: str, tag: 'str | None') -> str:
        if tag is not None and tag != tag_from_path(path):
            raise ChannelError('change-conflict')
        with contextlib.suppress(FileNotFoundError):  # delete is idempotent
            os.unlink(path)
        return '-'

    async def set_contents(self, path: str, tag: 'str | None', data: 'bytes | None', size: 'int | None') -> str:
        dirname, basename = os.path.split(path)
        tmpname: str | None
        fd, tmpname = tempfile.mkstemp(dir=dirname, prefix=f'.{basename}-')
        try:
            if size is not None:
                logger.debug('fallocate(%s.tmp, %d)', path, size)
                if size:  # posix_fallocate() of 0 bytes is EINVAL
                    await self.in_thread(os.posix_fallocate, fd, 0, size)
                self.ready()  # ...only after that worked

            written = 0
            while data is not None:
                await self.in_thread(os.write, fd, data)
                written += len(data)
                data = await self.read()

            if size is not None and written < size:
                logger.debug('ftruncate(%s.tmp, %d)', path, written)
                await self.in_thread(os.ftruncate, fd, written)

            await self.in_thread(os.fdatasync, fd)

            if tag is None:
                # no preconditions about what currently exists or not
                # calculate the file mode from the umask
                os.fchmod(fd, 0o666 & ~my_umask())
                os.rename(tmpname, path)
                tmpname = None

            elif tag == '-':
                # the file must not exist.  file mode from umask.
                os.fchmod(fd, 0o666 & ~my_umask())
                os.link(tmpname, path)  # will fail if file exists

            else:
                # the file must exist with the given tag
                buf = os.stat(path)
                if tag != tag_from_stat(buf):
                    raise ChannelError('change-conflict')
                # chown/chmod from the existing file permissions
                os.fchmod(fd, stat.S_IMODE(buf.st_mode))
                os.fchown(fd, buf.st_uid, buf.st_gid)
                os.rename(tmpname, path)
                tmpname = None

        finally:
            os.close(fd)
            if tmpname is not None:
                os.unlink(tmpname)

        return tag_from_path(path)

    async def run(self, options: JsonObject) -> JsonObject:
        path = get_str(options, 'path')
        size = get_int(options, 'size', None)
        tag = get_str(options, 'tag', None)

        try:
            # In the `size` case, .set_contents() sends the ready only after
            # it knows that the allocate was successful.  In the case without
            # `size`, we need to send the ready() up front in order to
            # receive the first frame and decide if we're creating or deleting.
            if size is not None:
                tag = await self.set_contents(path, tag, b'', size)
            else:
                self.ready()
                data = await self.read()
                # if we get EOF right away, that's a request to delete
                if data is None:
                    tag = self.delete(path, tag)
                else:
                    tag = await self.set_contents(path, tag, data, None)

            self.done()
            return {'tag': tag}

        except FileNotFoundError as exc:
            raise ChannelError('not-found') from exc
        except FileExistsError as exc:
            # that's from link() noticing that the target file already exists
            raise ChannelError('change-conflict') from exc
        except PermissionError as exc:
            raise ChannelError('access-denied') from exc
        except IsADirectoryError as exc:
            # not ideal, but the closest code we have
            raise ChannelError('access-denied', message=str(exc)) from exc
        except OSError as exc:
            raise ChannelError('internal-error', message=str(exc)) from exc


class FsWatchChannel(Channel, PathWatchListener):
    payload = 'fswatch1'
    _tag = None
    _watch = None

    # The C bridge doesn't send the initial event, and the JS calls read()
    # instead to figure out the initial state of the file.  If we send the
    # initial state then we cause the event to get delivered twice.
    # Ideally we'll sort that out at some point, but for now, suppress it.
    _active = False

    @staticmethod
    def mask_to_event_and_type(mask: InotifyEvent) -> 'tuple[str, str | None]':
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

    def do_inotify_event(self, mask: InotifyEvent, _cookie: int, name: 'bytes | None') -> None:
        logger.debug("do_inotify_event(%s): mask %X name %s", self._path, mask, name)
        event, type_ = self.mask_to_event_and_type(mask)
        if name:
            # file inside watched directory changed
            path = os.path.join(self._path, name.decode())
            tag = tag_from_path(path)
            self.send_json(event=event, path=path, tag=tag, type=type_)
        else:
            # the watched path itself changed; filter out duplicate events
            tag = tag_from_path(self._path)
            if tag == self._tag:
                return
            self._tag = tag
            self.send_json(event=event, path=self._path, tag=self._tag, type=type_)

    def do_identity_changed(self, fd: 'int | None', err: 'int | None') -> None:
        logger.debug("do_identity_changed(%s): fd %s, err %s", self._path, str(fd), err)
        self._tag = tag_from_fd(fd) if fd else '-'
        if self._active:
            self.send_json(event='created' if fd else 'deleted', path=self._path, tag=self._tag)

    def do_open(self, options: JsonObject) -> None:
        self._path = get_str(options, 'path')
        self._tag = None

        self._active = False
        self._watch = PathWatch(self._path, self)
        self._active = True

        self.ready()

    def do_close(self) -> None:
        if self._watch is not None:
            self._watch.close()
            self._watch = None
        self.close()


class Follow(enum.Enum):
    NO = False
    YES = True


class FsInfoChannel(Channel, PathWatchListener):
    payload = 'fsinfo'

    # Options (all get set in `do_open()`)
    path: str
    attrs: 'set[str]'
    fnmatch: str
    targets: bool
    follow: bool
    watch: bool

    # State
    current_value: JsonDict
    effective_fnmatch: str = ''
    fd: 'Handle | None' = None
    pending: 'set[str] | None' = None
    path_watch: 'PathWatch | None' = None
    getattrs: 'Callable[[int, str, Follow], JsonDocument]'

    @staticmethod
    def make_getattrs(attrs: Iterable[str]) -> 'Callable[[int, str, Follow], JsonDocument | None]':
        # Cached for the duration of the closure we're creating
        @functools.lru_cache()
        def get_user(uid: int) -> 'str | int':
            try:
                return pwd.getpwuid(uid).pw_name
            except KeyError:
                return uid

        @functools.lru_cache()
        def get_group(gid: int) -> 'str | int':
            try:
                return grp.getgrgid(gid).gr_name
            except KeyError:
                return gid

        stat_types = {stat.S_IFREG: 'reg', stat.S_IFDIR: 'dir', stat.S_IFLNK: 'lnk', stat.S_IFCHR: 'chr',
                      stat.S_IFBLK: 'blk', stat.S_IFIFO: 'fifo', stat.S_IFSOCK: 'sock'}
        available_stat_getters = {
            'type': lambda buf: stat_types.get(stat.S_IFMT(buf.st_mode)),
            'tag': tag_from_stat,
            'mode': lambda buf: stat.S_IMODE(buf.st_mode),
            'size': lambda buf: buf.st_size,
            'uid': lambda buf: buf.st_uid,
            'gid': lambda buf: buf.st_gid,
            'mtime': lambda buf: buf.st_mtime,
            'user': lambda buf: get_user(buf.st_uid),
            'group': lambda buf: get_group(buf.st_gid),
        }
        stat_getters = tuple((key, available_stat_getters.get(key, lambda _: None)) for key in attrs)

        def get_attrs(fd: int, name: str, follow: Follow) -> 'JsonDict | None':
            try:
                buf = os.stat(name, follow_symlinks=follow.value, dir_fd=fd) if name else os.fstat(fd)
            except FileNotFoundError:
                return None
            except OSError:
                return {name: None for name, func in stat_getters}

            result = {key: func(buf) for key, func in stat_getters}

            if 'target' in result and stat.S_IFMT(buf.st_mode) == stat.S_IFLNK:
                with contextlib.suppress(OSError):
                    result['target'] = os.readlink(name, dir_fd=fd)

            return result

        return get_attrs

    def send_update(self, updates: JsonDict, *, reset: bool = False) -> None:
        if reset:
            if set(self.current_value) & set(updates):
                # if we have an overlap, we need to do a proper reset
                self.send_json(dict.fromkeys(self.current_value), partial=True)
                self.current_value = {'partial': True}
                updates.update(partial=None)
            else:
                # otherwise there's no overlap: we can just remove the old keys
                updates.update(dict.fromkeys(self.current_value))

        json_merge_and_filter_patch(self.current_value, updates)
        if updates:
            self.send_json(updates)

    def process_update(self, updates: 'set[str]', *, reset: bool = False) -> None:
        assert self.fd is not None

        entries: JsonDict = {name: self.getattrs(self.fd, name, Follow.NO) for name in updates}

        info = entries.pop('', {})
        assert isinstance(info, dict)  # fstat() will never fail with FileNotFoundError

        if self.effective_fnmatch:
            info['entries'] = entries

        if self.targets:
            info['targets'] = targets = {}
            # 'targets' is used to report attributes about the ultimate target
            # of symlinks, but only if this information would not already be
            # reported.  As such, we exclude '.' and any path which would end
            # up in 'entries' (if it existed).  '..' needs special treatment:
            # it might be `.interesting()` but it won't be in 'entries', so
            # it's always treated as a target.
            for name in {e.get('target') for e in entries.values() if isinstance(e, dict)}:
                if isinstance(name, str) and name != '.':
                    # exclude anything that would end up in 'entries'
                    if (name == '..' or '/' in name or not self.interesting(name)):
                        targets[name] = self.getattrs(self.fd, name, Follow.YES)

        self.send_update({'info': info}, reset=reset)

    def process_pending_updates(self) -> None:
        assert self.pending is not None
        if self.pending:
            self.process_update(self.pending)
        self.pending = None

    def interesting(self, name: str) -> bool:
        if name == '':
            return True
        else:
            # only report updates on entry filenames if we match them
            return fnmatch.fnmatch(name, self.effective_fnmatch)

    def schedule_update(self, name: str) -> None:
        if not self.interesting(name):
            return

        if self.pending is None:
            asyncio.get_running_loop().call_later(0.1, self.process_pending_updates)
            self.pending = set()

        self.pending.add(name)

    def report_error(self, err: int) -> None:
        if err == errno.ENOENT:
            problem = 'not-found'
        elif err in (errno.EPERM, errno.EACCES):
            problem = 'access-denied'
        elif err == errno.ENOTDIR:
            problem = 'not-directory'
        else:
            problem = 'internal-error'

        self.send_update({'error': {
            'problem': problem, 'message': os.strerror(err), 'errno': errno.errorcode[err]
        }}, reset=True)

    def flag_onlydir_error(self, fd: Handle) -> bool:
        # If our requested path ended with '/' then make sure we got a
        # directory, or else it's an error.  open() will have already flagged
        # that for us, but systemd_ctypes doesn't do that (yet).
        if not self.watch or not self.path.endswith('/'):
            return False

        buf = os.fstat(fd)  # this should never fail
        if stat.S_IFMT(buf.st_mode) != stat.S_IFDIR:
            self.report_error(errno.ENOTDIR)
            return True

        return False

    def report_initial_state(self, fd: Handle) -> None:
        if self.flag_onlydir_error(fd):
            return

        self.fd = fd

        entries = {''}
        if self.fnmatch:
            try:
                entries.update(os.listdir(f'/proc/self/fd/{self.fd}'))
                self.effective_fnmatch = self.fnmatch
            except OSError:
                # If we failed to get an initial list, then report nothing from now on
                self.effective_fnmatch = ''

        self.process_update({e for e in entries if self.interesting(e)}, reset=True)

    def do_inotify_event(self, mask: InotifyEvent, cookie: int, rawname: 'bytes | None') -> None:
        logger.debug('do_inotify_event(%r, %r, %r)', mask, cookie, rawname)
        name = (rawname or b'').decode(errors='surrogateescape')

        self.schedule_update(name)

        if name and mask | (InotifyEvent.CREATE | InotifyEvent.DELETE |
                            InotifyEvent.MOVED_TO | InotifyEvent.MOVED_FROM):
            # These events change the mtime of the directory
            self.schedule_update('')

    def do_identity_changed(self, fd: 'Handle | None', err: 'int | None') -> None:
        logger.debug('do_identity_changed(%r, %r)', fd, err)
        # If there were previously pending changes, they are now irrelevant.
        if self.pending is not None:
            # Note: don't set to None, since the handler is still pending
            self.pending.clear()

        if err is None:
            assert fd is not None
            self.report_initial_state(fd)
        else:
            self.report_error(err)

    def do_close(self) -> None:
        # non-watch channels close immediately — if we get this, we're watching
        assert self.path_watch is not None
        self.path_watch.close()
        self.close()

    def do_open(self, options: JsonObject) -> None:
        self.path = get_str(options, 'path')
        if not os.path.isabs(self.path):
            raise JsonError(options, '"path" must be an absolute path')

        attrs = set(get_strv(options, 'attrs'))
        self.getattrs = self.make_getattrs(attrs - {'targets', 'entries'})
        self.fnmatch = get_str(options, 'fnmatch', '*' if 'entries' in attrs else '')
        self.targets = 'targets' in attrs
        self.follow = get_bool(options, 'follow', default=True)
        self.watch = get_bool(options, 'watch', default=False)
        if self.watch and not self.follow:
            raise JsonError(options, '"watch: true" and "follow: false" are (currently) incompatible')
        if self.targets and not self.follow:
            raise JsonError(options, '`targets: "stat"` and `follow: false` are (currently) incompatible')

        self.current_value = {}
        self.ready()

        if not self.watch:
            try:
                fd = Handle.open(self.path, os.O_PATH if self.follow else os.O_PATH | os.O_NOFOLLOW)
            except OSError as exc:
                self.report_error(exc.errno)
            else:
                self.report_initial_state(fd)
                fd.close()

            self.done()
            self.close()

        else:
            # PathWatch will call do_identity_changed(), which does the same as
            # above: calls either report_initial_state() or report_error(),
            # depending on if it was provided with an fd or an error code.
            self.path_watch = PathWatch(self.path, self)
