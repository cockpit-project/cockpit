# This file is part of Cockpit.
#
# Copyright (C) 2024 Red Hat, Inc.
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

import glob
import logging
import platform
import sys
from typing import TYPE_CHECKING, Any, Iterable, NamedTuple

from ..channel import AsyncChannel, ChannelError
from ..jsonutil import JsonObject, JsonValue, get_int, get_objv, get_str, get_strv

if TYPE_CHECKING:
    import cpmapi as c_api
    from pcp import pmapi
else:
    pmapi = None
    c_api = None

logger = logging.getLogger(__name__)


class PcpMetricInfo(dict[str, JsonValue]):
    def __init__(self, value: JsonObject) -> None:
        self.name = get_str(value, 'name')
        self.derive = get_str(value, 'derive', None)
        super().__init__(name=self.name, derive=self.derive)


class MetricInfo(NamedTuple):
    id: int
    derive: str
    desc: str
    name: str
    factor: float
    units: str
    units_bf: str


def try_import_pcp() -> None:
    global c_api, pmapi
    if c_api is None or pmapi is None:
        try:
            import cpmapi as c_api
            from pcp import pmapi
        except ImportError as exc:
            raise ChannelError('not-supported', message='python3-pcp not installed') from exc


class ArchiveInfo:
    def __init__(self, context: Any, start: float, path: str) -> None:
        self.context = context
        self.start = start
        self.path = path

    def sort_key(self) -> float:
        return self.start

    def __repr__(self):
        return f"ArchiveInfo({self.path})"


class PcpMetricsChannel(AsyncChannel):
    payload = 'metrics1'

    pcp_dir: str
    archive_batch = 60

    context: 'pmapi.pmContext'
    source: str
    interval: int
    need_meta: bool = True
    start_timestamp: int
    last_timestamp: float = 0
    next_timestamp: float = 0
    limit: int = 0

    @staticmethod
    def float_to_timeval(timestamp: float) -> 'pmapi.timeval':
        sec = int(timestamp / 1000)
        usec = int((timestamp % 1000) * 1000)
        return pmapi.timeval(sec, usec)

    @staticmethod
    def get_context_and_name(source: str):
        if source == "":
            raise ChannelError('protocol-error', message='no "source" option specified for metrics channel')
        elif source.startswith('/'):
            name = source
            context_type = c_api.PM_CONTEXT_ARCHIVE
        elif source == 'pcp-archive':
            hostname = platform.node()
            archive_dir = f'{pmapi.pmContext.pmGetConfig("PCP_LOG_DIR")}/pmlogger/{hostname}'
            name = f'{archive_dir}/pmlogger/{hostname}'
            context_type = c_api.PM_CONTEXT_ARCHIVE
        elif source == 'direct':
            name = None
            context_type = c_api.PM_CONTEXT_LOCAL
        elif source == 'pmcd':
            name = 'local:'
            context_type = c_api.PM_CONTEXT_HOST
        else:
            raise ChannelError('not-supported',
                               message=f'unsupported "source" option specified for metrics: {source}')

        return (name, context_type)

    @staticmethod
    def convert_metric_description(context: 'pmapi.pmContext', metric: JsonObject):
        name = get_str(metric, 'name', '')
        if not name:
            raise ChannelError('protocol-error',
                               message='invalid "metrics" option was specified (no name for metric)')
        units = get_str(metric, 'units', '')
        derive = get_str(metric, 'derive', '')

        try:
            pm_ids = context.pmLookupName(name)
        except pmapi.pmErr as exc:
            if exc.errno() == c_api.PM_ERR_NAME:
                raise ChannelError('not-found', message=f'no such metric: {name}') from None
            else:
                raise ChannelError('internal-error', message=str(exc)) from None

        print("ID", pm_ids)
        # TODO: optimise by using pmLookupDesc?
        try:
            pm_desc = context.pmLookupDesc(pm_ids[0])
        except pmapi.pmErr as exc:
            if exc.errno() == c_api.PM_ERR_NAME:
                raise ChannelError('not-found', message=f'no such metric: {name}') from None
            else:
                raise ChannelError('internal-error', message=str(exc)) from None

        # TODO: take care of this later...
        if units:
            try:
                _pm_units_buf = context.pmParseUnitsStr(units)
            except pmapi.pmErr as exc:
                if exc.errno() == c_api.PM_ERR_NAME:
                    raise ChannelError('not-found', message=f'no such metric: {name}') from None
                else:
                    raise ChannelError('internal-error', message=str(exc)) from None
        else:
            factor = 1.0
            units = pm_desc.units

        return MetricInfo(id=pm_ids[0],
                          name=name,
                          derive=derive,
                          desc=pm_desc,
                          factor=factor,
                          units=units,
                          units_bf="")

    @staticmethod
    def prepare_archives(archive_dir: str) -> Iterable[ArchiveInfo]:
        indexes = glob.glob(glob.escape(archive_dir) + '/*.index')
        for archive_path in indexes:
            logger.debug('opening archive: %r', archive_path)
            try:
                context = pmapi.pmContext(c_api.PM_CONTEXT_ARCHIVE, archive_path)
                log_label = context.pmGetArchiveLabel()
                archive_start = float(log_label.start) * 1000
                yield ArchiveInfo(context, archive_start, archive_path)
            except pmapi.pmErr as exc:
                if exc.errno() != c_api.PM_ERR_LOGFILE:
                    raise ChannelError('not-found', message=f'could not read archive {archive_path}') from None

    @staticmethod
    def semantic_val(sem_id: int):
        if sem_id == c_api.PM_SEM_COUNTER:
            return "counter"
        elif sem_id == c_api.PM_SEM_INSTANT:
            return "instant"
        elif sem_id == c_api.PM_SEM_DISCRETE:
            return "discrete"

    def send_meta(self) -> None:
        # C build_meta in cockpitpcpmetrics.c
        metrics = []
        for metric_desc in self.metric_descriptions:
            desc = {"name": metric_desc.name}

            if metric_desc.derive:
                desc['derive'] = metric_desc.derive

            if metric_desc.factor == 1.0:
                desc['units'] = str(metric_desc.units)  # XXX: verify
            else:
                ...
                # gchar *name = g_strdup_printf
                # ("%s*%g", pmUnitsStr(self->metrics[i].units), 1.0/self->metrics[i].factor);

            desc['semantic'] = self.semantic_val(metric_desc.desc.sem)

            metrics.append(desc)
        self.send_json(source=self.source, interval=self.interval,
                       timestamp=self.start_timestamp, metrics=metrics)
        self.need_meta = False

    def parse_options(self, options: JsonObject):
        self.interval = get_int(options, 'interval', 1000)
        if self.interval <= 0 or self.interval > sys.maxsize:
            raise ChannelError('protocol-error', message=f'invalid "interval" value: {self.interval}')

        self.start_timestamp = get_int(options, 'timestamp', 0)
        self.metrics = get_objv(options, 'metrics', PcpMetricInfo)
        self.limit = get_int(options, 'limit', 2**64)
        self.instances = get_strv(options, 'instances', '')
        self.omit_instances = get_strv(options, 'omit-instances', [])
        self.source = get_str(options, 'source', '')

        # if self.omit_instances and self.instances:
        #     raise ChannelError('protocol-error', message='')

    async def run(self, options: JsonObject) -> None:
        logger.debug('metrics pcp-archive open: %r, channel: %r', options, self.channel)

        try_import_pcp()  # after parsing arguments

        self.parse_options(options)

        name, context_type = self.get_context_and_name(self.source)
        archives = []

        if context_type == c_api.PM_CONTEXT_ARCHIVE:
            archives = sorted(self.prepare_archives(name), key=ArchiveInfo.sort_key)
        else:  # host/local
            ...

        if len(archives) == 0:
            raise ChannelError('not-found')

        print(archives)
        for i, archive in enumerate(archives):
            timestamp = self.start_timestamp

            # TODO can this be smarter?
            # continue when curent archive isn't last and next archive starts before timestamp
            if i != len(archives) - 1 and archives[i + 1].start < timestamp:
                continue

            if timestamp < archive.start:
                timestamp = int(archive.start)

            context = archive.context
            logger.debug('timestamp: %r', timestamp)
            logger.debug('archive_start: %r', archive.start)
            logger.debug('archive_end: %r', context.pmGetArchiveEnd())
            try:
                context.pmSetMode(c_api.PM_MODE_INTERP | c_api.PM_XTB_SET(c_api.PM_TIME_MSEC),
                                  self.float_to_timeval(timestamp), self.interval)
            except pmapi.pmErr as exc:
                raise ChannelError('internal-error', message=str(exc)) from None

            print(self.metrics)
            self.metric_descriptions = []
            for metric in self.metrics:
                metric_desc = self.convert_metric_description(context, metric)
                self.metric_descriptions.append(metric_desc)

                # TODO: port from prepare_current_context
                if metric_desc.desc.indom != c_api.PM_INDOM_NULL:
                    if self.instances:
                        ...
                    elif self.omit_instances:
                        ...

        self.ready()

        self.send_meta()
        # construct a meta message

