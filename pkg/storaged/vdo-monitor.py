#! /usr/bin/python

import sys, os, time, json

class Watcher:
    def __init__(self, path):
        self.inotify = Inotify()
        self.path = path
        self.wd = -1
        self.setup()

    def setup(self):
        self.cur_path = self.path
        self.cur_wait = None
        while not os.path.exists(self.cur_path):
            self.cur_wait = os.path.basename(self.cur_path)
            self.cur_path = os.path.dirname(self.cur_path)

        events = (IN_CREATE |
                  IN_MOVED_TO |
                  IN_MOVED_FROM |
                  IN_CLOSE_WRITE |
                  IN_MOVE_SELF)
        self.wd = self.inotify.add_watch(self.cur_path, events)

    def process(self, callback = None):
        def event(wd, mask, name):
            want_callback = self.cur_path == self.path
            if self.cur_wait and name == self.cur_wait:
                self.inotify.rem_watch(self.wd)
                self.setup()
            elif mask & IN_IGNORED:
                self.setup()
            want_callback = want_callback or self.cur_path == self.path
            if want_callback and callback:
                callback()
        self.inotify.process(event)

if sys.version_info >= (3, 0):
    from vdo.statistics import *
    from vdo.vdomgmnt import *
else:
    # Temporary patch to address layout changes
    for dir in sys.path:
        vdoDir = os.path.join(dir, 'vdo')
        if os.path.isdir(vdoDir):
            sys.path.append(vdoDir)
            break
    from statistics import *
    from vdomgmnt import *

# Converts NotAvailable to None, recursively, and other things.  The goal is to make OBJ serializable.
def wash(obj):
    if isinstance(obj, NotAvailable):
        return None
    elif isinstance(obj, SizeString):
        return int(obj)
    elif isinstance(obj, dict):
        return { key: wash(obj[key]) for key in obj.keys() }
    elif isinstance(obj, list):
        return list(map(wash, obj))
    else:
        return obj

def dump_washed(obj):
    sys.stdout.write(json.dumps(wash(obj)) + "\n")
    sys.stdout.flush()

def monitor_config():
    def query():
        try:
            conf = Configuration("/etc/vdoconf.yml")
            return [ { "name": vdo.getName(),
                       "broken": vdo.unrecoverablePreviousOperationFailure,
                       "device": vdo.device,
                       "logical_size": vdo.logicalSize,
                       "physical_size": vdo.physicalSize,
                       "index_mem": vdo.indexMemory,
                       "activated": vdo.activated,
                       "compression": vdo.enableCompression,
                       "deduplication": vdo.enableDeduplication }
                     for vdo in conf.getAllVdos().values() ]
        except Exception as e:
            sys.stderr.write(str(e) + "\n")
            return [ ]

    def event():
        dump_washed(query())

    watcher = Watcher("/etc/vdoconf.yml")
    event()
    while True:
        watcher.process(event)

def monitor_volume(dev):

    monitored_fields = [ 'blockSize',
                         'dataBlocksUsed', 'overheadBlocksUsed',
                         'logicalBlocksUsed',
                         'usedPercent', 'savingPercent'
    ]

    # Older versions let us use a string directly, newer versions want
    # it to be pre-processed.
    try:
        dev = Samples.samplingDevice(dev, dev)
    except AttributeError:
        pass

    def sample():
        try:
            stats = Samples.assay([ VDOStatistics() ], dev, False).samples[0].sample
            return { key: stats.get(key) for key in monitored_fields }
        except Exception as e:
            # Ignore errors from non-existing devices.  These happen
            # briefly when a VDO volume is being stopped or deleted
            # and the monitor hasn't been killed yet.
            if not "[Errno 2]" in str(e):
                raise
            return { }

    prev = None
    while True:
        data = sample()
        if data != prev:
            dump_washed(data)
        prev = data
        time.sleep(2)

if len(sys.argv) == 1:
    monitor_config()
else:
    monitor_volume(sys.argv[1])
