import os

CPU_SAMPLER = 1 << 0
MEMORY_SAMPLER = 1 << 1

descriptions = {
    'cpu.basic.nice': ('millisec', 'counter', False, CPU_SAMPLER),
    'cpu.basic.user': ('millisec', 'counter', False, CPU_SAMPLER),
    'cpu.basic.system': ('millisec', 'counter', False, CPU_SAMPLER),
    'cpu.basic.iowait': ('millisec', 'counter', False, CPU_SAMPLER),

    'cpu.core.nice': ('millisec', 'counter', True, CPU_SAMPLER),
    'cpu.core.user': ('millisec', 'counter', True, CPU_SAMPLER),
    'cpu.core.system': ('millisec', 'counter', True, CPU_SAMPLER),
    'cpu.core.iowait': ('millisec', 'counter', True, CPU_SAMPLER),

    'memory.free': ('bytes', 'instant', False, MEMORY_SAMPLER),
    'memory.used': ('bytes', 'instant', False, MEMORY_SAMPLER),
    'memory.cached': ('bytes', 'instant', False, MEMORY_SAMPLER),
    'memory.swap-used': ('bytes', 'instant', False, MEMORY_SAMPLER),
}


# Friendly utility class to allow dynamically building the tree
class Samples(dict):
    def __getitem__(self, k):
        if k not in self:
            self[k] = Samples()
        return self.get(k)


USER_HZ = os.sysconf(os.sysconf_names['SC_CLK_TCK'])
MS_PER_JIFFY = 1000 / (USER_HZ if (USER_HZ > 0) else 100)


def cockpit_memory_samples(samples):
    with open('/proc/meminfo') as meminfo:
        items = {k: int(v.strip(' kB\n')) for line in meminfo for k, v in [line.split(':', 1)]}

    samples['memory.free'] = 1024 * items['MemFree']
    samples['memory.used'] = 1024 * (items['MemTotal'] - items['MemAvailable'])
    samples['memory.cached'] = 1024 * (items['Buffers'] + items['Cached'])
    samples['memory.swap-used'] = 1024 * (items['SwapTotal'] - items['SwapFree'])


def cockpit_cpu_samples(samples):
    with open('/proc/stat') as stat:
        for line in stat:
            if not line.startswith('cpu'):
                continue
            cpu, user, nice, system, _idle, iowait = line.split()[:6]
            core = cpu[3:] or None
            prefix = 'cpu.core' if core else 'cpu.basic'

            samples[f'{prefix}.nice'][core] = int(nice) * MS_PER_JIFFY
            samples[f'{prefix}.user'][core] = int(user) * MS_PER_JIFFY
            samples[f'{prefix}.system'][core] = int(system) * MS_PER_JIFFY
            samples[f'{prefix}.iowait'][core] = int(iowait) * MS_PER_JIFFY


s = Samples()
cockpit_memory_samples(s)
cockpit_cpu_samples(s)

print(s)
