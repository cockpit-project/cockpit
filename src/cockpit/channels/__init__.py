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
from .dbus_internal import DBusInternalChannel
from .filesystem import FsListChannel, FsReadChannel, FsReplaceChannel, FsWatchChannel
from .metrics import MetricsChannel
from .packages import PackagesChannel
from .stream import StreamChannel
from .trivial import EchoChannel, NullChannel


CHANNEL_TYPES = [
    DBusChannel,
    DBusInternalChannel,
    EchoChannel,
    FsListChannel,
    FsReadChannel,
    FsReplaceChannel,
    FsWatchChannel,
    MetricsChannel,
    NullChannel,
    PackagesChannel,
    StreamChannel,
]
