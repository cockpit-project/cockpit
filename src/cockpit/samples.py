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

import collections
import os

from typing import Dict, List, NamedTuple, Optional, Union


USER_HZ = os.sysconf(os.sysconf_names['SC_CLK_TCK'])
MS_PER_JIFFY = 1000 / (USER_HZ if (USER_HZ > 0) else 100)

Samples = collections.defaultdict[str, Union[float, Dict[str, Union[float, None]]]]


class SampleDescription(NamedTuple):
    name: str
    units: str
    semantics: str
    instanced: bool


class Sampler:
    descriptions: List[SampleDescription]

    def sample(self, samples: Samples) -> None:
        raise NotImplementedError


class CPUSampler(Sampler):
    descriptions = [
        SampleDescription('cpu.basic.nice', 'millisec', 'counter', False),
        SampleDescription('cpu.basic.user', 'millisec', 'counter', False),
        SampleDescription('cpu.basic.system', 'millisec', 'counter', False),
        SampleDescription('cpu.basic.iowait', 'millisec', 'counter', False),

        SampleDescription('cpu.core.nice', 'millisec', 'counter', True),
        SampleDescription('cpu.core.user', 'millisec', 'counter', True),
        SampleDescription('cpu.core.system', 'millisec', 'counter', True),
        SampleDescription('cpu.core.iowait', 'millisec', 'counter', True),
    ]

    def sample(self, samples: Samples) -> None:
        with open('/proc/stat') as stat:
            for line in stat:
                if not line.startswith('cpu'):
                    continue
                cpu, user, nice, system, _idle, iowait = line.split()[:6]
                core = cpu[3:] or None
                if core:
                    prefix = 'cpu.core'
                    samples[f'{prefix}.nice'][core] = int(nice) * MS_PER_JIFFY
                    samples[f'{prefix}.user'][core] = int(user) * MS_PER_JIFFY
                    samples[f'{prefix}.system'][core] = int(system) * MS_PER_JIFFY
                    samples[f'{prefix}.iowait'][core] = int(iowait) * MS_PER_JIFFY
                else:
                    prefix = 'cpu.basic'
                    samples[f'{prefix}.nice'] = int(nice) * MS_PER_JIFFY
                    samples[f'{prefix}.user'] = int(user) * MS_PER_JIFFY
                    samples[f'{prefix}.system'] = int(system) * MS_PER_JIFFY
                    samples[f'{prefix}.iowait'] = int(iowait) * MS_PER_JIFFY


class MemorySampler(Sampler):
    descriptions = [
        SampleDescription('memory.free', 'bytes', 'instant', False),
        SampleDescription('memory.used', 'bytes', 'instant', False),
        SampleDescription('memory.cached', 'bytes', 'instant', False),
        SampleDescription('memory.swap-used', 'bytes', 'instant', False),
    ]

    def sample(self, samples: Samples) -> None:
        with open('/proc/meminfo') as meminfo:
            items = {k: int(v.strip(' kB\n')) for line in meminfo for k, v in [line.split(':', 1)]}

        samples['memory.free'] = 1024 * items['MemFree']
        samples['memory.used'] = 1024 * (items['MemTotal'] - items['MemAvailable'])
        samples['memory.cached'] = 1024 * (items['Buffers'] + items['Cached'])
        samples['memory.swap-used'] = 1024 * (items['SwapTotal'] - items['SwapFree'])


class CPUTemperatureSampler(Sampler):
    # Cache found sensors, as they can't be hotplugged.
    sensors: List[str] = []

    descriptions = [
        SampleDescription('cpu.temperature', 'celsius', 'instant', True),
    ]

    def detect_cpu_sensors(self, hwmonid: int, name: str) -> None:
        for index in range(1, 2 ** 32):
            sensor_path = f'/sys/class/hwmon/hwmon{hwmonid}/temp{index}_input'
            if not os.path.exists(sensor_path):
                break

            label = open(f'/sys/class/hwmon/hwmon{hwmonid}/temp{index}_label').read().strip()
            if label:
                # only sample CPU Temperature in atk0110
                if label != 'CPU Temperature' and name == 'atk0110':
                    continue
                # ignore Tctl on AMD devices
                if label == 'Tctl':
                    continue
            else:
                # labels are not used on ARM
                if name != 'cpu_thermal':
                    continue

            self.sensors.append(sensor_path)

    def sample(self, samples: Samples) -> None:
        cpu_names = ['coretemp', 'cpu_thermal', 'k8temp', 'k10temp', 'atk0110']

        if not self.sensors:
            # TODO: 2 ** 32?
            for index in range(0, 2 ** 32):
                try:
                    name = open(f'/sys/class/hwmon/hwmon{index}/name').read().strip()
                    if name in cpu_names:
                        self.detect_cpu_sensors(index, name)
                except FileNotFoundError:
                    break

        for sensor_path in self.sensors:
            with open(sensor_path) as sensor:
                temperature = int(sensor.read().strip())
                if temperature == 0:
                    return

            samples['cpu.temperature'][sensor_path] = temperature / 1000


class DiskSampler(Sampler):
    descriptions = [
        SampleDescription('disk.all.read', 'bytes', 'counter', False),
        SampleDescription('disk.all.written', 'bytes', 'counter', False),
        SampleDescription('disk.dev.read', 'bytes', 'counter', True),
        SampleDescription('disk.dev.written', 'bytes', 'counter', True),
    ]

    def sample(self, samples: Samples) -> None:
        with open('/proc/diskstats') as diskstats:
            all_read_bytes = 0
            all_written_bytes = 0
            num_ops = 0

            for line in diskstats:
                # https://www.kernel.org/doc/Documentation/ABI/testing/procfs-diskstats
                [dev_major, _, dev_name, _, num_reads_merged, num_sectors_read, _, _, num_writes_merged, num_sectors_written, *_] = line.strip().split()

                # ignore device-mapper and md
                if dev_major in ['9', '253']:
                    continue

                # Skip partitions
                if dev_name[:2] in ['sd', 'hd', 'vd'] and dev_name[-1].isdigit():
                    continue

                # Ignore nvme partitions
                if dev_name.startswith('nvme') and 'p' in dev_name:
                    continue

                read_bytes = int(num_sectors_read) * 512
                written_bytes = int(num_sectors_written) * 512

                all_read_bytes += read_bytes
                all_written_bytes += written_bytes
                num_ops += int(num_reads_merged) + int(num_writes_merged)

                samples['disk.dev.read'][dev_name] = read_bytes
                samples['disk.dev.written'][dev_name] = written_bytes

            samples['disk.all.read'] = all_read_bytes
            samples['disk.all.written'] = all_written_bytes


class CGroupSampler(Sampler):
    descriptions = [
        SampleDescription('cgroup.memory.usage', 'bytes', 'instant', True),
        SampleDescription('cgroup.memory.limit', 'bytes', 'instant', True),
        SampleDescription('cgroup.memory.sw-usage', 'bytes', 'instant', True),
        SampleDescription('cgroup.memory.sw-limit', 'bytes', 'instant', True),
        SampleDescription('cgroup.cpu.usage', 'millisec', 'counter', True),
        SampleDescription('cgroup.cpu.shares', 'count', 'instant', True),
    ]

    cgroups_v2: Optional[bool] = None

    @staticmethod
    def read_cgroup_integer_stat(rootfd: int, statfile: str, include_zero: bool = False, key: bytes = b'') -> Optional[int]:
        # Not every stat is available, such as cpu.weight
        try:
            fd = os.open(statfile, os.O_RDONLY, dir_fd=rootfd)
        except FileNotFoundError:
            return None

        try:
            data = os.read(fd, 1024)
        finally:
            os.close(fd)

        if key:
            start = data.index(key) + len(key)
            end = data.index(b'\n', start)
            # cpu.stat are in usecs
            value = int(data[start:end])
        else:
            # Some samples such as "memory.max" contains "max" when there is a no limit
            try:
                value = int(data)
            except ValueError:
                return None

        if value > 0 or include_zero:
            return value

        return None

    def sample(self, samples: Samples) -> None:
        if self.cgroups_v2 is None:
            self.cgroups_v2 = os.path.exists('/sys/fs/cgroup/cgroup.controllers')

        if self.cgroups_v2:
            cgroups_v2_path = '/sys/fs/cgroup/'
            for path, _, _, rootfd in os.fwalk(cgroups_v2_path):
                cgroup = path.replace(cgroups_v2_path, '')

                if not cgroup:
                    continue

                samples['cgroup.memory.usage'][cgroup] = self.read_cgroup_integer_stat(rootfd, 'memory.current', True)
                samples['cgroup.memory.limit'][cgroup] = self.read_cgroup_integer_stat(rootfd, 'memory.max')
                samples['cgroup.memory.sw-usage'][cgroup] = self.read_cgroup_integer_stat(rootfd, 'memory.swap.current', True)
                samples['cgroup.memory.sw-limit'][cgroup] = self.read_cgroup_integer_stat(rootfd, 'memory.swap.max')
                samples['cgroup.cpu.shares'][cgroup] = self.read_cgroup_integer_stat(rootfd, 'cpu.weight')
                usage_usec = self.read_cgroup_integer_stat(rootfd, 'cpu.stat', True, key=b'usage_usec')
                if usage_usec:
                    samples['cgroup.cpu.usage'][cgroup] = usage_usec / 1000
        else:
            memory_path = '/sys/fs/cgroup/memory/'
            for path, _, _, rootfd in os.fwalk(memory_path):
                cgroup = path.replace(memory_path, '')

                if not cgroup:
                    continue

                samples['cgroup.memory.usage'][cgroup] = self.read_cgroup_integer_stat(rootfd, 'memory.usage_in_bytes', True)
                samples['cgroup.memory.limit'][cgroup] = self.read_cgroup_integer_stat(rootfd, 'memory.limit_in_bytes')
                samples['cgroup.memory.sw-usage'][cgroup] = self.read_cgroup_integer_stat(rootfd, 'memory.memsw.usage_in_bytes', True)
                samples['cgroup.memory.sw-limit'][cgroup] = self.read_cgroup_integer_stat(rootfd, 'memory.memsw.limit_in_bytes')

            cpu_path = '/sys/fs/cgroup/cpu/'
            for path, _, _, rootfd in os.fwalk(cpu_path):
                cgroup = path.replace(cpu_path, '')

                if not cgroup:
                    continue

                samples['cgroup.cpu.shares'][cgroup] = self.read_cgroup_integer_stat(rootfd, 'cpu.shares')
                usage_nsec = self.read_cgroup_integer_stat(rootfd, 'cpuacct.usage')
                if usage_nsec:
                    samples['cgroup.cpu.usage'][cgroup] = usage_nsec / 1000000


class NetworkSampler(Sampler):
    descriptions = [
        SampleDescription('network.interface.tx', 'bytes', 'counter', True),
        SampleDescription('network.interface.rx', 'bytes', 'counter', True),
    ]

    def sample(self, samples: Samples) -> None:
        with open("/proc/net/dev") as network_samples:
            for line in network_samples:
                fields = line.split()

                # Skip header line
                if fields[0][-1] != ':':
                    continue

                iface = fields[0][:-1]
                samples['network.interface.rx'][iface] = int(fields[1])
                samples['network.interface.tx'][iface] = int(fields[9])


class MountSampler(Sampler):
    descriptions = [
        SampleDescription('mount.total', 'bytes', 'instant', True),
        SampleDescription('mount.used', 'bytes', 'instant', True),
    ]

    def sample(self, samples: Samples) -> None:
        with open('/proc/mounts') as mounts:
            for line in mounts:
                # Only look at real devices
                if line[0] != '/':
                    continue

                path = line.split()[1]
                res = os.statvfs(path)
                if res:
                    frsize = res.f_frsize
                    total = frsize * res.f_blocks
                    samples['mount.total'][path] = total
                    samples['mount.used'][path] = total - frsize * res.f_bfree


class BlockSampler(Sampler):
    descriptions = [
        SampleDescription('block.device.read', 'bytes', 'counter', True),
        SampleDescription('block.device.written', 'bytes', 'counter', True),
    ]

    def sample(self, samples: Samples) -> None:
        with open('/proc/diskstats') as diskstats:
            for line in diskstats:
                # https://www.kernel.org/doc/Documentation/ABI/testing/procfs-diskstats
                [_, _, dev_name, _, _, sectors_read, _, _, _, sectors_written, *_] = line.strip().split()

                samples['block.device.read'][dev_name] = int(sectors_read) * 512
                samples['block.device.written'][dev_name] = int(sectors_written) * 512


SAMPLERS = [
    BlockSampler,
    CGroupSampler,
    CPUSampler,
    CPUTemperatureSampler,
    DiskSampler,
    MemorySampler,
    MountSampler,
    NetworkSampler,
]
