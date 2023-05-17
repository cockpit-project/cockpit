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

import asyncio
import json
import logging
import sys
import time
from collections import defaultdict
from typing import Dict, List, NamedTuple, Optional, Set, Tuple, Union

from ..channel import AsyncChannel, ChannelError
from ..samples import SAMPLERS, SampleDescription, Sampler, Samples

logger = logging.getLogger(__name__)


class MetricInfo(NamedTuple):
    derive: Optional[str]
    desc: SampleDescription


class InternalMetricsChannel(AsyncChannel):
    payload = 'metrics1'
    restrictions = [('source', 'internal')]

    metrics: List[MetricInfo]
    samplers: Set
    samplers_cache: Optional[Dict[str, Tuple[Sampler, SampleDescription]]] = None

    interval: int = 1000
    need_meta: bool = True
    last_timestamp: float = 0
    next_timestamp: float = 0

    @classmethod
    def ensure_samplers(cls):
        if cls.samplers_cache is None:
            cls.samplers_cache = {desc.name: (sampler, desc) for sampler in SAMPLERS for desc in sampler.descriptions}

    def parse_options(self, options):
        logger.debug('metrics internal open: %s, channel: %s', options, self.channel)

        interval = options.get('interval', self.interval)
        if not isinstance(interval, int) or interval <= 0 or interval > sys.maxsize:
            raise ChannelError('protocol-error', message=f'invalid "interval" value: {interval}')

        self.interval = interval

        metrics = options.get('metrics')
        if not isinstance(metrics, list) or len(metrics) == 0:
            logger.error('invalid "metrics" value: %s', metrics)
            raise ChannelError('protocol-error', message='invalid "metrics" option was specified (not an array)')

        sampler_classes = set()
        for metric in metrics:
            # validate it's an object
            name = metric.get('name')
            units = metric.get('units')
            derive = metric.get('derive')

            try:
                sampler, desc = self.samplers_cache[name]
            except KeyError as exc:
                logger.error('unsupported metric: %s', name)
                raise ChannelError('not-supported', message=f'unsupported metric: {name}') from exc

            if units and units != desc.units:
                raise ChannelError('not-supported', message=f'{name} has units {desc.units}, not {units}')

            sampler_classes.add(sampler)
            self.metrics.append(MetricInfo(derive=derive, desc=desc))

        self.samplers = {cls() for cls in sampler_classes}

    def send_meta(self, samples: Samples, timestamp: float):
        metrics = []
        for metricinfo in self.metrics:
            if metricinfo.desc.instanced:
                metrics.append({
                    'name': metricinfo.desc.name,
                    'units': metricinfo.desc.units,
                    'instances': list(samples[metricinfo.desc.name].keys()),
                    'semantics': metricinfo.desc.semantics
                })
            else:
                metrics.append({
                    'name': metricinfo.desc.name,
                    'derive': metricinfo.derive,  # type: ignore
                    'units': metricinfo.desc.units,
                    'semantics': metricinfo.desc.semantics
                })

        meta = {
            'timestamp': timestamp * 1000,
            'interval': self.interval,
            'source': 'internal',
            'metrics': metrics
        }
        self.send_message(**meta)
        self.need_meta = False

    def sample(self):
        samples = defaultdict(dict)
        for sampler in self.samplers:
            sampler.sample(samples)
        return samples

    def calculate_sample_rate(self, value: float, old_value: Optional[float]) -> Union[float, bool]:
        if old_value is not None and self.last_timestamp:
            return (value - old_value) / (self.next_timestamp - self.last_timestamp)
        else:
            return False

    def send_updates(self, samples: Samples, last_samples: Samples):
        data: List[Union[float, List[Optional[Union[float, bool]]]]] = []
        timestamp = time.time()
        self.next_timestamp = timestamp

        for metricinfo in self.metrics:
            value = samples[metricinfo.desc.name]

            if metricinfo.desc.instanced:
                old_value = last_samples[metricinfo.desc.name]
                assert isinstance(value, dict)
                assert isinstance(old_value, dict)

                # If we have less or more keys the data changed, send a meta message.
                if value.keys() != old_value.keys():
                    self.need_meta = True

                if metricinfo.derive == 'rate':
                    instances: List[Optional[Union[float, bool]]] = []
                    for key, val in value.items():
                        instances.append(self.calculate_sample_rate(val, old_value.get(key)))

                    data.append(instances)
                else:
                    data.append([val for val in value.values()])
            else:
                old_value = last_samples.get(metricinfo.desc.name)
                assert not isinstance(value, dict)
                assert not isinstance(old_value, dict)

                if metricinfo.derive == 'rate':
                    data.append(self.calculate_sample_rate(value, old_value))
                else:
                    data.append(value)

        if self.need_meta:
            self.send_meta(samples, timestamp)

        self.last_timestamp = self.next_timestamp
        self.send_data(json.dumps([data]).encode())

    async def run(self, options):
        self.metrics = []
        self.samplers = set()

        InternalMetricsChannel.ensure_samplers()

        self.parse_options(options)
        self.ready()

        last_samples = defaultdict(dict)
        while True:
            samples = self.sample()
            self.send_updates(samples, last_samples)
            last_samples = samples

            try:
                await asyncio.wait_for(self.read(), self.interval / 1000)
                return
            except asyncio.TimeoutError:
                # Continue the while loop, we use wait_for as an interval timer.
                continue
