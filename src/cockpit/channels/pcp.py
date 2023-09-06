import sys
import os
import asyncio
from collections import defaultdict
import json
import logging
from typing import Any, Dict, NamedTuple, Optional, List, Union, Set

from ..channel import AsyncChannel, ChannelError
from ..jsonutil import JsonList, JsonObject
from cockpit._vendor.systemd_ctypes import Handle

logger = logging.getLogger(__name__)

from pcp import pmapi
import cpmapi as c_api

class PcpMetricInfo(NamedTuple):
    name: str
    derive: Optional[str]


class ArchiveInfo():
    def __init__(self, context, start, path):
        self.context = context
        self.start = start
        self.path = path

    # bleh, not like this
    def __lt__(self, other):
        return self.start < other.start

    def __gt__(self, other):
        return self.start > other.start


class PcpMetricsChannel(AsyncChannel):
    payload = 'metrics1'
    # restrictions = [('source', 'pcp-archive')]

    pcp_dir: str
    archive_batch = 60

    archives: List[ArchiveInfo]
    metrics: List[PcpMetricInfo]
    interval: int = 1000
    need_meta: bool = True
    start_timestamp: float = 0
    last_timestamp: float = 0
    next_timestamp: float = 0
    last_samples: Dict = defaultdict(lambda: None)

    async def run(self, options: JsonObject) -> None:
        # TODO figure out
        # if not all(module in sys.modules for module in ['pmapi', 'c_api']):
        #     self.try_import_pcp()

        self.metrics = []

        self.parse_options(options)

        try:
            self.prepare_archives()
        except FileNotFoundError:
            raise ChannelError('failed to open archives')

        self.ready()

        self.sample_archives()

        return

    def try_import_pcp(self) -> None:
        pass
        # try:
        #     global pmapi
        #     pmapi = getattr(import_module('pcp'), 'pmapi')
        #     global c_api
        #     c_api = getattr(import_module('cpmapi'), 'c_api')
        # except ImportError:
        #     raise ChannelError('not-supported', message='Pcp is not installed')

    def parse_options(self, options: JsonObject):
        logger.debug('metrics pcp-archive open: %s, channel: %s', options, self.channel)

        timestamp = options.get('timestamp')
        if not isinstance(timestamp, int):
            logger.error('no "timestamp" was specified')
            raise ChannelError('protocol-error', message='no "timestamp" was specified')

        self.start_timestamp = timestamp

        interval = options.get('interval')
        if isinstance(interval, int):
            self.interval = interval

        metrics = options.get('metrics')
        if not isinstance(metrics, list) or len(metrics) == 0:
            logger.error('invalid "metrics" value: %s', metrics)
            raise ChannelError('protocol-error', message='invalid "metrics" option was specified (not an array)')

        for metric in metrics:
            name = metric.get('name')
            derive = metric.get('derive')
            
            self.metrics.append(PcpMetricInfo(name=name, derive=derive))

    @staticmethod
    def float_to_timeval(timestamp: float) -> pmapi.timeval:
        sec = int(timestamp / 1000)
        usec = int((timestamp % 1000) * 1000)
        return pmapi.timeval(sec, usec)

    def add_archive(self, archive_path: str) -> ArchiveInfo:
        context = pmapi.pmContext(c_api.PM_CONTEXT_ARCHIVE, archive_path)
        log_label = context.pmGetArchiveLabel()
        archive_start = float(log_label.start) * 1000

        return ArchiveInfo(context=context, start=archive_start, path=archive_path)

    def prepare_archives(self) -> None:
        hostname = os.uname()[1]
        archive_dir = f'{pmapi.pmContext.pmGetConfig("PCP_LOG_DIR")}/pmlogger/{hostname}'

        with Handle.open(archive_dir, os.O_RDONLY | os.O_DIRECTORY) as archives_fd:
            archives: List[ArchiveInfo] = []

            for file_name in os.listdir(archives_fd):
                if file_name.endswith('.index'):
                    logger.debug(f'opening archive: {file_name}')
                    try:
                        archives.append(self.add_archive(f'{archive_dir}/{file_name}'))
                    except pmapi.pmErr as ex:
                        if ex.errno() != c_api.PM_ERR_LOGFILE:
                            raise ex
                        else:
                            continue

            archives.sort()
            self.archives = archives

    def send_meta(self) -> None:
        metrics: JsonList = []
        for metricinfo in self.metrics:
            metrics.append({
                'name': metricinfo.name,
                'derive': metricinfo.derive,
            })

        self.send_json(source='pcp-archive', interval=self.interval, timestamp=self.start_timestamp, metrics=metrics)
        self.need_meta = False

    def sample_archives(self) -> None:
        timestamp = self.start_timestamp

        for i, archive in enumerate(self.archives):
            # TODO can this be smarter?
            # continue when curent archive isn't last and next archive starts before timestamp
            if i != len(self.archives) - 1 and self.archives[i + 1].start < timestamp:
                continue

            if timestamp < archive.start:
                logging.debug("ligma balls")
                timestamp = int(archive.start)

            context = archive.context
            logging.debug(f'timestamp:\t\t{timestamp}')
            logging.debug(f'archive_start:\t{archive.start}')
            logging.debug(f'archive_end:\t{context.pmGetArchiveEnd()}')
            context.pmSetMode(c_api.PM_MODE_INTERP | c_api.PM_XTB_SET(c_api.PM_TIME_MSEC),
                              self.float_to_timeval(timestamp), self.interval)
            self.sample(context)

    def sample(self, current_context: pmapi.pmContext) -> None:
        metrics = list(self.metrics)

        pmids = current_context.pmLookupName([metric.name for metric in metrics])
        descs = current_context.pmLookupDescs(pmids)

        logging.debug('BEGIN SAMPLING')
        while True:
            fetched = []
            try:
                for _ in range(self.archive_batch):
                    results = current_context.pmFetch(pmids)
                    fetched.append(self.parse_fetched_results(current_context, results, descs))

                self.send_updates(fetched)
                fetched.clear()
            except pmapi.pmErr as ex:
                logging.debug(f'Fetching error: {ex}\t\tfetched: {fetched}')
                if ex.errno() != c_api.PM_ERR_EOL:
                    raise ex
                if len(fetched) > 0:
                    self.send_updates(fetched)

                break

    def parse_fetched_results(self, context: pmapi.pmContext, results: Any, descs: Any) -> Dict[str, Union[float, List[float]]]:
        metrics = list(self.metrics)
        samples = {}

        samples['timestamp'] = float(results.contents.timestamp)
        for i in range(results.contents.numpmid):
            values: Union[dict, float] = defaultdict()
            instances: Optional[List[str]] = None
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

    def calculate_sample_rate(self, value: float, old_value: Optional[float]) -> Union[float, bool]:
        if old_value is not None and self.last_timestamp:
            return (value - old_value) / (self.next_timestamp - self.last_timestamp)
        else:
            return False

    def send_updates(self, samples: List[Dict]):
        # data: List[List[Union[float, List[Optional[Union[float, bool]]]]]] = []
        data: List[List[Union[float, List[float]]]] = []
        last_samples = self.last_samples
        
        for sample in samples:
            self.next_timestamp = sample['timestamp']
            sampled_values: List[Union[float, List[float]]] = []
            for metricinfo in self.metrics:
                value = sample[metricinfo.name]

                if isinstance(value, dict):
                    old_value = last_samples[metricinfo.name]
                    assert isinstance(value, dict)
                    if old_value == None:
                        old_value = {}

                    # If we have less or more keys the data changed, send a meta message.
                    if value.keys() != old_value.keys():
                        self.need_meta = True

                    if metricinfo.derive == 'rate':
                        instances: List[Optional[Union[float, bool]]] = []

                        for key, val in value.items():
                            instances.append(self.calculate_sample_rate(val, old_value.get(key)))

                        sampled_values.append(instances)
                    else:
                        sampled_values.append(list(value.values()))
                else:
                    old_value = last_samples.get(metricinfo.name)
                    assert isinstance(value, float)
                    # hack because I need some default value to initialize old_values in the first round of sampling
                    if not isinstance(old_value, float | None):
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
