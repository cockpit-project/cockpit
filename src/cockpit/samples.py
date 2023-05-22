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

import os
import re
from typing import Any, DefaultDict, Iterable, List, NamedTuple, Optional, Tuple

from cockpit._vendor.systemd_ctypes import Handle

USER_HZ = os.sysconf(os.sysconf_names['SC_CLK_TCK'])
MS_PER_JIFFY = 1000 / (USER_HZ if (USER_HZ > 0) else 100)
HWMON_PATH = '/sys/class/hwmon'

# we would like to do this, but mypy complains; https://github.com/python/mypy/issues/2900
# Samples = collections.defaultdict[str, Union[float, Dict[str, Union[float, None]]]]
Samples = DefaultDict[str, Any]


def read_int_file(rootfd: int, statfile: str, include_zero: bool = False, key: bytes = b'') -> Optional[int]:
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
    sensors: Optional[List[str]] = None

    descriptions = [
        SampleDescription('cpu.temperature', 'celsius', 'instant', True),
    ]

    @staticmethod
    def detect_cpu_sensors(dir_fd: int) -> Iterable[str]:
        # Read the name file to decide what to do with this directory
        try:
            with Handle.open('name', os.O_RDONLY, dir_fd=dir_fd) as fd:
                name = os.read(fd, 1024).decode().strip()
        except FileNotFoundError:
            return

        if name == 'atk0110':
            # only sample 'CPU Temperature' in atk0110
            predicate = (lambda label: label == 'CPU Temperature')
        elif name == 'cpu_thermal':
            # labels are not used on ARM
            predicate = None
        elif name == 'coretemp':
            # accept all labels on Intel
            predicate = None
        elif name in ['k8temp', 'k10temp']:
            # ignore Tctl on AMD devices
            predicate = (lambda label: label != 'Tctl')
        else:
            # Not a CPU sensor
            return

        # Now scan the directory for inputs
        for input_filename in os.listdir(dir_fd):
            if not input_filename.endswith('_input'):
                continue

            if predicate:
                # We need to check the label
                try:
                    label_filename = input_filename.replace('_input', '_label')
                    with Handle.open(label_filename, os.O_RDONLY, dir_fd=dir_fd) as fd:
                        label = os.read(fd, 1024).decode().strip()
                except FileNotFoundError:
                    continue

                if not predicate(label):
                    continue

            yield input_filename

    @staticmethod
    def scan_sensors() -> Iterable[str]:
        try:
            top_fd = Handle.open(HWMON_PATH, os.O_RDONLY | os.O_DIRECTORY)
        except FileNotFoundError:
            return

        with top_fd:
            for hwmon_name in os.listdir(top_fd):
                with Handle.open(hwmon_name, os.O_RDONLY | os.O_DIRECTORY, dir_fd=top_fd) as subdir_fd:
                    for sensor in CPUTemperatureSampler.detect_cpu_sensors(subdir_fd):
                        yield f'{HWMON_PATH}/{hwmon_name}/{sensor}'

    def sample(self, samples: Samples) -> None:
        if self.sensors is None:
            self.sensors = list(CPUTemperatureSampler.scan_sensors())

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

            for line in diskstats:
                # https://www.kernel.org/doc/Documentation/ABI/testing/procfs-diskstats
                fields = line.strip().split()
                dev_major = fields[0]
                dev_name = fields[2]
                num_sectors_read = fields[5]
                num_sectors_written = fields[9]

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

    def sample(self, samples: Samples) -> None:
        if self.cgroups_v2 is None:
            self.cgroups_v2 = os.path.exists('/sys/fs/cgroup/cgroup.controllers')

        if self.cgroups_v2:
            cgroups_v2_path = '/sys/fs/cgroup/'
            for path, _, _, rootfd in os.fwalk(cgroups_v2_path):
                cgroup = path.replace(cgroups_v2_path, '')

                if not cgroup:
                    continue

                samples['cgroup.memory.usage'][cgroup] = read_int_file(rootfd, 'memory.current', True)
                samples['cgroup.memory.limit'][cgroup] = read_int_file(rootfd, 'memory.max')
                samples['cgroup.memory.sw-usage'][cgroup] = read_int_file(rootfd, 'memory.swap.current', True)
                samples['cgroup.memory.sw-limit'][cgroup] = read_int_file(rootfd, 'memory.swap.max')
                samples['cgroup.cpu.shares'][cgroup] = read_int_file(rootfd, 'cpu.weight')
                usage_usec = read_int_file(rootfd, 'cpu.stat', True, key=b'usage_usec')
                if usage_usec:
                    samples['cgroup.cpu.usage'][cgroup] = usage_usec / 1000
        else:
            memory_path = '/sys/fs/cgroup/memory/'
            for path, _, _, rootfd in os.fwalk(memory_path):
                cgroup = path.replace(memory_path, '')

                if not cgroup:
                    continue

                samples['cgroup.memory.usage'][cgroup] = read_int_file(rootfd, 'memory.usage_in_bytes', True)
                samples['cgroup.memory.limit'][cgroup] = read_int_file(rootfd, 'memory.limit_in_bytes')
                samples['cgroup.memory.sw-usage'][cgroup] = read_int_file(rootfd, 'memory.memsw.usage_in_bytes', True)
                samples['cgroup.memory.sw-limit'][cgroup] = read_int_file(rootfd, 'memory.memsw.limit_in_bytes')

            cpu_path = '/sys/fs/cgroup/cpu/'
            for path, _, _, rootfd in os.fwalk(cpu_path):
                cgroup = path.replace(cpu_path, '')

                if not cgroup:
                    continue

                samples['cgroup.cpu.shares'][cgroup] = read_int_file(rootfd, 'cpu.shares')
                usage_nsec = read_int_file(rootfd, 'cpuacct.usage')
                if usage_nsec:
                    samples['cgroup.cpu.usage'][cgroup] = usage_nsec / 1000000


class CGroupDiskIO(Sampler):
    IO_RE = re.compile(rb'\bread_bytes: (?P<read>\d+).*\nwrite_bytes: (?P<write>\d+)', flags=re.S)
    descriptions = [
        SampleDescription('disk.cgroup.read', 'bytes', 'counter', True),
        SampleDescription('disk.cgroup.written', 'bytes', 'counter', True),
    ]

    @staticmethod
    def get_cgroup_name(fd: int) -> str:
        with Handle.open('cgroup', os.O_RDONLY, dir_fd=fd) as cgroup_fd:
            cgroup_name = os.read(cgroup_fd, 2048).decode().strip()

            # Skip leading ::0/
            return cgroup_name[4:]

    @staticmethod
    def get_proc_io(fd: int) -> Tuple[int, int]:
        with Handle.open('io', os.O_RDONLY, dir_fd=fd) as io_fd:
            data = os.read(io_fd, 4096)

            match = re.search(CGroupDiskIO.IO_RE, data)
            if match:
                proc_read = int(match.group('read'))
                proc_write = int(match.group('write'))

                return proc_read, proc_write

            return 0, 0

    def sample(self, samples: Samples):
        with Handle.open('/proc', os.O_RDONLY | os.O_DIRECTORY) as proc_fd:
            reads = samples['disk.cgroup.read']
            writes = samples['disk.cgroup.written']

            for path in os.listdir(proc_fd):
                # non-pid entries in proc are guaranteed to start with a character a-z
                if path[0] < '0' or path[0] > '9':
                    continue

                try:
                    with Handle.open(path, os.O_PATH, dir_fd=proc_fd) as pid_fd:
                        cgroup_name = self.get_cgroup_name(pid_fd)
                        proc_read, proc_write = self.get_proc_io(pid_fd)
                except (FileNotFoundError, PermissionError, ProcessLookupError):
                    continue

                reads[cgroup_name] = reads.get(cgroup_name, 0) + proc_read
                writes[cgroup_name] = writes.get(cgroup_name, 0) + proc_write


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
    CGroupDiskIO,
    CPUSampler,
    CPUTemperatureSampler,
    DiskSampler,
    MemorySampler,
    MountSampler,
    NetworkSampler,
]
