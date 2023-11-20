#! /usr/bin/python3

# nfs-mounts   --  Monitor and manage NFS mounts
#
# This is similar to how UDisks2 monitors and manages block device
# mounts, but for NFS.  This might be moved into UDisks2, or not.

# We monitor all NFS remotes listed in /etc/fstab and in /proc/self/mounts.
# If a entry from mtab is also found in fstab, we report only the
# fstab entry and mark it is "mounted".

import json
import os
import re
import select
import subprocess
import sys


class Watcher:
    def __init__(self, path):
        self.inotify = Inotify()
        self.path = path
        self.setup()

    def setup(self):
        self.wd = self.inotify.add_watch(self.path, IN_CLOSE_WRITE)

    def process(self, callback=None):
        def event(_wd, mask, name):
            if callback:
                callback()
            if mask & IN_IGNORED:
                self.setup()
        self.inotify.process(event)


def field_escape(field):
    return field.replace("\\", "\\134").replace(" ", "\\040").replace("\t", "\\011")


def field_unescape(field):
    return re.sub("\\\\([0-7]{1,3})", lambda m: chr(int(m.group(1), 8)), field)


def parse_tab(name):
    entries = []
    with open(name, "r") as f:
        for line in f:
            sline = line.strip()
            if sline == "" or sline[0] == "#":
                continue
            fields = list(map(field_unescape, re.split("[ \t]+", sline)))
            if len(fields) > 2 and ":" in fields[0] and fields[2].startswith("nfs"):
                entries.append(fields)
    return entries


def index_tab(tab):
    by_remote = {}
    for t in tab:
        if t[0] not in by_remote:
            by_remote[t[0]] = []
        by_remote[t[0]].append(t)
    return by_remote


def modify_tab(name, modify):
    with open(name) as f:
        lines = f.read().splitlines()

    new_lines = []
    for line in lines:
        sline = line.strip()
        if sline == "" or sline[0] == "#":
            new_lines.append(line)
        else:
            fields = list(map(field_unescape, re.split("[ \t]+", sline)))
            if len(fields) > 0 and ":" in fields[0]:
                new_fields = modify(fields)
                if new_fields:
                    if new_fields == fields:
                        new_lines.append(line)
                    else:
                        new_lines.append(" ".join(map(field_escape, new_fields)))
            else:
                new_lines.append(line)
    new_fields = modify(None)
    if new_fields:
        new_lines.append(" ".join(map(field_escape, new_fields)))

    with open(name + ".tmp", "w") as f:
        f.write("\n".join(new_lines) + "\n")
        f.flush()
        os.fsync(f.fileno())
    os.rename(name + ".tmp", name)


fstab = []
fstab_by_remote = {}

mtab = []
mtab_by_remote = {}


def process_fstab():
    global fstab, fstab_by_remote
    fstab = parse_tab("/etc/fstab")
    fstab_by_remote = index_tab(fstab)


def process_mtab():
    global mtab, mtab_by_remote
    mtab = parse_tab("/proc/self/mounts")
    mtab_by_remote = index_tab(mtab)


def find_in_tab(tab_by_remote, fields):
    for t in tab_by_remote.get(fields[0], []):
        if t[0] == fields[0] and t[1] == fields[1]:
            return t
    return None


def report():
    data = []
    for f in fstab:
        m = find_in_tab(mtab_by_remote, f)
        data.append({"fstab": True, "fields": f, "mounted": m is not None})
    for m in mtab:
        if not find_in_tab(fstab_by_remote, m):
            data.append({"fstab": False, "fields": m, "mounted": True})
    sys.stdout.write(json.dumps(data) + "\n")
    sys.stdout.flush()


def monitor():
    process_mtab()
    process_fstab()
    report()
    fstab_watcher = Watcher("/etc/fstab")
    mtab_file = open("/proc/self/mounts", "r")
    while True:
        (r, w, x) = select.select([fstab_watcher.inotify.fd], [], [mtab_file])
        if mtab_file in x:
            process_mtab()
            report()
        if fstab_watcher.inotify.fd in r:
            fstab_watcher.process()
            process_fstab()
            report()


def mkdir_if_necessary(path):
    if not os.path.exists(path):
        os.makedirs(path)


def rmdir_maybe(path):
    try:
        os.rmdir(path)
    except OSError:
        pass


def update(entry, new_fields):
    old_fields = entry["fields"]
    if old_fields[1] != new_fields[1]:
        mkdir_if_necessary(new_fields[1])
    if entry["mounted"]:
        if (new_fields[0] == old_fields[0] and
            new_fields[1] == old_fields[1] and
                new_fields[2] == old_fields[2]):
            remount(new_fields)
        else:
            try:
                unmount(entry)
                if old_fields[1] != new_fields[1]:
                    rmdir_maybe(old_fields[1])
            except subprocess.CalledProcessError:
                pass
            mount({"fields": new_fields})
    else:
        if old_fields[1] != new_fields[1]:
            rmdir_maybe(old_fields[1])
    modify_tab("/etc/fstab", lambda fields: new_fields if fields == old_fields else fields)


def add(new_fields):
    mkdir_if_necessary(new_fields[1])
    mount({"fields": new_fields})
    modify_tab("/etc/fstab", lambda fields: new_fields if fields is None else fields)


def remove(entry):
    old_fields = entry["fields"]
    if entry["mounted"]:
        unmount(entry)
    rmdir_maybe(old_fields[1])
    modify_tab("/etc/fstab", lambda fields: None if fields == old_fields else fields)


def mount(entry):
    fields = entry["fields"]
    mkdir_if_necessary(fields[1])
    subprocess.check_call(["mount",
                           "-t", fields[2],
                           "-o", fields[3],
                           fields[0],
                           fields[1]])


def remount(fields):
    subprocess.check_call(["mount",
                           "-o", "remount," + fields[3],
                           fields[0],
                           fields[1]])


def unmount(entry):
    subprocess.check_call(["umount", entry["fields"][1]])


def dispatch(argv):
    if argv[1] == "monitor":
        monitor()
    elif argv[1] == "update":
        update(json.loads(argv[2]), json.loads(argv[3]))
    elif argv[1] == "add":
        add(json.loads(argv[2]))
    elif argv[1] == "remove":
        remove(json.loads(argv[2]))
    elif argv[1] == "mount":
        mount(json.loads(argv[2]))
    elif argv[1] == "unmount":
        unmount(json.loads(argv[2]))


try:
    dispatch(sys.argv)
except subprocess.CalledProcessError as e:
    sys.exit(e.returncode)
except Exception as e:
    sys.stderr.write(str(e) + "\n")
    sys.exit(1)
