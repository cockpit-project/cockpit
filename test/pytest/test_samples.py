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
# along with this program.  If not, see <http://www.gnu.org/licenses/>.

import collections
import multiprocessing
import numbers
import os
import unittest

import pytest

import cockpit.samples


class TestSamples(unittest.TestCase):
    def get_checked_samples(self, sampler: cockpit.samples.Sampler) -> cockpit.samples.Samples:
        cls = sampler.__class__

        samples: cockpit.samples.Samples = collections.defaultdict(dict)
        sampler.sample(samples)

        self.assertEqual(set(samples), set(descr.name for descr in cls.descriptions))

        for descr in cls.descriptions:
            sample = samples[descr.name]

            if descr.instanced:
                assert isinstance(sample, dict)
            else:
                assert isinstance(sample, numbers.Real)

        return samples

    def test_descriptions(self):
        for cls in cockpit.samples.SAMPLERS:
            # currently broken in containers with no cgroups or temperatures present
            if cls in [cockpit.samples.CGroupSampler, cockpit.samples.CPUTemperatureSampler]:
                continue

            self.get_checked_samples(cls())

    def test_cgroup_descriptions(self):
        if not os.path.exists('/sys/fs/cgroup/system.slice'):
            pytest.xfail('No cgroups present')

        self.get_checked_samples(cockpit.samples.CGroupSampler())

    def test_temperature_descriptions(self):
        samples = collections.defaultdict(dict)
        cockpit.samples.CPUTemperatureSampler().sample(samples)
        if not samples:
            pytest.xfail('No CPU temperature present')

        self.get_checked_samples(cockpit.samples.CPUTemperatureSampler())

    def test_cpu(self):
        samples = self.get_checked_samples(cockpit.samples.CPUSampler())
        self.assertEqual(len(samples['cpu.core.user']), multiprocessing.cpu_count())

    def test_cpu_temperature(self):
        samples = collections.defaultdict(dict)
        cockpit.samples.CPUTemperatureSampler().sample(samples)
        if not samples:
            pytest.xfail('No CPU temperature present')

        samples = self.get_checked_samples(cockpit.samples.CPUTemperatureSampler())
        for name, temperature in samples['cpu.temperature'].items():
            assert name.startswith('/sys/')
            assert 0 < temperature < 200  # !!
