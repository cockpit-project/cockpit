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

from .dbus import DBusChannel
from .filesystem import FsListChannel, FsReadChannel, FsReplaceChannel, FsWatchChannel
from .http import HttpChannel
from .metrics import InternalMetricsChannel
from .packages import PackagesChannel
from .stream import SocketStreamChannel, SubprocessStreamChannel
from .trivial import EchoChannel, NullChannel

CHANNEL_TYPES = [
    DBusChannel,
    EchoChannel,
    FsListChannel,
    FsReadChannel,
    FsReplaceChannel,
    FsWatchChannel,
    HttpChannel,
    InternalMetricsChannel,
    NullChannel,
    PackagesChannel,
    SubprocessStreamChannel,
    SocketStreamChannel,
]
