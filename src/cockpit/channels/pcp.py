# This file is part of Cockpit.
#
# Copyright (C) 2023 Red Hat, Inc.
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

from __future__ import annotations

import asyncio
import glob
import json
import logging
import platform
import time
from collections import defaultdict
from typing import TYPE_CHECKING, Any, Iterable, Mapping, Sequence

from ..channel import AsyncChannel, ChannelError
from ..jsonutil import JsonObject, JsonValue, get_int, get_objv, get_str

if TYPE_CHECKING:
    import cpmapi as c_api
    from pcp import pmapi
else:
    pmapi = None
    c_api = None

logger = logging.getLogger(__name__)


def try_import_pcp() -> None:
    global c_api, pmapi
    if c_api is None or pmapi is None:
        try:
            import cpmapi as c_api
            from pcp import pmapi
        except ImportError as exc:
            raise ChannelError('not-supported', message='python3-pcp not installed') from exc


class PcpMetricInfo(dict[str, JsonValue]):
    def __init__(self, value: JsonObject) -> None:
        self.name = get_str(value, 'name')
        self.derive = get_str(value, 'derive', None)
        super().__init__(name=self.name, derive=self.derive)


class ArchiveInfo:
    def __init__(self, context: Any, start: float, path: str) -> None:
        self.context = context
        self.start = start
        self.path = path

    def sort_key(self) -> float:
        return self.start


Sample = Mapping[str, float | list[float] | None]


class PcpMetricsChannel(AsyncChannel):
    payload = 'metrics1'
    restrictions = [('source', 'pcp-archive')]

    pcp_dir: str
    archive_batch = 60

    archives: list[ArchiveInfo]
    metrics: Sequence[PcpMetricInfo]
    interval: int
    need_meta: bool = True
    start_timestamp: int
    last_timestamp: float = 0
    next_timestamp: float = 0
    last_samples: Sample | None = None

    async def run(self, options: JsonObject) -> None:
        logger.debug('metrics pcp-archive open: %r, channel: %r', options, self.channel)

        self.start_timestamp = get_int(options, 'timestamp', int(time.time() * 1000))
        self.interval = get_int(options, 'interval', 1000)
        self.metrics = get_objv(options, 'metrics', PcpMetricInfo)
        if not self.metrics:
            raise ChannelError('protocol-error', message='metrics list must not be empty')

        try_import_pcp()  # after parsing arguments

        try:
            self.archives = sorted(self.prepare_archives(), key=ArchiveInfo.sort_key)
        except FileNotFoundError as exc:
            raise ChannelError('failed to open archives') from exc

        self.ready()

        while True:
            self.sample_archives()

            try:
                await asyncio.wait_for(self.read(), self.interval / 1000)
                return
            except asyncio.TimeoutError:
                # Continue the while loop, we use wait_for as an interval timer.
                continue

    @staticmethod
    def float_to_timeval(timestamp: float) -> pmapi.timeval:
        sec = int(timestamp / 1000)
        usec = int((timestamp % 1000) * 1000)
        return pmapi.timeval(sec, usec)

    @staticmethod
    def prepare_archives() -> Iterable[ArchiveInfo]:
        hostname = platform.node()
        archive_dir = f'{pmapi.pmContext.pmGetConfig("PCP_LOG_DIR")}/pmlogger/{hostname}'
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
                    raise

    def send_meta(self) -> None:
        self.send_json(
            source='pcp-archive', interval=self.interval, timestamp=self.start_timestamp, metrics=self.metrics
        )
        self.need_meta = False

    def sample_archives(self) -> None:
        timestamp = self.start_timestamp

        for i, archive in enumerate(self.archives):
            # TODO can this be smarter?
            # continue when curent archive isn't last and next archive starts before timestamp
            if i != len(self.archives) - 1 and self.archives[i + 1].start < timestamp:
                continue

            if timestamp < archive.start:
                logger.debug("ligma balls")
                timestamp = int(archive.start)

            context = archive.context
            logger.debug('timestamp: %r', timestamp)
            logger.debug('archive_start: %r', archive.start)
            logger.debug('archive_end: %r', context.pmGetArchiveEnd())
            context.pmSetMode(c_api.PM_MODE_INTERP | c_api.PM_XTB_SET(c_api.PM_TIME_MSEC),
                              self.float_to_timeval(timestamp), self.interval)
            self.sample(context)

    def sample(self, current_context: pmapi.pmContext) -> None:
        pmids = current_context.pmLookupName([metric.name for metric in self.metrics])
        descs = current_context.pmLookupDescs(pmids)

        logger.debug('BEGIN SAMPLING')
        while True:
            fetched = []
            try:
                for _ in range(self.archive_batch):
                    results = current_context.pmFetch(pmids)
                    fetched.append(self.parse_fetched_results(current_context, results, descs))

                self.send_updates(fetched)
                fetched.clear()
            except pmapi.pmErr as exc:
                logger.debug('Fetching error: %r, fetched %r', exc, fetched)
                if exc.errno() != c_api.PM_ERR_EOL:
                    raise
                if len(fetched) > 0:
                    self.send_updates(fetched)

                break

    def parse_fetched_results(self, context: pmapi.pmContext, results: Any, descs: Any) -> Sample:
        metrics = list(self.metrics)
        samples: dict[str, float | list[float]] = {}

        samples['timestamp'] = float(results.contents.timestamp)
        for i in range(results.contents.numpmid):
            values: dict[str, float] | float = defaultdict()
            instances: list[str] | None = None
            value_count = results.contents.get_numval(i)

            if value_count > 1:
                _, instances = context.pmGetInDom(indom=descs[i].contents.indom)

            content_type = descs[i].contents.type
            for j in range(value_count):
                atom = context.pmExtractValue(results.contents.get_valfmt(i),
                                              results.contents.get_vlist(i, j),
                                              content_type,
                                              content_type)

                if value_count > 1:
                    assert isinstance(instances, list)
                    assert isinstance(values, dict)
                    values[instances[j]] = atom.dref(content_type)
                else:
                    # TODO does float() need to be here?
                    values = float(atom.dref(content_type))

            samples[metrics[i].name] = values

        return samples

    def calculate_sample_rate(self, value: float, old_value: float | None) -> float | bool:
        if old_value is not None and self.last_timestamp:
            return (value - old_value) / (self.next_timestamp - self.last_timestamp)
        else:
            return False

    def send_updates(self, samples: Sequence[Sample]) -> None:
        # data: List[List[Union[float, List[Optional[Union[float, bool]]]]]] = []
        data: list[list[float | list[float]]] = []
        last_samples = self.last_samples or {}

        for sample in samples:
            assert isinstance(sample['timestamp'], float)
            self.next_timestamp = sample['timestamp']
            sampled_values: list[float | list[float]] = []
            for metricinfo in self.metrics:
                value = sample[metricinfo.name]
                old_value = last_samples.get(metricinfo.name, None)

                logger.debug('old %r new %r', old_value, value)

                if isinstance(value, Mapping):
                    # If the old value wasn't an equivalent a mapping, we need a meta
                    if not isinstance(old_value, Mapping) or value.keys() != old_value.keys():
                        self.need_meta = True
                        old_value = {}

                    if metricinfo.derive == 'rate':
                        instances = tuple(self.calculate_sample_rate(value[key], old_value.get(key)) for key in value)
                        sampled_values.append(instances)
                    else:
                        sampled_values.append(tuple(value.values()))
                else:
                    assert isinstance(value, float)

                    # If the old value was a mapping, we need a meta
                    if isinstance(old_value, Mapping):
                        self.need_meta = True
                        old_value = None

                    if metricinfo.derive == 'rate':
                        sampled_values.append(self.calculate_sample_rate(value, old_value))
                    else:
                        sampled_values.append(value)

            data.append(sampled_values)
            self.last_timestamp = self.next_timestamp
            last_samples = sample

        if self.need_meta:
            self.send_meta()

        self.last_samples = last_samples
        self.send_data(json.dumps(data).encode())
