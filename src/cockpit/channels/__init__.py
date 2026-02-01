#
# Copyright (C) 2022 Red Hat, Inc.
# SPDX-License-Identifier: GPL-3.0-or-later


from .dbus import DBusChannel
from .filesystem import FsInfoChannel, FsListChannel, FsReadChannel, FsReplaceChannel, FsWatchChannel
from .http_channel import HttpChannel
from .info import InfoChannel
from .metrics import InternalMetricsChannel
from .packages import PackagesChannel
from .pcp import PcpMetricsChannel
from .stream import SocketStreamChannel, SubprocessStreamChannel
from .trivial import EchoChannel, NullChannel

CHANNEL_TYPES = [  # noqa: RUF067
    DBusChannel,
    EchoChannel,
    FsInfoChannel,
    FsListChannel,
    FsReadChannel,
    FsReplaceChannel,
    FsWatchChannel,
    HttpChannel,
    InfoChannel,
    InternalMetricsChannel,
    NullChannel,
    PackagesChannel,
    PcpMetricsChannel,
    SubprocessStreamChannel,
    SocketStreamChannel,
]
