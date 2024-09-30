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

# PCP Channel for Performance Co-pilot Metrics
#
# This is the replacement of the C implementation of cockpit-pcp, it uses the
# python pcp module (ctypes wrapper) to read PCP archives and directly connect
# to PCP daemons.
#
# Cockpit supports basically two different types of sources
# * archive - reads from a PCP archive(s) in either the default configured location `pcp-archive` or a given path.
# * pmcd / direct - connects to the pmcd daemon and reads metrics
#
# The PCP channel differs in the way it delivers data to the user, when
# requesting an archive, it is read in its entirety while when requesting other
# modes the channel will delivers metrics per given interval.
#
# Global channel options:
# * interval - the interval on which to deliver metrics
# * timestamp - timestamp of the first sample (only an option for archives)
# * limit - amount of samples to return, archive only option
# * omit-instances - multi-instances to not show (for example `lo` interface in network metrics)
# * instances - the multi-instances to show (for example only `/dev/sda`)
#
# Metrics
#
# When opening the metrics channel you can specify the metrics you are
# interested in, a PCP metric is described in pmapi as pmDesc:
#
# class pmDesc:
# pmid  - unique ID of the metric
# type  - data type (PM_TYPE_*)
# indom - the instance domain
# sem   - semantics of the value
# units - dimension and units
#
# Important here are the type, Cockpit only supports PM_TYPE_DOUBLE, and integers as PM_TYPE_U64.
#
# The instance domain denotes if the metric is has multiple instances, for
# example a disk metric can represent data for multiple disks.
#
# See `pminfo -f "kernel.all.load"` for example:
# kernel.all.load
#   inst [1 or "1 minute"] value 0.5
#   inst [5 or "5 minute"] value 0.68000001
#   inst [15 or "15 minute"] value 0.75999999
#
# These metrics are delivered to the JavaScript client as a list of values, the
# meta message contains the list of names of instances for the UI to show.

import asyncio
import ctypes
import glob
import json
import logging
import platform
import sys
import time
from typing import TYPE_CHECKING, Any, Dict, Iterable, List, NamedTuple, Optional, Sequence, Union

from cockpit.protocol import CockpitProblem

from ..channel import AsyncChannel, ChannelError
from ..jsonutil import JsonObject, JsonValue, get_int, get_objv, get_str, get_strv

if TYPE_CHECKING:  # pragma: no cover
    import cpmapi as c_api
    from pcp import pmapi
else:
    pmapi = None
    c_api = None

logger = logging.getLogger(__name__)


class MetricNotFoundError(CockpitProblem):
    pass


class PcpMetricInfo(Dict[str, JsonValue]):
    def __init__(self, value: JsonObject) -> None:
        self.name = get_str(value, 'name')
        self.derive = get_str(value, 'derive', '')
        self.units = get_str(value, 'units', '')
        super().__init__(name=self.name, derive=self.derive, units=self.units)


class MetricInfo(NamedTuple):
    pmid: int
    derive: str
    desc: Any
    name: str
    factor: float
    units: Any
    instanced: bool  # Multi instance metric


def try_import_pcp() -> None:
    global c_api, pmapi
    if c_api is None or pmapi is None:
        try:
            import cpmapi as c_api
            from pcp import pmapi
        except ImportError as exc:  # pragma: no cover
            raise ChannelError('not-supported', message='python3-pcp not installed') from exc


class ArchiveInfo:
    metric_descriptions: List[MetricInfo]

    def __init__(self, context: 'pmapi.pmContext', start: float, path: str) -> None:
        self.context = context
        self.start = start
        self.path = path
        self.metric_descriptions = []

    def sort_key(self) -> float:
        return self.start


class PcpMetricsChannel(AsyncChannel):
    payload = 'metrics1'

    pcp_dir: str
    archive_batch: int

    context: 'pmapi.pmContext'
    source: str
    interval: int
    start_timestamp: int
    last_timestamp: float
    next_timestamp: float
    limit: int
    last_samples: Any = None
    last_results: 'pmapi.pmResult | None' = None
    metric_descriptions: List[MetricInfo]

    def parse_options(self, options: JsonObject):
        self.archive_batch = 60
        self.last_timestamp = 0
        self.next_timestamp = 0

        max_size = sys.maxsize
        min_size = -sys.maxsize - 1

        self.interval = get_int(options, 'interval', 1000)
        if self.interval <= 0 or self.interval > max_size:
            raise ChannelError('protocol-error', message=f'invalid "interval" value: {self.interval}')

        self.start_timestamp = get_int(options, 'timestamp', 0)
        if self.start_timestamp / 1000 < min_size or self.start_timestamp / 1000 > max_size:
            raise ChannelError('protocol-error', message=f'invalid "timestamp" value: {self.start_timestamp}')

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

        try:
            pm_desc = context.pmLookupDesc(pm_ids[0])
        except pmapi.pmErr as exc:
            if exc.errno() == c_api.PM_ERR_NAME:
                raise ChannelError('not-found', message=f'no such metric: {name}') from None
            else:
                raise ChannelError('internal-error', message=str(exc)) from None

        # Multi-instance metrics have a domain defined
        instanced = pm_desc.indom != c_api.PM_INDOM_NULL

        if instanced:
            if len(self.instances) > 0:
                context.pmDelProfile(pm_desc, None)
                for instance in self.instances:
                    try:
                        instid = context.pmLookupInDom(pm_desc, instance)
                        context.pmAddProfile(pm_desc, instid)
                    except pmapi.pmErr as exc:
                        logger.debug("Unable to add profile: instance=%s err=%s", instance, exc)

            if len(self.omit_instances) > 0:
                context.pmAddProfile(pm_desc, None)
                for omit_instance in self.omit_instances:
                    try:
                        instid = context.pmLookupInDom(pm_desc, omit_instance)
                        context.pmDelProfile(pm_desc, [instid])
                    except pmapi.pmErr as exc:
                        logger.debug("Unable to remove profile: instance=%s err=%s", omit_instance, exc)

        factor = 1.0
        pm_units = pm_desc.units
        if units:
            try:
                [parsed_units, factor] = context.pmParseUnitsStr(units)
            except pmapi.pmErr as exc:
                if exc.errno() == c_api.PM_ERR_NAME:
                    raise ChannelError('not-found', message=f'no such metric: {name}') from None
                else:
                    raise ChannelError('internal-error', message=str(exc)) from None

            self.try_convert_unit(context, pm_desc, pm_units)

            if units != parsed_units or factor != 1.0:
                pm_units = parsed_units

        return MetricInfo(pmid=pm_ids[0],
                          name=name,
                          derive=derive,
                          desc=pm_desc,
                          factor=factor,
                          units=pm_units,
                          instanced=instanced)

    @staticmethod
    def try_convert_unit(context, pm_desc, pm_units) -> None:
        """Try to convert a dummy value to validate that the metric is convertible"""
        dummy = pmapi.pmAtomValue()
        dummy.d = 0.0
        try:
            context.pmConvScale(c_api.PM_TYPE_DOUBLE, dummy, [pm_desc], 0, pm_units)
        except pmapi.pmErr as exc:
            raise ChannelError('internal-error', message=str(exc)) from None

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
    def semantic_val(sem_id: int) -> str:
        if sem_id == c_api.PM_SEM_COUNTER:
            return "counter"
        elif sem_id == c_api.PM_SEM_INSTANT:
            return "instant"
        elif sem_id == c_api.PM_SEM_DISCRETE:
            return "discrete"

        return ""

    def send_meta(self, results: 'pmapi.pmResult', context: 'pmapi.pmContext') -> None:
        metrics = []

        for metric_desc in self.metric_descriptions:
            desc: Dict[str, Union[str, List[str]]] = {"name": metric_desc.name}

            if metric_desc.derive:
                desc['derive'] = metric_desc.derive

            if metric_desc.factor == 1.0:
                desc['units'] = str(metric_desc.units)
            else:
                desc['units'] = f"{context.pmUnitsStr(metric_desc.units)}*{1.0 / metric_desc.factor}"

            semantics = self.semantic_val(metric_desc.desc.sem)
            if semantics != "":
                desc['semantics'] = self.semantic_val(metric_desc.desc.sem)

            # We would like to use `context.pmGetInDom(indom=metric_desc.desc.indom)`
            # This returns an set of ([instids], [names])
            #
            # But we can't use this as it has no guarrentee for the instance ids order which we need.
            if metric_desc.instanced:
                insts: List[str] = []
                for i in range(results.contents.numpmid):
                    pmid = results.contents.get_pmid(i)
                    if metric_desc.pmid != pmid:
                        continue

                    for j in range(results.contents.get_numval(i)):
                        value = results.contents.get_vlist(i, j)
                        instance_desc = context.pmNameInDom(metric_desc.desc, value.inst)
                        insts.append(instance_desc)

                desc['instances'] = insts

            metrics.append(desc)

        now = int(time.time()) * 1000
        timestamp = int(results.contents.timestamp.tv_sec * 1000
                        + results.contents.timestamp.tv_usec / 1000)
        self.send_json(source=self.source,
                       interval=self.interval,
                       timestamp=timestamp,
                       metrics=metrics,
                       now=now)

    def needs_meta_update(self, results: 'pmapi.pmResult') -> bool:
        """
        If a multi-instance metric changes its instances we need to send a new
        meta message when these change. For example when an drive or ethernet
        card is removed out.
        """

        last_results = self.last_results
        if last_results is None:
            return True

        # PCP guarantees order of numpmid between results
        for i in range(results.contents.numpmid):
            if not self.metric_descriptions[i].instanced:
                continue

            numval1 = results.contents.get_numval(i)
            numval2 = last_results.contents.get_numval(i)

            if numval1 != numval2:
                return True

            for j in range(numval1):
                if results.contents.get_inst(i, j) != last_results.contents.get_inst(i, j):
                    return True

        return False

    def sample(self, context: 'pmapi.pmContext', archive_batch: int, limit: int, total_fetched: int) -> int:
        # HACK: pmFetch only takes an array of ctypes.c_uint, no native type, alternative keep pmids.
        pmids = (ctypes.c_uint * len(self.metric_descriptions))()
        for i, metric in enumerate(self.metric_descriptions):
            pmids[i] = metric.pmid

        while True:
            fetched: List[Any] = []
            try:
                for _ in range(archive_batch):
                    if total_fetched == limit:
                        # Direct sample type
                        if context.type != c_api.PM_CONTEXT_ARCHIVE:
                            return total_fetched
                        self.send_updates(fetched)
                        logger.debug('Reached limit "%s", stopping', self.limit)
                        return total_fetched
                    # Consider using the fetchGroup API https://pcp.readthedocs.io/en/latest/PG/PMAPI.html#fetchgroup-operation
                    results = context.pmFetch(pmids)

                    # The metrics channel sends a meta message the first time
                    # we open the channel and whenever instanced metrics change.
                    if self.needs_meta_update(results):
                        # Flush all metrics and send new meta, but only if there is data
                        if fetched:
                            self.send_updates(fetched)
                            fetched.clear()
                        self.send_meta(results, context)

                    fetched.append(self.parse_fetched_results(context, results))
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

    def parse_fetched_results(self, context: 'pmapi.pmContext', results: Any) -> Any:
        metrics = list(self.metrics)
        samples: Dict[str, Optional[float] | list[Optional[float]]] = {}

        samples['timestamp'] = float(results.contents.timestamp)
        for i in range(results.contents.numpmid):
            values: Optional[List[Optional[float]] | Optional[float]] = None
            numval: int = results.contents.get_numval(i)
            metric_desc = self.metric_descriptions[i]
            content_type = metric_desc.desc.type

            # negative numval is an error code we ignore
            if numval < 0:
                samples[metrics[i].name] = None
                continue

            # Unsupported types
            if content_type == c_api.PM_TYPE_AGGREGATE or \
                content_type == c_api.PM_TYPE_EVENT or \
                content_type == c_api.PM_TYPE_STRING:
                samples[metrics[i].name] = None
                continue

            if not metric_desc.instanced:
                values = self.build_sample(context, results, metric_desc, i, 0)
            else:
                vals: List[Optional[float]] = []
                for j in range(numval):
                    vals.append(self.build_sample(context, results, metric_desc, i, j))
                values = vals

            samples[metrics[i].name] = values

        return samples

    def build_sample(self, context, results, metric_desc: MetricInfo, metric: int, instance: int) -> Optional[float]:
        pmid = results.contents.get_pmid(metric)
        logger.debug("build_sample pmid=%d, metric=%d, instance=%d", pmid, metric, instance)

        # PCP throws an error when we try to convert a metric with numval <=
        # instanceid, the C bridge returns NAN. We return the Python equivalent None.
        valueset = results.contents.get_vset(metric)
        if valueset.numval <= instance:
            return None

        valfmt = results.contents.get_valfmt(metric)
        value = results.contents.get_vlist(metric, instance)
        content_type = metric_desc.desc.type

        # Make sure we keep the least 48 significant bits of 64 bit numbers
        # since "delta" and "rate" derivation works on those, and the whole
        # 64 don't fit into a double.
        sample_value = None
        atom = None
        if content_type == c_api.PM_TYPE_64:
            try:
                atom = context.pmExtractValue(valfmt,
                                              value,
                                              c_api.PM_TYPE_64,
                                              c_api.PM_TYPE_64)
                sample_value = atom.ll & ((1 << 48) - 1)
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

        # If requested units don't match metrics convert them.
        if metric_desc.desc.units != metric_desc.units:
            try:
                dummy = pmapi.pmAtomValue()
                dummy.d = sample_value
                converted_atom = context.pmConvScale(c_api.PM_TYPE_DOUBLE,
                                                     dummy,
                                                     [metric_desc.desc],
                                                     0,
                                                     metric_desc.units)
                sample_value = converted_atom.d * metric_desc.factor
            except pmapi.pmErr as exc:
                raise ChannelError('internal-error', message=str(exc)) from None

        return sample_value

    # HACK: copied from internalmetrics
    def calculate_sample_rate(self, value: float, old_value: Optional[float]) -> Any:
        if old_value is not None:
            return (value - old_value) / (self.next_timestamp - self.last_timestamp)
        else:
            return False

    def send_updates(self, samples: Sequence[Any]) -> None:
        data: list[list[float | list[float]]] = []
        last_samples = self.last_samples or {}

        for sample in samples:
            assert isinstance(sample['timestamp'], float)
            self.next_timestamp = sample['timestamp']
            sampled_values: list[float | list[float]] = []

            for metricinfo in self.metrics:
                value = sample[metricinfo.name]
                old_value = last_samples.get(metricinfo.name, None)

                if isinstance(value, list):
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
                else:
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
            # Set metric_descriptions to the current archive
            self.metric_descriptions = archive.metric_descriptions

            # Reset last samples and results
            self.last_results = None
            self.last_samples = None
            timestamp = self.start_timestamp

            # TODO can this be smarter?
            # continue when current archive isn't last and next archive starts before timestamp
            if i != len(archives) - 1 and archives[i + 1].start < timestamp:
                continue

            if timestamp < archive.start:
                timestamp = int(archive.start)

            context = archive.context
            try:
                context.pmSetMode(c_api.PM_MODE_INTERP | c_api.PM_XTB_SET(c_api.PM_TIME_MSEC),
                                  self.float_to_timeval(timestamp), self.interval)
            except pmapi.pmErr as exc:
                raise ChannelError('internal-error', message=str(exc)) from None

            total_fetched = self.sample(archive.context, self.archive_batch, self.limit, total_fetched)

    def prepare_direct_context(self, name: str, context_type: str) -> 'pmapi.pmContext':
        try:
            direct_context = pmapi.pmContext(context_type, name)
        except pmapi.pmErr as exc:
            raise ChannelError('internal-error', message=str(exc)) from None

        for metric in self.metrics:
            metric_desc = None
            try:
                metric_desc = self.convert_metric_description(direct_context, metric)
            except MetricNotFoundError:
                raise ChannelError('') from None
            assert metric_desc is not None
            self.metric_descriptions.append(metric_desc)

        return direct_context

    async def run(self, options: JsonObject) -> None:
        self.metric_descriptions = []
        logger.debug('metrics pcp-archive open: %r, channel: %r', options, self.channel)

        self.parse_options(options)
        try_import_pcp()
        # HACK: the mock package test only sets pmapi to true
        if pmapi is True:  # pragma: no cover
            raise ChannelError('not-supported')

        name, context_type = self.get_context_and_name(self.source)

        if context_type == c_api.PM_CONTEXT_ARCHIVE:
            archives = self.get_archives(name)
            self.ready()
            self.sample_archives(archives)
        else:
            direct_context = self.prepare_direct_context(name, context_type)
            self.ready()

            while True:
                self.sample(direct_context, 1, 1, 0)
                await asyncio.sleep(self.interval / 1000)
