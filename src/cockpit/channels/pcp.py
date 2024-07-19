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

import asyncio
import glob
import json
import logging
import platform
import sys
import time
from collections import defaultdict
from typing import TYPE_CHECKING, Any, DefaultDict, Iterable, List, Mapping, NamedTuple, Sequence

from cockpit.protocol import CockpitProblem

from ..channel import AsyncChannel, ChannelError
from ..jsonutil import JsonObject, JsonValue, get_int, get_objv, get_str, get_strv

if TYPE_CHECKING:
    import cpmapi as c_api
    from pcp import pmapi
else:
    pmapi = None
    c_api = None

logger = logging.getLogger(__name__)


Sample = Mapping[str, float | List[float] | None]
Instances = DefaultDict[str, list[str]]


class MetricNotFoundError(CockpitProblem):
    pass


class PcpMetricInfo(dict[str, JsonValue]):
    def __init__(self, value: JsonObject) -> None:
        self.name = get_str(value, 'name')
        self.derive = get_str(value, 'derive', '')
        super().__init__(name=self.name, derive=self.derive)


class MetricInfo(NamedTuple):
    id: int
    derive: str
    desc: Any
    name: str
    factor: float
    units: Any
    units_bf: Any


def try_import_pcp() -> None:
    global c_api, pmapi
    if c_api is None or pmapi is None:
        try:
            import cpmapi as c_api
            from pcp import pmapi
        except ImportError as exc:
            raise ChannelError('not-supported', message='python3-pcp not installed') from exc


class ArchiveInfo:
    metric_descriptions: List[MetricInfo]
    instance_descriptions: Instances

    def __init__(self, context: 'pmapi.pmContext', start: float, path: str) -> None:
        self.context = context
        self.start = start
        self.path = path
        self.metric_descriptions = []
        self.instance_descriptions = defaultdict(list)

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
    last_results: 'pmapi.pmResult | None' = None

    def parse_options(self, options: JsonObject):
        max_size = sys.maxsize
        min_size = -sys.maxsize - 1

        self.interval = get_int(options, 'interval', 1000)
        if self.interval <= 0 or self.interval > max_size:
            raise ChannelError('protocol-error', message=f'invalid "interval" value: {self.interval}')

        self.start_timestamp = get_int(options, 'timestamp', 0)
        if self.start_timestamp / 1000 < min_size or self.start_timestamp / 1000 > max_size:
            raise ChannelError('protocol-error', message=f'invalid "timestamp" value: {self.start_timestamp}')

        # Timestamp is a negative number, calculate the time in epoch
        if self.start_timestamp < 0:
            self.start_timestamp = int((time.time() * 1000) + self.start_timestamp)

        self.metrics = get_objv(options, 'metrics', PcpMetricInfo)
        self.limit = get_int(options, 'limit', max_size)
        if self.limit <= 0 or self.limit > max_size:
            raise ChannelError('protocol-error', message=f'invalid "limit" value: {self.limit}')

        self.instances = get_strv(options, 'instances', '')
        self.omit_instances = get_strv(options, 'omit-instances', [])
        self.source = get_str(options, 'source', '')
        if self.source == '':
            raise ChannelError('protocol-error', message='no "source" option specified for metrics channel')

    @staticmethod
    def float_to_timeval(timestamp: float) -> 'pmapi.timeval':
        sec = int(timestamp / 1000)
        usec = int((timestamp % 1000) * 1000)
        return pmapi.timeval(sec, usec)

    @staticmethod
    def get_context_and_name(source: str) -> 'tuple[str, str]':
        if source == "":
            raise ChannelError('protocol-error', message='no "source" option specified for metrics channel')
        elif source.startswith('/'):
            name = source
            context_type = c_api.PM_CONTEXT_ARCHIVE
        elif source == 'pcp-archive':
            hostname = platform.node()
            archive_dir = pmapi.pmContext.pmGetConfig("PCP_LOG_DIR")
            name = f'{archive_dir}/pmlogger/{hostname}'
            context_type = c_api.PM_CONTEXT_ARCHIVE
        elif source == 'direct':
            name = source
            context_type = c_api.PM_CONTEXT_LOCAL
        elif source == 'pmcd':
            name = 'local:'
            context_type = c_api.PM_CONTEXT_HOST
        else:
            raise ChannelError('not-supported',
                               message=f'unsupported "source" option specified for metrics: {source}')

        return (name, context_type)

    def get_archives(self, name: str) -> Iterable[ArchiveInfo]:
        archives = sorted(self.prepare_archives(name), key=ArchiveInfo.sort_key)

        if len(archives) == 0:
            raise ChannelError('not-found')

        # Verify if the given metrics exist in the archive
        for archive in archives:
            for metric in self.metrics:
                metric_desc = None
                # HACK: Replicate C bridge behaviour, if a metric is not found
                # just return an empty error. If we report anything with a
                # message the metrics page won't re-try opening the metric archive.
                try:
                    metric_desc = self.convert_metric_description(archive.context, metric)
                except MetricNotFoundError:
                    raise ChannelError('') from None

                assert metric_desc is not None
                archive.metric_descriptions.append(metric_desc)

        return archives

    def convert_metric_description(self, context: 'pmapi.pmContext', metric: JsonObject) -> MetricInfo:
        name = get_str(metric, 'name', '')
        if name == '':
            raise ChannelError('protocol-error',
                               message='invalid "metrics" option was specified (no name for metric)')
        units = get_str(metric, 'units', '')
        derive = get_str(metric, 'derive', '')

        try:
            pm_ids = context.pmLookupName(name)
        except pmapi.pmErr as exc:
            if exc.errno() == c_api.PM_ERR_NAME:
                logger.error("no such metric: %s", name)
                raise MetricNotFoundError('error', message=f'no such metric: {name}') from None
            else:
                raise ChannelError('internal-error', message=str(exc)) from None

        # TODO: optimise by using pmLookupDesc?
        try:
            pm_desc = context.pmLookupDesc(pm_ids[0])
        except pmapi.pmErr as exc:
            if exc.errno() == c_api.PM_ERR_NAME:
                raise MetricNotFoundError('error', message=f'no such metric: {name}') from None
                # raise ChannelError('not-found', message=f'no such metric: {name}') from None
            else:
                raise ChannelError('internal-error', message=str(exc)) from None

        if pm_desc.indom != c_api.PM_INDOM_NULL:
            if len(self.instances) > 0:
                context.pmDelProfile(pm_desc, None)
                for instance in self.instances:
                    try:
                        # TODO: takes a list as well
                        instid = context.pmLookupInDom(pm_desc, instance)
                        context.pmAddProfile(pm_desc, instid)
                    except pmapi.pmErr as exc:
                        logger.error("Unable to add profile: instance=%s err=%s", instance, exc)

            if len(self.omit_instances) > 0:
                # TODO: Weird API...
                context.pmAddProfile(pm_desc, None)
                for omit_instance in self.omit_instances:
                    try:
                        instid = context.pmLookupInDom(pm_desc, omit_instance)
                        # TODO: refactor? into deleting all profiles at once
                        context.pmDelProfile(pm_desc, [instid])
                    except pmapi.pmErr as exc:
                        logger.error("Unable to remove profile: instance=%s err=%s", omit_instance, exc)

        # TODO: take care of this later...
        if units:
            try:
                [units_buf, factor] = context.pmParseUnitsStr(units)
            except pmapi.pmErr as exc:
                if exc.errno() == c_api.PM_ERR_NAME:
                    # raise ChannelError('not-found', message=f'no such metric: {name}') from None
                    raise MetricNotFoundError('error', message=f'no such metric: {name}') from None
                else:
                    raise ChannelError('internal-error', message=str(exc)) from None
        else:
            factor = 1.0
            units_buf = None
            units = pm_desc.units

        return MetricInfo(id=pm_ids[0],
                          name=name,
                          derive=derive,
                          desc=pm_desc,
                          factor=factor,
                          units=units,
                          units_bf=units_buf)

    @staticmethod
    def prepare_archives(archive_dir: str) -> Iterable[ArchiveInfo]:
        # TODO: research if we can just open the whole archive dir with pmContext, this is supported.
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

    # def send_meta(self, archive: ArchiveInfo, results: 'pmapi.pmResult', context: 'pmapi.pmContext') -> None:
    def send_meta(self, archive, results, context):
        # C build_meta in cockpitpcpmetrics.c
        metrics = []

        for metric_desc in archive.metric_descriptions:
            # Name and derivation mode
            desc = {"name": metric_desc.name}

            # TODO: should it be absent if ''?
            if metric_desc.derive:
                desc['derive'] = metric_desc.derive
            # Units
            if metric_desc.factor == 1.0:
                desc['units'] = str(metric_desc.units)  # XXX: verify
            else:
                logger.debug("units_bf %d", metric_desc.units_bf)
                raise NotImplementedError('')
                # gchar *name = g_strdup_printf
                # ("%s*%g", pmUnitsStr(self->metrics[i].units), 1.0/self->metrics[i].factor);

            # Semantics
            desc['semantic'] = self.semantic_val(metric_desc.desc.sem)

            # TODO: Inefficient..
            insts = []
            for i in range(results.contents.numpmid):
                pmid = results.contents.get_pmid(i)

                if metric_desc.id != pmid:
                    continue

                if metric_desc.desc.indom == c_api.PM_INDOM_NULL:
                    continue

                for j in range(results.contents.get_numval(i)):
                    value = results.contents.get_vlist(i, j)
                    instance_desc = context.pmNameInDom(metric_desc.desc, value.inst)
                    insts.append(instance_desc)

            if len(insts) > 0:
                desc['instances'] = insts

            metrics.append(desc)

        now = int(time.time())
        timestamp = int(results.contents.timestamp.tv_sec * 1000
                        + results.contents.timestamp.tv_usec / 1000)
        self.send_json(source=self.source, interval=self.interval,
                       timestamp=timestamp, metrics=metrics,
                       now=now * 1000)

        self.need_meta = False

    def needs_meta_update(self, results, descs) -> bool:
        """
        If a multi-instance metric changes its instances we need to send a new
        meta message when these change. For example when an drive or ethernet
        card is removed out.
        """

        last_results = self.last_results
        if last_results is None:
            return True

        # PCP guarrentees order of numpmid between results
        for i in range(results.contents.numpmid):
            if descs[i].indom == c_api.PM_INDOM_NULL:
                continue

            numval1 = results.contents.get_numval(i)
            numval2 = last_results.contents.get_numval(i)

            if numval1 != numval2:
                return True

            for j in range(numval1):
                if results.contents.get_inst(i, j) != last_results.contents.get_inst(i, j):
                    return True

        return False

    def sample(self, archive, total_fetched):
        context = archive.context

        # HACK: this is some utter sillyness, maybe we can construct our own pcp.pmapi.c_uint_Array_1
        # pmids = [metric.id for metric in metric_descriptions]
        pmids = context.pmLookupName([metric.name for metric in self.metrics])
        descs = context.pmLookupDescs(pmids)

        while True:
            fetched = []
            try:
                for _ in range(self.archive_batch):
                    if total_fetched == self.limit:
                        self.send_updates(fetched)
                        logger.debug('Reached limit "%s", stopping', self.limit)
                        return total_fetched
                    # Consider using the fetchGroup API https://pcp.readthedocs.io/en/latest/PG/PMAPI.html#fetchgroup-operation
                    # HACK: This is some pcp weirdness where it only accepts a PCP type list and not a Python list
                    # PMIDS <pcp.pmapi.c_uint_Array_1 object at 0x7ab92eaddb50>
                    results = context.pmFetch(pmids)

                    # First meta is required
                    if self.last_results is None:
                        self.send_meta(archive, results, context)
                    else:
                        # check if we need to send a meta
                        self.need_meta = self.needs_meta_update(results, descs)
                        if self.need_meta:
                            # Flush all metrics and send new meta
                            self.send_updates(fetched)
                            fetched.clear()
                            self.send_meta(archive, results, context)

                    fetched.append(self.parse_fetched_results(context, results, descs))
                    self.last_results = results
                    total_fetched += 1

                self.send_updates(fetched)
                fetched.clear()
            except pmapi.pmErr as exc:
                logger.debug('Fetching error: %r, fetched %r', exc, fetched)
                if exc.errno() != c_api.PM_ERR_EOL:
                    raise ChannelError('internal-error', message=str(exc)) from None

                if len(fetched) > 0:
                    self.send_updates(fetched)

                break

        return total_fetched

    def parse_fetched_results(self, context: 'pmapi.pmContext', results: Any, descs: Any) -> Sample:
        metrics = list(self.metrics)
        samples: dict[str, float | list[float]] = {}

        samples['timestamp'] = float(results.contents.timestamp)
        for i in range(results.contents.numpmid):
            values: dict[str, float] | float = defaultdict()
            numval: int = results.contents.get_numval(i)

            # negative numval is an error code we ignore
            if numval < 0:
                pass  # continue?
            # TODO: don't pass descs, look up via archive.metrics_descriptions?
            elif descs[i].indom == c_api.PM_INDOM_NULL:  # Single instance
                values = self.build_sample(context, results, descs, i, 0)
            else:  # Multi instance
                vals = []
                for j in range(numval):
                    vals.append(self.build_sample(context, results, descs, i, j))
                values = vals
                # raise NotImplementedError('multi value handling, see C code')

            samples[metrics[i].name] = values

        return samples

    def build_sample(self, context, results, descs, metric: int, instance: int):
        try:
            desc = descs[metric]
        except IndexError:
            logger.debug("no description found for metric=%s", metric)
            return

        pmid = results.contents.get_pmid(metric)

        logger.debug("build_sample pmid=%d, metric=%d, instance=%d", pmid, metric, instance)
        # Unsupported type
        content_type = desc.type
        # TODO: PM_TYPE_AGGREGATE_FULL? or PM_TYPE_STRING?
        if content_type == c_api.PM_TYPE_AGGREGATE or content_type == c_api.PM_TYPE_EVENT:
            return

        # TODO: This check seems to be there for multi value types as the C code passes `j` along.
        # But is it really needed?
        # if (result->vset[metric]->numval <= instance)
        #     return;
        valueset = results.contents.get_vset(metric)
        if valueset.numval <= instance:
            return

        valfmt = results.contents.get_valfmt(metric)
        value = results.contents.get_vlist(metric, instance)

        sample_value = None
        if content_type == c_api.PM_TYPE_64:
            try:
                atom = context.pmExtractValue(valfmt,
                                              value,
                                              c_api.PM_TYPE_64,
                                              c_api.PM_TYPE_64)
                sample_value = (atom.ll << 16) >> 16
            except Exception as exc:
                logger.exception("Unable to extract PCP TYPE_64 value %s", exc)
        elif content_type == c_api.PM_TYPE_U64:
            try:
                atom = context.pmExtractValue(valfmt,
                                              value,
                                              c_api.PM_TYPE_U64,
                                              c_api.PM_TYPE_U64)
                sample_value = (atom.ull << 16) >> 16
            except Exception as exc:
                logger.exception("Unable to extract PCP TYPE_U64 value %s", exc)
        else:
            try:
                atom = context.pmExtractValue(valfmt,
                                              value,
                                              content_type,
                                              c_api.PM_TYPE_DOUBLE)
                sample_value = atom.d
            except Exception as exc:
                logger.exception("Unable to extract PCP value %s", exc)

        # TODO: handle the case where requested units are != pcp given units
        # and scale them using pmConvScale
        return sample_value

    # TODO: copied from internalmetrics
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

                # COMPLETE WACK
                if isinstance(value, list):
                    # TODO: if multi value instances change we need to send out a new meta message
                    if metricinfo.derive == 'rate':
                        tmp = []
                        for index, val in enumerate(value):
                            old_val = None
                            if old_value is not None:
                                try:
                                    old_val = old_value[index]
                                except IndexError:
                                    pass
                            tmp.append(self.calculate_sample_rate(val, old_val))
                        sampled_values.append(tmp)
                    else:
                        sampled_values.append(value)
                    # We are multi instances lets go
                    # TODO Multi value instances!!! Return!
                else:
                    # If the old value was a mapping, we need a meta
                    if isinstance(old_value, Mapping):
                        self.need_meta = True
                        old_value = None

                    if metricinfo.derive == 'rate' and value is not None:
                        sampled_values.append(self.calculate_sample_rate(value, old_value))
                    else:
                        if value is None:
                            sampled_values.append(False)
                        else:
                            sampled_values.append(value)

            data.append(sampled_values)
            self.last_timestamp = self.next_timestamp
            last_samples = sample

        self.last_samples = last_samples

        self.send_data(json.dumps(data).encode())

    def sample_archives(self, archives):
        total_fetched = 0
        for i, archive in enumerate(archives):
            # Reset resuls per archive
            self.last_results = None
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

            total_fetched = self.sample(archive, total_fetched)
            if total_fetched == self.limit:
                return True
        else:
            return True

    async def run(self, options: JsonObject) -> None:
        logger.debug('metrics pcp-archive open: %r, channel: %r', options, self.channel)

        self.parse_options(options)
        try_import_pcp()
        name, context_type = self.get_context_and_name(self.source)

        if context_type == c_api.PM_CONTEXT_ARCHIVE:
            archives = self.get_archives(name)
            self.ready()  # TODO: too early? Compare with cockpit-pcp
            self.sample_archives(archives)
        else:
            # context = pmapi.pmContext(c_api.PM_CONTEXT_ARCHIVE, archive_path)
            try:
                direct_context = pmapi.pmContext(context_type, name)
                metric_descriptions = []
                for metric in self.metrics:
                    metric_desc = None
                    try:
                        metric_desc = self.convert_metric_description(direct_context, metric)
                    except MetricNotFoundError:
                        raise ChannelError('') from None
                    assert metric_desc is not None
                    metric_descriptions.append(metric_desc)
            except pmapi.pmErr as exc:
                raise ChannelError('internal-error', message=str(exc)) from None

            self.ready()  # TODO: too early? Compare with cockpit-pcp

            # TODO: we need to have a sample method which works archive independent
            # The problem is metric descriptions, which is tied per archive, can we de-couple that?
            # The C implementation does this per archive, and save that globally

            # def sample(self, archive, total_fetched):
            while True:
                # Get stuff
                await asyncio.sleep(self.interval / 1000)
