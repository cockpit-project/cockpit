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
import json
import logging
import platform
import sys
import time
from collections import defaultdict
from typing import TYPE_CHECKING, Any, Iterable, Mapping, NamedTuple, Sequence

from ..channel import AsyncChannel, ChannelError
from ..jsonutil import JsonObject, JsonValue, get_int, get_objv, get_str, get_strv

if TYPE_CHECKING:
    import cpmapi as c_api
    from pcp import pmapi
else:
    pmapi = None
    c_api = None

logger = logging.getLogger(__name__)


Sample = Mapping[str, float | list[float] | None]


class PcpMetricInfo(dict[str, JsonValue]):
    def __init__(self, value: JsonObject) -> None:
        self.name = get_str(value, 'name')
        self.derive = get_str(value, 'derive', '')
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
    def __init__(self, context: 'pmapi.pmContext', start: float, path: str) -> None:
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
    archive_batch: int = 60

    context: 'pmapi.pmContext'
    source: str
    interval: int
    need_meta: bool = True
    start_timestamp: int
    last_timestamp: float = 0
    next_timestamp: float = 0
    limit: int = 0
    last_samples: Sample | None = None

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
        print("DERIVE", derive)

        try:
            pm_ids = context.pmLookupName(name)
        except pmapi.pmErr as exc:
            if exc.errno() == c_api.PM_ERR_NAME:
                print('err', exc)
                raise ChannelError('not-found', message=f'no such metric: {name}') from None
            else:
                raise ChannelError('internal-error', message=str(exc)) from None

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

    def send_meta(self, archive) -> None:
        # C build_meta in cockpitpcpmetrics.c
        metrics = []
        for metric_desc in archive.metric_descriptions:
            desc = {"name": metric_desc.name}

            if metric_desc.derive:
                desc['derive'] = metric_desc.derive

            if metric_desc.factor == 1.0:
                desc['units'] = str(metric_desc.units)  # XXX: verify
            else:
                raise NotImplementedError('')
                # gchar *name = g_strdup_printf
                # ("%s*%g", pmUnitsStr(self->metrics[i].units), 1.0/self->metrics[i].factor);

            desc['semantic'] = self.semantic_val(metric_desc.desc.sem)

            metrics.append(desc)

        now = time.time()
        self.send_json(source=self.source, interval=self.interval,
                       timestamp=self.start_timestamp, metrics=metrics,
                       now=now * 1000)

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

    def sample(self, archive):
        context = archive.context

        # HACK: this is some utter sillyness, maybe we can construct our own pcp.pmapi.c_uint_Array_1
        # pmids = [metric.id for metric in metric_descriptions]
        pmids = context.pmLookupName([metric.name for metric in self.metrics])
        descs = context.pmLookupDescs(pmids)

        # TODO: check self.limit and add test
        while True:
            fetched = []
            try:
                for _ in range(self.archive_batch):
                    # HACK: This is some pcp weirdness where it only accepts a PCP type list and not a Python list
                    # PMIDS <pcp.pmapi.c_uint_Array_1 object at 0x7ab92eaddb50>
                    results = context.pmFetch(pmids)
                    fetched.append(self.parse_fetched_results(context, results, descs))

                self.send_updates(archive, fetched)
                fetched.clear()
            except pmapi.pmErr as exc:
                logger.debug('Fetching error: %r, fetched %r', exc, fetched)
                if exc.errno() != c_api.PM_ERR_EOL:
                    raise ChannelError('internal-error', message=str(exc)) from None

                if len(fetched) > 0:
                    self.send_updates(archive, fetched)

                break

    def parse_fetched_results(self, context: 'pmapi.pmContext', results: Any, descs: Any) -> Sample:
        metrics = list(self.metrics)
        samples: dict[str, float | list[float]] = {}

        samples['timestamp'] = float(results.contents.timestamp)
        for i in range(results.contents.numpmid):
            valueset = results.contents.get_vset(i)
            values: dict[str, float] | float = defaultdict()

            # negative numval is an error code we ignore
            if valueset.numval < 0:
                pass
            # TODO: don't pass descs, look up via archive.metrics_descriptions?
            elif descs[i].indom == c_api.PM_INDOM_NULL:  # Single instance
                values = self.build_sample(context, valueset.contents.valfmt, valueset.contents.vlist[0], descs[i])
            else:  # Multi instance
                raise NotImplementedError('multi value handling, see C code')

            samples[metrics[i].name] = values
            # values: dict[str, float] | float = defaultdict()
            # instances: list[str] | None = None
            # value_count = results.contents.get_numval(i)
            #
            # if value_count > 1:
            #     _, instances = context.pmGetInDom(indom=descs[i].contents.indom)
            #
            # content_type = descs[i].contents.type
            # print(value_count, instances, content_type)
            # for j in range(value_count):
            #     atom = context.pmExtractValue(results.contents.get_valfmt(i),
            #                                   results.contents.get_vlist(i, j),
            #                                   content_type,
            #                                   content_type)
            #
            #     if value_count > 1:
            #         assert isinstance(instances, list)
            #         assert isinstance(values, dict)
            #         values[instances[j]] = atom.dref(content_type)
            #     else:
            #         # TODO does float() need to be here?
            #         values = float(atom.dref(content_type))
            #
            # samples[metrics[i].name] = values

        return samples

    def build_sample(self, context, valfmt, value, desc):
        # Unsupported type
        content_type = desc.type
        # TODO: PM_TYPE_AGGREGATE_FULL? or PM_TYPE_STRING?
        if content_type == c_api.PM_TYPE_AGGREGATE or content_type == c_api.PM_TYPE_EVENT:
            return

        # TODO: This check seems to be there for multi value types as the C code passes `j` along.
        # if (result->vset[metric]->numval <= instance)
        #     return;

        print("bonk", valfmt, value, content_type)
        sample_value = None
        if content_type == c_api.PM_TYPE_64:
            atom = context.pmExtractValue(valfmt,
                                          value,
                                          c_api.PM_TYPE_64,
                                          c_api.PM_TYPE_64)
            sample_value = (atom.ll << 16) >> 16
        elif content_type == c_api.PM_TYPE_U64:
            atom = context.pmExtractValue(valfmt,
                                          value,
                                          c_api.PM_TYPE_64,
                                          c_api.PM_TYPE_64)
            sample_value = (atom.ull << 16) >> 16
        else:
            try:
                atom = context.pmExtractValue(valfmt,
                                              value,
                                              content_type,
                                              c_api.PM_TYPE_DOUBLE)
            except Exception as exc:
                print("BORK", exc)

            sample_value = atom.d
            # print(atom.dref(content_type))

        # TODO: handle the case where requested units are != pcp given units
        # and scale them using pmConvScale
        return sample_value

    def calculate_sample_rate(self, value: float, old_value: float | None) -> float | bool:
        if old_value is not None and self.last_timestamp:
            return (value - old_value) / (self.next_timestamp - self.last_timestamp)
        else:
            return False

    def send_updates(self, archive, samples: Sequence[Sample]) -> None:
        # data: List[List[Union[float, List[Optional[Union[float, bool]]]]]] = []
        data: list[list[float | list[float]]] = []
        last_samples = self.last_samples or {}
        print(samples, self.metrics)

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
            self.send_meta(archive)

        self.last_samples = last_samples
        self.send_data(json.dumps(data).encode())

    def sample_archives(self, archives):
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

            self.sample(archive)
        else:
            return True

    async def run(self, options: JsonObject) -> None:
        logger.debug('metrics pcp-archive open: %r, channel: %r', options, self.channel)

        self.parse_options(options)
        try_import_pcp()  # after parsing arguments

        name, context_type = self.get_context_and_name(self.source)
        archives = []

        if context_type == c_api.PM_CONTEXT_ARCHIVE:
            archives = sorted(self.prepare_archives(name), key=ArchiveInfo.sort_key)
        else:  # host/local
            ...

        if len(archives) == 0:
            raise ChannelError('not-found')

        # Verify all metrics
        for archive in archives:
            archive.metric_descriptions = []
            for metric in self.metrics:
                metric_desc = self.convert_metric_description(archive.context, metric)
                archive.metric_descriptions.append(metric_desc)

                # TODO: port from prepare_current_context
                # Basically this filters the given instances/omitted instances
                if metric_desc.desc.indom != c_api.PM_INDOM_NULL:
                    if self.instances:
                        ...
                    elif self.omit_instances:
                        ...

        self.ready()

        self.sample_archives(archives)

        # while True:
        #
        #     if all_read:
        #         return
        #
        #     try:
        #         await asyncio.wait_for(self.read(), self.interval / 1000)
        #     except asyncio.TimeoutError:
        #         # Continue the while loop, we use wait_for as an interval timer.
        #         continue
        #
        #     # self.send_meta()
        #     # construct a meta message

