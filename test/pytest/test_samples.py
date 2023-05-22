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

import pytest

import cockpit.samples


@pytest.fixture
def hwmon_mock(tmpdir_factory, monkeypatch):
    hwmon_dir = tmpdir_factory.mktemp('hwmon')
    monkeypatch.setattr(cockpit.samples, "HWMON_PATH", str(hwmon_dir))

    # hwmon1 - no name
    (hwmon_dir / 'hwmon1').mkdir()

    # hwmon2 - no label (on ARM)
    hwmon2_dir = hwmon_dir / 'hwmon2'
    hwmon2_dir.mkdir()
    with open(hwmon2_dir / 'name', 'w') as fp:
        fp.write('cpu_thermal')
    with open(hwmon2_dir / 'temp1_input', 'w') as fp:
        fp.write('32000')

    # hwmon3 - AMD workaround #18098
    hwmon3_dir = hwmon_dir / 'hwmon3'
    hwmon3_dir.mkdir()
    with open(hwmon3_dir / 'name', 'w') as fp:
        fp.write('k10temp')
    with open(hwmon3_dir / 'temp1_input', 'w') as fp:
        fp.write('27500')
    with open(hwmon3_dir / 'temp1_label', 'w') as fp:
        fp.write('Tctl')
    with open(hwmon3_dir / 'temp3_input', 'w') as fp:
        fp.write('37000')
    with open(hwmon3_dir / 'temp3_label', 'w') as fp:
        fp.write('Tccd1')

    # hwmon4 - Intel coretemp
    hwmon4_dir = hwmon_dir / 'hwmon4'
    hwmon4_dir.mkdir()

    with open(hwmon4_dir / 'name', 'w') as fp:
        fp.write('coretemp')
    with open(hwmon4_dir / 'temp1_input', 'w') as fp:
        fp.write('47000')
    with open(hwmon4_dir / 'temp1_label', 'w') as fp:
        fp.write('Package id 0')
    with open(hwmon4_dir / 'temp2_input', 'w') as fp:
        fp.write('46000')
    with open(hwmon4_dir / 'temp2_label', 'w') as fp:
        fp.write('Core 0')
    with open(hwmon4_dir / 'temp3_input', 'w') as fp:
        fp.write('46000')
    with open(hwmon4_dir / 'temp3_label', 'w') as fp:
        fp.write('Core 1')
    with open(hwmon4_dir / 'temp4_input', 'w') as fp:
        fp.write('46000')
    with open(hwmon4_dir / 'temp4_label', 'w') as fp:
        fp.write('Core 2')

    return hwmon_dir


def get_checked_samples(sampler: cockpit.samples.Sampler) -> cockpit.samples.Samples:
    cls = sampler.__class__

    samples: cockpit.samples.Samples = collections.defaultdict(dict)
    sampler.sample(samples)

    assert set(samples) == {descr.name for descr in cls.descriptions}

    for descr in cls.descriptions:
        sample = samples[descr.name]

        if descr.instanced:
            assert isinstance(sample, dict)
        else:
            assert isinstance(sample, numbers.Real)

    return samples


def test_descriptions():
    for cls in cockpit.samples.SAMPLERS:
        # currently broken in containers with no cgroups or temperatures present
        if cls in [cockpit.samples.CGroupSampler, cockpit.samples.CPUTemperatureSampler]:
            continue

        get_checked_samples(cls())


def test_cgroup_descriptions():
    if not os.path.exists('/sys/fs/cgroup/system.slice'):
        pytest.xfail('No cgroups present')

    get_checked_samples(cockpit.samples.CGroupSampler())


def test_temperature_descriptions():
    samples = collections.defaultdict(dict)
    cockpit.samples.CPUTemperatureSampler().sample(samples)
    if not samples:
        pytest.xfail('No CPU temperature present')

    get_checked_samples(cockpit.samples.CPUTemperatureSampler())


def test_cpu():
    samples = get_checked_samples(cockpit.samples.CPUSampler())
    assert len(samples['cpu.core.user']) == multiprocessing.cpu_count()


def test_cpu_temperature(hwmon_mock):
    samples = collections.defaultdict(dict)
    cockpit.samples.CPUTemperatureSampler().sample(samples)
    samples = get_checked_samples(cockpit.samples.CPUTemperatureSampler())
    for name, temperature in samples['cpu.temperature'].items():
        # no name
        assert 'hwmon1' not in name

        assert 20 < temperature < 50

    expected = ['hwmon4/temp4_input', 'hwmon4/temp3_input', 'hwmon4/temp2_input',
                'hwmon4/temp1_input', 'hwmon3/temp3_input', 'hwmon2/temp1_input']
    sensors = [os.path.relpath(p, start=hwmon_mock) for p in samples['cpu.temperature']]
    assert sorted(sensors) == sorted(expected)


def test_cgroup_disk_io():
    samples = collections.defaultdict(dict)
    cockpit.samples.CGroupDiskIO().sample(samples)
    samples = get_checked_samples(cockpit.samples.CGroupDiskIO())

    assert len(samples['disk.cgroup.read']) == len(samples['disk.cgroup.written'])
    for cgroup in samples['disk.cgroup.read']:
        assert samples['disk.cgroup.read'][cgroup] >= 0
        assert samples['disk.cgroup.written'][cgroup] >= 0
