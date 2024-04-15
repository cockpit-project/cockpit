#
# This file is part of Cockpit.
#
# Copyright (C) 2017 Red Hat, Inc.
#
# Cockpit is free software; you can redistribute it and/or modify it
# under the terms of the GNU Lesser General Public License as published by
# the Free Software Foundation; either version 2.1 of the License, or
# (at your option) any later version.
#
# Cockpit is distributed in the hope that it will be useful, but
# WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
# Lesser General Public License for more details.
#
# You should have received a copy of the GNU Lesser General Public License
# along with Cockpit; If not, see <http://www.gnu.org/licenses/>.

import ctypes
import os
import struct
import sys

IN_CLOSE_WRITE = 0x00000008
IN_MOVED_FROM = 0x00000040
IN_MOVED_TO = 0x00000080
IN_CREATE = 0x00000100
IN_DELETE = 0x00000200
IN_DELETE_SELF = 0x00000400
IN_MOVE_SELF = 0x00000800
IN_IGNORED = 0x00008000


class Inotify:
    def __init__(self):
        self._libc = ctypes.CDLL(None, use_errno=True)
        self._get_errno_func = ctypes.get_errno

        self._libc.inotify_init.argtypes = []
        self._libc.inotify_init.restype = ctypes.c_int
        self._libc.inotify_add_watch.argtypes = [ctypes.c_int, ctypes.c_char_p,
                                                 ctypes.c_uint32]
        self._libc.inotify_add_watch.restype = ctypes.c_int
        self._libc.inotify_rm_watch.argtypes = [ctypes.c_int, ctypes.c_int]
        self._libc.inotify_rm_watch.restype = ctypes.c_int

        self.fd = self._libc.inotify_init()

    def add_watch(self, path, mask):
        path = ctypes.create_string_buffer(path.encode(sys.getfilesystemencoding()))
        wd = self._libc.inotify_add_watch(self.fd, path, mask)
        if wd < 0:
            sys.stderr.write("can't add watch for %s: %s\n" % (path, os.strerror(self._get_errno_func())))
        return wd

    def rem_watch(self, wd):
        if self._libc.inotify_rm_watch(self.fd, wd) < 0:
            sys.stderr.write("can't remove watch: %s\n" % (os.strerror(self._get_errno_func())))

    def process(self, callback):
        buf = os.read(self.fd, 4096)
        pos = 0
        while pos < len(buf):
            (wd, mask, _cookie, name_len) = struct.unpack('iIII', buf[pos:pos + 16])
            pos += 16
            (name,) = struct.unpack('%ds' % name_len, buf[pos:pos + name_len])
            pos += name_len
            callback(wd, mask, name.decode().rstrip('\0'))

    def run(self, callback):
        while True:
            self.process(callback)
